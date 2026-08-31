/* --------------------------------------------------------------------------
   Annuaire des participants : filtrage, attribution, suivi.

   Le scenario de reference n'est pas le bureau, c'est le stand : entre deux
   conversations, un telephone dans une main. Trois consequences dans ce
   fichier :

   1. rendu paresseux. Chaque vue n'est peinte que lorsqu'elle est affichee.
      L'ancienne version reecrivait les 400 cartes de l'annuaire ET celles du
      portefeuille a chaque changement, y compris pour un onglet invisible.
   2. rafraichissement sobre. Le rechargement automatique compare une
      signature des donnees et ne repeint que si quelque chose a bouge ; il
      s'arrete quand la page passe en arriere-plan, et se met en attente
      lorsqu'une feuille est ouverte pour ne pas escamoter une saisie en cours.
   3. defilement conserve par vue. Revenir a l'annuaire ne renvoie pas en
      haut de 400 fiches.
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
  /* La cle de tri retire la ponctuation initiale comme initialOf, sinon un
     O'Brien ou un 't Hart trierait avant les A et son groupe apparaitrait
     hors sequence alphabetique. Un seul cas en base aujourd'hui (un nom de
     famille reduit a un point), mais Whova enregistre encore des inscrits. */
  const sortKey = r => {
    const base = [r.last_name, r.first_name, r.full_name].filter(Boolean).join(" ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/^[^a-z0-9]+/, "");
    return (initialOf(r) === "#" ? "zzz" : "") + base;
  };

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

  let ROWS = [], LIST = [], SIG = "", VIEW = "list", PENDING = false, TIMER = null;
  const DIRTY = { list:true, mine:true, team:true };
  const SCROLL = {};
  const colorOf = n => (team.find(t => t.name === n) || {}).color || "#64748b";
  const mineRows = () => ROWS.filter(r => r.owner === me.name);

  /* Une feuille ouverte veut dire une saisie en cours : on ne repeint pas
     sous les doigts de quelqu'un. La mise a jour attend la fermeture. */
  const busy = () => document.body.classList.contains("sheet-open")
                  || document.body.classList.contains("drawer-open");
  const flush = () => { if (PENDING) { PENDING = false; render(); } };

  /* ---------------- Donnees ---------------- */
  async function load(manual) {
    if (manual) {
      const b = $("#refresh-btn");
      b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin");
    }
    const { data, error } = await FX.sb.from("attendees").select("*").order("last_name");
    if (error) {
      /* Une panne de reseau n'est pas une erreur applicative : on garde a
         l'ecran ce qu'on a, et on le dit franchement plutot que de laisser
         croire que la liste est a jour. */
      if (FX.looksOffline(error)) offline(true);
      else if (manual) toast("Erreur de chargement : " + error.message, "bad");
      return;
    }
    offline(false);

    const rows = data || [];
    /* Signature volontairement courte : identite, horodatage de derniere
       ecriture, et les trois champs qui changent l'affichage d'une carte.
       Comparer cela coute infiniment moins cher que repeindre la liste. */
    const sig = rows.map(r => [r.id, r.updated_at, r.owner, r.status, r.priority].join("~")).join("|");
    const first = !ROWS.length;
    ROWS = rows;

    if (sig === SIG && !first) { if (manual) toast("Liste déjà à jour"); return; }
    SIG = sig;
    keepRows(rows);
    buildFilters();
    if (busy()) { PENDING = true; return; }
    render();
    if (manual) toast("Liste actualisée", "ok");
  }

  async function patch(id, payload) {
    const { error } = await FX.sb.from("attendees").update(payload).eq("id", id);
    if (error) { toast("Échec : " + error.message, "bad"); return false; }
    Object.assign(ROWS.find(r => r.id === id) || {}, payload);
    render(); return true;
  }

  function startPoll() { stopPoll(); TIMER = setInterval(() => load(), 20000); }
  function stopPoll()  { if (TIMER) clearInterval(TIMER); TIMER = null; }
  /* Page en arriere-plan : rien a rafraichir, et la batterie sert a autre
     chose. Retour au premier plan : on recharge tout de suite, sans attendre
     les 20 secondes du cycle. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPoll(); else { load(); startPoll(); }
  });

  /* ---------------- Filtres ---------------- */
  /* Fluxym est masque par defaut : ce sont nos propres collegues, aucun interet dans
   l'annuaire. Esker est visible par defaut : les equipes de l'editeur sont des
   interlocuteurs que nous voulons aussi aller voir sur place. */
  /* Chaque filtre porte une LISTE de valeurs, jamais une valeur seule. Une
     liste vide veut dire « pas de filtre », exactement comme l'ancienne chaine
     vide. On voulait souvent croiser deux fonctions metier ou deux societes, et
     un choix unique obligeait a faire deux passes sur la liste en retenant de
     tete le resultat de la premiere. */
  const F = { q:"", priority:[], segment:[], job_function:[], seniority:[], owner:[], status:[],
              company:[], hideFluxym:true, hideEsker:false };

  const FDEFS = [
    ["priority",     "#f-priority",  "Priorité"],
    ["owner",        "#f-owner",     "Attribution"],
    ["status",       "#f-status",    "Statut"],
    ["job_function", "#f-function",  "Fonction"],
    ["seniority",    "#f-seniority", "Séniorité"],
    ["segment",      "#f-segment",   "Segment"],
    ["company",      "#f-company",   "Société"]
  ];

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
    const vals = { segment:uniq("segment"), job_function:uniq("job_function"),
                   seniority:uniq("seniority"), company:uniq("company") };
    fill($("#f-segment"),   vals.segment);
    fill($("#f-function"),  vals.job_function);
    fill($("#f-seniority"), vals.seniority);
    fill($("#f-company"),   vals.company);

    /* Une societe filtree qui disparait de la base laisserait un filtre
       invisible et une liste vide sans explication. On ne purge que les quatre
       filtres dont les valeurs viennent des donnees : priorite, statut et
       attribution ont des options fixes, il n'y a rien a y nettoyer. */
    Object.keys(vals).forEach(k => {
      if (!F[k].length) return;
      const ok = new Set(vals[k]);
      F[k] = F[k].filter(v => ok.has(v));
    });
  }

  /* Libelle lisible d'une valeur : on va le chercher dans les options du
     <select>, qui reste le reservoir de reference. « A — a voir absolument »
     est tronque a « A », suffisant dans une pastille. */
  function optLabel(k, v) {
    const d = FDEFS.find(x => x[0] === k);
    const el = d && $(d[1]);
    const o = el && [...el.options].find(x => x.value === v);
    return ((o ? o.textContent : v) || "").trim().split(" — ")[0];
  }

  /* Ce qu'affiche un bouton de filtre ou une ligne du menu. Deux valeurs
     courtes tiennent en clair, au-dela on compte : « Priorite A, B » se lit
     mieux que « 2 selectionnees », mais pas « Societe Lassonde Pappas &
     Company, A. Lassonde, Esker ». */
  function summary(k) {
    const d = FDEFS.find(x => x[0] === k);
    const el = d && $(d[1]);
    const none = el ? el.options[0].textContent.trim() : "Tous";
    const n = F[k].length;
    if (!n) return none;
    const txt = F[k].map(v => optLabel(k, v)).join(", ");
    return txt.length <= 24 ? txt : n + " sélectionné" + (n > 1 ? "s" : "");
  }

  /* Recherche : un rendu par frappe sur plus de 400 cartes fait decrocher un
     telephone. On attend 130 ms de silence. */
  let QT = null;
  $("#q").oninput = e => {
    const v = e.target.value;
    $("#q-clear").hidden = !v;
    clearTimeout(QT);
    QT = setTimeout(() => {
      F.q = v.trim().toLowerCase();
      /* Taper une recherche depuis le portefeuille ou l'equipe ne doit pas
         donner l'impression que rien ne se passe : on ramene sur l'annuaire. */
      if (VIEW !== "list") showView("list"); else render();
    }, 130);
  };
  $("#q").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } };
  $("#q-clear").onclick = () => {
    $("#q").value = ""; $("#q-clear").hidden = true; F.q = ""; render(); $("#q").focus();
  };

  /* Les <select> ne sont plus pilotes directement : ils portent les options et
     les libelles, la selection vit dans F et se fait dans le panneau a cases.
     Un <select> natif ne sait pas faire du multiple sans Ctrl+clic, ce qui est
     hors de question au doigt sur un stand. */
  $("#f-hide-fluxym").onchange = e => { F.hideFluxym = e.target.checked; render(); };
  $("#f-hide-esker").onchange  = e => { F.hideEsker  = e.target.checked; render(); };

  function resetFilters() {
    F.q = "";
    FDEFS.forEach(([k]) => { F[k] = []; });
    F.hideFluxym = true; F.hideEsker = false;
    $("#q").value = ""; $("#q-clear").hidden = true;
    $("#f-hide-fluxym").checked = true; $("#f-hide-esker").checked = false;
    if (subOpen()) paintSubList($("#fsub-q").value);
    render();
  }
  $("#reset-btn").onclick = resetFilters;
  $("#refresh-btn").onclick = () => load(true);

  function match(r) {
    if (F.hideFluxym && r.segment === SEG_FLUXYM) return false;
    if (F.hideEsker  && r.segment === SEG_ESKER)  return false;
    /* Plusieurs valeurs sur un meme filtre s'additionnent (OU), deux filtres
       differents se cumulent (ET) : « fonction Finance ou Achats, et seniorite
       Direction » est la question qu'on se pose reellement devant le stand. */
    for (const k of ["priority","segment","job_function","seniority","status","company"])
      if (F[k].length && !F[k].includes(r[k])) return false;
    if (F.owner.length) {
      const key = r.owner || "__none__";
      if (!F.owner.includes(key)) return false;
    }
    if (F.q) {
      const hay = [r.full_name,r.company,r.title,r.location,r.notes,r.interest].join(" ").toLowerCase();
      if (!F.q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  /* ---------------- Navigation et bouton retour ----------------

     Le probleme resolu ici est le plus visible de tous quand l'application est
     installee sur un telephone : sans barre d'adresse, le geste retour est le
     seul geste de sortie. Jusqu'ici il quittait l'application au lieu de
     fermer la fiche ouverte, ce qui donnait immediatement la sensation d'un
     site web deguise.

     Le modele est volontairement grossier : deux niveaux, pas plus.
       - l'onglet courant, qui vit dans l'historique et dans le fragment
         d'URL, ce qui rend les quatre vues partageables et permet aux
         raccourcis du manifeste de fonctionner ;
       - un unique niveau "panneau ouvert", qui couvre indifferemment la fiche,
         la feuille de filtres et sa sous-liste.

     Pourquoi un seul niveau pour les trois panneaux : parce qu'empiler
     feuille puis sous-liste puis fiche demanderait trois gestes retour pour
     revenir a la liste. Sur un stand, avec une main, un geste vaut mieux que
     trois. Le retour referme donc tout ce qui est ouvert d'un coup.
     ------------------------------------------------------------------ */
  const VIEWS = ["list", "mine", "team", "log"];
  let PANEL_PUSHED = false;   /* une entree d'historique est-elle posee ? */

  const anyPanel = () => sheet.open || subOpen() || !$("#drawer").hidden;

  /* Appelee apres l'ouverture d'un panneau. */
  function panelPushed() {
    if (PANEL_PUSHED) return;
    PANEL_PUSHED = true;
    try { history.pushState({ fx: { view: VIEW, panel: 1 } }, ""); } catch (_) { PANEL_PUSHED = false; }
  }
  /* Appelee apres la fermeture d'un panneau, seulement si plus rien n'est
     ouvert. `fromHist` vaut vrai quand c'est justement l'historique qui a
     demande la fermeture : il ne faut alors surtout pas rappeler back(). */
  function panelPopped(fromHist) {
    if (!PANEL_PUSHED || anyPanel()) return;
    PANEL_PUSHED = false;
    if (!fromHist) { try { history.back(); } catch (_) {} }
  }
  /* Ferme tout, sans toucher a l'historique. */
  function closeAllPanels() {
    if (!$("#drawer").hidden) closeDrawer(true);
    if (subOpen()) closeSub(true);
    if (sheet.open) closeSheet(true);
  }

  window.addEventListener("popstate", e => {
    const st = (e.state && e.state.fx) || { view: "list" };
    /* Un etat sans panneau alors que des panneaux sont ouverts : on remonte. */
    if (!st.panel && anyPanel()) { PANEL_PUSHED = false; closeAllPanels(); }
    else if (st.panel) PANEL_PUSHED = true;
    if (st.view && st.view !== VIEW) showView(st.view, true);
  });

  /* ---------------- Feuille de filtres ----------------
     Sur ordinateur le panneau est visible en clair et ces fonctions ne font
     rien de visible : le bouton qui les declenche est masque. */
  const sheet = { open: false };
  function openSheet(fromHist) {
    sheet.open = true;
    document.body.classList.add("sheet-open");
    $("#filters-btn").setAttribute("aria-expanded", "true");
    if (!fromHist) panelPushed();
  }
  function closeSheet(fromHist) {
    if (!$("#fsub").hidden) closeSub(true);   /* jamais un deuxieme niveau orphelin */
    sheet.open = false;
    document.body.classList.remove("sheet-open");
    $("#filters-btn").setAttribute("aria-expanded", "false");
    flush();
    panelPopped(fromHist);
  }
  $("#filters-btn").onclick   = () => (sheet.open ? closeSheet() : openSheet());
  $("#filters-close").onclick = () => closeSheet();
  $("#filters-back").onclick  = () => closeSheet();
  $("#filters-apply").onclick = () => closeSheet();

  /* Glisser la poignee vers le bas ferme la feuille. Le geste est limite a la
     poignee : ailleurs, il doit rester du defilement, pas une fermeture
     accidentelle au milieu d'une liste de 182 societes. */
  function wireGrab(grab, panel, close) {
    if (!grab) return;
    let y0 = null, dy = 0;
    grab.addEventListener("touchstart", e => {
      y0 = e.touches[0].clientY; dy = 0; panel.style.transition = "none";
    }, { passive:true });
    grab.addEventListener("touchmove", e => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive:true });
    const end = () => {
      if (y0 === null) return;
      panel.style.transition = ""; panel.style.transform = "";
      y0 = null;
      if (dy > 90) close();
    };
    grab.addEventListener("touchend", end);
    grab.addEventListener("touchcancel", end);
  }
  wireGrab($("#filters-grab"), $("#filters"), () => closeSheet());

  /* ---------------- Menu de filtres (telephone) ----------------
     Un <select> natif portant 182 societes est injouable au pouce : il faut
     viser dans une roue, sans recherche possible. On garde les <select> comme
     source de verite (ils portent les options et la valeur, et servent
     l'affichage sur ordinateur) et on les double d'un menu a deux niveaux :
     la liste des filtres, puis la liste des valeurs en plein ecran. */
  let SUBKEY = null, SUB_TOUCHED = false;

  function paintFmenu() {
    $("#fmenu").innerHTML = FDEFS.map(([k, sel, label]) =>
      `<button class="fmrow ${F[k].length ? "set" : ""}" type="button" data-fkey="${k}">
        <span class="fmlab">${label}</span><span class="fmval">${esc(summary(k))}</span>
        <svg class="fmchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      </button>`).join("");
  }

  /* Ordinateur : meme mecanique, autre habillage. Le bouton remplace le menu
     deroulant et ouvre la meme liste a cocher, donc une seule logique a
     maintenir et la recherche par societe devient disponible au clavier. */
  function paintPicks() {
    FDEFS.forEach(([k]) => {
      const b = $(`.fpick[data-fkey="${k}"]`);
      if (!b) return;
      const n = F[k].length;
      b.classList.toggle("set", n > 0);
      const v = $(".fpv", b);
      if (v) v.textContent = summary(k);
      const c = $(".fpn", b);
      if (c) { c.hidden = n < 2; c.textContent = n; }
      b.setAttribute("aria-expanded", SUBKEY === k ? "true" : "false");
    });
  }

  /* Nombre de fiches par valeur : choisir « Société » a l'aveugle sur 182
     lignes fait perdre plus de temps que de lire la liste. Le compte porte
     sur la base entiere, pas sur le filtrage courant, pour rester stable
     pendant qu'on navigue dans le menu. */
  function subCounts(k) {
    const m = new Map();
    ROWS.forEach(r => {
      const v = k === "owner" ? (r.owner || "__none__") : r[k];
      if (v) m.set(v, (m.get(v) || 0) + 1);
    });
    return m;
  }

  function paintSubList(q) {
    const d = FDEFS.find(x => x[0] === SUBKEY); if (!d) return;
    const el = $(d[1]), counts = subCounts(SUBKEY);
    const needle = (q || "").trim().toLowerCase();
    /* La premiere option (« Toutes », « Tous ») n'est pas une valeur : en
       choix multiple, « aucune case cochee » dit deja la meme chose. Elle est
       remplacee par le bouton « Tout effacer » du pied. */
    const items = [...el.options].slice(1)
      .filter(o => !needle || o.textContent.toLowerCase().includes(needle));
    const on = new Set(F[SUBKEY]);
    $("#fsub-list").innerHTML = items.map(o => {
      const n = counts.get(o.value), sel = on.has(o.value);
      return `<button class="fsopt ${sel ? "on" : ""}" type="button" role="checkbox"
        aria-checked="${sel}" data-val="${esc(o.value)}">
        <i class="fsbox" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></i>
        <span>${esc(o.textContent.trim())}</span>
        ${n ? `<em>${n}</em>` : ""}
      </button>`;
    }).join("") || '<div class="empty">Aucune valeur ne correspond.</div>';
    paintSubFoot();
  }

  /* Pied du panneau de valeurs. Il existe pour une raison precise : en choix
     multiple, cocher ne referme plus rien, il faut donc un geste de sortie
     explicite et un compte de ce qui est retenu. */
  function paintSubFoot() {
    const n = SUBKEY ? F[SUBKEY].length : 0;
    const clr = $("#fsub-clear"), done = $("#fsub-done");
    if (clr)  clr.hidden = n === 0;
    if (done) done.textContent = n ? `Terminé · ${n} retenu${n > 1 ? "s" : ""}` : "Terminé";
  }

  function openSub(k, fromHist) {
    const d = FDEFS.find(x => x[0] === k); if (!d) return;
    SUBKEY = k;
    $("#fsub-title").textContent = d[2];
    /* Champ de recherche seulement quand la liste est longue : sur six
       statuts il ne sert a rien et vole une ligne. */
    $("#fsub-search").hidden = $(d[1]).options.length <= 12;
    SUB_TOUCHED = false;
    $("#fsub-q").value = "";
    paintSubList("");
    $("#fsub-list").scrollTop = 0;
    $("#fsub").hidden = false;
    document.body.classList.add("sub-open");
    paintPicks();
    if (!fromHist) panelPushed();
  }
  function closeSub(fromHist) {
    $("#fsub").hidden = true;
    document.body.classList.remove("sub-open");
    SUBKEY = null;
    /* Les cartes n'ont pas ete repeintes pendant que le panneau etait ouvert
       (voir render). C'est ici qu'on rattrape, et seulement si quelque chose a
       reellement change. */
    const touched = SUB_TOUCHED;
    SUB_TOUCHED = false;
    panelPopped(fromHist);
    if (touched) render(); else paintPicks();
  }
  const subOpen = () => !$("#fsub").hidden;

  /* Un seul ecouteur pour les deux habillages : les lignes du menu sur
     telephone et les boutons du panneau sur ordinateur portent le meme
     data-fkey. */
  $("#filters").addEventListener("click", e => {
    const r = e.target.closest("[data-fkey]");
    if (!r) return;
    if (SUBKEY === r.dataset.fkey) closeSub(); else openSub(r.dataset.fkey);
  });
  $("#fsub-back").onclick = () => closeSub();
  $("#fsub-done").onclick = () => closeSub();
  $("#fsub-clear").onclick = () => {
    if (!SUBKEY) return;
    F[SUBKEY] = []; SUB_TOUCHED = true;
    paintSubList($("#fsub-q").value);
    render(true);
  };
  /* Cliquer a cote du panneau le referme. Sur telephone il occupe tout
     l'ecran, ce cas ne se presente donc que sur ordinateur. */
  $("#fsub").addEventListener("click", e => { if (e.target.id === "fsub") closeSub(); });
  $("#fsub-q").oninput = e => paintSubList(e.target.value);
  $("#fsub-list").onclick = e => {
    const b = e.target.closest("[data-val]"); if (!b || !SUBKEY) return;
    const arr = F[SUBKEY], v = b.dataset.val, i = arr.indexOf(v);
    if (i < 0) arr.push(v); else arr.splice(i, 1);
    SUB_TOUCHED = true;
    /* On ne referme pas : le geste attendu est d'en cocher plusieurs de
       suite. Le compteur du pied et celui du bouton « Voir les resultats »
       suivent en direct, la grille attend la fermeture. */
    paintSubList($("#fsub-q").value);
    render(true);
  };

  /* ---------------- Curseur alphabetique lateral ----------------
     Colle au bord droit, disponible pendant tout le defilement. Le doigt
     glisse, la liste suit, une bulle affiche la lettre visee. Le saut se
     cale sous les barres collantes en mesurant leur position reelle, plutot
     qu'en recopiant une hauteur qui finirait par etre fausse. */
  function paintScrub(letters) {
    const sc = $("#scrub");
    /* Sous cinq lettres, un curseur etale sur toute la hauteur de l'ecran
       est trompeur : autant ne rien afficher. */
    sc.hidden = letters.length < 5;
    sc.innerHTML = letters.map(l => `<b data-l="${l}">${l}</b>`).join("");
  }

  function wireScrub() {
    const sc = $("#scrub"), bub = $("#scrub-bubble");
    let raf = null, lastY = 0, lastL = null, hide = null;

    const apply = () => {
      raf = null;
      const items = [...sc.children]; if (!items.length) return;
      const r = sc.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (lastY - r.top) / r.height));
      const l = items[Math.min(items.length - 1, Math.floor(ratio * items.length))].dataset.l;
      bub.textContent = l;
      bub.hidden = false;
      bub.style.top = Math.min(window.innerHeight - 70, Math.max(70, lastY)) + "px";
      if (l === lastL) return;
      lastL = l;
      const target = document.getElementById("g-" + (l === "#" ? "num" : l));
      if (!target) return;
      const stick = document.querySelector(".sbar").getBoundingClientRect().bottom;
      window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - stick - 8);
    };
    const move = y => {
      lastY = y;
      clearTimeout(hide);
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const end = () => {
      lastL = null;
      hide = setTimeout(() => { bub.hidden = true; }, 450);
    };

    sc.addEventListener("touchstart", e => move(e.touches[0].clientY), { passive:true });
    sc.addEventListener("touchmove",  e => move(e.touches[0].clientY), { passive:true });
    sc.addEventListener("touchend", end);
    sc.addEventListener("touchcancel", end);
    /* Souris : utile quand la fenetre d'un ordinateur est etroite. */
    sc.addEventListener("click", e => { move(e.clientY); end(); });
  }
  wireScrub();

  /* ---------------- Rendu d'une carte ---------------- */
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

    const av = r.photo ? `<img class="av" src="${esc(r.photo)}" alt="" loading="lazy">`
      : `<div class="av" style="background:${FX.hue(r.full_name)}">${FX.initials(r.full_name)}</div>`;

    /* Qui suit ce contact doit se lire sans ouvrir la fiche, y compris sur un
       ecran de telephone : couleur du responsable, prenom en petit format,
       nom complet des que la place le permet. */
    const owner = r.owner
      ? `<span class="owner-tag" style="background:${colorOf(r.owner)}" title="Suivi par ${esc(r.owner)}">
           <b class="oshort">${esc(r.owner.split(" ")[0])}</b><span class="oname">${esc(r.owner)}</span></span>`
      : `<span class="bdg">Libre</span>`;

    return `<article class="card p-${esc(r.priority)} ${mine?"mine":""} ${taken?"taken":""}">
      <div class="c-head" data-open="${esc(r.id)}">${av}
        <div class="c-id">
          <div class="c-name">${esc(r.full_name)}</div>
          ${r.title   ? `<div class="c-title">${esc(r.title)}</div>` : ""}
          ${r.company ? `<div class="c-comp">${esc(r.company)}</div>` : ""}
          ${r.location? `<div class="c-loc">${esc(r.location)}</div>` : ""}
        </div></div>
      ${b.length ? `<div class="badges">${b.join("")}</div>` : ""}
      <div class="c-actions">
        ${owner}
        <select data-status="${esc(r.id)}" data-st="${esc(r.status || "")}" aria-label="Statut de ${esc(r.full_name)}">
          ${STATUSES.map(s => `<option value="${s}" ${r.status===s?"selected":""}>${LABEL[s]}</option>`).join("")}
        </select>
        <button class="take ${mine?"drop":""}" data-take="${esc(r.id)}">
          ${mine ? "Libérer" : taken ? "Reprendre" : "Je prends"}</button>
      </div></article>`;
  }

  /* ---------------- Rendu des vues ---------------- */
  function paintList() {
    const present = new Set(LIST.map(initialOf));
    $("#grid").innerHTML = gridHtml(LIST, "g");
    $("#empty").hidden = LIST.length > 0;
    /* L'index ne propose que les lettres reellement presentes apres filtrage :
       une lettre cliquable qui ne mene nulle part est un piege. */
    const letters = ALPHABET.concat(present.has("#") ? ["#"] : []);
    $("#alpha-index").innerHTML = letters
      .map(l => present.has(l)
        ? `<a href="#g-${l === "#" ? "num" : l}" data-jump="${l}">${l}</a>`
        : `<span>${l}</span>`).join("");
    /* Le curseur lateral ne montre que les lettres atteignables : viser une
       lettre absente et ne rien voir bouger fait croire a une panne. */
    paintScrub(letters.filter(l => present.has(l)));
    DIRTY.list = false;
  }
  function paintMine() {
    const mine = mineRows();
    $("#grid-mine").innerHTML = gridHtml(mine, "m");
    $("#empty-mine").hidden = mine.length > 0;
    DIRTY.mine = false;
  }
  function paintTeam() {
    /* Seuls nos propres collegues sortent du perimetre de travail : les equipes
       Esker comptent comme des cibles a part entiere. */
    const t = ROWS.filter(r => r.segment !== SEG_FLUXYM);
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
    DIRTY.team = false;
  }
  async function paintLog() {
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

  function paintDash() {
    const t = ROWS.filter(r => r.segment !== SEG_FLUXYM);
    const a = t.filter(r => r.priority === "A").length;
    const own = t.filter(r => r.owner).length;
    $("#kpis").innerHTML = [
      ["Cibles", t.length],
      ["Priorité A", a],
      ["Attribuées", own],
      ["Non attribuées", t.length - own],
      ["Contactées", t.filter(r => r.status !== "A contacter").length],
      ["RDV / rencontres", t.filter(r => ["RDV planifie","Rencontre"].includes(r.status)).length]
    ].map(([l,v]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");
    /* Resume d'une ligne : sur telephone le tableau de bord est replie, et
       trois chiffres suffisent a savoir ou en est la repartition. */
    $("#dash-sum").textContent = `${t.length} cibles · ${a} en priorité A · ${own} attribuées`;
  }

  /* Rappel des filtres actifs. Une feuille refermee ne doit pas laisser
     croire que la liste est complete. */
  function paintChips() {
    const chips = [];
    FDEFS.forEach(([k, sel, label]) => {
      if (!F[k].length) return;
      /* Une pastille par filtre, pas une par valeur : trois societes retenues
         donnent une pastille lisible, pas trois pastilles qui poussent le reste
         hors de l'ecran. La croix retire le filtre entier ; pour n'en enlever
         qu'une, on rouvre la liste, qui est a un geste. */
      const txt = F[k].map(v => optLabel(k, v)).join(", ");
      const short = txt.length <= 40 ? txt : F[k].length + " valeurs";
      chips.push(`<span class="fchip"><b>${label}</b> ${esc(short)}
        <button data-unset="${k}" aria-label="Retirer le filtre ${label}">&times;</button></span>`);
    });
    if (!F.hideFluxym) chips.push(`<span class="fchip"><b>Fluxym</b> affiché
      <button data-unset="hideFluxym" aria-label="Masquer Fluxym à nouveau">&times;</button></span>`);
    if (F.hideEsker) chips.push(`<span class="fchip"><b>Esker</b> masqué
      <button data-unset="hideEsker" aria-label="Afficher Esker à nouveau">&times;</button></span>`);

    const n = chips.length;
    $("#filters-count").hidden = n === 0;
    $("#filters-count").textContent = n;
    $("#filters-btn").classList.toggle("active", n > 0);
    if (n > 1) chips.push(`<span class="fchip fchip-clear">Tout effacer
      <button data-unset="__all__" aria-label="Effacer tous les filtres">&times;</button></span>`);
    $("#chipbar").innerHTML = chips.join("");
    $("#chipbar").hidden = n === 0;
  }

  /* `soft` : on recalcule et on met a jour tous les compteurs, mais on ne
     repeint pas les cartes. Sert pendant que la liste de valeurs est ouverte :
     cocher trois societes de suite ne doit pas reconstruire quatre cents cartes
     trois fois sous les doigts. La grille est peinte a la fermeture. */
  function render(soft) {
    LIST = ROWS.filter(match);
    DIRTY.list = DIRTY.mine = DIRTY.team = true;

    $("#count").textContent = `${LIST.length} participant${LIST.length > 1 ? "s" : ""}`;
    $("#filters-apply").textContent = LIST.length
      ? `Voir les ${LIST.length} résultats` : "Aucun résultat";
    $("#mine-count").textContent = mineRows().length;

    paintDash(); paintChips(); paintFmenu(); paintPicks();
    if (!soft) paintView(VIEW);
    if (SUBKEY) paintSubFoot();
  }
  function paintView(v) {
    if (v === "list" && DIRTY.list) paintList();
    else if (v === "mine" && DIRTY.mine) paintMine();
    else if (v === "team" && DIRTY.team) paintTeam();
  }

  /* ---------------- Onglets ---------------- */
  function showView(v, fromHist) {
    const prev = VIEW;
    if (v !== VIEW) SCROLL[VIEW] = window.scrollY;
    VIEW = v;
    $$(".tab").forEach(x => {
      const on = x.dataset.view === v;
      x.classList.toggle("on", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".view").forEach(s => s.hidden = true);
    const el = $("#view-" + v);
    el.hidden = false;

    /* Glissement lateral entre onglets. Quatorze pixels, pas la largeur de
       l'ecran : un glissement complet sur une liste de plusieurs centaines de
       lignes coute un reflow visible et se bagarre avec la position de
       defilement qu'on restaure juste apres. Quatorze pixels et un fondu
       suffisent a donner la sensation d'un changement d'ecran. Le sens suit
       l'ordre des onglets, comme sur une application a onglets. */
    if (v !== prev) {
      const back = VIEWS.indexOf(v) < VIEWS.indexOf(prev);
      el.classList.remove("vin-fwd", "vin-back");
      void el.offsetWidth;                       /* relance l'animation */
      el.classList.add(back ? "vin-back" : "vin-fwd");
    }

    if (v === "log") paintLog(); else paintView(v);
    window.scrollTo(0, SCROLL[v] || 0);

    /* Le fragment sert deux choses : les raccourcis du manifeste et une URL
       partageable sur ordinateur. Il est invisible en mode installe. */
    if (!fromHist) {
      try { history.pushState({ fx: { view: v } }, "", "#" + v); } catch (_) {}
    }
  }
  $$(".tab").forEach(t => t.onclick = () => showView(t.dataset.view));

  /* ---------------- Tableau de bord replie ---------------- */
  $("#dash-toggle").onclick = e => {
    const open = document.body.classList.toggle("dash-open");
    e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
  };

  /* ---------------- Interactions sur les cartes ---------------- */
  document.addEventListener("click", async e => {
    const un = e.target.closest("[data-unset]");
    if (un) {
      const k = un.dataset.unset;
      if (k === "__all__") return resetFilters();
      if (k === "hideFluxym") { F.hideFluxym = true; $("#f-hide-fluxym").checked = true; }
      else if (k === "hideEsker") { F.hideEsker = false; $("#f-hide-esker").checked = false; }
      else if (Array.isArray(F[k])) {
        F[k] = [];
        if (subOpen() && SUBKEY === k) paintSubList($("#fsub-q").value);
      }
      return render();
    }
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

  /* La fiche est un panneau lateral sur ordinateur et une feuille plein ecran
     sur telephone. Dans les deux cas : entete fige, corps defilant, bouton
     Enregistrer toujours visible en bas. Le pire cas a eviter est un bouton
     d'action qu'il faut aller chercher au defilement, ou qui passe sous la
     barre d'URL de Safari. */
  function drawer(id, fromHist) {
    const r = ROWS.find(x => x.id === id); if (!r) return;
    const d = $("#drawer");
    $("#drawer-back").hidden = false;
    d.hidden = false;
    if (!fromHist) panelPushed();
    d.innerHTML = `
      <div class="d-top">
        <button class="x" aria-label="Fermer la fiche">&times;</button>
        <h2>${esc(r.full_name)}</h2>
        <div class="d-sub">${esc(r.title||"")}${r.company?" · <b>"+esc(r.company)+"</b>":""}</div>
        <div class="badges">
          ${r.priority?`<i class="bdg ${esc(r.priority)}">Priorité ${esc(r.priority)}</i>`:""}
          ${r.segment?`<i class="bdg">${esc(r.segment)}</i>`:""}
          ${r.seniority?`<i class="bdg">${esc(r.seniority)}</i>`:""}
          ${(r.whova_tags||[]).map(t=>`<i class="bdg loyal">${esc(t)}</i>`).join("")}
        </div>
      </div>
      <div class="d-body">
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
        <div class="fld"><label>Notes</label><textarea id="d-notes" style="min-height:300px">${esc(r.notes||"")}</textarea></div>
        ${msgKind(r) ? `<div class="fld"><label>Message Whova (en anglais) · ${r.message
            ? "votre version, enregistrée le " + FX.fmtDate(r.message_at)
            : "modèle " + esc(MSG_LABEL[msgKind(r)])}</label>
          <textarea id="d-msg" style="min-height:300px">${esc(r.message || template(r))}</textarea>
          <button class="mini" id="d-copy" style="margin:8px 0 0">Copier le message</button>
          ${r.message ? `<button class="mini" id="d-msg-reset" style="margin:8px 0 0">Revenir au modèle</button>` : ""}
          <p class="prio-why">Modifiez librement : votre version est enregistrée avec la fiche et
          remplace le modèle. Le bouton Enregistrer est en bas.</p></div>`
        : `<div class="fld"><label>Message Whova</label>
          <p class="prio-why">Collègue Fluxym : rien à envoyer.</p></div>`}
        <div class="d-meta">Fiche ${esc(r.id)} · page Whova ${esc(r.page_whova)}<br>
          ${r.updated_by ? "Dernière modification : "+esc(r.updated_by)+" le "+FX.fmtDate(r.updated_at) : "Jamais modifiée"}</div>
      </div>
      <div class="d-foot"><button class="d-save" id="d-save">Enregistrer</button></div>`;

    void d.offsetHeight;                 /* force le calcul avant l'animation */
    d.classList.add("open");
    document.body.classList.add("drawer-open");
    /* Glisser l'entete vers le bas ferme la fiche, comme dans les
       applications natives. Le geste est limite a l'entete : dans le corps,
       vers le bas, on defile. */
    wireGrab(d.querySelector(".d-top"), d, () => closeDrawer());

    /* Le bloc message est absent pour un collegue Fluxym : pas de bouton. */
    const copyBtn = $("#d-copy");
    if (copyBtn) copyBtn.onclick = () => navigator.clipboard.writeText($("#d-msg").value)
      .then(() => toast("Message copié", "ok"));

    /* Revenir au modele ne fait que reremplir le champ. C'est l'enregistrement
       qui remet message a null, et il reste donc annulable en refermant. */
    const resetBtn = $("#d-msg-reset");
    if (resetBtn) resetBtn.onclick = () => {
      $("#d-msg").value = template(r);
      toast("Modèle restauré, pensez à enregistrer");
    };
    /* Revenir a la suggestion : on ne fait pas confiance a la valeur affichee,
       on relit priority_auto, qui n'est jamais ecrasee par un humain. */
    const reset = $("#d-prio-reset");
    if (reset) reset.onclick = async () => {
      if (await patch(r.id, { priority: r.priority_auto, priority_manual: false, priority_by: null })) {
        toast("Priorité rendue à la formule", "ok"); drawer(id, true);
      }
    };
    $("#d-save").onclick = async () => {
      const btn = $("#d-save"); btn.disabled = true;
      const p = { owner: $("#d-owner").value || null, status: $("#d-status").value,
                  meeting_slot: $("#d-slot").value || null,
                  interest: $("#d-interest").value || null, notes: $("#d-notes").value || null };
      const np = $("#d-priority").value || null;
      if (np !== r.priority) { p.priority = np; p.priority_manual = true; p.priority_by = me.name; }
      if (p.status !== "A contacter" && !r.contacted_at) p.contacted_at = new Date().toISOString();

      /* Un texte identique au modele est stocke a null : la fiche repart ainsi
         du modele vivant, et un changement de segment ne laisse pas un message
         fige derriere lui. On n'ecrit la colonne que si elle change vraiment,
         pour ne pas deplacer message_at sans raison. */
      const ta = $("#d-msg");
      if (ta) {
        const txt = ta.value.trim();
        const val = (!txt || txt === template(r).trim()) ? null : txt;
        if (val !== (r.message || null)) {
          p.message = val;
          p.message_at = val ? new Date().toISOString() : null;
        }
      }
      if (await patch(r.id, p)) { toast("Fiche enregistrée", "ok"); closeDrawer(); }
      else btn.disabled = false;
    };
  }

  function closeDrawer(fromHist) {
    const d = $("#drawer");
    if (d.hidden) return;
    d.classList.remove("open");
    d.style.transform = "";
    document.body.classList.remove("drawer-open");
    setTimeout(() => { d.hidden = true; $("#drawer-back").hidden = true; d.innerHTML = ""; flush(); }, 260);
    /* L'entree d'historique est retiree tout de suite, sans attendre la fin de
       l'animation : sinon deux gestes retour rapides en enlevent deux. */
    panelPopped(fromHist);
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    /* Echap ferme la couche la plus haute. Chaque fermeture retire elle-meme
       son entree d'historique quand plus rien n'est ouvert. */
    if (subOpen()) closeSub();
    else if (!$("#drawer").hidden) closeDrawer();
    else if (sheet.open) closeSheet();
  });

  /* ---------------- Export ---------------- */
  $("#export-btn").onclick = () => {
    const cols = ["id","full_name","title","company","location","segment","job_function",
                  "seniority","priority","owner","status","meeting_slot","interest","notes",
                  "message"];
    const csv = [cols.join(";")].concat(ROWS.filter(match).map(r =>
      cols.map(c => `"${String(r[c] ?? "").replace(/"/g,'""')}"`).join(";"))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8" }));
    a.download = `esker-all-access-2026-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  /* ==========================================================================
     COPIE LOCALE DE L'ANNUAIRE, BANDEAU, SERVICE WORKER

     Trois choses qui n'existent que pour un seul scenario : le wifi du centre
     de congres de Rosemont, un mardi matin, avec quatre cents personnes qui
     s'y connectent en meme temps.

     Ce que la copie locale N'EST PAS : une base de donnees hors ligne. Aucune
     ecriture n'est possible sans reseau, et c'est voulu. Deux personnes qui
     s'attribueraient le meme contact chacune de son cote, hors ligne, puis se
     synchroniseraient, produiraient exactement le probleme que cette
     application est censee resoudre. La copie locale sert a LIRE : savoir en
     cinq secondes si un participant est deja pris, et par qui.

     Ce qu'elle contient : les 497 fiches, noms et societes compris, en clair
     dans le stockage local du navigateur. C'est une donnee personnelle, mais
     elle n'ajoute pas de risque nouveau : la session Supabase y est deja, donc
     un telephone deverrouille donnait deja acces a l'annuaire. Elle est
     effacee a la deconnexion, avec le reste des cles fx.* (voir js/api.js).
     ========================================================================== */
  const ROWS_K = "fx.rows.v1";
  let CACHE_AT = 0;

  function keepRows(rows) {
    try { localStorage.setItem(ROWS_K, JSON.stringify({ at: Date.now(), rows })); CACHE_AT = Date.now(); }
    catch (_) { /* quota plein : on continue sans copie locale */ }
  }
  function recallRows() {
    try {
      const k = JSON.parse(localStorage.getItem(ROWS_K) || "null");
      return k && Array.isArray(k.rows) && k.rows.length ? k : null;
    } catch (_) { return null; }
  }

  /* ---------------- Bandeau de service ----------------
     Un seul bandeau, deux messages possibles. Une nouvelle version prime sur
     l'etat du reseau : elle demande une action, l'autre est une information. */
  const bar = $("#fx-bar"), barTxt = $("#fx-bar-txt"), barAct = $("#fx-bar-act");
  const hasBar = !!(bar && barTxt && barAct);
  let BAR = null;

  /* Si index.html n'a pas ete deploye en meme temps que ce fichier, le bandeau
     n'existe pas. Ce n'est pas une raison pour perdre l'annuaire : on se tait
     et tout le reste continue de fonctionner. */
  function setBar(kind, txt, actLabel, act) {
    if (!hasBar) return;
    if (BAR === "update" && kind !== "update") return;
    BAR = kind; barTxt.textContent = txt;
    barAct.hidden = !actLabel;
    if (actLabel) { barAct.textContent = actLabel; barAct.onclick = act; }
    bar.hidden = false;
    bar.dataset.kind = kind;
  }
  function clearBar(kind) {
    if (!hasBar || BAR !== kind) return;
    BAR = null; bar.hidden = true; barAct.onclick = null;
  }
  const barX = $("#fx-bar-x");
  if (barX) barX.onclick = () => { bar.hidden = true; };

  const hhmm = t => new Date(t).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" });

  function offline(on) {
    if (!on) { clearBar("offline"); return; }
    setBar("offline", CACHE_AT
      ? "Hors connexion. Donnees locales de " + hhmm(CACHE_AT) + ", aucune modification possible."
      : "Hors connexion. Aucune modification possible.");
  }
  window.addEventListener("offline", () => offline(true));
  window.addEventListener("online",  () => { offline(false); load(); });

  /* ---------------- Service worker ----------------
     Il n'apporte qu'une chose : l'application s'ouvre sans attendre le reseau.
     Il ne decide jamais seul de passer a une nouvelle version. */
  if ("serviceWorker" in navigator) {
    const offerUpdate = reg => setBar("update",
      "Nouvelle version disponible.", "Recharger", () => {
        if (reg.waiting) reg.waiting.postMessage("fx-skip-waiting");
        else location.reload();
      });

    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing; if (!sw) return;
        sw.addEventListener("statechange", () => {
          /* `controller` non nul veut dire qu'une version tournait deja : sans
             cela, il s'agit de la toute premiere installation et il n'y a rien
             a proposer. */
          if (sw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(reg);
        });
      });
    }).catch(() => { /* pas de mode hors connexion, l'application marche quand meme */ });

    /* Un rechargement n'a de sens que si une version tournait deja. A la
       toute premiere installation, `clients.claim()` fait passer la page sous
       controle du service worker et declenche cet evenement : recharger a ce
       moment-la infligerait un rechargement surprise des la premiere visite,
       potentiellement en pleine saisie. On note donc l'etat de depart. */
    const wasControlled = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!wasControlled || reloaded) return;
      reloaded = true; location.reload();
    });
  }

  /* ---------------- Demarrage ----------------
     La copie locale s'affiche AVANT la reponse du reseau. C'est tout l'objet
     de l'exercice : de l'annuaire a l'ecran en une fraction de seconde, puis
     un remplacement silencieux quand les donnees fraiches arrivent. */
  const kept = recallRows();
  if (kept) {
    CACHE_AT = kept.at;
    ROWS = kept.rows;
    buildFilters();
    render();
  }

  await load();

  /* Etat initial de l'historique, et lecture du fragment : ouvrir directement
     un onglet depuis un raccourci du manifeste, ou depuis un lien partage. */
  const h = (location.hash || "").replace("#", "");
  const v0 = VIEWS.includes(h) ? h : "list";
  try { history.replaceState({ fx: { view: v0 } }, "", "#" + v0); } catch (_) {}
  if (v0 !== "list") showView(v0, true);

  if (!navigator.onLine) offline(true);
  startPoll();
})();
