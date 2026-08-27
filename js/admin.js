(async () => {
  const { me } = await FX.requireSession();
  renderNav("admin.html");

  /* Un membre qui arrive ici par l'URL est renvoye a l'annuaire. Cette page
     ne protege rien par elle-meme : la veritable barriere est dans
     l'Edge Function, qui refuse toute action a un non-proprietaire. */
  if (!me.is_owner) { location.replace("index.html"); return; }

  const tb = FX.$("#users tbody");
  let USERS = [];

  /* ---------------- Liste ---------------- */
  async function refresh() {
    try {
      const { users } = await FX.admin("list");
      USERS = users;
    } catch (e) { FX.toast(e.message, "bad"); return; }

    FX.$("#users-empty").hidden = USERS.length > 0;
    tb.innerHTML = USERS.map(u => `
      <tr class="${u.active ? "" : "off"}">
        <td>
          <div class="u-cell">
            <span class="dot" style="background:${FX.esc(u.color)}"></span>
            <div>
              <b>${FX.esc(u.name)}</b>
              ${u.user_id === me.user_id ? '<i class="tag self">vous</i>' : ""}
              ${u.orphan ? '<i class="tag warn">sans compte</i>' : ""}
              ${!u.active ? '<i class="tag off">désactivé</i>' : ""}
              <div class="u-sub">${FX.esc(u.email || "—")}${u.role ? " · " + FX.esc(u.role) : ""}</div>
            </div>
          </div>
        </td>
        <td>${u.is_owner ? '<i class="tag owner">Propriétaire</i>' : '<i class="tag">Membre</i>'}</td>
        <td><b>${u.portfolio}</b> <span class="u-sub">dont ${u.contacted} contactés</span></td>
        <td class="u-sub">${FX.fmtDate(u.last_sign_in_at)}</td>
        <td class="ta-r nowrap">
          <button class="mini"      data-edit="${u.user_id || ""}">Modifier</button>
          <button class="mini"      data-pass="${u.user_id || ""}">Mot de passe</button>
          <button class="mini danger" data-del="${u.user_id || ""}">Supprimer</button>
        </td>
      </tr>`).join("");
  }

  /* ---------------- Creation ---------------- */
  FX.$("#new-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = FX.$("#n-btn"), err = FX.$("#n-err");
    err.textContent = ""; btn.disabled = true; btn.textContent = "Création…";
    try {
      const r = await FX.admin("create", {
        name:     FX.$("#n-name").value.trim(),
        email:    FX.$("#n-email").value.trim(),
        role:     FX.$("#n-role").value.trim(),
        color:    FX.$("#n-color").value,
        password: FX.$("#n-pass").value.trim() || null,
        is_owner: FX.$("#n-owner").checked
      });
      FX.$("#new-form").reset(); FX.$("#n-color").value = "#6366f1";
      showCredentials("Compte créé", r.email, r.password, r.generated);
      await refresh();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false; btn.textContent = "Créer le compte";
  });

  /* Le mot de passe n'est lisible qu'ici, une seule fois : il n'est stocke
     nulle part en clair et ne pourra pas etre reaffiche ensuite. */
  function showCredentials(title, email, password, generated) {
    const box = FX.$("#reveal");
    box.hidden = false;
    box.innerHTML = `
      <div class="rev-h">${FX.esc(title)}</div>
      <p>${generated ? "Mot de passe généré automatiquement." : "Mot de passe défini manuellement."}
         Il n'est affiché <b>qu'une seule fois</b> : transmettez-le maintenant.</p>
      <div class="rev-grid">
        <div><span>Identifiant</span><code>${FX.esc(email)}</code></div>
        <div><span>Mot de passe</span><code class="big">${FX.esc(password)}</code></div>
      </div>
      <button class="mini" id="rev-copy">Copier les deux</button>
      <button class="mini" id="rev-close">J'ai transmis, masquer</button>`;
    FX.$("#rev-copy").onclick = () => {
      navigator.clipboard.writeText(
        `Application stand Esker All Access 2026\n${location.origin}${location.pathname.replace(/admin\.html$/, "")}\n\nIdentifiant : ${email}\nMot de passe : ${password}\n\nÀ changer depuis « Mon compte » après la première connexion.`
      ).then(() => FX.toast("Identifiants copiés", "ok"));
    };
    FX.$("#rev-close").onclick = () => { box.hidden = true; box.innerHTML = ""; };
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------------- Modale ---------------- */
  const closeModal = () => { FX.$("#modal").hidden = true; FX.$("#modal-back").hidden = true; };
  FX.$("#modal-back").onclick = closeModal;
  document.addEventListener("keydown", e => e.key === "Escape" && closeModal());

  function openModal(html, wire) {
    FX.$("#modal-back").hidden = false;
    const m = FX.$("#modal"); m.hidden = false; m.innerHTML = html;
    m.querySelector("[data-close]")?.addEventListener("click", closeModal);
    wire?.(m);
  }

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-edit],[data-pass],[data-del]");
    if (!b) return;
    const id = b.dataset.edit || b.dataset.pass || b.dataset.del;
    const u = USERS.find(x => x.user_id === id);
    if (!u) return FX.toast("Cette fiche n'a pas de compte associé.", "bad");

    /* ---- Modifier ---- */
    if (b.dataset.edit) openModal(`
      <button class="x" data-close>&times;</button>
      <h3>Modifier ${FX.esc(u.name)}</h3>
      <form class="form" id="ed">
        <label>Nom affiché<input id="e-name" value="${FX.esc(u.name)}" required>
          <small>Le renommage suit automatiquement les contacts déjà attribués.</small></label>
        <label>Fonction<input id="e-role" value="${FX.esc(u.role || "")}"></label>
        <label>Couleur<input id="e-color" type="color" value="${FX.esc(u.color)}"></label>
        <label class="switch"><input type="checkbox" id="e-owner" ${u.is_owner ? "checked" : ""}>
          <span>Propriétaire</span></label>
        <label class="switch"><input type="checkbox" id="e-active" ${u.active ? "checked" : ""}>
          <span>Compte actif <small>décocher coupe l'accès sans rien supprimer</small></span></label>
        <button type="submit">Enregistrer</button>
        <div class="err" id="e-err"></div>
      </form>`, m => {
        m.querySelector("#ed").onsubmit = async ev => {
          ev.preventDefault();
          try {
            await FX.admin("update", {
              user_id: u.user_id,
              name:  m.querySelector("#e-name").value.trim(),
              role:  m.querySelector("#e-role").value.trim(),
              color: m.querySelector("#e-color").value,
              is_owner: m.querySelector("#e-owner").checked,
              active:   m.querySelector("#e-active").checked
            });
            closeModal(); FX.toast("Compte mis à jour", "ok"); refresh();
          } catch (ex) { m.querySelector("#e-err").textContent = ex.message; }
        };
      });

    /* ---- Mot de passe ---- */
    if (b.dataset.pass) openModal(`
      <button class="x" data-close>&times;</button>
      <h3>Mot de passe de ${FX.esc(u.name)}</h3>
      <p class="modal-p">Vous ne pouvez pas lire le mot de passe actuel, seulement le remplacer.
         Laissez le champ vide pour en générer un lisible.</p>
      <form class="form" id="pf">
        <label>Nouveau mot de passe<input id="p-val" type="text" placeholder="vide = généré"></label>
        <button type="submit">Réinitialiser</button>
        <div class="err" id="p-err"></div>
      </form>`, m => {
        m.querySelector("#pf").onsubmit = async ev => {
          ev.preventDefault();
          try {
            const r = await FX.admin("password", {
              user_id: u.user_id, password: m.querySelector("#p-val").value.trim() || null
            });
            closeModal(); showCredentials("Mot de passe réinitialisé", r.email, r.password, r.generated);
          } catch (ex) { m.querySelector("#p-err").textContent = ex.message; }
        };
      });

    /* ---- Suppression ---- */
    if (b.dataset.del) openModal(`
      <button class="x" data-close>&times;</button>
      <h3>Supprimer ${FX.esc(u.name)} ?</h3>
      <p class="modal-p">Le compte est supprimé définitivement.
         ${u.portfolio ? `<b>${u.portfolio} contact${u.portfolio > 1 ? "s" : ""}</b> qu'il suivait
           ${u.portfolio > 1 ? "redeviendront libres" : "redeviendra libre"} et devront être réattribués.`
          : "Aucun contact ne lui est attribué."}</p>
      <p class="modal-p">Pour simplement lui couper l'accès en conservant son portefeuille,
         préférez <b>Modifier</b> puis décocher « Compte actif ».</p>
      <form class="form" id="df">
        <label>Tapez <code>${FX.esc(u.name)}</code> pour confirmer<input id="d-val" autocomplete="off"></label>
        <button type="submit" class="danger">Supprimer définitivement</button>
        <div class="err" id="d-err"></div>
      </form>`, m => {
        m.querySelector("#df").onsubmit = async ev => {
          ev.preventDefault();
          if (m.querySelector("#d-val").value.trim() !== u.name) {
            m.querySelector("#d-err").textContent = "Le nom saisi ne correspond pas."; return;
          }
          try {
            const r = await FX.admin("delete", { user_id: u.user_id });
            closeModal();
            FX.toast(`${r.name} supprimé${r.contacts_released ? ` · ${r.contacts_released} contact(s) libéré(s)` : ""}`, "ok");
            refresh();
          } catch (ex) { m.querySelector("#d-err").textContent = ex.message; }
        };
      });
  });

  await refresh();
})();
