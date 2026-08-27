/* --------------------------------------------------------------------------
   Annuaire des participants : filtrage, attribution, suivi.
   -------------------------------------------------------------------------- */
(async () => {
  const { me, team } = await FX.requireSession();
  renderNav("index.html");

  const STATUSES = ["A contacter", "Message envoye", "Repondu", "RDV planifie", "Rencontre", "Sans suite"];
  const LABEL = { "A contacter":"À contacter", "Message envoye":"Message envoyé", "Repondu":"Répondu",
                  "RDV planifie":"RDV planifié", "Rencontre":"Rencontré", "Sans suite":"Sans suite" };
  const NEUTRAL = ["Esker (hote)", "Fluxym (nous)"];
  const { $, $$, esc, toast } = FX;

  let ROWS = [];
  const colorOf = n => (team.find(t => t.name === n) || {}).color || "#64748b";

  /* ---------------- Donnees ---------------- */
  async function load(manual) {
    const { data, error } = await FX.sb.from("attendees").select("*").order("last_name");
    if (error) return toast("Erreur de chargement : " + error.message, "bad");
    ROWS = data || [];
    buildFilters(); render();
    if (manual) toast("Liste actualisée", "ok");
  }
  async function patch(id, payload) {
    const { error } = await FX.sb.from("attendees").update(payload).eq("id", id);
    if (error) { toast("Échec : " + error.message, "bad"); return false; }
    Object.assign(ROWS.find(r => r.id === id) || {}, payload);
    render(); return true;
  }

  /* ---------------- Filtres ---------------- */
  const F = { q:"", priority:"", segment:"", job_function:"", seniority:"", owner:"", status:"", company:"", hide:true };

  team.filter(t => t.active).forEach(t => $("#f-owner").add(new Option(t.name, t.name)));
  STATUSES.forEach(s => $("#f-status").add(new Option(LABEL[s], s)));

  function buildFilters() {
    const fill = (sel, vals) => {
      const cur = sel.value;
      [...sel.options].slice(1).forEach(o => o.remove());
      vals.forEach(v => sel.add(new Option(v, v)));
      sel.value = cur;
    };
    const uniq = k => [...new Set(ROWS.map(r => r[k]).filter(Boolean))].sort();
    fill($("#f-segment"), uniq("segment"));
    fill($("#f-function"), uniq("job_function"));
    fill($("#f-seniority"), uniq("seniority"));
    fill($("#f-company"), uniq("company"));
  }

  $("#q").oninput = e => { F.q = e.target.value.toLowerCase(); render(); };
  [["#f-priority","priority"],["#f-segment","segment"],["#f-function","job_function"],
   ["#f-seniority","seniority"],["#f-owner","owner"],["#f-status","status"],["#f-company","company"]]
   .forEach(([s,k]) => $(s).onchange = e => { F[k] = e.target.value; render(); });
  $("#f-hide").onchange = e => { F.hide = e.target.checked; render(); };
  $("#reset-btn").onclick = () => {
    Object.assign(F, { q:"",priority:"",segment:"",job_function:"",seniority:"",owner:"",status:"",company:"" });
    $("#q").value = ""; $$(".toolbar select").forEach(s => s.value = ""); render();
  };
  $("#refresh-btn").onclick = () => load(true);

  function match(r) {
    if (F.hide && NEUTRAL.includes(r.segment)) return false;
    for (const k of ["priority","segment","job_function","seniority","status","company"])
      if (F[k] && r[k] !== F[k]) return false;
    if (F.owner === "__none__" && r.owner) return false;
    if (F.owner && F.owner !== "__none__" && r.owner !== F.owner) return false;
    if (F.q) {
      const hay = [r.full_name,r.company,r.title,r.location,r.notes,r.interest].join(" ").toLowerCase();
      if (!F.q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  /* ---------------- Rendu ---------------- */
  function card(r) {
    const mine = r.owner === me.name, taken = r.owner && !mine;
    const tg = r.whova_tags || [], b = [];
    if (r.priority === "A") b.push('<i class="bdg A">Prio A</i>');
    if (r.priority === "B") b.push('<i class="bdg B">Prio B</i>');
    if (tg.includes("Speakers"))    b.push('<i class="bdg spk">Speaker</i>');
    if (tg.includes("Exhibitors"))  b.push('<i class="bdg exh">Exposant</i>');
    if (tg.includes("Sponsors"))    b.push('<i class="bdg exh">Sponsor</i>');
    if (tg.includes("Whova Loyal")) b.push('<i class="bdg loyal">Whova+</i>');
    if (r.job_function) b.push(`<i class="bdg">${esc(r.job_function)}</i>`);

    const av = r.photo ? `<img class="av" src="${esc(r.photo)}" alt="">`
      : `<div class="av" style="background:${FX.hue(r.full_name)}">${FX.initials(r.full_name)}</div>`;

    return `<article class="card p-${esc(r.priority)} ${mine?"mine":""} ${taken?"taken":""}">
      <div class="c-head">${av}
        <div class="c-id">
          <div class="c-name" data-open="${esc(r.id)}">${esc(r.full_name)}</div>
          ${r.title   ? `<div class="c-title">${esc(r.title)}</div>` : ""}
          ${r.company ? `<div class="c-comp">${esc(r.company)}</div>` : ""}
          ${r.location? `<div class="c-loc">${esc(r.location)}</div>` : ""}
        </div></div>
      ${b.length ? `<div class="badges">${b.join("")}</div>` : ""}
      <div class="c-actions">
        ${r.owner ? `<span class="owner-tag" style="background:${colorOf(r.owner)}">${esc(r.owner)}</span>`
                  : `<span class="bdg">Libre</span>`}
        <select data-status="${esc(r.id)}">
          ${STATUSES.map(s => `<option value="${s}" ${r.status===s?"selected":""}>${LABEL[s]}</option>`).join("")}
        </select>
        <button class="take ${mine?"drop":""}" data-take="${esc(r.id)}">
          ${mine ? "Libérer" : taken ? "Reprendre" : "Je prends"}</button>
      </div></article>`;
  }

  function render() {
    const list = ROWS.filter(match);
    $("#grid").innerHTML = list.map(card).join("");
    $("#empty").hidden = list.length > 0;
    $("#count").textContent = `${list.length} participant${list.length>1?"s":""}`;

    const mine = ROWS.filter(r => r.owner === me.name);
    $("#grid-mine").innerHTML = mine.map(card).join("");
    $("#empty-mine").hidden = mine.length > 0;
    $("#mine-count").textContent = mine.length;

    const t = ROWS.filter(r => !NEUTRAL.includes(r.segment));
    $("#kpis").innerHTML = [
      ["Cibles", t.length],
      ["Priorité A", t.filter(r => r.priority === "A").length],
      ["Attribuées", t.filter(r => r.owner).length],
      ["Non attribuées", t.filter(r => !r.owner).length],
      ["Contactées", t.filter(r => r.status !== "A contacter").length],
      ["RDV / rencontres", t.filter(r => ["RDV planifie","Rencontre"].includes(r.status)).length]
    ].map(([l,v]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");

    const total = t.length || 1, free = t.filter(r => !r.owner).length;
    $("#team-board").innerHTML =
      `<div class="tm"><div class="tm-h"><span class="tm-dot" style="background:#cbd5e1"></span>
        <div><div class="tm-n">Non attribuées</div><div class="tm-r">à se répartir</div></div>
        <div class="tm-stats"><div><b>${free}</b>sur ${total}</div></div></div>
        <div class="bar"><i style="width:${Math.round(free/total*100)}%;background:#cbd5e1"></i></div></div>`
      + team.filter(x => x.active).map(x => {
          const p = ROWS.filter(r => r.owner === x.name);
          const done = p.filter(r => r.status !== "A contacter").length;
          const rdv  = p.filter(r => ["RDV planifie","Rencontre"].includes(r.status)).length;
          return `<div class="tm"><div class="tm-h">
            <span class="tm-dot" style="background:${x.color}"></span>
            <div><div class="tm-n">${esc(x.name)}</div><div class="tm-r">${esc(x.role||"")}</div></div>
            <div class="tm-stats"><div><b>${p.length}</b>portefeuille</div>
              <div><b>${done}</b>contactés</div><div><b>${rdv}</b>RDV</div></div></div>
            <div class="bar"><i style="width:${p.length?Math.round(done/p.length*100):0}%;background:${x.color}"></i></div></div>`;
        }).join("");
  }

  /* ---------------- Interactions ---------------- */
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-take]");
    if (t) {
      const r = ROWS.find(x => x.id === t.dataset.take);
      if (r.owner === me.name) { await patch(r.id, { owner:null }); return toast(`${r.full_name} libéré`); }
      if (r.owner && !confirm(`${r.full_name} est déjà suivi par ${r.owner}.\n\nReprendre ce contact ?`)) return;
      if (await patch(r.id, { owner: me.name })) toast(`${r.full_name} ajouté à votre portefeuille`, "ok");
      return;
    }
    const o = e.target.closest("[data-open]"); if (o) return drawer(o.dataset.open);
    if (e.target.id === "drawer-back" || e.target.classList.contains("x")) closeDrawer();
  });

  document.addEventListener("change", async e => {
    const s = e.target.closest("[data-status]"); if (!s) return;
    const r = ROWS.find(x => x.id === s.dataset.status);
    const p = { status: s.value };
    if (s.value !== "A contacter" && !r.contacted_at) p.contacted_at = new Date().toISOString();
    if (await patch(r.id, p)) toast("Statut mis à jour");
  });

  /* ---------------- Fiche ---------------- */
  function template(r) {
    const first = (r.first_name || r.full_name).split(" ")[0];
    const angle = r.job_function === "AP / P2P" ? "le cycle achats et comptes fournisseurs"
                : r.job_function === "AR / O2C / Credit" ? "le cycle O2C et le recouvrement"
                : "vos processus finance";
    return `Bonjour ${first},

Je suis ${me.name.split(" ")[0]} chez Fluxym, intégrateur et partenaire Esker. Nous tenons un stand pendant All Access.

J'aimerais échanger quelques minutes avec vous : comment utilisez-vous Esker aujourd'hui chez ${r.company || "vous"}, et quels sont vos enjeux sur ${angle} ?

Nous vous montrons concrètement comment nous menons nos projets, et nous répondons à vos questions.

Passez nous voir quand vous voulez, ou indiquez-moi un créneau qui vous arrange.

À très vite,
${me.name} — Fluxym`;
  }

  function drawer(id) {
    const r = ROWS.find(x => x.id === id); if (!r) return;
    FX.$("#drawer-back").hidden = false;
    const d = FX.$("#drawer"); d.hidden = false;
    d.innerHTML = `<button class="x">&times;</button>
      <h2>${esc(r.full_name)}</h2>
      <div class="d-sub">${esc(r.title||"")}${r.company?" · <b>"+esc(r.company)+"</b>":""}</div>
      <div class="badges" style="margin-bottom:16px">
        ${r.priority?`<i class="bdg ${esc(r.priority)}">Priorité ${esc(r.priority)}</i>`:""}
        ${r.segment?`<i class="bdg">${esc(r.segment)}</i>`:""}
        ${r.seniority?`<i class="bdg">${esc(r.seniority)}</i>`:""}
        ${(r.whova_tags||[]).map(t=>`<i class="bdg loyal">${esc(t)}</i>`).join("")}
      </div>
      <div class="fld"><label>Responsable Fluxym</label><select id="d-owner">
        <option value="">— non attribué —</option>
        ${team.filter(t=>t.active).map(t=>`<option value="${esc(t.name)}" ${r.owner===t.name?"selected":""}>${esc(t.name)}</option>`).join("")}
      </select></div>
      <div class="fld"><label>Statut</label><select id="d-status">
        ${STATUSES.map(s=>`<option value="${s}" ${r.status===s?"selected":""}>${LABEL[s]}</option>`).join("")}
      </select></div>
      <div class="fld"><label>Créneau / RDV sur le stand</label>
        <input id="d-slot" value="${esc(r.meeting_slot||"")}" placeholder="ex : mardi 14h30"></div>
      <div class="fld"><label>Intérêt / usage Esker</label>
        <textarea id="d-interest" placeholder="Client Esker ? Quels modules ? Pourquoi est-il présent ?">${esc(r.interest||"")}</textarea></div>
      <div class="fld"><label>Notes</label><textarea id="d-notes">${esc(r.notes||"")}</textarea></div>
      <button class="d-save" id="d-save">Enregistrer</button>
      <div class="fld" style="margin-top:22px"><label>Message Whova prêt à envoyer</label>
        <div class="msg-box" id="d-msg">${esc(template(r))}</div>
        <button class="mini" id="d-copy">Copier le message</button></div>
      <div class="d-meta">Fiche ${esc(r.id)} · page Whova ${esc(r.page_whova)}<br>
        ${r.updated_by ? "Dernière modification : "+esc(r.updated_by)+" le "+FX.fmtDate(r.updated_at) : "Jamais modifiée"}</div>`;

    FX.$("#d-copy").onclick = () => navigator.clipboard.writeText(FX.$("#d-msg").textContent)
      .then(() => toast("Message copié", "ok"));
    FX.$("#d-save").onclick = async () => {
      const p = { owner: FX.$("#d-owner").value || null, status: FX.$("#d-status").value,
                  meeting_slot: FX.$("#d-slot").value || null,
                  interest: FX.$("#d-interest").value || null, notes: FX.$("#d-notes").value || null };
      if (p.status !== "A contacter" && !r.contacted_at) p.contacted_at = new Date().toISOString();
      if (await patch(r.id, p)) { toast("Fiche enregistrée", "ok"); closeDrawer(); }
    };
  }
  const closeDrawer = () => { FX.$("#drawer").hidden = true; FX.$("#drawer-back").hidden = true; };
  document.addEventListener("keydown", e => e.key === "Escape" && closeDrawer());

  /* ---------------- Onglets & journal ---------------- */
  $$(".tab").forEach(t => t.onclick = async () => {
    $$(".tab").forEach(x => x.classList.remove("on")); t.classList.add("on");
    $$(".view").forEach(v => v.hidden = true);
    $("#view-" + t.dataset.view).hidden = false;
    if (t.dataset.view === "log") {
      const { data } = await FX.sb.from("activity_log").select("*")
        .order("created_at", { ascending:false }).limit(150);
      $("#log-list").innerHTML = (data||[]).map(l => {
        const d = l.detail || {};
        const what = l.action === "assign"
          ? (d.to ? `a pris <b>${esc(l.attendee_name)}</b>` : `a libéré <b>${esc(l.attendee_name)}</b>`)
          : `<b>${esc(l.attendee_name)}</b> → ${esc(LABEL[d.to] || d.to)}`;
        return `<div class="logrow"><span>${esc(l.actor||"?")}</span><span>${what}</span>
          <time>${FX.fmtDate(l.created_at)}</time></div>`;
      }).join("") || '<div class="empty">Aucune activité pour le moment.</div>';
    }
  });

  $("#export-btn").onclick = () => {
    const cols = ["id","full_name","title","company","location","segment","job_function",
                  "seniority","priority","owner","status","meeting_slot","interest","notes"];
    const csv = [cols.join(";")].concat(ROWS.filter(match).map(r =>
      cols.map(c => `"${String(r[c] ?? "").replace(/"/g,'""')}"`).join(";"))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8" }));
    a.download = `esker-all-access-2026-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  await load();
  setInterval(load, 20000);
})();
