// LFE Meeting Records — all data stays in this browser (IndexedDB). Nothing is uploaded.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const OFFICERS = {
  "LFE Coordinator": "Tanvir Ahmed Haroon",
  "LFE Program Officer": "Ms. Tania Islam",
  "LFE Jr. Program Officer": "Ariful Islam",
};
const CAT_NAME = { A: "Student / Guardian", B: "Student (other)", C: "Other", D: "Monitor / SoD" };
const CATS = ["A", "B", "C", "D"];
const issueText = (r) => (r.issues || []).map((i) => (i === "ID card swapped" && r.swapId ? `ID card swapped (${r.s_id} with ${r.swapId})` : i)).join("; ");

/* ---- IUB schools & majors (from data/iub-programs.json) ---- */
function setSelect(el, v) {
  if (!el || v === undefined) return;
  if (el.tagName === "SELECT" && v && ![...el.options].some((o) => o.value === v)) el.add(new Option(v, v));
  el.value = v;
}
async function loadPrograms() {
  let data = window.IUB_PROGRAMS;
  if (!data) {
    try { data = await (await fetch("data/iub-programs.json", { cache: "no-store" })).json(); }
    catch { data = { schools: [] }; }
  }
  const maj = document.querySelector('[name="s_major"]'), sch = document.querySelector('[name="s_school"]');
  const majorToSchool = {};
  for (const sc of data.schools) {
    const label = `${sc.code} — ${sc.name}`;
    sch.add(new Option(label, label));
    const g = document.createElement("optgroup"); g.label = label;
    for (const m of sc.majors) { g.appendChild(new Option(m, m)); majorToSchool[m] = label; }
    maj.appendChild(g);
  }
  maj.add(new Option("Other", "Other")); sch.add(new Option("Other", "Other"));
  maj.addEventListener("change", () => { if (majorToSchool[maj.value]) sch.value = majorToSchool[maj.value]; });
}

/* ================= encryption ================= */
// Records and audio are encrypted (AES-GCM) with a data key. The data key is kept on the device only
// in encrypted form, unlocked by a staff password (or the Coordinator's recovery code).
const te = new TextEncoder(), td = new TextDecoder();
function toB64(buf) {
  const a = new Uint8Array(buf); let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
async function deriveKeys(pw, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : rand(16);
  const base = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, 512));
  const key = await crypto.subtle.importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { salt: toB64(salt), verify: toB64(bits.slice(0, 32)), key };
}
async function seal(key, bytes) { const iv = rand(12); return { iv: toB64(iv), ct: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes) }; }
const unseal = (key, box) => crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, box.ct);
const newDataKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
async function wrapDK(dk, key) { const b = await seal(key, await crypto.subtle.exportKey("raw", dk)); return { iv: b.iv, ct: toB64(b.ct) }; }
async function unwrapDK(w, key) {
  const raw = await unseal(key, { iv: w.iv, ct: fromB64(w.ct) });
  return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

/* ================= storage (IndexedDB, encrypted) ================= */
let DK = null;   // data key — in memory only while someone is signed in
let ALL = [];    // last loaded list of records (used for earlier-meeting counts)
const DB = {
  _db: null, _cache: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("lfe-meetings", 2);
      r.onupgradeneeded = () => {
        for (const n of ["meetings", "recs", "audio"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: "id" });
      };
      r.onsuccess = () => res((this._db = r.result));
      r.onerror = () => rej(r.error);
    });
  },
  async req(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), q = fn(t.objectStore(store));
      t.oncomplete = () => res(q?.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  // all records, decrypted, without audio
  async all() {
    if (!this._cache) {
      const rows = await this.req("recs", "readonly", (s) => s.getAll());
      this._cache = await Promise.all(rows.map(async (x) => JSON.parse(td.decode(await unseal(DK, x)))));
      ALL = this._cache;
    }
    return this._cache.map((r) => ({ ...r }));
  },
  // audio: a Blob to store, null to remove, undefined to leave as it is
  async put(rec, audio) {
    const { audio: _skip, ...meta } = rec;
    meta.hasAudio = audio === undefined ? !!meta.hasAudio : !!audio;
    const box = await seal(DK, te.encode(JSON.stringify(meta)));
    await this.req("recs", "readwrite", (s) => s.put({ id: meta.id, ...box }));
    if (audio) {
      const ab = await seal(DK, await audio.arrayBuffer());
      await this.req("audio", "readwrite", (s) => s.put({ id: meta.id, type: audio.type || "audio/webm", ...ab }));
    } else if (audio === null) await this.req("audio", "readwrite", (s) => s.delete(meta.id));
    this._cache = null;
  },
  async audio(id) {
    const x = await this.req("audio", "readonly", (s) => s.get(id));
    return x ? new Blob([await unseal(DK, x)], { type: x.type }) : null;
  },
  async del(id) {
    await this.req("recs", "readwrite", (s) => s.delete(id));
    await this.req("audio", "readwrite", (s) => s.delete(id));
    this._cache = null;
  },
  // encrypt records saved by the earlier (unencrypted) version, then remove the plain copies
  async migrate() {
    const old = await this.req("meetings", "readonly", (s) => s.getAll());
    for (const r of old) {
      if (!r.ref) r.ref = makeRef(r);
      const a = r.audio; delete r.audio;
      await this.put(r, a || null);
    }
    if (old.length) await this.req("meetings", "readwrite", (s) => s.clear());
    return old.length;
  },
  forget() { this._cache = null; ALL = []; },
};

/* ================= helpers ================= */
const fmtDate = (d) => {
  if (!d) return "";
  const x = new Date(d + "T00:00:00");
  return x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const nowHM = () => new Date().toTimeString().slice(0, 5);
const list = (arr, other) => (arr || []).map((v) => (v === "Other" && other ? `Other (${other})` : v)).join(", ");
const medText = (r) => r.medicalType === "Other" ? `Other (${r.medicalOther})` : r.medicalType;
const outcomeText = (r) => (r.outcomes || []).map((o) => (o === "Medical issues" && r.medicalType ? `Medical issues: ${medText(r)}` : o)).join("; ");
const makeRef = (r) => `LFE-M-${r.date.replace(/-/g, "").slice(2)}-${r.id.slice(-4).toUpperCase()}`;
const refNo = (r) => r.ref || makeRef(r); // fixed when the record is first saved, so editing the date does not change it
// earlier meetings with the same student, worked out from the records on file (not stored)
const priorOf = (r) => !r.s_id ? 0 : ALL.length
  ? ALL.filter((x) => x.s_id === r.s_id && x.id !== r.id && (x.date + (x.time || "")) < (r.date + (r.time || ""))).length
  : r.priorCount || 0;
const followState = (r) => !r.followDate ? "" : r.followDone ? "done" : r.followDate < todayISO() ? "overdue" : "open";

function whoLabel(r) {
  if (r.category === "C") return r.c_title || "Meeting";
  return `${r.s_name}${r.s_id ? " (" + r.s_id + ")" : ""}`;
}

/* ---- auto-generated narrative summary ---- */
function narrative(r) {
  const officer = `the ${r.conductedBy} (${OFFICERS[r.conductedBy]})`;
  const when = `On ${fmtDate(r.date)}${r.time ? " at " + fmtTime(r.time) : ""}`;
  const p = [];
  if (r.category === "C") {
    p.push(`${when}, ${officer} held a meeting: “${r.c_title}”${r.c_participants ? ", with " + r.c_participants : ""}.`);
  } else {
    const bits = [r.s_major && `Major: ${r.s_major}`, ["A", "D"].includes(r.category) && r.s_school && `School: ${r.s_school.split(" — ")[0]}`].filter(Boolean).join(", ");
    let s = `${when}, ${officer} met student ${r.s_name} (ID ${r.s_id}${bits ? "; " + bits : ""})`;
    if (r.category === "A" && r.withGuardian === "yes")
      s += ` together with the guardian, ${r.g_name}${r.g_relation ? " (" + r.g_relation + ")" : ""}`;
    else if (r.category === "A") s += " without a guardian present";
    s += ".";
    p.push(s);
    if (r.category === "A") p.push(`This was a ${r.meetingNo.toLowerCase()}${priorOf(r) ? `; ${priorOf(r)} earlier meeting(s) with this student are on record` : ""}.`);
    if (r.category === "D") p.push(`Monitor / SoD form: ${(r.formStatus || "status not recorded").toLowerCase()}.${r.issues?.length ? " Issues noted: " + issueText(r) + "." : " No issues noted."}`);
    if (r.category === "B" && r.reasons?.length) p.push(`The meeting concerned: ${list(r.reasons, r.reasonOther)}.`);
  }
  if (r.outcomes?.length) p.push(`Outcome: ${outcomeText(r)}.`);
  if (r.followDate) p.push(r.followDone ? `The follow-up set for ${fmtDate(r.followDate)} has been completed.` : `A follow-up is set for ${fmtDate(r.followDate)}.`);
  if (r.referrals?.length) p.push(`The matter has been referred to: ${list(r.referrals, r.referralOther)}.`);
  if (r.hasAudio) p.push(`An audio recording of the meeting is on file${r.audioConsent === "yes" ? ", made with the agreement of those present" : ""}.`);
  return p.join(" ");
}

/* ---- structured summary (screen) ---- */
function sections(r) {
  const S = [];
  S.push(["Meeting", [
    ["Reference", refNo(r)],
    ["Category", `${r.category} · ${CAT_NAME[r.category]}`],
    ["Date & time", `${fmtDate(r.date)}${r.time ? ", " + fmtTime(r.time) : ""}`],
    ["Conducted by", `${OFFICERS[r.conductedBy]}, ${r.conductedBy}`],
    r.category === "A" && ["Meeting type", r.meetingNo],
    r.category === "C" && ["Title", r.c_title],
    r.category === "C" && ["Participants", r.c_participants],
  ]]);
  if (r.category !== "C") S.push(["Student", [
    ["Name", r.s_name], ["ID", r.s_id], ["Major", r.s_major],
    ["A", "D"].includes(r.category) && ["School", r.s_school],
    ["Phone", r.s_phone],
    r.category === "A" && ["Advisor", r.s_advisor],
  ]]);
  if (r.category === "A") S.push(["Guardian", r.withGuardian === "yes"
    ? [["Name", r.g_name], ["Relation", r.g_relation], ["Phone", r.g_phone]]
    : [["Present", "No — met without guardian"]]]);
  if (r.category === "D") S.push(["Monitor / SoD", [["Form status", r.formStatus || "—"], ["Issues", issueText(r) || "None"]]]);
  if (r.category === "B") S.push(["Cause / reason", [["Reason(s)", list(r.reasons, r.reasonOther) || "—"]]]);
  S.push(["Comments from LFE official", [["", r.comments || "—"]]]);
  S.push(["Follow-up & referral", [
    ["Follow-up date", r.followDate ? `${fmtDate(r.followDate)} (${{ done: "done", overdue: "overdue", open: "pending" }[followState(r)]})` : "—"],
    ["Suggestions", r.followSuggestions || "—"],
    ["Referred to", list(r.referrals, r.referralOther) || "None"],
    r.referralNote && ["Referral note", r.referralNote],
    ["Audio recording", r.hasAudio ? (r.audioConsent === "yes" ? "Yes — consent of those present recorded" : "Yes") : "No"],
  ]]);
  S.push(["Outcome", [
    ["More investigation", (r.outcomes || []).includes("More investigation needed") ? "Needed" : "No"],
    ["Medical issues", (r.outcomes || []).includes("Medical issues") ? medText(r) || "Yes" : "No"],
    ["Disciplinary issues", (r.outcomes || []).includes("Disciplinary issues") ? "Yes" : "No"],
    ["Proctorial issues", (r.outcomes || []).includes("Proctorial issues") ? "Yes" : "No"],
    r.outcomeNote && ["Outcome note", r.outcomeNote],
  ]]);
  return S.map(([t, rows]) => [t, rows.filter((x) => x && (x[1] || x[0] === ""))]);
}

function summaryHTML(r, audioURL) {
  return `<div class="sum">
    <h2>${esc(r.category === "C" ? r.c_title : "Meeting with " + r.s_name)}</h2>
    <div class="meta">${esc(refNo(r))} · Category ${r.category} · ${esc(fmtDate(r.date))}</div>
    <p class="narrative">${esc(narrative(r))}</p>
    ${sections(r).map(([t, rows]) => `<h3>${esc(t)}</h3><dl>${rows.map(([k, v]) => k
      ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : `<dd style="grid-column:1/-1">${esc(v)}</dd>`).join("")}</dl>`).join("")}
    ${audioURL ? `<h3>Recording</h3><audio controls src="${audioURL}"></audio>` : ""}
  </div>`;
}

/* ================= app shell: install, offline, saving files ================= */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function toast(msg) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// Save a file. On an installed iPhone app, downloads don't work, so use the Share sheet ("Save to Files").
async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${name}`);
}

function setupApp() {
  // Offline support (only when served from a website, not when opened as a file).
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // Ask the browser not to clear our records when the device is low on space.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Install button
  const btn = $("#install-btn");
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
  window.addEventListener("appinstalled", () => { btn.hidden = true; toast("LFE Meetings installed"); });
  if (isIOS && !isStandalone() && location.protocol.startsWith("http")) btn.hidden = false;
  btn.addEventListener("click", async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; }
    else if (isIOS) $("#ios-help").hidden = false;
  });
  $("#ios-help-close").addEventListener("click", () => ($("#ios-help").hidden = true));
  if (isStandalone()) document.documentElement.classList.add("standalone");

  // App shortcut: open straight to a new meeting
  if (location.hash === "#new") startNew();
}

/* ================= PDF ================= */
// The built-in PDF fonts only cover Latin text. For Bangla (or other scripts) use the browser's own
// print window instead, which draws every script correctly ("Save as PDF").
const PDF_SAFE = /^[\x00-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]*$/;
function printRecord(r) {
  const area = $("#print-area");
  area.innerHTML = `<div class="print-head"><b>LFE Office — Meeting Summary</b><span>${esc(refNo(r))} · CONFIDENTIAL</span></div>
    ${summaryHTML(r, null)}
    <div class="print-sign"><div>${esc(OFFICERS[r.conductedBy])}<br>${esc(r.conductedBy)}</div>
    <div>${r.category === "A" && r.withGuardian === "yes" ? "Guardian" : r.category === "C" ? "Witness" : "Student"}</div></div>`;
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); area.innerHTML = ""; removeEventListener("afterprint", done); };
  addEventListener("afterprint", done);
  setTimeout(() => window.print(), 50);
}
function makePDF(r) {
  const allText = [narrative(r), ...sections(r).flatMap(([t, rows]) => [t, ...rows.flat()]), r.c_title, r.s_name].join(" ");
  if (!PDF_SAFE.test(allText)) {
    toast("Bangla text found — use the print window and choose “Save as PDF”");
    return printRecord(r);
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50;
  let y = 0;
  const green = [31, 95, 74];
  const ensure = (h) => { if (y + h > H - 50) { doc.addPage(); y = 50; } };

  doc.setFillColor(...green); doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("LFE Office — Meeting Summary", M, 32);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.text("Live-in Field Experience · Independent University, Bangladesh", M, 50);
  doc.text(refNo(r), W - M, 32, { align: "right" });
  doc.text("CONFIDENTIAL", W - M, 50, { align: "right" });
  y = 100; doc.setTextColor(30);

  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(r.category === "C" ? r.c_title : `Meeting with ${r.s_name}`, M, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(95);
  doc.text(`Category ${r.category} · ${CAT_NAME[r.category]} · ${fmtDate(r.date)}${r.time ? ", " + fmtTime(r.time) : ""}`, M, y); y += 20;

  // narrative box
  doc.setTextColor(30); doc.setFontSize(10.5);
  const nl = doc.splitTextToSize(narrative(r), W - 2 * M - 20);
  const bh = nl.length * 14 + 16;
  doc.setFillColor(228, 239, 233); doc.roundedRect(M, y, W - 2 * M, bh, 4, 4, "F");
  doc.text(nl, M + 10, y + 18); y += bh + 16;

  for (const [title, rows] of sections(r)) {
    ensure(40);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...green);
    doc.text(title.toUpperCase(), M, y); y += 4;
    doc.setDrawColor(220); doc.line(M, y, W - M, y); y += 14;
    doc.setFontSize(10.5);
    for (const [k, v] of rows) {
      const x = k ? M + 130 : M;
      const lines = doc.splitTextToSize(String(v), W - M - x);
      ensure(lines.length * 14);
      if (k) { doc.setFont("helvetica", "normal"); doc.setTextColor(110); doc.text(k, M, y); }
      doc.setFont("helvetica", "normal"); doc.setTextColor(30); doc.text(lines, x, y);
      y += lines.length * 14 + 3;
    }
    y += 10;
  }
  ensure(90); y += 30;
  doc.setDrawColor(150); doc.line(M, y, M + 180, y); doc.line(W - M - 180, y, W - M, y);
  doc.setFontSize(9.5); doc.setTextColor(90);
  doc.text(`${OFFICERS[r.conductedBy]}`, M, y + 14); doc.text(r.conductedBy, M, y + 27);
  doc.text(r.category === "A" && r.withGuardian === "yes" ? "Guardian" : r.category === "C" ? "Witness" : "Student", W - M - 180, y + 14);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`Generated ${new Date().toLocaleString("en-GB")} · Page ${i} of ${pages}`, W / 2, H - 25, { align: "center" });
  }
  const who = (r.category === "C" ? r.c_title : r.s_id || r.s_name).replace(/[^\w-]+/g, "_");
  saveBlob(doc.output("blob"), `LFE_Meeting_${r.date}_${who}.pdf`);
}

/* ================= Excel ================= */
async function exportExcel() {
  const recs = (await DB.all()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!recs.length) return alert("No meetings to export yet.");
  const asDate = (d) => (d ? new Date(d + "T00:00:00") : "");
  const rows = recs.map((r) => ({
    "Reference": refNo(r), "Date": asDate(r.date), "Time": r.time ? fmtTime(r.time) : "", "Category": `${r.category} · ${CAT_NAME[r.category]}`,
    "Conducted by": `${OFFICERS[r.conductedBy]} (${r.conductedBy})`,
    "Meeting type": r.meetingNo || "", "Meeting title": r.c_title || "", "Participants": r.c_participants || "",
    "Student name": r.s_name || "", "Student ID": r.s_id || "", "Major": r.s_major || "", "School": r.s_school || "",
    "Student phone": r.s_phone || "", "Advisor": r.s_advisor || "",
    "With guardian": r.category === "A" ? (r.withGuardian === "yes" ? "Yes" : "No") : "",
    "Guardian name": r.g_name || "", "Guardian relation": r.g_relation || "", "Guardian phone": r.g_phone || "",
    "Reason(s)": list(r.reasons, r.reasonOther),
    "Form status (D)": r.formStatus || "", "Issues (D)": issueText(r), "Swapped with ID": r.swapId || "", "Comments": r.comments || "",
    "Follow-up date": asDate(r.followDate),
    "Follow-up status": { done: "Done", overdue: "Overdue", open: "Pending", "": "" }[followState(r)], "Follow-up suggestions": r.followSuggestions || "",
    "Referred to": list(r.referrals, r.referralOther), "Referral note": r.referralNote || "",
    "Audio recorded": r.hasAudio ? "Yes" : "No", "Recording consent": r.hasAudio ? (r.audioConsent === "yes" ? "Yes" : "Not recorded") : "",
    "More investigation needed": (r.outcomes || []).includes("More investigation needed") ? "Yes" : "",
    "Medical issue": (r.outcomes || []).includes("Medical issues") ? medText(r) || "Yes" : "",
    "Disciplinary issues": (r.outcomes || []).includes("Disciplinary issues") ? "Yes" : "",
    "Proctorial issues": (r.outcomes || []).includes("Proctorial issues") ? "Yes" : "",
    "Outcome note": r.outcomeNote || "",
    "Recorded by": r.recordedBy || "", "Last edited by": r.editedBy || "",
    "Last edited": r.editedAt ? new Date(r.editedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "",
    "Summary": narrative(r),
  }));
  const sheet = (data) => {
    const ws = XLSX.utils.json_to_sheet(data, { cellDates: true, dateNF: "d mmm yyyy" });
    ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: ["Comments", "Summary", "Follow-up suggestions"].includes(k) ? 60 : Math.max(12, k.length + 2) }));
    ws["!autofilter"] = { ref: ws["!ref"] };
    return ws;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows), "All meetings");
  for (const c of CATS) {
    const sub = rows.filter((r) => r.Category.startsWith(c));
    if (sub.length) XLSX.utils.book_append_sheet(wb, sheet(sub), `Category ${c}`);
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `LFE_Meetings_${todayISO()}.xlsx`);
}

/* ================= views ================= */
function showView(v) {
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $$("main > section").forEach((s) => (s.hidden = s.id !== "view-" + v));
  window.scrollTo(0, 0);
}
$$("[data-view]").forEach((b) => b.addEventListener("click", () => (b.dataset.view === "new" ? startNew() : (showView("list"), renderList()))));
$$("[data-go]").forEach((b) => b.addEventListener("click", () => (b.dataset.go === "new" ? startNew() : (showView("list"), renderList()))));

/* ---- list ---- */
async function renderList() {
  const all = (await DB.all()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const q = $("#list-search").value.trim().toLowerCase(), cat = $("#list-cat").value;
  const recs = all.filter((r) => (!cat || r.category === cat) &&
    (!q || [r.s_name, r.s_id, r.g_name, r.c_title, r.comments, r.conductedBy].join(" ").toLowerCase().includes(q)));
  const due = all.filter((r) => followState(r) === "open").length;
  const overdue = all.filter((r) => followState(r) === "overdue").length;
  const lastBk = localStorage.getItem("lfe-last-backup");
  const bkDays = lastBk ? Math.floor((Date.now() - new Date(lastBk)) / 864e5) : null;
  $("#backup-note").hidden = !all.length || (bkDays !== null && bkDays < 7);
  $("#backup-note").textContent = bkDays === null ? "No backup made on this device yet — click ⬇ Backup so records are not lost if this device fails."
    : `Last backup was ${bkDays} days ago. Click ⬇ Backup to make a new one.`;
  $("#stats").innerHTML = `
    <div class="stat"><b>${all.length}</b>meetings</div>
    ${CATS.map((c) => `<div class="stat"><b>${all.filter((r) => r.category === c).length}</b>${c} · ${CAT_NAME[c]}</div>`).join("")}
    <div class="stat"><b>${due}</b>follow-ups due</div>
    <div class="stat${overdue ? " alert" : ""}"><b>${overdue}</b>follow-ups overdue</div>
    <div class="stat"><b>${all.filter((r) => r.referrals?.length).length}</b>referred</div>`;
  if (!recs.length) {
    $("#records").innerHTML = `<p class="empty">${all.length ? "No meetings match." : "No meetings yet. Click “+ New meeting” to record one."}</p>`;
    return;
  }
  $("#records").innerHTML = `<table class="rtable"><thead><tr>
    <th>Date</th><th>Cat.</th><th>Student / meeting</th><th class="hide-sm">Conducted by</th><th class="hide-sm">Details</th><th>Follow-up</th></tr></thead><tbody>
    ${recs.map((r) => `<tr class="click" data-id="${r.id}">
      <td>${esc(fmtDate(r.date))}</td>
      <td><span class="tag ${r.category}">${r.category}</span></td>
      <td><b>${esc(whoLabel(r))}</b>${r.category === "A" ? `<br><small>${esc(r.meetingNo)}${r.withGuardian === "yes" ? " · with " + esc(r.g_relation || "guardian") : ""}</small>` : ""}</td>
      <td class="hide-sm">${esc(OFFICERS[r.conductedBy])}</td>
      <td class="hide-sm">${(r.reasons || []).map((x) => `<span class="pill">${esc(x === "Other" && r.reasonOther ? r.reasonOther : x)}</span>`).join("")}
        ${(r.referrals || []).map((x) => `<span class="pill ref">→ ${esc(x === "Other" && r.referralOther ? r.referralOther : x)}</span>`).join("")}
        ${r.formStatus ? `<span class="pill">${esc(r.formStatus)}</span>` : ""}
        ${(r.issues || []).map((x) => `<span class="pill iss">${esc(x)}</span>`).join("")}
        ${(r.outcomes || []).map((o) => `<span class="pill out">${esc(o === "Medical issues" ? "Medical" : o.replace(" issues", "").replace(" needed", ""))}</span>`).join("")}
        ${r.hasAudio ? '<span class="pill">🎙 audio</span>' : ""}</td>
      <td>${r.followDate ? `<span class="fu ${followState(r)}">${esc(fmtDate(r.followDate))}${followState(r) === "done" ? " ✓" : followState(r) === "overdue" ? "<br><small>overdue</small>" : ""}</span>` : "—"}</td></tr>`).join("")}
  </tbody></table>`;
  $$("#records tr.click").forEach((tr) => tr.addEventListener("click", () => openRecord(tr.dataset.id)));
}
$("#list-search").addEventListener("input", renderList);
$("#list-cat").addEventListener("change", renderList);
$("#export-xlsx").addEventListener("click", exportExcel);

/* ---- single record ---- */
let current = null, currentURL = null;
async function openRecord(id) {
  current = (await DB.all()).find((r) => r.id === id);
  if (currentURL) URL.revokeObjectURL(currentURL);
  const blob = current.hasAudio ? await DB.audio(id) : null;
  currentURL = blob ? URL.createObjectURL(blob) : null;
  $("#record-body").innerHTML = summaryHTML(current, currentURL);
  $("#rec-followup").hidden = current.category === "C";
  $("#rec-done").hidden = !current.followDate;
  $("#rec-done").textContent = current.followDone ? "Reopen follow-up" : "✓ Mark follow-up done";
  showView("record");
}
$("#rec-pdf").addEventListener("click", () => makePDF(current));
$("#rec-delete").addEventListener("click", async () => {
  if (!confirm("Delete this meeting record permanently?")) return;
  await DB.del(current.id); showView("list"); renderList();
});
$("#rec-followup").addEventListener("click", () => startNew(current));
$("#rec-edit").addEventListener("click", () => startEdit(current));
$("#rec-done").addEventListener("click", async () => {
  current.followDone = !current.followDone;
  await DB.put(current); toast(current.followDone ? "Follow-up marked done" : "Follow-up reopened");
  openRecord(current.id);
});

/* ================= wizard ================= */
const form = $("#mform");
const LAST = 4;
let step = 0, audioBlob = null, draft = null, editing = null, followOf = null;

function cat() { return form.category.value; }
function applyCategory() {
  const c = cat();
  $$("[data-show]", form).forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(c)));
  $("#guardian-block").hidden = !(c === "A" && form.withGuardian.value === "yes");
}
function setStep(n) {
  step = n;
  $$(".step", form).forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $$("#stepper li").forEach((li) => {
    const i = Number(li.dataset.step);
    li.className = i === n ? "active" : i < n ? "done" : "";
  });
  $("#back").style.visibility = n === 0 ? "hidden" : "visible";
  $("#next").hidden = n === LAST;
  $("#save").hidden = $("#pdf-btn").hidden = n !== LAST;
  if (n === 1) applyCategory();
  if (n === LAST) {
    draft = collect();
    if (draftURL) URL.revokeObjectURL(draftURL);
    draftURL = audioBlob ? URL.createObjectURL(audioBlob) : null;
    $("#summary").innerHTML = summaryHTML(draft, draftURL);
  }
  $$(".error-msg", form).forEach((e) => e.remove());
  window.scrollTo(0, 0);
}
let draftURL = null;

function validate(n) {
  $$(".invalid", form).forEach((e) => e.classList.remove("invalid"));
  $$(".error-msg", form).forEach((e) => e.remove());
  const bad = [];
  if (n === 0) {
    if (!form.conductedBy.value) bad.push($("#conductor"));
    if (!form.category.value) bad.push($$(".choice-grid")[1]);
    if (!form.date.value) bad.push(form.date);
  }
  if (n === 1) {
    $$("[data-req]", form).forEach((el) => { if (el.dataset.req.split(" ").includes(cat()) && !el.value.trim()) bad.push(el); });
    if (cat() === "A" && form.withGuardian.value === "yes" && !form.g_name.value.trim()) bad.push(form.g_name);
    if (cat() === "D" && !form.formStatus.value) bad.push($("#form-status"));
    if (cat() === "D" && $("#swap-cb").checked && !form.swapId.value.trim()) bad.push(form.swapId);
    if (cat() === "B" && !$$('[name="reasons"]:checked', form).length) bad.push($(".checks", $('[data-show="B"]')));
  }
  if (n === 2 && audioBlob && !$("#consent-cb").checked) bad.push($("#consent-cb").closest("label"));
  if (n === 3 && $("#med-cb").checked) {
    if (!form.medicalType.value) bad.push($(".radios", form));
    else if (form.medicalType.value === "Other" && !form.medicalOther.value.trim()) bad.push(form.medicalOther);
  }
  bad.forEach((el) => el.classList.add("invalid"));
  if (bad.length) {
    const m = document.createElement("div"); m.className = "error-msg"; m.textContent = "Please fill in the highlighted items.";
    $(".wizard-nav", form).before(m);
  }
  return !bad.length;
}

function collect() {
  const fd = new FormData(form), r = {};
  for (const [k, v] of fd.entries()) if (!["reasons", "referrals", "outcomes", "issues"].includes(k)) r[k] = typeof v === "string" ? v.trim() : v;
  r.reasons = fd.getAll("reasons"); r.referrals = fd.getAll("referrals"); r.outcomes = fd.getAll("outcomes");
  if (!r.outcomes.includes("Medical issues")) { delete r.medicalType; delete r.medicalOther; }
  else if (r.medicalType !== "Other") delete r.medicalOther;
  const c = r.category;
  // drop fields that don't belong to the chosen category
  if (c === "C") ["s_name", "s_id", "s_major", "s_school", "s_phone", "s_advisor"].forEach((k) => delete r[k]);
  r.issues = fd.getAll("issues");
  if (c !== "D") { r.issues = []; delete r.formStatus; delete r.swapId; }
  else { delete r.s_phone; if (!r.issues.includes("ID card swapped")) delete r.swapId; }
  if (!["A", "D"].includes(c)) delete r.s_school;
  if (c !== "A") { ["s_advisor", "meetingNo", "withGuardian", "g_name", "g_relation", "g_phone"].forEach((k) => delete r[k]); }
  if (c === "A" && r.withGuardian !== "yes") ["g_name", "g_relation", "g_phone"].forEach((k) => delete r[k]);
  if (c !== "B") { r.reasons = []; delete r.reasonOther; }
  if (c !== "C") { delete r.c_title; delete r.c_participants; }
  if (editing) { r.createdAt = editing.createdAt; r.editedAt = new Date().toISOString(); }
  r.recordedBy = editing?.recordedBy || draft?.recordedBy || me?.email || "";
  if (editing) r.editedBy = me?.email || "";
  r.id = editing?.id || draft?.id || crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
  r.hasAudio = !!audioBlob;
  if (!audioBlob) delete r.audioConsent;
  r.ref = editing?.ref || makeRef(r);
  if (editing) { if (editing.followOf) r.followOf = editing.followOf; if (editing.followDone && r.followDate === editing.followDate) r.followDone = true; }
  else if (followOf) r.followOf = followOf;
  r.priorCount = priorCount;
  return r;
}

$("#next").addEventListener("click", () => { if (validate(step)) setStep(step + 1); });
$("#back").addEventListener("click", () => setStep(Math.max(0, step - 1)));
$$('[name="category"]', form).forEach((el) => el.addEventListener("change", applyCategory));
$$('[name="withGuardian"]', form).forEach((el) => el.addEventListener("change", applyCategory));
$("#swap-cb").addEventListener("change", (e) => { $("#swap-block").hidden = !e.target.checked; $("#swap-own").value = form.s_id.value; });
form.s_id.addEventListener("input", () => ($("#swap-own").value = form.s_id.value));
$("#reason-other-cb").addEventListener("change", (e) => ($("#reason-other").hidden = !e.target.checked));
$("#med-cb").addEventListener("change", (e) => ($("#med-block").hidden = !e.target.checked));
$$('[name="medicalType"]', form).forEach((el) => el.addEventListener("change", () => ($("#med-other").hidden = form.medicalType.value !== "Other")));
$("#ref-other-cb").addEventListener("change", (e) => ($("#ref-other").hidden = !e.target.checked));

// earlier-meetings hint, by student ID
let priorCount = 0;
form.s_id.addEventListener("change", async () => {
  const id = form.s_id.value.trim(); const hint = $("#history-hint");
  const prev = id ? (await DB.all()).filter((r) => r.s_id === id && r.id !== editing?.id) : [];
  priorCount = prev.length;
  if (!prev.length) { hint.hidden = true; return; }
  const last = prev.sort((a, b) => b.date.localeCompare(a.date))[0];
  hint.hidden = false; hint.className = "hint warn";
  hint.textContent = `${prev.length} earlier meeting(s) with this student on record — last on ${fmtDate(last.date)} (Category ${last.category}).`;
  if (cat() === "A") form.meetingNo.value = "Follow-up meeting";
  if (!form.s_name.value) {
    for (const k of ["s_name", "s_major", "s_school", "s_phone", "s_advisor"]) if (last[k] && form[k]) setSelect(form[k], last[k]);
  }
});

$("#save").addEventListener("click", async () => {
  const rec = { ...draft, createdAt: draft.createdAt || new Date().toISOString() };
  await DB.put(rec, audioBlob || null);
  // a follow-up meeting closes the follow-up on the meeting it came from
  if (!editing && rec.followOf) {
    const src = (await DB.all()).find((x) => x.id === rec.followOf);
    if (src && src.followDate && !src.followDone) { src.followDone = true; await DB.put(src); }
  }
  const wasEdit = editing; editing = null;
  toast(wasEdit ? "Changes saved" : "Meeting saved");
  if (wasEdit) openRecord(rec.id); else { showView("list"); await renderList(); }
});
$("#pdf-btn").addEventListener("click", () => makePDF(draft));

function startNew(from) {
  form.reset(); stopRec(true);
  audioBlob = null; draft = null; priorCount = 0; editing = null; followOf = from?.id || null;
  $("#edit-banner").hidden = true; $("#save").textContent = "Save meeting";
  $("#med-block").hidden = $("#med-other").hidden = $("#swap-block").hidden = true;
  $("#audio-preview").innerHTML = ""; $("#history-hint").hidden = true;
  $("#reason-other").hidden = $("#ref-other").hidden = true;
  form.date.value = todayISO(); form.time.value = nowHM();
  lockConductor(me?.role);
  if (from) {
    form.category.value = from.category;
    for (const k of ["s_name", "s_id", "s_major", "s_school", "s_phone", "s_advisor", "g_name", "g_relation", "g_phone"]) if (from[k] && form[k]) setSelect(form[k], from[k]);
    if (from.category === "A") { form.meetingNo.value = "Follow-up meeting"; form.withGuardian.value = from.withGuardian || "no"; }
    form.s_id.dispatchEvent(new Event("change"));
  }
  showView("new"); setStep(0);
}

function startEdit(r) {
  startNew();
  editing = r;
  for (const el of form.elements) {
    if (!el.name || el.type === "file") continue;
    const v = r[el.name];
    if (el.type === "checkbox") el.checked = Array.isArray(v) ? v.includes(el.value) : v === el.value;
    else if (el.type === "radio") el.checked = v === el.value;
    else if (v !== undefined) setSelect(el, v);
  }
  lockConductor(r.conductedBy);
  priorCount = r.priorCount || 0;
  $("#reason-other").hidden = !(r.reasons || []).includes("Other");
  $("#ref-other").hidden = !(r.referrals || []).includes("Other");
  $("#med-block").hidden = !(r.outcomes || []).includes("Medical issues");
  $("#med-other").hidden = r.medicalType !== "Other";
  $("#swap-block").hidden = !(r.issues || []).includes("ID card swapped"); $("#swap-own").value = r.s_id || "";
  if (r.hasAudio) DB.audio(r.id).then((b) => { if (b && editing?.id === r.id) showAudio(b, "Saved recording"); });
  $("#edit-banner").textContent = `Editing ${refNo(r)} — ${whoLabel(r)}. Changes replace the saved record.`;
  $("#edit-banner").hidden = false;
  $("#save").textContent = "Save changes";
  setStep(0);
}

/* ---- audio ---- */
let rec = null, chunks = [], recTimer = null, recStart = 0;
function showAudio(blob, label) {
  audioBlob = blob;
  const url = URL.createObjectURL(blob);
  $("#audio-preview").innerHTML = `<audio controls src="${url}"></audio>
    <div class="hint">${esc(label)} · ${(blob.size / 1024 / 1024).toFixed(1)} MB · <a href="#" id="audio-remove">remove</a></div>`;
  $("#audio-remove").onclick = (e) => { e.preventDefault(); audioBlob = null; $("#audio-preview").innerHTML = ""; };
}
function stopRec(discard) {
  if (rec && rec.state !== "inactive") { rec._discard = discard; rec.stop(); }
  clearInterval(recTimer); $("#rec-time").textContent = "";
  $("#rec-btn").classList.remove("on"); $("#rec-btn").textContent = "● Start recording";
}
$("#rec-btn").addEventListener("click", async () => {
  if (rec && rec.state === "recording") return stopRec(false);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(stream); chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!rec._discard) showAudio(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), `Recorded ${$("#rec-time").dataset.last || ""}`);
    };
    rec.start(); recStart = Date.now();
    $("#rec-btn").classList.add("on"); $("#rec-btn").textContent = "■ Stop recording";
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      const t = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("#rec-time").textContent = t; $("#rec-time").dataset.last = t;
    }, 250);
  } catch (err) {
    alert("Microphone not available: " + err.message + "\nYou can upload an audio file instead.");
  }
});
$("#audio-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) showAudio(f, f.name); e.target.value = ""; });

/* ================= sign in ================= */
// Accounts are kept on this device (localStorage). For each person we store only a salted PBKDF2
// check value and the data key encrypted with their password — never the password itself.
const COORD_EMAIL = "coordinator.lfe@iub.edu.bd"; // fixed — cannot be removed or changed
const ROLES = ["LFE Coordinator", "LFE Program Officer", "LFE Jr. Program Officer"];
const DEFAULT_USERS = {
  "LFE Program Officer": ["t.islam@iub.edu.bd"],
  "LFE Jr. Program Officer": ["arif.tanz@iub.edu.bd"],
};
const AUTH_KEY = "lfe-auth-v2", IDLE_MIN = 30;
const normEmail = (e) => String(e || "").trim().toLowerCase();
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randCode = (n) => [...rand(n)].map((x) => B32[x % 32]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const Auth = {
  load() {
    let a = null;
    try { a = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch {}
    a = a || {};
    a.users = a.users || JSON.parse(JSON.stringify(DEFAULT_USERS));
    a.pw = a.pw || {};
    for (const r of ROLES.slice(1)) a.users[r] = a.users[r] || [];
    return a;
  },
  save(a) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); },
  roleOf(email, a = this.load()) {
    email = normEmail(email);
    if (email === COORD_EMAIL) return ROLES[0];
    return ROLES.slice(1).find((r) => a.users[r].includes(email)) || null;
  },
  async setPassword(a, email, pw, dk, temp = false) {
    const k = await deriveKeys(pw);
    a.pw[email] = { salt: k.salt, verify: k.verify, wrap: await wrapDK(dk, k.key), ...(temp ? { temp: true } : {}) };
  },
  async newRecovery(a, dk) {
    const code = randCode(20), k = await deriveKeys(code);
    a.recovery = { salt: k.salt, verify: k.verify, wrap: await wrapDK(dk, k.key) };
    return code.match(/.{5}/g).join("-");
  },
};

let me = null, lastUser = null, started = false, lastActive = Date.now(), failures = 0;
let mode = "login", pending = null; // pending: someone who signed in with a temporary password
const isCoord = () => me?.role === ROLES[0];
const touch = () => (lastActive = Date.now());

const lf = $("#login-form");
function loginMsg(t, err = true) { const m = $("#login-msg"); m.textContent = t; m.className = "hint" + (t && err ? " err" : ""); }
function prepLogin() {
  const a = Auth.load(), email = normEmail(lf.email.value), role = Auth.roleOf(email, a);
  const first = mode === "login" && role === ROLES[0] && !a.pw[email];
  $("#rc-wrap").hidden = mode !== "recover";
  $("#pw2-wrap").hidden = !(first || mode !== "login");
  $("#login-role").hidden = mode !== "login";
  lf.email.readOnly = mode !== "login";
  $("#pw-label").textContent = mode === "recover" ? "New Coordinator password (at least 8 characters)"
    : mode === "setnew" ? "Choose your own password (at least 8 characters)"
    : first ? "Create the Coordinator password (at least 8 characters)" : "Password";
  lf.password.autocomplete = mode === "login" && !first ? "current-password" : "new-password";
  $("#login-go").textContent = mode === "recover" ? "Reset password & sign in" : mode === "setnew" ? "Save password & sign in" : first ? "Set up this device" : "Sign in";
  $("#login-title").textContent = mode === "recover" ? "Reset Coordinator password" : mode === "setnew" ? "Choose your password" : first ? "Set up this device" : "Sign in";
  $("#forgot").hidden = mode !== "login";
  $("#login-back").hidden = mode === "login";
  if (role && mode === "login") lf.loginRole.value = role;
  $("#login-note").textContent =
    mode === "recover" ? "Enter the recovery code you were given when this device was set up."
    : first ? "First use on this device. The Coordinator sets the password that protects the records here, and receives a recovery code — keep it somewhere safe."
    : mode === "login" && role && !a.pw[email] ? (a.pw[COORD_EMAIL]
        ? "No password on this device yet. The Coordinator must sign in, open 👥 Users and give you a temporary password."
        : "This device has not been set up yet. The Coordinator must sign in first.")
    : "";
}
function setMode(m) { mode = m; lf.password.value = lf.password2.value = lf.rcode.value = ""; loginMsg(""); prepLogin(); }
lf.email.addEventListener("input", prepLogin);
$$('[name="loginRole"]', lf).forEach((el) => el.addEventListener("change", () => {
  if (lf.loginRole.value === ROLES[0]) lf.email.value = COORD_EMAIL;
  else if (normEmail(lf.email.value) === COORD_EMAIL) lf.email.value = "";
  if (!lf.email.value) { const list = Auth.load().users[lf.loginRole.value] || []; if (list.length === 1) lf.email.value = list[0]; }
  prepLogin(); (lf.email.value ? lf.password : lf.email).focus();
}));
$("#forgot").addEventListener("click", (e) => {
  e.preventDefault();
  if (Auth.roleOf(lf.email.value) !== ROLES[0])
    return loginMsg("Ask the LFE Coordinator to give you a temporary password (👥 Users → Reset password).", false);
  if (!Auth.load().recovery) return loginMsg("This device has no recovery code yet.");
  setMode("recover");
});
$("#login-back").addEventListener("click", (e) => { e.preventDefault(); pending = null; setMode("login"); });

lf.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!window.crypto?.subtle) return loginMsg("This browser can't protect the records here. Use the https website, or a current Chrome / Edge / Safari.");
  const a = Auth.load(), email = normEmail(lf.email.value), role = Auth.roleOf(email, a), pw = lf.password.value;
  const newPwOK = () => {
    if (pw.length < 8) { loginMsg("Choose a password of at least 8 characters."); return false; }
    if (pw !== lf.password2.value) { loginMsg("The two passwords don't match."); return false; }
    return true;
  };
  if (failures >= 5) return loginMsg("Too many wrong attempts. Wait 30 seconds and try again.");
  const fail = (t) => { if (++failures >= 5) setTimeout(() => (failures = 0), 30000); loginMsg(t); };
  $("#login-go").disabled = true; loginMsg("Checking…", false);
  try {
    if (mode === "setnew") {
      if (!newPwOK()) return;
      await Auth.setPassword(a, pending.email, pw, pending.dk); Auth.save(a);
      const p = pending; pending = null; mode = "login";
      return finish(p.email, p.role, p.dk);
    }
    if (mode === "recover") {
      if (!a.recovery) return loginMsg("This device has no recovery code.");
      const k = await deriveKeys(normCode(lf.rcode.value), a.recovery.salt);
      if (k.verify !== a.recovery.verify) return fail("That recovery code is not right.");
      if (!newPwOK()) return;
      const dk = await unwrapDK(a.recovery.wrap, k.key);
      await Auth.setPassword(a, COORD_EMAIL, pw, dk); Auth.save(a);
      mode = "login";
      return finish(COORD_EMAIL, ROLES[0], dk);
    }
    if (!email || !pw) return loginMsg("Enter your email and password.");
    if (!role) return loginMsg("This email is not allowed to sign in. Ask the LFE Coordinator to add it.");
    if (role !== lf.loginRole.value) return loginMsg(`This email is registered as ${role}.`);
    if (!a.pw[email]) {
      if (role !== ROLES[0]) return prepLogin(), loginMsg($("#login-note").textContent);
      // first Coordinator sign-in on this device: create the data key and a recovery code
      if (!newPwOK()) return;
      const dk = await newDataKey();
      await Auth.setPassword(a, email, pw, dk);
      const code = await Auth.newRecovery(a, dk);
      Auth.save(a);
      await finish(email, role, dk);
      return showRecovery(code);
    }
    const k = await deriveKeys(pw, a.pw[email].salt);
    if (k.verify !== a.pw[email].verify) return fail("Wrong password.");
    const dk = await unwrapDK(a.pw[email].wrap, k.key);
    failures = 0;
    if (a.pw[email].temp) { pending = { email, role, dk }; setMode("setnew"); return loginMsg("Temporary password accepted. Now choose your own password.", false); }
    await finish(email, role, dk);
  } catch (err) {
    loginMsg("Could not sign in: " + err.message);
  } finally { $("#login-go").disabled = false; }
});

async function finish(email, role, dk) {
  const prev = lastUser;
  DK = dk; me = { email, role }; touch(); failures = 0;
  if (prev && prev.email !== email) resetWorkspace(); // someone else was signed in before: start clean
  lf.reset(); mode = "login"; prepLogin(); loginMsg("");
  const moved = await DB.migrate();
  document.body.classList.remove("locked"); $("#login").hidden = true;
  $("#who-am-i").innerHTML = `Signed in: <b>${esc(OFFICERS[role])}</b> · ${esc(role)} · ${esc(email)}`;
  $("#users-btn").hidden = $("#restore-btn").hidden = !isCoord();
  if (!started) { started = true; loadPrograms(); setupApp(); }
  if (!$("#view-record").hidden && current) openRecord(current.id); else await renderList();
  if (moved) toast(`${moved} earlier record(s) are now encrypted`);
}

function resetWorkspace() {
  editing = null; draft = null; audioBlob = null; followOf = null; current = null;
  form.reset(); $("#audio-preview").innerHTML = "";
  showView("list");
}

function lock(msg) {
  if (me) lastUser = me;
  me = null; DK = null; DB.forget();
  if (typeof rec !== "undefined" && rec && rec.state === "recording") stopRec(false);
  // remove decrypted content from the page
  $("#records").innerHTML = $("#record-body").innerHTML = $("#summary").innerHTML = $("#stats").innerHTML = "";
  if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }
  document.body.classList.add("locked"); $("#login").hidden = false;
  $$(".sheet").forEach((sh) => (sh.hidden = true));
  lf.reset(); mode = "login"; pending = null;
  lf.email.value = lastUser ? lastUser.email : COORD_EMAIL;
  prepLogin(); loginMsg(msg || "", false);
  (lf.email.value ? lf.password : lf.email).focus();
}
$("#logout-btn").addEventListener("click", () => { lastUser = null; resetWorkspace(); lock(); });

// Sign out automatically after a while without activity (not while recording audio).
["pointerdown", "keydown", "scroll"].forEach((ev) => addEventListener(ev, () => me && touch(), { passive: true }));
setInterval(() => {
  if (!me) return;
  if (typeof rec !== "undefined" && rec && rec.state === "recording") return touch();
  if (Date.now() - lastActive > IDLE_MIN * 60000) lock(`Signed out after ${IDLE_MIN} minutes without activity. Sign in again to continue.`);
}, 20000);

/* ---- recovery code ---- */
function showRecovery(code) {
  $("#rc-code").textContent = code;
  $("#rc-sheet").hidden = false;
}
$("#rc-ok").addEventListener("click", () => ($("#rc-sheet").hidden = true));

/* ---- who may conduct: officers record their own meetings; the Coordinator may choose any ---- */
function lockConductor(value) {
  $$('[name="conductedBy"]', form).forEach((el) => {
    el.disabled = !isCoord() && el.value !== value;
    el.checked = el.value === value;
  });
}

/* ---- Users window (Coordinator only) ---- */
const tempShown = {}; // temporary passwords just created, shown once
function renderUsers() {
  const a = Auth.load();
  const status = (e) => tempShown[e] ? `Temporary password: <code class="temp">${esc(tempShown[e])}</code> — give this to them`
    : !a.pw[e] ? "No password on this device" : a.pw[e].temp ? "Temporary password (must change at sign-in)" : "Password set";
  $("#users-body").innerHTML = `
    <div class="urole"><h3>LFE Coordinator <small>(${esc(OFFICERS[ROLES[0]])})</small></h3>
      <div class="urow"><span class="em">${esc(COORD_EMAIL)}</span><small>Fixed</small>
        <button class="btn ghost sm" data-recovery>New recovery code</button></div></div>` +
    ROLES.slice(1).map((r) => `<div class="urole" data-role="${esc(r)}">
      <h3>${esc(r)} <small>(${esc(OFFICERS[r])})</small></h3>
      ${a.users[r].length ? a.users[r].map((e) => `<div class="urow"><span class="em">${esc(e)}</span>
          <small>${status(e)}</small>
          <button class="btn ghost sm" data-temp="${esc(e)}">${a.pw[e] ? "Reset password" : "Give temporary password"}</button>
          <button class="btn ghost danger sm" data-remove="${esc(e)}">Remove</button></div>`).join("")
        : `<p class="hint warn">No email — nobody can sign in as ${esc(r)}.</p>`}
      <div class="uadd"><input type="email" placeholder="name@iub.edu.bd" aria-label="New email for ${esc(r)}">
        <button class="btn sm" data-add>Add</button></div></div>`).join("");
}
function addUser(box) {
  const input = $("input", box), email = normEmail(input.value), role = box.dataset.role;
  if (!isEmail(email)) { input.classList.add("invalid"); return toast("Enter a valid email address"); }
  const a = Auth.load(), used = Auth.roleOf(email, a);
  if (used) { input.classList.add("invalid"); return toast(`Already used by ${used}`); }
  a.users[role].push(email); Auth.save(a); renderUsers(); toast(`Added ${email}`);
}
$("#users-body").addEventListener("click", async (e) => {
  if (!isCoord() || !DK) return;
  const b = e.target.closest("button"); if (!b) return;
  const box = b.closest(".urole"), role = box?.dataset.role, a = Auth.load();
  if (b.dataset.add !== undefined) return addUser(box);
  if (b.dataset.recovery !== undefined) {
    if (!confirm("Create a new recovery code? The old code will stop working.")) return;
    const code = await Auth.newRecovery(a, DK); Auth.save(a); return showRecovery(code);
  }
  if (b.dataset.remove) {
    const em = b.dataset.remove;
    if (!confirm(`Remove ${em}? They will no longer be able to sign in on this device.`)) return;
    a.users[role] = a.users[role].filter((x) => x !== em); delete a.pw[em]; delete tempShown[em];
    Auth.save(a); renderUsers();
  } else if (b.dataset.temp) {
    const em = b.dataset.temp;
    if (a.pw[em] && !confirm(`Reset the password for ${em}? Their current password stops working.`)) return;
    const tmp = randCode(4) + "-" + randCode(4);
    await Auth.setPassword(a, em, tmp, DK, true); Auth.save(a);
    tempShown[em] = tmp; renderUsers();
  }
});
$("#users-body").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches(".uadd input")) { e.preventDefault(); if (isCoord()) addUser(e.target.closest(".urole")); }
});
$("#users-body").addEventListener("input", (e) => e.target.classList.remove("invalid"));
$("#users-btn").addEventListener("click", () => { if (!isCoord()) return; renderUsers(); $("#users-sheet").hidden = false; });
$("#users-close").addEventListener("click", () => { for (const k in tempShown) delete tempShown[k]; $("#users-sheet").hidden = true; });

/* ---- change own password ---- */
const pf = $("#pw-form");
$("#mypw-btn").addEventListener("click", () => { pf.reset(); $("#pw-msg").textContent = ""; $("#pw-sheet").hidden = false; pf.old.focus(); });
$("#pw-cancel").addEventListener("click", () => ($("#pw-sheet").hidden = true));
pf.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = (t) => { $("#pw-msg").textContent = t; $("#pw-msg").className = "hint err"; };
  if (!me || !DK) return;
  const a = Auth.load(), cur = a.pw[me.email];
  if (!cur || (await deriveKeys(pf.old.value, cur.salt)).verify !== cur.verify) return msg("Current password is wrong.");
  if (pf.new1.value.length < 8) return msg("New password must be at least 8 characters.");
  if (pf.new1.value !== pf.new2.value) return msg("The new passwords don't match.");
  await Auth.setPassword(a, me.email, pf.new1.value, DK); Auth.save(a);
  $("#pw-sheet").hidden = true; toast("Password changed");
});

/* ================= backup & restore ================= */
// A backup is one encrypted file with every record, its audio, and the list of staff emails.
// It is locked with a backup password chosen when it is made. Restoring merges: newer versions win.
const bf = $("#bk-form");
let bkMode = "save", bkFile = null;
function openBackup(m, file) {
  bkMode = m; bkFile = file || null; bf.reset(); $("#bk-msg").textContent = "";
  $("#bk-title").textContent = m === "save" ? "Back up all meetings" : `Restore from ${file.name}`;
  $("#bk-intro").textContent = m === "save"
    ? "Choose a password for this backup file. You need it to restore the file — on this or another device. Keep the file somewhere safe (e.g. IUB OneDrive / Google Drive)."
    : "Enter the password that was chosen when this backup was made. Records are merged with the ones on this device; where both have the same meeting, the most recently edited version is kept.";
  $("#bk2-wrap").hidden = m !== "save";
  $("#bk-go").textContent = m === "save" ? "Create backup" : "Restore";
  $("#bk-sheet").hidden = false; bf.bpw.focus();
}
$("#backup-btn").addEventListener("click", () => openBackup("save"));
$("#restore-btn").addEventListener("click", () => $("#restore-file").click());
$("#restore-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f && isCoord()) openBackup("restore", f); });
$("#bk-cancel").addEventListener("click", () => ($("#bk-sheet").hidden = true));
bf.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = (t, err = true) => { $("#bk-msg").textContent = t; $("#bk-msg").className = "hint" + (err ? " err" : ""); };
  const pw = bf.bpw.value;
  $("#bk-go").disabled = true;
  try {
    if (bkMode === "save") {
      if (pw.length < 8) return msg("Choose a backup password of at least 8 characters.");
      if (pw !== bf.bpw2.value) return msg("The two passwords don't match.");
      msg("Preparing backup…", false);
      const recs = await DB.all();
      for (const r of recs) if (r.hasAudio) {
        const b = await DB.audio(r.id);
        if (b) r.audio = { type: b.type, data: toB64(await b.arrayBuffer()) };
      }
      const payload = { users: Auth.load().users, records: recs };
      const k = await deriveKeys(pw), box = await seal(k.key, te.encode(JSON.stringify(payload)));
      const file = { format: "lfe-meetings-backup", version: 1, created: new Date().toISOString(), by: me.email,
        count: recs.length, salt: k.salt, iv: box.iv, data: toB64(box.ct) };
      $("#bk-sheet").hidden = true;
      await saveBlob(new Blob([JSON.stringify(file)], { type: "application/json" }), `LFE_Meetings_Backup_${todayISO()}.json`);
      localStorage.setItem("lfe-last-backup", new Date().toISOString()); renderList();
    } else {
      if (!isCoord()) return;
      let file;
      try { file = JSON.parse(await bkFile.text()); } catch { return msg("This is not an LFE backup file."); }
      if (file.format !== "lfe-meetings-backup") return msg("This is not an LFE backup file.");
      msg("Opening backup…", false);
      let payload;
      try {
        const k = await deriveKeys(pw, file.salt);
        payload = JSON.parse(td.decode(await unseal(k.key, { iv: file.iv, ct: fromB64(file.data) })));
      } catch { return msg("Wrong backup password, or the file is damaged."); }
      const have = new Map((await DB.all()).map((r) => [r.id, r]));
      const stamp = (r) => r.editedAt || r.createdAt || "";
      let added = 0, updated = 0, same = 0;
      for (const r of payload.records) {
        const old = have.get(r.id);
        if (old && stamp(old) >= stamp(r)) { same++; continue; }
        const a = r.audio ? new Blob([fromB64(r.audio.data)], { type: r.audio.type }) : null;
        delete r.audio;
        await DB.put(r, a);
        old ? updated++ : added++;
      }
      // bring over staff emails that this device doesn't have yet
      const a = Auth.load(); let newUsers = 0;
      for (const role of ROLES.slice(1)) for (const em of payload.users?.[role] || [])
        if (!Auth.roleOf(em, a)) { a.users[role].push(em); newUsers++; }
      Auth.save(a);
      $("#bk-sheet").hidden = true; await renderList();
      alert(`Restore complete.\n\n${added} new meeting(s) added\n${updated} updated with a newer version\n${same} already up to date` +
        (newUsers ? `\n${newUsers} staff email(s) added — give them a temporary password in 👥 Users.` : ""));
    }
  } catch (err) { msg("Something went wrong: " + err.message); }
  finally { $("#bk-go").disabled = false; }
});

/* ---- start ---- */
lock();
