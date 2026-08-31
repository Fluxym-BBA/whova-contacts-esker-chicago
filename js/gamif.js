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

  const SEG_FLUXYM = "Fluxym (nous)";
  const ROWS_K  = "fx.rows.v1";          /* copie locale ecrite par app.js   */
  const PREF_K  = "fx.gamif.pref.v1";    /* preferences locales, par appareil */
  const RULES_K = "fx.gamif.rules.v1";   /* bareme en cache, pour le hors reseau */

  /* Le QR est une image du depot, pas un appel reseau : il doit s'afficher
     quand le wifi du salon s'ecroule, ce qui arrivera. */
  const QR_SRC = "./assets/qr-concours.png";
  const QR_URL = "https://go.fluxym.com/en/esker_all_access_consulting";

  /* Les quatre etapes de l'entonnoir, dans l'ordre. `col` est le jalon en
     base, `st` le statut qui le declenche. */
  const STEPS = [
    { k:"msg",     col:"funnel_msg_at",     st:"Message envoye", short:"Message",   long:"Message envoyé" },
    { k:"replied", col:"funnel_replied_at", st:"Repondu",        short:"Réponse",   long:"Réponse obtenue" },
    { k:"rdv",     col:"funnel_rdv_at",     st:"RDV planifie",   short:"RDV",       long:"Rendez-vous planifié" },
    { k:"met",     col:"funnel_met_at",     st:"Rencontre",      short:"Rencontré", long:"Rencontré au stand" }
  ];

  /* Valeurs de secours, utilisees seulement si la table score_rules est
     injoignable et qu'aucun cache local n'existe. Elles doivent rester
     identiques a celles inserees par la migration, sinon deux appareils
     afficheraient deux scores differents. */
  const DEF_RULES = { msg:3, replied:6, rdv:12, met:20, full:10, prio_a:5, dead:1, contest:5 };
  const DEF_LABEL = {
    msg:"Message envoyé", replied:"Réponse obtenue", rdv:"Rendez-vous planifié",
    met:"Rencontré au stand", full:"Parcours complet dans l'ordre",
    prio_a:"Contact priorité A travaillé", dead:"Sans suite qualifié", contest:"Concours proposé"
  };

  let RULES  = Object.assign({}, DEF_RULES);
  let LABELS = Object.assign({}, DEF_LABEL);
  let FX2 = 5, FX3 = 16;      /* seuils des paliers de celebration */

  let ROWS = [];              /* copie de travail, fiches completes  */
  let FILTER = null;          /* cle d'etape filtree, ou null        */
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

  const isToday = iso => {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };

  /* ---------------- Le bareme ----------------
     Lu une fois au demarrage, puis garde en cache local. Si la lecture
     echoue, on garde le cache : afficher un score legerement date vaut mieux
     que ne rien afficher entre deux conversations sur le stand. */

  async function loadRules() {
    try {
      const c = JSON.parse(localStorage.getItem(RULES_K) || "null");
      if (c && c.rules) { RULES = c.rules; LABELS = c.labels || LABELS; FX2 = c.fx2; FX3 = c.fx3; }
    } catch (_) {}

    try {
      const r = await FX.sb.from("score_rules").select("key,label,points");
      const s = await FX.sb.from("score_settings").select("fx2,fx3").limit(1);
      if (r.error || !r.data || !r.data.length) return;

      const rules = {}, labels = {};
      r.data.forEach(x => { rules[x.key] = x.points; labels[x.key] = x.label; });
      RULES = Object.assign({}, DEF_RULES, rules);
      LABELS = Object.assign({}, DEF_LABEL, labels);
      if (!s.error && s.data && s.data[0]) { FX2 = s.data[0].fx2; FX3 = s.data[0].fx3; }
      try { localStorage.setItem(RULES_K, JSON.stringify({ rules:RULES, labels:LABELS, fx2:FX2, fx3:FX3 })); } catch (_) {}
    } catch (_) { /* hors reseau : le cache ou les valeurs de secours suffisent */ }
  }

  /* ---------------- Le score d'une fiche ----------------
     Une seule definition, utilisee pour le total, pour le classement et pour
     calculer les points d'un geste. Deux calculs separes finiraient par
     divergerpour de bon. */

  function detailOf(r) {
    const parts = [];
    let total = 0;
    const add = (k, n) => { if (n) { total += n; parts.push({ k, label: LABELS[k], points: n }); } };

    STEPS.forEach(s => { if (r[s.col]) add(s.k, RULES[s.k] || 0); });

    /* Parcours complet : les quatre jalons, et dans l'ordre. Un contact
       travaille etape par etape vaut plus qu'un contact classe directement
       « Rencontré », c'est tout l'objet de l'entonnoir. */
    if (STEPS.every(s => r[s.col])) {
      const t = STEPS.map(s => +new Date(r[s.col]));
      if (t[0] <= t[1] && t[1] <= t[2] && t[2] <= t[3]) add("full", RULES.full || 0);
    }

    /* Le bonus priorite A tombe des la premiere etape franchie : il
       recompense le fait de travailler les bons contacts maintenant, pas
       seulement d'avoir de la chance sur le stand. */
    if (r.priority === "A" && STEPS.some(s => r[s.col])) add("prio_a", RULES.prio_a || 0);

    /* Qualifier negativement est un vrai travail. Sans point, personne ne met
       « Sans suite » et les fiches pourrissent jusqu'au 8 septembre. La note
       est exigee, sinon le statut devient un clic gratuit. */
    if (r.status === "Sans suite" && String(r.notes || "").trim()) add("dead", RULES.dead || 0);

    if (r.contest_at) add("contest", RULES.contest || 0);

    return { total, parts };
  }
  const scoreOf = r => detailOf(r).total;

  /* Points gagnes aujourd'hui : seuls les jalons dates du jour comptent, plus
     le concours propose aujourd'hui. Sert au « + N aujourd'hui » du bandeau. */
  function todayOf(r) {
    let n = 0;
    STEPS.forEach(s => { if (isToday(r[s.col])) n += RULES[s.k] || 0; });
    if (isToday(r.contest_at)) n += RULES.contest || 0;
    return n;
  }

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
  const targets = list => list.filter(r => r.segment !== SEG_FLUXYM);
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
        return `<div class="gm-r${x.name === (FX.me && FX.me.name) ? " me" : ""}">
          <span class="gm-n">${i + 1}</span>
          <span class="gm-dot" style="background:${esc(x.color || "#94a3b8")}"></span>
          <span class="gm-w">${esc(x.name)}</span>
          <span class="gm-fig" title="Message · Réponse · RDV · Rencontré">${fig}</span>
          <b class="gm-p">${x.score}</b>
          <i class="gm-bar"><s style="width:${Math.round(x.score / max * 100)}%;background:${esc(x.color || "#94a3b8")}"></s></i>
        </div>`;
      }).join("")}</div>
      <p class="gm-note">Points calculés à l’affichage depuis les jalons enregistrés en base.
        Prendre un contact ne rapporte rien : seuls les gestes comptent.
        <a href="./methode.html#bareme">Voir le barème</a></p>`;
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
       moins de FX2 points : la carte respire et une bulle monte ;
       de FX2 a FX3 - 1    : halo colore et bulle plus large ;
       FX3 et plus         : contour ambre, gain en grand, confettis.
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
    let tier = points >= FX3 ? 3 : points >= FX2 ? 2 : 1;

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

    document.addEventListener("keydown", e => { if (e.key === "Escape") hideQr(); });

    /* app.js repeint #grid-mine et #team-board sans nous prevenir : on
       reapplique le filtre et on rafraichit les compteurs. */
    const mo = new MutationObserver(() => {
      if (PAINT_LOCK) return;
      applyFilter();
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
