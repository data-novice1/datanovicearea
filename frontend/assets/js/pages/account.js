import {
  sb, boot, $, h, toast, errorMessage, busy, requireAuth, formatAmount, formatDate, getProfile,
} from '../lib.js';

const PROVIDERS = { stripe: 'Carte bancaire', airtel_money: 'Airtel Money', moov_money: 'Moov Money', virement: 'Virement' };
const STATUS = {
  pending: ['En vérification', 'tag--warn'], paid: ['Payé', 'tag--ok'],
  rejected: ['Refusé', 'tag--err'], cancelled: ['Abandonné', ''],
};

boot(async () => {
  await requireAuth();
  const profile = await getProfile(true);
  $('#hello').textContent = profile.full_name ? `Bonjour ${profile.full_name.split(' ')[0]}` : 'Mon espace';

  // ----- Mes formations + progression -----
  const { data: enrollments } = await sb
    .from('enrollments')
    .select('course_id, created_at, course:courses(id, slug, title, category)')
    .eq('user_id', profile.id).eq('status', 'active')
    .order('created_at', { ascending: false });

  const box = $('#my-courses');
  if (!enrollments?.length) {
    box.replaceChildren(h('div', { class: 'empty' },
      h('p', {}, 'Vous ne suivez encore aucune formation.'),
      h('a', { class: 'btn', href: 'catalogue.html' }, 'Découvrir les formations')));
  } else {
    const ids = enrollments.map((e) => e.course_id);
    const [{ data: lessons }, { data: prog }] = await Promise.all([
      sb.from('lessons').select('id, course_id').in('course_id', ids),
      sb.from('lesson_progress').select('course_id, completed_at').eq('user_id', profile.id).in('course_id', ids),
    ]);
    box.replaceChildren(...enrollments.map((e) => {
      const total = (lessons || []).filter((l) => l.course_id === e.course_id).length;
      const done = (prog || []).filter((p) => p.course_id === e.course_id && p.completed_at).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const bar = h('span');
      bar.style.width = `${pct}%`;
      return h('div', { class: 'my-course' },
        h('div', {}, h('h3', {}, e.course.title), h('span', { class: 'small muted' }, `${done} / ${total} leçons · ${pct} %`)),
        h('a', { class: 'btn btn--small', href: `cours.html?c=${encodeURIComponent(e.course.slug)}` }, pct ? 'Continuer' : 'Commencer'),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar));
    }));
  }

  // ----- Mes paiements -----
  const { data: payments } = await sb
    .from('payments').select('created_at, provider, amount, currency, status, course:courses(title)')
    .eq('user_id', profile.id).order('created_at', { ascending: false });
  const pbox = $('#my-payments');
  if (!payments?.length) pbox.replaceChildren(h('p', { class: 'muted' }, 'Aucun paiement pour le moment.'));
  else {
    pbox.replaceChildren(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Date', 'Formation', 'Moyen', 'Montant', 'Statut'].map((t) => h('th', {}, t)))),
      h('tbody', {}, payments.map((p) => h('tr', {},
        h('td', {}, formatDate(p.created_at)), h('td', {}, p.course?.title || ''),
        h('td', {}, PROVIDERS[p.provider]), h('td', {}, formatAmount(p.amount, p.currency)),
        h('td', {}, h('span', { class: `tag ${STATUS[p.status][1]}` }, STATUS[p.status][0])))))));
  }

  // ----- Profil -----
  $('#p-name').value = profile.full_name || '';
  $('#p-headline').value = profile.headline || '';
  $('#p-country').value = profile.country || '';
  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const { error } = await sb.from('profiles').update({
        full_name: $('#p-name').value.trim(),
        headline: $('#p-headline').value.trim() || null,
        country: $('#p-country').value.trim() || null,
      }).eq('id', profile.id);
      if (error) return toast(errorMessage(error), 'err');
      toast('Profil enregistré.', 'ok');
    });
  });

  $('#password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = $('#p-pass').value;
    if (password.length < 10) return toast('10 caractères minimum.', 'err');
    busy(e.submitter, async () => {
      const { error } = await sb.auth.updateUser({ password });
      if (error) return toast(errorMessage(error), 'err');
      $('#p-pass').value = '';
      toast('Mot de passe modifié.', 'ok');
    });
  });

  $('#logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.replace('index.html');
  });
});
