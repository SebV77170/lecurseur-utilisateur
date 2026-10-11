# Securite, RGPD et HDS - cadrage V1

Ce document accompagne le prototype de developpement. Il ne constitue pas une validation juridique, medicale, HDS ou securite.

## Donnees sensibles

Les questionnaires peuvent contenir des retours de pratique et des informations de sante sensibles. La V1 doit donc etre pensee avec une logique de minimisation :

- ne collecter que les informations necessaires au suivi ;
- eviter les champs libres non indispensables ;
- distinguer notes administratives, ressources, messages et reponses de questionnaire ;
- informer les clients sur la finalite, la duree de conservation et leurs droits ;
- obtenir les validations necessaires avant toute collecte reelle.

## Mesures techniques attendues avant production

- Hebergement compatible HDS si le contexte juridique le requiert.
- Chiffrement au repos pour la base, les sauvegardes et les pieces jointes.
- Chiffrement TLS strict en transit.
- Authentification forte pour les comptes administrateurs et praticiens.
- Mots de passe haches avec algorithme adapte type Argon2id.
- Stockage des secrets dans un gestionnaire dedie.
- Journal d'audit immuable ou append-only.
- Controle d'acces teste route par route.
- Gestion de retention et purge des donnees.
- Export RGPD et suppression/verrouillage de compte.
- Analyse de risques, registre de traitements et clauses contractuelles.
- Tests d'intrusion et revue de code securite.

## Limites du prototype

- Comptes et invitations conserves dans un fichier local non chiffre ; autres donnees reinitialisees au redemarrage.
- Mots de passe personnels haches avec scrypt, invitations a usage unique de 72 heures, empreintes seules conservees.
- Les comptes de demonstration restent actifs : a retirer avant tout usage hors demonstration.
- Pieces jointes simulees par metadata, sans stockage reel.
- Jetons signes simplifiees pour demonstration.
- Pas de double authentification.
- Pas de chiffrement applicatif au repos.
- Pas de moteur complet de consentement.

Conclusion : le prototype sert a valider les parcours, la structure et les permissions. La conformite RGPD/HDS et l'audit securite doivent etre valides avant toute mise en production.

