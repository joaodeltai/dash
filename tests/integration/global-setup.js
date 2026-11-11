import { randomBytes } from 'node:crypto';
import { dbAvailable, isLocal, isReachable, resolveConfig } from './env.js';
import { adminClient, buildWorld, removeLeftovers, removeRun } from './world.js';

/* Runs once before the integration files: checks the local Supabase, builds the shared fixture and hands it to the workers
   with provide('world', ...). When the stack is not reachable the value is null and every test file skips itself. */
export default async function setup({ provide }) {
  const cfg = resolveConfig();
  const skip = reason => {
    console.warn(
      `\n[integration] SKIPPED: ${reason}\n[integration] Start the local stack with \`supabase start\` (API ${cfg.url}) and run \`npm run test:integration\` again.\n`,
    );
    provide('world', null);
    provide('skipReason', reason);
  };
  if (!(await isReachable(cfg.url))) return skip(`local Supabase is not reachable at ${cfg.url}`);
  if (!isLocal(cfg.url)) return skip(`${cfg.url} is not a local address (set ALLOW_REMOTE_INTEGRATION=1 to override; the suite creates and deletes users)`);
  if (!cfg.key || !cfg.serviceKey)
    return skip(
      'could not read the publishable and service role keys (set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY, or run where `supabase status` works)',
    );

  if (!dbAvailable())
    return skip('cannot run psql inside the database container (docker exec supabase_db_dash psql ...); set SUPABASE_DB_CONTAINER if it has another name');

  const run = randomBytes(4).toString('hex');
  const admin = adminClient(cfg.url, cfg.serviceKey);
  try {
    await removeLeftovers(admin, run);
    provide('world', await buildWorld(cfg, run));
    provide('skipReason', '');
  } catch (e) {
    await removeRun(admin, run).catch(() => {});
    throw e;
  }
  return async () => {
    await removeRun(admin, run);
  };
}
