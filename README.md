# D.N.A — Data Novice Area

Plateforme de formation en ligne : comptes apprenants, formations gratuites et payantes, leçons avec vidéos / audios / images / documents, quiz de 2 à 4 questions à chaque leçon, suivi de progression, espace formateur multi-formateurs et administration.

## Architecture

| Élément | Outil | Contenu |
|---|---|---|
| Site (pages, design) | **GitHub Pages** | dossier `frontend/` — HTML, CSS, JavaScript, sans étape de compilation |
| Comptes, base de données, fichiers | **Supabase** | `supabase/schema.sql` — tables, règles d'accès (RLS), stockage |
| Paiement par carte + formulaire de contact | **Render** | dossier `backend/` — petite API Node.js |
| Paiement carte | **Stripe** | paiement hébergé par Stripe (aucune donnée de carte chez vous) |
| Mobile Money / virement | Validation manuelle | l'apprenant déclare sa référence, vous validez dans l'espace formateur |
| Domaine | **Hostinger** | DNS vers GitHub Pages (site) et Render (API) |

```
dna/
├── frontend/                 → le site (publié sur GitHub Pages)
│   ├── index.html, catalogue.html, cours.html, lecon.html,
│   │   connexion.html, compte.html, studio.html, mentions-legales.html, 404.html
│   └── assets/ (css, js, img)
├── backend/                  → l'API (déployée sur Render)
├── supabase/schema.sql       → à exécuter une fois
├── supabase/seed.sql         → les 2 formations Excel de départ
├── scripts/build-config.mjs  → génère la configuration à partir des secrets GitHub
├── .github/workflows/deploy-pages.yml
└── render.yaml
```

### Où sont les clés ?

Aucune clé n'est dans le code.

| Clé | Où la mettre | Visible dans le navigateur ? |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Secrets GitHub | **Oui, par nature** : c'est la clé publique. Elle ne donne accès qu'à ce que les règles RLS autorisent. |
| `SUPABASE_SECRET_KEY` | Variables Render | Non, jamais |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Variables Render | Non, jamais |

La vraie protection est dans `schema.sql` : un apprenant ne peut lire que les leçons auxquelles il a droit, ne voit jamais les bonnes réponses des quiz (corrigés côté serveur), ne peut pas s'attribuer une formation payante ni changer son rôle. Ces règles ont été testées.

---

## Étape 1 — Supabase (base de données et comptes)

1. Sur [supabase.com](https://supabase.com), créez un projet. Région : **West EU (Paris)** ou **Central EU (Frankfurt)**. Notez le mot de passe de la base.
2. **SQL Editor** > New query > collez tout `supabase/schema.sql` > **Run**. Résultat attendu : `Success. No rows returned`.
3. **Authentication > URL Configuration** :
   - Site URL : `https://datanovicearea.com`
   - Redirect URLs : ajoutez `https://datanovicearea.com/**` et `http://localhost:8080/**`
4. **Authentication > Sign In / Providers > Email** : laissez « Confirm email » activé.
5. **Authentication > Emails > SMTP Settings** : branchez un vrai serveur d'envoi (votre boîte Hostinger `contact@datanovicearea.com`, ou Brevo, gratuit jusqu'à 300 e-mails/jour). ⚠️ Sans ça, Supabase n'envoie que quelques e-mails par heure : les inscriptions bloqueront dès le premier jour de promotion.
6. **Project Settings > API Keys** : notez
   - l'URL du projet (`https://xxxx.supabase.co`),
   - la **Publishable key** (`sb_publishable_…`) → pour GitHub,
   - la **Secret key** (`sb_secret_…`) → pour Render uniquement.
   (Si votre projet affiche encore « anon » et « service_role », elles fonctionnent de la même façon : anon = publique, service_role = secrète.)

## Étape 2 — GitHub (le site)

1. Créez un dépôt (privé ou public) et poussez tout le dossier `dna/` à la racine.
2. **Settings > Secrets and variables > Actions** :
   - onglet **Secrets** → *New repository secret* :
     - `SUPABASE_URL`
     - `SUPABASE_PUBLISHABLE_KEY`
   - onglet **Variables** → *New repository variable* :
     - `SITE_URL` = `https://datanovicearea.com`
     - `API_URL` = `https://api.datanovicearea.com` (ou l'adresse `…onrender.com` en attendant l'étape 5)
     - `CONTACT_EMAIL` = `contact@datanovicearea.com`
     - `MOBILE_MONEY_INFO` = ex. `Airtel Money : +241 07 00 00 00 — Moov Money : +241 06 00 00 00 (au nom de …)`
     - `BANK_TRANSFER_INFO` = ex. `IBAN FR76 … — BIC … — Titulaire …` (laissez vide pour ne pas proposer le virement)
3. **Settings > Pages** > Source : **GitHub Actions**.
4. Onglet **Actions** > « Déployer le site sur GitHub Pages » > **Run workflow**. Le site est en ligne en 1 à 2 minutes. Chaque `git push` sur `main` le redéploie.

## Étape 3 — Domaine chez Hostinger

Dans Hostinger > Domaines > `datanovicearea.com` > **DNS / Serveurs de noms** :

| Type | Nom | Valeur |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `VOTRE-COMPTE.github.io` |
| CNAME | `api` | `dna-api.onrender.com` (adresse donnée par Render à l'étape 5) |

Supprimez les anciens enregistrements A / CNAME de `@` et `www` créés par défaut par Hostinger.

Puis dans GitHub **Settings > Pages** > Custom domain : `datanovicearea.com` > Save. Attendez la vérification DNS (quelques minutes à quelques heures) puis cochez **Enforce HTTPS**.

**Le domaine .fr** : dans Hostinger > `datanovicearea.fr` > Redirection > redirection **301** vers `https://datanovicearea.com`.

## Étape 4 — Votre compte administrateur et les premières formations

1. Sur le site, **Créer un compte** avec votre e-mail, puis cliquez le lien de confirmation reçu.
2. Supabase > SQL Editor, exécutez (avec votre e-mail) :
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'votre@email.com');
   ```
3. Exécutez tout `supabase/seed.sql` : il crée « Excel : les astuces qui font gagner du temps » (gratuite, 3 leçons) et « Excel de A à Z » (75 € / 49 000 FCFA, 6 modules, 30 leçons, 35 questions de quiz), à partir de votre programme.
4. Reconnectez-vous : le menu affiche **Espace formateur**.

## Étape 5 — Render (l'API de paiement et de contact)

1. Sur [render.com](https://render.com) > **New > Blueprint** > connectez le dépôt GitHub. Render lit `render.yaml`.
2. Renseignez les variables demandées :
   - `SUPABASE_URL` = URL du projet
   - `SUPABASE_SECRET_KEY` = clé secrète Supabase
   - `FRONTEND_URL` = `https://datanovicearea.com`
   - `ALLOWED_ORIGINS` = `https://datanovicearea.com,https://www.datanovicearea.com`
   - `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` : laissez vide pour l'instant (étape 6)
3. Après le déploiement, ouvrez `https://dna-api.onrender.com/health` : vous devez voir `{"ok":true,...}`.
4. Render > le service > **Settings > Custom Domains** > ajoutez `api.datanovicearea.com` (le CNAME de l'étape 3), puis mettez à jour la variable GitHub `API_URL` et relancez le workflow.

Pour tester l'API avec ReqBin : `POST https://api.datanovicearea.com/api/contact`, en-tête `Origin: https://datanovicearea.com`, corps JSON `{"name":"Test","email":"test@test.fr","message":"Bonjour"}` → le message apparaît dans Espace formateur > Messages.

## Étape 6 — Stripe (paiement par carte)

1. Créez le compte sur [stripe.com](https://stripe.com) (pièce d'identité, IBAN, SIRET).
2. En **mode test** : Développeurs > Clés API > copiez la clé secrète `sk_test_…` dans Render (`STRIPE_SECRET_KEY`).
3. Développeurs > **Webhooks** > Ajouter un endpoint :
   - URL : `https://api.datanovicearea.com/api/stripe/webhook`
   - Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Copiez la clé de signature `whsec_…` dans Render (`STRIPE_WEBHOOK_SECRET`).
4. Testez un achat avec la carte `4242 4242 4242 4242`, date future, CVC quelconque. L'accès doit s'ouvrir tout seul après le retour sur le site.
5. Quand tout marche : refaites 2 et 3 en **mode live** (`sk_live_…` et un nouveau webhook live).

Stripe envoie automatiquement un reçu si vous l'activez dans Paramètres > E-mails clients.

---

## Utilisation au quotidien

**Créer une formation** : Espace formateur > Nouvelle formation > remplissez titre, description, prix (0 € et 0 FCFA = gratuite) > Créer. Ajoutez ensuite des modules, puis des leçons, puis **Modifier** sur chaque leçon pour le texte, les fichiers et le quiz.

**Rendre une leçon gratuite** : dans la leçon, cochez « Leçon gratuite ». Elle devient visible sans achat (idéal pour la première vidéo de présentation).

**Vidéos** : l'envoi direct est limité à 50 Mo par fichier, et le plan gratuit de Supabase ne permet que 5 Go de bande passante par mois : une quarantaine d'apprenants regardant une heure de vidéo suffit à l'épuiser. Recommandation :
- vidéos gratuites / promotionnelles → **YouTube en « non répertoriée »**, collez le lien ;
- vidéos payantes → **Bunny Stream** (environ 1 € par mois pour démarrer, lecture protégée) ou Vimeo ; collez le lien d'intégration `https://iframe.mediadelivery.net/embed/…`.
- Supabase reste parfait pour les fichiers d'exercice Excel, les PDF, les images et les audios courts.

Attention : un lien YouTube non répertorié peut être partagé par n'importe quel acheteur. Ne l'utilisez pas pour le cœur d'une formation payante.

**Quiz** : 2 à 4 questions, 2 à 4 réponses chacune. La correction se fait dans la base, les apprenants ne voient jamais les bonnes réponses avant d'avoir répondu. Réussite à 75 % ; la leçon est alors marquée terminée. Une leçon sans quiz se termine avec le bouton « Marquer comme terminée ».

**Paiements Mobile Money / virement** : l'apprenant paie, puis saisit la référence. Vous vérifiez sur votre compte Airtel/Moov/bancaire, puis Espace formateur > **Paiements à valider** > Valider. L'accès s'ouvre immédiatement.

**Entreprises (paiement sur facture)** : Espace formateur > **Accès entreprise** > e-mail du salarié + formation. Le salarié doit avoir créé son compte avant.

**Ajouter un formateur** : il crée son compte, puis Espace formateur > **Utilisateurs** > rôle « Formateur ». Il ne voit et ne modifie que ses propres formations ; il les soumet à validation et c'est vous qui publiez.

---

## Limites à connaître (plans gratuits)

- **Supabase gratuit met le projet en pause après 7 jours sans activité.** Dès que vous avez des apprenants payants, passez au plan Pro (25 $/mois) : il supprime la pause et ajoute les sauvegardes quotidiennes.
- **Render gratuit s'endort après 15 minutes** : le premier clic sur « Payer par carte » peut attendre jusqu'à une minute (le site affiche « Préparation du paiement… »). Le reste du site n'est pas concerné. Plan Starter à 7 $/mois pour supprimer ce délai.
- Le contenu gratuit reste consultable même si Render dort ; seuls le paiement carte et le formulaire de contact en dépendent.

## Tester en local

```bash
# Site
cp frontend/assets/js/config.example.js frontend/assets/js/config.js   # puis remplissez-le
cd frontend && python3 -m http.server 8080                            # http://localhost:8080

# API (autre terminal)
cd backend && cp .env.example .env    # puis remplissez-le
npm install && npm run dev            # http://localhost:3000/health
```

`config.js` et `.env` sont ignorés par git : ils ne partent jamais sur GitHub.

## Avant d'ouvrir au public

- Complétez `mentions-legales.html` (SIRET, adresse, médiateur de la consommation, mention TVA).
- Remplacez `assets/img/logo-dna.png` par une version haute définition du logo (l'actuelle fait 248 × 378 px) et générez des icônes plus nettes.
- Faites un parcours complet en mode test : inscription, formation gratuite, quiz, achat carte, déclaration Mobile Money, validation.

## Vers l'organisme de formation

La base prévoit déjà plusieurs formateurs, la validation des contenus par un admin et l'accès entreprise. Pour la suite :
- **Déclaration d'activité (NDA)** auprès de la DREETS dès la première convention de formation signée avec une entreprise ;
- **Qualiopi** pour être finançable par les OPCO et le CPF (audit à préparer : l'historique des quiz et de la progression sert de preuve de suivi) ;
- **Attestations de fin de formation** : à ajouter (génération PDF quand toutes les leçons sont validées) ;
- **Rémunération des formateurs** : Stripe Connect le jour où d'autres formateurs vendent sur la plateforme.
