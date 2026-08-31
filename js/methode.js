/* --------------------------------------------------------------------------
   Page Methode : explique la priorisation, et l'illustre avec les chiffres
   reels de la base plutot qu'avec des exemples inventes.
   -------------------------------------------------------------------------- */
(async () => {
  await FX.requireSession();
  renderNav("methode.html");
  const { $, esc } = FX;

  const { data, error } = await FX.sb.from("attendees")
    .select("priority, priority_auto, priority_manual, priority_by, full_name, title, company, segment, priority_why, owner, status, funnel_msg_at, funnel_replied_at, funnel_rdv_at, funnel_met_at, contest_at");
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


  /* ------------------------------------------------------------------------
     Le bareme et l'entonnoir, lus en base.
     Ces valeurs sont modifiables par le proprietaire : les ecrire en dur dans
     methode.html en ferait une documentation fausse des le premier reglage.
     C'est la page qu'on ouvre pendant l'evenement, elle doit dire vrai.
     ------------------------------------------------------------------------ */
  const STEPS = [
    ["funnel_msg_at",     "Message envoyé"],
    ["funnel_replied_at", "Réponse obtenue"],
    ["funnel_rdv_at",     "Rendez-vous planifié"],
    ["funnel_met_at",     "Rencontré au stand"]
  ];
  const cibles = rows.filter(r => r.segment !== "Fluxym (nous)");

  $("#bareme-fn").innerHTML = `<div class="kpis">
    <div class="kpi"><b>${cibles.filter(r => r.owner).length}</b><span>Attribués</span></div>
    ${STEPS.map(([c, l]) => `<div class="kpi"><b>${cibles.filter(r => r[c]).length}</b><span>${l}</span></div>`).join("")}
    </div>`;

  const sr = await FX.sb.from("score_rules").select("key,label,points,sort_order").order("sort_order");
  const ss = await FX.sb.from("score_settings").select("fx2,fx3").limit(1);

  if (sr.error || !sr.data || !sr.data.length) {
    $("#bareme-tbl").innerHTML = `<p class="mut">Barème indisponible hors réseau.
      Il est lu dans la table <b>score_rules</b> et non recopié ici, pour qu'il
      ne puisse pas être faux.</p>`;
  } else {
    const fx2 = ss.data && ss.data[0] ? ss.data[0].fx2 : 5;
    const fx3 = ss.data && ss.data[0] ? ss.data[0].fx3 : 16;
    const pal = p => p >= fx3 ? "confettis" : p >= fx2 ? "halo" : "discret";
    $("#bareme-tbl").innerHTML = `<table class="tbl">
      <tr><th>Ce qui rapporte</th><th>Points</th><th>Célébration</th></tr>
      <tr><td>Prendre un contact</td><td><b>0</b></td><td class="mut">aucune</td></tr>
      ${sr.data.map(r => `<tr><td>${esc(r.label)}</td><td><b>${r.points}</b></td>
        <td class="mut">${pal(r.points)}</td></tr>`).join("")}
      </table>
      <p class="mut">Seuils actuels : ${fx2} points pour le halo, ${fx3} pour les
      confettis. Barème et seuils sont modifiables par le propriétaire de
      l'application, et ces valeurs sont celles réellement appliquées.${
        FX.me && FX.me.is_owner
          ? ` <a href="./bareme.html" class="lnk">Régler le barème</a>, avec le
              classement recalculé avant enregistrement.`
          : ""}</p>`;
  }

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
