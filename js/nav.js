/* Barre de navigation partagee. Le lien Administration n'est rendu que pour
   un proprietaire : masquer une page n'est pas une protection, mais afficher
   un lien qui menerait a un refus est une mauvaise maniere. */
window.renderNav = function (active) {
  const me = FX.me;
  const links = [
    ["index.html",  "Annuaire",  true],
    ["compte.html", "Mon compte", true],
    ["admin.html",  "Administration", !!me.is_owner]
  ].filter(l => l[2]);

  document.getElementById("main-nav").innerHTML = `
    <div class="nav-in">
      <a class="nav-brand" href="index.html">FLUXYM<span>Esker All Access 2026</span></a>
      <div class="nav-links">
        ${links.map(([h, l]) => `<a href="${h}" class="${active === h ? "on" : ""}">${l}</a>`).join("")}
      </div>
      <div class="nav-right">
        <span class="nav-me" style="background:${FX.esc(me.color)}" title="${FX.esc(me.email || "")}">
          ${FX.esc(me.name)}${me.is_owner ? " · proprietaire" : ""}
        </span>
        <button class="nav-out" id="nav-logout">Deconnexion</button>
      </div>
    </div>`;
  document.getElementById("nav-logout").onclick = FX.logout;
};
