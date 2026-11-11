/* social-collect: daily collection of social media numbers.

   Called by pg_cron (see supabase/cron/social_collect_cron.sql) or by hand:

     POST /functions/v1/social-collect
     x-collect-secret: <SOCIAL_COLLECT_SECRET>
     { "workspace_id": "<uuid>", "platform": "instagram" }     both optional: narrow the collection

   Secrets (Supabase Edge Function secrets, never in the repository or the front end):
     SOCIAL_COLLECT_SECRET      shared secret the caller must send
     APIFY_TOKEN                Apify API token
     GA4_SERVICE_ACCOUNT_JSON   Google service account key (only when a GA4 collector exists)
   Optional: APIFY_API_BASE and GA4_API_BASE (to point at a stand-in during tests).

   The function is deployed with --no-verify-jwt: the caller is authorised by the shared secret, checked below. */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { collectAll, type Env } from './collect.ts';
import { safeMessage, sameSecret } from './normalize.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM = /^[a-z][a-z0-9_]{1,31}$/;

/* The project's secret key: the new SUPABASE_SECRET_KEYS dictionary when present, the legacy service role key otherwise. */
function secretKey(): string | undefined {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (keys && typeof keys.default === 'string' && keys.default) return keys.default;
  } catch {
    /* not set or not JSON: fall back to the legacy key */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'use POST' });

  const expected = Deno.env.get('SOCIAL_COLLECT_SECRET') || '';
  if (expected.length < 16) return json(500, { ok: false, error: 'SOCIAL_COLLECT_SECRET is not set (or is shorter than 16 characters)' });
  if (!sameSecret(req.headers.get('x-collect-secret') || '', expected)) return json(401, { ok: false, error: 'unauthorized' });

  const url = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) return json(500, { ok: false, error: 'SUPABASE_URL or the project secret key is not available to the function' });

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'body is not valid JSON' });
  }
  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : undefined;
  const platform = typeof body.platform === 'string' ? body.platform : undefined;
  if (workspaceId && !UUID.test(workspaceId)) return json(400, { ok: false, error: 'workspace_id is not a uuid' });
  if (platform && !PLATFORM.test(platform)) return json(400, { ok: false, error: 'platform is not valid' });

  const env: Env = {
    apifyToken: Deno.env.get('APIFY_TOKEN') || undefined,
    apifyBase: Deno.env.get('APIFY_API_BASE') || 'https://api.apify.com',
    ga4ServiceAccount: Deno.env.get('GA4_SERVICE_ACCOUNT_JSON') || undefined,
    ga4Base: Deno.env.get('GA4_API_BASE') || 'https://analyticsdata.googleapis.com',
    // fixed: the growth views count "today" in this same time zone
    timeZone: 'America/Sao_Paulo',
  };

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { date, runs } = await collectAll(db, env, fetch, { workspaceId, platform });
    // one line per platform, with counts only: no tokens, no payloads
    for (const r of runs)
      console.log(
        `social-collect ${r.platform} ${r.status} accounts=${r.accounts_ok}/${r.accounts_total} snapshots=${r.snapshots_written} posts=${r.posts_written}`,
      );
    return json(200, {
      ok: true,
      date,
      runs: runs.map(r => ({
        workspace_id: r.workspace_id,
        platform: r.platform,
        status: r.status,
        message: r.message,
        accounts_total: r.accounts_total,
        accounts_ok: r.accounts_ok,
        snapshots_written: r.snapshots_written,
        posts_written: r.posts_written,
      })),
    });
  } catch (e) {
    const message = safeMessage(e, [env.apifyToken, env.ga4ServiceAccount, key, expected]);
    console.error(`social-collect failed: ${message}`);
    return json(500, { ok: false, error: message });
  }
});
