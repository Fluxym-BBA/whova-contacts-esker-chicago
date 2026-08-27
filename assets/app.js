/* =====================================================================
   Fluxym · Stand Esker All Access 2026 — pilotage des invitations Whova
   Front statique (GitHub Pages) + Supabase (auth, donnees, RLS)
   ===================================================================== */
(() => {
"use strict";

const CFG = window.FLUXYM_CONFIG;
const sb  = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const STATUSES = [
  ["A contacter",    "A contacter"],
  ["Message envoye", "Message envoye"],
  ["Repondu",        "Repondu"],
  ["RDV planifie",   "RDV planifie"],
  ["Rencontre",      "Rencontre"],
  ["Sans suite",     "Sans suite"],
];
const NEUTRAL = ["Esker (hote)", "Fluxym (nous)"];

let ME = null, TEAM = [], ROWS = [], TIMER = null;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms);
}
function initials(n) {
  return (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function hue(str) {
  let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 46% 48%)`;
}
const colorOf = name => (TEAM.find(t => t.name === name) || {}).color || "#64748b";

/* ==================== AUTH ==================== */
$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#login-btn"); btn.disabled = true; $("#login-err").textContent = "";
  const { error } = await sb.auth.signInWithPassword({
    email: $("#email").value.trim().toLowerCase(),
    password: $("#password").value,
  });
  btn.disabled = false;
  if (error) $("#login-err").textContent = "Connexion refusee : " + error.message;
});

$("#logout-btn").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
$("#refresh-btn").addEventListener("click", () => load(true));

sb.auth.onAuthStateChange((_e, session) => { if (session) boot(session); });
sb.auth.getSession().then(({ data }) => { if (data.session) boot(data.session); });

async function boot(session) {
  if (ME) return;
  ME = { email: session.user.email, name: null };
  $("#login").hidden = true; $("#app").hidden = false;

  const { data: team, error } = await sb.from("team").select("*").order("sort_order");
  // RLS renvoie un tableau vide (sans erreur) si l'email n'est pas whiteliste
  if (error || !team || team.length === 0) {
    $("#login").hidden = false; $("#app").hidden = true;
    $("#login-err").textContent = "Compte non autorise sur cet evenement.";
    await sb.auth.signOut(); ME = null; return;
  }
  TEAM = team || [];
  const mine = TEAM.find(t => (t.email || "").toLowerCase() === ME.email);
  ME.name = mine ? mine.name : ME.email;
  ME.color = mine ? mine.color : "#64748b";
  $("#me-chip").textContent = ME.name;
  $("#me-chip").style.background = ME.color;

  buildStaticFilters();
  await load();
  TIMER = setInterval(() => load(), 20000);
}

/* ==================== DONNEES ==================== */
async function load(manual) {
  const { data, error } = await sb.from("attendees").select("*").order("last_name");
  if (error) return toast("Erreur de chargement : " + error.message);
  ROWS = data || [];
  buildDynamicFilters();
  render();
  if (manual) toast("Liste actualisee");
}

async function patch(id, payload) {
  const { error } = await sb.from("attendees").update(payload).eq("id", id);
  if (error) { toast("Echec : " + error.message); return false; }
  const r = ROWS.find(x => x.id === id); if (r) Object.assign(r, payload);
  render(); return true;
}

/* ==================== FILTRES ==================== */
const F = { q: "", priority: "", segment: "", job_function: "", seniority: "", owner: "", status: "", company: "", hide: true };

function buildStaticFilters() {
  const os = $("#f-owner");
  TEAM.filter(t => t.active).forEach(t => os.add(new Option(t.name, t.name)));
  const ss = $("#f-status");
  STATUSES.forEach(([v, l]) => ss.add(new Option(l, v)));
}
function fillSel(sel, values, keep) {
  const cur = sel.value;
  [...sel.options].slice(keep).forEach(o => o.remove());
  values.forEach(v => sel.add(new Option(v, v)));
  sel.value = cur;
}
function buildDynamicFilters() {
  const uniq = k => [...new Set(ROWS.map(r => r[k]).filter(Boolean))].sort();
  fillSel($("#f-segment"),   uniq("segment"), 1);
  fillSel($("#f-function"),  uniq("job_function"), 1);
  fillSel($("#f-seniority"), uniq("seniority"), 1);
  fillSel($("#f-company"),   uniq("company"), 1);
}

$("#q").addEventListener("input", e => { F.q = e.target.value.toLowerCase(); render(); });
[["#f-priority","priority"],["#f-segment","segment"],["#f-function","job_function"],
 ["#f-seniority","seniority"],["#f-owner","owner"],["#f-status","status"],["#f-company","company"]]
 .forEach(([sel, key]) => $(sel).addEventListener("change", e => { F[key] = e.target.value; render(); }));
$("#f-hide-esker").addEventListener("change", e => { F.hide = e.target.checked; render(); });
$("#reset-btn").addEventListener("click", () => {
  Object.assign(F, { q:"",priority:"",segment:"",job_function:"",seniority:"",owner:"",status:"",company:"" });
  $("#q").value = "";
  $$(".toolbar select").forEach(s => s.value = "");
  render();
});

function match(r) {
  if (F.hide && NEUTRAL.includes(r.segment)) return false;
  if (F.priority && r.priority !== F.priority) return false;
  if (F.segment && r.segment !== F.segment) return false;
  if (F.job_function && r.job_function !== F.job_function) return false;
  if (F.seniority && r.seniority !== F.seniority) return false;
  if (F.status && r.status !== F.status) return false;
  if (F.company && r.company !== F.company) return false;
  if (F.owner === "__none__" && r.owner) return false;
  if (F.owner && F.owner !== "__none__" && r.owner !== F.owner) return false;
  if (F.q) {
    const hay = [r.full_name, r.company, r.title, r.location, r.notes, r.interest].join(" ").toLowerCase();
    if (!F.q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

/* ==================== RENDU ==================== */
function card(r) {
  const mine = r.owner === ME.name;
  const taken = r.owner && !mine;
  const tags = (r.whova_tags || []);
  const b = [];
  if (r.priority === "A") b.push('<i class="bdg A">Prio A</i>');
  if (r.priority === "B") b.push('<i class="bdg B">Prio B</i>');
  if (tags.includes("Speakers"))  b.push('<i class="bdg spk">Speaker</i>');
  if (tags.includes("Exhibitors"))b.push('<i class="bdg exh">Exposant</i>');
  if (tags.includes("Sponsors"))  b.push('<i class="bdg exh">Sponsor</i>');
  if (tags.includes("Whova Loyal"))b.push('<i class="bdg loyal">Whova+</i>');
  if (r.job_function) b.push(`<i class="bdg">${esc(r.job_function)}</i>`);

  const av = r.photo
    ? `<img class="av" src="${esc(r.photo)}" alt="">`
    : `<div class="av" style="background:${hue(r.full_name)}">${initials(r.full_name)}</div>`;

  return `<article class="card p-${esc(r.priority)} ${mine ? "mine" : ""} ${taken ? "taken" : ""}" data-id="${esc(r.id)}">
    <div class="c-head">
      ${av}
      <div class="c-id">
        <div class="c-name" data-open="${esc(r.id)}">${esc(r.full_name)}</div>
        ${r.title ? `<div class="c-title">${esc(r.title)}</div>` : ""}
        ${r.company ? `<div class="c-comp">${esc(r.company)}</div>` : ""}
        ${r.location ? `<div class="c-loc">${esc(r.location)}</div>` : ""}
      </div>
    </div>
    ${b.length ? `<div class="badges">${b.join("")}</div>` : ""}
    <div class="c-actions">
      ${r.owner
        ? `<span class="owner-tag" style="background:${colorOf(r.owner)}">${esc(r.owner)}</span>`
        : `<span class="bdg">Libre</span>`}
      <select data-status="${esc(r.id)}">
        ${STATUSES.map(([v, l]) => `<option value="${v}" ${r.status === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <button class="take ${mine ? "drop" : ""}" data-take="${esc(r.id)}">
        ${mine ? "Liberer" : taken ? "Reprendre" : "Je prends"}
      </button>
    </div>
  </article>`;
}

function render() {
  const list = ROWS.filter(match);
  $("#grid").innerHTML = list.map(card).join("");
  $("#empty").hidden = list.length > 0;
  $("#result-count").textContent = `${list.length} participant${list.length > 1 ? "s" : ""}`;

  const mine = ROWS.filter(r => r.owner === ME.name);
  $("#grid-mine").innerHTML = mine.map(card).join("");
  $("#empty-mine").hidden = mine.length > 0;
  $("#mine-count").textContent = mine.length;

  renderKpis(); renderTeam();
}

function renderKpis() {
  const t = ROWS.filter(r => !NEUTRAL.includes(r.segment));
  const k = [
    ["Cibles", t.length],
    ["Priorite A", t.filter(r => r.priority === "A").length],
    ["Attribuees", t.filter(r => r.owner).length],
    ["Non attribuees", t.filter(r => !r.owner).length],
    ["Contactees", t.filter(r => r.status !== "A contacter").length],
    ["RDV / rencontres", t.filter(r => ["RDV planifie", "Rencontre"].includes(r.status)).length],
  ];
  $("#kpis").innerHTML = k.map(([l, v]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");
}

function renderTeam() {
  const total = ROWS.filter(r => !NEUTRAL.includes(r.segment)).length || 1;
  const unassigned = ROWS.filter(r => !r.owner && !NEUTRAL.includes(r.segment)).length;
  const blocks = TEAM.filter(t => t.active).map(t => {
    const p = ROWS.filter(r => r.owner === t.name);
    const done = p.filter(r => r.status !== "A contacter").length;
    const rdv  = p.filter(r => ["RDV planifie", "Rencontre"].includes(r.status)).length;
    const pct  = p.length ? Math.round(done / p.length * 100) : 0;
    return `<div class="tm">
      <div class="tm-h">
        <span class="tm-dot" style="background:${t.color}"></span>
        <div><div class="tm-n">${esc(t.name)}</div><div class="tm-r">${esc(t.role || "")}</div></div>
        <div class="tm-stats">
          <div><b>${p.length}</b>portefeuille</div>
          <div><b>${done}</b>contactes</div>
          <div><b>${rdv}</b>RDV</div>
        </div>
      </div>
      <div class="bar"><i style="width:${pct}%;background:${t.color}"></i></div>
    </div>`;
  }).join("");
  $("#team-board").innerHTML =
    `<div class="tm"><div class="tm-h"><span class="tm-dot" style="background:#cbd5e1"></span>
      <div><div class="tm-n">Non attribuees</div><div class="tm-r">a se repartir</div></div>
      <div class="tm-stats"><div><b>${unassigned}</b>sur ${total}</div></div></div>
      <div class="bar"><i style="width:${Math.round(unassigned / total * 100)}%;background:#cbd5e1"></i></div></div>`
    + blocks;
}

/* ==================== INTERACTIONS ==================== */
document.addEventListener("click", async e => {
  const take = e.target.closest("[data-take]");
  if (take) {
    const r = ROWS.find(x => x.id === take.dataset.take);
    if (r.owner === ME.name) { await patch(r.id, { owner: null }); return toast(`${r.full_name} libere`); }
    if (r.owner && !confirm(`${r.full_name} est deja suivi par ${r.owner}.\n\nReprendre ce contact ?`)) return;
    if (await patch(r.id, { owner: ME.name })) toast(`${r.full_name} ajoute a ton portefeuille`);
    return;
  }
  const open = e.target.closest("[data-open]");
  if (open) return drawer(open.dataset.open);
  if (e.target.id === "drawer-back" || e.target.classList.contains("d-close")) return closeDrawer();
});

document.addEventListener("change", async e => {
  const st = e.target.closest("[data-status]");
  if (st) {
    const id = st.dataset.status, v = st.value;
    const payload = { status: v };
    if (v !== "A contacter" && !ROWS.find(r => r.id === id).contacted_at) payload.contacted_at = new Date().toISOString();
    await patch(id, payload); toast("Statut mis a jour");
  }
});

/* ==================== FICHE (drawer) ==================== */
function messageTemplate(r) {
  const first = (r.first_name || r.full_name).split(" ")[0];
  return `Bonjour ${first},

Je suis ${ME.name.split(" ")[0]} chez Fluxym, integrateur et partenaire Esker.
Nous sommes presents sur notre stand pendant All Access.

J'aimerais beaucoup echanger quelques minutes avec vous : comment utilisez-vous Esker aujourd'hui chez ${r.company || "vous"}, et quels sont vos enjeux sur ${r.job_function === "AP / P2P" ? "le cycle achats / comptes fournisseurs" : r.job_function === "AR / O2C / Credit" ? "le cycle O2C et le recouvrement" : "vos processus finance"} ?

On vous montre concretement comment nous menons nos projets, et on repond a vos questions autour d'un cafe.

Passez nous voir quand vous voulez, ou dites-moi un creneau qui vous arrange.

A tres vite,
${ME.name} - Fluxym`;
}

function drawer(id) {
  const r = ROWS.find(x => x.id === id); if (!r) return;
  $("#drawer-back").hidden = false;
  const d = $("#drawer"); d.hidden = false;
  d.innerHTML = `
    <button class="d-close">&times;</button>
    <h2>${esc(r.full_name)}</h2>
    <div class="d-sub">${esc(r.title || "")}${r.company ? " · <b>" + esc(r.company) + "</b>" : ""}</div>
    <div class="badges" style="margin-bottom:16px">
      ${r.priority ? `<i class="bdg ${esc(r.priority)}">Priorite ${esc(r.priority)}</i>` : ""}
      ${r.segment ? `<i class="bdg">${esc(r.segment)}</i>` : ""}
      ${r.seniority ? `<i class="bdg">${esc(r.seniority)}</i>` : ""}
      ${(r.whova_tags || []).map(t => `<i class="bdg loyal">${esc(t)}</i>`).join("")}
    </div>

    <div class="fld"><label>Responsable Fluxym</label>
      <select id="d-owner">
        <option value="">— non attribue —</option>
        ${TEAM.filter(t => t.active).map(t => `<option value="${esc(t.name)}" ${r.owner === t.name ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
      </select></div>

    <div class="fld"><label>Statut</label>
      <select id="d-status">${STATUSES.map(([v, l]) => `<option value="${v}" ${r.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>

    <div class="fld"><label>Creneau / RDV sur le stand</label>
      <input id="d-slot" value="${esc(r.meeting_slot || "")}" placeholder="ex : mardi 14h30"></div>

    <div class="fld"><label>Interet / usage Esker</label>
      <textarea id="d-interest" placeholder="Client Esker ? Quels modules ? Pourquoi est-il present ?">${esc(r.interest || "")}</textarea></div>

    <div class="fld"><label>Notes</label>
      <textarea id="d-notes">${esc(r.notes || "")}</textarea></div>

    <button class="d-save" id="d-save">Enregistrer</button>

    <div class="fld" style="margin-top:22px">
      <label>Message Whova pret a envoyer</label>
      <div class="msg-box" id="d-msg">${esc(messageTemplate(r))}</div>
      <button class="copy" id="d-copy">Copier le message</button>
    </div>

    <div class="d-meta">
      Fiche ${esc(r.id)} · page Whova ${esc(r.page_whova)}<br>
      ${r.updated_by ? "Derniere modif : " + esc(r.updated_by) + " le " + new Date(r.updated_at).toLocaleString("fr-FR") : "Jamais modifiee"}
    </div>`;

  $("#d-copy").onclick = () => {
    navigator.clipboard.writeText($("#d-msg").textContent).then(() => toast("Message copie"));
  };
  $("#d-save").onclick = async () => {
    const p = {
      owner: $("#d-owner").value || null,
      status: $("#d-status").value,
      meeting_slot: $("#d-slot").value || null,
      interest: $("#d-interest").value || null,
      notes: $("#d-notes").value || null,
    };
    if (p.status !== "A contacter" && !r.contacted_at) p.contacted_at = new Date().toISOString();
    if (await patch(r.id, p)) { toast("Fiche enregistree"); closeDrawer(); }
  };
}
function closeDrawer() { $("#drawer").hidden = true; $("#drawer-back").hidden = true; }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

/* ==================== ONGLETS ==================== */
$$(".tab").forEach(t => t.addEventListener("click", async () => {
  $$(".tab").forEach(x => x.classList.remove("active")); t.classList.add("active");
  $$(".view").forEach(v => v.hidden = true);
  $("#view-" + t.dataset.view).hidden = false;
  if (t.dataset.view === "log") renderLog();
}));

async function renderLog() {
  const { data } = await sb.from("activity_log").select("*").order("created_at", { ascending: false }).limit(120);
  $("#log-list").innerHTML = (data || []).map(l => {
    const d = l.detail || {};
    const what = l.action === "assign"
      ? (d.to ? `a pris <b>${esc(l.attendee_name)}</b>` : `a libere <b>${esc(l.attendee_name)}</b>`)
      : `<b>${esc(l.attendee_name)}</b> → ${esc(d.to)}`;
    return `<div class="logrow"><span>${esc(l.actor || "?")}</span><span>${what}</span>
      <time>${new Date(l.created_at).toLocaleString("fr-FR")}</time></div>`;
  }).join("") || '<div class="empty">Aucune activite pour le moment.</div>';
}

/* ==================== EXPORT ==================== */
$("#export-btn").addEventListener("click", () => {
  const cols = ["id","full_name","title","company","location","segment","job_function","seniority","priority","owner","status","meeting_slot","interest","notes"];
  const rows = ROWS.filter(match);
  const csv = [cols.join(";")].concat(rows.map(r =>
    cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";"))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `esker-all-access-2026-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});

})();
