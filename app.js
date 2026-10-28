// LFE Office app — loads its content from the files in the data/ folder.
// To update the site, edit those files on GitHub; no code changes needed.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- tabs ---------- */
const tabs = document.querySelectorAll(".tabs button");
function showTab(name) {
  tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== name));
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
}
tabs.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
const startTab = location.hash.slice(1);
if (["officials", "groups"].includes(startTab)) showTab(startTab);

/* ---------- officials ---------- */
let officials = [];
function initials(name) {
  return name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function renderOfficials(filter = "") {
  const q = filter.trim().toLowerCase();
  const list = officials.filter((o) =>
    !q || [o.name, o.role, ...(o.responsibilities || [])].join(" ").toLowerCase().includes(q)
  );
  $("#official-list").innerHTML = list.length
    ? list.map((o) => `
      <article class="card">
        <div class="avatar">${esc(initials(o.name))}</div>
        <h3>${esc(o.name)}</h3>
        <div class="role">${esc(o.role)}</div>
        ${o.responsibilities?.length ? `<ul>${o.responsibilities.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        <div class="contact">
          ${o.email ? `<div><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></div>` : ""}
          ${o.phone ? `<div>${esc(o.phone)}</div>` : ""}
          ${o.office ? `<div>${esc(o.office)}</div>` : ""}
        </div>
      </article>`).join("")
    : `<p class="empty">No one matches “${esc(filter)}”.</p>`;
}
$("#official-search").addEventListener("input", (e) => renderOfficials(e.target.value));

/* ---------- group finder ---------- */
let students = new Map();
let groupInfo = {};

// Small CSV parser that handles quoted fields with commas.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

$("#group-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#student-id").value.replace(/\D/g, "");
  const out = $("#group-result");
  if (!id) return;
  const s = students.get(id);
  if (!s) {
    out.innerHTML = `<div class="result miss"><h3>No record for ID ${esc(id)}</h3>
      Check the number and try again. If it is correct, you may not be enrolled in LFE this semester —
      contact the LFE Office at <a href="mailto:${esc(groupInfo.contact_email || "coordinator.lfe@iub.edu.bd")}">${esc(groupInfo.contact_email || "coordinator.lfe@iub.edu.bd")}</a>.</div>`;
    return;
  }
  const rows = [
    ["Name", s.name],
    ["Section", s.section],
    ["Group", s.group],
    ["Partner campus", s.venue],
    ["Field dates", [s.field_start, s.field_end].filter(Boolean).join(" – ")],
    ["Venue faculty", s.faculty],
  ].filter(([, v]) => v);
  out.innerHTML = `<div class="result"><h3>You're in ${esc(s.section ? "Section " + s.section : "LFE")}${s.group ? ", Group " + esc(s.group) : ""}</h3>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>`;
});

/* ---------- load data ---------- */
async function load(path, asText = false) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(path + " → " + r.status);
  return asText ? r.text() : r.json();
}
(async () => {
  try {
    officials = await load("data/officials.json");
    renderOfficials();
  } catch (e) { $("#official-list").innerHTML = `<p class="empty">Couldn't load officials (${esc(e.message)}).</p>`; }

  try {
    groupInfo = await load("data/groups-info.json");
    $("#semester-note").textContent = groupInfo.note || "";
    const rows = parseCSV(await load("data/groups.csv", true));
    students = new Map(rows.map((r) => [String(r.student_id).replace(/\D/g, ""), r]));
  } catch (e) { $("#group-result").innerHTML = `<div class="result miss">Couldn't load group list (${esc(e.message)}).</div>`; }
})();
