import {
  sb, boot, $, h, icon, qs, toast, notice, errorMessage, busy, api, config, loginUrl,
  cover, priceLabel, formatEur, formatXaf, LEVELS, CATEGORIES, initials, renderMarkdown, getSession,
} from '../lib.js';

boot(async (profile) => {
  const root = $('#course-root');
  const slug = qs('c');
  if (!slug) return location.replace('catalogue.html');

  const { data: course, error } = await sb
    .from('courses')
    .select('*, instructor:profiles!courses_instructor_id_fkey(full_name, headline, avatar_url)')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!course) {
    root.replaceChildren(h('div', { class: 'wrap section' },
      h('h1', {}, 'Formation introuvable'),
      h('p', {}, 'Elle a peut-être été renommée ou retirée.'),
      h('a', { class: 'btn', href: 'catalogue.html' }, 'Voir les formations')));
    return;
  }
  document.title = `${course.title} — Data Novice Area`;

  const { data: modules } = await sb
    .from('modules')
    .select('id, title, position, lessons(id, title, position, is_free_preview, duration_min)')
    .eq('course_id', course.id)
    .order('position')
    .order('position', { referencedTable: 'lessons' });
  const lessons = (modules || []).flatMap((m) => m.lessons);

  let enrolled = false;
  let done = new Set();
  let pending = null;
  if (profile) {
    const [{ data: enr }, { data: prog }, { data: pays }] = await Promise.all([
      sb.from('enrollments').select('status').eq('course_id', course.id).eq('user_id', profile.id).maybeSingle(),
      sb.from('lesson_progress').select('lesson_id, completed_at').eq('course_id', course.id).eq('user_id', profile.id),
      sb.from('payments').select('id, provider, status, created_at').eq('course_id', course.id).eq('user_id', profile.id)
        .eq('status', 'pending').neq('provider', 'stripe').limit(1),
    ]);
    enrolled = enr?.status === 'active';
    done = new Set((prog || []).filter((p) => p.completed_at).map((p) => p.lesson_id));
    pending = pays?.[0] || null;
  }
  const canEdit = profile && (profile.role === 'admin' || course.instructor_id === profile.id);
  const hasAccess = enrolled || canEdit;
  const nextLesson = lessons.find((l) => !done.has(l.id)) || lessons[0];
  const totalMin = lessons.reduce((s, l) => s + (l.duration_min || 0), 0);

  // ----- Bandeau -----
  const buyBox = h('aside', { class: 'buy-box' });
  const hero = h('section', { class: 'course-hero' },
    h('div', { class: 'wrap' },
      h('div', {},
        h('p', { class: 'crumbs' }, h('a', { href: 'catalogue.html' }, 'Formations'), ` / ${CATEGORIES[course.category] || ''}`),
        h('h1', {}, course.title),
        course.subtitle ? h('p', { class: 'lead' }, course.subtitle) : null,
        h('div', { class: 'course-meta' },
          h('span', { class: 'tag' }, LEVELS[course.level]),
          h('span', {}, `${modules?.length || 0} modules · ${lessons.length} leçons${totalMin ? ` · environ ${totalMin < 60 ? `${totalMin} min` : `${(totalMin / 60).toFixed(1).replace('.', ',')} h`}` : ''}`)),
        course.instructor ? h('div', { class: 'instructor' },
          h('div', { class: 'avatar' }, course.instructor.avatar_url
            ? h('img', { src: course.instructor.avatar_url, alt: '' })
            : initials(course.instructor.full_name)),
          h('div', {},
            h('strong', {}, course.instructor.full_name || 'Formateur D.N.A'),
            course.instructor.headline ? h('div', { class: 'small muted' }, course.instructor.headline) : null)) : null),
      buyBox));

  // ----- Encadré d'accès -----
  function fillBuyBox() {
    buyBox.replaceChildren(cover(course));
    buyBox.append(h('span', { class: 'price' }, priceLabel(course)));
    if (!course.is_free && course.price_eur_cents > 0 && course.price_xaf > 0) {
      buyBox.append(h('div', { class: 'alt-price' }, `ou ${formatXaf(course.price_xaf)} par Mobile Money`));
    }
    const payment = qs('paiement');
    if (payment === 'succes' && !hasAccess) {
      buyBox.append(notice('Paiement reçu. Votre accès s\'ouvre dans quelques secondes…', 'ok'));
      pollAccess();
    } else if (payment === 'annule') {
      buyBox.append(notice('Paiement annulé : vous n\'avez pas été débité.', 'warn'));
    }

    if (hasAccess) {
      buyBox.append(
        h('a', { class: 'btn', href: `lecon.html?l=${nextLesson?.id || ''}` }, done.size ? 'Reprendre la formation' : 'Commencer la formation'),
        h('p', { class: 'small muted' }, `${done.size} / ${lessons.length} leçons terminées`));
    } else if (pending) {
      buyBox.append(notice('Votre paiement est en cours de vérification. Vous recevrez l\'accès dès sa validation.', 'warn'));
    } else if (course.is_free) {
      const b = h('button', { class: 'btn', type: 'button' }, profile ? 'Suivre gratuitement' : 'Créer un compte pour commencer');
      b.addEventListener('click', () => {
        if (!profile) return location.assign(loginUrl());
        busy(b, async () => {
          const { error: e } = await sb.rpc('enroll_free', { p_course: course.id });
          if (e) return toast(errorMessage(e), 'err');
          location.assign(`lecon.html?l=${lessons[0]?.id || ''}`);
        });
      });
      buyBox.append(b);
    } else {
      const b = h('button', { class: 'btn', type: 'button' }, 'Acheter la formation');
      b.addEventListener('click', () => (profile ? openPay() : location.assign(loginUrl())));
      buyBox.append(b);
      const preview = lessons.find((l) => l.is_free_preview);
      if (preview) buyBox.append(h('a', { class: 'btn btn--ghost', href: `lecon.html?l=${preview.id}` }, 'Voir une leçon gratuite'));
    }
    if (canEdit) buyBox.append(h('a', { class: 'btn btn--ghost', href: `studio.html?course=${course.id}` }, 'Modifier dans l\'espace formateur'));
  }

  async function pollAccess() {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data } = await sb.from('enrollments').select('status').eq('course_id', course.id).eq('user_id', profile.id).maybeSingle();
      if (data?.status === 'active') {
        toast('Accès ouvert. Bonne formation !', 'ok');
        location.replace(`cours.html?c=${encodeURIComponent(slug)}`);
        return;
      }
    }
    toast('La confirmation prend plus de temps que prévu. Rechargez la page dans une minute.', 'err');
  }

  // ----- Programme -----
  const syllabus = h('ol', { class: 'syllabus' },
    (modules || []).map((m) => h('li', {},
      h('h3', {}, m.title),
      h('ol', {}, m.lessons.map((l) => {
        const open = hasAccess || l.is_free_preview;
        const state = done.has(l.id) ? icon('done', 'lesson-state lesson-state--done') : icon(open ? 'play' : 'lock', 'lesson-state');
        return h('li', {},
          state,
          open ? h('a', { href: `lecon.html?l=${l.id}` }, l.title) : h('span', {}, l.title),
          !hasAccess && l.is_free_preview ? h('span', { class: 'tag tag--ok' }, 'Gratuit') : null,
          l.duration_min ? h('span', { class: 'dur' }, `${l.duration_min} min`) : null);
      })))));

  const description = await renderMarkdown(course.description || '');
  const body = h('section', { class: 'section' },
    h('div', { class: 'wrap course-layout' },
      h('div', {},
        h('h2', {}, 'À propos de la formation'),
        description,
        h('h2', {}, 'Programme'),
        lessons.length ? syllabus : h('p', { class: 'muted' }, 'Le programme sera bientôt en ligne.')),
      h('div', {})));

  fillBuyBox();
  root.replaceChildren(hero, body);

  // ----- Paiement -----
  const dialog = $('#pay-dialog');
  const methods = [];
  if (course.price_eur_cents > 0 && config.API_URL) {
    methods.push({ id: 'stripe', label: 'Carte bancaire', hint: `${formatEur(course.price_eur_cents)} · paiement sécurisé par Stripe, accès immédiat` });
  }
  if (course.price_xaf > 0 && config.MOBILE_MONEY_INFO) {
    methods.push({ id: 'airtel_money', label: 'Airtel Money', hint: `${formatXaf(course.price_xaf)} · validation sous 24 h`, info: config.MOBILE_MONEY_INFO });
    methods.push({ id: 'moov_money', label: 'Moov Money', hint: `${formatXaf(course.price_xaf)} · validation sous 24 h`, info: config.MOBILE_MONEY_INFO });
  }
  if (config.BANK_TRANSFER_INFO && (course.price_eur_cents > 0 || course.price_xaf > 0)) {
    const amount = course.price_eur_cents > 0 ? formatEur(course.price_eur_cents) : formatXaf(course.price_xaf);
    methods.push({ id: 'virement', label: 'Virement bancaire', hint: `${amount} · validation après réception`, info: config.BANK_TRANSFER_INFO });
  }

  function openPay() {
    if (!methods.length) return toast('Aucun moyen de paiement n\'est encore configuré.', 'err');
    $('#pay-summary').textContent = course.title;
    const box = $('#pay-options');
    box.replaceChildren(h('legend', { class: 'sr-only' }, 'Moyen de paiement'),
      ...methods.map((m, i) => h('label', { class: 'pay-option' },
        h('input', { type: 'radio', name: 'method', value: m.id, checked: i === 0 }),
        h('span', {}, h('strong', {}, m.label), h('span', { class: 'small muted' }, m.hint)))));
    box.onchange = syncMethod;
    syncMethod();
    dialog.showModal();
  }

  function selected() {
    const id = dialog.querySelector('input[name=method]:checked')?.value;
    return methods.find((m) => m.id === id);
  }
  function syncMethod() {
    const m = selected();
    const manual = m && m.id !== 'stripe';
    $('#manual-block').hidden = !manual;
    if (manual) {
      $('#manual-instructions').textContent =
        `1. Envoyez le montant indiqué à :\n${m.info}\n2. Notez la référence de la transaction reçue par SMS ou sur votre relevé.\n3. Saisissez-la ci-dessous.`;
    }
    $('#pay-submit').textContent = manual ? 'J\'ai payé, envoyer la référence' : 'Payer par carte';
  }

  $('#pay-submit').addEventListener('click', (e) => {
    const m = selected();
    if (!m) return;
    if (!$('#pay-consent').checked) return toast('Cochez la case d\'accès immédiat pour continuer.', 'err');
    busy(e.currentTarget, async () => {
      if (m.id === 'stripe') {
        try {
          toast('Préparation du paiement sécurisé…');
          const { url } = await api('/api/checkout', { course_id: course.id });
          if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Adresse de paiement inattendue.');
          location.assign(url);
        } catch (err) {
          toast(err.message, 'err');
        }
        return;
      }
      const ref = $('#pay-ref').value.trim();
      if (ref.length < 3) return toast('Indiquez la référence de la transaction.', 'err');
      const { error: err } = await sb.rpc('declare_manual_payment', {
        p_course: course.id, p_provider: m.id, p_reference: ref, p_phone: $('#pay-phone').value.trim(),
      });
      if (err) return toast(errorMessage(err), 'err');
      dialog.close();
      pending = { provider: m.id };
      fillBuyBox();
      toast('Référence envoyée. Vous recevrez l\'accès dès la vérification.', 'ok');
    });
  });

  // Session expirée entre-temps : on recharge proprement
  if (profile && !(await getSession())) location.reload();
});
