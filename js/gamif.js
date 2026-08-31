/* ==========================================================================
   js/gamif.js - Entonnoir de suivi, score et celebrations
   Stand Esker All Access 2026, Rosemont, 8 au 10 septembre.

   POURQUOI CE FICHIER EXISTE A PART
   L'onglet « Mon portefeuille » listait les fiches sans dire ou chacune en
   est. Impossible de voir en un coup d'oeil ce qui reste a faire, ni de
   comparer l'avancement de l'equipe. Tout ce qui suit vit dans un fichier
   isole, charge en dernier, sur le modele de js/install.js : js/app.js et
   css/app.css ne sont pas touches, donc une livraison parallele sur ces deux
   fichiers n'efface pas ce travail, et si ce script echoue l'application
   revient exactement a son etat precedent.

   COMMENT IL S'ACCROCHE, SANS MODIFIER js/app.js
   Il lit la copie locale des fiches ecrite par app.js (fx.rows.v1), il ecoute
   les gestes de l'utilisateur par delegation en phase de capture, et il
   insere ses blocs comme freres des conteneurs repeints par app.js
   (#grid-mine, #team-board), jamais dedans. Un MutationObserver le previent
   quand app.js a repeint, pour reappliquer un filtre en cours.

   POURQUOI LE SCORE N'EST PAS STOCKE
   Il se recalcule a chaque affichage depuis les jalons et le bareme. Changer
   un poids renote donc toute l'equipe instantanement, sans migration de
   donnees et sans risque d'echec a mi-chemin. Le bareme vit dans la table
   score_rules, en lecture pour l'equipe, en ecriture pour le proprietaire.

   CE QUE LE SCORE COMPTE, ET POURQUOI
   Prendre un contact vaut zero point : recompenser l'attribution pousserait a
   rafler les fiches libres sans les travailler, et il en reste 267. Les
   points viennent des jalons franchis, poses en base par le trigger
   stamp_funnel, donc non falsifiables depuis le front. Le bonus « parcours
   complet » exige les quatre jalons dans l'ordre chronologique : cocher les
   quatre statuts d'affilee apres coup ne le declenche pas.

   CE QUI N'EST PAS COMPTE
   Les fiches du segment « Fluxym (nous) » sont exclues, comme dans la vue
   Equipe : nos propres collegues ne sont pas des cibles.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------- Constantes ---------------- */

  /* Le calcul du score et le bareme vivent dans js/score.js, charge juste
     avant. Une seule definition sert l'annuaire et l'ecran de reglage : un
     apercu qui aurait sa propre formule annoncerait un classement que
     l'annuaire contredirait. Les noms ci-dessous sont des alias locaux, pour
     ne pas reecrire le reste du fichier. */
  const S = window.FXSCORE;

  const SEG_FLUXYM = S.SEG_FLUXYM;
  const ROWS_K  = "fx.rows.v1";          /* copie locale ecrite par app.js   */
  const PREF_K  = "fx.gamif.pref.v1";    /* preferences locales, par appareil */

  /* Le QR est une image du depot, pas un appel reseau : il doit s'afficher
     quand le wifi du salon s'ecroule, ce qui arrivera. */
  const QR_SRC = "./assets/qr-concours.png";
  const QR_URL = "https://go.fluxym.com/en/esker_all_access_consulting";

  /* Les quatre etapes de l'entonnoir, le bareme et ses libelles : memes
     objets que dans js/score.js, jamais recopies. S.rules et S.labels sont
     completes sur place par S.load(), donc ces alias restent valides. */
  const STEPS  = S.STEPS;
  const RULES  = S.rules;
  const LABELS = S.labels;

  let ROWS = [];              /* copie de travail, fiches completes  */
  let FILTER = null;          /* cle d'etape filtree, ou null        */
  let WHO  = null;            /* collegue dont on consulte le portefeuille */
  let WHOF = null;            /* etape filtree dans cette consultation     */
  let LAST_ID = null;         /* derniere fiche ouverte dans le volet */
  let LAST_FX3 = 0;           /* horodatage du dernier feu d'artifice */
  let PAINT_LOCK = false;     /* evite la boucle observer / repeinte  */

  /* ---------------- Petits utilitaires ---------------- */

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

  function pref() {
    try { return JSON.parse(localStorage.getItem(PREF_K) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function setPref(k, v) {
    const p = pref(); p[k] = v;
    try { localStorage.setItem(PREF_K, JSON.stringify(p)); } catch (_) {}
  }

  const isToday = S.isToday;

  /* Le bareme est lu par js/score.js, qui garde aussi le cache local. */
  const loadRules = () => S.load(FX.sb);

  /* ---------------- Le score d'une fiche ----------------
     La formule est dans js/score.js. Ici, seulement des alias : le total, le
     classement et les points d'un geste passent tous par la meme fonction,
     et l'ecran de reglage du bareme aussi. */

  const detailOf = S.detailOf;
  const scoreOf  = S.scoreOf;
  const todayOf  = S.todayOf;


  /* ---------------- Les donnees ----------------
     app.js fait un select("*") toutes les vingt secondes et garde le resultat
     dans fx.rows.v1. Les jalons y sont donc deja : aucune requete
     supplementaire n'est necessaire pour afficher l'entonnoir. */

  function readRows() {
    try {
      const k = JSON.parse(localStorage.getItem(ROWS_K) || "null");
      if (k && Array.isArray(k.rows)) return k.rows;
    } catch (_) {}
    return [];
  }
  const targets = S.targets;
  const mineRows = () => targets(ROWS).filter(r => r.owner === (FX.me && FX.me.name));

  /* Signature courte : si rien n'a change, on ne repeint pas. Comparer coute
     infiniment moins cher que reconstruire deux blocs. */
  const sigOf = list => list.length + "~" + list.map(r =>
    [r.id, r.status, r.owner, r.priority, r.funnel_msg_at, r.funnel_replied_at,
     r.funnel_rdv_at, r.funnel_met_at, r.contest_at].join("")).join("|").length;
  let SIG = "";

  function refresh(force) {
    const rows = readRows();
    if (rows.length) ROWS = rows;
    const s = sigOf(ROWS);
    if (s === SIG && !force) return false;
    SIG = s;
    paint();
    return true;
  }

  /* Fusion d'une fiche relue en base dans la copie de travail : le bandeau se
     met a jour dans le geste, sans attendre le prochain cycle de vingt
     secondes. */
  function mergeRow(row) {
    const i = ROWS.findIndex(r => String(r.id) === String(row.id));
    if (i >= 0) ROWS[i] = Object.assign({}, ROWS[i], row);
    refresh(true);
  }

  /* ---------------- Le bandeau du portefeuille ----------------
     Insere comme premier enfant de #view-mine, donc a cote de #grid-mine que
     app.js repeint, jamais dedans. Le score reste ici et n'entre pas dans la
     barre du haut : la barre sert a repondre « qui l'a pris » en cinq
     secondes, et rien ne doit la surcharger. */

  function boardOf(list) {
    const b = { todo:0, dead:0 };
    STEPS.forEach(s => b[s.k] = 0);
    list.forEach(r => {
      const any = STEPS.some(s => r[s.col]);
      if (r.status === "Sans suite") b.dead++;
      else if (!any) b.todo++;
      STEPS.forEach(s => { if (r[s.col]) b[s.k]++; });
    });
    return b;
  }

  function rankOf(name) {
    const t = targets(ROWS);
    const board = (FX.team || []).filter(x => x.active).map(x => ({
      name: x.name, color: x.color,
      score: t.filter(r => r.owner === x.name).reduce((n, r) => n + scoreOf(r), 0)
    })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { board, pos: board.findIndex(x => x.name === name) + 1 };
  }

  function mineHtml() {
    const mine = mineRows();
    const b = boardOf(mine);
    const score = mine.reduce((n, r) => n + scoreOf(r), 0);
    const today = mine.reduce((n, r) => n + todayOf(r), 0);
    const { board, pos } = rankOf(FX.me && FX.me.name);
    const prioA = mine.filter(r => r.priority === "A" && !STEPS.some(s => r[s.col])).length;
    const disc = !!pref().discret;

    const seg = (k, n, label) =>
      `<button class="gm-seg${FILTER === k ? " on" : ""}" type="button" data-step="${k}"
        aria-pressed="${FILTER === k}"><b>${n}</b><span>${label}</span></button>`;

    return `<div class="gm-head">
        <div class="gm-sc"><b>${score}</b><span>points</span></div>
        <div class="gm-meta">
          <span class="gm-pos">${pos ? pos + (pos === 1 ? "er" : "e") + " sur " + board.length : "hors classement"}</span>
          <span class="gm-day${today > 0 ? " up" : ""}">${today > 0 ? "+" + today + " aujourd’hui" : "rien aujourd’hui"}</span>
        </div>
        <button class="gm-pref${disc ? " on" : ""}" type="button" data-pref="discret"
          aria-pressed="${disc}" title="Effets discrets : plafonne les célébrations, utile face à un visiteur">
          ${disc ? "Effets discrets" : "Effets complets"}</button>
      </div>
      <div class="gm-fn" role="group" aria-label="Entonnoir de mon portefeuille">
        ${seg("todo", b.todo, "À faire")}
        ${STEPS.map(s => seg(s.k, b[s.k], s.short)).join("")}
      </div>
      <div class="gm-foot">
        ${prioA
          ? `<button class="gm-cta${FILTER === "prioA" ? " on" : ""}" type="button" data-step="prioA">
               ${prioA} contact${prioA > 1 ? "s" : ""} priorité A sans premier geste</button>`
          : `<span class="gm-ok">Aucun contact priorité A en attente</span>`}
        ${b.dead ? `<span class="gm-dead">${b.dead} sans suite</span>` : ""}
        <a class="gm-lk" href="./methode.html#bareme">Barème</a>
      </div>`;
  }

  function teamHtml() {
    const { board } = rankOf(FX.me && FX.me.name);
    const t = targets(ROWS);
    const max = Math.max(1, board[0] ? board[0].score : 1);
    return `<h3 class="gm-t">Classement</h3>
      <div class="gm-rows">${board.map((x, i) => {
        const p = t.filter(r => r.owner === x.name);
        const fig = STEPS.map(s => p.filter(r => r[s.col]).length).join(" · ");
        return `<div class="gm-r gm-clic${x.name === (FX.me && FX.me.name) ? " me" : ""}"
          data-who="${esc(x.name)}" role="button" tabindex="0"
          title="Voir le portefeuille de ${esc(x.name)}">
          <span class="gm-n">${i + 1}</span>
          <span class="gm-dot" style="background:${esc(x.color || "#94a3b8")}"></span>
          <span class="gm-w">${esc(x.name)}</span>
          <span class="gm-fig" title="Message · Réponse · RDV · Rencontré">${fig}</span>
          <b class="gm-p">${x.score}</b>
          <i class="gm-bar"><s style="width:${Math.round(x.score / max * 100)}%;background:${esc(x.color || "#94a3b8")}"></s></i>
        </div>`;
      }).join("")}</div>
      <p class="gm-note">Un nom ouvre le portefeuille de la personne, fiches modifiables.
        Points calculés à l’affichage depuis les jalons enregistrés en base :
        prendre un contact ne rapporte rien, seuls les gestes comptent.
        <a href="./methode.html#bareme">Voir le barème</a></p>`;
  }


  /* ---------------- Le portefeuille d'un collegue ----------------
     Demande apparue a l'usage : le classement dit qui mene, jamais ou en est
     l'autre. Un nom du tableau d'equipe ouvre donc le meme bandeau que le sien,
     avec le meme entonnoir cliquable et la liste des fiches suivies.

     Modifiable, comme dans l'annuaire. La premiere version etait en
     consultation seule, par crainte de changer le statut d'un contact qui
     n'est pas le sien en croyant le lire. L'usage a tranche dans l'autre
     sens : a huit sur un stand, on intervient regulierement sur un contact
     attribue a quelqu'un d'autre, celui qui passe devant le stand pendant que
     son responsable est en rendez-vous. Obliger a fermer la vue, retrouver la
     personne dans l'annuaire et rouvrir sa fiche coutait plus cher que le
     risque evite.

     La fiche ouverte est celle de app.js, pas une copie : memes champs, meme
     bouton Enregistrer, et le responsable y reste modifiable, donc reprendre
     un contact se fait sans quitter la vue. Le seul ajout est un attribut
     data-open sur la carte, que le delegue de clic de app.js reconnait deja,
     et une remontee de z-index en CSS sans laquelle la fiche s'ouvrirait
     DERRIERE cet ecran.

     La relecture apres enregistrement passe par verify(), le meme chemin que
     les boutons de l'entonnoir : le clic sur la carte pose LAST_ID, le clic
     sur Enregistrer declenche la relecture, la carte se remet a jour dans le
     geste au lieu d'attendre le cycle de vingt secondes de app.js.

     Aucune requete reseau pour afficher : tout se calcule sur la copie locale
     deja chargee, donc la vue s'ouvre aussi vite hors reseau que dessus. */

  const PRIO_ORD = { A:0, B:1, C:2 };

  const ownerRows = name => targets(ROWS).filter(r => r.owner === name);

  /* Derniere etape franchie, celle qui resume la fiche en un mot. */
  function stageOf(r) {
    let last = null;
    STEPS.forEach(s => { if (r[s.col]) last = s; });
    return last;
  }

  function whoKeeps(r) {
    if (!WHOF) return true;
    if (WHOF === "todo")  return r.status !== "Sans suite" && !STEPS.some(s => r[s.col]);
    if (WHOF === "prioA") return r.priority === "A" && !STEPS.some(s => r[s.col]);
    const s = STEPS.find(x => x.k === WHOF);
    return s ? !!r[s.col] : true;
  }

  /* Une carte. Les notes sont la partie la plus utile a un collegue (« deja
     vu l'an dernier », « rappeler apres 14 h ») et la plus longue : on en
     montre le debut, l'infobulle porte le reste.

     role=button et tabindex sur l'article : la carte entiere est la cible,
     pas un lien discret dans un coin, parce que la cible utile au pouce est
     la carte. */
  function whoCard(r) {
    const st = stageOf(r);
    const pts = scoreOf(r);
    const dead = r.status === "Sans suite";
    const cls = dead ? " dead" : st ? " step-" + st.k : "";
    const note = (r.notes || "").trim();
    return `<article class="gm-wc gm-wc-clic${cls}" data-open="${esc(r.id)}"
      role="button" tabindex="0" title="Ouvrir la fiche de ${esc(r.full_name)}">
      <div class="gm-wc-h">
        <span class="gm-wc-av" style="background:${FX.hue(r.full_name)}">${FX.initials(r.full_name)}</span>
        <div class="gm-wc-id">
          <b>${esc(r.full_name)}</b>
          ${r.title ? `<span>${esc(r.title)}</span>` : ""}
          ${r.company ? `<em>${esc(r.company)}</em>` : ""}
        </div>
        <div class="gm-wc-sc">${pts ? `<b>${pts}</b><span>pts</span>` : `<i>—</i>`}</div>
      </div>
      <div class="gm-wc-b">
        ${r.priority ? `<i class="gm-wc-p p${esc(r.priority)}">${esc(r.priority)}</i>` : ""}
        <i class="gm-wc-st">${dead ? "Sans suite" : st ? esc(st.long) : "À contacter"}</i>
        ${r.meeting_slot ? `<i class="gm-wc-rdv">RDV ${esc(r.meeting_slot)}</i>` : ""}
        ${r.contest_at ? `<i class="gm-wc-cc">Concours proposé</i>` : ""}
      </div>
      ${note ? `<p class="gm-wc-n" title="${esc(note)}">${esc(note.slice(0, 180))}${note.length > 180 ? "…" : ""}</p>` : ""}
    </article>`;
  }

  function whoHtml() {
    const member = (FX.team || []).find(x => x.name === WHO) || { name: WHO, color: "#94a3b8", role: "" };
    const list = ownerRows(WHO);
    const b = boardOf(list);
    const score = list.reduce((n, r) => n + scoreOf(r), 0);
    const today = list.reduce((n, r) => n + todayOf(r), 0);
    const { board, pos } = rankOf(WHO);
    const prioA = list.filter(r => r.priority === "A" && !STEPS.some(s => r[s.col])).length;
    const mine = WHO === (FX.me && FX.me.name);

    const shown = list.filter(whoKeeps).sort((a, c) =>
      (PRIO_ORD[a.priority] == null ? 9 : PRIO_ORD[a.priority]) -
      (PRIO_ORD[c.priority] == null ? 9 : PRIO_ORD[c.priority]) ||
      String(a.last_name || a.full_name || "").localeCompare(String(c.last_name || c.full_name || ""), "fr"));

    const seg = (k, n, label) =>
      `<button class="gm-seg${WHOF === k ? " on" : ""}" type="button" data-wstep="${k}"
        aria-pressed="${WHOF === k}"><b>${n}</b><span>${label}</span></button>`;

    return `<header class="gm-wh">
        <button class="gm-wx" type="button" data-wclose="1" aria-label="Fermer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <span class="gm-wdot" style="background:${esc(member.color || "#94a3b8")}"></span>
        <div class="gm-wid">
          <b>${esc(member.name)}${mine ? " · vous" : ""}</b>
          <span>${esc(member.role || "")}</span>
        </div>
        <div class="gm-wsc">
          <b>${score}</b>
          <span>points · ${pos ? pos + (pos === 1 ? "er" : "e") + " sur " + board.length : "hors classement"}</span>
        </div>
      </header>
      <div class="gm-wsum">
        <span class="gm-wtot"><b>${list.length}</b> contact${list.length > 1 ? "s" : ""} suivi${list.length > 1 ? "s" : ""}</span>
        <span class="gm-wday${today > 0 ? " up" : ""}">${today > 0 ? "+" + today + " aujourd’hui" : "rien aujourd’hui"}</span>
        ${prioA ? `<span class="gm-wa">${prioA} priorité A sans premier geste</span>`
                : `<span class="gm-wok">aucune priorité A en attente</span>`}
      </div>
      <div class="gm-fn gm-wfn" role="group" aria-label="Entonnoir du portefeuille de ${esc(member.name)}">
        ${seg("todo", b.todo, "À faire")}
        ${STEPS.map(s => seg(s.k, b[s.k], s.short)).join("")}
      </div>
      <div class="gm-wlist">
        ${shown.length ? shown.map(whoCard).join("")
          : `<p class="gm-wempty">${list.length ? "Aucune fiche dans ce filtre." : "Aucun contact attribué pour le moment."}</p>`}
      </div>
      <footer class="gm-wf">
        <span>Une carte ouvre la fiche, modifiable comme dans l’annuaire.</span>
        <a href="./methode.html#bareme">Barème</a>
      </footer>`;
  }

  function whoOverlay() {
    let o = $("#gm-who");
    if (o) return o;
    o = document.createElement("div");
    o.id = "gm-who";
    o.className = "gm-who";
    o.hidden = true;
    o.innerHTML = '<div class="gm-who-in" role="dialog" aria-modal="true" aria-label="Portefeuille d’un collègue"></div>';
    o.addEventListener("click", e => {
      if (e.target === o || (e.target.closest && e.target.closest("[data-wclose]"))) return closeWho();
      const seg = e.target.closest && e.target.closest("[data-wstep]");
      if (seg) {
        const k = seg.dataset.wstep;
        WHOF = WHOF === k ? null : k;
        paintWho();
      }
    });
    document.body.appendChild(o);
    return o;
  }

  function paintWho() {
    if (!WHO) return;
    const o = $("#gm-who");
    if (!o || o.hidden) return;
    const box = $(".gm-who-in", o);
    /* On garde la position de defilement : le rafraichissement de deux
       secondes ne doit pas renvoyer en haut de liste quelqu'un qui lit. */
    const top = box.scrollTop;
    box.innerHTML = whoHtml();
    box.scrollTop = top;
  }

  function openWho(name) {
    if (!name) return;
    WHO = name; WHOF = null;
    const o = whoOverlay();
    o.hidden = false;
    document.body.classList.add("gm-who-on");
    paintWho();
    $(".gm-who-in", o).scrollTop = 0;
  }

  function closeWho() {
    const o = $("#gm-who");
    if (o) o.hidden = true;
    document.body.classList.remove("gm-who-on");
    WHO = null; WHOF = null;
  }

  /* Les lignes du tableau d'equipe sont peintes par app.js, qu'on ne modifie
     pas. On se contente d'y poser un attribut et une classe apres coup, a
     chaque repeinte : rien n'est remplace, et si la structure de app.js change
     un jour, le pire qui arrive est que la ligne cesse d'etre cliquable. */
  function markTeam() {
    const board = $("#team-board");
    if (!board) return;
    const names = new Set((FX.team || []).filter(x => x.active).map(x => x.name));
    $$(".tm", board).forEach(tm => {
      const n = $(".tm-n", tm);
      const name = n ? n.textContent.trim() : "";
      if (!names.has(name)) return;          /* la ligne « Non attribuées » */
      tm.dataset.who = name;
      tm.classList.add("gm-clic");
      if (!tm.getAttribute("role")) {
        tm.setAttribute("role", "button");
        tm.setAttribute("tabindex", "0");
        tm.setAttribute("title", "Voir le portefeuille de " + name);
      }
    });
  }

  /* ---------------- Insertion et repeinte ---------------- */

  function slot(id, parent, before) {
    let el = document.getElementById(id);
    if (!el) {
      if (!parent) return null;
      el = document.createElement("section");
      el.id = id;
      el.className = "gm";
      if (before && before.parentNode === parent) parent.insertBefore(el, before);
      else parent.insertBefore(el, parent.firstChild);
    }
    return el;
  }

  function paint() {
    if (PAINT_LOCK) return;
    PAINT_LOCK = true;
    try {
      const vm = $("#view-mine");
      if (vm) { const el = slot("gm-mine", vm, $("#grid-mine")); if (el) el.innerHTML = mineHtml(); }
      const vt = $("#view-team");
      if (vt) { const el = slot("gm-team", vt, $("#team-board")); if (el) { el.classList.add("gm-board"); el.innerHTML = teamHtml(); } }
      markTeam();
      paintWho();
      applyFilter();
    } catch (_) { /* jamais au prix de l'annuaire */ }
    PAINT_LOCK = false;
  }

  /* ---------------- Le filtre de l'entonnoir ----------------
     app.js reconstruit #grid-mine en un seul innerHTML : les en-tetes de
     lettre et les cartes sont freres. On masque donc les cartes hors filtre,
     puis les en-tetes devenus vides, et on corrige le compteur de chaque
     lettre pour qu'il dise la verite. */

  function keeps(r) {
    if (!FILTER) return true;
    if (FILTER === "todo")  return r.status !== "Sans suite" && !STEPS.some(s => r[s.col]);
    if (FILTER === "prioA") return r.priority === "A" && !STEPS.some(s => r[s.col]);
    const s = STEPS.find(x => x.k === FILTER);
    return s ? !!r[s.col] : true;
  }

  function applyFilter() {
    const grid = $("#grid-mine");
    if (!grid) return;
    const byId = new Map(ROWS.map(r => [String(r.id), r]));
    let head = null, seen = 0;

    const closeHead = () => {
      if (!head) return;
      head.hidden = seen === 0;
      const n = $(".alpha-n", head);
      if (n) n.textContent = seen;
    };

    Array.prototype.forEach.call(grid.children, node => {
      if (node.classList.contains("alpha")) { closeHead(); head = node; seen = 0; return; }
      const sel = $("select[data-status]", node);
      const r = sel ? byId.get(String(sel.dataset.status)) : null;
      const ok = r ? keeps(r) : !FILTER;
      node.hidden = !ok;
      if (ok) seen++;
    });
    closeHead();

    const empty = $("#empty-mine");
    if (empty && FILTER) empty.hidden = true;
  }

  /* ---------------- Les celebrations ----------------
     Trois paliers, reprise fidele de Santiago-performances :
       moins de S.fx2 points : la carte respire et une bulle monte ;
       de S.fx2 a S.fx3 - 1  : halo colore et bulle plus large ;
       S.fx3 et plus         : contour ambre, gain en grand, confettis.
     Deux garde-fous appris la-bas : les points sont calcules avant l'effet
     (jamais lus dans le DOM), et un seul feu d'artifice toutes les six
     secondes, sinon quatre saisies d'affilee deviennent une gene. Ici s'en
     ajoute un troisieme : l'effet ne part qu'apres confirmation en base, donc
     jamais pour une ecriture qui a echoue faute de reseau. */

  function bubble(points, tier) {
    const b = document.createElement("div");
    b.className = "gm-bub t" + tier;
    b.textContent = "+" + points;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), tier === 3 ? 1500 : 1100);
  }

  function confetti() {
    const c = document.createElement("canvas");
    c.className = "gm-cfx";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = innerWidth, H = innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = W + "px"; c.style.height = H + "px";
    document.body.appendChild(c);

    const g = c.getContext("2d");
    const COL = ["#1d4ed8", "#0ea5e9", "#f59e0b", "#059669", "#dc2626"];
    const P = [];
    for (let i = 0; i < 90; i++) P.push({
      x: W * dpr * (0.15 + 0.7 * Math.random()), y: H * dpr * 0.78,
      vx: (Math.random() - 0.5) * 9 * dpr, vy: -(7 + Math.random() * 9) * dpr,
      r: (3 + Math.random() * 4) * dpr, a: Math.random() * 6.28,
      va: (Math.random() - 0.5) * 0.4, c: COL[i % COL.length]
    });

    const t0 = performance.now();
    (function frame(t) {
      const k = (t - t0) / 1400;
      if (k >= 1) { c.remove(); return; }
      g.clearRect(0, 0, c.width, c.height);
      P.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.42 * dpr; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a);
        g.globalAlpha = Math.max(0, 1 - k * k);
        g.fillStyle = p.c; g.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        g.restore();
      });
      requestAnimationFrame(frame);
    })(t0);
  }

  function celebrate(points, anchor) {
    if (!(points > 0)) return;
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    /* Lus a chaud dans S : un alias local aurait fige la valeur de secours
       avant que le bareme ne soit revenu de la base. */
    let tier = points >= S.fx3 ? 3 : points >= S.fx2 ? 2 : 1;

    /* Le geste se fait souvent devant la personne, telephone en main : ce
       reglage plafonne l'effet sans priver du score. */
    if (pref().discret) tier = Math.min(tier, 2);

    const now = Date.now();
    if (tier === 3 && now - LAST_FX3 < 6000) tier = 2;
    if (tier === 3) LAST_FX3 = now;

    bubble(points, tier);
    if (anchor) {
      anchor.classList.remove("gm-hit1", "gm-hit2", "gm-hit3");
      void anchor.offsetWidth;
      anchor.classList.add("gm-hit" + tier);
      setTimeout(() => anchor.classList.remove("gm-hit" + tier), 1200);
    }
    if (tier === 3 && !reduce) confetti();
    if (tier === 3 && navigator.vibrate) { try { navigator.vibrate([18, 40, 18]); } catch (_) {} }
  }

  /* ---------------- Verification avant celebration ----------------
     On relit la fiche et on compare les jalons : le gain est la difference de
     score reelle, jamais une estimation. C'est aussi ce qui evite de celebrer
     deux fois un jalon deja pose. */

  const COLS = "id,status,priority,notes,owner,segment,funnel_msg_at,funnel_replied_at," +
               "funnel_rdv_at,funnel_met_at,contest_at";

  async function verify(id, before, anchor, tries) {
    if (!id) return;
    tries = tries || 0;
    try {
      const { data, error } = await FX.sb.from("attendees").select(COLS).eq("id", id).limit(1);
      if (error || !data || !data[0]) return;
      const after = data[0];

      const changed = STEPS.some(s => !!after[s.col] !== !!(before && before[s.col]))
        || !!after.contest_at !== !!(before && before.contest_at)
        || after.status !== (before && before.status);

      /* L'ecriture peut ne pas etre encore visible : on redemande deux fois
         plutot que de manquer l'effet ou d'en inventer un. */
      if (!changed && tries < 2) {
        setTimeout(() => verify(id, before, anchor, tries + 1), 900 * (tries + 1));
        return;
      }

      const gain = scoreOf(after) - (before ? scoreOf(before) : 0);
      mergeRow(after);
      if (gain > 0) celebrate(gain, anchor);
      else if (gain < 0 && anchor) {
        anchor.classList.add("gm-undo");
        setTimeout(() => anchor.classList.remove("gm-undo"), 520);
      }
    } catch (_) {}
  }

  const snap = id => {
    const r = ROWS.find(x => String(x.id) === String(id));
    return r ? Object.assign({}, r) : null;
  };

  /* ---------------- Le QR du concours ----------------
     Une image du depot, affichee plein ecran, fond blanc, rien d'autre a
     l'ecran. Aucune generation cote client : l'URL est fixe et une image se
     scanne aussi bien hors reseau. Contrepartie assumee, un QR unique ne dit
     pas qui l'a fait scanner : c'est la case « concours proposé » de la fiche
     qui porte l'information, donc une declaration. */

  function qrOverlay() {
    let o = $("#gm-qr");
    if (o) return o;
    o = document.createElement("div");
    o.id = "gm-qr";
    o.className = "gm-qr";
    o.hidden = true;
    o.innerHTML = `<div class="gm-qr-in">
        <img src="${QR_SRC}" alt="QR code du concours Fluxym">
        <div class="gm-qr-tx"><b>Deux jours de conseil à gagner</b>
          <span>${esc(QR_URL)}</span></div>
        <button class="gm-qr-x" type="button">Fermer</button>
      </div>`;
    o.addEventListener("click", e => {
      if (e.target === o || e.target.classList.contains("gm-qr-x")) hideQr();
    });
    document.body.appendChild(o);
    return o;
  }
  function showQr() { qrOverlay().hidden = false; document.body.classList.add("gm-qr-on"); }
  function hideQr() { const o = $("#gm-qr"); if (o) o.hidden = true; document.body.classList.remove("gm-qr-on"); }

  function qrButton() {
    const bar = $(".sbar-in");
    const ref = $("#refresh-btn");
    if (!bar || $("#gm-qr-btn")) return;
    const b = document.createElement("button");
    b.id = "gm-qr-btn";
    b.className = "iconbtn gm-qrbtn";
    b.type = "button";
    b.setAttribute("aria-label", "Montrer le QR du concours");
    b.title = "QR du concours";
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 19h2v2h-2zM19 14h2M14 19h1"/></svg>`;
    b.addEventListener("click", showQr);
    if (ref) bar.insertBefore(b, ref); else bar.appendChild(b);
  }

  /* ---------------- Le bloc concours dans la fiche ----------------
     app.js reconstruit le volet a chaque ouverture, d'ou l'observateur. Le
     bloc s'insere dans .d-body, avant .d-meta, et la case ecrit tout de
     suite : un geste, une ecriture. Elle ne passe pas par le bouton
     « Enregistrer », qui n'envoie que owner, status, priority, rdv et notes,
     et n'a donc aucune raison de connaitre le concours. */

  function drawerId() {
    const m = $("#drawer .d-meta");
    const t = m ? m.textContent.match(/Fiche\s+(\S+)/) : null;
    return (t && t[1]) || LAST_ID;
  }

  function injectDrawer() {
    const body = $("#drawer .d-body");
    if (!body || $("#gm-d")) return;
    const id = drawerId();
    const r = id ? ROWS.find(x => String(x.id) === String(id)) : null;
    if (!r) return;

    const box = document.createElement("div");
    box.id = "gm-d";
    box.className = "gm-d";
    box.innerHTML = `<div class="gm-d-t">Concours</div>
      <button class="gm-d-qr" type="button">Montrer le QR du concours</button>
      <label class="gm-d-ck"><input type="checkbox" ${r.contest_at ? "checked" : ""}>
        <span>Concours proposé</span><i>+${RULES.contest || 0}</i></label>
      <div class="gm-d-n">${r.contest_at ? "Proposé le " + FX.fmtDate(r.contest_at) : "Coché quand la personne a scanné ou reçu le lien."}</div>`;

    const meta = $(".d-meta", body);
    if (meta) body.insertBefore(box, meta); else body.appendChild(box);

    $(".gm-d-qr", box).addEventListener("click", showQr);
    $("input", box).addEventListener("change", async e => {
      const on = e.target.checked;
      const before = snap(id);
      const { error } = await FX.sb.from("attendees")
        .update({ contest_at: on ? new Date().toISOString() : null }).eq("id", id);
      if (error) {
        e.target.checked = !on;
        if (FX.toast) FX.toast("Enregistrement impossible : " + error.message, "bad");
        return;
      }
      verify(id, before, null);
    });
  }

  /* ---------------- Accroches ----------------
     Tout en phase de capture, sur document : aucune fonction de app.js n'est
     enveloppee ni remplacee, donc rien ne casse si app.js change. */

  function wire() {
    /* Changement de statut depuis une carte. */
    document.addEventListener("change", e => {
      const sel = e.target && e.target.closest && e.target.closest("select[data-status]");
      if (!sel) return;
      const id = sel.dataset.status;
      const before = snap(id);
      setTimeout(() => verify(id, before, sel.closest(".card")), 650);
    }, true);

    document.addEventListener("click", e => {
      const t = e.target;
      if (!t || !t.closest) return;

      const op = t.closest("[data-open]");
      if (op) LAST_ID = op.dataset.open;

      /* Enregistrement du volet : le statut y change aussi. */
      if (t.closest("#d-save")) {
        const id = drawerId();
        const before = snap(id);
        setTimeout(() => verify(id, before, null), 800);
      }

      /* Un nom, dans le classement comme dans le tableau d'equipe, ouvre le
         portefeuille de la personne. On sort tout de suite : rien d'autre ne
         doit se declencher sur ce clic. */
      const w = t.closest("[data-who]");
      if (w && !t.closest("#gm-who")) { openWho(w.dataset.who); return; }

      const seg = t.closest("[data-step]");
      if (seg) {
        const k = seg.dataset.step;
        FILTER = FILTER === k ? null : k;
        paint();
        return;
      }

      const pf = t.closest("[data-pref]");
      if (pf) { setPref("discret", !pref().discret); paint(); }
    }, true);

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        hideQr();
        /* La fiche s'ouvre par-dessus ce panneau. Echap ferme alors la fiche
           seule, c'est app.js qui s'en charge : fermer les deux d'un coup
           ferait perdre la liste qu'on etait en train de lire. */
        if (!document.body.classList.contains("drawer-open")) closeWho();
        return;
      }
      /* Les lignes et les cartes portent role="button" : au clavier, Entree et
         Espace doivent faire ce que fait le clic. */
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target;
      if (!t || !t.closest) return;
      const w = t.closest("[data-who]");
      if (w && !t.closest("#gm-who")) { e.preventDefault(); openWho(w.dataset.who); return; }
      /* Dans le panneau, on ne reimplemente pas l'ouverture : on declenche le
         clic, donc le meme chemin que le pouce, delegue de app.js compris. */
      const op = t.closest("#gm-who [data-open]");
      if (op) { e.preventDefault(); op.click(); }
    });

    /* app.js repeint #grid-mine et #team-board sans nous prevenir : on
       reapplique le filtre et on rafraichit les compteurs. */
    const mo = new MutationObserver(() => {
      if (PAINT_LOCK) return;
      applyFilter();
      markTeam();
      injectDrawer();
    });
    ["#grid-mine", "#team-board", "#drawer"].forEach(s => {
      const n = $(s);
      if (n) mo.observe(n, { childList: true, subtree: s === "#drawer" });
    });

    /* La copie locale change a chaque cycle de chargement de app.js. Deux
       secondes suffisent, et la comparaison de signature evite toute
       repeinte inutile. */
    setInterval(() => refresh(false), 2000);
  }

  /* ---------------- Demarrage ----------------
     app.js verifie la session avant d'afficher quoi que ce soit. On attend
     donc que FX.me existe, sans jamais bloquer la page. */

  let waited = 0;
  (function start() {
    if (!window.FX || !FX.sb || !FX.me || !FX.me.name) {
      if ((waited += 200) > 40000) return;
      return setTimeout(start, 200);
    }
    ROWS = readRows();
    loadRules().then(() => {
      qrButton();
      wire();
      refresh(true);
    });
  })();
})();
