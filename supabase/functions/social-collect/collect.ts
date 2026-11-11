/* The collection itself: reads `social_collectors`, calls each source, writes snapshots and posts, and records one row
   per platform in `social_collect_runs`.

   Every platform runs on its own: a failure is caught, written to its run row with status "error" and a message, and
   never stops the others. Writes are upserts on (account_id, date) and (account_id, external_id), so running the
   collection twice on the same day leaves the same rows. */
import { dateIn, normalizeItems, safeMessage, fillTemplate, type Account, type FieldMap, type Json, type PostRow, type SnapshotRow } from './normalize.ts';
import { CollectError, googleAccessToken, parseServiceAccount, runApifyActor, runGa4Report, type Fetch } from './providers.ts';

export interface Collector {
  id: string;
  workspace_id: string;
  platform: string;
  provider: 'apify' | 'ga4';
  actor: string;
  input_template: Json;
  field_map: FieldMap;
  batch: boolean;
  timeout_secs: number;
}

export interface RunRow {
  workspace_id: string;
  platform: string;
  collector_id: string;
  status: 'success' | 'partial' | 'error';
  message: string;
  accounts_total: number;
  accounts_ok: number;
  snapshots_written: number;
  posts_written: number;
  started_at: string;
  finished_at: string;
}

export interface Env {
  apifyToken?: string;
  apifyBase: string;
  ga4ServiceAccount?: string;
  ga4Base: string;
  timeZone: string;
}

/* The slice of the Supabase client this module needs (so tests can pass a stand-in). */
export interface Db {
  from(table: string): any;
}

export interface Filters {
  workspaceId?: string;
  platform?: string;
}

const chunk = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

async function must<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await query;
  if (error) throw new CollectError(`${what}: ${error.message}`);
  return data as T;
}

/* GA4 access token, requested once per collection and only when a GA4 collector exists. */
function tokenOnce(env: Env, fetch: Fetch): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () =>
    (pending ??= googleAccessToken({
      fetch,
      account: parseServiceAccount(env.ga4ServiceAccount),
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
    }));
}

/* Items for a group of accounts from the collector's source. Throws CollectError on failure. */
async function fetchItems(c: Collector, accounts: Account[], env: Env, fetch: Fetch, ga4Token: () => Promise<string>): Promise<unknown[]> {
  if (c.provider === 'ga4') {
    return runGa4Report({
      fetch,
      base: env.ga4Base,
      accessToken: await ga4Token(),
      account: accounts[0],
      template: c.input_template,
      timeoutSecs: c.timeout_secs,
    });
  }
  if (!env.apifyToken) throw new CollectError('APIFY_TOKEN is not set');
  return runApifyActor({
    fetch,
    base: env.apifyBase,
    token: env.apifyToken,
    actor: c.actor,
    input: fillTemplate(c.input_template, accounts),
    timeoutSecs: c.timeout_secs,
  });
}

/* One platform of one workspace. Never throws: the outcome, good or bad, is the returned run row. */
export async function collectPlatform(
  db: Db,
  c: Collector,
  accounts: Account[],
  env: Env,
  fetch: Fetch,
  ga4Token: () => Promise<string>,
  now: () => Date = () => new Date(),
): Promise<RunRow> {
  const started = now();
  const secrets = [env.apifyToken, env.ga4ServiceAccount];
  const run: RunRow = {
    workspace_id: c.workspace_id,
    platform: c.platform,
    collector_id: c.id,
    status: 'error',
    message: '',
    accounts_total: accounts.length,
    accounts_ok: 0,
    snapshots_written: 0,
    posts_written: 0,
    started_at: started.toISOString(),
    finished_at: started.toISOString(),
  };
  const problems: string[] = [];
  try {
    const source = c.provider;
    const opt = { date: dateIn(env.timeZone, started), source, now: started.toISOString() };
    const snapshots: SnapshotRow[] = [];
    const posts: PostRow[] = [];
    // GA4 answers for one property at a time; an actor may take every account in one run (batch) or one run each.
    const groups = c.provider === 'ga4' || !c.batch ? accounts.map(a => [a]) : [accounts];
    const results = await Promise.allSettled(groups.map(g => fetchItems(c, g, env, fetch, ga4Token)));
    results.forEach((r, i) => {
      const group = groups[i];
      if (r.status === 'rejected') {
        problems.push(groups.length > 1 ? `${group[0].handle}: ${safeMessage(r.reason, secrets)}` : safeMessage(r.reason, secrets));
        return;
      }
      const n = normalizeItems(r.value, c.field_map || {}, group, opt);
      snapshots.push(...n.snapshots);
      posts.push(...n.posts);
      if (n.missing.length) problems.push(`no numbers returned for ${n.missing.map(a => a.handle).join(', ')}`);
    });

    for (const part of chunk(snapshots, 200)) {
      await must(db.from('social_snapshots').upsert(part, { onConflict: 'account_id,date' }).select('id'), 'saving snapshots');
      run.snapshots_written += part.length;
    }
    run.accounts_ok = snapshots.length;
    for (const part of chunk(posts, 200)) {
      await must(db.from('social_posts').upsert(part, { onConflict: 'account_id,external_id' }).select('id'), 'saving posts');
      run.posts_written += part.length;
    }
    run.status = run.accounts_ok === accounts.length && !problems.length ? 'success' : run.accounts_ok > 0 ? 'partial' : 'error';
  } catch (e) {
    problems.push(safeMessage(e, secrets));
    run.status = run.accounts_ok > 0 ? 'partial' : 'error';
  }
  run.message = problems.join(' · ').slice(0, 2000);
  if (run.status === 'error' && !run.message) run.message = 'no data returned';
  run.finished_at = now().toISOString();
  return run;
}

/* The whole collection: every enabled collector that has at least one active account. */
export async function collectAll(db: Db, env: Env, fetch: Fetch, filters: Filters = {}): Promise<{ date: string; runs: RunRow[] }> {
  let cq = db
    .from('social_collectors')
    .select('id, workspace_id, platform, provider, actor, input_template, field_map, batch, timeout_secs')
    .eq('enabled', true);
  if (filters.workspaceId) cq = cq.eq('workspace_id', filters.workspaceId);
  if (filters.platform) cq = cq.eq('platform', filters.platform);
  const collectors = await must<Collector[]>(cq, 'reading collectors');

  let aq = db.from('social_accounts').select('id, workspace_id, platform, handle, url').eq('is_active', true).order('created_at');
  if (filters.workspaceId) aq = aq.eq('workspace_id', filters.workspaceId);
  if (filters.platform) aq = aq.eq('platform', filters.platform);
  const accounts = await must<Account[]>(aq, 'reading accounts');

  const ga4Token = tokenOnce(env, fetch);
  const jobs = collectors
    .map(c => ({ c, accounts: accounts.filter(a => a.workspace_id === c.workspace_id && a.platform === c.platform) }))
    .filter(j => j.accounts.length);

  const secrets = [env.apifyToken, env.ga4ServiceAccount];
  // Each platform is collected and its outcome recorded as soon as it ends, without waiting for the slow ones:
  // if the function is cut short, the platforms that already finished have their row in the history.
  const runs = await Promise.all(
    jobs.map(async j => {
      let run: RunRow;
      try {
        run = await collectPlatform(db, j.c, j.accounts, env, fetch, ga4Token);
      } catch (e) {
        // collectPlatform is written not to throw; this keeps one platform from ever taking the others down
        const at = new Date().toISOString();
        run = {
          workspace_id: j.c.workspace_id,
          platform: j.c.platform,
          collector_id: j.c.id,
          status: 'error',
          message: safeMessage(e, secrets),
          accounts_total: j.accounts.length,
          accounts_ok: 0,
          snapshots_written: 0,
          posts_written: 0,
          started_at: at,
          finished_at: at,
        };
      }
      try {
        const { error } = await db.from('social_collect_runs').insert(run);
        if (error) console.error(`social-collect: could not record the ${run.platform} run: ${safeMessage(error.message, secrets)}`);
      } catch (e) {
        console.error(`social-collect: could not record the ${run.platform} run: ${safeMessage(e, secrets)}`);
      }
      return run;
    }),
  );
  return { date: dateIn(env.timeZone), runs };
}
