import { sb, boot, $, h, courseCard } from '../lib.js';

boot(async () => {
  const grid = $('#catalogue');
  const params = new URLSearchParams(location.search);
  if (params.get('outil')) $('#f-cat').value = params.get('outil');

  const { data: courses, error } = await sb
    .from('courses')
    .select('slug, title, subtitle, description, category, level, cover_url, price_eur_cents, price_xaf, is_free, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function render() {
    const q = norm($('#f-q').value.trim());
    const cat = $('#f-cat').value;
    const level = $('#f-level').value;
    const price = $('#f-price').value;
    const list = courses.filter((c) =>
      (!cat || c.category === cat) &&
      (!level || c.level === level) &&
      (!price || (price === 'free' ? c.is_free : !c.is_free)) &&
      (!q || norm(`${c.title} ${c.subtitle} ${c.description}`).includes(q)));
    grid.replaceChildren(...(list.length
      ? list.map(courseCard)
      : [h('div', { class: 'empty' }, 'Aucune formation ne correspond à ces critères pour le moment.')]));
  }

  $('#filters').addEventListener('input', render);
  $('#filters').addEventListener('submit', (e) => e.preventDefault());
  render();
});
