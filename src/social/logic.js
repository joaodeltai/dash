/* ---------- SOCIAL MEDIA · pure logic ----------
   Numbers, dates, CSV reading and chart geometry. No DOM, no network and no app state, so every function here
   can be tested on its own. */
import { getLang } from '../core/i18n.js';

export const METRICS = ['followers', 'following', 'posts_count', 'views', 'likes', 'comments', 'shares'];
export const TIME_ZONE = 'America/Sao_Paulo';

const locale = () => (getLang() === 'pt-BR' ? 'pt-BR' : 'en-US');
const isNum = n => typeof n === 'number' && Number.isFinite(n);

/* ---------- formatting ---------- */
export const fmtNum = n => (isNum(n) ? new Intl.NumberFormat(locale()).format(n) : '—');
/* 12,345 -> "12.3K" / "12,3 mil". Small numbers stay whole. */
export const fmtCompact = n =>
  !isNum(n) ? '—' : Math.abs(n) < 10000 ? fmtNum(n) : new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
/* A change with its sign: +200, −15, 0. */
export const fmtDelta = (n, compact = false) =>
  !isNum(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + (compact ? fmtCompact(Math.abs(n)) : fmtNum(Math.abs(n)));
export const fmtPct = p => {
  const n = typeof p === 'string' ? Number(p) : p;
  if (!isNum(n)) return '';
  return (n > 0 ? '+' : n < 0 ? '−' : '') + new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(Math.abs(n)) + '%';
};
export const trend = n => (!isNum(n) || n === 0 ? '' : n > 0 ? 'up' : 'bad');

/* ---------- dates (plain YYYY-MM-DD texts; "today" is the date in São Paulo, the same day the database uses) ---------- */
export const todayIn = (timeZone = TIME_ZONE, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function addDays(dateText, n) {
  const [y, m, d] = dateText.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
const validDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const pad = n => String(n).padStart(2, '0');
/* Accepts 2026-11-11 (also with / or .), 11/11/2026, 11-11-2026 and 11.11.2026 (day first, as written in Brazil), each
   optionally followed by a time. Anything else is null. */
export function parseDate(text) {
  const s = String(text ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return validDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T ].*)?$/);
  if (m) return validDate(+m[3], +m[2], +m[1]) ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
  return null;
}

/* A count typed by a person: "12345", "12.345", "12,345", "1.234,00", "1,2 mil", "3.4k". Null when it is not a number. */
export function parseCount(text) {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? Math.round(text) : null;
  const s = String(text ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  const m = s.match(/^([\d.,\s]+)\s*(k|m|b|mil|mi|bi)?$/);
  if (!m) return null;
  let digits = m[1].replace(/\s/g, '');
  if (!/\d/.test(digits)) return null;
  if (m[2]) {
    const n = Number(digits.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * (m[2] === 'k' || m[2] === 'mil' ? 1e3 : m[2] === 'm' || m[2] === 'mi' ? 1e6 : 1e9));
  }
  // a spreadsheet may write a whole number with empty decimals: "1234,00", "1.234,00", "1,234.0". One or two zeros after
  // the last mark are decimals (thousands come in threes), so they can go.
  const cents = digits.match(/^(\d{1,3}(?:[.,]\d{3})+|\d+)[.,]0{1,2}$/);
  if (cents) digits = cents[1];
  if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) digits = digits.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/* ---------- CSV ---------- */

/* Splits CSV text into rows of cells. The separator (comma, semicolon or tab) is taken from the first line that is
   not blank;
   cells may be quoted and may contain the separator, quotes ("") and line breaks. Blank lines are skipped.
   `lines` gives, for each row, the line of the file where it starts (1 is the first), so a problem can be
   pointed at the line the person sees in their editor. */
export function parseCsv(text) {
  let src = String(text ?? '');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // byte order mark written by spreadsheet programs
  const firstLine = src.split(/\r\n|\r|\n/).find(l => l.trim() !== '') || ''; // the first line that has something in it
  const count = ch => firstLine.split(ch).length - 1;
  // spreadsheet programs may announce the separator in a first line of their own: sep=;
  const hint = firstLine.match(/^\s*sep=(.)[ ]*$/i); // not trimmed first: the announced separator may be a tab
  const sep = hint ? hint[1] : count('\t') > count(';') && count('\t') > count(',') ? '\t' : count(';') > count(',') ? ';' : ',';
  const found = [];
  let row = [],
    cell = '',
    quoted = false,
    line = 1,
    start = 1;
  const endRow = () => {
    row.push(cell);
    found.push({ cells: row, line: start });
    row = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const breaks = c === '\n' || (c === '\r' && src[i + 1] !== '\n');
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        cell += c;
        if (breaks) line++;
      }
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      start = line;
    } else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  const filled = found.filter(r => r.cells.some(c => c.trim() !== ''));
  const kept = hint ? filled.slice(1) : filled; // the announcement line is not data
  return { sep, rows: kept.map(r => r.cells), lines: kept.map(r => r.line) };
}

const plain = s =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/* Column names accepted in the first line, in English and Portuguese. */
export const CSV_COLUMNS = {
  date: ['date', 'data', 'dia', 'day'],
  platform: ['platform', 'network', 'rede', 'plataforma', 'rede social'],
  handle: ['handle', 'account', 'conta', 'usuario', 'user', 'username', 'perfil', 'profile'],
  followers: ['followers', 'seguidores', 'subscribers', 'assinantes', 'inscritos', 'audience', 'audiencia', 'users', 'usuarios'],
  following: ['following', 'seguindo'],
  posts_count: ['posts', 'posts count', 'publicacoes', 'postagens', 'videos'],
  views: ['views', 'visualizacoes', 'impressions', 'impressoes', 'pageviews'],
  likes: ['likes', 'curtidas'],
  comments: ['comments', 'comentarios'],
  shares: ['shares', 'compartilhamentos'],
};
const cleanHandle = h =>
  String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

/* Turns parsed CSV into snapshot rows.
   - The first line names the columns. `date` is required, and so is at least one number column.
   - With `platform` and `handle` columns each line goes to the matching account; without them every line goes to
     `defaultAccountId`.
   - Two lines for the same account and day: the last one wins.
   - An empty cell is left out of the row, so it never erases a number that is already stored.
   Returns { rows, fields, errors, total, routed } where errors are { line, code, value } and `line` is the line
   of the file (1 is the first). `routed` says the accounts came from the file's own columns. */
export function csvToSnapshots(parsed, { accounts = [], defaultAccountId = '', today = todayIn() } = {}) {
  const out = { rows: [], fields: [], errors: [], total: 0, routed: false };
  const [header, ...lines] = parsed.rows;
  const lineOf = i => parsed.lines?.[i] ?? i + 1; // i counts rows, the header being 0
  if (!header) {
    out.errors.push({ line: 1, code: 'empty' });
    return out;
  }
  const col = {};
  header.forEach((h, i) => {
    const name = plain(h);
    for (const [field, names] of Object.entries(CSV_COLUMNS)) if (names.includes(name) && col[field] === undefined) col[field] = i;
  });
  const fields = METRICS.filter(f => col[f] !== undefined);
  if (col.date === undefined) out.errors.push({ line: lineOf(0), code: 'no-date-column' });
  if (!fields.length) out.errors.push({ line: lineOf(0), code: 'no-number-column' });
  const routed = col.platform !== undefined && col.handle !== undefined;
  if (!routed && !defaultAccountId) out.errors.push({ line: lineOf(0), code: 'no-account' });
  if (out.errors.length) return out;
  out.routed = routed;

  const index = new Map(accounts.map(a => [`${a.platform}|${cleanHandle(a.handle)}`, a.id]));
  const byKey = new Map();
  out.total = lines.length;
  lines.forEach((cells, i) => {
    const line = lineOf(i + 1);
    const get = f => (col[f] === undefined ? '' : (cells[col[f]] ?? '').trim());
    const date = parseDate(get('date'));
    if (!date) return out.errors.push({ line, code: 'bad-date', value: get('date') });
    if (date > today) return out.errors.push({ line, code: 'future-date', value: get('date') });
    let accountId = defaultAccountId;
    if (routed) {
      accountId = index.get(`${plain(get('platform')).replace(/ /g, '_')}|${cleanHandle(get('handle'))}`) || '';
      if (!accountId) return out.errors.push({ line, code: 'unknown-account', value: `${get('platform')} ${get('handle')}`.trim() });
    }
    const row = { account_id: accountId, date };
    let filled = 0;
    for (const f of fields) {
      const raw = get(f);
      if (raw === '') continue;
      const n = parseCount(raw);
      if (n === null) return out.errors.push({ line, code: 'bad-number', value: raw });
      row[f] = n;
      filled++;
    }
    if (!filled) return out.errors.push({ line, code: 'no-numbers' });
    byKey.set(`${accountId}|${date}`, row);
  });
  out.rows = [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  out.fields = fields;
  return out;
}

/* ---------- series ---------- */

/* One value per day: the sum, over the given accounts, of each account's most recent number on or before that day.
   Before its first snapshot an account counts with that first number, the same rule the growth views use: starting
   to follow an account is not growth, so it must not show up as a jump in the line.
   Days appear only when at least one account has a number. `snapshots` must be sorted by date.
   Returns [{ date, value }] for dates in [from, to]. */
export function buildSeries(snapshots, accountIds, metric, from, to) {
  const ids = new Set(accountIds);
  const rows = snapshots.filter(s => ids.has(s.account_id) && isNum(s[metric]) && s.date <= to);
  const current = new Map();
  for (const s of rows) if (!current.has(s.account_id)) current.set(s.account_id, s[metric]);
  const days = new Map();
  for (const s of rows) {
    current.set(s.account_id, s[metric]);
    let sum = 0;
    for (const v of current.values()) sum += v;
    days.set(s.date, sum);
  }
  const all = [...days.entries()].map(([date, value]) => ({ date, value }));
  const inside = all.filter(p => p.date >= from);
  // carry the last value before the window in as its starting point, so a 7-day view of weekly data is not empty
  const before = all.filter(p => p.date < from).pop();
  return before && (!inside.length || inside[0].date > from) ? [{ date: from, value: before.value }, ...inside] : inside;
}

/* Axis steps on a 1-2-5 scale. Returns { lo, hi, ticks } covering [min, max] with about `count` steps. */
export function niceScale(min, max, count = 4) {
  if (!isNum(min) || !isNum(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || raw);
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi: ticks[ticks.length - 1], ticks };
}

/* Chart geometry in a 0–100 box (x to the right, y down): points, the line and the area under it. */
export function chartGeometry(series) {
  if (!series.length) return null;
  const values = series.map(p => p.value);
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const first = series[0].date;
  const span = Math.max(1, daysBetween(series[series.length - 1].date, first));
  const r = n => Math.round(n * 100) / 100;
  const pts = series.map(p => ({
    ...p,
    x: series.length === 1 ? 50 : r((daysBetween(p.date, first) / span) * 100),
    y: r(100 - ((p.value - scale.lo) / Math.max(1, scale.hi - scale.lo)) * 100),
  }));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x} 100 L${pts[0].x} 100 Z` : '';
  return { pts, line, area, scale };
}

/* Progress of a goal. `current` is the latest number; `today` and `target_date` are YYYY-MM-DD. */
export function goalProgress(goal, current, today = todayIn()) {
  const target = Number(goal.target_value);
  const now = isNum(current) ? current : 0;
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((now / target) * 100))) : 0;
  const remaining = Math.max(0, target - now);
  const daysLeft = goal.target_date ? daysBetween(goal.target_date, today) : null;
  return {
    pct,
    remaining,
    done: remaining === 0,
    daysLeft,
    overdue: daysLeft !== null && daysLeft < 0 && remaining > 0,
    perDay: daysLeft !== null && daysLeft > 0 && remaining > 0 ? Math.ceil(remaining / daysLeft) : null,
  };
}

/* The same brand written with other capitals or stray spaces is the same brand: reuse the existing spelling. */
export function canonicalBrand(input, existing) {
  const clean = String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return existing.find(b => b.toLowerCase() === clean.toLowerCase()) || clean;
}
