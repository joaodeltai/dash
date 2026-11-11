/* Helpers shared by the integration test files. Fixture users are named by tag:
   'a' owner · 'adm' admin · 'mem' / 'mem2' members · 'gst' guest (all in workspace A) · 'b' owner of the unrelated workspace B. */
import { expect, inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import { list, lit, psql, query } from './env.js';
import { adminClient, anonClient, createUser, createWorkspaceAs, invite, userClient } from './world.js';

export const world = inject('world');
export const available = !!world;
export const skipReason = inject('skipReason');

export const ALL_TABLES = [
  'profiles',
  'workspaces',
  'teams',
  'members',
  'member_state',
  'projects',
  'project_members',
  'tasks',
  'subtasks',
  'task_dependencies',
  'files',
  'comments',
  'activity',
  'notifications',
  'events',
  'saved_views',
  'task_favorites',
  'project_favorites',
];

export const id = () => randomUUID();
export const tag = () => Math.random().toString(36).slice(2, 8);

const cache = new Map();
export function as(name) {
  if (!cache.has(name)) cache.set(name, userClient(world.url, world.key, world.users[name].token));
  return cache.get(name);
}
export const user = name => world.users[name];
export const memberId = name => world.users[name].memberId;
export const anon = () => anonClient(world.url, world.key);
export const admin = () => adminClient(world.url, world.serviceKey);
/* Client for an account made inside a test (it has its own token). */
export const clientWithToken = token => userClient(world.url, world.key, token);

/* ---------- assertions ---------- */
export const okOf = (res, what = 'request') => {
  expect(res.error, `${what}: ${res.error?.message}`).toBeNull();
  return res.data;
};
/* The database refused the statement (RLS violation, privilege error, trigger exception, constraint). */
export const denied = (res, code) => {
  expect(res.error, 'expected an error but the request succeeded').toBeTruthy();
  if (code) expect(res.error.code).toBe(code);
  return res.error;
};
/* The statement ran but touched nothing (what RLS does to rows the caller cannot see or change). */
export const touchedNothing = res => {
  expect(res.error, res.error?.message).toBeNull();
  expect(res.data ?? []).toEqual([]);
};

/* ---------- builders (the way the app writes: no workspace_id on child rows, ids made on the client) ---------- */
export async function newProject(who, over = {}) {
  const pid = over.id || id();
  const row = { id: pid, workspace_id: world.wsA, key: 'T' + tag().toUpperCase().slice(0, 5), name: 'Project ' + tag(), created_by: user(who).id, ...over.row };
  okOf(await as(who).from('projects').insert(row), `create project as ${who}`);
  return pid;
}

export async function newTask(who, project, over = {}) {
  const tid = over.id || id();
  okOf(
    await as(who)
      .from('tasks')
      .insert({ id: tid, project_id: project, key: 'T-' + tag(), title: 'Task ' + tag(), ...over.row }),
    `create task as ${who}`,
  );
  return tid;
}

export async function addProjectMember(who, project, member, permission = null) {
  okOf(
    await as(who)
      .from('project_members')
      .insert({ project_id: project, member_id: memberId(member), permission }),
    `add ${member} to project`,
  );
}

export async function newComment(who, task, body = 'hello') {
  const cid = id();
  okOf(
    await as(who)
      .from('comments')
      .insert({ id: cid, task_id: task, author_id: memberId(who), body }),
    `create comment as ${who}`,
  );
  return cid;
}

/* Rows as the database really stores them (no RLS), straight from SQL. */
export function rowsOf(table, filter = {}) {
  const where = Object.entries(filter)
    .map(([k, v]) => `${k} = ${lit(v)}`)
    .join(' and ');
  return query(`select * from public.${table}${where ? ' where ' + where : ''}`);
}
export const count = (table, filter = {}) => rowsOf(table, filter).length;

/* Runs a statement as postgres: for what the API cannot do (un-confirm an account) and for minimal reproductions. */
export { psql as sql, query, lit, list };

/* A brand new confirmed account (it can sign in with e-mail and password). Removed with the rest of the run's accounts at the end. */
export async function newUser(label, name = 'Test Person') {
  const created = await createUser({ url: world.url, key: world.key }, admin(), { email: `it-${world.run}-${label}-${tag()}@dash-it.test`, name });
  return { ...created, client: clientWithToken(created.token) };
}
/* `who` (a fixture tag) invites an e-mail into workspace A. Returns the new member row id. */
export const inviteAs = (who, { email, name = 'Invited Person', role = 'member' }, ws = world.wsA) => invite(as(who), ws, { email, name, role });

/* Workspace helpers for tests that build a workspace of their own. */
export const createWorkspaceFor = (client, name) => createWorkspaceAs(client, name);
export const inviteIn = (client, ws, spec) => invite(client, ws, spec);
export const memberIdIn = (ws, userId) => query(`select id from public.members where workspace_id = ${lit(ws)} and user_id = ${lit(userId)}`)[0]?.id;
