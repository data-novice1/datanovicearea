// Génère frontend/assets/js/config.js à partir des secrets/variables GitHub
// et renseigne l'adresse de l'API dans la politique de sécurité (CSP) des pages.
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const e = process.env;
const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'].filter((k) => !e[k]);
if (missing.length) {
  console.error(`Secrets GitHub manquants : ${missing.join(', ')}`);
  process.exit(1);
}

const config = {
  SUPABASE_URL: e.SUPABASE_URL.trim(),
  SUPABASE_PUBLISHABLE_KEY: e.SUPABASE_PUBLISHABLE_KEY.trim(),
  API_URL: (e.API_URL || '').trim().replace(/\/$/, ''),
  SITE_URL: (e.SITE_URL || '').trim().replace(/\/$/, ''),
  CONTACT_EMAIL: (e.CONTACT_EMAIL || '').trim(),
  MOBILE_MONEY_INFO: (e.MOBILE_MONEY_INFO || '').trim(),
  BANK_TRANSFER_INFO: (e.BANK_TRANSFER_INFO || '').trim(),
};

writeFileSync(
  'frontend/assets/js/config.js',
  `// Fichier généré au déploiement — ne pas modifier à la main.\nwindow.DNA_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`
);

const apiOrigin = config.API_URL ? new URL(config.API_URL).origin : '';
for (const file of readdirSync('frontend').filter((f) => f.endsWith('.html'))) {
  const path = join('frontend', file);
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__API_ORIGIN__', apiOrigin));
}
console.log('Configuration générée.', { api: apiOrigin || '(aucune)', site: config.SITE_URL || '(non défini)' });
