/* --------------------------------------------------------------------------
   Socle commun : client Supabase, garde d'authentification, appel a
   l'Edge Function d'administration, et quelques utilitaires d'affichage.
   Tout est expose sous un seul objet global, FX, pour eviter d'avoir a
   introduire un bundler dans un site volontairement statique.
   -------------------------------------------------------------------------- */
window.FX = (() => {
  const CFG = window.FLUXYM_CONFIG;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  function toast(msg, kind = "", ms = 3200) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.className = "toast " + kind; t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms);
  }

  /* L'utilisateur saisit `bbartoli`, Supabase attend `bbartoli@fluxym.com`.
     La conversion est faite ici, et nulle part ailleurs. Une adresse
     complete tapee par habitude reste acceptee. */
  const toEmail  = v => {
    const s = String(v || "").trim().toLowerCase();
    return !s ? "" : s.includes("@") ? s : `${s}@${CFG.LOGIN_DOMAIN}`;
  };
  const toHandle = v => String(v || "").trim().toLowerCase().split("@")[0];

  const initials = n => (n || "?").split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join("").toUpperCase();
  const hue = str => { let h = 0; for (const c of String(str)) h = (h*31 + c.charCodeAt(0)) % 360; return `hsl(${h} 46% 48%)`; };
  const fmtDate = d => d ? new Date(d).toLocaleString("fr-FR", { dateStyle:"short", timeStyle:"short" }) : "jamais";

  let ME = null, TEAM = [];

  /* --------------------------------------------------------------------------
     COPIE LOCALE, ET LE CAS PRECIS QU'ELLE SERT

     Sur le stand a Rosemont, le wifi d'un centre de congres tombe. La session
     Supabase, elle, vit dans le stockage local du navigateur et reste valide :
     c'est la lecture de `team` qui echoue, et jusqu'ici cet echec etait traite
     comme un refus d'acces, donc une deconnexion. Resultat : plus de reseau,
     plus d'annuaire, au moment ou on en a le plus besoin.

     On distingue donc les deux situations. Un refus reste un refus et
     deconnecte. Une panne de reseau, avec une session valide et un profil deja
     connu, laisse entrer en lecture seule de fait : aucune ecriture ne pourra
     aboutir puisqu'elles passent toutes par Supabase.

     Ce que cela ne change pas : la RLS. Rien ici n'accorde un droit, tout se
     joue cote serveur. La copie locale ne contient que ce que l'utilisateur
     avait deja le droit de lire.
     -------------------------------------------------------------------------- */
  const SESS_K = "fx.session.v1";

  /* Une erreur de reseau n'a pas de code PostgREST. Un refus en a un, ou bien
     il se traduit par zero ligne sans erreur. On ajoute navigator.onLine comme
     second signal, jamais comme unique preuve : il ment souvent, en annoncant
     une connexion sur un portail captif. */
  const looksOffline = e =>
    navigator.onLine === false ||
    (!!e && !e.code && /failed to fetch|networkerror|load failed|network *request|timeout/i.test(String(e.message || "")));

  function keepSession(uid, me, team) {
    try { localStorage.setItem(SESS_K, JSON.stringify({ uid, me, team, at: Date.now() })); }
    catch (_) { /* quota plein : on se passe du mode hors connexion */ }
  }
  function recallSession(uid) {
    try {
      const k = JSON.parse(localStorage.getItem(SESS_K) || "null");
      /* La copie n'est utilisable que pour le compte qui l'a ecrite. */
      return k && k.uid === uid && k.me && Array.isArray(k.team) ? k : null;
    } catch (_) { return null; }
  }
  /* Deconnexion : on ne laisse ni profil ni annuaire derriere nous. */
  function forgetLocal() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith("fx."))
        .forEach(k => localStorage.removeItem(k));
    } catch (_) {}
  }

  /* Garde : toute page protegee commence par un await FX.requireSession().
     Un compte authentifie mais absent de `team` (ou desactive) est deconnecte
     immediatement plutot que laisse devant une page vide et inexplicable. */
  async function requireSession() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.replace("login.html"); return new Promise(() => {}); }

    const uid = data.session.user.id;
    const { data: rows, error } = await sb.from("team").select("*").order("sort_order").order("name");

    /* Reseau absent : on repart de la copie locale plutot que de deconnecter. */
    if (error && looksOffline(error)) {
      const k = recallSession(uid);
      if (k) {
        TEAM = k.team;
        ME = k.me;
        ME.auth_email = data.session.user.email;
        document.body.classList.add("ready", "offline");
        return { me: ME, team: TEAM, session: data.session, offline: true, since: k.at };
      }
      /* Aucune copie : une premiere connexion hors reseau ne peut pas aboutir.
         Un message qui reste a l'ecran vaut mieux qu'un toast qui s'efface au
         bout de neuf secondes devant une page vide. */
      const v = $(".veil");
      if (v) {
        v.innerHTML = "<b>Pas de connexion</b><br>Cet appareil n'a pas encore de copie locale "
                    + "de l'annuaire. Il faut l'ouvrir une premiere fois avec du reseau."
                    + "<br><button type='button' class='veil-btn' id='veil-retry'>Réessayer</button>";
        v.classList.add("veil-msg");
        const b = $("#veil-retry"); if (b) b.onclick = () => location.reload();
      }
      return new Promise(() => {});
    }

    if (error || !rows || !rows.length) {
      await sb.auth.signOut();
      location.replace("login.html?denied=1");
      return new Promise(() => {});
    }
    TEAM = rows;
    ME = rows.find(r => r.user_id === uid) || null;
    if (!ME) {
      forgetLocal();
      await sb.auth.signOut();
      location.replace("login.html?denied=1");
      return new Promise(() => {});
    }
    ME.auth_email = data.session.user.email;
    keepSession(uid, ME, TEAM);
    document.body.classList.add("ready");
    return { me: ME, team: TEAM, session: data.session, offline: false };
  }

  /* Appel a l'Edge Function. Le jeton de session est transmis : c'est lui,
     et lui seul, qui prouve que l'appelant est proprietaire. */
  async function admin(action, payload = {}) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Session expiree");
    const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/admin-users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CFG.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const out = await res.json().catch(() => ({ error: "Reponse illisible du serveur" }));
    if (!res.ok) throw new Error(out.error || `Erreur ${res.status}`);
    return out;
  }

  const logout = async () => {
    forgetLocal();
    await sb.auth.signOut();
    location.replace("login.html");
  };

  return { sb, CFG, $, $$, esc, toast, initials, hue, fmtDate, toEmail, toHandle,
           requireSession, admin, logout, looksOffline, forgetLocal,
           get me(){ return ME; }, get team(){ return TEAM; } };
})();
