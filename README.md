# Fluxym · Stand Esker All Access 2026

Application interne de pilotage des invitations sur le stand Fluxym
pendant **Esker All Access 2026** (Rosemont / Chicago, 8-10 septembre 2026).

Objectif : que les 7 Fluxym présents se répartissent proprement les
participants Whova, **sans jamais solliciter deux fois la même personne**.

---

## Architecture

```
GitHub Pages (statique)          Supabase (projet fluxym-esker-allaccess-2026)
┌──────────────────────┐         ┌─────────────────────────────────────────┐
│ index.html           │  HTTPS  │ Auth   : email / mot de passe           │
│ config.js            │ ──────► │ Table  : attendees  (participants)      │
│ assets/app.js        │  REST   │ Table  : team       (les Fluxym)        │
│ assets/styles.css    │         │ Table  : activity_log (traçabilité)     │
└──────────────────────┘         │ RLS    : whitelist des emails @fluxym   │
                                 └─────────────────────────────────────────┘
```

Aucune donnée n'est stockée dans le repo : tout vit dans Supabase.
La clé `anon` présente dans `config.js` est **publique par conception** ;
la sécurité repose sur les *Row Level Security policies* qui n'autorisent
que les emails inscrits dans la table `team`.

---

## Déploiement (GitHub Pages)

1. Pousser ces fichiers à la racine du repo (branche `main`).
2. *Settings → Pages → Source : Deploy from a branch → main / (root)*.
3. L'URL est disponible en 1-2 min.

> Le fichier `.nojekyll` évite que Jekyll ignore le dossier `assets/`.

---

## Arborescence

```
.
├── .nojekyll
├── index.html          écran de login + application
├── config.js           URL + clé anon Supabase
├── assets/
│   ├── app.js          logique (auth, filtres, attribution, journal)
│   └── styles.css      thème Fluxym
└── README.md
```

---

## Utilisation

| Onglet | Rôle |
|---|---|
| **Annuaire** | tous les participants, filtrables (priorité, segment, fonction, séniorité, société, statut, attribution) |
| **Mon portefeuille** | uniquement les contacts que je me suis attribués |
| **Répartition équipe** | qui a combien, avancement de chacun, reste à répartir |
| **Journal** | historique horodaté des prises et changements de statut |

**Anti-doublon** : un participant n'a qu'un seul responsable. Si quelqu'un
est déjà pris, le bouton devient *Reprendre* et une confirmation s'affiche
avec le nom du collègue concerné. Toute reprise est tracée dans le journal.

**Statuts** : `A contacter` → `Message envoye` → `Repondu` → `RDV planifie`
→ `Rencontre`, ou `Sans suite`.

La fiche détaillée (clic sur un nom) permet de noter le créneau de RDV,
l'usage Esker du contact, des notes libres, et de **copier un message
Whova pré-rédigé** personnalisé au contact et à l'expéditeur.

Rafraîchissement automatique toutes les 20 secondes : chacun voit en
quasi temps réel ce que font les autres.

---

## Segmentation appliquée

| Segment | Description |
|---|---|
| `Client / Prospect` | la cible commerciale |
| `Ecosysteme (exposant/sponsor)` | autres exposants, partenaires, éditeurs |
| `Esker (hote)` | équipe Esker, speakers, organisateurs |
| `Analyste / Presse` | Gartner, IDC, Walker Sands... |
| `Fluxym (nous)` | nos collègues |

Priorité **A** = décideur (C-level / VP / Director) sur une fonction cœur
de cible (AP/P2P, AR/O2C, Finance, IT/ERP, DG).
