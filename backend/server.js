// =====================================================================
//  API Data Novice Area — hébergée sur Render
//  Rôle : tout ce qui demande une clé secrète.
//   - créer une session de paiement Stripe
//   - recevoir la confirmation de paiement (webhook) et ouvrir l'accès
//   - recevoir les demandes de contact (entreprises, formateurs…)
//  Aucune clé n'est écrite ici : tout vient des variables d'environnement.
// =====================================================================
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const env = process.env;
for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'FRONTEND_URL', 'ALLOWED_ORIGINS']) {
  if (!env[name]) {
    console.error(`Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
}

const FRONTEND_URL = env.FRONTEND_URL.replace(/\/$/, '');
const ALLOWED_ORIGINS = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render est derrière un proxy : nécessaire pour la limite par IP
app.use(helmet());

// ---------------------------------------------------------------------
// Webhook Stripe : doit recevoir le corps BRUT, donc déclaré avant express.json()
// ---------------------------------------------------------------------
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return res.status(503).end();

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('Webhook refusé (signature invalide) :', err.message);
    return res.status(400).send('Signature invalide');
  }

  try {
    const s = event.data.object;
    if (
      (event.type === 'checkout.session.completed' && s.payment_status === 'paid') ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const userId = s.metadata?.user_id;
      const courseId = s.metadata?.course_id;
      if (!UUID_RE.test(userId || '') || !UUID_RE.test(courseId || '')) throw new Error('Métadonnées manquantes');

      await db.from('payments').update({ status: 'paid' }).eq('provider_session_id', s.id);
      const { error } = await db
        .from('enrollments')
        .upsert({ user_id: userId, course_id: courseId, source: 'stripe', status: 'active' }, { onConflict: 'user_id,course_id' });
      if (error) throw error;
      console.log(`Accès ouvert : utilisateur ${userId} / formation ${courseId}`);
    }
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      await db.from('payments').update({ status: 'cancelled' }).eq('provider_session_id', s.id).eq('status', 'pending');
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Erreur de traitement du webhook :', err.message);
    res.status(500).end(); // Stripe réessaiera automatiquement
  }
});

// ---------------------------------------------------------------------
// Le reste de l'API : JSON, CORS limité au site, limite de débit
// ---------------------------------------------------------------------
app.use(express.json({ limit: '20kb' }));
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('Origine non autorisée'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, stripe: Boolean(stripe) }));

// Vérifie le jeton de connexion Supabase envoyé par le navigateur
async function requireUser(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Connexion requise.' });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
  req.user = data.user;
  next();
}

// ---------------------------------------------------------------------
// Paiement par carte : création de la session Stripe Checkout
// ---------------------------------------------------------------------
app.post(
  '/api/checkout',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 20 }),
  requireUser,
  async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Le paiement par carte n\'est pas encore activé.' });
    const courseId = String(req.body?.course_id || '');
    if (!UUID_RE.test(courseId)) return res.status(400).json({ error: 'Formation invalide.' });

    const { data: course } = await db
      .from('courses')
      .select('id, slug, title, price_eur_cents, status')
      .eq('id', courseId)
      .maybeSingle();
    if (!course || course.status !== 'published' || course.price_eur_cents <= 0) {
      return res.status(404).json({ error: 'Formation indisponible au paiement par carte.' });
    }

    const { data: already } = await db
      .from('enrollments')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('course_id', course.id)
      .eq('status', 'active')
      .maybeSingle();
    if (already) return res.status(409).json({ error: 'Vous avez déjà accès à cette formation.' });

    try {
      const back = `${FRONTEND_URL}/cours.html?c=${encodeURIComponent(course.slug)}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        locale: 'fr',
        customer_email: req.user.email,
        client_reference_id: req.user.id,
        metadata: { user_id: req.user.id, course_id: course.id },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: course.price_eur_cents,
              product_data: { name: course.title },
            },
          },
        ],
        allow_promotion_codes: true,
        success_url: `${back}&paiement=succes`,
        cancel_url: `${back}&paiement=annule`,
      });

      await db.from('payments').insert({
        user_id: req.user.id,
        course_id: course.id,
        provider: 'stripe',
        amount: course.price_eur_cents,
        currency: 'EUR',
        provider_session_id: session.id,
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('Erreur Stripe :', err.message);
      res.status(502).json({ error: 'Le service de paiement ne répond pas. Réessaie dans un instant.' });
    }
  }
);

// ---------------------------------------------------------------------
// Formulaire de contact (entreprises, particuliers, futurs formateurs)
// ---------------------------------------------------------------------
app.post('/api/contact', rateLimit({ windowMs: 60 * 60 * 1000, limit: 5 }), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // piège à robots : champ caché rempli
  const clean = (v, max) => String(v ?? '').trim().slice(0, max);
  const row = {
    kind: ['entreprise', 'particulier', 'formateur'].includes(b.kind) ? b.kind : 'particulier',
    name: clean(b.name, 120),
    email: clean(b.email, 200),
    company: clean(b.company, 160) || null,
    message: clean(b.message, 4000),
  };
  if (row.name.length < 2 || !EMAIL_RE.test(row.email) || row.message.length < 5) {
    return res.status(400).json({ error: 'Merci de renseigner votre nom, un e-mail valide et un message.' });
  }
  const { error } = await db.from('contact_requests').insert(row);
  if (error) {
    console.error('Contact :', error.message);
    return res.status(500).json({ error: 'Envoi impossible pour le moment.' });
  }
  res.json({ ok: true });
});

// Erreurs (dont CORS) : pas de détail technique renvoyé au navigateur
app.use((err, _req, res, _next) => {
  if (err?.message === 'Origine non autorisée') return res.status(403).json({ error: 'Origine non autorisée.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne.' });
});

const port = Number(env.PORT) || 3000;
app.listen(port, () => console.log(`API D.N.A démarrée sur le port ${port}`));
