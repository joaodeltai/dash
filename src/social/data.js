/* ---------- SOCIAL MEDIA · data ----------
   This area talks to Supabase directly (it is not part of the sync engine): what is shown is what the database holds,
   read when the page opens and again after every change. Row Level Security decides what each person may read
   and write; the checks made here only shape the screen. */
import { S } from '../core/store.js';
import { ctx, sb } from '../data/supabase.js';
import { addDays, todayIn } from './logic.js';

const HISTORY_DAYS = 400; // enough for the 12-month view
const PAGE = 1000; // the API returns at most 1000 rows per request

export const SOC = {
  ws: null, // workspace the data below belongs to
  status: 'idle', // idle | loading | ready | unavailable | error
  error: '',
  accounts: [],
  growth: [],
  brands: [],
  snapshots: [],
  posts: [],
  postsFor: null, // { key, rows }: best posts of the accounts on screen, read when a filter narrows them
  goals: [],
  runs: [],
  filters: { brand: '', platform: '', account: '', period: '90' },
  table: false, // chart shown as a table
  chart: null, // points of the chart on screen (read by the hover layer)
  dialog: null, // { type, id? }
  form: {},
  errors: {},
  busy: false,
  csv: null, // result of reading a CSV file
};

export function resetSocial() {
  Object.assign(SOC, { ws: null, status: 'idle', error: '', accounts: [], growth: [], brands: [], snapshots: [], posts: [], goals: [], runs: [] });
  Object.assign(SOC, { dialog: null, form: {}, errors: {}, busy: false, csv: null, table: false });
  SOC.filters = { brand: '', platform: '', account: '', period: '90' };
  SOC.chart = null;
}

/* The tables of this area do not exist in the database yet (the migration has not been applied there). */
const missing = e => !!e && (e.code === 'PGRST205' || e.code === 'PGRST200' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || ''));

async function all(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}
const one = async query => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

let loading = null;
/* Reads everything the page shows. Concurrent calls share one request. Returns true when the data is ready. */
export function loadSocial({ silent = false } = {}) {
  const ws = ctx.wsId;
  if (!sb || !ws) return Promise.resolve(false);
  if (loading && loading.ws === ws) return loading.promise;
  if (!silent || SOC.ws !== ws) {
    if (SOC.ws !== ws) resetSocial();
    SOC.status = 'loading';
  }
  SOC.ws = ws;
  const since = addDays(todayIn(), -HISTORY_DAYS);
  const promise = (async () => {
    try {
      const [accounts, growth, brands, snapshots, posts, goals, runs] = await Promise.all([
        one(
          sb
            .from('social_accounts')
            .select('id, brand, platform, handle, display_name, url, is_active, created_at')
            .eq('workspace_id', ws)
            .order('brand')
            .order('platform')
            .order('handle'),
        ),
        one(sb.from('social_account_growth').select('*').eq('workspace_id', ws)),
        one(sb.from('social_brand_growth').select('*').eq('workspace_id', ws).order('followers', { ascending: false })),
        all(() =>
          sb
            .from('social_snapshots')
            .select('account_id, date, followers, following, posts_count, views, likes, comments, shares, source, collected_at')
            .eq('workspace_id', ws)
            .gte('date', since)
            .order('date')
            .order('account_id'),
        ),
        one(sb.from('social_posts').select(POST_COLUMNS).eq('workspace_id', ws).order('engagement', { ascending: false }).limit(200)),
        one(sb.from('social_goals').select('id, account_id, metric, target_value, target_date').eq('workspace_id', ws)),
        one(sb.from('social_last_runs').select('platform, status, message, accounts_total, accounts_ok, finished_at').eq('workspace_id', ws)),
      ]);
      if (ctx.wsId !== ws) return false; // the person switched workspace while this was loading
      Object.assign(SOC, { accounts, growth, brands, snapshots, posts, postsFor: null, goals, runs, status: 'ready', error: '' });
      return true;
    } catch (e) {
      if (ctx.wsId !== ws) return false;
      SOC.status = missing(e) ? 'unavailable' : 'error';
      SOC.error = e?.message || String(e);
      return false;
    } finally {
      loading = null;
    }
  })();
  loading = { ws, promise };
  return promise;
}

/* ---------- changes ----------
   Each returns { ok: true } or { ok: false, code, message }. Codes: offline, duplicate, forbidden, failed. */
const fail = error => {
  const code = error?.code === '23505' ? 'duplicate' : error?.code === '42501' ? 'forbidden' : 'failed';
  return { ok: false, code, message: error?.message || '' };
};
const guard = () => (S.ui.offline || !sb || !ctx.wsId ? { ok: false, code: 'offline', message: '' } : null);

export async function saveAccount(values, id) {
  const blocked = guard();
  if (blocked) return blocked;
  const row = {
    brand: values.brand,
    platform: values.platform,
    handle: values.handle,
    display_name: values.display_name || '',
    url: values.url || '',
    is_active: values.is_active !== false,
  };
  const { error } = id
    ? await sb.from('social_accounts').update(row).eq('id', id)
    : await sb.from('social_accounts').insert({ ...row, workspace_id: ctx.wsId });
  return error ? fail(error) : { ok: true };
}

export async function deleteAccount(id) {
  const blocked = guard();
  if (blocked) return blocked;
  const { error } = await sb.from('social_accounts').delete().eq('id', id);
  return error ? fail(error) : { ok: true };
}

/* Writes one snapshot per account and day; a day that already has numbers gets the new ones, and a number that is
   not in the row is left as it was. `source` is "manual" or "csv". */
export async function saveSnapshots(rows, source) {
  const blocked = guard();
  if (blocked) return blocked;
  const stamp = new Date().toISOString();
  // rows sent together must carry the same fields (a missing field would be written as empty): group them by shape
  const shapes = new Map();
  for (const r of rows) {
    const shape = Object.keys(r).sort().join(',');
    if (!shapes.has(shape)) shapes.set(shape, []);
    shapes.get(shape).push({ ...r, source, collected_at: stamp });
  }
  let written = 0;
  for (const group of shapes.values()) {
    for (let i = 0; i < group.length; i += 500) {
      const part = group.slice(i, i + 500);
      const { error } = await sb.from('social_snapshots').upsert(part, { onConflict: 'account_id,date' });
      if (error) return { ...fail(error), written };
      written += part.length;
    }
  }
  return { ok: true, written };
}

export async function saveGoal({ account_id, target_value, target_date }) {
  const blocked = guard();
  if (blocked) return blocked;
  const { error } = await sb
    .from('social_goals')
    .upsert({ account_id, metric: 'followers', target_value, target_date: target_date || null }, { onConflict: 'account_id,metric' });
  return error ? fail(error) : { ok: true };
}

export async function deleteGoal(id) {
  const blocked = guard();
  if (blocked) return blocked;
  const { error } = await sb.from('social_goals').delete().eq('id', id);
  return error ? fail(error) : { ok: true };
}

const POST_COLUMNS = 'id, account_id, external_id, url, caption, post_type, posted_at, likes, comments, shares, views, engagement';
let postsPending = '';
/* The best posts of the given accounts. Without filters they come from what the page already loaded (the best of the
   whole workspace). With a brand or network filter that list may not hold the best of a small account, so they are
   read for those accounts; until the answer arrives the known ones are shown, and `onReady` is called when it does. */
export function postsOnScreen(accounts, onReady) {
  const ids = accounts.map(a => a.id);
  const known = SOC.posts.filter(p => ids.includes(p.account_id));
  if ((!SOC.filters.brand && !SOC.filters.platform) || !ids.length || !sb) return known;
  const key = [...ids].sort().join(',');
  if (SOC.postsFor?.key === key) return SOC.postsFor.rows;
  if (postsPending !== key) {
    postsPending = key;
    sb.from('social_posts')
      .select(POST_COLUMNS)
      .in('account_id', ids)
      .order('engagement', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (postsPending === key) postsPending = '';
        if (error) return;
        SOC.postsFor = { key, rows: data };
        onReady();
      });
  }
  return known;
}

/* ---------- reading what was loaded ---------- */
export const accountById = id => SOC.accounts.find(a => a.id === id);
export const growthOf = id => SOC.growth.find(g => g.account_id === id);
export const goalOf = id => SOC.goals.find(g => g.account_id === id && g.metric === 'followers');
export const brandNames = () => [...new Set(SOC.accounts.map(a => a.brand))].sort((a, b) => a.localeCompare(b));
export const platformIds = () => [...new Set(SOC.accounts.map(a => a.platform))];
export function filteredAccounts() {
  const f = SOC.filters;
  return SOC.accounts.filter(a => (!f.brand || a.brand === f.brand) && (!f.platform || a.platform === f.platform));
}
