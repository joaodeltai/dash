/* social-collect, end to end, on this machine: the real function served by `supabase functions serve`, the local
   database, and a stand-in for Apify, Google's token endpoint and the GA4 Data API. Nothing leaves the machine.

     node tests/functions/social-collect.local.js

   Needs the local Supabase stack running (`supabase start`) with the migrations applied. The stand-in's token, the
   shared secret and the throwaway service-account key are generated at run time and written to a temporary env
   file that is removed at the end. The rows it creates live in their own workspace, deleted at the end. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { dbAvailable, isLocal, lit, psql, query, resolveConfig } from '../integration/env.js';

const cfg = resolveConfig();
const FN_URL = `${cfg.url}/functions/v1/social-collect`;
const TOKEN = 'local-mock-token-' + crypto.randomBytes(12).toString('hex');
const SECRET = crypto.randomBytes(24).toString('hex');
const WS = crypto.randomUUID();
const id = () => crypto.randomUUID();
const A = { ig1: id(), ig2: id(), igOff: id(), tt: id(), yt: id(), web: id(), sub: id() };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : '  -> ' + detail}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- stand-in for Apify, Google OAuth and GA4 ---------- */
const seen = [];
let bump = 0; // grows on every call to the profile actor, so a second collection brings new numbers
const profiles = usernames =>
  usernames.map(u => ({
    username: u.toUpperCase(), // the real service does not always echo the case that was asked for
    followersCount: (u === 'acme' ? 1800 : 2500) + bump,
    followsCount: 120,
    postsCount: 45,
    latestPosts:
      u === 'acme'
        ? [
            {
              id: 'p1',
              url: 'https://example.invalid/p/1',
              caption: 'First post',
              type: 'Image',
              timestamp: '2026-11-09T12:00:00.000Z',
              likesCount: 100,
              commentsCount: 20,
            },
            {
              id: 'p2',
              url: 'https://example.invalid/p/2',
              caption: 'Second post',
              type: 'Video',
              timestamp: '2026-11-10T12:00:00.000Z',
              likesCount: 300 + bump,
              commentsCount: 40,
              videoViewCount: 9000,
            },
          ]
        : [],
  }));
const ACTORS = {
  'mock~instagram-profiles': body => [201, profiles(body.usernames || [])],
  'mock~instagram-alt': body => [201, profiles(body.usernames || [])],
  'mock~tiktok-videos': () => [
    201,
    [
      {
        id: 'v1',
        text: 'One',
        webVideoUrl: 'https://example.invalid/v/1',
        createTime: 1794312000,
        diggCount: 50,
        commentCount: 5,
        shareCount: 2,
        playCount: 1000,
        authorMeta: { name: 'acme.tt', fans: 650, heart: 9000, video: 12 },
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
        authorMeta: { name: 'acme.tt', fans: 650, heart: 9000, video: 12 },
      },
    ],
  ],
  'mock~youtube-channels': () => [201, [{ channelUrl: 'https://www.youtube.com/@beta', numberOfSubscribers: 4200 }]],
  'mock~always-fails': () => [400, { error: { type: 'run-failed', message: 'Actor run did not succeed (run status: FAILED)' } }],
};
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://mock');
    let body = {};
    try {
      body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    const entry = { path: url.pathname, query: url.search, auth: req.headers.authorization || '', body };
    seen.push(entry);
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const actor = url.pathname.match(/^\/v2\/acts\/([^/]+)\/run-sync-get-dataset-items$/)?.[1];
    if (actor) {
      if (entry.auth !== `Bearer ${TOKEN}`) return send(401, { error: { type: 'token-not-valid', message: 'bad token' } });
      const handler = ACTORS[decodeURIComponent(actor)];
      if (!handler) return send(404, { error: { type: 'record-not-found', message: 'Actor was not found' } });
      if (decodeURIComponent(actor).startsWith('mock~instagram')) bump += 50;
      const [status, payload] = handler(body);
      return send(status, payload);
    }
    if (url.pathname === '/token') return send(200, { access_token: 'ya29.local-mock', expires_in: 3600 });
    if (url.pathname === '/v1beta/properties/123456789:runReport') {
      if (entry.auth !== 'Bearer ya29.local-mock') return send(401, { error: { message: 'bad access token' } });
      return send(200, {
        metricHeaders: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        rows: [{ metricValues: [{ value: '4321' }, { value: '6000' }, { value: '98765' }] }],
      });
    }
    send(404, { error: { message: 'not found' } });
  });
});

/* ---------- database ---------- */
const sql = statement => psql(statement);
const seed = () => {
  const acct = (aid, brand, platform, handle, active = true) => `(${lit(aid)}, ${lit(WS)}, ${lit(brand)}, ${lit(platform)}, ${lit(handle)}, ${active})`;
  const coll = (platform, provider, actor, input, map) =>
    `(${lit(WS)}, ${lit(platform)}, ${lit(provider)}, ${lit(actor)}, ${lit(JSON.stringify(input))}::jsonb, ${lit(JSON.stringify(map))}::jsonb)`;
  const igMap = {
    account_key: 'username',
    snapshot: { followers: 'followersCount', following: 'followsCount', posts_count: 'postsCount' },
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
  const ttMap = {
    item_kind: 'post',
    account_key: 'authorMeta.name',
    snapshot: { followers: 'authorMeta.fans', likes: 'authorMeta.heart', posts_count: 'authorMeta.video' },
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
  sql(`insert into public.workspaces (id, name, slug) values (${lit(WS)}, 'Social collect check', ${lit('social-collect-' + WS.slice(0, 8))})`);
  sql(`insert into public.social_accounts (id, workspace_id, brand, platform, handle, is_active) values
    ${acct(A.ig1, 'Acme', 'instagram', '@acme')}, ${acct(A.ig2, 'Acme', 'instagram', 'acme.br')}, ${acct(A.igOff, 'Acme', 'instagram', 'paused', false)},
    ${acct(A.tt, 'Acme', 'tiktok', 'acme.tt')}, ${acct(A.yt, 'Beta', 'youtube', 'beta')}, ${acct(A.web, 'Acme', 'website', '123456789')},
    ${acct(A.sub, 'Acme', 'substack', 'acme')}`);
  sql(`insert into public.social_collectors (workspace_id, platform, provider, actor, input_template, field_map) values
    ${coll('instagram', 'apify', 'mock/instagram-profiles', { usernames: '{{handles}}', resultsLimit: 12 }, igMap)},
    ${coll('tiktok', 'apify', 'mock/tiktok-videos', { profiles: '{{handles}}' }, ttMap)},
    ${coll('youtube', 'apify', 'mock/always-fails', { startUrls: ['{{handles}}'] }, { account_key: 'channelUrl', snapshot: { followers: 'numberOfSubscribers' } })},
    ${coll('website', 'ga4', '', {}, { snapshot: { followers: 'activeUsers', views: 'screenPageViews' } })}`);
};
const cleanup = () => {
  try {
    sql(`delete from public.workspaces where id = ${lit(WS)}`);
  } catch (e) {
    console.error('cleanup failed:', e.message);
  }
};
const snapshots = () =>
  query(`select a.platform, a.handle, s.date::text as date, s.followers, s.following, s.posts_count, s.views, s.likes, s.source
         from public.social_snapshots s join public.social_accounts a on a.id = s.account_id where s.workspace_id = ${lit(WS)} order by a.platform, a.handle`);
const posts = () =>
  query(`select a.platform, p.external_id, p.caption, p.post_type, p.likes, p.comments, p.shares, p.views, p.engagement, p.url, p.source
         from public.social_posts p join public.social_accounts a on a.id = p.account_id where p.workspace_id = ${lit(WS)} order by a.platform, p.external_id`);
const runs = () =>
  query(
    `select platform, status, message, accounts_total, accounts_ok, snapshots_written, posts_written from public.social_collect_runs where workspace_id = ${lit(WS)} order by finished_at, platform`,
  );
const lastRuns = () => query(`select platform, status, message from public.social_last_runs where workspace_id = ${lit(WS)} order by platform`);

const call = async (body, headers = { 'x-collect-secret': SECRET }, method = 'POST') => {
  const res = await fetch(FN_URL, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};
const byPlatform = list => Object.fromEntries((list || []).map(r => [r.platform, r]));

async function main() {
  if (!isLocal(cfg.url)) throw new Error(`refusing to run against ${cfg.url}: this check only runs on a local stack`);
  if (!dbAvailable()) throw new Error('the local database container is not reachable: run `supabase start` first');
  if (query(`select 1 as ok from information_schema.tables where table_schema = 'public' and table_name = 'social_collectors'`).length !== 1)
    throw new Error('the social tables are missing in the local database: run `supabase migration up`');

  await new Promise(r => server.listen(0, '0.0.0.0', r));
  const port = server.address().port;
  const mock = `http://host.docker.internal:${port}`;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serviceAccount = {
    client_email: 'collector@local.invalid',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: `${mock}/token`,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-collect-'));
  const envFile = path.join(dir, 'functions.env');
  fs.writeFileSync(
    envFile,
    [
      `SOCIAL_COLLECT_SECRET=${SECRET}`,
      `APIFY_TOKEN=${TOKEN}`,
      `APIFY_API_BASE=${mock}`,
      `GA4_API_BASE=${mock}`,
      `GA4_SERVICE_ACCOUNT_JSON='${JSON.stringify(serviceAccount)}'`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  // `functions serve` starts the edge runtime container and may leave it running: stop it afterwards unless it was already up
  const RUNTIME = process.env.SUPABASE_EDGE_CONTAINER || 'supabase_edge_runtime_dash';
  const runtimeUp = () => spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', RUNTIME], { encoding: 'utf8' }).stdout.trim() === 'true';
  const wasUp = runtimeUp();
  let logs = '';
  const serve = spawn('supabase', ['functions', 'serve', 'social-collect', '--no-verify-jwt', '--env-file', envFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  serve.stdout.on('data', d => (logs += d));
  serve.stderr.on('data', d => (logs += d));
  const stop = () =>
    new Promise(resolve => {
      if (serve.exitCode !== null) return resolve();
      serve.once('exit', resolve);
      serve.kill('SIGINT');
      setTimeout(() => serve.kill('SIGKILL'), 15000).unref();
    });

  try {
    seed();
    // wait until the function answers (the first request also boots the worker)
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      if (serve.exitCode !== null) throw new Error('`supabase functions serve` exited:\n' + logs.slice(-1500));
      try {
        const r = await call({}, { 'x-collect-secret': 'wrong-secret' });
        ready = r.status === 401;
      } catch {
        ready = false;
      }
      if (!ready) await new Promise(r => setTimeout(r, 2000));
    }
    check('the function is served locally and answers', ready, logs.slice(-600));
    if (!ready) return;

    // --- who may call it
    check('a wrong secret is refused (401)', (await call({ workspace_id: WS }, { 'x-collect-secret': 'x'.repeat(48) })).status === 401);
    check('a missing secret is refused (401)', (await call({ workspace_id: WS }, {})).status === 401);
    check('GET is refused (405)', (await call(null, { 'x-collect-secret': SECRET }, 'GET')).status === 405);
    check('a malformed workspace id is refused (400)', (await call({ workspace_id: 'nope' })).status === 400);
    check('nothing was collected or written by refused calls', seen.length === 0 && snapshots().length === 0 && runs().length === 0);

    // --- first collection
    const first = await call({ workspace_id: WS });
    const r1 = byPlatform(first.json?.runs);
    check(
      'the collection answers 200 with one run per platform that has a collector',
      first.status === 200 && same(Object.keys(r1).sort(), ['instagram', 'tiktok', 'website', 'youtube']),
      JSON.stringify(first.json),
    );
    check('the response gives the date in America/Sao_Paulo', first.json?.date === today, `${first.json?.date} vs ${today}`);
    check(
      'instagram: success, both active accounts',
      r1.instagram?.status === 'success' && r1.instagram.accounts_ok === 2 && r1.instagram.accounts_total === 2 && r1.instagram.posts_written === 2,
      JSON.stringify(r1.instagram),
    );
    check('tiktok: success', r1.tiktok?.status === 'success' && r1.tiktok.accounts_ok === 1 && r1.tiktok.posts_written === 2, JSON.stringify(r1.tiktok));
    check('website (GA4): success', r1.website?.status === 'success' && r1.website.accounts_ok === 1, JSON.stringify(r1.website));
    check(
      'youtube (actor forced to fail): error with a message',
      r1.youtube?.status === 'error' && /mock\/always-fails failed \(HTTP 400\).*FAILED/.test(r1.youtube.message || ''),
      JSON.stringify(r1.youtube),
    );

    const s1 = snapshots();
    const snap = (platform, handle) => s1.find(s => s.platform === platform && s.handle === handle);
    check(
      'snapshots: one per collected account, none for the failed, paused or manual ones',
      same(
        s1.map(s => `${s.platform}/${s.handle}`),
        ['instagram/@acme', 'instagram/acme.br', 'tiktok/acme.tt', 'website/123456789'],
      ),
      JSON.stringify(s1),
    );
    check(
      'snapshot instagram/@acme has the numbers of the response',
      same(snap('instagram', '@acme'), {
        platform: 'instagram',
        handle: '@acme',
        date: today,
        followers: 1850,
        following: 120,
        posts_count: 45,
        views: null,
        likes: null,
        source: 'apify',
      }),
      JSON.stringify(snap('instagram', '@acme')),
    );
    check('snapshot instagram/acme.br', snap('instagram', 'acme.br')?.followers === 2550 && snap('instagram', 'acme.br')?.date === today);
    check(
      'snapshot tiktok/acme.tt (numbers carried by the posts)',
      same(snap('tiktok', 'acme.tt'), {
        platform: 'tiktok',
        handle: 'acme.tt',
        date: today,
        followers: 650,
        following: null,
        posts_count: 12,
        views: null,
        likes: 9000,
        source: 'apify',
      }),
      JSON.stringify(snap('tiktok', 'acme.tt')),
    );
    check(
      'snapshot website (GA4)',
      same(snap('website', '123456789'), {
        platform: 'website',
        handle: '123456789',
        date: today,
        followers: 4321,
        following: null,
        posts_count: null,
        views: 98765,
        likes: null,
        source: 'ga4',
      }),
      JSON.stringify(snap('website', '123456789')),
    );

    const p1 = posts();
    check(
      'posts: two for instagram, two for tiktok',
      same(
        p1.map(p => `${p.platform}/${p.external_id}`),
        ['instagram/p1', 'instagram/p2', 'tiktok/v1', 'tiktok/v2'],
      ),
      JSON.stringify(p1.map(p => p.external_id)),
    );
    const p2 = p1.find(p => p.external_id === 'p2');
    check(
      'post instagram/p2 has the numbers of the response',
      same(p2, {
        platform: 'instagram',
        external_id: 'p2',
        caption: 'Second post',
        post_type: 'Video',
        likes: 350,
        comments: 40,
        shares: null,
        views: 9000,
        engagement: 390,
        url: 'https://example.invalid/p/2',
        source: 'apify',
      }),
      JSON.stringify(p2),
    );
    const v1 = p1.find(p => p.external_id === 'v1');
    check(
      'post tiktok/v1',
      v1?.likes === 50 && v1.comments === 5 && v1.shares === 2 && v1.views === 1000 && v1.engagement === 57 && v1.caption === 'One',
      JSON.stringify(v1),
    );

    const h1 = runs();
    check(
      'history: four rows, the failure stored with status error and its message',
      h1.length === 4 &&
        h1.filter(r => r.status === 'success').length === 3 &&
        h1.find(r => r.platform === 'youtube')?.status === 'error' &&
        !!h1.find(r => r.platform === 'youtube')?.message,
      JSON.stringify(h1),
    );
    check('last run per platform shows the youtube error', lastRuns().find(r => r.platform === 'youtube')?.status === 'error');

    // --- what was sent out
    const actorCalls = seen.filter(s => s.path.startsWith('/v2/acts/'));
    check(
      'one actor run per platform',
      same(actorCalls.map(s => s.path.split('/')[3]).sort(), ['mock~always-fails', 'mock~instagram-profiles', 'mock~tiktok-videos']),
      JSON.stringify(actorCalls.map(s => s.path)),
    );
    check(
      'the token travels in the Authorization header',
      actorCalls.every(s => s.auth === `Bearer ${TOKEN}`),
    );
    check(
      'the token is never part of the address',
      seen.every(s => !(s.path + s.query).includes(TOKEN)),
    );
    check(
      'the input is built from the template, with active accounts only',
      same(seen.find(s => s.path.includes('mock~instagram-profiles'))?.body, { usernames: ['acme', 'acme.br'], resultsLimit: 12 }),
      JSON.stringify(seen.find(s => s.path.includes('mock~instagram-profiles'))?.body),
    );

    // --- same day, second collection: same rows, new numbers
    const second = await call({ workspace_id: WS });
    const s2 = snapshots();
    check('second collection of the day: 200', second.status === 200);
    check('second collection: still one snapshot per account', s2.length === 4, `${s2.length} rows`);
    check(
      'second collection: the numbers were replaced',
      s2.find(s => s.handle === '@acme')?.followers === 1900,
      String(s2.find(s => s.handle === '@acme')?.followers),
    );
    check(
      'second collection: posts are not duplicated and are updated',
      posts().length === 4 && posts().find(p => p.external_id === 'p2')?.likes === 400,
      JSON.stringify(posts().map(p => [p.external_id, p.likes])),
    );
    check('second collection: the history grows (eight rows)', runs().length === 8);

    // --- swapping an actor is one row
    seen.length = 0;
    sql(`update public.social_collectors set actor = 'mock/youtube-channels' where workspace_id = ${lit(WS)} and platform = 'youtube'`);
    const third = await call({ workspace_id: WS, platform: 'youtube' });
    check(
      'after changing one row the platform uses the new actor',
      seen.length === 1 && seen[0].path.includes('mock~youtube-channels'),
      JSON.stringify(seen.map(s => s.path)),
    );
    check(
      'and now succeeds',
      same(
        third.json?.runs?.map(r => [r.platform, r.status]),
        [['youtube', 'success']],
      ) && snapshots().find(s => s.platform === 'youtube')?.followers === 4200,
      JSON.stringify(third.json),
    );
    check('a platform filter collects only that platform', runs().length === 9);
    check('last run per platform: youtube is no longer in error', lastRuns().find(r => r.platform === 'youtube')?.status === 'success');
    sql(`update public.social_collectors set actor = 'mock/instagram-alt' where workspace_id = ${lit(WS)} and platform = 'instagram'`);
    seen.length = 0;
    await call({ workspace_id: WS, platform: 'instagram' });
    check('the same holds for instagram', seen.length === 1 && seen[0].path.includes('mock~instagram-alt'), JSON.stringify(seen.map(s => s.path)));

    // --- a platform that breaks in a different way: the service is unreachable
    sql(`update public.social_collectors set actor = 'missing/actor' where workspace_id = ${lit(WS)} and platform = 'tiktok'`);
    const fourth = await call({ workspace_id: WS });
    const r4 = byPlatform(fourth.json?.runs);
    check(
      'a missing actor fails alone while the others are written',
      r4.tiktok?.status === 'error' && r4.instagram?.status === 'success' && r4.youtube?.status === 'success' && r4.website?.status === 'success',
      JSON.stringify(fourth.json?.runs?.map(r => [r.platform, r.status])),
    );

    // --- nothing secret in the logs or in the database
    await new Promise(r => setTimeout(r, 1000));
    check('the function logs do not contain the token or the shared secret', !logs.includes(TOKEN) && !logs.includes(SECRET));
    check('the function logs one line per platform', /social-collect instagram success accounts=2\/2/.test(logs), logs.slice(-800));
    const stored = JSON.stringify([runs(), snapshots(), posts(), query(`select * from public.social_collectors where workspace_id = ${lit(WS)}`)]);
    check('the database does not contain the token or the shared secret', !stored.includes(TOKEN) && !stored.includes(SECRET));
  } finally {
    await stop();
    if (!wasUp && runtimeUp()) spawnSync('docker', ['stop', RUNTIME], { stdio: 'ignore' });
    cleanup();
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .catch(e => {
    check('the check ran to the end', false, e.message);
  })
  .finally(() => {
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  });
