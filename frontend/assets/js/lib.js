// =====================================================================
//  Bibliothèque commune : connexion Supabase, session, utilitaires DOM
//  Sécurité : tout texte venant de la base est inséré avec textContent
//  (jamais innerHTML), sauf le contenu Markdown des leçons, nettoyé par
//  DOMPurify avant affichage.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm';

export const config = window.DNA_CONFIG || {};

export const sb =
  config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crée un élément : h('a', {href: '#', class: 'btn'}, 'Texte', autreElement) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Icône SVG (formes simples, pas de texte utilisateur) */
const ICONS = {
  check: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  done: '<circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  circle: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>',
  play: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---------- Messages ----------
export function toast(message, type = '') {
  const zone = $('.toast-zone') || document.body.appendChild(h('div', { class: 'toast-zone', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast${type ? ` toast--${type}` : ''}`, role: 'status' }, message);
  zone.append(t);
  setTimeout(() => t.remove(), 5000);
}

export function notice(message, type = '') {
  return h('div', { class: `notice${type ? ` notice--${type}` : ''}` }, h('p', {}, message));
}

/** Transforme une erreur Supabase en message lisible */
export function errorMessage(err) {
  const m = err?.message || String(err || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez d\'abord votre adresse e-mail (lien reçu par e-mail).';
  if (/User already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Connectez-vous.';
  if (/Password should be/i.test(m)) return 'Mot de passe trop faible : 10 caractères minimum.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Patientez quelques minutes.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Connexion impossible. Vérifiez votre réseau.';
  if (/duplicate key.*slug/i.test(m)) return 'Cette adresse de formation existe déjà : choisissez un autre titre ou slug.';
  if (/row-level security|permission denied/i.test(m)) return 'Action non autorisée avec ce compte.';
  return m || 'Une erreur est survenue.';
}

/** Désactive un bouton pendant une action asynchrone */
export async function busy(button, fn) {
  if (!button) return fn();
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

// ---------- URL ----------
export const qs = (name) => new URLSearchParams(location.search).get(name);

/** Redirection interne uniquement (empêche les redirections vers un autre site) */
export function safeRedirect(target, fallback = 'compte.html') {
  if (typeof target === 'string' && /^[a-z0-9-]+\.html([?#][^\s]*)?$/i.test(target)) return target;
  return fallback;
}

export function loginUrl() {
  return `connexion.html?redirect=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`;
}

// ---------- Session & profil ----------
let profileCache;
export async function getSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function getProfile(force = false) {
  if (profileCache !== undefined && !force) return profileCache;
  const session = await getSession();
  if (!session) return (profileCache = null);
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  profileCache = data ? { ...data, email: session.user.email } : null;
  return profileCache;
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    location.replace(loginUrl());
    throw new Error('redirection');
  }
  return session;
}

/** Met à jour l'en-tête selon la connexion et le rôle */
export async function initHeader() {
  const profile = await getProfile();
  $$('[data-auth="in"]').forEach((el) => (el.hidden = !profile));
  $$('[data-auth="out"]').forEach((el) => (el.hidden = Boolean(profile)));
  $$('[data-role="instructor"]').forEach((el) => (el.hidden = !(profile && ['instructor', 'admin'].includes(profile.role))));
  return profile;
}

/** Point d'entrée de chaque page */
export async function boot(fn) {
  if (!sb) {
    const main = $('main');
    main?.prepend(
      h('div', { class: 'wrap' },
        notice('Configuration manquante : le fichier assets/js/config.js n\'a pas été généré (voir README, étape GitHub).', 'err'))
    );
    return;
  }
  try {
    const profile = await initHeader();
    await fn(profile);
  } catch (err) {
    if (err?.message === 'redirection') return;
    console.error(err);
    toast(errorMessage(err), 'err');
  }
}

// ---------- API Render ----------
export async function api(path, body) {
  if (!config.API_URL) throw new Error('Service indisponible pour le moment.');
  const session = await getSession();
  const res = await fetch(`${config.API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Le service ne répond pas. Réessayez dans une minute.');
  return data;
}

// ---------- Formats ----------
export const CATEGORIES = { excel: 'Excel', powerbi: 'Power BI', python: 'Python', sql: 'SQL', data: 'Culture data', autre: 'Autre' };
export const LEVELS = { debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé' };

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const xaf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const formatEur = (cents) => eur.format(cents / 100);
export const formatXaf = (n) => `${xaf.format(n)} FCFA`;
export function formatAmount(amount, currency) {
  return currency === 'EUR' ? formatEur(amount) : formatXaf(amount);
}
export function priceLabel(c) {
  if (c.is_free) return 'Gratuit';
  if (c.price_eur_cents > 0) return formatEur(c.price_eur_cents);
  return formatXaf(c.price_xaf);
}
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function slugify(text) {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// ---------- Composants ----------
export function cover(course) {
  const box = h('div', { class: 'course-cover' });
  if (course.cover_url) box.append(h('img', { src: course.cover_url, alt: '', loading: 'lazy' }));
  else box.append(h('div', { class: 'cover-gen', dataset: { cat: course.category } }, CATEGORIES[course.category] || 'Data'));
  return box;
}

export function courseCard(course) {
  return h('a', { class: 'course-card', href: `cours.html?c=${encodeURIComponent(course.slug)}` },
    cover(course),
    h('div', { class: 'course-body' },
      h('h3', {}, course.title),
      course.subtitle ? h('p', {}, course.subtitle) : null,
      h('div', { class: 'course-meta' },
        h('span', { class: 'tag' }, LEVELS[course.level] || course.level),
        h('span', { class: `price` }, priceLabel(course)))));
}

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// ---------- Markdown sécurisé ----------
let mdLibs;
export async function renderMarkdown(md) {
  if (!mdLibs) {
    const [{ marked }, purify] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/marked@18.0.14/+esm'),
      import('https://cdn.jsdelivr.net/npm/dompurify@3.4.16/+esm'),
    ]);
    mdLibs = { marked, DOMPurify: purify.default };
  }
  const html = mdLibs.marked.parse(md || '', { gfm: true, breaks: false });
  const clean = mdLibs.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'iframe'] });
  const div = h('div', { class: 'prose' });
  div.innerHTML = clean;
  div.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  return div;
}

// ---------- Vidéos externes autorisées ----------
/** Retourne une URL d'intégration sûre (YouTube, Vimeo, Bunny Stream) ou null */
export function embedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
  if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const id = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
  }
  if (host === 'vimeo.com') return `https://player.vimeo.com/video/${encodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || '')}`;
  if (host === 'player.vimeo.com' || host === 'iframe.mediadelivery.net') return u.href;
  return null;
}
