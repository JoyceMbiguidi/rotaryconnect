# RotaryConnect

Application web installable (PWA) pour la gestion des réunions d'un club : confirmation de présence des membres,
suivi et pointage par la secrétaire, statistiques de participation pour le président.

- **Front** : HTML/CSS/JS sans dépendance, hébergé sur **GitHub Pages**, responsive (mobile d'abord).
- **API** : **Google Apps Script** ([apps-script/Code.gs](apps-script/Code.gs)).
- **Données** : **Google Sheet** (onglets `Membres`, `Reunions`, `Reponses`, `Relances`, `Config`).
- **Relances automatiques** : déclencheur Apps Script quotidien, e-mails aux membres sans réponse.

## Les trois espaces

| Rôle | Accès |
|------|-------|
| **Membre** | Prochaines réunions, « Je viens / Je ne viens pas » (+ remarque), historique, profil |
| **Secrétaire** | Création/modification/annulation de réunions, suivi des réponses, relance manuelle, pointage des présents, gestion des membres (création, rôle, activation, mot de passe provisoire), réglages des relances |
| **Président** | Tableau de bord, statistiques de participation par réunion / mois / membre (année rotarienne), export CSV |

La secrétaire et le président ont aussi accès à l'espace « Réunions » comme n'importe quel membre.

## Essayer tout de suite (mode démo)

`js/config.js` contient `API_URL: ''` : l'application fonctionne alors avec des données fictives stockées dans le
navigateur (le vrai `Code.gs` est exécuté dans un simulateur local). Comptes démo, mot de passe `demo1234` :
`secretaire`, `president`, `claire.dubois`.

```bash
python -m http.server 8080   # puis http://localhost:8080
```

## Mise en production

### 1. Google Sheet + Apps Script

1. Créez un Google Sheet vide (par ex. « RotaryConnect – données »).
2. **Extensions > Apps Script**. Remplacez le contenu de `Code.gs` par [apps-script/Code.gs](apps-script/Code.gs).
3. (Facultatif) **Paramètres du projet > Afficher « appsscript.json »** et reprenez [apps-script/appsscript.json](apps-script/appsscript.json) (fuseau horaire, autorisations).
4. Sélectionnez la fonction **`setup`** et cliquez sur **Exécuter**. Autorisez l'accès.
   Elle crée les onglets, la configuration, le secret de session, le déclencheur quotidien des relances, et un compte
   `secretaire`. Son **mot de passe provisoire** s'affiche dans le journal d'exécution (à changer à la première connexion).
5. **Déployer > Nouveau déploiement > Application Web** : *Exécuter en tant que* **moi**, *Qui a accès* **Tout le monde**.
   Copiez l'URL (`https://script.google.com/macros/s/…/exec`).

> L'accès « Tout le monde » concerne l'URL de l'API ; les données restent protégées par l'identifiant / mot de passe
> (mots de passe hachés et salés, jeton de session signé HMAC valable 7 jours, blocage 15 min après 5 échecs).
> Après toute modification de `Code.gs`, créez une **nouvelle version** du déploiement.

### 2. GitHub Pages

1. Dans `js/config.js`, renseignez `API_URL` avec l'URL du déploiement.
2. Poussez le dossier sur un dépôt GitHub, puis **Settings > Pages > Deploy from a branch** (`main`, dossier `/ (root)`).
3. L'application est disponible sur `https://<utilisateur>.github.io/<dépôt>/`.
4. Dans l'onglet `Config` du Sheet, renseignez `URL_APP` avec cette adresse : elle figure dans les boutons des e-mails.

### 3. Installation sur smartphone

- **Android / Chrome** : bouton « Installer l'application » (ou menu ⋮ > *Installer l'application*).
- **iPhone / Safari** : **Partager > Sur l'écran d'accueil**.

## Relances automatiques

Réglables par la secrétaire (bouton **Réglages** du Secrétariat) ou dans l'onglet `Config` :

- `JOURS_RELANCE` (défaut `7,2`) : un rappel à J-7 puis J-2 pour chaque membre actif **sans réponse** ayant une adresse e-mail.
  Chaque palier n'est envoyé qu'une fois par membre (traçabilité dans l'onglet `Relances`).
  Une réunion créée à J-5 déclenche directement le palier J-2, pas J-7.
- `HEURE_RELANCE` (défaut `9`) : heure du déclencheur quotidien (`envoyerRelances`).
- `RELANCES_ACTIVES` : `oui` / `non`.
- La secrétaire peut aussi **relancer manuellement** une réunion (limité à une fois par heure).

Quotas Google : environ 100 e-mails/jour avec un compte gratuit, 1 500 avec Google Workspace. Au-delà, les envois s'arrêtent
et reprennent au prochain passage du déclencheur.

## Données

Les e-mails, créations de membres et réglages passent par l'API ; ne modifiez le Sheet à la main que pour dépanner.
La suppression d'un membre n'existe pas (on le **désactive**) afin de conserver l'historique des statistiques.
Les dates sont stockées en texte (`aaaa-mm-jj`, `hh:mm`) ; les colonnes sont déjà au format texte par `setup()`.

## Structure

```
index.html · manifest.webmanifest · sw.js   PWA (installable, fonctionne hors ligne pour la coque)
css/style.css                               styles responsive
js/app.js · js/ui.js · js/api.js            application, composants, client API
js/config.js                                URL de l'API
js/gas-shim.js · js/demo-seed.js            mode démo (simulateur Apps Script + données fictives)
apps-script/Code.gs                         API (à coller dans Apps Script)
```

## Sécurité – points d'attention

- Ne publiez pas d'identifiants réels dans le dépôt. Le secret de session est stocké dans les propriétés du script, pas dans le Sheet.
- Les mots de passe provisoires sont affichés une seule fois à la secrétaire ; changement obligatoire à la première connexion.
- Limitez le partage du Google Sheet aux seuls administrateurs : il contient les e-mails et téléphones des membres.
- Pensez à la conformité RGPD (information des membres sur les données conservées).
