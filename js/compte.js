(async () => {
  const { me } = await FX.requireSession();
  renderNav("compte.html");

  const rows = [
    ["Nom affiché",   me.name],
    ["Adresse e-mail", me.email || me.auth_email],
    ["Fonction",       me.role || "—"],
    ["Niveau d'accès", me.is_owner ? "Propriétaire (peut gérer les comptes)" : "Membre"],
    ["Compte actif",   me.active ? "Oui" : "Non"],
    ["Couleur",        `<span class="swatch" style="background:${FX.esc(me.color)}"></span> ${FX.esc(me.color)}`]
  ];
  FX.$("#me-list").innerHTML = rows
    .map(([k, v]) => `<dt>${FX.esc(k)}</dt><dd>${k === "Couleur" ? v : FX.esc(v)}</dd>`).join("");

  FX.$("#pw-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = FX.$("#pw-btn"), err = FX.$("#pw-err");
    const old = FX.$("#old").value, n1 = FX.$("#new1").value, n2 = FX.$("#new2").value;
    err.textContent = "";

    if (n1 !== n2)     { err.textContent = "Les deux nouveaux mots de passe ne correspondent pas."; return; }
    if (n1.length < 8) { err.textContent = "Le mot de passe doit faire au moins 8 caractères."; return; }
    if (n1 === old)    { err.textContent = "Le nouveau mot de passe est identique à l'ancien."; return; }

    btn.disabled = true; btn.textContent = "Modification…";

    /* L'ancien mot de passe est exige, et verifie en le rejouant. Ce n'est pas
       une formalite : c'est ce qui empeche un poste laisse deverrouille de
       servir a enfermer quelqu'un dehors. */
    const { error: bad } = await FX.sb.auth.signInWithPassword({
      email: me.auth_email, password: old
    });
    if (bad) {
      btn.disabled = false; btn.textContent = "Changer mon mot de passe";
      err.textContent = "Mot de passe actuel incorrect."; return;
    }

    const { error } = await FX.sb.auth.updateUser({ password: n1 });
    btn.disabled = false; btn.textContent = "Changer mon mot de passe";
    if (error) { err.textContent = "Échec : " + error.message; return; }

    FX.$("#pw-form").reset();
    FX.toast("Mot de passe modifié.", "ok");
  });
})();
