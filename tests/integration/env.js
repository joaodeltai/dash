/* Where the local Supabase lives and which keys to use.
   Nothing here is written to disk: the service role key is read at run time from the environment or from `supabase status`
   and only ever lives in memory. */
import { execFileSync, spawnSync } from 'node:child_process';

const DEFAULT_URL = 'http://127.0.0.1:55321';

export function resolveConfig() {
  let status = {};
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    try {
      // stdin is closed: the CLI may otherwise wait on it
      status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).toString());
    } catch {
      status = {};
    }
  }
  const url = (process.env.SUPABASE_URL || status.API_URL || DEFAULT_URL).replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || status.PUBLISHABLE_KEY || status.ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || status.SERVICE_ROLE_KEY || '';
  return { url, key, serviceKey };
}

export async function isReachable(url) {
  try {
    const res = await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(4000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/* The suite creates and deletes users and workspaces: refuse to run against anything that is not a local stack. */
export function isLocal(url) {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || process.env.ALLOW_REMOTE_INTEGRATION === '1';
}

/* ---------- direct SQL (ground truth) ----------
   In this local stack the service_role has no DML privileges on the public tables, so the REST API cannot be used to look at what is
   really stored. Verification reads and cleanup therefore go through psql inside the database container (as the postgres role). */
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_dash';

export function psql(statement) {
  return execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  })
    .toString()
    .trim();
}
export const dbAvailable = () =>
  spawnSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-tA', '-c', 'select 1'], { stdio: 'ignore', timeout: 15000 }).status === 0;

export const lit = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
export const list = values => values.map(lit).join(',');
/* Rows of a SELECT as an array of plain objects. */
export const query = select => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${select}) t`));
