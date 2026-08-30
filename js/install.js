/* --------------------------------------------------------------------------
   INSTALLATION SUR L'ECRAN D'ACCUEIL
   Fluxym · Stand Esker All Access 2026

   Pourquoi ce fichier existe.

   Le service worker rend l'annuaire consultable quand le wifi du centre de
   congres tombe, mais il ne sert a rien si l'application est ouverte dans un
   onglet perdu au milieu de quinze autres. Le 8 septembre, entre deux
   conversations, on n'ouvre pas un navigateur puis un onglet : on touche une
   icone. Ce fichier existe pour que l'annuaire soit sur l'ecran d'accueil des
   quatre telephones avant le 7 au soir.

   Le principe, et il n'est pas negociable : on n'affiche jamais une consigne
   que l'utilisateur ne peut pas suivre. C'est tout le probleme du sujet.

   1. Android, Chrome et Edge : le navigateur previent qu'il sait installer
      (`beforeinstallprompt`). On garde l'evenement de cote et le bouton
      declenche la vraie boite de dialogue du systeme. Un seul geste.

   2. iPhone dans Safari : aucune API, iOS n'en fournit aucune. La seule voie
      est Partager puis « Sur l'ecran d'accueil ». On explique donc le geste,
      avec le pictogramme exact que la personne a sous les yeux.

   3. iPhone AILLEURS QUE DANS SAFARI, et c'est le cas qui casse tout. Un lien
      envoye par WhatsApp, Teams, LinkedIn ou Gmail s'ouvre dans le navigateur
      integre a ces applications. « Sur l'ecran d'accueil » n'y existe pas.
      Afficher la consigne de Safari dans ce contexte, c'est envoyer quelqu'un
      chercher un bouton qui n'est pas la, et c'est exactement le probleme
      constate. On detecte donc le cas et on dit d'abord d'ouvrir la page dans
      Safari, avec le lien pret a etre copie.

      La detection ne repose pas sur l'agent utilisateur, qui ne dit rien de
      fiable pour ces navigateurs integres : `navigator.standalone` n'existe
      que dans Safari mobile et dans une application deja installee. Absent
      sur un iPhone, c'est une webview.

   4. Ordinateur hors Chrome et Edge : Safari macOS sait faire (Fichier, puis
      Ajouter au Dock), Firefox ne sait pas. On le dit, plutot que de laisser
      quelqu'un chercher.

   Ce fichier n'ecrit rien dans Supabase, ne lit aucune donnee et ne depend pas
   de FX : charge apres js/app.js, il fonctionne meme si l'annuaire echoue.
   Tout son balisage est cree ici, pour qu'index.html n'ait que deux lignes a
   porter et que deux livraisons paralleles ne se marchent pas dessus.
   -------------------------------------------------------------------------- */
(function () {
  "use strict";

  var HINT_OFF = "fx.install.hint.v1";   /* invitation refusee : on n'insiste plus */
  var UA       = navigator.userAgent || "";
  var LINK     = location.origin + location.pathname.replace(/[^/]*$/, "");
  var deferred = null;                   /* l'evenement Chrome mis de cote      */

  var isIOS    = /iPad|iPhone|iPod/.test(UA) ||
                 (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(UA);
  var isMacSaf  = !isIOS && /Macintosh/.test(UA) && /Safari/.test(UA) &&
                  !/Chrome|Chromium|Edg\//.test(UA);
  var iosNamed  = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(UA);
  var iosInApp  = isIOS && !iosNamed && typeof navigator.standalone === "undefined";

  /* Deja installee : aucun bouton, aucun bandeau, jamais. Une invitation a
     installer ce qui est deja installe est le meilleur moyen de faire douter
     quelqu'un de ce qu'il a sous les yeux. */
  function installed() {
    return (window.matchMedia && (window.matchMedia("(display-mode: standalone)").matches ||
                                  window.matchMedia("(display-mode: minimal-ui)").matches)) ||
           navigator.standalone === true;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------- contenus */

  var SHARE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 3v11"/><path d="m8 6.5 4-3.5 4 3.5"/><path d="M6 12v8h12v-8"/></svg>';
  var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 9v6M9 12h6"/></svg>';
  var DOTS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';

  function step(n, html) {
    return '<li><i>' + n + '</i><div>' + html + '</div></li>';
  }

  /* Le mode decide de tout : le libelle du bouton et le contenu de la fiche.
     Il est recalcule a chaque ouverture, parce qu'un `beforeinstallprompt`
     peut arriver apres le premier affichage. */
  function mode() {
    if (deferred)  return "prompt";
    if (iosInApp || iosNamed) return "ios-ailleurs";
    if (isIOS)     return "ios-safari";
    if (isAndroid) return "android-menu";
    if (isMacSaf)  return "mac-safari";
    return "bureau";
  }

  function sheetBody(m) {
    if (m === "prompt") {
      return '<p class="fxi-lead">Votre navigateur sait le faire tout seul. Un geste, et l\'annuaire ' +
             'rejoint votre écran d\'accueil.</p>' +
             '<button type="button" class="fxi-cta" id="fxi-do">Installer maintenant</button>';
    }
    if (m === "ios-safari") {
      return '<p class="fxi-lead">iOS ne propose aucun bouton d\'installation : le geste passe ' +
             'obligatoirement par le menu de partage de Safari.</p>' +
             '<ol class="fxi-steps">' +
             step(1, 'Touchez <b>Partager</b> ' + SHARE_SVG + ' dans la barre de Safari, en bas de l\'écran.') +
             step(2, 'Faites défiler la liste et touchez <b>Sur l\'écran d\'accueil</b> ' + PLUS_SVG + '.') +
             step(3, 'Touchez <b>Ajouter</b>, en haut à droite.') +
             '</ol>' +
             '<p class="fxi-note">L\'icône <b>E</b> bleu nuit apparaît sur votre écran d\'accueil. ' +
             'L\'annuaire s\'ouvre alors sans barre d\'adresse, et reste consultable quand le réseau ' +
             'du centre de congrès décroche.</p>';
    }
    if (m === "ios-ailleurs") {
      return '<p class="fxi-lead">Cette page n\'est pas ouverte dans Safari, et l\'ajout à l\'écran ' +
             'd\'accueil n\'existe nulle part ailleurs sur iPhone. Deux étapes, dans cet ordre.</p>' +
             '<ol class="fxi-steps">' +
             step(1, 'Ouvrez cette page dans <b>Safari</b> : touchez ' + DOTS_SVG +
                     ' ou ' + SHARE_SVG + ' puis <b>Ouvrir dans Safari</b>. Si vous ne trouvez pas, ' +
                     'copiez le lien ci-dessous et collez-le dans Safari.') +
             step(2, 'Dans Safari, touchez <b>Partager</b> ' + SHARE_SVG +
                     ' puis <b>Sur l\'écran d\'accueil</b>.') +
             '</ol>' +
             '<button type="button" class="fxi-cta ghosted" id="fxi-copy">Copier le lien de l\'annuaire</button>' +
             '<p class="fxi-note" id="fxi-copied" hidden>Lien copié.</p>';
    }
    if (m === "android-menu") {
      return '<p class="fxi-lead">Ce navigateur n\'a pas proposé l\'installation automatique. ' +
             'Elle reste possible par son menu.</p>' +
             '<ol class="fxi-steps">' +
             step(1, 'Touchez ' + DOTS_SVG + ' en haut à droite.') +
             step(2, 'Touchez <b>Installer l\'application</b>, ou <b>Ajouter à l\'écran d\'accueil</b> ' +
                     'selon le navigateur.') +
             '</ol>' +
             '<p class="fxi-note">Si aucune de ces entrées n\'apparaît, ouvrez la page dans Chrome : ' +
             'le bouton d\'installation y est direct.</p>';
    }
    if (m === "mac-safari") {
      return '<p class="fxi-lead">Sur Mac, Safari installe l\'annuaire dans le Dock.</p>' +
             '<ol class="fxi-steps">' +
             step(1, 'Menu <b>Fichier</b>, puis <b>Ajouter au Dock</b>.') +
             '</ol>' +
             '<p class="fxi-note">Cela reste un usage de préparation. Sur le stand, c\'est le téléphone ' +
             'qui sert : installez aussi l\'annuaire sur le vôtre.</p>';
    }
    return '<p class="fxi-lead">Ce navigateur ne sait pas installer une application web. ' +
           'Ce n\'est pas grave : ce qui compte, c\'est le téléphone que vous aurez en main sur le stand.</p>' +
           '<ol class="fxi-steps">' +
           step(1, 'Ouvrez ce lien sur votre téléphone, dans <b>Safari</b> (iPhone) ou <b>Chrome</b> (Android).') +
           step(2, 'Rouvrez ce même bouton depuis le téléphone : la marche à suivre y sera adaptée.') +
           '</ol>' +
           '<button type="button" class="fxi-cta ghosted" id="fxi-copy">Copier le lien de l\'annuaire</button>' +
           '<p class="fxi-note" id="fxi-copied" hidden>Lien copié.</p>';
  }

  /* ------------------------------------------------------------------ fiche */

  var back = null, sheet = null;

  function closeSheet() {
    if (!sheet) return;
    document.body.classList.remove("fxi-open");
    sheet.hidden = true;
    back.hidden = true;
  }

  function openSheet() {
    var m = mode();

    if (!sheet) {
      back = document.createElement("div");
      back.className = "fxi-back";
      back.hidden = true;
      back.addEventListener("click", closeSheet);

      sheet = document.createElement("section");
      sheet.className = "fxi-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.setAttribute("aria-label", "Installer l'annuaire sur l'écran d'accueil");
      sheet.hidden = true;

      document.body.appendChild(back);
      document.body.appendChild(sheet);

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeSheet();
      });
    }

    sheet.innerHTML =
      '<header class="fxi-head">' +
        '<h2>Installer l\'annuaire</h2>' +
        '<button type="button" class="fxi-x" aria-label="Fermer">&times;</button>' +
      '</header>' +
      '<div class="fxi-body">' + sheetBody(m) + '</div>';

    sheet.querySelector(".fxi-x").onclick = closeSheet;

    var go = sheet.querySelector("#fxi-do");
    if (go) go.onclick = runPrompt;

    var cp = sheet.querySelector("#fxi-copy");
    if (cp) cp.onclick = function () {
      var ok = function () {
        var n = sheet.querySelector("#fxi-copied");
        if (n) n.hidden = false;
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(LINK).then(ok, function () { fallbackCopy(ok); });
      } else fallbackCopy(ok);
    };

    back.hidden = false;
    sheet.hidden = false;
    document.body.classList.add("fxi-open");
    hideHint();
  }

  function fallbackCopy(done) {
    var t = document.createElement("textarea");
    t.value = LINK;
    t.setAttribute("readonly", "readonly");
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* rien a promettre */ }
    document.body.removeChild(t);
  }

  /* La vraie boite de dialogue, quand le navigateur l'a proposee. Un
     `beforeinstallprompt` ne se rejoue pas : une fois consomme, il est perdu,
     et le bouton doit alors retomber sur les consignes manuelles. */
  function runPrompt() {
    if (!deferred) { openSheet(); return; }
    var p = deferred;
    deferred = null;
    p.prompt();
    p.userChoice.then(function (r) {
      if (r && r.outcome === "accepted") teardown();
      else closeSheet();
    }, closeSheet);
  }

  /* ----------------------------------------------------- points d'entree UI */

  /* Le bouton vit dans la navigation, donc dans un balisage que js/nav.js
     reecrit entierement a chaque rendu. On l'injecte donc a chaque fois que
     #main-nav change, sans toucher a nav.js : deux sujets en parallele qui
     modifient le meme fichier, c'est une livraison qui efface l'autre. */
  function injectNav() {
    var nav = document.getElementById("main-nav");
    if (!nav) return;

    var right = nav.querySelector(".nav-right");
    if (right && !right.querySelector(".fxi-navbtn")) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fxi-navbtn";
      b.title = "Poser l'annuaire sur l'écran d'accueil";
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 4v10"/><path d="m8 10.5 4 3.5 4-3.5"/><path d="M5 19h14"/></svg>' +
        '<span>Installer</span>';
      b.onclick = openSheet;
      right.insertBefore(b, right.firstChild);
    }

    var menu = nav.querySelector(".nav-menu-links");
    if (menu && !menu.querySelector(".fxi-mlink")) {
      var m = document.createElement("button");
      m.type = "button";
      m.className = "nav-mlink fxi-mlink";
      m.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 4v10"/><path d="m8 10.5 4 3.5 4-3.5"/><path d="M5 19h14"/></svg>' +
        'Installer l\'application';
      m.onclick = function () {
        document.body.classList.remove("nav-open");
        openSheet();
      };
      menu.appendChild(m);
    }
  }

  /* L'invitation basse. Trois precautions, parce qu'un bandeau qui tombe au
     mauvais moment est une nuisance :
     - une seule fois par appareil, refus memorise ;
     - jamais tant que le bandeau de service (#fx-bar) parle, parce que
       « hors connexion » et « nouvelle version » passent devant ;
     - seulement une fois la navigation rendue, c'est-a-dire une fois la
       session ouverte et l'annuaire affiche. */
  var hint = null;

  function hideHint() {
    if (hint) { hint.remove(); hint = null; }
  }

  function showHint() {
    if (hint || installed()) return;
    if (localStorage.getItem(HINT_OFF) === "1") return;
    var bar = document.getElementById("fx-bar");
    if (bar && !bar.hidden) return;
    if (!document.querySelector("#main-nav .nav-in")) return;

    hint = document.createElement("div");
    hint.className = "fxi-hint";
    hint.setAttribute("role", "status");
    hint.innerHTML =
      '<div class="fxi-hint-txt"><b>Posez l\'annuaire sur votre écran d\'accueil</b>' +
      '<span>Il s\'ouvre en plein écran, et reste consultable quand le wifi du centre décroche.</span></div>' +
      '<div class="fxi-hint-act">' +
        '<button type="button" class="fxi-hint-go">Comment faire</button>' +
        '<button type="button" class="fxi-hint-x" aria-label="Ne plus proposer">&times;</button>' +
      '</div>';
    hint.querySelector(".fxi-hint-go").onclick = openSheet;
    hint.querySelector(".fxi-hint-x").onclick = function () {
      try { localStorage.setItem(HINT_OFF, "1"); } catch (e) {}
      hideHint();
    };
    document.body.appendChild(hint);
  }

  function teardown() {
    hideHint();
    closeSheet();
    var n = document.querySelectorAll(".fxi-navbtn,.fxi-mlink");
    for (var i = 0; i < n.length; i++) n[i].remove();
    try { localStorage.setItem(HINT_OFF, "1"); } catch (e) {}
  }

  /* ---------------------------------------------------------------- amorcage */

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();          /* sinon Chrome affiche sa propre banniere    */
    deferred = e;
  });

  /* Installee pendant la session : les boutons doivent disparaitre sans
     rechargement, sinon on propose d'installer ce qui vient de l'etre. */
  window.addEventListener("appinstalled", teardown);

  if (installed()) return;

  var obs = new MutationObserver(injectNav);
  function start() {
    var nav = document.getElementById("main-nav");
    if (!nav) return;
    injectNav();
    obs.observe(nav, { childList: true, subtree: true });
    setTimeout(showHint, 4000);   /* jamais devant la premiere recherche */
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else start();
})();
