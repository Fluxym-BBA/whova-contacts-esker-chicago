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
├── compte.html                   js/compte.js   profil et mot de passe
├── admin.html                    js/admin.js    gestion des comptes
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

**Anti-doublon** : un participant n'a qu'un seul responsable. S'il est déjà
pris, le bouton devient *Reprendre* et la confirmation nomme le collègue
concerné. Toute reprise est journalisée.

**Statuts** : `À contacter` → `Message envoyé` → `Répondu` → `RDV planifié`
→ `Rencontré`, ou `Sans suite`.

La fiche détaillée permet de noter un créneau, l'usage Esker du contact, des
notes libres, et de copier un **message Whova pré-rédigé** personnalisé au
contact comme à l'expéditeur.

Rafraîchissement automatique toutes les 20 secondes.

**Renommer un membre est sans danger** : `attendees.owner` référence
`team.name` en `on update cascade`, les contacts déjà attribués suivent.

---

## Segmentation

| Segment | Description |
|---|---|
| `Client / Prospect` | la cible commerciale |
| `Ecosysteme (exposant/sponsor)` | autres exposants, partenaires, éditeurs |
| `Esker (hote)` | équipe Esker, speakers, organisateurs |
| `Analyste / Presse` | Gartner, IDC, Walker Sands… |
| `Fluxym (nous)` | nos collègues |

Priorité **A** = décideur (C-level, VP, Director) sur une fonction cœur de
cible (AP/P2P, AR/O2C, Finance, IT/ERP, direction générale).
