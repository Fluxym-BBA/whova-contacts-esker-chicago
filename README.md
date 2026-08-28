# Stand Esker All Access 2026 — Fluxym

Application interne de pilotage des invitations sur le stand Fluxym pendant
**Esker All Access 2026** (Rosemont / Chicago, 8-10 septembre 2026).

Objectif : que l'équipe présente se répartisse proprement les participants
Whova, **sans jamais solliciter deux fois la même personne**.

---

## Architecture

```
GitHub Pages (ce repo, statique)     Supabase — fluxym-esker-allaccess-2026
┌───────────────────────────┐        ┌──────────────────────────────────────┐
│ login.html   js/login.js  │  HTTPS │ Auth      e-mail / mot de passe      │
│ index.html   js/app.js    │ ─────► │ attendees participants + suivi       │
│ compte.html  js/compte.js │  REST  │ team      comptes et niveaux d'accès │
│ admin.html   js/admin.js  │        │ activity_log  traçabilité            │
│ js/api.js    js/nav.js    │        │ RLS       is_fluxym() / is_owner()   │
│ css/app.css               │        ├──────────────────────────────────────┤
└───────────────────────────┘ ─────► │ Edge Function `admin-users`          │
                              POST   │   ← seul détenteur de service_role   │
                                     └──────────────────────────────────────┘
```

Projet Supabase `oyajqqowmzqclbloaxjc`, région eu-west-3 (Paris).
Volontairement **distinct** de `bdr-cockpit` : aucune ressource partagée.

---

## Les deux niveaux d'accès

| | Membre | Propriétaire |
|---|:---:|:---:|
| Consulter l'annuaire, s'attribuer des contacts, saisir notes et statuts | ✅ | ✅ |
| Changer **son propre** mot de passe | ✅ | ✅ |
| Créer un compte, définir son mot de passe initial | — | ✅ |
| Réinitialiser le mot de passe d'un autre | — | ✅ |
| Renommer, changer la couleur, activer / désactiver | — | ✅ |
| Promouvoir quelqu'un propriétaire, supprimer un compte | — | ✅ |

Il n'y a pas de troisième niveau, et c'est délibéré : sur un événement de
trois jours, toute nuance supplémentaire coûterait plus en explications
qu'elle ne rapporterait.

---

## Comment la sécurité tient

Le site est statique et public. Trois mécanismes distincts font le travail.

**1. La clé `anon` est publique, et ce n'est pas un problème.**
C'est le fonctionnement nominal de Supabase. Elle n'ouvre que ce que les
règles RLS autorisent. Deux fonctions SQL en `security definer` tranchent :
`is_fluxym()` (compte présent et actif dans `team`) et `is_owner()`.
Un inconnu qui récupère la clé n'obtient aucune ligne.

**2. La clé `service_role` n'est jamais côté navigateur.**
Créer un compte ou réinitialiser un mot de passe exige des droits que le
front n'a pas et ne doit pas avoir. Ces opérations passent par l'Edge
Function `admin-users`, qui vit sur le serveur. Elle vérifie dans l'ordre :
jeton présent → signature valide → fiche `team` lue **avec les droits de
l'appelant** → propriétaire actif. La clé privilégiée n'est instanciée
qu'après ces quatre étapes.

**3. Masquer un lien n'est pas protéger une page.**
`admin.html` n'affiche rien à un membre et le renvoie vers l'annuaire, mais
c'est du confort. La vraie barrière est côté serveur : un membre qui
forgerait un appel direct reçoit un `403`.

**Garde-fous complémentaires**
- Le dernier propriétaire actif ne peut être ni supprimé, ni rétrogradé, ni
  désactivé. Contrôlé dans l'Edge Function *et* par un déclencheur en base,
  parce qu'une manipulation faite depuis le tableau de bord Supabase ne
  passe pas par la fonction.
- On ne peut pas retirer ses propres droits ni supprimer son propre compte.
- Création restreinte au domaine `@fluxym.com` (constante `DOMAINS`).
- Tout compte créé côté `auth` obtient automatiquement sa fiche `team` via
  le déclencheur `handle_new_user`, y compris s'il est créé depuis le
  tableau de bord Supabase. Sans cela il pourrait se connecter sans rien
  voir, et l'erreur serait incompréhensible.

---

## Identifiants courts, et pourquoi

On se connecte avec `bbartoli`, pas avec `bbartoli@fluxym.com`. Le domaine
est recollé côté client, dans `FX.toEmail()`, avant l'appel à Supabase.

Ce n'est pas une coquetterie. Chrome indexe ses mots de passe par couple
**origine + identifiant**, et toutes nos applications GitHub Pages
partagent la même origine `fluxym-bba.github.io`. Deux applications qui
utiliseraient la même adresse e-mail comme identifiant se retrouveraient
donc à se disputer une seule et même entrée dans le gestionnaire, avec des
mots de passe différents. Un identifiant court ici, une adresse complète
ailleurs, et le gestionnaire tient enfin deux fiches distinctes.

Une adresse complète tapée par habitude reste acceptée : `toEmail()` ne
recolle le domaine que s'il manque.

## Cycle de vie d'un compte

1. Le propriétaire remplit *Créer un compte* dans **Administration**.
   Le mot de passe peut être laissé vide : la fonction en génère un lisible
   (`kfrp-8m2q-vxht`), sans caractères ambigus.
2. Les identifiants s'affichent **une seule fois**, avec un bouton qui copie
   un message prêt à transmettre. Ils ne sont stockés nulle part en clair et
   ne pourront pas être réaffichés : seulement remplacés.
3. Le compte est utilisable immédiatement — `email_confirm` est posé à la
   création, aucun e-mail à cliquer.
4. Le membre se connecte et change son mot de passe depuis **Mon compte**.
   L'ancien mot de passe y est exigé et vérifié en le rejouant, ce qui
   empêche un poste laissé déverrouillé de servir à enfermer son
   propriétaire dehors.

**Désactiver plutôt que supprimer.** Décocher *Compte actif* coupe l'accès
en conservant le portefeuille. La suppression, elle, libère tous les
contacts suivis, exige de retaper le nom exact, et annonce à l'avance
combien de contacts redeviendront libres.

---

## Arborescence

```
.
├── .nojekyll                     sans lui, Pages ignore les dossiers servis
├── login.html                    js/login.js
├── index.html                    js/app.js      annuaire, attribution, suivi
├── methode.html                  js/methode.js  méthode de priorisation
├── compte.html                   js/compte.js   profil et mot de passe
├── admin.html                    js/admin.js    gestion des comptes
├── manifest.webmanifest          ajout à l'écran d'accueil (voir « Sur téléphone »)
├── css/app.css
├── js/
│   ├── config.js                 URL + clé anon
│   ├── api.js                    client, garde d'authentification, appels admin
│   └── nav.js                    navigation partagée
├── supabase/
│   ├── functions/admin-users/index.ts
│   └── migrations/*.sql
└── README.md
```

Le dossier `supabase/` est versionné pour référence : le schéma et la
fonction sont **déjà déployés**. Le pousser ne redéploie rien.

Trois fichiers présents dans le dépôt ne sont **référencés par aucune page** :
`assets/app.js`, `assets/styles.css` et le `config.js` de la racine. Ce sont
des reliquats d'une version antérieure. Ils ne gênent rien mais peuvent
tromper : la feuille de style réellement servie est `css/app.css`, et la
configuration réellement lue est `js/config.js`.

---

## Déploiement

1. Pousser à la racine de `main`.
2. *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
3. Ouvrir `login.html` ou la racine.

Rien à installer, aucune étape de build.

---

## L'annuaire

| Onglet | Rôle |
|---|---|
| **Annuaire** | tous les participants, filtrables par priorité, segment, fonction, séniorité, société, statut, attribution |
| **Mon portefeuille** | uniquement mes contacts |
| **Répartition équipe** | qui a combien, avancement, reste à répartir |
| **Journal** | historique horodaté des prises et changements de statut |
| **Méthode** | comment la priorité A/B/C est calculée, et qui l'a corrigée |

**Classement alphabétique par nom de famille.** Comme dans Whova, les cartes
sont regroupées sous un intertitre par initiale, avec le nombre de personnes
dans le groupe, et une barre d'index A-Z au-dessus de la liste pour sauter
directement à une lettre. L'index ne rend cliquables que les lettres
réellement présentes après filtrage : une lettre qui ne mène nulle part est
un piège. L'initiale est calculée sur le nom de famille, accents et guillemets
retirés ; ce qui ne commence pas par une lettre atterrit dans un groupe `#`
placé en fin de liste. Le même regroupement s'applique à *Mon portefeuille*.

La clé de tri retire la même ponctuation initiale que l'initiale elle-même.
Sans cela, un `O'Brien` ou un `'t Hart` triait sur son apostrophe, donc avant
les A, et son groupe apparaissait hors séquence alphabétique.

**Esker et Fluxym se filtrent séparément.** Deux cases distinctes, parce que
les deux populations n'ont rien à voir : *Masquer Fluxym* est cochée par
défaut (nos propres collègues n'ont rien à faire dans l'annuaire), *Masquer
Esker* est décochée (les équipes de l'éditeur sont des interlocuteurs que
nous voulons aussi aller voir sur le stand). Les compteurs de l'onglet
*Répartition équipe* suivent la même logique : seul Fluxym sort du périmètre,
Esker compte comme cible.

**Anti-doublon** : un participant n'a qu'un seul responsable. S'il est déjà
pris, le bouton devient *Reprendre* et la confirmation nomme le collègue
concerné. Toute reprise est journalisée.

**Statuts** : `À contacter` → `Message envoyé` → `Répondu` → `RDV planifié`
→ `Rencontré`, ou `Sans suite`.

La fiche détaillée permet de noter un créneau, l'usage Esker du contact, des
notes libres, et de copier un **message Whova pré-rédigé** personnalisé au
contact comme à l'expéditeur.

**Rafraîchissement automatique toutes les 20 secondes**, mais sobre : la
réponse est comparée à une signature (`id`, `updated_at`, `owner`, `status`,
`priority`) et la liste n'est repeinte que si quelque chose a bougé. Le cycle
s'arrête quand la page passe en arrière-plan et reprend, avec un rechargement
immédiat, au retour au premier plan. Une mise à jour qui arrive pendant qu'une
feuille de filtres ou une fiche est ouverte est mise en attente et appliquée à
la fermeture : repeindre sous les doigts de quelqu'un qui saisit une note est
le meilleur moyen de perdre cette note.

**Renommer un membre est sans danger** : `attendees.owner` référence
`team.name` en `on update cascade`, les contacts déjà attribués suivent.

---

## Sur téléphone

L'application est pensée pour être utilisée **debout sur le stand, d'une seule
main, entre deux conversations**. Le test de référence : vérifier en cinq
secondes si un participant est déjà pris et par qui. Tout le reste passe après.

Un seul balisage, deux présentations, point de bascule à **900px** (`css/app.css`).
Il n'existe pas de version mobile séparée : dupliquer les champs de filtre,
c'est prendre le risque que deux valeurs divergent pour le même filtre.

| | Ordinateur (> 900px) | Téléphone (≤ 900px) |
|---|---|---|
| Recherche | barre collante sous la navigation | idem, plein largeur |
| Filtres | panneau visible en clair, 4 colonnes | feuille remontante, refermable au glissé, avec « Voir les N résultats » |
| Filtres actifs | visibles dans le panneau | rappelés en pastilles supprimables sous la recherche |
| Vues | onglets en haut | barre basse dans la zone du pouce, avec le compteur du portefeuille |
| Tableau de bord | six indicateurs dépliés | replié, résumé en une ligne |
| Fiches | grille de cartes | une colonne, format dense |
| Fiche détaillée | panneau latéral | feuille plein écran, poignée, glissé vers le bas pour fermer |
| Liens de pages | dans la barre de navigation | dans le menu de la barre de navigation |

Quatre contraintes tenues dans le CSS, chacune corrige un défaut constaté :

- **Champs à 16px sur téléphone** (`--fs-field`). En dessous, Safari iOS zoome
  de force à chaque frappe et la page déborde. C'était le défaut le plus
  agaçant de la version précédente.
- **Hauteurs des barres collantes en variables** (`--navh`, `--sbarh`,
  `--stick`). Les ancres A-Z s'en servent pour leur `scroll-margin-top` :
  avec une valeur recopiée à la main, et une navigation qui changeait de
  hauteur selon le repli des liens, l'intertitre atterrissait sous l'entête.
  C'est aussi la raison pour laquelle la barre de navigation garde une hauteur
  fixe sur téléphone.
- **`env(safe-area-inset-*)` sur tout ce qui est fixe**, en haut comme en bas.
  La page déclare `viewport-fit=cover` : sans ces marges, l'iPhone superpose
  sa barre d'accueil au bouton d'action de la fiche.
- **`100dvh`, jamais `100vh`**, pour les feuilles et panneaux. Avec `100vh`,
  le bouton *Enregistrer* passait sous la barre d'URL de Safari.
- **Cibles tactiles à 44px minimum** (`--touch`), 48 à 50px pour les actions
  principales. *Je prends* faisait 30px de haut.

**Ajout à l'écran d'accueil.** `manifest.webmanifest` et les balises Apple
permettent de lancer l'application en plein écran, sans barre d'URL.
Deux limites à connaître :

- **aucun fonctionnement hors ligne.** Il n'y a pas de *service worker*, et
  c'est délibéré : sur un outil de répartition partagé, un cache mal maîtrisé
  afficherait des attributions périmées, exactement ce que l'application
  existe pour éviter. Sans réseau, l'application ne se charge pas.
- **l'icône n'est pas définitive.** Le manifeste ne référence que
  `assets/favicon.ico`. Pour une vraie icône, il faut ajouter
  `assets/icon-192.png`, `assets/icon-512.png` et `assets/apple-touch-icon.png`
  (180×180), puis les déclarer ; iOS ignore le manifeste pour l'icône et lit
  uniquement `apple-touch-icon`.

---

## Segmentation

**419 participants** au 28 août 2026, soit l'intégralité de l'annuaire Whova
à cette date. Le volume bouge : 418 à l'import, 419 après l'enrichissement de
la page 1, et Whova affichait 425 inscrits le 27 août. L'écart entre
l'annuaire en ligne et la base est une information à relever, pas un détail à
lisser.

| Segment | Nb | Description |
|---|---:|---|
| `Client / Prospect` | 295 | la cible commerciale |
| `Esker (hote)` | 56 | équipe Esker, speakers, organisateurs — **visibles**, ce sont aussi des cibles |
| `Ecosysteme (exposant/sponsor)` | 52 | autres exposants, partenaires, éditeurs |
| `Analyste / Presse` | 9 | Gartner, IDC, Walker Sands, The Hackett Group… |
| `Fluxym (nous)` | 7 | nos collègues, masqués par défaut |

Répartition des cibles par fonction : Finance / Treasury 66, AP / P2P 59,
AR / O2C / Credit 57, IT / ERP / Data 38, Sales / Marketing / Partner 20,
Direction générale 15, Autre 39.

### Priorité de contact

**117 A, 183 B, 111 C.** La règle complète est exposée dans l'application
elle-même, page **Méthode** : c'est là qu'il faut la lire et la maintenir, pas
dans ce fichier que personne n'ouvrira pendant l'événement.

Ce qu'il faut retenir ici :

* La formule ne connaît que trois choses, toutes venant de Whova : société,
  tags, intitulé de poste. **Aucune donnée commerciale.** Elle ne sait pas qui
  est déjà client, ni où il y a une affaire en cours. Elle dégrossit 419
  lignes, elle ne décide pas.
* Un client ou prospect qui envoie **4 personnes ou plus** gagne un cran de
  priorité. Un compte qui se déplace en groupe a un projet ; c'est un signal
  plus fiable qu'un intitulé de poste isolé. Le bonus ne s'applique pas aux
  équipes Esker ni aux exposants, dont les effectifs ne signifient rien.
* Les équipes **Esker sont priorisées mais plafonnées à B** : ce sont des
  relations partenaires, la file A reste la file commerciale.
* Les **contributeurs AP et AR** sont en B et non en C : ce sont les
  utilisateurs quotidiens de la solution, donc les meilleurs prescripteurs
  internes, et les plus faciles à aborder sur un stand.

**La priorité est modifiable dans la fiche.** Quatre colonnes portent
l'arbitrage : `priority` est la valeur effective, `priority_auto` la
suggestion de la formule, `priority_why` la phrase d'explication affichée,
`priority_manual` et `priority_by` disent qui a tranché. Un trigger gèle
`priority_auto` et `priority_why` côté base : le client peut les lire, pas les
réécrire, sinon la suggestion d'origine se perdrait au premier arbitrage.
`priority_manual` n'est pas déclaré par le client, il est **dérivé** de l'écart
entre la valeur retenue et la suggestion, ce qui rend le bouton *Revenir à la
suggestion* infaillible.

Pour rejouer la formule après un changement de règle ou un rechargement de
données, exécuter `select public.recompute_priorities();` depuis le SQL editor.
La fonction ne touche jamais une priorité fixée à la main, et son droit
d'exécution est révoqué pour `anon` et `authenticated`.

### Libellés de société

Whova laisse chacun saisir sa société en texte libre : la même entreprise
apparaissait sous plusieurs libellés (`Milliken and Company` et
`Milliken & Company`, `Esker` et `Esker Inc`, trois orthographes pour
`Oil Dri`…). Cela cassait le filtre *Société* et faisait sous-estimer les
comptes où plusieurs personnes sont présentes : `Milliken` passe de 4 à 7
personnes une fois regroupé.

Les libellés sont normalisés, et la saisie d'origine est conservée dans
`attendees.company_raw`. C'est elle qui fait foi si un regroupement s'avère
abusif. Deux entités volontairement laissées distinctes : `A. Lassonde`
(Canada) et `Lassonde Pappas & Company` (États-Unis).

Priorité **A** = décideur (C-level, VP, Director) sur une fonction cœur de
cible (AP/P2P, AR/O2C, Finance, IT/ERP, direction générale).
