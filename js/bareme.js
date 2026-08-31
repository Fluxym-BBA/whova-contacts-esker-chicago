/* =============================================================================
   bareme.js — regler ce que rapporte chaque geste
   Annuaire Esker All Access 2026 · Fluxym
   -----------------------------------------------------------------------------
   Reserve au proprietaire. Cette page ne protege rien par elle-meme : la
   barriere est en base, ou les politiques `score_rules_write` et
   `score_settings_write` n'autorisent l'ecriture qu'a is_owner(). Un membre qui
   arrive ici par l'URL est renvoye a l'annuaire, et s'il forcait la requete la
   base la refuserait.

   Deux partis pris a connaitre avant de lire le code :

   1. On regle des VALEURS, pas une liste. Les huit cles sont definies dans
      js/score.js et la base n'a volontairement aucune politique INSERT ni
      DELETE sur score_rules. Ajouter une regle depuis cet ecran ne servirait a
      rien : personne ne la calculerait. Les libelles ne sont pas modifiables
      non plus, ils decrivent des gestes definis dans le code, et les renommer
      ne ferait que desynchroniser l'ecran et la realite.

   2. L'apercu utilise js/score.js, exactement la meme fonction que l'annuaire.
      Un apercu avec sa propre formule serait pire que pas d'apercu : il
      annoncerait un classement que l'annuaire contredirait.

   Le score n'est jamais stocke. Changer une valeur ici rebat le classement de
   toute l'equipe au prochain rafraichissement, y compris sur le travail deja
   fait. C'est pour ca que la page affiche l'ecart avant enregistrement, et
   qu'elle previent pendant les trois jours du salon.
   ============================================================================= */

(async () => {
  "use strict";

  const { me } = await FX.requireSession();
  renderNav("bareme.html");
  if (!me.is_owner) { location.replace("index.html"); return; }

  const $ = FX.$, esc = FX.esc, S = window.FXSCORE;
  const MIN = 0, MAX = 100;

  /* Les trois jours du salon, en heure locale. Sert uniquement a afficher un
     avertissement : rien n'est bloque, Bruno reste seul juge. */
  const SHOW_FROM = new Date("2026-09-08T00:00:00");
  const SHOW_TO   = new Date("2026-09-11T00:00:00");

  let META  = [];   /* [{key,label,points,sort_order}] tel qu'en base */
  let SAVED = {};   /* bareme enregistre : { cle: points }            */
  let DRAFT = {};   /* saisie en cours                                */
  let SAVED_FX = { fx2: S.DEF_FX2, fx3: S.DEF_FX3 };
  let DRAFT_FX = { fx2: S.DEF_FX2, fx3: S.DEF_FX3 };
  let ROWS  = [];   /* fiches reelles, pour l'apercu */
  let NAMES = [];   /* membres actifs */
  let WHEN  = null; /* derniere modification connue */
  let BUSY  = false;

  /* ---------------- Chargement ----------------
     Trois lectures, aucune ecriture. Les fiches servent a l'apercu : sans
     elles, on reglerait a l'aveugle. Si la lecture des fiches echoue, on se
     rabat sur la copie locale ecrite par l'annuaire ; si elle manque aussi, on
     le dit au lieu d'afficher un classement faux. */

  async function load() {
    const r = await FX.sb.from("score_rules").select("key,label,points,sort_order,updated_at,updated_by");
    if (r.error) { FX.toast("Barème illisible : " + r.error.message, "bad"); return false; }

    META = (r.data || []).slice().sort((a, b) =>
      (a.sort_order || 0) - (b.sort_order || 0) || a.key.localeCompare(b.key));
    SAVED = {};
    META.forEach(x => { SAVED[x.key] = x.points; });
    DRAFT = Object.assign({}, SAVED);

    WHEN = META.reduce((acc, x) => {
      if (!x.updated_at) return acc;
      const t = +new Date(x.updated_at);
      return !acc || t > acc.t ? { t, by: x.updated_by } : acc;
    }, null);

    const st = await FX.sb.from("score_settings").select("fx2,fx3,updated_at,updated_by").limit(1);
    if (!st.error && st.data && st.data[0]) {
      SAVED_FX = { fx2: st.data[0].fx2, fx3: st.data[0].fx3 };
      DRAFT_FX = Object.assign({}, SAVED_FX);
      if (st.data[0].updated_at) {
        const t = +new Date(st.data[0].updated_at);
        if (!WHEN || t > WHEN.t) WHEN = { t, by: st.data[0].updated_by };
      }
    }

    NAMES = (FX.team || []).filter(x => x.active).map(x => x.name);

    const a = await FX.sb.from("attendees")
      .select("owner,segment,priority,status,notes,contest_at,funnel_msg_at,funnel_replied_at,funnel_rdv_at,funnel_met_at");
    if (!a.error && a.data) ROWS = a.data;
    else {
      try { ROWS = JSON.parse(localStorage.getItem("fx.rows.v1") || "[]") || []; } catch (_) { ROWS = []; }
    }
    return true;
  }

  /* ---------------- Combien de fiches une regle touche-t-elle ? ----------------
     Sans ce compte, on regle a l'aveugle : monter « Rencontré » de 20 a 25 ne
     change rien tant qu'aucune rencontre n'est enregistree, et il vaut mieux le
     savoir avant de croire avoir agi.

     Astuce : on demande le score de la fiche avec un bareme ou cette seule cle
     vaut 1. Le total valant alors 1 ou 0, on compte les fiches concernees sans
     reecrire la moindre condition. */

  function hits(key) {
    const one = { [key]: 1 };
    return S.targets(ROWS).reduce((n, r) => n + S.detailWith(r, one, S.labels).total, 0);
  }

  /* ---------------- Le formulaire ---------------- */

  function paintGroups() {
    const box = $("#bm-groups");
    box.innerHTML = S.GROUPS.map(g => {
      const rows = g.keys.filter(k => k in SAVED).map(k => {
        const m = META.find(x => x.key === k) || { label: S.labels[k] };
        const n = hits(k);
        const changed = DRAFT[k] !== SAVED[k];
        return `<div class="bm-row${changed ? " changed" : ""}">
          <div class="bm-row-id">
            <b>${esc(m.label || k)}</b>
            <span>${n ? n + " fiche" + (n > 1 ? "s" : "") + " concernée" + (n > 1 ? "s" : "")
                      : "aucune fiche concernée aujourd’hui"}</span>
          </div>
          <div class="bm-row-in">
            <button class="bm-step" type="button" data-dec="${esc(k)}" aria-label="Retirer un point">−</button>
            <input type="number" inputmode="numeric" min="${MIN}" max="${MAX}" step="1"
                   value="${DRAFT[k]}" data-key="${esc(k)}" aria-label="Points pour ${esc(m.label || k)}">
            <button class="bm-step" type="button" data-inc="${esc(k)}" aria-label="Ajouter un point">+</button>
          </div>
          <div class="bm-row-was">${changed ? `était ${SAVED[k]}` : "&nbsp;"}</div>
        </div>`;
      }).join("");
      return `<div class="bm-group"><h3>${esc(g.title)}</h3>${rows}</div>`;
    }).join("");
  }

  function paintSeuils() {
    const f = (k, label, hint) => {
      const changed = DRAFT_FX[k] !== SAVED_FX[k];
      return `<div class="bm-row${changed ? " changed" : ""}">
        <div class="bm-row-id"><b>${label}</b><span>${hint}</span></div>
        <div class="bm-row-in">
          <button class="bm-step" type="button" data-dec="@${k}" aria-label="Retirer un point">−</button>
          <input type="number" inputmode="numeric" min="1" max="${MAX}" step="1"
                 value="${DRAFT_FX[k]}" data-fx="${k}" aria-label="${label}">
          <button class="bm-step" type="button" data-inc="@${k}" aria-label="Ajouter un point">+</button>
        </div>
        <div class="bm-row-was">${changed ? `était ${SAVED_FX[k]}` : "&nbsp;"}</div>
      </div>`;
    };
    $("#bm-seuils").innerHTML =
      f("fx2", "Deuxième palier", "halo et bulle plus large à partir de ce gain") +
      f("fx3", "Troisième palier", "confettis à partir de ce gain");

    const bad = DRAFT_FX.fx3 <= DRAFT_FX.fx2;
    const h = $("#bm-seuils-hint");
    h.textContent = bad
      ? "Le troisième palier doit être strictement supérieur au deuxième, sinon le halo devient inatteignable."
      : `Un « Rencontré » vaut ${DRAFT.met} points : il déclenche ${
          DRAFT.met >= DRAFT_FX.fx3 ? "les confettis" : DRAFT.met >= DRAFT_FX.fx2 ? "le halo" : "l’effet discret"}.`;
    h.className = "bm-hint" + (bad ? " bad" : "");
  }

  /* ---------------- L'apercu ---------------- */

  function paintPreview() {
    const now  = S.rankWith(ROWS, NAMES, SAVED);
    const next = S.rankWith(ROWS, NAMES, DRAFT);
    const posNow = {}; now.forEach((x, i) => { posNow[x.name] = i + 1; });
    const max = Math.max(1, next[0] ? next[0].points : 1);

    $("#bm-preview").innerHTML = next.map((x, i) => {
      const before = (now.find(y => y.name === x.name) || {}).points || 0;
      const d = x.points - before;
      const up = posNow[x.name] - (i + 1);
      return `<div class="bm-p-row">
        <span class="bm-p-n">${i + 1}</span>
        <span class="bm-p-name">${esc(x.name)}${x.name === me.name ? " · vous" : ""}</span>
        <span class="bm-p-bar"><i style="width:${Math.round(x.points / max * 100)}%"></i></span>
        ${up ? `<span class="bm-p-move ${up > 0 ? "up" : "down"}">${up > 0 ? "▲" : "▼"}${Math.abs(up)}</span>`
             : `<span class="bm-p-move"></span>`}
        ${d ? `<span class="bm-p-d ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : ""}${d}</span>`
            : `<span class="bm-p-d"></span>`}
        <b class="bm-p-pts">${x.points}</b>
      </div>`;
    }).join("");

    const moved = next.filter((x, i) => posNow[x.name] !== i + 1).length;
    const tot   = next.reduce((n, x) => n + x.points, 0);
    const totNow = now.reduce((n, x) => n + x.points, 0);
    $("#bm-preview-hint").textContent = ROWS.length
      ? `Calculé sur ${S.targets(ROWS).length} fiches, les 8 fiches Fluxym exclues. `
        + (tot === totNow ? "Aucun changement de total." :
           `Total de l’équipe : ${totNow} → ${tot} points.`)
        + (moved ? ` ${moved} position${moved > 1 ? "s" : ""} changerai${moved > 1 ? "ent" : "t"} au classement.` : "")
      : "Fiches indisponibles : l’aperçu ne peut pas être calculé. Ouvrez l’annuaire une fois, puis revenez.";
  }

  /* ---------------- La barre d'actions ---------------- */

  function dirtyList() {
    const d = Object.keys(SAVED).filter(k => DRAFT[k] !== SAVED[k]);
    if (DRAFT_FX.fx2 !== SAVED_FX.fx2) d.push("@fx2");
    if (DRAFT_FX.fx3 !== SAVED_FX.fx3) d.push("@fx3");
    return d;
  }

  function paintBar() {
    const d = dirtyList();
    const bar = $("#bm-bar");
    bar.hidden = d.length === 0;
    $("#bm-bar-txt").textContent = d.length
      ? `${d.length} valeur${d.length > 1 ? "s" : ""} modifiée${d.length > 1 ? "s" : ""}, non enregistrée${d.length > 1 ? "s" : ""}`
      : "";
    $("#bm-save").disabled = BUSY || DRAFT_FX.fx3 <= DRAFT_FX.fx2;
  }

  function paintAll() { paintGroups(); paintSeuils(); paintPreview(); paintBar(); }

  /* ---------------- Saisie ----------------
     La valeur est bornee a la lecture, pas a l'enregistrement : on ne laisse
     pas quelqu'un taper 900 puis decouvrir un refus deux ecrans plus loin. */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function setKey(k, v) {
    if (!Number.isFinite(v)) return;
    DRAFT[k] = clamp(Math.round(v), MIN, MAX);
    paintAll();
  }
  function setFx(k, v) {
    if (!Number.isFinite(v)) return;
    DRAFT_FX[k] = clamp(Math.round(v), 1, MAX);
    paintAll();
  }

  document.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset && t.dataset.key) DRAFT[t.dataset.key] = clamp(Math.round(+t.value || 0), MIN, MAX);
    else if (t.dataset && t.dataset.fx) DRAFT_FX[t.dataset.fx] = clamp(Math.round(+t.value || 0), 1, MAX);
    else return;
    /* On ne repeint pas le champ en cours de frappe : le curseur sauterait.
       Seuls l'apercu, les seuils et la barre suivent. */
    paintSeuils(); paintPreview(); paintBar();
  });

  document.addEventListener("click", e => {
    const inc = e.target.closest && e.target.closest("[data-inc]");
    const dec = e.target.closest && e.target.closest("[data-dec]");
    const b = inc || dec;
    if (!b) return;
    const k = (inc ? inc.dataset.inc : dec.dataset.dec);
    const step = inc ? 1 : -1;
    if (k.charAt(0) === "@") setFx(k.slice(1), DRAFT_FX[k.slice(1)] + step);
    else setKey(k, DRAFT[k] + step);
  });

  $("#bm-reset").onclick = () => {
    DRAFT = Object.assign({}, SAVED);
    DRAFT_FX = Object.assign({}, SAVED_FX);
    paintAll();
  };

  /* « Valeurs d'origine » remplit les champs sans rien ecrire : c'est une
     proposition, pas un enregistrement. Ces valeurs sont celles de la migration
     initiale, gardees dans js/score.js. */
  $("#bm-default").onclick = () => {
    Object.keys(SAVED).forEach(k => { if (k in S.DEF_RULES) DRAFT[k] = S.DEF_RULES[k]; });
    DRAFT_FX = { fx2: S.DEF_FX2, fx3: S.DEF_FX3 };
    paintAll();
    FX.toast("Valeurs d'origine proposées. Rien n'est enregistré tant que vous ne validez pas.");
  };

  /* ---------------- Enregistrement ----------------
     Seules les lignes modifiees sont ecrites, et chaque ecriture est relue
     ensuite : la RLS peut refuser silencieusement une ligne, et un barème
     a moitie enregistre serait pire qu'un refus franc. */

  $("#bm-save").onclick = async () => {
    const d = dirtyList();
    if (!d.length || BUSY) return;
    if (DRAFT_FX.fx3 <= DRAFT_FX.fx2) { FX.toast("Le troisième palier doit dépasser le deuxième.", "bad"); return; }

    const inShow = Date.now() >= +SHOW_FROM && Date.now() < +SHOW_TO;
    const keys = d.filter(k => k.charAt(0) !== "@");
    const msg = "Enregistrer " + d.length + " valeur" + (d.length > 1 ? "s" : "") + " ?\n\n"
      + keys.map(k => `· ${S.labels[k] || k} : ${SAVED[k]} → ${DRAFT[k]}`).join("\n")
      + (d.includes("@fx2") ? `\n· Deuxième palier : ${SAVED_FX.fx2} → ${DRAFT_FX.fx2}` : "")
      + (d.includes("@fx3") ? `\n· Troisième palier : ${SAVED_FX.fx3} → ${DRAFT_FX.fx3}` : "")
      + "\n\nLe classement de toute l'équipe est recalculé, y compris sur le travail déjà fait."
      + (inShow ? "\n\nNous sommes pendant le salon : le changement sera visible sur tous les téléphones." : "");
    if (!confirm(msg)) return;

    BUSY = true; paintBar();
    const stamp = { updated_by: me.name, updated_at: new Date().toISOString() };
    const failed = [];

    for (const k of keys) {
      const { error } = await FX.sb.from("score_rules")
        .update(Object.assign({ points: DRAFT[k] }, stamp)).eq("key", k);
      if (error) failed.push(`${k} (${error.message})`);
    }
    if (d.includes("@fx2") || d.includes("@fx3")) {
      const { error } = await FX.sb.from("score_settings")
        .update(Object.assign({ fx2: DRAFT_FX.fx2, fx3: DRAFT_FX.fx3 }, stamp)).eq("id", true);
      if (error) failed.push("seuils (" + error.message + ")");
    }

    /* Relecture systematique : on compare ce qui est en base a ce qu'on
       voulait ecrire, et on ne declare le succes que si tout correspond. */
    const before = Object.assign({}, DRAFT), beforeFx = Object.assign({}, DRAFT_FX);
    const ok = await load();
    BUSY = false;

    if (!ok) { FX.toast("Enregistré, mais relecture impossible. Rechargez la page.", "bad"); return; }

    const ecarts = Object.keys(before).filter(k => SAVED[k] !== before[k])
      .concat(SAVED_FX.fx2 !== beforeFx.fx2 ? ["@fx2"] : [])
      .concat(SAVED_FX.fx3 !== beforeFx.fx3 ? ["@fx3"] : []);

    /* Le cache local porte le bareme pour le hors reseau : sans cette mise a
       jour, cet appareil continuerait a calculer avec l'ancien. */
    Object.assign(S.rules, SAVED);
    S.fx2 = SAVED_FX.fx2; S.fx3 = SAVED_FX.fx3;
    S.writeCache();

    paintAll(); paintWhen();

    if (failed.length) FX.toast("Refus de la base sur : " + failed.join(", "), "bad", 6000);
    else if (ecarts.length) FX.toast("Écart après relecture sur : " + ecarts.join(", ") + ". Vérifiez.", "bad", 6000);
    else FX.toast("Barème enregistré. Le classement suit au prochain rafraîchissement.");
  };

  function paintWhen() {
    $("#bm-when").textContent = WHEN
      ? FX.fmtDate(new Date(WHEN.t)) + (WHEN.by ? " par " + WHEN.by : "")
      : "jamais depuis l'installation";
  }

  /* Quitter avec des valeurs non enregistrees est presque toujours une erreur. */
  window.addEventListener("beforeunload", e => {
    if (dirtyList().length) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------------- Demarrage ---------------- */

  $("#bm-live").hidden = !(Date.now() >= +SHOW_FROM && Date.now() < +SHOW_TO);

  if (await load()) {
    paintAll();
    paintWhen();
  } else {
    $("#bm-groups").innerHTML = '<p class="empty">Barème illisible. Vérifiez la connexion, puis rechargez.</p>';
  }
})();
