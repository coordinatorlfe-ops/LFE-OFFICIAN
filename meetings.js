// LFE Meeting Records — all data stays in this browser (IndexedDB). Nothing is uploaded.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const OFFICERS = {
  "LFE Coordinator": "Tanvir Ahmed Haroon",
  "LFE Program Officer": "Ms. Tania Islam",
  "LFE Jr. Program Officer": "Ariful Islam",
};
const CAT_NAME = { A: "Student / Guardian", B: "Student (other)", C: "Other" };

/* ================= storage (IndexedDB) ================= */
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("lfe-meetings", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("meetings", { keyPath: "id" });
      r.onsuccess = () => res((this._db = r.result));
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("meetings", mode);
      const out = fn(t.objectStore("meetings"));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx("readonly", (s) => s.getAll()); },
  put(rec) { return this.tx("readwrite", (s) => s.put(rec)); },
  del(id) { return this.tx("readwrite", (s) => s.delete(id)); },
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
const refNo = (r) => `LFE-M-${r.date.replace(/-/g, "").slice(2)}-${r.id.slice(-4).toUpperCase()}`;

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
    const bits = [r.s_major && `Major: ${r.s_major}`, r.category === "A" && r.s_school && `School: ${r.s_school.split(" — ")[0]}`].filter(Boolean).join(", ");
    let s = `${when}, ${officer} met student ${r.s_name} (ID ${r.s_id}${bits ? "; " + bits : ""})`;
    if (r.category === "A" && r.withGuardian === "yes")
      s += ` together with the guardian, ${r.g_name}${r.g_relation ? " (" + r.g_relation + ")" : ""}`;
    else if (r.category === "A") s += " without a guardian present";
    s += ".";
    p.push(s);
    if (r.category === "A") p.push(`This was a ${r.meetingNo.toLowerCase()}${r.priorCount ? `; ${r.priorCount} earlier meeting(s) with this student are on record` : ""}.`);
    if (r.category === "B" && r.reasons?.length) p.push(`The meeting concerned: ${list(r.reasons, r.reasonOther)}.`);
  }
  if (r.outcomes?.length) p.push(`Outcome: ${outcomeText(r)}.`);
  if (r.followDate) p.push(`A follow-up is set for ${fmtDate(r.followDate)}.`);
  if (r.referrals?.length) p.push(`The matter has been referred to: ${list(r.referrals, r.referralOther)}.`);
  if (r.hasAudio) p.push("An audio recording of the meeting is on file.");
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
    r.category === "A" && ["School", r.s_school],
    ["Phone", r.s_phone],
    r.category === "A" && ["Advisor", r.s_advisor],
  ]]);
  if (r.category === "A") S.push(["Guardian", r.withGuardian === "yes"
    ? [["Name", r.g_name], ["Relation", r.g_relation], ["Phone", r.g_phone]]
    : [["Present", "No — met without guardian"]]]);
  if (r.category === "B") S.push(["Cause / reason", [["Reason(s)", list(r.reasons, r.reasonOther) || "—"]]]);
  S.push(["Comments from LFE official", [["", r.comments || "—"]]]);
  S.push(["Follow-up & referral", [
    ["Follow-up date", r.followDate ? fmtDate(r.followDate) : "—"],
    ["Suggestions", r.followSuggestions || "—"],
    ["Referred to", list(r.referrals, r.referralOther) || "None"],
    r.referralNote && ["Referral note", r.referralNote],
    ["Audio recording", r.hasAudio ? "Yes" : "No"],
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

/* ================= PDF ================= */
function makePDF(r) {
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
  doc.save(`LFE_Meeting_${r.date}_${who}.pdf`);
}

/* ================= Excel ================= */
async function exportExcel() {
  const recs = (await DB.all()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!recs.length) return alert("No meetings to export yet.");
  const rows = recs.map((r) => ({
    "Reference": refNo(r), "Date": r.date, "Time": r.time, "Category": `${r.category} · ${CAT_NAME[r.category]}`,
    "Conducted by": `${OFFICERS[r.conductedBy]} (${r.conductedBy})`,
    "Meeting type": r.meetingNo || "", "Meeting title": r.c_title || "", "Participants": r.c_participants || "",
    "Student name": r.s_name || "", "Student ID": r.s_id || "", "Major": r.s_major || "", "School": r.s_school || "",
    "Student phone": r.s_phone || "", "Advisor": r.s_advisor || "",
    "With guardian": r.category === "A" ? (r.withGuardian === "yes" ? "Yes" : "No") : "",
    "Guardian name": r.g_name || "", "Guardian relation": r.g_relation || "", "Guardian phone": r.g_phone || "",
    "Reason(s)": list(r.reasons, r.reasonOther), "Comments": r.comments || "",
    "Follow-up date": r.followDate || "", "Follow-up suggestions": r.followSuggestions || "",
    "Referred to": list(r.referrals, r.referralOther), "Referral note": r.referralNote || "",
    "Audio recorded": r.hasAudio ? "Yes" : "No",
    "More investigation needed": (r.outcomes || []).includes("More investigation needed") ? "Yes" : "",
    "Medical issue": (r.outcomes || []).includes("Medical issues") ? medText(r) || "Yes" : "",
    "Disciplinary issues": (r.outcomes || []).includes("Disciplinary issues") ? "Yes" : "",
    "Proctorial issues": (r.outcomes || []).includes("Proctorial issues") ? "Yes" : "",
    "Outcome note": r.outcomeNote || "",
    "Last edited": r.editedAt ? new Date(r.editedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "",
    "Summary": narrative(r),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: ["Comments", "Summary", "Follow-up suggestions"].includes(k) ? 60 : Math.max(12, k.length + 2) }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "All meetings");
  for (const c of ["A", "B", "C"]) {
    const sub = rows.filter((r) => r.Category.startsWith(c));
    if (sub.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sub), `Category ${c}`);
  }
  XLSX.writeFile(wb, `LFE_Meetings_${todayISO()}.xlsx`);
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
  const today = todayISO();
  const due = all.filter((r) => r.followDate && r.followDate >= today).length;
  $("#stats").innerHTML = `
    <div class="stat"><b>${all.length}</b>meetings</div>
    ${["A", "B", "C"].map((c) => `<div class="stat"><b>${all.filter((r) => r.category === c).length}</b>${c} · ${CAT_NAME[c]}</div>`).join("")}
    <div class="stat"><b>${due}</b>follow-ups upcoming</div>
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
        ${(r.outcomes || []).map((o) => `<span class="pill out">${esc(o === "Medical issues" ? "Medical" : o.replace(" issues", "").replace(" needed", ""))}</span>`).join("")}
        ${r.hasAudio ? '<span class="pill">🎙 audio</span>' : ""}</td>
      <td>${r.followDate ? esc(fmtDate(r.followDate)) : "—"}</td></tr>`).join("")}
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
  currentURL = current.audio ? URL.createObjectURL(current.audio) : null;
  $("#record-body").innerHTML = summaryHTML(current, currentURL);
  $("#rec-followup").hidden = current.category === "C";
  showView("record");
}
$("#rec-pdf").addEventListener("click", () => makePDF(current));
$("#rec-delete").addEventListener("click", async () => {
  if (!confirm("Delete this meeting record permanently?")) return;
  await DB.del(current.id); showView("list"); renderList();
});
$("#rec-followup").addEventListener("click", () => startNew(current));
$("#rec-edit").addEventListener("click", () => startEdit(current));

/* ================= wizard ================= */
const form = $("#mform");
const LAST = 4;
let step = 0, audioBlob = null, draft = null, editing = null;

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
    if (cat() === "B" && !$$('[name="reasons"]:checked', form).length) bad.push($(".checks", $('[data-show="B"]')));
  }
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
  for (const [k, v] of fd.entries()) if (!["reasons", "referrals", "outcomes"].includes(k)) r[k] = typeof v === "string" ? v.trim() : v;
  r.reasons = fd.getAll("reasons"); r.referrals = fd.getAll("referrals"); r.outcomes = fd.getAll("outcomes");
  if (!r.outcomes.includes("Medical issues")) { delete r.medicalType; delete r.medicalOther; }
  else if (r.medicalType !== "Other") delete r.medicalOther;
  const c = r.category;
  // drop fields that don't belong to the chosen category
  if (c === "C") ["s_name", "s_id", "s_major", "s_school", "s_phone", "s_advisor"].forEach((k) => delete r[k]);
  if (c !== "A") { ["s_school", "s_advisor", "meetingNo", "withGuardian", "g_name", "g_relation", "g_phone"].forEach((k) => delete r[k]); }
  if (c === "A" && r.withGuardian !== "yes") ["g_name", "g_relation", "g_phone"].forEach((k) => delete r[k]);
  if (c !== "B") { r.reasons = []; delete r.reasonOther; }
  if (c !== "C") { delete r.c_title; delete r.c_participants; }
  if (editing) { r.createdAt = editing.createdAt; r.editedAt = new Date().toISOString(); }
  r.id = editing?.id || draft?.id || crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
  r.hasAudio = !!audioBlob;
  r.priorCount = priorCount;
  return r;
}

$("#next").addEventListener("click", () => { if (validate(step)) setStep(step + 1); });
$("#back").addEventListener("click", () => setStep(Math.max(0, step - 1)));
$$('[name="category"]', form).forEach((el) => el.addEventListener("change", applyCategory));
$$('[name="withGuardian"]', form).forEach((el) => el.addEventListener("change", applyCategory));
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
    for (const k of ["s_name", "s_major", "s_school", "s_phone", "s_advisor"]) if (last[k] && form[k]) form[k].value = last[k];
  }
});

$("#save").addEventListener("click", async () => {
  const rec = { ...draft, audio: audioBlob || null, createdAt: draft.createdAt || new Date().toISOString() };
  await DB.put(rec);
  const wasEdit = editing; editing = null;
  if (wasEdit) openRecord(rec.id); else { showView("list"); await renderList(); }
});
$("#pdf-btn").addEventListener("click", () => makePDF(draft));

function startNew(from) {
  form.reset(); stopRec(true);
  audioBlob = null; draft = null; priorCount = 0; editing = null;
  $("#edit-banner").hidden = true; $("#save").textContent = "Save meeting";
  $("#med-block").hidden = $("#med-other").hidden = true;
  $("#audio-preview").innerHTML = ""; $("#history-hint").hidden = true;
  $("#reason-other").hidden = $("#ref-other").hidden = true;
  form.date.value = todayISO(); form.time.value = nowHM();
  if (from) {
    form.category.value = from.category;
    for (const k of ["s_name", "s_id", "s_major", "s_school", "s_phone", "s_advisor", "g_name", "g_relation", "g_phone"]) if (from[k] && form[k]) form[k].value = from[k];
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
    if (el.type === "checkbox") el.checked = Array.isArray(v) && v.includes(el.value);
    else if (el.type === "radio") el.checked = v === el.value;
    else if (v !== undefined) el.value = v;
  }
  priorCount = r.priorCount || 0;
  $("#reason-other").hidden = !(r.reasons || []).includes("Other");
  $("#ref-other").hidden = !(r.referrals || []).includes("Other");
  $("#med-block").hidden = !(r.outcomes || []).includes("Medical issues");
  $("#med-other").hidden = r.medicalType !== "Other";
  if (r.audio) showAudio(r.audio, "Saved recording");
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

/* ---- start ---- */
renderList();
