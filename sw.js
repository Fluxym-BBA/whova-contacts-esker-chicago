/* --------------------------------------------------------------------------
   SERVICE WORKER
   Fluxym · Stand Esker All Access 2026

   Ce fichier existe pour une seule raison : le wifi d'un centre de congres.
   Le 8 septembre, entre deux conversations, personne n'attendra trois
   secondes qu'une requete aboutisse pour savoir si un participant est deja
   pris. L'application doit s'ouvrir tout de suite, meme quand le reseau rame,
   meme quand il tombe.

   ATTENTION, ET C'EST LE POINT LE PLUS IMPORTANT DE CE FICHIER

   Un service worker est un cache, et un cache mal regle sert du code mort.
   C'est exactement l'accident du 28 aout : une lecture en cache d'un fichier
   qui avait deja bouge. Trois precautions ont donc ete prises ici, et il ne
   faut pas les defaire :

   1. La strategie n'est pas "cache d'abord". C'est "reseau d'abord, avec une
      limite de patience". On laisse au reseau 1200 ms. S'il repond, sa reponse
      gagne toujours. S'il tarde, on sert la copie locale et on rafraichit en
      arriere-plan. Le confort ne se paie donc jamais en fraicheur.

   2. Les donnees Supabase ne sont JAMAIS mises en cache ici. Ni les tables,
      ni l'authentification, ni l'Edge Function. La copie de travail de
      l'annuaire est geree par js/app.js, dans le stockage local, avec sa
      propre purge a la deconnexion. Melanger les deux rendrait impossible de
      savoir ce qui est frais.

   3. La reprise n'est jamais automatique : voir l'absence de skipWaiting a
      l'installation, et le bandeau cote js/app.js.

   4. VERSION doit etre incrementee a chaque livraison qui touche un fichier
      de la coquille, et doit valoir exactement la meme chose que le `?v=`
      d'index.html. Une livraison qui oublie cette ligne ne changera rien sur
      les telephones de l'equipe, et c'est le genre de bug qu'on ne comprend
      pas un mardi matin sur un stand.
   -------------------------------------------------------------------------- */

const VERSION = "20260831c";
const SHELL   = "fx-shell-"   + VERSION;   /* pages, styles, scripts, icones */
const VENDOR  = "fx-vendor-"  + VERSION;   /* polices Google et supabase-js  */
const PATIENCE = 1200;                     /* ms accordees au reseau         */

/* La coquille. Les pages d'administration et de diagnostic en sont volontai-
   rement absentes : elles ne servent pas sur un stand, et chaque entree en
   plus est une entree a maintenir. */
const SHELL_FILES = [
  "./",
  "./index.html",
  "./methode.html",
  "./login.html",
  "./compte.html",
  "./css/app.css?v=" + VERSION,
  "./js/config.js?v=" + VERSION,
  "./js/api.js?v=" + VERSION,
  "./js/nav.js?v=" + VERSION,
  "./js/app.js?v=" + VERSION,
  /* score.js porte le calcul du score : sans lui en cache, l'annuaire hors
     reseau afficherait des cartes sans points. bareme.html, js/bareme.js et
     css/bareme.css sont en revanche absents volontairement, comme admin.html :
     on ne regle pas un bareme entre deux conversations sur un stand. */
  "./js/score.js?v=" + VERSION,
  "./js/methode.js?v=" + VERSION,
  "./js/login.js?v=" + VERSION,
  "./js/compte.js?v=" + VERSION,
  "./js/install.js?v=" + VERSION,
  "./css/install.css?v=" + VERSION,
  "./js/gamif.js?v=" + VERSION,
  "./css/gamif.css?v=" + VERSION,
  "./manifest.webmanifest?v=" + VERSION,
  "./assets/qr-concours.png",
  "./assets/favicon.ico",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon-180.png",
  "./assets/apple-touch-icon-167.png",
  "./assets/apple-touch-icon-152.png"
];

/* Sans ces trois la, il n'y a pas d'annuaire hors reseau : si l'une manque,
   l'installation doit echouer bruyamment plutot que laisser croire que le
   mode hors connexion fonctionne. */
const REQUIRED = ["./index.html", "./css/app.css?v=" + VERSION, "./js/app.js?v=" + VERSION];

const isSupabase = u => /\.supabase\.(co|in)$/.test(u.hostname);
const isVendor   = u => /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/.test(u.hostname);

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    /* Un addAll global echoue en bloc sur un seul 404. On y va piece par
       piece pour qu'un fichier optionnel absent ne prive pas l'equipe du
       mode hors connexion. */
    const failed = [];
    await Promise.all(SHELL_FILES.map(async f => {
      try {
        const r = await fetch(f, { cache: "reload" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        await c.put(f, r);
      } catch (err) { failed.push(f); }
    }));
    const fatal = failed.filter(f => REQUIRED.includes(f));
    if (fatal.length) throw new Error("Coquille incomplete : " + fatal.join(", "));
    /* Pas de skipWaiting ici, volontairement. Un service worker qui prend la
       main tout seul provoque un rechargement de la page, et un rechargement
       au mauvais moment fait perdre une note qu'on etait en train de taper
       devant quelqu'un. La nouvelle version attend donc sagement, un bandeau
       previent, et c'est l'utilisateur qui decide du moment. */
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = [SHELL, VENDOR];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Le client peut demander la prise de main immediate (bouton du bandeau). */
self.addEventListener("message", e => {
  if (e.data === "fx-skip-waiting") self.skipWaiting();
});

/* Reseau d'abord, mais pas indefiniment. La copie locale n'est servie que si
   le reseau depasse la limite de patience ou echoue franchement. Dans les deux
   cas, la reponse reseau finit tout de meme dans le cache pour la fois
   suivante. */
function networkFirst(req, cacheName) {
  return new Promise(resolve => {
    let settled = false;
    const done = r => { if (!settled) { settled = true; resolve(r); } };

    const net = fetch(req).then(r => {
      if (r && r.ok) caches.open(cacheName).then(c => c.put(req, r.clone())).catch(() => {});
      done(r);
      return r;
    }).catch(() => null);

    const fallback = async () => {
      const c = await caches.open(cacheName);
      const hit = await c.match(req, { ignoreSearch: false }) || await c.match(req, { ignoreSearch: true });
      if (hit) done(hit);
    };

    setTimeout(fallback, PATIENCE);
    net.then(r => { if (!r) fallback().then(() => done(new Response("", { status: 504, statusText: "Hors connexion" }))); });
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  let u;
  try { u = new URL(req.url); } catch (_) { return; }

  /* Donnees et authentification : le reseau, et rien d'autre. */
  if (isSupabase(u)) return;

  /* Navigation : on veut le HTML frais, avec repli sur l'annuaire connu. */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const r = await networkFirst(req, SHELL);
      if (r && r.status !== 504) return r;
      const c = await caches.open(SHELL);
      return (await c.match("./index.html")) || r;
    })());
    return;
  }

  if (u.origin === self.location.origin) { e.respondWith(networkFirst(req, SHELL)); return; }
  if (isVendor(u))                       { e.respondWith(networkFirst(req, VENDOR)); return; }
  /* Tout le reste part au reseau sans interception. */
});
