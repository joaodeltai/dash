/* Runs once before the specs: checks that the local Supabase stack is usable (otherwise every test skips itself with the reason),
   hands the connection details to the workers through the environment, and removes accounts left behind by an interrupted run.
   The returned function runs at the very end and removes this run's accounts. */
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { dbAvailable, isLocal, isReachable, resolveConfig } from '../integration/env.js';
import { removeUsers } from '../integration/world.js';
import { DOMAIN, MAIL_URL } from './constants.js';

const OWN = new RegExp(`^e2e-[a-z0-9]+-[a-z0-9]+@${DOMAIN.replace(/\./g, '\\.')}$`);

async function accountsWhere(admin, match) {
  const ids = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if (match(u.email || '')) ids.push(u.id);
    if (data.users.length < 200) break;
  }
  return ids;
}

export default async function globalSetup() {
  const cfg = resolveConfig();
  const skip = reason => {
    process.env.E2E_SKIP_REASON = reason;
    console.warn(
      `\n[e2e] SKIPPED: ${reason}\n[e2e] Start the local stack with \`supabase start\` (API ${cfg.url}, mail ${MAIL_URL}) and run \`npm run test:e2e\` again.\n`,
    );
  };
  if (!(await isReachable(cfg.url))) return skip(`local Supabase is not reachable at ${cfg.url}`);
  if (!isLocal(cfg.url)) return skip(`${cfg.url} is not a local address (the suite creates and deletes users)`);
  if (!cfg.key || !cfg.serviceKey)
    return skip(
      'could not read the publishable and service role keys (set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY, or run where `supabase status` works)',
    );
  if (!dbAvailable())
    return skip('cannot run psql inside the database container (docker exec supabase_db_dash psql ...); set SUPABASE_DB_CONTAINER if it has another name');
  try {
    const res = await fetch(`${MAIL_URL}/api/v1/info`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    return skip(`the local mail inbox (Mailpit) is not reachable at ${MAIL_URL}`);
  }

  const run = randomBytes(3).toString('hex');
  Object.assign(process.env, { E2E_RUN: run, E2E_SUPABASE_URL: cfg.url, E2E_SUPABASE_KEY: cfg.key, E2E_SUPABASE_SERVICE_KEY: cfg.serviceKey });
  const admin = createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await removeUsers(admin, await accountsWhere(admin, email => OWN.test(email) && !email.startsWith(`e2e-${run}-`))).catch(() => {});

  return async () => {
    await removeUsers(admin, await accountsWhere(admin, email => OWN.test(email) && email.startsWith(`e2e-${run}-`))).catch(e =>
      console.warn('[e2e] cleanup failed:', e.message),
    );
  };
}
