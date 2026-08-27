/* --------------------------------------------------------------------------
   Page Methode : explique la priorisation, et l'illustre avec les chiffres
   reels de la base plutot qu'avec des exemples inventes.
   -------------------------------------------------------------------------- */
(async () => {
  await FX.requireSession();
  renderNav("methode.html");
  const { $, esc } = FX;

  const { data, error } = await FX.sb.from("attendees")
    .select("priority, priority_auto, priority_manual, priority_by, full_name, title, company, segment, priority_why");
  if (error) return FX.toast("Erreur de chargement : " + error.message, "bad");

  const rows = data || [];
  const n = p => rows.filter(r => r.priority === p).length;
  $("#prio-kpis").innerHTML = [
    ["Participants", rows.length],
    ["Priorité A", n("A")],
    ["Priorité B", n("B")],
    ["Priorité C", n("C")],
    ["Corrigées à la main", rows.filter(r => r.priority_manual).length]
  ].map(([l, v]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");

  /* Comptes clients ou prospects a 4 personnes et plus : ceux qui declenchent
     le bonus, donc ceux qu'il faut se repartir en premier. */
  const by = new Map();
  rows.filter(r => r.segment === "Client / Prospect" && r.company)
      .forEach(r => by.set(r.company, (by.get(r.company) || 0) + 1));
  const grp = [...by.entries()].filter(([, c]) => c >= 4).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("#prio-groupes").innerHTML = grp.length
    ? `<p class="lead2">${grp.length} sociétés concernées, ${grp.reduce((s, [, c]) => s + c, 0)} personnes :</p>
       <div class="chips">${grp.map(([c, k]) => `<span class="chip"><b>${k}</b> ${esc(c)}</span>`).join("")}</div>`
    : "<p>Aucune société n'atteint 4 inscrits.</p>";

  const man = rows.filter(r => r.priority_manual)
    .sort((a, b) => (a.company || "").localeCompare(b.company || ""));
  $("#prio-manuelles").innerHTML = man.length
    ? `<table class="tbl"><tr><th>Participant</th><th>Société</th><th>Formule</th><th>Retenu</th><th>Par</th></tr>
       ${man.map(r => `<tr><td>${esc(r.full_name)}<br><span class="mut">${esc(r.title || "")}</span></td>
         <td>${esc(r.company || "")}</td><td>${esc(r.priority_auto || "—")}</td>
         <td><b>${esc(r.priority || "—")}</b></td><td>${esc(r.priority_by || "")}</td></tr>`).join("")}</table>`
    : `<p class="mut">Personne n'a encore corrigé de priorité. C'est normal avant
       l'événement, et ça le sera moins après : si vous découvrez qu'un contact
       classé C est en réalité stratégique, corrigez-le, tout le monde le verra.</p>`;
})();
