/* --------------------------------------------------------------------------
   Barre de navigation partagee.

   Le lien Administration n'est rendu que pour un proprietaire : masquer une
   page n'est pas une protection, mais afficher un lien qui menerait a un
   refus est une mauvaise maniere.

   Sur telephone, la barre garde une hauteur fixe (52px) et les liens de
   pages passent dans un menu deroulant. Deux raisons, dans cet ordre :
   1. une barre qui change de hauteur fausse le calcul de --stick, donc les
      ancres A-Z de l'annuaire atterrissent sous l'entete ;
   2. la navigation utile pendant l'evenement (annuaire, portefeuille,
      equipe, journal) est assuree par la barre basse, pas par ces liens.
   -------------------------------------------------------------------------- */
window.renderNav = function (active) {
  const me   = FX.me;
  const esc  = FX.esc;
  const links = [
    ["index.html",   "Annuaire",       true],
    ["methode.html", "Méthode",        true],
    ["compte.html",  "Mon compte",     true],
    /* Reserves au proprietaire. Le bareme est separe de l'administration a
       dessein : administrer, c'est ouvrir et fermer des comptes ; regler le
       bareme, c'est changer le classement de toute l'equipe. Deux gestes de
       nature differente, deux ecrans. */
    ["bareme.html",  "Barème",         !!me.is_owner],
    ["admin.html",   "Administration", !!me.is_owner]
  ].filter(l => l[2]);

  const linkList = cls => links
    .map(([h, l]) => `<a href="${h}" class="${cls}${active === h ? " on" : ""}">${esc(l)}</a>`)
    .join("");

  const nav = document.getElementById("main-nav");
  nav.innerHTML = `
    <div class="nav-in">
      <a class="nav-brand" href="index.html">FLUXYM<span>Esker All Access 2026</span></a>
      <div class="nav-links">${linkList("")}</div>
      <div class="nav-right">
        <span class="nav-me" style="background:${esc(me.color)}" title="${esc(me.email || "")}">
          ${esc(me.name)}${me.is_owner ? " · propriétaire" : ""}
        </span>
        <button class="nav-out" id="nav-logout" type="button">Déconnexion</button>
        <button class="nav-burger" id="nav-burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu">
          <span class="nav-ini" style="background:${esc(me.color)}">${esc(FX.initials(me.name))}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
    </div>
    <div class="nav-menu" id="nav-menu">
      <div class="nav-menu-in">
        <div class="nav-who">
          <span class="nav-ini" style="background:${esc(me.color)}">${esc(FX.initials(me.name))}</span>
          <div>
            <b>${esc(me.name)}</b>
            <span>${me.is_owner ? "Propriétaire" : "Membre"} · ${esc(FX.toHandle(me.email || me.auth_email))}</span>
          </div>
        </div>
        <div class="nav-menu-links">${linkList("nav-mlink")}</div>
        <button class="nav-mout" id="nav-logout-m" type="button">Déconnexion</button>
      </div>
    </div>`;

  const closeMenu = () => {
    document.body.classList.remove("nav-open");
    document.getElementById("nav-burger").setAttribute("aria-expanded", "false");
  };

  document.getElementById("nav-burger").onclick = e => {
    e.stopPropagation();
    const open = document.body.classList.toggle("nav-open");
    e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
  };
  document.getElementById("nav-logout").onclick   = FX.logout;
  document.getElementById("nav-logout-m").onclick = FX.logout;

  /* Un menu qui ne se referme pas au premier geste exterieur est un menu qui
     gene. Clic ailleurs, touche Echap, ou choix d'un lien : il disparait. */
  document.addEventListener("click", e => {
    if (!document.body.classList.contains("nav-open")) return;
    if (e.target.closest("#nav-menu") && !e.target.closest("a")) return;
    if (e.target.closest("#nav-burger")) return;
    closeMenu();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
};
