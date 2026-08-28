/* --------------------------------------------------------------------------
   Annuaire des participants : filtrage, attribution, suivi.
   -------------------------------------------------------------------------- */
(async () => {
  const { me, team } = await FX.requireSession();
  renderNav("index.html");

  const STATUSES = ["A contacter", "Message envoye", "Repondu", "RDV planifie", "Rencontre", "Sans suite"];
  const LABEL = { "A contacter":"À contacter", "Message envoye":"Message envoyé", "Repondu":"Répondu",
                  "RDV planifie":"RDV planifié", "Rencontre":"Rencontré", "Sans suite":"Sans suite" };
  const SEG_FLUXYM = "Fluxym (nous)", SEG_ESKER = "Esker (hote)";
  const { $, $$, esc, toast } = FX;

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  /* Initiale de classement : le nom de famille, sans accent ni particule
     typographique. Tout ce qui n'est pas une lettre tombe dans "#". */
  function initialOf(r) {
    const base = (r.last_name || r.full_name || "").trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/^["'`(\[]+/, "");
    const c = (base[0] || "").toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  const sortKey = r => (initialOf(r) === "#" ? "zzz" : "") +
    [r.last_name, r.first_name, r.full_name].filter(Boolean).join(" ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  /* Regroupe les cartes par initiale et intercale un intertitre pleine
     largeur. Seules les lettres presentes dans la liste filtree sortent. */
  function groupsOf(list) {
    const by = new Map();
    [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .forEach(r => {
        const k = initialOf(r);
        (by.get(k) || by.set(k, []).get(k)).push(r);
      });
    return by;
  }
  function gridHtml(list, prefix) {
    let out = "";
    for (const [letter, rows] of groupsOf(list)) {
      out += `<h3 class="alpha" id="${prefix}-${letter === "#" ? "num" : letter}">
        <span class="alpha-l">${letter}</span>
        <span class="alpha-n">${rows.length}</span></h3>` + rows.map(card).join("");
    }
    return out;
  }

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
  /* Fluxym est masque par defaut : ce sont nos propres collegues, aucun interet dans
   l'annuaire. Esker est visible par defaut : les equipes de l'editeur sont des
   interlocuteurs que nous voulons aussi aller voir sur place. */
  const F = { q:"", priority:"", segment:"", job_function:"", seniority:"", owner:"", status:"",
              company:"", hideFluxym:true, hideEsker:false };

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
  $("#f-hide-fluxym").onchange = e => { F.hideFluxym = e.target.checked; render(); };
  $("#f-hide-esker").onchange  = e => { F.hideEsker  = e.target.checked; render(); };
  $("#reset-btn").onclick = () => {
    Object.assign(F, { q:"",priority:"",segment:"",job_function:"",seniority:"",owner:"",status:"",company:"",
                       hideFluxym:true, hideEsker:false });
    $("#q").value = ""; $$(".toolbar select").forEach(s => s.value = "");
    $("#f-hide-fluxym").checked = true; $("#f-hide-esker").checked = false;
    render();
  };
  $("#refresh-btn").onclick = () => load(true);

  function match(r) {
    if (F.hideFluxym && r.segment === SEG_FLUXYM) return false;
    if (F.hideEsker  && r.segment === SEG_ESKER)  return false;
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
    const forced = r.priority_manual ? ' title="Priorité fixée à la main">Prio ' : '>Prio ';
    if (r.priority === "A") b.push(`<i class="bdg A"${forced}A${r.priority_manual?" ✱":""}</i>`);
    if (r.priority === "B") b.push(`<i class="bdg B"${forced}B${r.priority_manual?" ✱":""}</i>`);
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
    const present = new Set([...list].map(initialOf));
    $("#grid").innerHTML = gridHtml(list, "g");
    $("#empty").hidden = list.length > 0;
    $("#count").textContent = `${list.length} participant${list.length>1?"s":""}`;

    /* L'index ne propose que les lettres reellement presentes apres filtrage :
       une lettre cliquable qui ne mene nulle part est un piege. */
    $("#alpha-index").innerHTML = ALPHABET.concat(present.has("#") ? ["#"] : [])
      .map(l => present.has(l)
        ? `<a href="#g-${l === "#" ? "num" : l}" data-jump="${l}">${l}</a>`
        : `<span>${l}</span>`).join("");

    const mine = ROWS.filter(r => r.owner === me.name);
    $("#grid-mine").innerHTML = gridHtml(mine, "m");
    $("#empty-mine").hidden = mine.length > 0;
    $("#mine-count").textContent = mine.length;

    /* Seuls nos propres collegues sortent du perimetre de travail : les equipes
       Esker comptent comme des cibles a part entiere. */
    const t = ROWS.filter(r => r.segment !== SEG_FLUXYM);
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
  /* Messages rediges en anglais : l'evenement se tient a Rosemont et les
     participants sont americains pour la quasi-totalite. L'interface reste en
     francais, c'est notre outil interne ; seul ce qui part vers le contact
     change de langue.

     Un message unique ne tenait pas : il demandait a un salarie d'Esker
     comment il utilisait Esker, et a un prospect qui n'a jamais rien signe
     comment il l'utilisait aujourd'hui. Quatre familles de destinataires,
     quatre messages. La famille est deduite du segment, elle n'est jamais
     saisie a la main, et un collegue Fluxym n'a pas de message du tout. */
  const MSG_KIND  = { "Client / Prospect":"client", [SEG_ESKER]:"esker",
                      "Ecosysteme (exposant/sponsor)":"partenaire", "Analyste / Presse":"presse" };
  const MSG_LABEL = { client:"client ou prospect", esker:"équipe Esker",
                      partenaire:"exposant ou partenaire", presse:"analyste ou presse" };
  const msgKind = r => MSG_KIND[r.segment] || null;

  function template(r) {
    const first   = (r.first_name || r.full_name || "").split(" ")[0];
    const mine    = me.name.split(" ")[0];
    const company = r.company || "your company";
    /* Un speaker a une accroche gratuite et imbattable : sa session. 48 des 56
       salaries Esker et 12 clients portent ce tag. */
    const session = (r.whova_tags || []).includes("Speakers")
      ? "I saw you're speaking at All Access, I'll do my best to catch your session.\n\n" : "";
    const kind = msgKind(r);

    /* Salarie d'Esker : on ne lui demande pas comment il utilise son propre
       produit. On vient chercher les comptes qu'il couvre et ce qu'il attend
       d'un integrateur. */
    if (kind === "esker") return `Hi ${first},

I'm ${mine} from Fluxym. We're an Esker partner and integrator: we deploy and run Esker for our own customers, mainly in France and Canada. We have a booth at All Access.

${session}I won't ask you how you use Esker, you build it. What I'd like is to put faces to names: which accounts you cover, what you expect from an integrator like us, and where we could be useful to you on a deal or a deployment.

Come by the booth whenever you have ten minutes between two sessions, the coffee is on us.

See you there,
${me.name} — Fluxym`;

    /* Exposant ou sponsor : integrateur concurrent, editeur complementaire ou
       prestataire de paiement. Registre entre pairs, aucun pitch. */
    if (kind === "partenaire") return `Hi ${first},

I'm ${mine} from Fluxym. We integrate Esker for finance teams, mainly in France and Canada, and we're on the exhibitor floor at All Access as well.

${session}Rather than politely ignoring each other between two booths: our territories barely overlap, and we regularly run into needs that sit outside our own scope, either geographically or functionally. That usually makes for a useful conversation between people who live in the same ecosystem.

I'll drop by ${company === "your company" ? "your booth" : "the " + company + " booth"} during a quiet moment. If you'd rather fix a time, tell me when.

Talk soon,
${me.name} — Fluxym`;

    /* Analyste ou presse : on propose une lecture du marche, pas une solution. */
    if (kind === "presse") return `Hi ${first},

I'm ${mine} from Fluxym. We deploy Esker for finance teams in Europe and North America, and we're exhibiting at All Access.

${session}If it's useful to you, I'm happy to give you the integrator's view: what actually gets deployed versus what gets announced, what customers ask for versus what they end up using, and how Europe and North America differ on AP and AR automation. No pitch, field data.

Fifteen minutes at the booth or between two sessions, whenever suits you.

Best,
${me.name} — Fluxym`;

    /* Client ou prospect. On ne presume jamais qu'il est deja client Esker :
       le segment ne le dit pas et le tag "Whova Loyal" ne parle que de fidelite
       a Whova. D'ou "already part of the answer or something you're still
       weighing up", qui marche dans les deux cas. */
    const angle = r.job_function === "AP / P2P" ? "accounts payable and procure-to-pay"
                : r.job_function === "AR / O2C / Credit" ? "order-to-cash, credit and collections"
                : r.job_function === "IT / ERP / Data" ? "the ERP and integration side of your finance processes"
                : r.job_function === "Finance / Treasury" ? "your finance and treasury processes"
                : "your finance processes";

    /* Un dirigeant ne lit pas six lignes : creneau borne, et on parle de cible,
       pas d'outil. */
    if (r.seniority === "C-level / VP" || r.seniority === "Director") return `Hi ${first},

I'm ${mine} from Fluxym, an Esker integrator and partner with a booth at All Access.

${session}Would you have twenty minutes for ${angle} at ${company}? I'm not after a demo slot: I'm interested in where you want that process to be in eighteen months, and in what usually gets in the way. We run these projects for a living, in Europe and North America.

Tell me a time that works and I'll be there, or stop by the booth.

Talk soon,
${me.name} — Fluxym`;

    return `Hi ${first},

I'm ${mine} from Fluxym, an Esker integrator and partner. We have a booth at All Access.

${session}I'd like a few minutes with you about ${angle} at ${company}: what works today, what still hurts, and whether Esker is already part of the answer or something you're still weighing up.

We'll tell you how these projects actually run, the deadlines and the traps included, and answer whatever you want to ask.

Stop by the booth whenever suits you, or let me know a time that works for you.

Talk soon,
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
      <div class="fld prio-box">
        <label>Priorité de contact</label>
        <div class="prio-row">
          <select id="d-priority">
            <option value="A" ${r.priority==="A"?"selected":""}>A — à voir absolument</option>
            <option value="B" ${r.priority==="B"?"selected":""}>B — à voir si possible</option>
            <option value="C" ${r.priority==="C"?"selected":""}>C — opportuniste</option>
            <option value="" ${!r.priority?"selected":""}>— hors périmètre —</option>
          </select>
          ${r.priority_manual
            ? `<button class="mini" id="d-prio-reset">Revenir à la suggestion (${esc(r.priority_auto||"—")})</button>`
            : `<span class="prio-tag">suggestion appliquée</span>`}
        </div>
        <p class="prio-why">${esc(r.priority_why || "Aucune explication disponible.")}
          ${r.priority_manual ? `<br><b>Forcée à la main${r.priority_by?" par "+esc(r.priority_by):""}.</b> Suggestion de la formule : ${esc(r.priority_auto||"—")}.` : ""}
          <a href="methode.html">Comment est-ce calculé ?</a></p>
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
      ${msgKind(r) ? `<div class="fld" style="margin-top:22px">
        <label>Message Whova prêt à envoyer (en anglais) · version ${esc(MSG_LABEL[msgKind(r)])}</label>
        <div class="msg-box" id="d-msg">${esc(template(r))}</div>
        <button class="mini" id="d-copy">Copier le message</button></div>`
      : `<div class="fld" style="margin-top:22px"><label>Message Whova</label>
        <p class="prio-why">Collègue Fluxym : rien à envoyer.</p></div>`}
      <div class="d-meta">Fiche ${esc(r.id)} · page Whova ${esc(r.page_whova)}<br>
        ${r.updated_by ? "Dernière modification : "+esc(r.updated_by)+" le "+FX.fmtDate(r.updated_at) : "Jamais modifiée"}</div>`;

    /* Le bloc message est absent pour un collegue Fluxym. */
    const copyBtn = FX.$("#d-copy");
    if (copyBtn) copyBtn.onclick = () => navigator.clipboard.writeText(FX.$("#d-msg").textContent)
      .then(() => toast("Message copié", "ok"));
    /* Revenir a la suggestion : on ne fait pas confiance a la valeur affichee,
       on relit priority_auto, qui n'est jamais ecrasee par un humain. */
    const reset = FX.$("#d-prio-reset");
    if (reset) reset.onclick = async () => {
      if (await patch(r.id, { priority: r.priority_auto, priority_manual: false, priority_by: null })) {
        toast("Priorité rendue à la formule", "ok"); drawer(id);
      }
    };
    FX.$("#d-save").onclick = async () => {
      const p = { owner: FX.$("#d-owner").value || null, status: FX.$("#d-status").value,
                  meeting_slot: FX.$("#d-slot").value || null,
                  interest: FX.$("#d-interest").value || null, notes: FX.$("#d-notes").value || null };
      const np = FX.$("#d-priority").value || null;
      if (np !== r.priority) { p.priority = np; p.priority_manual = true; p.priority_by = me.name; }
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
