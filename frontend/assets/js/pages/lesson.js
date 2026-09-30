import {
  sb, boot, $, h, icon, qs, toast, errorMessage, busy, loginUrl, renderMarkdown, embedUrl,
} from '../lib.js';

const KIND_LABEL = { video: 'Vidéo', audio: 'Audio', image: 'Image', document: 'Document', link: 'Lien' };

boot(async (profile) => {
  const root = $('#lesson-root');
  const lessonId = qs('l');
  if (!lessonId) return location.replace('catalogue.html');

  const { data: lesson } = await sb
    .from('lessons')
    .select('id, title, summary, course_id, module_id, position, is_free_preview, duration_min')
    .eq('id', lessonId)
    .maybeSingle();
  if (!lesson) {
    root.replaceChildren(h('div', {}), h('div', { class: 'lesson-main section' },
      h('h1', {}, 'Leçon introuvable'), h('a', { class: 'btn', href: 'catalogue.html' }, 'Voir les formations')));
    return;
  }

  const [{ data: course }, { data: modules }, { data: canAccess }, progressRes] = await Promise.all([
    sb.from('courses').select('id, slug, title').eq('id', lesson.course_id).single(),
    sb.from('modules').select('id, title, position, lessons(id, title, position, is_free_preview)')
      .eq('course_id', lesson.course_id).order('position').order('position', { referencedTable: 'lessons' }),
    sb.rpc('can_access_lesson', { p_lesson: lesson.id }),
    profile
      ? sb.from('lesson_progress').select('lesson_id, completed_at, best_score, quiz_total')
          .eq('course_id', lesson.course_id).eq('user_id', profile.id)
      : Promise.resolve({ data: [] }),
  ]);
  document.title = `${lesson.title} — ${course.title}`;

  const progress = new Map((progressRes.data || []).map((p) => [p.lesson_id, p]));
  const flat = (modules || []).flatMap((m) => m.lessons);
  const idx = flat.findIndex((l) => l.id === lesson.id);
  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  const courseUrl = `cours.html?c=${encodeURIComponent(course.slug)}`;

  // ----- Sommaire -----
  function buildOutline() {
    const doneCount = flat.filter((l) => progress.get(l.id)?.completed_at).length;
    return h('aside', { class: 'outline' },
      h('details', { open: window.matchMedia('(min-width: 901px)').matches },
        h('summary', {}, course.title),
        h('p', { class: 'small muted' }, `${doneCount} / ${flat.length} leçons terminées`),
        (modules || []).map((m) => [
          h('h4', {}, m.title),
          h('ol', {}, m.lessons.map((l) => {
            const isDone = progress.get(l.id)?.completed_at;
            return h('li', {}, h('a', { href: `lecon.html?l=${l.id}`, 'aria-current': l.id === lesson.id ? 'page' : null },
              icon(isDone ? 'done' : 'circle', `lesson-state${isDone ? ' lesson-state--done' : ''}`),
              h('span', {}, l.title)));
          })),
        ])));
  }

  const main = h('div', { class: 'lesson-main' });
  root.replaceChildren(buildOutline(), main);
  main.append(
    h('p', { class: 'crumbs' }, h('a', { href: courseUrl }, course.title)),
    h('h1', {}, lesson.title));

  // ----- Accès refusé -----
  if (!canAccess) {
    main.append(h('div', { class: 'locked' },
      icon('lock'),
      h('h2', {}, 'Cette leçon fait partie de la formation complète'),
      h('p', {}, profile ? 'Accédez à toutes les leçons, fichiers et quiz en rejoignant la formation.' : 'Connectez-vous ou créez un compte pour continuer.'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: courseUrl }, 'Voir la formation'),
        profile ? null : h('a', { class: 'btn btn--ghost', href: loginUrl() }, 'Se connecter'))));
    return;
  }

  // ----- Contenu -----
  const [{ data: content }, { data: resources }, { data: questions }] = await Promise.all([
    sb.from('lesson_contents').select('body').eq('lesson_id', lesson.id).maybeSingle(),
    sb.from('lesson_resources').select('*').eq('lesson_id', lesson.id).order('position'),
    sb.from('quiz_questions').select('id, prompt, choices, position').eq('lesson_id', lesson.id).order('position').order('created_at'),
  ]);

  if (resources?.length) {
    const box = h('div', { class: 'resources' });
    main.append(box);
    for (const r of resources) box.append(await renderResource(r));
  }
  if (content?.body) main.append(await renderMarkdown(content.body));

  // ----- Quiz -----
  const actions = h('div', { class: 'btn-row' });
  if (questions?.length) {
    main.append(buildQuiz(questions));
  } else if (profile) {
    const done = progress.get(lesson.id)?.completed_at;
    const b = h('button', { class: done ? 'btn btn--ghost' : 'btn', type: 'button', disabled: Boolean(done) },
      done ? 'Leçon terminée' : 'Marquer comme terminée');
    b.addEventListener('click', () => busy(b, async () => {
      const { error } = await sb.rpc('mark_lesson_complete', { p_lesson: lesson.id });
      if (error) return toast(errorMessage(error), 'err');
      completeLocally();
      b.textContent = 'Leçon terminée';
      b.className = 'btn btn--ghost';
      b.disabled = true;
    }));
    actions.append(b);
  }
  main.append(actions);

  // ----- Navigation -----
  main.append(h('nav', { class: 'lesson-nav', 'aria-label': 'Leçons' },
    prev ? h('a', { class: 'btn btn--ghost', href: `lecon.html?l=${prev.id}` }, '← Leçon précédente') : h('span'),
    next ? h('a', { class: 'btn', href: `lecon.html?l=${next.id}` }, 'Leçon suivante') : h('a', { class: 'btn', href: courseUrl }, 'Retour à la formation')));

  function completeLocally() {
    const p = progress.get(lesson.id) || {};
    progress.set(lesson.id, { ...p, completed_at: new Date().toISOString() });
    root.firstChild.replaceWith(buildOutline());
  }

  // ----- Rendu d'une ressource -----
  async function renderResource(r) {
    const head = h('div', { class: 'resource-head' }, h('span', { class: 'tag' }, KIND_LABEL[r.kind] || r.kind), h('span', {}, r.title));
    const body = h('div', { class: 'resource-body' });
    const wrapper = h('section', { class: 'resource' }, head);
    let url = r.external_url;
    if (r.storage_path) {
      const { data, error } = await sb.storage.from('course-media').createSignedUrl(r.storage_path, 60 * 60 * 3);
      if (error) return h('section', { class: 'resource' }, head, h('div', { class: 'resource-body' }, 'Fichier indisponible.'));
      url = data.signedUrl;
    }
    if (r.kind === 'video') {
      const embed = r.external_url ? embedUrl(r.external_url) : null;
      if (embed) {
        wrapper.append(h('iframe', { src: embed, title: r.title, loading: 'lazy', allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
        return wrapper;
      }
      if (r.storage_path) {
        wrapper.append(h('video', { src: url, controls: true, preload: 'metadata', controlslist: 'nodownload', playsinline: true }));
        return wrapper;
      }
    }
    if (r.kind === 'audio' && r.storage_path) body.append(h('audio', { src: url, controls: true, preload: 'metadata' }));
    else if (r.kind === 'image') body.append(h('img', { src: url, alt: r.title, loading: 'lazy' }));
    else {
      body.append(h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn--small', href: url, target: '_blank', rel: 'noopener noreferrer' }, r.kind === 'link' ? 'Ouvrir le lien' : 'Ouvrir'),
        r.storage_path && r.kind === 'document'
          ? h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => download(r) }, 'Télécharger')
          : null));
    }
    wrapper.append(body);
    return wrapper;
  }

  async function download(r) {
    const name = r.storage_path.split('/').pop().replace(/^[0-9a-f-]{36}-/, '');
    const { data, error } = await sb.storage.from('course-media').createSignedUrl(r.storage_path, 300, { download: name });
    if (error) return toast(errorMessage(error), 'err');
    location.assign(data.signedUrl);
  }

  // ----- Quiz corrigé côté serveur -----
  function buildQuiz(list) {
    const best = progress.get(lesson.id);
    const form = h('form', { class: 'quiz', novalidate: true },
      h('h2', {}, 'Vérifiez vos acquis'),
      h('p', { class: 'muted' }, `${list.length} question${list.length > 1 ? 's' : ''}. Réussite à partir de 75 % de bonnes réponses : la leçon est alors validée.`),
      best?.quiz_total ? h('p', { class: 'small' }, `Votre meilleur score : ${best.best_score} / ${best.quiz_total}`) : null,
      list.map((q, i) => h('fieldset', { dataset: { q: q.id } },
        h('legend', {}, `${i + 1}. ${q.prompt}`),
        q.choices.map((c, j) => h('label', { class: 'choice' },
          h('input', { type: 'radio', name: `q${i}`, value: j }), h('span', {}, c))))),
      h('div', { class: 'quiz-feedback' }),
      h('button', { class: 'btn', type: 'submit' }, profile ? 'Valider mes réponses' : 'Se connecter pour valider'));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!profile) return location.assign(loginUrl());
      const answers = list.map((_, i) => {
        const v = form.querySelector(`input[name=q${i}]:checked`)?.value;
        return v === undefined ? null : Number(v);
      });
      if (answers.some((a) => a === null)) return toast('Répondez à toutes les questions.', 'err');

      busy(form.querySelector('button[type=submit]'), async () => {
        const { data: res, error } = await sb.rpc('submit_quiz', { p_lesson: lesson.id, p_answers: answers });
        if (error) return toast(errorMessage(error), 'err');
        res.details.forEach((d, i) => {
          const fs = form.querySelectorAll('fieldset')[i];
          fs.querySelector('.explain')?.remove();
          fs.querySelectorAll('.choice').forEach((lab, j) => {
            lab.classList.toggle('is-right', j === d.correct_index);
            lab.classList.toggle('is-wrong', j === answers[i] && !d.correct);
          });
          if (d.explanation) fs.append(h('p', { class: 'explain' }, d.explanation));
        });
        const fb = form.querySelector('.quiz-feedback');
        fb.replaceChildren(
          h('p', { class: 'quiz-result' }, `${res.score} / ${res.total} bonne${res.score > 1 ? 's' : ''} réponse${res.score > 1 ? 's' : ''}`),
          res.passed
            ? h('div', { class: 'notice notice--ok' }, h('p', {}, 'Bravo, leçon validée ! Passez à la suite.'))
            : h('div', { class: 'notice notice--warn' }, h('p', {}, 'Pas encore : relisez les explications, revoyez la leçon puis retentez le quiz.')));
        form.querySelector('button[type=submit]').textContent = 'Retenter le quiz';
        if (res.passed) completeLocally();
        fb.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    return form;
  }
});
