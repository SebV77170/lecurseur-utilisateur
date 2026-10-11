# Le Curseur - Mon espace

Prototype PWA V1 pour un espace client prive. Les fiches de demonstration sont fictives ; la bibliotheque permet d'importer et de partager de vrais fichiers.

> Important : ce projet est une base de developpement et de demonstration. Il ne doit pas etre utilise en production avec de vraies donnees de sante avant validation juridique RGPD, choix d'un hebergeur HDS si applicable, revue d'architecture securite, audit applicatif et tests d'intrusion.

## Perimetre couvert

- Connexion par comptes d'invitation prives.
- Roles `admin`, `praticien` et `client`.
- Fiches clients et administration.
- Bibliotheque de ressources PDF, audio et images.
- Attribution personnalisee des ressources aux clients.
- Questionnaires versionnes, publication et reponses client.
- Messagerie privee avec pieces jointes fictives.
- Journal d'audit, demandes RGPD et principes de minimisation.
- Prototype PWA installable cote frontend.

## Apparence et disponibilite

L'interface reprend la palette de www.lecurseur.com : violet `#9900ff`, lavande `#b4a7d6` et fond creme `#f8f4ec`, y compris l'icone et le theme de l'application installable.

Les fonctions a venir apparaissent en gris avec une mention **A venir** : pieces jointes de la messagerie et telechargement de l'export RGPD. Leurs commandes sont desactivees. Les profils, invitations, fiches clients, ressources, questionnaires et messages texte sont utilisables. L'audit apparait en gris pour les roles qui n'y ont pas acces.

## Structure du projet

```text
backend/     API Express TypeScript, base relationnelle SQLite et stockage des fichiers
frontend/    React TypeScript + Vite, PWA, interface responsive
docs/        Notes securite, RGPD, HDS et decisions d'architecture
```

## Prerequis

- Node.js 22.13+ (module natif `node:sqlite`, experimental avec Node 22)
- npm 10+

## Installation

```bash
npm install
```

## Lancement en developpement

```bash
npm run dev
```

- Frontend : http://localhost:5180
- Backend : http://localhost:4000

Comptes fictifs :

| Role | Email | Mot de passe |
| --- | --- | --- |
| Admin | admin@lecurseur.local | DemoCurseur!2026 |
| Praticien | praticienne@lecurseur.local | DemoCurseur!2026 |
| Client | camille.client@example.test | DemoCurseur!2026 |

## Creation des profils

- Connectez-vous avec le compte administrateur, puis utilisez **Profils et invitations** pour creer un administrateur, un praticien ou un client.
- Un praticien peut creer uniquement ses propres clients. Un administrateur doit choisir un praticien actif lorsqu'il cree un client.
- Transmettez le lien d'activation affiche au destinataire : aucun e-mail n'est envoye automatiquement dans cette version.
- Le destinataire choisit et confirme son mot de passe personnel (12 a 128 caracteres). Il est ensuite connecte a son espace.
- Le lien expire apres 72 heures et ne fonctionne qu'une fois. Le bouton de lien d'un profil en attente genere une nouvelle invitation et invalide la precedente.
- Les profils, mots de passe haches avec scrypt et empreintes des invitations sont conserves dans la base SQLite, exclue de Git. Aucun mot de passe ni lien d'activation complet n'y est enregistre.
- `FRONTEND_ORIGIN` permet de configurer l'adresse utilisee pour les invitations. `DATABASE_FILE` permet de choisir le fichier SQLite (chemin absolu conseille).

Les relations entre utilisateurs, fiches clients et praticiens sont controlees par des cles etrangeres. Les adresses e-mail sont uniques sans distinction de casse. Les invitations et activations sont enregistrees en transaction avec le journal d'audit. Les comptes de demonstration sont crees uniquement lors de l'initialisation d'une nouvelle base sans ancien fichier de comptes.

## Base de donnees et migration

La base `backend/data/lecurseur.sqlite` est creee automatiquement au demarrage. Elle contient les tables `users`, `clients`, `credentials`, `invitations`, `resources`, `resource_assignments`, `questionnaires`, `questionnaire_assignments`, `questionnaire_responses`, `messages` et `audit_events`, ainsi que les versions du schema. Les objets imbriques (reponses, consentement, pieces jointes) sont stockes dans des colonnes JSON validees. Les lectures utilisent la base a chaque requete ; les messages, reponses et audits persistent apres redemarrage.

Au premier lancement, les anciens fichiers `backend/data/accounts.json` et `backend/data/resources/index.json` sont importes dans une seule transaction, avec les hachages de mots de passe et les invitations encore valables. Les fichiers sources et les fichiers binaires sont conserves. Un fichier invalide, une ressource manquante ou une relation incoherente fait echouer l'import sans enregistrer de donnees partielles. Corrigez la source avant de relancer. Une fois l'import termine, les anciens JSON ne sont plus lus ni mis a jour. `ACCOUNTS_FILE` reste disponible uniquement pour choisir la source de cette migration.

Les anciennes donnees uniquement en memoire ne peuvent pas etre recuperees apres l'arret de l'ancien serveur. Les exemples de messages et questionnaires initialisent la nouvelle base une seule fois.

```bash
npm run db:init
npm run db:check
npm run db:backup
```

`db:init` initialise ou migre la base de facon idempotente. `db:check` verifie l'integrite SQLite et les cles etrangeres. `db:backup` cree une copie coherente de la base dans `backend/data/backups/` avec `VACUUM INTO` et refuse d'ecraser un fichier existant. Un chemin de destination peut etre fourni : `npm run db:backup -- C:/sauvegardes/lecurseur.sqlite`.

Pour une sauvegarde complete, arretez l'API, executez `db:backup`, puis copiez aussi le dossier des ressources. Conservez ces deux elements ensemble. Pour restaurer, arretez l'API, conservez l'ancienne base et ses eventuels fichiers `-wal` et `-shm` ailleurs, puis restaurez la copie SQLite et le dossier des ressources correspondant. Vous pouvez pointer `DATABASE_FILE` vers la copie restauree. Ne copiez pas uniquement le fichier SQLite d'une base en cours d'utilisation : le journal WAL peut contenir des ecritures recentes.

Ce stockage local n'est pas chiffre au repos et ne doit pas contenir de donnees de sante reelles dans cette version. Les conditions de mise en production restent celles decrites dans les notes de securite. L'implementation utilise le [module SQLite natif de Node.js](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html), sans dependance supplementaire.

## Fichiers et ressources

- Connectez-vous comme administrateur ou praticien, puis ouvrez **Ressources** et utilisez **Ajouter un fichier**. La bibliotheque commence vide : les anciennes cartes fictives ont ete retirees.
- Formats acceptes : PDF, MP3, WAV, M4A, OGG, PNG, JPEG et WebP, avec une limite de 20 Mo par fichier. Le serveur controle l'extension et la signature du contenu ; HTML et SVG ne sont pas acceptes.
- Utilisez **Consulter**, **Ecouter** ou **Telecharger** pour acceder au fichier original.
- Selectionnez un client au-dessus de la bibliotheque, ajoutez une consigne facultative, puis cliquez sur **Attribuer**. **Retirer l'acces** annule l'attribution. Un client ne voit et ne telecharge que ses fichiers attribues.
- Les fichiers originaux sont conserves dans `backend/data/resources/`, exclu de Git ; leur catalogue et les attributions sont dans SQLite. `RESOURCES_DIRECTORY` permet de choisir un autre dossier de fichiers.
- Aucun fichier n'est expose par une URL publique : la lecture requiert une session et les autorisations correspondantes. Un fichier deja telecharge par un client ne peut pas etre efface de son appareil a distance.
- Sauvegardez ensemble le dossier des ressources et la base SQLite, selon la procedure ci-dessus.

## Questionnaires

- Dans **Questionnaires**, le praticien ou l'administrateur peut creer et enregistrer un brouillon, le modifier, puis le publier. Chaque praticien gere ses propres creations ; les anciens exemples sans auteur restent des modeles communs.
- Huit types sont disponibles : texte court, texte long, choix unique, choix multiples, echelle avec curseur, nombre, date et oui/non. Les echelles comportent des bornes configurables (par exemple 1 a 10), des valeurs intermediaires entieres et l'affichage de la valeur choisie. Une question obligatoire avec curseur exige un choix explicite.
- Chaque question peut etre obligatoire, comporter une aide, etre deplacee, dupliquee ou supprimee. Les choix sont personnalisables ; les textes acceptent une longueur maximale, les nombres des bornes, les choix multiples un minimum et un maximum de selections. Limites : 100 questions et 50 choix par question ; jusqu'a 101 valeurs entieres par echelle.
- L'apercu patient permet de tester la saisie et la validation sans transmettre de reponses. Les questions obligatoires et les formats sont controles aussi par le serveur.
- Apres publication, **Envoyer aux patients** permet de choisir un ou plusieurs patients suivis, une echeance facultative et une consigne. Le questionnaire apparait dans leur espace prive ; aucun e-mail ou SMS n'est envoye automatiquement. Les patients en attente d'activation y accedent apres activation. L'echeance est indicative et ne bloque pas une reponse tardive.
- Un patient peut repondre une seule fois par envoi et consulter ensuite ses reponses. La saisie est enregistree uniquement lors de **Envoyer mes reponses**. Les erreurs d'envoi conservent les reponses tant que le formulaire reste ouvert.
- Le praticien retrouve les envois du patient selectionne dans **Fiches clients**, consulte ses reponses et les marque comme examinees. **Actualiser** recharge le suivi.
- Une version publiee ne peut plus etre modifiee : **Dupliquer** cree une nouvelle version en brouillon. **Archiver** empeche les nouveaux envois, tout en conservant les reponses et les questionnaires deja transmis. Un nouvel envoi est possible une fois le precedent termine, pour un suivi regulier.
- Les creations, publications, attributions, reponses et examens sont persistants dans SQLite et journalises. La migration de schema conserve les anciennes questions, attributions et reponses.

## Tests

```bash
npm test
```

## Build

```bash
npm run build
```

## Notes de securite

Le prototype inclut volontairement des controles de base :

- authentification par jeton signe cote backend ;
- verification de role sur les routes sensibles ;
- journalisation des actions importantes ;
- en-tetes de securite HTTP ;
- separation stricte des donnees client selon le role ;
- aucune vraie donnee de sante dans les fixtures.

Avant production, il faudra definir le chiffrement au repos, renforcer la gestion des sessions et des secrets, industrialiser le stockage de fichiers et les sauvegardes, gerer la retention, le consentement et l'export/suppression RGPD, ainsi que mener une revue HDS/RGPD complete. SQLite convient a cette installation sur un serveur unique ; une architecture avec plusieurs instances d'API devra etre adaptee.

