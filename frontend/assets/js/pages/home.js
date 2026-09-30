import { sb, boot, $, h, courseCard, api, busy, toast, config } from '../lib.js';

boot(async () => {
  // Formations mises en avant
  const grid = $('#featured');
  const { data, error } = await sb
    .from('courses')
    .select('slug, title, subtitle, category, level, cover_url, price_eur_cents, price_xaf, is_free')
    .eq('status', 'published')
    .order('is_free', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(6);
  grid.replaceChildren();
  if (error || !data?.length) {
    grid.append(h('div', { class: 'empty' }, 'Les premières formations arrivent très bientôt.'));
  } else {
    data.forEach((c) => grid.append(courseCard(c)));
  }

  // Formulaire de contact (envoyé à l'API, avec limite anti-abus côté serveur)
  const form = $('#contact-form');
  if (config.CONTACT_EMAIL) {
    const alt = $('#contact-alt');
    alt.append('Ou écrivez directement à ', h('a', { href: `mailto:${config.CONTACT_EMAIL}` }, config.CONTACT_EMAIL), '.');
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fd.email || '') || (fd.message || '').trim().length < 5) {
      toast('Merci de renseigner votre nom, un e-mail valide et un message.', 'err');
      return;
    }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await api('/api/contact', fd);
        form.reset();
        form.replaceChildren(h('h3', {}, 'Message envoyé'), h('p', {}, 'Merci ! Nous revenons vers vous rapidement.'));
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
});
