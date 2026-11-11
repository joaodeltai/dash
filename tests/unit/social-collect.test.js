/* The social collector (supabase/functions/social-collect) without network or database: the pure helpers, and the
   whole collection against a stand-in database and a stand-in fetch. */
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  accountKeys,
  dateIn,
  fillTemplate,
  ga4ReportToItem,
  getPath,
  normalizeItems,
  safeMessage,
  sameSecret,
  toCount,
  toIso,
} from '../../supabase/functions/social-collect/normalize.ts';
import { collectAll } from '../../supabase/functions/social-collect/collect.ts';
import { googleAccessToken } from '../../supabase/functions/social-collect/providers.ts';

const TOKEN = 'unit-test-token-0123456789';
const acc = (id, platform, handle, url = '', ws = 'ws1') => ({ id, workspace_id: ws, platform, handle, url });
const OPT = { date: '2026-11-11', source: 'apify', now: '2026-11-11T09:00:00.000Z' };

const IG_MAP = {
  account_key: 'username',
  snapshot: { followers: 'followersCount', following: 'followsCount', posts_count: 'postsCount' },
  extra: { verified: 'verified' },
  posts_path: 'latestPosts',
  post: {
    external_id: 'id',
    url: 'url',
    caption: 'caption',
    post_type: 'type',
    posted_at: 'timestamp',
    likes: 'likesCount',
    comments: 'commentsCount',
    views: 'videoViewCount',
  },
};
const TT_MAP = {
  item_kind: 'post',
  account_key: 'authorMeta.name',
  snapshot: { followers: 'authorMeta.fans', following: 'authorMeta.following', likes: 'authorMeta.heart', posts_count: 'authorMeta.video' },
  post: {
    external_id: 'id',
    url: 'webVideoUrl',
    caption: 'text',
    posted_at: 'createTime',
    likes: 'diggCount',
    comments: 'commentCount',
    shares: 'shareCount',
    views: 'playCount',
  },
};
const igItems = [
  {
    username: 'Acme',
    followersCount: 1800,
    followsCount: 120,
    postsCount: 45,
    verified: true,
    latestPosts: [
      {
        id: 'p1',
        url: 'https://example.invalid/p/1',
        caption: 'First',
        type: 'Image',
        timestamp: '2026-11-09T12:00:00.000Z',
        likesCount: 100,
        commentsCount: 20,
      },
      {
        id: 'p2',
        url: 'https://example.invalid/p/2',
        caption: 'Second',
        type: 'Video',
        timestamp: '2026-11-10T12:00:00.000Z',
        likesCount: 300,
        commentsCount: 40,
        videoViewCount: 9000,
      },
      { id: 'p1', caption: 'duplicate of the first' },
      { caption: 'no id' },
    ],
  },
  { username: 'acme.br', followersCount: '2,500', followsCount: 10, postsCount: 7, latestPosts: [] },
  { username: 'stranger', followersCount: 999999 },
];

describe('helpers', () => {
  it('reads dotted paths', () => {
    const o = { a: { b: [{ c: 5 }, { c: 6 }] }, z: null };
    expect(getPath(o, 'a.b.1.c')).toBe(6);
    expect(getPath(o, 'a.b.x')).toBeUndefined();
    expect(getPath(o, 'z.k')).toBeUndefined();
    expect(getPath(o, 'missing.deep.path')).toBeUndefined();
    expect(getPath(o, '')).toBeUndefined();
    expect(getPath(o, undefined)).toBeUndefined();
  });

  it('reads counts written in different ways', () => {
    expect(toCount(1234)).toBe(1234);
    expect(toCount(12.6)).toBe(13);
    expect(toCount('12,345')).toBe(12345);
    expect(toCount('12.345')).toBe(12345);
    expect(toCount('1.234.567')).toBe(1234567);
    expect(toCount('1.2K')).toBe(1200);
    expect(toCount('3,4 mi')).toBe(3400000);
    expect(toCount('2M')).toBe(2000000);
    expect(toCount('0')).toBe(0);
    expect(toCount(-5)).toBeNull();
    expect(toCount('')).toBeNull();
    expect(toCount('abc')).toBeNull();
    expect(toCount(null)).toBeNull();
    expect(toCount(undefined)).toBeNull();
    expect(toCount(NaN)).toBeNull();
    expect(toCount({})).toBeNull();
  });

  it('reads moments as ISO', () => {
    expect(toIso('2026-11-10T12:00:00.000Z')).toBe('2026-11-10T12:00:00.000Z');
    expect(toIso(1794312000)).toBe(new Date(1794312000 * 1000).toISOString());
    expect(toIso(1794312000000)).toBe(new Date(1794312000000).toISOString());
    expect(toIso('1794312000')).toBe(new Date(1794312000 * 1000).toISOString());
    expect(toIso('not a date')).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso('')).toBeNull();
  });

  it('knows the forms an account can take in a response', () => {
    expect(accountKeys({ handle: '@Acme', url: '' })).toEqual(['acme']);
    expect(accountKeys({ handle: 'acme', url: 'https://www.Instagram.com/Acme/?hl=pt' })).toEqual([
      'acme',
      'https://www.instagram.com/acme/?hl=pt',
      'instagram.com/acme',
    ]);
    expect(accountKeys({ handle: 'https://www.youtube.com/@Channel', url: '' })).toEqual([
      'https://www.youtube.com/@channel',
      'youtube.com/@channel',
      'channel',
    ]);
  });

  it('fills input templates', () => {
    const accounts = [
      { handle: '@acme', url: 'https://instagram.com/acme' },
      { handle: 'acme.br', url: '' },
    ];
    expect(fillTemplate({ usernames: '{{handles}}', resultsLimit: 12, nested: { urls: ['{{urls}}'] } }, accounts)).toEqual({
      usernames: ['acme', 'acme.br'],
      resultsLimit: 12,
      nested: { urls: ['https://instagram.com/acme'] },
    });
    expect(fillTemplate({ startUrls: [{ url: 'https://www.tiktok.com/@{{handle}}' }], q: 'from:{{handle}} OR {{handles}}' }, accounts)).toEqual({
      startUrls: [{ url: 'https://www.tiktok.com/@acme' }],
      q: 'from:acme OR acme,acme.br',
    });
    expect(fillTemplate({ keep: [1, true, null] }, accounts)).toEqual({ keep: [1, true, null] });
  });

  it('gives the date in a time zone', () => {
    expect(dateIn('America/Sao_Paulo', new Date('2026-11-12T02:30:00Z'))).toBe('2026-11-11');
    expect(dateIn('America/Sao_Paulo', new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-12');
  });

  it('removes secrets from messages', () => {
    const msg = safeMessage(new Error(`GET https://api.example/v2/x?token=${TOKEN}&a=1 failed, header Bearer ${TOKEN}`), [TOKEN]);
    expect(msg).not.toContain(TOKEN);
    expect(msg).toContain('[redacted]');
    expect(safeMessage(new Error('Authorization: Bearer abcdefgh12345678 rejected'))).toBe('Authorization: Bearer [redacted] rejected');
    expect(safeMessage(new Error('x?access_token=abc123&y=2'))).toBe('x?access_token=[redacted]&y=2');
    expect(safeMessage('x'.repeat(5000)).length).toBe(1000);
  });

  it('compares secrets', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
  });

  it('flattens a GA4 report', () => {
    const report = { metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [{ metricValues: [{ value: '4321' }, { value: '98765' }] }] };
    expect(ga4ReportToItem(report)).toEqual({ activeUsers: 4321, screenPageViews: 98765 });
    expect(ga4ReportToItem({ metricHeaders: [{ name: 'activeUsers' }] })).toEqual({});
    expect(ga4ReportToItem(null)).toEqual({});
  });
});

describe('normalizeItems', () => {
  it('one item per account, posts inside the item', () => {
    const accounts = [acc('a1', 'instagram', '@acme'), acc('a2', 'instagram', 'ACME.BR'), acc('a3', 'instagram', 'nodata')];
    const n = normalizeItems(igItems, IG_MAP, accounts, OPT);
    expect(n.snapshots).toEqual([
      {
        account_id: 'a1',
        date: '2026-11-11',
        source: 'apify',
        collected_at: OPT.now,
        extra: { verified: true },
        followers: 1800,
        following: 120,
        posts_count: 45,
      },
      { account_id: 'a2', date: '2026-11-11', source: 'apify', collected_at: OPT.now, extra: {}, followers: 2500, following: 10, posts_count: 7 },
    ]);
    expect(n.missing.map(a => a.id)).toEqual(['a3']);
    expect(n.posts.map(p => [p.account_id, p.external_id])).toEqual([
      ['a1', 'p1'],
      ['a1', 'p2'],
    ]);
    expect(n.posts[1]).toEqual({
      account_id: 'a1',
      external_id: 'p2',
      url: 'https://example.invalid/p/2',
      caption: 'Second',
      post_type: 'Video',
      posted_at: '2026-11-10T12:00:00.000Z',
      likes: 300,
      comments: 40,
      shares: null,
      views: 9000,
      source: 'apify',
      collected_at: OPT.now,
    });
  });

  it('every item is a post that carries the account numbers', () => {
    const items = [
      {
        id: 'v1',
        text: 'One',
        webVideoUrl: 'https://example.invalid/v/1',
        createTime: 1794312000,
        diggCount: 50,
        commentCount: 5,
        shareCount: 2,
        playCount: 1000,
        authorMeta: { name: 'acme.tt', fans: 650, following: 3, heart: 9000, video: 12 },
      },
      {
        id: 'v2',
        text: 'Two',
        webVideoUrl: 'https://example.invalid/v/2',
        createTime: 1794398400,
        diggCount: 70,
        commentCount: 7,
        shareCount: 1,
        playCount: 2000,
        authorMeta: { name: 'acme.tt', fans: 650, following: 3, heart: 9000, video: 12 },
      },
      { id: 'x1', authorMeta: { name: 'other', fans: 1 } },
    ];
    const accounts = [acc('t1', 'tiktok', 'acme.tt'), acc('t2', 'tiktok', 'second')];
    const n = normalizeItems(items, TT_MAP, accounts, OPT);
    expect(n.snapshots).toEqual([
      { account_id: 't1', date: OPT.date, source: 'apify', collected_at: OPT.now, extra: {}, followers: 650, following: 3, likes: 9000, posts_count: 12 },
    ]);
    expect(n.missing.map(a => a.id)).toEqual(['t2']);
    expect(n.posts.map(p => [p.external_id, p.likes, p.comments, p.shares, p.views])).toEqual([
      ['v1', 50, 5, 2, 1000],
      ['v2', 70, 7, 1, 2000],
    ]);
    expect(n.posts[0].posted_at).toBe(new Date(1794312000 * 1000).toISOString());
  });

  it('a run with one account needs no account key', () => {
    const n = normalizeItems([{ whatever: 1, followersCount: 10 }], { snapshot: { followers: 'followersCount' } }, [acc('a1', 'instagram', 'acme')], OPT);
    expect(n.snapshots.map(s => [s.account_id, s.followers])).toEqual([['a1', 10]]);
    expect(n.posts).toEqual([]);
  });

  it('matches accounts by profile URL too', () => {
    const items = [{ channelUrl: 'https://www.youtube.com/@Beta', numberOfSubscribers: 4200 }];
    const accounts = [acc('y1', 'youtube', 'beta'), acc('y2', 'youtube', 'gamma', 'https://youtube.com/@gamma')];
    const n = normalizeItems(items, { account_key: 'channelUrl', snapshot: { followers: 'numberOfSubscribers' } }, accounts, OPT);
    expect(n.snapshots.map(s => s.account_id)).toEqual(['y1']);
    expect(n.missing.map(a => a.id)).toEqual(['y2']);
  });

  it('survives responses that are not what was expected', () => {
    const accounts = [acc('a1', 'instagram', 'acme')];
    for (const bad of [null, undefined, 'text', 42, {}, [null, 1, 'x'], [{ error: 'not found' }]]) {
      const n = normalizeItems(bad, IG_MAP, accounts, OPT);
      expect(n.snapshots).toEqual([]);
      expect(n.posts).toEqual([]);
      expect(n.missing.map(a => a.id)).toEqual(['a1']);
    }
  });

  it('limits how many posts are kept and how long texts are', () => {
    const posts = Array.from({ length: 150 }, (_, i) => ({ id: 'p' + i, caption: 'c'.repeat(9000) }));
    const items = [{ username: 'acme', followersCount: 1, latestPosts: posts }];
    const def = normalizeItems(items, IG_MAP, [acc('a1', 'instagram', 'acme')], OPT);
    expect(def.posts.length).toBe(50);
    expect(def.posts[0].caption.length).toBe(5000);
    expect(normalizeItems(items, { ...IG_MAP, max_posts: 500 }, [acc('a1', 'instagram', 'acme')], OPT).posts.length).toBe(100);
    expect(normalizeItems(items, { ...IG_MAP, max_posts: 0 }, [acc('a1', 'instagram', 'acme')], OPT).posts.length).toBe(0);
  });
});

/* ---------- the whole collection against stand-ins ---------- */

function fakeDb({ collectors, accounts, failTable }) {
  const writes = { social_snapshots: [], social_posts: [], social_collect_runs: [] };
  const calls = [];
  const from = table => {
    const filters = {};
    const q = {
      select: () => q,
      order: () => q,
      eq: (k, v) => ((filters[k] = v), q),
      upsert: (rows, opt) => {
        calls.push({ table, op: 'upsert', opt });
        const p =
          table === failTable ? { data: null, error: { message: `write to ${table} refused` } } : { data: rows.map((_, i) => ({ id: i })), error: null };
        if (!p.error) {
          const key = opt.onConflict.split(',');
          for (const r of rows) {
            const i = writes[table].findIndex(x => key.every(k => x[k] === r[k]));
            if (i >= 0) writes[table][i] = { ...writes[table][i], ...r };
            else writes[table].push(r);
          }
        }
        return { select: () => Promise.resolve(p) };
      },
      insert: row => {
        writes[table].push(row);
        return Promise.resolve({ error: null });
      },
      then: (ok, bad) => {
        const src = table === 'social_collectors' ? collectors : accounts;
        const data = src.filter(r => Object.entries(filters).every(([k, v]) => (k === 'enabled' || k === 'is_active' ? r[k] !== false : r[k] === v)));
        return Promise.resolve({ data, error: null }).then(ok, bad);
      },
    };
    return q;
  };
  return { from, writes, calls };
}

function fakeFetch(routes) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const actor = decodeURIComponent(String(url).match(/\/v2\/acts\/([^/]+)\//)?.[1] || '');
    const r = routes[actor];
    if (!r) return new Response(JSON.stringify({ error: { type: 'record-not-found', message: 'Actor was not found' } }), { status: 404 });
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(typeof r === 'function' ? r() : r), { status: 201 });
  };
  fn.seen = seen;
  return fn;
}

const ENV = { apifyToken: TOKEN, apifyBase: 'https://apify.invalid', ga4Base: 'https://ga4.invalid', timeZone: 'America/Sao_Paulo' };
const collector = (platform, actor, field_map, extra = {}) => ({
  id: 'c-' + platform,
  workspace_id: 'ws1',
  platform,
  provider: 'apify',
  actor,
  input_template: { usernames: '{{handles}}' },
  field_map,
  batch: true,
  timeout_secs: 60,
  enabled: true,
  ...extra,
});
const ACCOUNTS = [
  acc('a1', 'instagram', 'acme'),
  acc('a2', 'instagram', 'acme.br'),
  acc('t1', 'tiktok', 'acme.tt'),
  acc('y1', 'youtube', 'beta'),
  acc('s1', 'substack', 'acme'),
];
const ttItems = [{ id: 'v1', text: 'One', diggCount: 5, authorMeta: { name: 'acme.tt', fans: 650 } }];

describe('collectAll', () => {
  const collectors = () => [
    collector('instagram', 'apify/instagram-profile-scraper', IG_MAP),
    collector('tiktok', 'clockworks/tiktok-scraper', TT_MAP),
    collector('youtube', 'someone/broken-actor', { snapshot: { followers: 'subs' } }),
  ];
  const routes = () => ({ 'apify~instagram-profile-scraper': igItems, 'clockworks~tiktok-scraper': ttItems });

  it('a failing platform is recorded as an error and does not stop the others', async () => {
    const db = fakeDb({ collectors: collectors(), accounts: ACCOUNTS });
    const fetch = fakeFetch(routes());
    const { runs } = await collectAll(db, ENV, fetch);
    const by = Object.fromEntries(runs.map(r => [r.platform, r]));
    expect(Object.keys(by).sort()).toEqual(['instagram', 'tiktok', 'youtube']); // substack has no collector: left alone
    expect(by.instagram).toMatchObject({ status: 'success', message: '', accounts_total: 2, accounts_ok: 2, snapshots_written: 2, posts_written: 2 });
    expect(by.tiktok).toMatchObject({ status: 'success', accounts_total: 1, accounts_ok: 1, snapshots_written: 1, posts_written: 1 });
    expect(by.youtube).toMatchObject({ status: 'error', accounts_ok: 0, snapshots_written: 0, posts_written: 0 });
    expect(by.youtube.message).toBe('actor someone/broken-actor failed (HTTP 404): Actor was not found');
    expect(db.writes.social_snapshots.map(s => [s.account_id, s.followers]).sort()).toEqual([
      ['a1', 1800],
      ['a2', 2500],
      ['t1', 650],
    ]);
    expect(db.writes.social_collect_runs.map(r => [r.platform, r.status]).sort()).toEqual([
      ['instagram', 'success'],
      ['tiktok', 'success'],
      ['youtube', 'error'],
    ]);
    expect(db.calls.filter(c => c.table === 'social_snapshots').every(c => c.opt.onConflict === 'account_id,date')).toBe(true);
    expect(db.calls.filter(c => c.table === 'social_posts').every(c => c.opt.onConflict === 'account_id,external_id')).toBe(true);
  });

  it('sends the token in a header, never in the address, and fills the input from the template', async () => {
    const db = fakeDb({ collectors: collectors(), accounts: ACCOUNTS });
    const fetch = fakeFetch(routes());
    await collectAll(db, ENV, fetch);
    expect(fetch.seen.length).toBe(3);
    for (const call of fetch.seen) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
    const ig = fetch.seen.find(c => c.url.includes('instagram'));
    expect(ig.url).toBe('https://apify.invalid/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?timeout=60&clean=true&format=json');
    expect(ig.body).toEqual({ usernames: ['acme', 'acme.br'] });
    expect(JSON.stringify(db.writes)).not.toContain(TOKEN);
  });

  it('running twice on the same day keeps one snapshot per account and updates the numbers', async () => {
    const db = fakeDb({ collectors: collectors(), accounts: ACCOUNTS });
    let followers = 1800;
    const live = { ...routes(), 'apify~instagram-profile-scraper': () => [{ ...igItems[0], followersCount: followers }, igItems[1]] };
    await collectAll(db, ENV, fakeFetch(live));
    followers = 1850;
    await collectAll(db, ENV, fakeFetch(live));
    expect(db.writes.social_snapshots.length).toBe(3);
    expect(db.writes.social_posts.length).toBe(3);
    expect(db.writes.social_snapshots.find(s => s.account_id === 'a1').followers).toBe(1850);
    expect(db.writes.social_collect_runs.length).toBe(6);
  });

  it('swapping the actor is a change to the collector row only', async () => {
    const rows = collectors();
    rows[2] = { ...rows[2], actor: 'streamers/youtube-scraper', field_map: { snapshot: { followers: 'numberOfSubscribers' } } };
    const db = fakeDb({ collectors: rows, accounts: ACCOUNTS });
    const fetch = fakeFetch({ ...routes(), 'streamers~youtube-scraper': [{ numberOfSubscribers: 4200 }] });
    const { runs } = await collectAll(db, ENV, fetch);
    expect(runs.find(r => r.platform === 'youtube')).toMatchObject({ status: 'success', accounts_ok: 1 });
    expect(fetch.seen.some(c => c.url.includes('/v2/acts/streamers~youtube-scraper/'))).toBe(true);
    expect(fetch.seen.some(c => c.url.includes('broken-actor'))).toBe(false);
  });

  it('reports a platform as partial when only some accounts come back', async () => {
    const db = fakeDb({
      collectors: [collector('instagram', 'apify/instagram-profile-scraper', IG_MAP)],
      accounts: [...ACCOUNTS, acc('a3', 'instagram', 'ghost')],
    });
    const { runs } = await collectAll(db, ENV, fakeFetch(routes()));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'partial', accounts_total: 3, accounts_ok: 2, message: 'no numbers returned for ghost' });
  });

  it('one run per account when the collector is not batched', async () => {
    const c = collector('instagram', 'apify/instagram-profile-scraper', IG_MAP, { batch: false, input_template: { username: '{{handle}}' } });
    const db = fakeDb({ collectors: [c], accounts: ACCOUNTS });
    const fetch = fakeFetch(routes());
    const { runs } = await collectAll(db, ENV, fetch);
    expect(fetch.seen.map(s => s.body)).toEqual([{ username: 'acme' }, { username: 'acme.br' }]);
    // each run answers for its own account: the first item of the response is taken as that account's
    expect(runs[0]).toMatchObject({ status: 'success', accounts_ok: 2 });
  });

  it('a network failure, a missing token and a refused write all end as an error row, not as an exception', async () => {
    const one = [collector('instagram', 'apify/instagram-profile-scraper', IG_MAP)];
    const down = await collectAll(
      fakeDb({ collectors: one, accounts: ACCOUNTS }),
      ENV,
      fakeFetch({ 'apify~instagram-profile-scraper': new Error(`connect failed for token ${TOKEN}`) }),
    );
    expect(down.runs[0].status).toBe('error');
    expect(down.runs[0].message).toContain('could not be reached');
    expect(down.runs[0].message).not.toContain(TOKEN);

    const noToken = await collectAll(fakeDb({ collectors: one, accounts: ACCOUNTS }), { ...ENV, apifyToken: undefined }, fakeFetch(routes()));
    expect(noToken.runs[0]).toMatchObject({ status: 'error', message: 'APIFY_TOKEN is not set' });

    const db = fakeDb({ collectors: one, accounts: ACCOUNTS, failTable: 'social_snapshots' });
    const refused = await collectAll(db, ENV, fakeFetch(routes()));
    expect(refused.runs[0]).toMatchObject({ status: 'error', accounts_ok: 0, message: 'saving snapshots: write to social_snapshots refused' });
    expect(db.writes.social_collect_runs).toHaveLength(1);
  });

  it('narrows the collection to a platform and skips disabled collectors and inactive accounts', async () => {
    const rows = collectors();
    rows[1] = { ...rows[1], enabled: false };
    const accounts = ACCOUNTS.map(a => (a.id === 'a2' ? { ...a, is_active: false } : a));
    const all = await collectAll(fakeDb({ collectors: rows, accounts }), ENV, fakeFetch(routes()));
    expect(all.runs.map(r => r.platform).sort()).toEqual(['instagram', 'youtube']);
    expect(all.runs.find(r => r.platform === 'instagram').accounts_total).toBe(1);
    const only = await collectAll(fakeDb({ collectors: rows, accounts }), ENV, fakeFetch(routes()), { platform: 'instagram' });
    expect(only.runs.map(r => r.platform)).toEqual(['instagram']);
  });
});

describe('GA4', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    client_email: 'collector@project.iam.gserviceaccount.invalid',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: 'https://oauth.invalid/token',
  };

  it('signs the token request with the service account key', async () => {
    let assertion = '';
    const fetch = async (url, init) => {
      expect(String(url)).toBe('https://oauth.invalid/token');
      assertion = init.body.get('assertion');
      return new Response(JSON.stringify({ access_token: 'ya29.fake' }), { status: 200 });
    };
    const token = await googleAccessToken({ fetch, account, scope: 'https://www.googleapis.com/auth/analytics.readonly', now: 1794312000000 });
    expect(token).toBe('ya29.fake');
    const [h, p, s] = assertion.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url'))).toEqual({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth.invalid/token',
      iat: 1794312000,
      exp: 1794315600,
    });
    expect(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('collects a website from GA4 and keeps other platforms going when GA4 fails', async () => {
    const ga = {
      id: 'c-web',
      workspace_id: 'ws1',
      platform: 'website',
      provider: 'ga4',
      actor: '',
      input_template: {},
      field_map: { snapshot: { followers: 'activeUsers', views: 'screenPageViews' } },
      batch: true,
      timeout_secs: 30,
      enabled: true,
    };
    const ig = collector('instagram', 'apify/instagram-profile-scraper', IG_MAP);
    const accounts = [acc('w1', 'website', '123456789'), acc('w2', 'website', 'not-a-property'), acc('a1', 'instagram', 'acme')];
    const fetch = async (url, init) => {
      const u = String(url);
      if (u === 'https://oauth.invalid/token') return new Response(JSON.stringify({ access_token: 'ya29.fake' }), { status: 200 });
      if (u === 'https://ga4.invalid/v1beta/properties/123456789:runReport') {
        expect(init.headers.Authorization).toBe('Bearer ya29.fake');
        expect(JSON.parse(init.body).metrics.map(m => m.name)).toEqual(['activeUsers', 'sessions', 'screenPageViews']);
        return new Response(
          JSON.stringify({
            metricHeaders: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
            rows: [{ metricValues: [{ value: '4321' }, { value: '6000' }, { value: '98765' }] }],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/v2/acts/apify~instagram-profile-scraper/')) return new Response(JSON.stringify([igItems[0]]), { status: 201 });
      return new Response('{}', { status: 404 });
    };
    const db = fakeDb({ collectors: [ga, ig], accounts });
    const ok = await collectAll(db, { ...ENV, ga4ServiceAccount: JSON.stringify(account) }, fetch);
    const web = ok.runs.find(r => r.platform === 'website');
    expect(web).toMatchObject({ status: 'partial', accounts_total: 2, accounts_ok: 1 });
    expect(web.message).toBe('not-a-property: "not-a-property" is not a GA4 property id (digits only)');
    expect(db.writes.social_snapshots.find(s => s.account_id === 'w1')).toMatchObject({ followers: 4321, views: 98765, source: 'ga4' });

    const noKey = await collectAll(fakeDb({ collectors: [ga, ig], accounts }), ENV, fetch);
    expect(noKey.runs.find(r => r.platform === 'website')).toMatchObject({ status: 'error' });
    expect(noKey.runs.find(r => r.platform === 'website').message).toContain('GA4_SERVICE_ACCOUNT_JSON is not set');
    expect(noKey.runs.find(r => r.platform === 'instagram')).toMatchObject({ status: 'success' });
  });
});
