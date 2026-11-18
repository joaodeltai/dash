import { createClient } from '@supabase/supabase-js';
import { parseKey, secretEquals } from './crypto.js';
import { fail } from './errors.js';
import { readSyncEnabled, sendingEnabled } from './gates.js';

export function serverConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const publishable = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
  return {
    url,
    publishable,
    secret: env.SUPABASE_SECRET_KEY || '',
    key: parseKey(env.EMAIL_CREDENTIALS_KEY),
    sendingOn: sendingEnabled(env),
    readOn: readSyncEnabled(env),
    cronSecret: env.CRON_SECRET || '',
  };
}

export function serviceDb(cfg) {
  if (!cfg.url || !cfg.secret) throw fail('missing_server_config');
  return createClient(cfg.url, cfg.secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function bearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : '';
}

export async function requireMember(cfg, token, workspaceId, { admin = false } = {}) {
  if (!cfg.url || !cfg.publishable) throw fail('missing_server_config');
  if (!token) throw fail('auth_required');
  const userClient = createClient(cfg.url, cfg.publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) throw fail('auth_required');
  const db = serviceDb(cfg);
  const { data: member, error: memberError } = await db
    .from('members')
    .select('id, role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (memberError) {
    const mapped = new Error('database_error');
    mapped.code = memberError.code === '42P01' || memberError.code === 'PGRST205' ? 'schema_missing' : 'database_error';
    throw mapped;
  }
  if (!member || member.status !== 'active' || !['owner', 'admin', 'member'].includes(member.role)) throw fail('forbidden');
  if (admin && !['owner', 'admin'].includes(member.role)) throw fail('admin_required');
  return { user: data.user, member, db };
}

export function cronAuthorized(cfg, token) {
  return !!(cfg.cronSecret && secretEquals(token, cfg.cronSecret));
}
