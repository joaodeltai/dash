/* CRM vocabulary and pure helpers. Stage names are stored in English (the
   translation key) so the same pipeline reads correctly in either language.
   Money is integer cents of BRL. */
import { getLang, tr } from './i18n.js';

export const CRM_TABS = [
  ['pipeline', 'Pipeline', 'square-kanban'],
  ['companies', 'Companies', 'building-2'],
  ['contacts', 'Contacts', 'contact'],
  ['sequences', 'Sequences', 'workflow'],
];

export const CRM_SOURCES = [
  { id: 'inbound', name: 'Inbound' },
  { id: 'outbound', name: 'Outbound' },
  { id: 'referral', name: 'Referral' },
  { id: 'website', name: 'Website' },
  { id: 'event', name: 'Event' },
  { id: 'whatsapp', name: 'WhatsApp' },
  { id: 'linkedin', name: 'LinkedIn' },
  { id: 'other', name: 'Other' },
];

export const CRM_SIZES = [
  { id: '1-10', name: '1 to 10 people' },
  { id: '11-50', name: '11 to 50 people' },
  { id: '51-200', name: '51 to 200 people' },
  { id: '201-1000', name: '201 to 1,000 people' },
  { id: '1000+', name: 'More than 1,000 people' },
];

export const CRM_ACT_TYPES = [
  { id: 'note', name: 'Note', icon: 'sticky-note' },
  { id: 'email', name: 'Email', icon: 'mail' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'message-circle' },
  { id: 'linkedin', name: 'LinkedIn', icon: 'linkedin' },
  { id: 'call', name: 'Call', icon: 'phone' },
  { id: 'meeting', name: 'Meeting', icon: 'calendar' },
  { id: 'stage_change', name: 'Stage change', icon: 'arrow-right-left' },
];

export const CRM_CHANNELS = [
  { id: 'email', name: 'Email', icon: 'mail' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'message-circle' },
  { id: 'linkedin', name: 'LinkedIn', icon: 'linkedin' },
  { id: 'call', name: 'Call', icon: 'phone' },
];

export const CRM_DIRECTIONS = [
  { id: 'outbound', name: 'Outbound' },
  { id: 'inbound', name: 'Inbound' },
  { id: 'internal', name: 'Internal' },
];

const STAGE_COLORS = ['gray', 'blue', 'violet', 'teal', 'amber', 'orange', 'rose', 'green', 'red'];

export const stageColor = c => (STAGE_COLORS.includes(c) ? `var(--${c})` : 'var(--gray)');
export const stageLabel = s => (s ? tr(s.name) : '');
export const sourceLabel = id => {
  const known = CRM_SOURCES.find(s => s.id === id);
  return known ? tr(known.name) : id || '';
};
export const sizeLabel = id => {
  const known = CRM_SIZES.find(s => s.id === id);
  return known ? tr(known.name) : id || '';
};
export const actType = id => CRM_ACT_TYPES.find(t => t.id === id) || CRM_ACT_TYPES[0];

/* Open stages, then won, then the side columns (lost, nurture, anything else). */
export function columnStages(stages) {
  const list = [...(stages || [])].sort((a, b) => a.position - b.position || String(a.name).localeCompare(String(b.name)));
  const rank = s => (s.kind === 'open' ? 0 : s.kind === 'won' ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.position - b.position);
}

export function brl(cents) {
  const n = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat(getLang() === 'pt-BR' ? 'pt-BR' : 'en-US', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/* Accepts "12500", "12.500,50", "R$ 12,500.50". Returns integer cents, or null when the text is not a number. */
export function parseBrl(text) {
  let s = String(text ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/^R\$/i, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastComma < 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function nextStepTone(deal, stage, todayIso) {
  if (!deal?.nextOn || !todayIso) return '';
  if (stage?.kind === 'won' || stage?.kind === 'lost') return '';
  if (deal.nextOn < todayIso) return 'over';
  if (deal.nextOn === todayIso) return 'today';
  return '';
}

export function filterDeals(deals, opt) {
  const q = (opt.q || '').trim().toLowerCase();
  const stages = opt.stages || [];
  const byId = new Map(stages.map(s => [s.id, s]));
  return (deals || []).filter(d => {
    if (opt.stage && opt.stage !== 'all' && d.stage !== opt.stage) return false;
    if (opt.source && opt.source !== 'all' && d.source !== opt.source) return false;
    if (opt.owner === 'none') {
      if (d.owner) return false;
    } else if (opt.owner && opt.owner !== 'all' && d.owner !== opt.owner) return false;
    if (opt.tag && opt.tag !== 'all' && !(d.tags || []).includes(opt.tag)) return false;
    if (opt.overdue && nextStepTone(d, byId.get(d.stage), opt.today) !== 'over') return false;
    if (opt.company && d.company !== opt.company) return false;
    if (!q) return true;
    const company = (opt.companies || []).find(c => c.id === d.company);
    const contact = (opt.contacts || []).find(c => c.id === d.contact);
    const hay = [d.title, company?.name, company?.domain, contact?.name, contact?.email, ...(d.tags || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/* Snapshot funnel: of the deals that reached the previous open stage (or were won),
   the share that also reached this stage. Lost and nurture are left out, because a
   snapshot does not know which stage they fell out of. */
export function pipelineMetrics(deals, stages, now = new Date()) {
  const list = [...(stages || [])].sort((a, b) => a.position - b.position);
  const byId = new Map(list.map(s => [s.id, s]));
  const open = list.filter(s => s.kind === 'open');
  const month = now.getFullYear() * 12 + now.getMonth();
  const inMonth = ms => {
    if (!ms) return false;
    const d = new Date(ms);
    return d.getFullYear() * 12 + d.getMonth() === month;
  };
  const count = {};
  for (const s of list) count[s.id] = { n: 0, value: 0 };
  let openValue = 0;
  let openN = 0;
  let wonMonth = 0;
  let wonMonthN = 0;
  let wonN = 0;
  let lostN = 0;
  for (const d of deals || []) {
    const st = byId.get(d.stage);
    if (!st) continue;
    const bucket = (count[st.id] ||= { n: 0, value: 0 });
    bucket.n += 1;
    bucket.value += d.value || 0;
    if (st.kind === 'open') {
      openValue += d.value || 0;
      openN += 1;
    } else if (st.kind === 'won') {
      wonN += 1;
      if (inMonth(d.wonAt)) {
        wonMonth += d.value || 0;
        wonMonthN += 1;
      }
    } else if (st.kind === 'lost') lostN += 1;
  }
  const reached = idx =>
    (deals || []).filter(d => {
      const st = byId.get(d.stage);
      if (!st) return false;
      if (st.kind === 'won') return true;
      if (st.kind !== 'open') return false;
      return open.findIndex(s => s.id === st.id) >= idx;
    }).length;
  const conversions = [];
  for (let i = 1; i < open.length; i++) {
    const fromN = reached(i - 1);
    const toN = reached(i);
    conversions.push({ from: open[i - 1], to: open[i], fromN, toN, rate: fromN ? toN / fromN : null });
  }
  if (open.length) {
    const wonStage = list.find(s => s.kind === 'won');
    const fromN = reached(open.length - 1);
    if (wonStage) conversions.push({ from: open[open.length - 1], to: wonStage, fromN, toN: wonN, rate: fromN ? wonN / fromN : null });
  }
  return {
    openValue,
    openN,
    wonMonth,
    wonMonthN,
    wonN,
    lostN,
    winRate: wonN + lostN ? wonN / (wonN + lostN) : null,
    count,
    conversions,
  };
}
