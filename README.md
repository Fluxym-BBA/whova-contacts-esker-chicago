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
│ sw.js  manifest.webmanif. │        │                                      │
│   coquille en cache,      │        │   Jamais mis en cache par sw.js :    │
│   ouverture hors réseau   │        │   ni les tables, ni l'authentif.     │
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

**Ce qui est stocké sur l'appareil** (depuis le 28 août, voir « Hors
connexion ») : la session Supabase, comme avant, plus une copie de l'annuaire
et du profil sous les clés `fx.rows.v1` et `fx.session.v1`. Ces copies
contiennent des noms, des fonctions et des sociétés en clair, donc des données
personnelles, mais elles n'ajoutent pas de risque nouveau : la session vivait
déjà là, et un téléphone déverrouillé donnait déjà accès à l'annuaire. Deux
précautions : **toutes les clés `fx.*` sont effacées à la déconnexion**
(`forgetLocal()` dans `js/api.js`, appelé aussi lorsqu'un compte perd son accès),
et **rien de ce mécanisme n'accorde un droit** — la RLS reste seule juge, côté
serveur, et aucune écriture n'aboutit sans réseau.

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

**L'adresse de connexion est figée à la création.** `admin-users` sait
renommer un membre, changer sa couleur, l'activer ou le désactiver, mais son
action `update` ne touche **jamais** l'e-mail : c'est l'identifiant du compte
`auth`. Créer un compte sous une adresse approximative se paie donc au prix
d'un identifiant approximatif à vie, ou d'une correction directe en base sur
`auth.users` et `auth.identities`. Le 28 août, deux comptes ont été créés
avant que l'adresse exacte soit connue : `lucas@fluxym.com` faute de connaître
le nom de famille, et `mbalanger@fluxym.com` au lieu de `mpbalanger`. Le
second a été corrigé en base, ce qui n'était sans risque que parce que le
compte ne s'était jamais connecté. **Vérifier l'adresse avant de créer le
compte coûte cinq secondes.**

Ne jamais supprimer un compte pour le recréer sous la bonne adresse :
`attendees_owner_fkey` est en `on delete set null`, la suppression libérerait
tout son portefeuille en silence.

**Désactiver plutôt que supprimer.** Décocher *Compte actif* coupe l'accès
en conservant le portefeuille. La suppression, elle, libère tous les
contacts suivis, exige de retaper le nom exact, et annonce à l'avance
combien de contacts redeviendront libres.

---

## Arborescence

```
.
├── .nojekyll                     ABSENT du dépôt au 28/08 (voir « Déploiement »)
├── login.html                    js/login.js
├── index.html                    js/app.js      annuaire, attribution, suivi
├── methode.html                  js/methode.js  méthode de priorisation
├── compte.html                   js/compte.js   profil et mot de passe
├── admin.html                    js/admin.js    gestion des comptes
├── manifest.webmanifest          installation sur l'écran d'accueil (voir « Sur téléphone »)
├── sw.js                         service worker : coquille en cache, ouverture hors réseau
├── css/app.css
├── js/
│   ├── config.js                 URL + clé anon
│   ├── api.js                    client, garde d'authentification, appels admin
│   └── nav.js                    navigation partagée
├── assets/
│   ├── favicon.ico               onglet de navigateur
│   ├── icon-192.png              Android, écran d'accueil
│   ├── icon-512.png              Android, écran de démarrage
│   ├── icon-maskable-512.png     Android, icône rognée par le système
│   └── apple-touch-icon-180.png  iOS, qui ignore le manifeste
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

### Savoir quelle version est réellement affichée

Le sous-titre de l'en-tête affiche `Esker All Access 2026 · interface v6`. Ce
libellé est écrit dans `css/app.css`, pas dans le HTML : s'il apparaît, c'est
que la feuille de style chargée est bien la dernière. **Ce numéro doit être
incrémenté à chaque livraison qui touche `css/app.css`.**

Le 28 août, une demi-heure a été perdue à se demander si un déploiement était
passé : les fichiers étaient corrects dans le dépôt, l'interface semblait
inchangée, et rien à l'écran ne permettait de trancher. Un marqueur visible
coûte une ligne de CSS et supprime la question.

### Une seule présentation, quelle que soit la largeur

Jusqu'au 28 août, la bande de lettres latérale, la fiche agrandie et l'échelle
typographique relevée étaient enfermées dans le palier `max-width:900px`. Sur un
écran d'ordinateur, **ces éléments n'existaient pas**. Deux conséquences, l'une
gênante et l'autre coûteuse. Impossible de vérifier depuis un poste de travail
ce que l'équipe verrait sur le stand. Et surtout, un travail livré pouvait
sembler absent alors qu'il était en ligne : trois livraisons ont été jugées
« sans effet » le 28 août pour cette seule raison.

Ce qui s'applique désormais **à toutes les largeurs** : l'échelle typographique
complète, les cibles à 50px, la ligne d'action de la carte sur deux rangées, la
bande de lettres latérale, la fiche détaillée en fenêtre centrée, les champs de
saisie à 16px.

Ce qui reste **propre au téléphone**, parce que lié au petit écran et non à une
préférence : la colonne unique, le menu burger à la place des liens de
navigation, la barre d'onglets basse, la fiche en plein écran intégral, les
feuilles qui montent du bas, le menu de filtres à deux niveaux et le repli du
tableau de bord.

La fiche détaillée n'est plus un panneau collé au bord droit. Un panneau de
470px sur un écran large tassait le texte dans un couloir et forçait l'oeil à
quitter le centre. C'est maintenant une fenêtre centrée de 780px au plus, sur
fond assombri, qui repasse en plein écran sous 900px.

Point d'attention pour la suite : les règles communes sont regroupées dans un
bloc unique, **avant** les deux paliers téléphone. Une déclaration ajoutée dans
un palier téléphone écrase donc son équivalent commun. C'est exactement le
piège qui a fait survivre les valeurs de la première passe et annulé les
suivantes sur téléphone.

### `diag.html`, page de diagnostic d'affichage

Accessible sans connexion sur `/diag.html`. Elle charge la vraie feuille de
style et **mesure ce que le navigateur applique reellement** : largeur utile de
la page, mise en page retenue, taille du nom sur une fiche, hauteur du bouton
d'action. Elle affiche aussi une fiche de demonstration avec le vrai CSS et la
bande de lettres, ce qui permet de juger l'ergonomie sans se connecter.

Son interet est de trancher entre trois causes qui produisent le meme symptome
apparent, à savoir « rien n'a change » :

1. la fenetre depasse 900px, donc la mise en page ordinateur est normale ;
2. le navigateur applique une feuille anterieure, malgre un fichier correct en
   ligne, ce qui pointe un cache, un proxy reseau ou une application ajoutee a
   l'ecran d'accueil ;
3. la feuille n'est pas chargee du tout.

Elle appelle le CSS avec `?diag=...`, une URL utilisee nulle part ailleurs,
pour qu'aucune entree de cache existante ne puisse la servir. Elle ne charge ni
`js/config.js` ni `js/api.js` et ne touche a aucune donnee.

### `.nojekyll`

**Ce fichier est absent du dépôt au 28 août 2026**, alors qu'une version
antérieure de ce README le déclarait indispensable. Dans les faits `css/` et
`js/` sont bien servis, Jekyll n'excluant que les dossiers commençant par un
souligné. Le recréer reste préférable, par sécurité et parce que le jour où un
dossier prendra un nom commençant par `_`, le diagnostic sera pénible. Il se
crée depuis GitHub : *Add file → Create new file*, nommer `.nojekyll`, laisser
le contenu vide, valider.

Résidus à supprimer quand l'occasion se présente : `COMMIT_MESSAGE.txt` et
`config.js` à la racine, `assets/app.js` et `assets/styles.css`, plus référencés
par aucune page.

### Versionner les appels, à chaque livraison

Les pages appellent leurs fichiers avec une étiquette de version :

```html
<link rel="stylesheet" href="./css/app.css?v=20260828f">
<script src="./js/app.js?v=20260828f"></script>
```

**Cette étiquette doit changer dès qu'un fichier de `css/` ou `js/` change**,
dans les cinq pages à la fois. Sans elle, GitHub Pages annonce ses fichiers
pour dix minutes et Safari iOS les garde souvent plus longtemps : on déploie
un correctif, et une partie de l'équipe continue de voir l'ancienne version
sans le savoir. C'est acceptable en préparation, ce serait très coûteux
pendant l'événement, où personne n'ira vider un cache entre deux visiteurs.

Convention : date du jour plus une lettre par livraison, `20260828f` étant la
sixième du 28 août. Le CDN `supabase-js` et les polices Google ne sont pas
versionnés, ils portent déjà leur propre numéro de version.

**Depuis l'ajout de `sw.js`, cette étiquette existe à deux endroits et les deux
doivent bouger ensemble** : le `?v=` des pages, et la constante `VERSION` en
haut de `sw.js`. Le service worker met la coquille en cache sous les URL
exactes qu'il trouve dans les pages ; si les deux valeurs divergent, il met en
cache des fichiers que personne ne demande, et sert au navigateur les anciens.
Une livraison qui oublie `VERSION` ne changera donc rien sur les téléphones de
l'équipe, et c'est exactement le genre de panne qu'on ne diagnostique pas un
mardi matin sur un stand. En cas de doute : le marqueur `interface v6` de
l'en-tête dit quelle feuille de style est réellement chargée.

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

## Répartition des portefeuilles

Le propriétaire d'un contact n'est **pas calculé**. C'est une décision
humaine, elle se reprend en un clic, et rien dans le code ne la contraint.
La répartition initiale du 28 août a suivi cinq règles appliquées dans cet
ordre : dirigeants des clients et des exposants à Christophe et Karina ;
fonction IT / ERP / Data hors dirigeants à Vincent ; salariés Esker
francophones à Maxime et Bruno ; salariés Esker anglophones aux plus séniors
pour Karina et aux opérationnels pour Enzo ; clients restants par société
entière entre Lucas, Bruno et Maxime.

Une part des contacts reste **volontairement libre**, dont les neuf analystes
et journalistes. L'objectif est d'une soixantaine de contacts par personne,
et personne n'y est : c'est à chacun de se servir. Les compteurs à jour sont
dans l'annuaire, pas ici, parce qu'ils bougent tous les jours.

Deux points qui se discutent sur le stand plutôt que dans ce fichier. Dans la
dernière règle, **une société n'a qu'un seul propriétaire**, pour ne jamais
solliciter deux fois le même compte ; les règles précédentes coupent au
contraire en travers des sociétés, donc un directeur financier peut être chez
Christophe et son responsable applicatif chez Vincent, c'est voulu. Et le
partage francophone / anglophone chez Esker est une **déduction**, pas une
donnée : la localisation n'est connue que pour 24 des 56 salariés Esker.

La règle est aussi documentée dans `methode.html`, qui est la page que
l'équipe ouvre pendant l'événement. Personne ne lira ce README sur le stand.

## Quatre messages, un par famille de destinataire

Le message prêt à copier dans la fiche dépend du segment. Le message unique
des premières versions demandait à un salarié d'Esker comment il utilisait
Esker, et à un prospect qui n'a jamais rien signé comment il l'utilisait
aujourd'hui.

| Famille | Angle |
|---|---|
| Client ou prospect | son processus, AP, AR, finance ou ERP selon `job_function`, **sans présumer qu'il est déjà client Esker** ; version courte et créneau borné pour un C-level ou un Director |
| Équipe Esker | les comptes qu'il couvre et ce qu'il attend d'un intégrateur |
| Exposant ou sponsor | entre pairs, aucun pitch |
| Analyste ou presse | le point de vue de l'intégrateur sur le marché |
| Collègue Fluxym | aucun message, le bloc disparaît de la fiche |

### Le message est modifiable et conservé

`attendees.message` (texte) et `attendees.message_at` stockent la version
rédigée à la main. `null` signifie « rien de personnalisé », et la fiche
affiche alors le modèle calculé. Trois décisions de conception :

* **Un texte identique au modèle est stocké à `null`.** Sans cela, ouvrir une
  fiche et enregistrer suffirait à figer le modèle du jour, et un changement
  de segment laisserait derrière lui un message qui ne correspond plus.
* **La colonne n'est écrite que si elle change**, pour ne pas déplacer
  `message_at` à chaque enregistrement de fiche.
* **Le modèle ne reprend jamais la main tout seul.** Comme pour la priorité,
  ce qu'un humain a écrit ne s'écrase pas : il faut le bouton
  *Revenir au modèle*, puis enregistrer.

La colonne est exposée par `select("*")`, hérite de la policy `att_write`
conditionnée à `is_fluxym()` comme le reste de la table, et part en dernière
position de l'export CSV, où chaque champ est déjà mis entre guillemets et ses
guillemets doublés : un texte multi-ligne ne casse pas le fichier.

Ce que la colonne ne dit pas : **elle ne prouve pas l'envoi.** Whova n'expose
rien, donc la base sait ce qui a été rédigé, pas ce qui a été envoyé. Seuls
`status` et `contacted_at` portent cette information.

La famille est **déduite du segment** (`MSG_KIND` dans `js/app.js`), jamais
saisie. Le tag Whova `Speakers` ajoute une phrase sur la session du contact.
Les messages sont en anglais, l'événement se tient à Rosemont ; l'interface
reste en français, c'est notre outil interne.

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
| Filtres | panneau visible en clair, 4 colonnes | feuille remontante, puis **menu à deux niveaux** : liste des filtres, puis liste des valeurs en plein écran |
| Choix d'une valeur | menu déroulant natif | liste de lignes de 52px, nombre de fiches par valeur, recherche interne au-delà de 12 options |
| Filtres actifs | visibles dans le panneau | rappelés en pastilles supprimables sous la recherche |
| Vues | onglets en haut | barre basse dans la zone du pouce, avec le compteur du portefeuille |
| Tableau de bord | six indicateurs dépliés | replié, résumé en une ligne |
| Index alphabétique | barre A-Z horizontale au-dessus de la liste | **curseur vertical collé au bord droit**, disponible pendant tout le défilement |
| Fiches | grille de cartes | une colonne, texte agrandi |
| Fiche détaillée | panneau latéral de 470px | **plein écran**, croix explicite ou glissé de l'entête vers le bas |
| Liens de pages | dans la barre de navigation | dans le menu de la barre de navigation |

Trois de ces choix viennent d'un essai sur téléphone, pas d'un principe :

- **le curseur alphabétique latéral.** L'index horizontal obligeait à remonter
  la liste entière pour changer de lettre. Le curseur reste sous le pouce
  pendant tout le défilement : le doigt glisse, la liste suit, une bulle
  affiche la lettre visée. Il n'affiche que les lettres atteignables après
  filtrage, et disparaît en dessous de cinq lettres, où il serait trompeur.
  Le saut se cale sous les barres collantes en mesurant leur position réelle.
- **le menu de filtres à deux niveaux.** Un menu déroulant natif portant 182
  sociétés se vise dans une roue, sans recherche. Les `<select>` restent la
  source de vérité, y compris pour l'affichage sur ordinateur ; le menu les
  double sans dupliquer l'état, donc deux valeurs ne peuvent pas diverger pour
  le même filtre.
- **la fiche en plein écran.** À 93dvh elle donnait une demi-page, ni panneau
  ni page. Elle occupe maintenant tout l'écran : on l'ouvre, on saisit, on la
  ferme, et on retrouve la liste à l'endroit où on l'avait laissée.

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
- **Cibles tactiles à 44px minimum** (`--touch`), 46 à 52px pour les actions
  principales et les lignes de menu. *Je prends* faisait 30px de haut.
- **Échelle typographique, troisième passe (28 août).** Les deux premières
  passes avaient grossi le nom en laissant le reste derrière : intitulé de
  poste 13px, localisation 12px, pastilles 10,5px, libellés d'onglets 10,5px,
  lettres du curseur A-Z 10px. Illisible debout, à bout de bras, dans une
  allée éclairée au néon. Plancher retenu : **rien en dessous de 12px**, et
  rien en dessous de 13px sur ce qu'on lit en marchant.

  | Élément | Avant | Maintenant |
  |---|---|---|
  | Nom | 16,5px | **19px**, gras appuyé |
  | Société | 14px | **16px**, gras |
  | Intitulé de poste | 13px sur 2 lignes | **14,5px sur 1 ligne** |
  | Localisation | 12px | **retirée de la carte** (elle reste dans la fiche) |
  | Pastilles de priorité | 10,5px | **13px** |
  | Qui a pris le contact | 12px, largeur ≤ 36% | **15px gras, largeur libre** |
  | *Je prends* et statut | 46px | **50px** |
  | Libellés d'onglets bas | 10,5px | **12px**, icônes 26px, barre 72px |
  | Lettres du curseur A-Z | 10px | **12,5px**, gouttière 32px |
  | Pastilles de filtre | 12,5px | **14px** |
  | Libellés du tableau de bord | 10,5px | **12,5px** |
  | Libellés de champ de la fiche | 11,5px | **13px** |

  Deux arbitrages assumés. La **localisation disparaît de la carte** : elle
  n'aide pas à décider d'aborder quelqu'un, et la place gagnée sert au nom.
  L'**intitulé de poste tient sur une seule ligne** : une ligne suffit à
  situer un interlocuteur, deux lignes de 13px faisaient de la carte un
  paragraphe. Les deux données restent intégralement dans la fiche.

  La ligne d'action de la carte peut désormais **passer à la ligne**
  (`flex-wrap`) : le nom de la personne qui a pris le contact n'est plus
  comprimé dans 36% de la largeur, puisque c'est l'information que l'on vient
  chercher en cinq secondes.

### Installée sur l'écran d'accueil

`manifest.webmanifest` lance l'application en plein écran, sans barre d'URL.
Les icônes sont déclarées en 192 et 512, plus une version *maskable* pour
Android, qui rogne les icônes selon la forme du lanceur, et un
`apple-touch-icon` de 180 pixels dans le `<head>` d'`index.html`, parce
qu'**iOS ignore purement et simplement le manifeste pour l'icône**. Sans cette
dernière balise, l'icône posée sur l'écran d'accueil d'un iPhone est une
vignette floue de la page.

L'écran de démarrage utilise `background_color` (`#f5f7fb`, le fond clair de
l'application) et non le bleu nuit de la barre : un flash sombre suivi d'une
interface claire se remarque plus qu'on ne l'imagine. `orientation` est fixé
à `portrait` : sur un stand, l'application se tient d'une main.

### Le geste retour, et pourquoi il compte plus que le reste

Installée, l'application n'a plus de barre d'adresse : **le geste retour
devient le seul geste de sortie**. Jusqu'au 28 août il quittait l'application
au lieu de fermer la fiche ouverte, ce qui suffisait à trahir un site web.

`js/app.js` inscrit donc deux choses dans l'historique du navigateur :
l'onglet courant, qui vit aussi dans le fragment d'URL (`#mine`), et un
**unique** niveau « panneau ouvert », commun à la fiche, à la feuille de
filtres et à sa sous-liste.

Un seul niveau pour trois panneaux, volontairement : empiler feuille, puis
sous-liste, puis fiche demanderait trois gestes retour pour revenir à la
liste. Un retour referme tout ce qui est ouvert, d'un coup. Le comportement
natif est conservé là où il doit l'être : depuis la liste, sans rien d'ouvert,
le retour quitte bien l'application.

Le fragment d'URL a un effet de bord utile : les vues sont partageables par
lien depuis un ordinateur, et les raccourcis du manifeste (appui long sur
l'icône) ouvrent directement *Mon portefeuille*.

### Hors connexion, et ce que cela n'autorise pas

Le README affirmait jusqu'au 28 août qu'il n'y aurait **pas** de *service
worker*, au motif qu'un cache mal maîtrisé afficherait des attributions
périmées. Le risque était juste, la conclusion trop large : elle laissait
l'application dépendre entièrement du wifi d'un centre de congrès, un mardi
matin, avec quatre cents personnes connectées en même temps. Sans réseau,
l'annuaire ne s'ouvrait pas du tout.

`sw.js` répond au risque au lieu de l'éviter, par trois choix explicites.

1. **La stratégie n'est pas « cache d'abord » mais « réseau d'abord, avec une
   limite de patience »** de 1200 ms. Si le réseau répond, sa réponse gagne
   toujours. S'il tarde, la copie locale s'affiche et la version fraîche est
   récupérée en arrière-plan. Le confort ne se paie jamais en fraîcheur.
2. **Les données Supabase ne sont jamais mises en cache par `sw.js`.** Ni les
   tables, ni l'authentification, ni l'Edge Function : ces requêtes ne sont
   même pas interceptées.
3. **La reprise de version n'est jamais automatique.** Aucun `skipWaiting()` à
   l'installation : un service worker qui prend la main tout seul recharge la
   page, et un rechargement au mauvais moment fait perdre une note qu'on
   était en train de taper devant quelqu'un. Un bandeau prévient, l'utilisateur
   décide.

**La copie de travail de l'annuaire** est gérée séparément, par `js/app.js`,
dans le stockage local (`fx.rows.v1`). Elle s'affiche avant même la réponse du
réseau, puis est remplacée silencieusement. Ce qu'elle **n'est pas** : une base
hors ligne. Aucune écriture n'est possible sans réseau, et c'est voulu. Deux
personnes qui s'attribueraient le même contact chacune de son côté, hors
ligne, puis se synchroniseraient, produiraient exactement le problème que
cette application existe pour résoudre. La copie sert à **lire** : savoir en
cinq secondes si un participant est déjà pris, et par qui.

Un bandeau en bas de l'écran, juste au-dessus de la barre d'onglets, dit
laquelle des deux situations s'applique : « Hors connexion, données locales de
10h42, aucune modification possible », ou « Nouvelle version disponible » avec
un bouton *Recharger*.

**Conséquence sur la garde d'authentification** (`js/api.js`) : la lecture de
`team` au démarrage échouait sans réseau, et cet échec était traité comme un
refus d'accès, donc une déconnexion. Plus de réseau, plus d'annuaire, au
moment précis où l'on en a besoin. Les deux cas sont désormais distingués : un
refus reste un refus et déconnecte ; une panne de réseau, avec une session
valide et un profil déjà connu, laisse entrer en lecture. **Cela n'accorde
aucun droit** : la RLS est inchangée et toute écriture continue de passer par
Supabase, donc échoue hors ligne.

À la première ouverture sur un appareil, sans réseau et sans copie locale,
l'application affiche un message explicite avec un bouton *Réessayer*, plutôt
qu'une page vide.

---

## Segmentation

**497 fiches** au 28 août 2026 au soir : les **496 participants** relevés dans l'annuaire Whova
à cette date, plus une fiche saisie à la main pour Lucas De LA VILLARDIERE
(`FX-LDLV`), qui n'est pas encore inscrit. Le volume bouge : 418 à l'import,
419 après l'enrichissement de la page 1, 425 affichés par Whova le 27 août,
464 après le relevé des pages 13 à 25, puis 497 après celui des pages 1 à 12,
le 28 août au soir. L'écart entre l'annuaire en ligne et la base est une
information à relever, pas un détail à lisser : Whova annonçait 493 inscrits
au même moment, dont deux fiches pour la même personne (Cassandra et Cassie
Cambridge, fusionnées vers `P262`), deux cartes pour Phil Binkow et deux pour
Sreeni Dhannawada, tandis que Marie Pierre Balanger, présente en base, n'est
pas inscrite sur Whova et que Dustin Collins (`P281`) n'y figure plus.

L'identifiant `FX-LDLV` sort volontairement de la série `P…` : quand Lucas
s'inscrira sur Whova, une seconde fiche apparaîtra à côté de celle-ci, et le
doublon doit se voir.

| Segment | Nb | Description |
|---|---:|---|
| `Client / Prospect` | 301 | la cible commerciale |
| `Esker (hote)` | 121 | équipe Esker, speakers, organisateurs — **visibles**, ce sont aussi des cibles |
| `Ecosysteme (exposant/sponsor)` | 55 | autres exposants, partenaires, éditeurs |
| `Analyste / Presse` | 12 | Gartner, IDC, Walker Sands, Acclaim Media, The Hackett Group… |
| `Fluxym (nous)` | 8 | nos collègues, masqués par défaut |

Esker représente désormais **une fiche sur quatre**. Les 121 salariés Esker
sont plafonnés en priorité B et la grande majorité tombe en C : la file C est
donc largement composée de personnes avec qui aucune affaire ne se qualifiera.
C'est assumé, l'annuaire sert aussi à mettre un nom sur un visage dans un
couloir, mais il faut le savoir avant de vouloir « répartir tout le monde ».

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
  est déjà client, ni où il y a une affaire en cours. Elle dégrossit 497
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
