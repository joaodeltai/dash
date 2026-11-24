/* Content area: ideas, a brief, and the production board.
   Stored values stay in English (or a stable slug). The UI translates them. */
import { TODAY, iso } from './utils.js';

export const CONTENT_TABS = [
  ['ideas', 'Ideas', 'lightbulb'],
  ['plan', 'Planning', 'notebook-pen'],
  ['board', 'Production', 'square-kanban'],
];

export const FORMATS = [
  { id: 'short', name: 'Short text' },
  { id: 'long', name: 'Long text' },
  { id: 'video', name: 'Video' },
  { id: 'social', name: 'X/Threads post' },
];

export const BRANDS = [
  { id: 'deltai', name: 'deltAI' },
  { id: 'fync', name: 'Fync' },
];

export const CHANNELS = [
  { id: 'linkedin', name: 'LinkedIn' },
  { id: 'substack', name: 'Substack' },
  { id: 'blog', name: 'Blog' },
  { id: 'x', name: 'X' },
  { id: 'threads', name: 'Threads' },
  { id: 'instagram', name: 'Instagram' },
];

/* Build in public is a theme, not a format: the Trello label becomes its own field. */
export const THEME_PRESET = 'Build in public';

export const STAGE_COLORS = ['gray', 'blue', 'violet', 'teal', 'amber', 'orange', 'rose', 'green', 'red'];
export const stageColor = c => (STAGE_COLORS.includes(c) ? `var(--${c})` : 'var(--gray)');

const byId = (list, id) => list.find(x => x.id === id);

export const formatLabel = id => byId(FORMATS, id)?.name || '';
export const brandLabel = id => byId(BRANDS, id)?.name || '';
export const channelLabel = id => byId(CHANNELS, id)?.name || '';

export function stageLabel(stage) {
  return stage?.name || '';
}

/* Columns on the board: production, then the published column. Ideas and planning stay off it. */
export function boardStages(stages) {
  return [...(stages || [])].filter(s => s.kind === 'production' || s.kind === 'published').sort((a, b) => a.position - b.position);
}

export function stageByKind(stages, kind) {
  return [...(stages || [])].filter(s => s.kind === kind).sort((a, b) => a.position - b.position)[0] || null;
}

export function stageBySlug(stages, slug) {
  return (stages || []).find(s => s.slug === slug) || null;
}

const qOf = (item, q) => {
  if (!q) return true;
  const hay = [item.title, item.source, item.theme, item.objective, item.key, ...(item.tags || [])].join(' ').toLowerCase();
  return hay.includes(q);
};

/* Ideas bank and the board share one filter shape. `channel` matches a piece that targets it. */
export function filterItems(items, { q = '', format = 'all', brand = 'all', theme = 'all', channel = 'all', when = 'all', today = iso(TODAY) } = {}) {
  const query = String(q || '')
    .trim()
    .toLowerCase();
  return (items || []).filter(item => {
    if (!qOf(item, query)) return false;
    if (format !== 'all' && item.format !== format) return false;
    if (brand !== 'all' && item.brand !== brand) return false;
    if (theme === 'preset' && item.theme !== THEME_PRESET) return false;
    if (theme === 'other' && (!item.theme || item.theme === THEME_PRESET)) return false;
    if (channel !== 'all' && !(item.channels || []).some(c => c.channel === channel)) return false;
    if (when === 'dated' && !item.target) return false;
    if (when === 'undated' && item.target) return false;
    if (when === 'overdue' && !(item.target && item.target < today)) return false;
    if (when === 'week' && !inWeek(item.target, today)) return false;
    return true;
  });
}

function inWeek(day, today) {
  if (!day) return false;
  return day >= today && day <= addDays(today, 7);
}

function addDays(isoDay, n) {
  const [y, m, d] = isoDay.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function channelsOf(item) {
  return (item?.channels || []).map(c => c.channel);
}
