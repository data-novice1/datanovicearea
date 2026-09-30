// =====================================================================
//  Espace formateur (création des formations) + administration
//  Les droits sont vérifiés par la base (RLS) : cette page ne fait
//  qu'afficher ce que le compte connecté a le droit de voir et modifier.
// =====================================================================
import {
  sb, boot, $, $$, h, qs, toast, errorMessage, busy, requireAuth, getProfile,
  CATEGORIES, LEVELS, slugify, formatAmount, formatDate,
} from '../lib.js';

const STATUS = {
  draft: ['Brouillon', ''], review: ['À valider', 'tag--warn'],
  published: ['En ligne', 'tag--ok'], archived: ['Archivée', 'tag--err'],
};
const KINDS = { video: 'Vidéo', audio: 'Audio', image: 'Image', document: 'Document (PDF, Excel…)', link: 'Lien externe' };
const ACCEPT = { video: 'video/*', audio: 'audio/*', image: 'image/*', document: '.pdf,.xlsx,.xlsm,.xls,.csv,.docx,.pptx,.zip,.pbix,.sql,.py,.ipynb,.txt' };
const MAX_UPLOAD = 50 * 1024 * 1024; // limite du plan gratuit Supabase

let profile;
let isAdmin = false;
let courses = [];
let current = null; // formation ouverte

boot(async () => {
  await requireAuth();
  profile = await getProfile(true);
  if (!['instructor', 'admin'].includes(profile?.role)) {
    $('main').replaceChildren(h('div', { class: 'wrap section' },
      h('h1', {}, 'Espace réservé aux formateurs'),
      h('p', {}, 'Vous souhaitez publier vos cours sur Data Novice Area ? Écrivez-nous depuis la page d\'accueil.'),
      h('a', { class: 'btn', href: 'index.html#entreprises' }, 'Devenir formateur')));
    return;
  }
  isAdmin = profile.role === 'admin';
  $$('[data-admin]').forEach((b) => (b.hidden = !isAdmin));

  $$('#studio-tabs [role=tab]').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  $('#new-course').addEventListener('click', () => openCourse(null));

  await loadCourses();
  const wanted = qs('course');
  if (wanted && courses.some((c) => c.id === wanted)) openCourse(wanted);
});

function switchTab(name) {
  $$('#studio-tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  ['courses', 'payments', 'users', 'access', 'messages'].forEach((n) => ($(`#tab-${n}`).hidden = n !== name));
  if (name === 'payments') renderPayments();
  if (name === 'users') renderUsers();
  if (name === 'access') renderAccess();
  if (name === 'messages') renderMessages();
}

// ---------------------------------------------------------------------
// Liste des formations
// ---------------------------------------------------------------------
async function loadCourses() {
  let q = sb.from('courses').select('*').order('updated_at', { ascending: false });
  if (!isAdmin) q = q.eq('instructor_id', profile.id);
  const { data, error } = await q;
  if (error) throw error;
  courses = data || [];
  const list = $('#course-list');
  list.replaceChildren(...courses.map((c) => h('li', {},
    h('button', { type: 'button', 'aria-current': current?.id === c.id ? 'true' : null, onclick: () => openCourse(c.id) },
      h('strong', {}, c.title),
      h('span', {}, h('span', { class: `tag ${STATUS[c.status][1]}` }, STATUS[c.status][0]))))));
  if (!courses.length) list.append(h('li', { class: 'muted small' }, 'Aucune formation pour le moment.'));
}

// ---------------------------------------------------------------------
// Éditeur d'une formation
// ---------------------------------------------------------------------
async function openCourse(id) {
  current = id ? courses.find((c) => c.id === id) : null;
  $$('#course-list button').forEach((b) => b.removeAttribute('aria-current'));
  const editor = $('#editor');
  editor.replaceChildren(infoPanel());
  if (current) {
    editor.append(statusPanel(), await programPanel());
    await loadCourses();
  }
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function field(label, input, hint) {
  if (!input.id) input.id = `f-${Math.random().toString(36).slice(2, 9)}`;
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('p', { class: 'field-hint' }, hint) : null);
}
function select(options, value) {
  return h('select', {}, Object.entries(options).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function infoPanel() {
  const c = current || { category: 'excel', level: 'debutant', price_eur_cents: 0, price_xaf: 0 };
  const title = h('input', { type: 'text', maxlength: 140, value: c.title || '' });
  const slug = h('input', { type: 'text', maxlength: 80, value: c.slug || '', pattern: '[a-z0-9-]+' });
  const subtitle = h('input', { type: 'text', maxlength: 240, value: c.subtitle || '' });
  const category = select(CATEGORIES, c.category);
  const level = select(LEVELS, c.level);
  const desc = h('textarea', { class: 'code', maxlength: 20000 });
  desc.value = c.description || '';
  const eur = h('input', { type: 'number', min: 0, step: '0.01', value: (c.price_eur_cents / 100).toString() });
  const xaf = h('input', { type: 'number', min: 0, step: '500', value: String(c.price_xaf) });
  if (!current) title.addEventListener('input', () => { slug.value = slugify(title.value); });

  const coverInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const save = h('button', { class: 'btn', type: 'submit' }, current ? 'Enregistrer' : 'Créer la formation');

  const form = h('form', { class: 'panel', novalidate: true },
    h('h2', {}, current ? 'Informations' : 'Nouvelle formation'),
    field('Titre', title),
    field('Adresse de la page', slug, 'Lettres minuscules, chiffres et tirets. Ex. : excel-debutant'),
    field('Sous-titre', subtitle, 'Une phrase qui dit ce que la personne saura faire.'),
    h('div', { class: 'grid-2' }, field('Outil', category), field('Niveau', level)),
    field('Description (Markdown)', desc, 'Titres avec ##, listes avec -, gras avec **texte**.'),
    h('div', { class: 'grid-2' },
      field('Prix en euros', eur, '0 = gratuit. Paiement par carte (Stripe).'),
      field('Prix en FCFA', xaf, 'Pour Mobile Money. 0 = pas de paiement en FCFA.')),
    current ? field('Image de couverture (facultatif)', coverInput, 'PNG, JPG ou WebP, 5 Mo maximum, format 16:9 conseillé.') : null,
    h('div', { class: 'btn-row' }, save,
      current ? h('a', { class: 'btn btn--ghost', href: `cours.html?c=${encodeURIComponent(c.slug)}`, target: '_blank', rel: 'noopener' }, 'Voir la page') : null));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const row = {
      title: title.value.trim(),
      slug: slugify(slug.value || title.value),
      subtitle: subtitle.value.trim() || null,
      category: category.value,
      level: level.value,
      description: desc.value,
      price_eur_cents: Math.round(Math.max(0, Number(eur.value) || 0) * 100),
      price_xaf: Math.round(Math.max(0, Number(xaf.value) || 0)),
    };
    if (row.title.length < 3) return toast('Le titre doit faire au moins 3 caractères.', 'err');
    if (!row.slug) return toast('Adresse de page invalide.', 'err');
    busy(save, async () => {
      if (current) {
        const file = coverInput.files?.[0];
        if (file) {
          if (file.size > 5 * 1024 * 1024) return toast('Image trop lourde (5 Mo maximum).', 'err');
          const path = `covers/${current.id}/${crypto.randomUUID()}.${file.name.split('.').pop().toLowerCase()}`;
          const { error: upErr } = await sb.storage.from('public-assets').upload(path, file, { contentType: file.type });
          if (upErr) return toast(errorMessage(upErr), 'err');
          row.cover_url = sb.storage.from('public-assets').getPublicUrl(path).data.publicUrl;
        }
        const { error } = await sb.from('courses').update(row).eq('id', current.id);
        if (error) return toast(errorMessage(error), 'err');
        toast('Formation enregistrée.', 'ok');
        await loadCourses();
        openCourse(current.id);
      } else {
        const { data, error } = await sb.from('courses').insert({ ...row, instructor_id: profile.id }).select().single();
        if (error) return toast(errorMessage(error), 'err');
        toast('Formation créée. Ajoutez maintenant les modules et les leçons.', 'ok');
        await loadCourses();
        openCourse(data.id);
      }
    });
  });
  return form;
}

function statusPanel() {
  const c = current;
  const panel = h('section', { class: 'panel' },
    h('h2', {}, 'Mise en ligne'),
    h('p', {}, 'Statut : ', h('span', { class: `tag ${STATUS[c.status][1]}` }, STATUS[c.status][0])));
  const row = h('div', { class: 'btn-row' });
  const setStatus = (status, msg) => async (e) => busy(e.currentTarget, async () => {
    const { error } = await sb.from('courses').update({ status }).eq('id', c.id);
    if (error) return toast(errorMessage(error), 'err');
    toast(msg, 'ok');
    await loadCourses();
    openCourse(c.id);
  });

  if (isAdmin) {
    if (c.status !== 'published') row.append(h('button', { class: 'btn', type: 'button', onclick: setStatus('published', 'Formation en ligne.') }, 'Publier'));
    if (c.status === 'published') row.append(h('button', { class: 'btn btn--ghost', type: 'button', onclick: setStatus('draft', 'Formation retirée du catalogue.') }, 'Retirer du catalogue'));
    if (c.status !== 'archived') row.append(h('button', { class: 'btn btn--ghost', type: 'button', onclick: setStatus('archived', 'Formation archivée.') }, 'Archiver'));
  } else {
    panel.append(h('p', { class: 'muted small' }, 'Quand la formation est prête, soumettez-la : un administrateur la relit puis la publie.'));
    if (c.status === 'draft') row.append(h('button', { class: 'btn', type: 'button', onclick: setStatus('review', 'Formation soumise à validation.') }, 'Soumettre à validation'));
    if (c.status === 'review') row.append(h('button', { class: 'btn btn--ghost', type: 'button', onclick: setStatus('draft', 'Formation repassée en brouillon.') }, 'Repasser en brouillon'));
  }
  if (isAdmin || ['draft', 'review'].includes(c.status)) {
    row.append(h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async (e) => {
        if (!confirm(`Supprimer définitivement « ${c.title} » et tout son contenu ?`)) return;
        busy(e.currentTarget, async () => {
          const { error } = await sb.from('courses').delete().eq('id', c.id);
          if (error) return toast(errorMessage(error), 'err');
          toast('Formation supprimée.', 'ok');
          current = null;
          await loadCourses();
          $('#editor').replaceChildren(h('div', { class: 'empty' }, 'Formation supprimée.'));
        });
      },
    }, 'Supprimer'));
  }
  panel.append(row);
  return panel;
}

// ---------------------------------------------------------------------
// Programme : modules et leçons
// ---------------------------------------------------------------------
async function programPanel() {
  const panel = h('section', { class: 'panel' }, h('h2', {}, 'Programme'));
  const { data: modules, error } = await sb
    .from('modules')
    .select('id, title, position, lessons(id, title, position, is_free_preview)')
    .eq('course_id', current.id)
    .order('position').order('position', { referencedTable: 'lessons' });
  if (error) throw error;

  const refresh = async () => panel.replaceWith(await programPanel());

  async function swap(table, a, b) {
    if (!a || !b) return;
    const r1 = await sb.from(table).update({ position: b.position }).eq('id', a.id);
    const r2 = await sb.from(table).update({ position: a.position }).eq('id', b.id);
    if (r1.error || r2.error) return toast(errorMessage(r1.error || r2.error), 'err');
    refresh();
  }

  (modules || []).forEach((m, mi) => {
    const titleInput = h('input', { type: 'text', value: m.title, maxlength: 160, 'aria-label': 'Titre du module' });
    titleInput.addEventListener('change', async () => {
      const { error: e } = await sb.from('modules').update({ title: titleInput.value.trim() || m.title }).eq('id', m.id);
      toast(e ? errorMessage(e) : 'Module renommé.', e ? 'err' : 'ok');
    });
    const newLesson = h('input', { type: 'text', maxlength: 160, placeholder: 'Titre de la nouvelle leçon', 'aria-label': 'Titre de la nouvelle leçon' });
    const addLesson = h('button', { class: 'icon-btn', type: 'button' }, 'Ajouter la leçon');
    addLesson.addEventListener('click', () => busy(addLesson, async () => {
      const t = newLesson.value.trim();
      if (!t) return toast('Donnez un titre à la leçon.', 'err');
      const pos = (m.lessons.at(-1)?.position || 0) + 1;
      const { data: l, error: e } = await sb.from('lessons')
        .insert({ course_id: current.id, module_id: m.id, title: t, position: pos }).select().single();
      if (e) return toast(errorMessage(e), 'err');
      await sb.from('lesson_contents').insert({ lesson_id: l.id, course_id: current.id, body: '' });
      refresh();
    }));

    panel.append(h('div', { class: 'module-block' },
      h('header', {},
        h('strong', {}, `Module ${mi + 1}`), titleInput,
        h('button', { class: 'icon-btn', type: 'button', title: 'Monter', 'aria-label': 'Monter le module', onclick: () => swap('modules', m, modules[mi - 1]) }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Descendre', 'aria-label': 'Descendre le module', onclick: () => swap('modules', m, modules[mi + 1]) }, '↓'),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Supprimer le module',
          onclick: async () => {
            if (!confirm(`Supprimer le module « ${m.title} » et ses ${m.lessons.length} leçon(s) ?`)) return;
            const { error: e } = await sb.from('modules').delete().eq('id', m.id);
            if (e) return toast(errorMessage(e), 'err');
            refresh();
          },
        }, 'Supprimer')),
      h('ul', {},
        m.lessons.map((l, li) => h('li', {},
          h('span', { class: 't' }, `${li + 1}. ${l.title}`),
          l.is_free_preview ? h('span', { class: 'tag tag--ok' }, 'Gratuite') : null,
          h('button', { class: 'icon-btn', type: 'button', onclick: () => openLesson(l.id, refresh) }, 'Modifier'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Monter la leçon', onclick: () => swap('lessons', l, m.lessons[li - 1]) }, '↑'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Descendre la leçon', onclick: () => swap('lessons', l, m.lessons[li + 1]) }, '↓'),
          h('button', {
            class: 'icon-btn', type: 'button', 'aria-label': 'Supprimer la leçon',
            onclick: async () => {
              if (!confirm(`Supprimer la leçon « ${l.title} » ?`)) return;
              await removeLessonFiles(l.id);
              const { error: e } = await sb.from('lessons').delete().eq('id', l.id);
              if (e) return toast(errorMessage(e), 'err');
              refresh();
            },
          }, '✕'))),
        h('li', {}, newLesson, addLesson))));
  });

  const newModule = h('input', { type: 'text', maxlength: 160, placeholder: 'Titre du nouveau module', 'aria-label': 'Titre du nouveau module' });
  const addModule = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Ajouter un module');
  addModule.addEventListener('click', () => busy(addModule, async () => {
    const t = newModule.value.trim();
    if (!t) return toast('Donnez un titre au module.', 'err');
    const pos = (modules?.at(-1)?.position || 0) + 1;
    const { error: e } = await sb.from('modules').insert({ course_id: current.id, title: t, position: pos });
    if (e) return toast(errorMessage(e), 'err');
    refresh();
  }));
  panel.append(h('div', { class: 'btn-row' }, newModule, addModule));
  if (!modules?.length) panel.insertBefore(h('p', { class: 'muted' }, 'Commencez par créer un module (ex. « Les bases »), puis ajoutez-y des leçons.'), panel.children[1]);
  return panel;
}

async function removeLessonFiles(lessonId) {
  const { data } = await sb.from('lesson_resources').select('storage_path').eq('lesson_id', lessonId).not('storage_path', 'is', null);
  const paths = (data || []).map((r) => r.storage_path);
  if (paths.length) await sb.storage.from('course-media').remove(paths);
}

// ---------------------------------------------------------------------
// Éditeur de leçon : texte, fichiers, quiz
// ---------------------------------------------------------------------
async function openLesson(lessonId, onClose) {
  const dialog = $('#lesson-dialog');
  const box = $('#lesson-editor');
  dialog.style.width = 'min(900px, 96vw)';
  box.replaceChildren(h('div', { class: 'skeleton' }));
  dialog.showModal();
  dialog.onclose = () => onClose?.();

  const [{ data: lesson }, { data: content }, { data: resources }, { data: questions }] = await Promise.all([
    sb.from('lessons').select('*').eq('id', lessonId).single(),
    sb.from('lesson_contents').select('body').eq('lesson_id', lessonId).maybeSingle(),
    sb.from('lesson_resources').select('*').eq('lesson_id', lessonId).order('position').order('created_at'),
    sb.from('quiz_questions').select('id, prompt, choices, position, quiz_keys(correct_index, explanation)')
      .eq('lesson_id', lessonId).order('position').order('created_at'),
  ]);

  // --- Texte de la leçon ---
  const title = h('input', { type: 'text', maxlength: 160, value: lesson.title });
  const summary = h('input', { type: 'text', maxlength: 500, value: lesson.summary || '' });
  const duration = h('input', { type: 'number', min: 0, max: 600, value: lesson.duration_min ?? '' });
  const free = h('input', { type: 'checkbox', checked: lesson.is_free_preview });
  const body = h('textarea', { class: 'code', maxlength: 100000 });
  body.value = content?.body || '';
  const saveText = h('button', { class: 'btn', type: 'button' }, 'Enregistrer la leçon');
  saveText.addEventListener('click', () => busy(saveText, async () => {
    const { error: e1 } = await sb.from('lessons').update({
      title: title.value.trim() || lesson.title,
      summary: summary.value.trim() || null,
      duration_min: duration.value === '' ? null : Number(duration.value),
      is_free_preview: free.checked,
    }).eq('id', lessonId);
    const { error: e2 } = await sb.from('lesson_contents')
      .upsert({ lesson_id: lessonId, course_id: lesson.course_id, body: body.value });
    if (e1 || e2) return toast(errorMessage(e1 || e2), 'err');
    toast('Leçon enregistrée.', 'ok');
  }));

  // --- Ressources ---
  const resList = h('div');
  const renderResources = (list) => {
    resList.replaceChildren(...(list.length ? list : []).map((r) => h('div', { class: 'res-row' },
      h('span', { class: 'tag' }, KINDS[r.kind].split(' ')[0]),
      h('span', { class: 't' }, r.title, r.external_url ? h('span', { class: 'small muted' }, ` · ${new URL(r.external_url).hostname}`) : null),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Supprimer ${r.title}`,
        onclick: async () => {
          if (!confirm(`Supprimer « ${r.title} » ?`)) return;
          if (r.storage_path) await sb.storage.from('course-media').remove([r.storage_path]);
          const { error } = await sb.from('lesson_resources').delete().eq('id', r.id);
          if (error) return toast(errorMessage(error), 'err');
          list.splice(list.indexOf(r), 1);
          renderResources(list);
        },
      }, 'Supprimer'))));
    if (!list.length) resList.append(h('p', { class: 'muted small' }, 'Aucun fichier pour le moment.'));
  };
  const resources_ = resources || [];
  renderResources(resources_);

  const kind = select(KINDS, 'video');
  const resTitle = h('input', { type: 'text', maxlength: 160, placeholder: 'Ex. Vidéo de la leçon, Fichier d\'exercice' });
  const file = h('input', { type: 'file', accept: ACCEPT.video });
  const url = h('input', { type: 'url', placeholder: 'https://youtu.be/… ou https://iframe.mediadelivery.net/…' });
  kind.addEventListener('change', () => { file.accept = ACCEPT[kind.value] || ''; file.hidden = kind.value === 'link'; });
  const addRes = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Ajouter le fichier ou le lien');
  addRes.addEventListener('click', () => busy(addRes, async () => {
    const f = file.files?.[0];
    const link = url.value.trim();
    const name = resTitle.value.trim() || f?.name || '';
    if (!name) return toast('Donnez un titre à la ressource.', 'err');
    if (!f && !link) return toast('Choisissez un fichier ou collez un lien.', 'err');
    if (f && link) return toast('Choisissez un fichier OU un lien, pas les deux.', 'err');
    const row = { lesson_id: lessonId, course_id: lesson.course_id, kind: kind.value, title: name, position: resources_.length + 1 };
    if (link) {
      if (!/^https:\/\//.test(link)) return toast('Le lien doit commencer par https://', 'err');
      row.external_url = link;
    } else {
      if (f.size > MAX_UPLOAD) return toast('Fichier trop lourd (50 Mo maximum). Pour une vidéo longue, hébergez-la sur YouTube (non répertoriée) ou Bunny Stream et collez le lien.', 'err');
      const safe = f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
      row.storage_path = `${lesson.course_id}/${lessonId}/${crypto.randomUUID()}-${safe}`;
      toast('Envoi du fichier en cours…');
      const { error: upErr } = await sb.storage.from('course-media').upload(row.storage_path, f, { contentType: f.type || undefined });
      if (upErr) return toast(errorMessage(upErr), 'err');
    }
    const { data, error } = await sb.from('lesson_resources').insert(row).select().single();
    if (error) return toast(errorMessage(error), 'err');
    resources_.push(data);
    renderResources(resources_);
    resTitle.value = ''; url.value = ''; file.value = '';
    toast('Ressource ajoutée.', 'ok');
  }));

  // --- Quiz ---
  const quizBox = h('div');
  const qState = (questions || []).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    choices: [...q.choices],
    correct: q.quiz_keys?.correct_index ?? q.quiz_keys?.[0]?.correct_index ?? 0,
    explanation: q.quiz_keys?.explanation ?? q.quiz_keys?.[0]?.explanation ?? '',
  }));
  const deleted = [];
  const addQ = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Ajouter une question');

  function renderQuiz() {
    quizBox.replaceChildren(...qState.map((q, qi) => {
      const prompt = h('textarea', { maxlength: 600, 'aria-label': `Question ${qi + 1}` });
      prompt.value = q.prompt;
      prompt.style.minHeight = '64px';
      prompt.addEventListener('input', () => { q.prompt = prompt.value; });
      const expl = h('input', { type: 'text', maxlength: 1000, value: q.explanation, placeholder: 'Explication affichée après la réponse (facultatif)' });
      expl.addEventListener('input', () => { q.explanation = expl.value; });
      return h('div', { class: 'q-editor' },
        h('div', { class: 'btn-row' }, h('strong', {}, `Question ${qi + 1}`),
          h('button', { class: 'icon-btn', type: 'button', onclick: () => { if (q.id) deleted.push(q.id); qState.splice(qi, 1); renderQuiz(); } }, 'Supprimer la question')),
        prompt,
        h('p', { class: 'small muted' }, 'Réponses (cochez la bonne) :'),
        q.choices.map((c, ci) => {
          const input = h('input', { type: 'text', maxlength: 300, value: c, 'aria-label': `Réponse ${ci + 1}` });
          input.addEventListener('input', () => { q.choices[ci] = input.value; });
          return h('div', { class: 'q-choice' },
            h('input', { type: 'radio', name: `correct-${qi}`, checked: q.correct === ci, 'aria-label': 'Bonne réponse', onchange: () => { q.correct = ci; } }),
            input,
            q.choices.length > 2 ? h('button', {
              class: 'icon-btn', type: 'button', 'aria-label': 'Retirer cette réponse',
              onclick: () => { q.choices.splice(ci, 1); if (q.correct >= q.choices.length) q.correct = 0; renderQuiz(); },
            }, '✕') : null);
        }),
        q.choices.length < 4 ? h('button', { class: 'icon-btn', type: 'button', onclick: () => { q.choices.push(''); renderQuiz(); } }, 'Ajouter une réponse') : null,
        h('div', { class: 'field' }, expl));
    }));
    if (!qState.length) quizBox.append(h('p', { class: 'muted small' }, 'Pas de quiz : l\'apprenant marquera la leçon comme terminée lui-même.'));
    addQ.disabled = qState.length >= 4;
  }
  addQ.addEventListener('click', () => {
    if (qState.length >= 4) return;
    qState.push({ id: null, prompt: '', choices: ['', '', ''], correct: 0, explanation: '' });
    renderQuiz();
  });
  renderQuiz();

  const saveQuiz = h('button', { class: 'btn', type: 'button' }, 'Enregistrer le quiz');
  saveQuiz.addEventListener('click', () => busy(saveQuiz, async () => {
    if (qState.length === 1) return toast('Un quiz contient 2 à 4 questions (ou aucune).', 'err');
    for (const [i, q] of qState.entries()) {
      q.choices = q.choices.map((c) => c.trim());
      if (q.prompt.trim().length < 3) return toast(`Question ${i + 1} : écrivez l'intitulé.`, 'err');
      if (q.choices.length < 2 || q.choices.some((c) => !c)) return toast(`Question ${i + 1} : 2 à 4 réponses, toutes remplies.`, 'err');
    }
    if (deleted.length) {
      const { error } = await sb.from('quiz_questions').delete().in('id', deleted);
      if (error) return toast(errorMessage(error), 'err');
      deleted.length = 0;
    }
    for (const [i, q] of qState.entries()) {
      const row = { lesson_id: lessonId, course_id: lesson.course_id, prompt: q.prompt.trim(), choices: q.choices, position: i + 1 };
      if (q.id) {
        const { error } = await sb.from('quiz_questions').update(row).eq('id', q.id);
        if (error) return toast(errorMessage(error), 'err');
      } else {
        const { data, error } = await sb.from('quiz_questions').insert(row).select('id').single();
        if (error) return toast(errorMessage(error), 'err');
        q.id = data.id;
      }
      const { error: kErr } = await sb.from('quiz_keys').upsert({
        question_id: q.id, course_id: lesson.course_id, correct_index: q.correct, explanation: q.explanation.trim() || null,
      });
      if (kErr) return toast(errorMessage(kErr), 'err');
    }
    toast('Quiz enregistré.', 'ok');
  }));

  box.replaceChildren(
    h('div', { class: 'dialog-head' },
      h('h2', { id: 'ld-title' }, 'Modifier la leçon'),
      h('button', { class: 'dialog-close', type: 'button', 'aria-label': 'Fermer', onclick: () => dialog.close() }, '×')),
    h('section', {},
      field('Titre', title),
      field('Résumé', summary, 'Une phrase : ce que l\'apprenant saura faire.'),
      h('div', { class: 'grid-2' },
        field('Durée (minutes)', duration),
        h('div', { class: 'field' }, h('label', {}, 'Accès'), h('label', { class: 'check' }, free, h('span', {}, 'Leçon gratuite (visible sans acheter la formation)')))),
      field('Contenu (Markdown)', body, 'Notes de cours, consignes d\'exercice, formules… Les vidéos et fichiers s\'ajoutent plus bas.'),
      saveText),
    h('hr'),
    h('section', {},
      h('h3', {}, 'Vidéos, audios, images et documents'),
      resList,
      h('div', { class: 'grid-2' }, field('Type', kind), field('Titre', resTitle)),
      field('Fichier', file, 'Jusqu\'à 50 Mo. Pour les vidéos longues, préférez un lien YouTube (non répertoriée), Vimeo ou Bunny Stream.'),
      field('… ou lien', url),
      addRes),
    h('hr'),
    h('section', {},
      h('h3', {}, 'Quiz de fin de leçon (2 à 4 questions)'),
      quizBox,
      h('div', { class: 'btn-row' }, addQ, saveQuiz)));
}

// ---------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------
const PROVIDERS = { stripe: 'Carte', airtel_money: 'Airtel Money', moov_money: 'Moov Money', virement: 'Virement' };

async function renderPayments(status = 'pending') {
  const tab = $('#tab-payments');
  const filter = select({ pending: 'À valider', paid: 'Payés', rejected: 'Refusés', all: 'Tous' }, status);
  filter.addEventListener('change', () => renderPayments(filter.value));
  const { data, error } = await sb.rpc('admin_list_payments', { p_status: status === 'all' ? null : status });
  if (error) return toast(errorMessage(error), 'err');
  tab.replaceChildren(h('section', { class: 'panel' },
    h('div', { class: 'btn-row' }, h('h2', {}, 'Paiements'), filter),
    h('p', { class: 'muted small' }, 'Vérifiez la référence sur votre compte Mobile Money ou bancaire avant de valider : la validation ouvre l\'accès immédiatement.'),
    data.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Date', 'Apprenant', 'Formation', 'Moyen', 'Montant', 'Référence', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, data.map((p) => h('tr', {},
        h('td', {}, formatDate(p.created_at)),
        h('td', {}, p.full_name || '—', h('br'), h('span', { class: 'small muted' }, p.email)),
        h('td', {}, p.course_title),
        h('td', {}, PROVIDERS[p.provider]),
        h('td', {}, formatAmount(p.amount, p.currency)),
        h('td', {}, p.payer_reference || '—', p.payer_phone ? h('div', { class: 'small muted' }, p.payer_phone) : null),
        h('td', {}, p.status === 'pending' && p.provider !== 'stripe'
          ? h('div', { class: 'btn-row' },
              h('button', { class: 'btn btn--small', type: 'button', onclick: (e) => review(e, p.id, true) }, 'Valider'),
              h('button', { class: 'btn btn--danger btn--small', type: 'button', onclick: (e) => review(e, p.id, false) }, 'Refuser'))
          : p.status)))))) : h('p', { class: 'muted' }, 'Aucun paiement dans cette catégorie.')));

  function review(e, id, approve) {
    if (!approve && !confirm('Refuser ce paiement ?')) return;
    busy(e.currentTarget, async () => {
      const { error: err } = await sb.rpc('review_payment', { p_payment: id, p_approve: approve });
      if (err) return toast(errorMessage(err), 'err');
      toast(approve ? 'Paiement validé, accès ouvert.' : 'Paiement refusé.', 'ok');
      renderPayments(status);
    });
  }
}

async function renderUsers(search = '') {
  const tab = $('#tab-users');
  const input = h('input', { type: 'search', value: search, placeholder: 'Rechercher par nom ou e-mail', 'aria-label': 'Rechercher un utilisateur' });
  input.addEventListener('change', () => renderUsers(input.value.trim()));
  const { data, error } = await sb.rpc('admin_list_users', { p_search: search });
  if (error) return toast(errorMessage(error), 'err');
  const roles = { student: 'Apprenant', instructor: 'Formateur', admin: 'Administrateur' };
  tab.replaceChildren(h('section', { class: 'panel' },
    h('h2', {}, 'Utilisateurs'), input,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Inscrit le', 'Nom', 'E-mail', 'Rôle'].map((t) => h('th', {}, t)))),
      h('tbody', {}, data.map((u) => {
        const sel = select(roles, u.role);
        sel.setAttribute('aria-label', `Rôle de ${u.email}`);
        sel.addEventListener('change', async () => {
          if (!confirm(`Donner le rôle « ${roles[sel.value]} » à ${u.email} ?`)) { sel.value = u.role; return; }
          const { error: err } = await sb.rpc('admin_set_role', { p_user: u.id, p_role: sel.value });
          if (err) { sel.value = u.role; return toast(errorMessage(err), 'err'); }
          u.role = sel.value;
          toast('Rôle modifié.', 'ok');
        });
        return h('tr', {}, h('td', {}, formatDate(u.created_at)), h('td', {}, u.full_name || '—'), h('td', {}, u.email), h('td', {}, sel));
      }))))));
}

async function renderAccess() {
  const tab = $('#tab-access');
  const { data: list } = await sb.from('courses').select('id, title, status').neq('status', 'archived').order('title');
  const email = h('input', { type: 'email', placeholder: 'e-mail du salarié ou de l\'apprenant' });
  const course = h('select', {}, (list || []).map((c) => h('option', { value: c.id }, c.title)));
  const go = h('button', { class: 'btn', type: 'button' }, 'Donner l\'accès');
  go.addEventListener('click', () => busy(go, async () => {
    const { error } = await sb.rpc('admin_grant_access', { p_email: email.value.trim(), p_course: course.value });
    if (error) return toast(errorMessage(error), 'err');
    toast('Accès ouvert.', 'ok');
    email.value = '';
  }));
  tab.replaceChildren(h('section', { class: 'panel' },
    h('h2', {}, 'Donner l\'accès à une formation'),
    h('p', { class: 'muted' }, 'Pour une entreprise qui paie sur facture, une bourse ou une invitation. La personne doit avoir créé son compte.'),
    h('div', { class: 'grid-2' }, field('E-mail', email), field('Formation', course)),
    go));
}

async function renderMessages() {
  const tab = $('#tab-messages');
  const { data, error } = await sb.from('contact_requests').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return toast(errorMessage(error), 'err');
  const kinds = { entreprise: 'Entreprise', particulier: 'Particulier', formateur: 'Formateur' };
  tab.replaceChildren(h('section', { class: 'panel' },
    h('h2', {}, 'Messages reçus'),
    data.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['Date', 'Type', 'Contact', 'Message', 'Traité'].map((t) => h('th', {}, t)))),
      h('tbody', {}, data.map((m) => h('tr', {},
        h('td', {}, formatDate(m.created_at)),
        h('td', {}, h('span', { class: 'tag' }, kinds[m.kind])),
        h('td', {}, m.name, h('br'), h('a', { href: `mailto:${m.email}` }, m.email), m.company ? h('div', { class: 'small muted' }, m.company) : null),
        h('td', {}, m.message),
        h('td', {}, h('input', {
          type: 'checkbox', checked: m.handled, 'aria-label': 'Marquer comme traité',
          onchange: async (e) => {
            const { error: err } = await sb.from('contact_requests').update({ handled: e.target.checked }).eq('id', m.id);
            if (err) toast(errorMessage(err), 'err');
          },
        }))))))) : h('p', { class: 'muted' }, 'Aucun message pour le moment.')));
}
