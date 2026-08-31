/* =============================================================================
   score.js — le calcul du score, en un seul endroit
   Annuaire Esker All Access 2026 · Fluxym
   -----------------------------------------------------------------------------
   Ce fichier existait implicitement dans js/gamif.js. Il en est sorti le
   31 aout pour une raison precise : l'ecran de reglage du bareme
   (bareme.html) doit montrer le classement recalcule avant enregistrement. Un
   apercu qui utiliserait sa propre formule serait un piege : il annoncerait un
   classement, l'annuaire en afficherait un autre, et personne ne saurait lequel
   croire un mardi matin sur un stand.

   Donc une seule definition, chargee par les deux pages. Le prix a payer est un
   fichier de plus au precache ; le gain est qu'une formule fausse est fausse
   partout, donc visible tout de suite.

   Ce que ce fichier ne fait pas : aucun acces au DOM, aucune dependance a FX.
   `load()` recoit le client Supabase en parametre. Il peut donc etre charge
   dans n'importe quel ordre, et teste hors navigateur.

   Le score n'est JAMAIS stocke. Il est recalcule a l'affichage depuis les
   jalons d'entonnoir, qui sont poses par un trigger en base. Consequence a
   garder en tete avant de toucher au bareme : changer une valeur rebat le
   classement de toute l'equipe a la seconde suivante, y compris pour le passe.
   ============================================================================= */

(function () {
  "use strict";

  const SEG_FLUXYM = "Fluxym (nous)";
  const RULES_K    = "fx.gamif.rules.v1";   /* bareme en cache, pour le hors reseau */

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
     afficheraient deux scores differents. Ce sont aussi les valeurs que
     bareme.html propose sous « Revenir aux valeurs d'origine ». */
  const DEF_RULES = { msg:3, replied:6, rdv:12, met:20, full:10, prio_a:5, dead:1, contest:5 };
  const DEF_LABEL = {
    msg:"Message envoyé", replied:"Réponse obtenue", rdv:"Rendez-vous planifié",
    met:"Rencontré au stand", full:"Parcours complet dans l'ordre",
    prio_a:"Contact priorité A travaillé", dead:"Sans suite qualifié", contest:"Concours proposé"
  };
  const DEF_FX2 = 5, DEF_FX3 = 16;

  /* L'ordre d'affichage dans l'ecran de reglage, et le regroupement. Les
     quatre premieres cles suivent l'entonnoir, les quatre suivantes sont des
     bonus qui ne dependent pas d'une etape. */
  const GROUPS = [
    { title:"Les quatre étapes de l'entonnoir", keys:["msg","replied","rdv","met"] },
    { title:"Les bonus", keys:["full","prio_a","dead","contest"] }
  ];

  const isToday = iso => {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };

  const S = {
    SEG_FLUXYM, RULES_K, STEPS, DEF_RULES, DEF_LABEL, DEF_FX2, DEF_FX3, GROUPS, isToday,
    /* Etat courant. Jamais reaffecte, toujours complete par Object.assign :
       js/gamif.js en garde des alias locaux, une reaffectation les casserait. */
    rules:  Object.assign({}, DEF_RULES),
    labels: Object.assign({}, DEF_LABEL),
    fx2: DEF_FX2,
    fx3: DEF_FX3
  };

  /* ---------------- Le score d'une fiche ----------------
     `rules` est un parametre, et c'est tout l'interet : l'annuaire passe le
     bareme enregistre, l'ecran de reglage passe celui qui est en train d'etre
     saisi, et les deux suivent exactement la meme regle. */

  S.detailWith = function (r, rules, labels) {
    const R = rules || S.rules, L = labels || S.labels;
    const parts = [];
    let total = 0;
    const add = (k, n) => { if (n) { total += n; parts.push({ k, label: L[k], points: n }); } };

    STEPS.forEach(s => { if (r[s.col]) add(s.k, R[s.k] || 0); });

    /* Parcours complet : les quatre jalons, et dans l'ordre. Un contact
       travaille etape par etape vaut plus qu'un contact classe directement
       « Rencontré », c'est tout l'objet de l'entonnoir. */
    if (STEPS.every(s => r[s.col])) {
      const t = STEPS.map(s => +new Date(r[s.col]));
      if (t[0] <= t[1] && t[1] <= t[2] && t[2] <= t[3]) add("full", R.full || 0);
    }

    /* Le bonus priorite A tombe des la premiere etape franchie : il
       recompense le fait de travailler les bons contacts maintenant, pas
       seulement d'avoir de la chance sur le stand. */
    if (r.priority === "A" && STEPS.some(s => r[s.col])) add("prio_a", R.prio_a || 0);

    /* Qualifier negativement est un vrai travail. Sans point, personne ne met
       « Sans suite » et les fiches pourrissent jusqu'au 8 septembre. La note
       est exigee, sinon le statut devient un clic gratuit. */
    if (r.status === "Sans suite" && String(r.notes || "").trim()) add("dead", R.dead || 0);

    if (r.contest_at) add("contest", R.contest || 0);

    return { total, parts };
  };

  S.detailOf  = r => S.detailWith(r, S.rules, S.labels);
  S.scoreOf   = r => S.detailWith(r, S.rules, S.labels).total;
  S.scoreWith = (r, rules) => S.detailWith(r, rules, S.labels).total;

  /* Points gagnes aujourd'hui : seuls les jalons dates du jour comptent, plus
     le concours propose aujourd'hui. Sert au « + N aujourd'hui » du bandeau. */
  S.todayOf = function (r) {
    let n = 0;
    STEPS.forEach(s => { if (isToday(r[s.col])) n += S.rules[s.k] || 0; });
    if (isToday(r.contest_at)) n += S.rules.contest || 0;
    return n;
  };

  /* Les huit fiches Fluxym ne sont pas des cibles : les compter ferait gagner
     des points a qui prend ses collegues. */
  S.targets = list => list.filter(r => r.segment !== SEG_FLUXYM);

  /* Classement d'une liste de fiches par proprietaire, avec un bareme donne.
     Utilise par l'apercu de l'ecran de reglage. */
  S.rankWith = function (rows, names, rules) {
    const t = S.targets(rows);
    return names.map(name => ({
      name,
      points: t.reduce((n, r) => n + (r.owner === name ? S.detailWith(r, rules, S.labels).total : 0), 0),
      held:   t.filter(r => r.owner === name).length
    })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "fr"));
  };

  /* ---------------- Lecture du bareme ----------------
     Lu une fois au demarrage, puis garde en cache local. Si la lecture
     echoue, on garde le cache : afficher un score legerement date vaut mieux
     que ne rien afficher entre deux conversations sur le stand. */

  S.readCache = function () {
    try {
      const c = JSON.parse(localStorage.getItem(RULES_K) || "null");
      if (c && c.rules) {
        Object.assign(S.rules, c.rules);
        if (c.labels) Object.assign(S.labels, c.labels);
        if (typeof c.fx2 === "number") S.fx2 = c.fx2;
        if (typeof c.fx3 === "number") S.fx3 = c.fx3;
        return true;
      }
    } catch (_) {}
    return false;
  };

  S.writeCache = function () {
    try {
      localStorage.setItem(RULES_K, JSON.stringify({
        rules: S.rules, labels: S.labels, fx2: S.fx2, fx3: S.fx3
      }));
    } catch (_) {}
  };

  S.load = async function (sb) {
    S.readCache();
    if (!sb) return false;
    try {
      const r = await sb.from("score_rules").select("key,label,points,sort_order");
      const s = await sb.from("score_settings").select("fx2,fx3").limit(1);
      if (r.error || !r.data || !r.data.length) return false;

      r.data.forEach(x => { S.rules[x.key] = x.points; S.labels[x.key] = x.label; });
      if (!s.error && s.data && s.data[0]) { S.fx2 = s.data[0].fx2; S.fx3 = s.data[0].fx3; }
      S.writeCache();
      return true;
    } catch (_) {
      return false;   /* hors reseau : le cache ou les valeurs de secours suffisent */
    }
  };

  window.FXSCORE = S;
})();
