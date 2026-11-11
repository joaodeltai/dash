/* Pure helpers of the social collector: no network, no database, no Deno APIs.
   Everything a collector row can express (input template, field map) is interpreted here, so swapping the
   actor of a platform is a change to its row in `social_collectors`, never to this code. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Account {
  id: string;
  workspace_id: string;
  platform: string;
  handle: string;
  url: string;
}

/* Where each number lives in the collector's response. Paths are dot-separated ("authorMeta.fans", "latestPosts.0.id").
   item_kind  "profile": one item per account, its posts in the array at `posts_path` (optional)
              "post":    every item is a post that also carries the account's numbers
   account_key path of the value that says which account an item belongs to (user name or profile URL).
               Needed only when one run returns several accounts. */
export interface FieldMap {
  item_kind?: 'profile' | 'post';
  account_key?: string;
  snapshot?: Partial<Record<SnapshotField, string>>;
  extra?: Record<string, string>;
  posts_path?: string;
  post?: Partial<Record<PostField, string>>;
  max_posts?: number;
}

export const SNAPSHOT_FIELDS = ['followers', 'following', 'posts_count', 'views', 'likes', 'comments', 'shares'] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
export const POST_FIELDS = ['external_id', 'url', 'caption', 'post_type', 'posted_at', 'likes', 'comments', 'shares', 'views'] as const;
export type PostField = (typeof POST_FIELDS)[number];

export interface SnapshotRow {
  account_id: string;
  date: string;
  source: string;
  collected_at: string;
  extra: Record<string, Json>;
  followers?: number | null;
  following?: number | null;
  posts_count?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
}

export interface PostRow {
  account_id: string;
  external_id: string;
  url: string;
  caption: string;
  post_type: string;
  posted_at: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  source: string;
  collected_at: string;
}

export interface Normalized {
  snapshots: SnapshotRow[];
  posts: PostRow[];
  /* accounts for which the response had no usable number */
  missing: Account[];
}

const MAX_POSTS = 100;
const isObject = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

/* Reads "a.b.0.c" from a JSON value. Missing steps give undefined. */
export function getPath(value: unknown, path: string | undefined | null): Json | undefined {
  if (!path) return undefined;
  let cur: unknown = value;
  for (const step of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(step);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[step];
    } else return undefined;
  }
  return cur as Json | undefined;
}

/* A count as a non-negative integer. Accepts numbers and texts such as "12,345", "12.345", "1.2K", "3,4 mi". */
export function toCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^([\d.,\s]+)\s*(k|m|b|mil|mi|bi)?$/);
  if (!m) return null;
  let digits = m[1].replace(/\s/g, '');
  const unit = m[2];
  if (unit) {
    // with a unit, the last separator is a decimal mark: "1.2k", "3,4 mi"
    digits = digits.replace(',', '.');
    const n = Number(digits);
    if (!Number.isFinite(n)) return null;
    const mult = unit === 'k' || unit === 'mil' ? 1e3 : unit === 'm' || unit === 'mi' ? 1e6 : 1e9;
    return Math.round(n * mult);
  }
  // without a unit, separators are thousands marks: "12,345" and "12.345" are both twelve thousand
  if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) return Number(digits.replace(/[.,]/g, ''));
  if (/^\d+$/.test(digits)) return Number(digits);
  const n = Number(digits.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/* A moment as ISO text. Accepts ISO texts and Unix times in seconds or milliseconds. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let d: Date;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === 'string' && /^\d{9,13}$/.test(v.trim())) d = new Date(Number(v) < 1e12 ? Number(v) * 1000 : Number(v));
  else if (typeof v === 'string') d = new Date(v);
  else return null;
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const text = (v: unknown, max: number): string => (v === null || v === undefined ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v)).slice(0, max);

/* The forms under which an account may show up in a response: its handle without "@", its URL without protocol,
   and the last part of that URL. */
export function accountKeys(a: Pick<Account, 'handle' | 'url'>): string[] {
  const keys = new Set<string>();
  for (const raw of [a.handle, a.url]) {
    for (const k of keyForms(raw)) keys.add(k);
  }
  return [...keys];
}
function keyForms(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim().toLowerCase();
  if (!s) return [];
  const out = [s.replace(/^@/, '')];
  if (/^https?:\/\//.test(s) || s.includes('/')) {
    const bare = s
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
    out.push(bare);
    const last = bare.split('/').pop() || '';
    if (last) out.push(last.replace(/^@/, ''));
  }
  return out.filter(Boolean);
}

/* Fills an input template. A text that is exactly "{{handles}}" or "{{urls}}" becomes the list; inside a longer text
   {{handle}}, {{url}}, {{handles}} (comma separated) and {{urls}} are replaced in place. */
export function fillTemplate(template: Json, accounts: Pick<Account, 'handle' | 'url'>[]): Json {
  const handles = accounts.map(a => a.handle.trim().replace(/^@/, ''));
  const urls = accounts.map(a => a.url.trim()).filter(Boolean);
  const walk = (v: Json): Json => {
    if (typeof v === 'string') {
      if (v === '{{handles}}') return handles;
      if (v === '{{urls}}') return urls;
      return v
        .replaceAll('{{handles}}', handles.join(','))
        .replaceAll('{{urls}}', urls.join(','))
        .replaceAll('{{handle}}', handles[0] ?? '')
        .replaceAll('{{url}}', urls[0] ?? '');
    }
    if (Array.isArray(v)) {
      // a list holding only the placeholder is the list itself: ["{{handles}}"] -> ["a", "b"]
      if (v.length === 1 && (v[0] === '{{handles}}' || v[0] === '{{urls}}')) return v[0] === '{{handles}}' ? handles : urls;
      return v.map(walk);
    }
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(template);
}

/* Which account an item belongs to. With one account in the run every item is its own. */
function ownerOf(item: unknown, map: FieldMap, accounts: Account[], index: Map<string, Account>): Account | null {
  if (accounts.length === 1) return accounts[0];
  for (const form of keyForms(getPath(item, map.account_key))) {
    const hit = index.get(form);
    if (hit) return hit;
  }
  return null;
}

/* Turns the items of a collector's response into snapshot and post rows for the given accounts. */
export function normalizeItems(items: unknown, map: FieldMap, accounts: Account[], opt: { date: string; source: string; now: string }): Normalized {
  const list = Array.isArray(items) ? items : [];
  const index = new Map<string, Account>();
  for (const a of accounts) for (const k of accountKeys(a)) if (!index.has(k)) index.set(k, a);

  const byAccount = new Map<string, unknown[]>();
  for (const item of list) {
    if (!isObject(item)) continue;
    const owner = ownerOf(item, map, accounts, index);
    if (!owner) continue;
    if (!byAccount.has(owner.id)) byAccount.set(owner.id, []);
    byAccount.get(owner.id)!.push(item);
  }

  const snapshots: SnapshotRow[] = [];
  const posts: PostRow[] = [];
  const missing: Account[] = [];
  const cap = Math.max(0, Math.min(MAX_POSTS, Number.isInteger(map.max_posts) ? (map.max_posts as number) : 50));
  const postKind = map.item_kind === 'post';

  for (const a of accounts) {
    const own = byAccount.get(a.id) || [];
    const head = own[0];
    const snap: SnapshotRow = { account_id: a.id, date: opt.date, source: opt.source, collected_at: opt.now, extra: {} };
    let numbers = 0;
    for (const f of SNAPSHOT_FIELDS) {
      const n = head === undefined ? null : toCount(getPath(head, map.snapshot?.[f]));
      if (n !== null) {
        snap[f] = n;
        numbers++;
      }
    }
    for (const [k, p] of Object.entries(map.extra || {})) {
      const v = head === undefined ? undefined : getPath(head, p);
      if (v !== undefined && v !== null) snap.extra[k.slice(0, 60)] = typeof v === 'string' ? v.slice(0, 500) : v;
    }
    if (numbers) snapshots.push(snap);
    else missing.push(a);

    if (!map.post || !cap) continue;
    const raw = postKind ? own : head === undefined ? [] : getPath(head, map.posts_path);
    const seen = new Set<string>();
    for (const p of Array.isArray(raw) ? raw : []) {
      if (!isObject(p)) continue;
      const id = text(getPath(p, map.post.external_id), 200).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      posts.push({
        account_id: a.id,
        external_id: id,
        url: text(getPath(p, map.post.url), 1000),
        caption: text(getPath(p, map.post.caption), 5000),
        post_type: text(getPath(p, map.post.post_type), 40),
        posted_at: toIso(getPath(p, map.post.posted_at)),
        likes: toCount(getPath(p, map.post.likes)),
        comments: toCount(getPath(p, map.post.comments)),
        shares: toCount(getPath(p, map.post.shares)),
        views: toCount(getPath(p, map.post.views)),
        source: opt.source,
        collected_at: opt.now,
      });
      if (seen.size >= cap) break;
    }
  }
  return { snapshots, posts, missing };
}

/* A GA4 runReport response as one flat item: { activeUsers: 123, screenPageViews: 456 } (totals of the first row). */
export function ga4ReportToItem(report: unknown): Record<string, number> {
  const headers = getPath(report, 'metricHeaders');
  const values = getPath(report, 'rows.0.metricValues');
  const out: Record<string, number> = {};
  if (!Array.isArray(headers) || !Array.isArray(values)) return out;
  headers.forEach((h, i) => {
    const name = getPath(h, 'name');
    const n = Number(getPath(values[i], 'value'));
    if (typeof name === 'string' && Number.isFinite(n)) out[name] = n;
  });
  return out;
}

/* Today's date in a time zone, as YYYY-MM-DD. */
export function dateIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/* An error as a short message that is safe to store and show: secrets are removed and the text is cut. */
export function safeMessage(err: unknown, secrets: (string | undefined | null)[] = []): string {
  let msg: string;
  try {
    // whatever was thrown (an Error, a text, an object, nothing at all) ends up as a text
    msg = String(err instanceof Error ? err.message : typeof err === 'string' ? err : (JSON.stringify(err) ?? err));
  } catch {
    msg = 'unknown error';
  }
  for (const s of secrets) if (s && s.length >= 4) msg = msg.split(s).join('[redacted]');
  msg = msg.replace(/([?&](?:token|key|apikey|access_token)=)[^&\s"']+/gi, '$1[redacted]').replace(/(bearer\s+)[a-z0-9._~+/=-]{8,}/gi, '$1[redacted]');
  return (msg || 'unknown error').slice(0, 1000);
}

/* Compares two secrets without stopping at the first different character. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
