(async () => {
  if (new URLSearchParams(location.search).has("denied")) {
    FX.$("#err").textContent = "Ce compte n'est pas autorise sur cet evenement.";
  }
  /* Deja connecte : on ne laisse pas l'ecran de login visible. */
  const { data } = await FX.sb.auth.getSession();
  if (data.session) location.replace("index.html");

  FX.$("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = FX.$("#login-btn");
    btn.disabled = true; btn.textContent = "Connexion…"; FX.$("#err").textContent = "";

    const { error } = await FX.sb.auth.signInWithPassword({
      email: FX.$("#email").value.trim().toLowerCase(),
      password: FX.$("#password").value
    });

    if (error) {
      btn.disabled = false; btn.textContent = "Se connecter";
      FX.$("#err").textContent = /invalid/i.test(error.message)
        ? "E-mail ou mot de passe incorrect."
        : "Connexion impossible : " + error.message;
      return;
    }
    location.replace("index.html");
  });
})();
