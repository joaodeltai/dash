/* Builds (and removes) the shared fixture the integration tests run against:

     workspace A   Ana (owner) · Adam (admin) · Mia (member) · Max (member) · Gus (guest)
     workspace B   Bea (owner), who has nothing to do with A

   Everything goes through the public API the way the app does it: users are created (confirmed) with the admin API,
   then authenticate with e-mail and password and use the publishable key. Workspace A is seeded with one row in every table. */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { list, psql, query } from './env.js';

export const PASSWORD = 'Passw0rd-it-2026!';
export const DOMAIN = 'dash-it.test';
const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const adminClient = (url, serviceKey) => createClient(url, serviceKey, AUTH_OPTS);
export const anonClient = (url, key) => createClient(url, key, AUTH_OPTS);
export const userClient = (url, key, token) => createClient(url, key, { ...AUTH_OPTS, global: { headers: { Authorization: `Bearer ${token}` } } });

const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

/* Creates a confirmed account and signs it in with e-mail and password. Retries when the auth service rate-limits sign-ins. */
export async function createUser(cfg, admin, { email, name }) {
  const created = must(
    await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } }),
    `create ${email}`,
  );
  const anon = anonClient(cfg.url, cfg.key);
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (!res.error) return { id: created.user.id, email, name, token: res.data.session.access_token };
    last = res.error;
    if (!/rate limit|too many/i.test(res.error.message)) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error(`sign in ${email}: ${last?.message}`);
}

export async function createWorkspaceAs(client, name) {
  return must(await client.rpc('create_workspace', { p_name: name, p_slug: null, p_color: null }), 'create_workspace');
}

/* Invites `email` into the workspace as the signed-in user (a pending member row). */
export async function invite(client, wsId, { email, name, role }) {
  const id = randomUUID();
  must(await client.from('members').insert({ id, workspace_id: wsId, email: email.toLowerCase(), name, role, status: 'invited' }), `invite ${email}`);
  return id;
}

export async function buildWorld(cfg, run) {
  const admin = adminClient(cfg.url, cfg.serviceKey);
  const mail = tag => `it-${run}-${tag}@${DOMAIN}`;
  const defs = {
    a: { name: 'Ana Owner', role: 'owner' },
    adm: { name: 'Adam Admin', role: 'admin' },
    mem: { name: 'Mia Member', role: 'member' },
    mem2: { name: 'Max Member', role: 'member' },
    gst: { name: 'Gus Guest', role: 'guest' },
    b: { name: 'Bea Outsider', role: 'owner' },
  };
  const users = {};
  for (const [tag, def] of Object.entries(defs)) users[tag] = { ...(await createUser(cfg, admin, { email: mail(tag), name: def.name })), role: def.role };
  const as = tag => userClient(cfg.url, cfg.key, users[tag].token);
  const A = as('a');
  const B = as('b');

  // workspace A: the owner invites everyone, each person claims the invitation on their own
  const wa = await createWorkspaceAs(A, `Alpha ${run}`);
  users.a.memberId = wa.member_id;
  for (const tag of ['adm', 'mem', 'mem2', 'gst']) {
    await invite(A, wa.workspace_id, { email: users[tag].email, name: users[tag].name, role: users[tag].role });
    const claimed = must(await as(tag).rpc('claim_invitations'), `claim ${tag}`);
    if (claimed !== 1) throw new Error(`claim_invitations for ${tag} returned ${claimed}`);
  }
  const members = query(`select id, user_id from public.members where workspace_id = '${wa.workspace_id}'`);
  for (const tag of ['adm', 'mem', 'mem2', 'gst']) users[tag].memberId = members.find(m => m.user_id === users[tag].id)?.id;

  // workspace B
  const wb = await createWorkspaceAs(B, `Beta ${run}`);
  users.b.memberId = wb.member_id;

  // seed workspace A with a row in every table
  const seed = { wsId: wa.workspace_id };
  const ws = wa.workspace_id;
  const me = users.a;
  const id = () => randomUUID();
  Object.assign(seed, {
    team: id(),
    project: id(),
    task1: id(),
    task2: id(),
    subtask: id(),
    file: id(),
    comment: id(),
    activity: id(),
    event: id(),
    view: id(),
  });
  const w = async (q, what) => must(await q, what);
  await w(A.from('teams').insert({ id: seed.team, workspace_id: ws, name: 'Seed team' }), 'seed team');
  await w(A.from('projects').insert({ id: seed.project, workspace_id: ws, key: 'SEED', name: 'Seed project', created_by: me.id }), 'seed project');
  await w(A.from('project_members').insert({ project_id: seed.project, member_id: users.mem.memberId, permission: 'Can edit' }), 'seed project member');
  await w(
    A.from('tasks').insert({ id: seed.task1, project_id: seed.project, key: 'SEED-1', title: 'Seed task 1', assignee_id: users.mem.memberId }),
    'seed task1',
  );
  await w(A.from('tasks').insert({ id: seed.task2, project_id: seed.project, key: 'SEED-2', title: 'Seed task 2' }), 'seed task2');
  await w(A.from('subtasks').insert({ id: seed.subtask, task_id: seed.task1, title: 'Seed subtask' }), 'seed subtask');
  await w(A.from('task_dependencies').insert({ task_id: seed.task1, depends_on_id: seed.task2 }), 'seed dependency');
  await w(
    A.from('files').insert({
      id: seed.file,
      project_id: seed.project,
      task_id: seed.task1,
      name: 'seed.txt',
      storage_path: `${ws}/${seed.project}/${seed.file}/seed.txt`,
      uploaded_by: me.memberId,
    }),
    'seed file',
  );
  await w(A.from('comments').insert({ id: seed.comment, task_id: seed.task1, author_id: me.memberId, body: 'Seed comment for @Mia Member' }), 'seed comment');
  await w(
    A.from('activity').insert({ id: seed.activity, workspace_id: ws, actor_id: me.memberId, verb: 'created', task_id: seed.task1, project_id: seed.project }),
    'seed activity',
  );
  await w(A.from('events').insert({ id: seed.event, workspace_id: ws, project_id: seed.project, title: 'Seed event', event_date: '2026-06-01' }), 'seed event');
  await w(A.from('saved_views').insert({ id: seed.view, project_id: seed.project, name: 'Seed view', config: { filters: [] } }), 'seed view');
  await w(A.from('task_favorites').insert({ member_id: me.memberId, task_id: seed.task1 }), 'seed task favorite');
  await w(A.from('project_favorites').insert({ member_id: me.memberId, project_id: seed.project }), 'seed project favorite');
  await w(
    A.from('member_state')
      .update({ state: { recentSearches: ['seed'] } })
      .eq('member_id', me.memberId),
    'seed member state',
  );
  seed.notification = query(`select id from public.notifications where workspace_id = '${ws}' and recipient_id = '${users.mem.memberId}' limit 1`)[0]?.id;

  return { run, url: cfg.url, key: cfg.key, serviceKey: cfg.serviceKey, users, wsA: ws, wsB: wb.workspace_id, seed };
}

/* ---------- cleanup ---------- */

async function purgeStorage(admin, prefix = '') {
  const { data, error } = await admin.storage.from('files').list(prefix, { limit: 1000 });
  if (error || !data) return;
  const files = [];
  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id) files.push(path);
    else await purgeStorage(admin, path);
  }
  if (files.length) await admin.storage.from('files').remove(files);
}

/* Removes everything created for the given users: storage objects, workspaces (cascade) and the accounts. */
export async function removeUsers(admin, userIds) {
  if (!userIds.length) return;
  const owned = query(`select id from public.workspaces where created_by in (${list(userIds)})`);
  for (const w of owned) await purgeStorage(admin, w.id);
  // as postgres there is no JWT, so the member guard trigger lets the cascade remove the owner rows too
  psql(`delete from public.workspaces where created_by in (${list(userIds)})`);
  for (const uid of userIds) await admin.auth.admin.deleteUser(uid);
}

/* Accounts left behind by an interrupted earlier run (same naming scheme, any run id). */
export async function removeLeftovers(admin, exceptRun) {
  const stale = [];
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if (/^it-[a-z0-9]+-[a-z0-9]+@dash-it\.test$/.test(u.email || '') && !u.email.startsWith(`it-${exceptRun}-`)) stale.push(u.id);
    if (data.users.length < 200) break;
  }
  await removeUsers(admin, stale);
  return stale.length;
}

/* Deletes every account (and what it owns) whose e-mail carries this run id. */
export async function removeRun(admin, run) {
  const ids = [];
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if ((u.email || '').startsWith(`it-${run}-`) && u.email.endsWith(`@${DOMAIN}`)) ids.push(u.id);
    if (data.users.length < 200) break;
  }
  await removeUsers(admin, ids);
}
