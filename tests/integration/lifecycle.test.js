import { describe, expect, it } from 'vitest';
import { admin, as, available, createWorkspaceFor, id, inviteIn, memberIdIn, newUser, okOf, query, user, world } from './helpers.js';

const n = (table, where) => query(`select count(*)::int as n from public.${table} where ${where}`)[0].n;

/* A throw-away workspace owned by a fresh user, with an admin and a member, and a row in every table. */
async function buildWorkspace() {
  const owner = await newUser('wsowner', 'Olga Owner');
  const ws = await createWorkspaceFor(owner.client, `Doomed ${world.run}`);
  const adminUser = user('adm');
  const memberUser = user('mem');
  await inviteIn(owner.client, ws.workspace_id, { email: adminUser.email, name: adminUser.name, role: 'admin' });
  await inviteIn(owner.client, ws.workspace_id, { email: memberUser.email, name: memberUser.name, role: 'member' });
  expect(okOf(await as('adm').rpc('claim_invitations'))).toBe(1);
  expect(okOf(await as('mem').rpc('claim_invitations'))).toBe(1);
  const ids = {
    ws: ws.workspace_id,
    ownerMember: ws.member_id,
    team: id(),
    project: id(),
    task: id(),
    task2: id(),
    sub: id(),
    comment: id(),
    file: id(),
    event: id(),
    view: id(),
    activity: id(),
  };
  const c = owner.client;
  okOf(await c.from('teams').insert({ id: ids.team, workspace_id: ids.ws, name: 't' }));
  okOf(await c.from('projects').insert({ id: ids.project, workspace_id: ids.ws, key: 'DOOM', name: 'doomed', created_by: owner.id }));
  const adminMember = memberIdIn(ids.ws, adminUser.id);
  const memberMember = memberIdIn(ids.ws, memberUser.id);
  okOf(await c.from('project_members').insert({ project_id: ids.project, member_id: memberMember }));
  okOf(await c.from('tasks').insert({ id: ids.task, project_id: ids.project, key: 'D-1', title: 'one', assignee_id: memberMember }));
  okOf(await c.from('tasks').insert({ id: ids.task2, project_id: ids.project, key: 'D-2', title: 'two' }));
  okOf(await c.from('subtasks').insert({ id: ids.sub, task_id: ids.task, title: 's' }));
  okOf(await c.from('task_dependencies').insert({ task_id: ids.task, depends_on_id: ids.task2 }));
  okOf(await c.from('files').insert({ id: ids.file, project_id: ids.project, task_id: ids.task, name: 'f.txt' }));
  okOf(await c.from('comments').insert({ id: ids.comment, task_id: ids.task, author_id: ids.ownerMember, body: 'hi @Mia Member' }));
  okOf(
    await c
      .from('activity')
      .insert({ id: ids.activity, workspace_id: ids.ws, actor_id: ids.ownerMember, verb: 'x', task_id: ids.task, project_id: ids.project }),
  );
  okOf(await c.from('events').insert({ id: ids.event, workspace_id: ids.ws, project_id: ids.project, title: 'e', event_date: '2026-01-01' }));
  okOf(await c.from('saved_views').insert({ id: ids.view, project_id: ids.project, name: 'v' }));
  okOf(await c.from('task_favorites').insert({ member_id: ids.ownerMember, task_id: ids.task }));
  okOf(await c.from('project_favorites').insert({ member_id: ids.ownerMember, project_id: ids.project }));
  return { owner, ids, adminMember, memberMember };
}

const WS_TABLES = [
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

describe.skipIf(!available)('deleting a workspace', () => {
  it('only the owner can: an Admin and a Member delete nothing', async () => {
    const { ids } = await buildWorkspace();
    expect((await as('adm').from('workspaces').delete().eq('id', ids.ws).select()).data ?? []).toEqual([]);
    expect((await as('mem').from('workspaces').delete().eq('id', ids.ws).select()).data ?? []).toEqual([]);
    expect((await as('b').from('workspaces').delete().eq('id', ids.ws).select()).data ?? []).toEqual([]);
    expect(n('workspaces', `id = '${ids.ws}'`)).toBe(1);
    expect(n('tasks', `workspace_id = '${ids.ws}'`)).toBe(2);
  });

  it('the owner deletes it and everything inside goes with it', async () => {
    const { owner, ids } = await buildWorkspace();
    // sanity: the workspace is full
    for (const t of WS_TABLES) expect(n(t, `workspace_id = '${ids.ws}'`), `${t} before`).toBeGreaterThan(0);
    const res = await owner.client.from('workspaces').delete().eq('id', ids.ws).select();
    expect(res.error, `delete answered: ${res.error?.message}`).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(n('workspaces', `id = '${ids.ws}'`)).toBe(0);
    for (const t of WS_TABLES) expect(n(t, `workspace_id = '${ids.ws}'`), `${t} after`).toBe(0);
    // the people who were in it are still there, with their other workspaces
    expect(okOf(await as('adm').from('workspaces').select('id').eq('id', ids.ws))).toEqual([]);
    expect(okOf(await as('adm').from('workspaces').select('id').eq('id', world.wsA))).toHaveLength(1);
    expect(n('profiles', `id = '${user('adm').id}'`)).toBe(1);
  });

  it('the owner can still delete the workspace after it was reassigned data by other members (members, notifications included)', async () => {
    const { owner, ids, memberMember } = await buildWorkspace();
    expect(n('notifications', `workspace_id = '${ids.ws}' and recipient_id = '${memberMember}'`)).toBeGreaterThan(0);
    const res = await owner.client.from('workspaces').delete().eq('id', ids.ws).select();
    expect(res.error, `delete answered: ${res.error?.message}`).toBeNull();
    expect(n('notifications', `workspace_id = '${ids.ws}'`)).toBe(0);
  });
});

describe.skipIf(!available)('deleting a task or a project cascades', () => {
  it('deleting a task removes its subtasks, dependencies (both directions), comments, activity and notifications, and detaches its files', async () => {
    const { owner, ids } = await buildWorkspace();
    const c = owner.client;
    // a dependency in the other direction too
    okOf(await c.from('task_dependencies').insert({ task_id: ids.task2, depends_on_id: ids.task }));
    expect(n('notifications', `task_id = '${ids.task}'`)).toBeGreaterThan(0);
    expect(n('task_favorites', `task_id = '${ids.task}'`)).toBe(1);
    const res = await c.from('tasks').delete().eq('id', ids.task).select();
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(n('subtasks', `task_id = '${ids.task}'`)).toBe(0);
    expect(n('task_dependencies', `task_id = '${ids.task}' or depends_on_id = '${ids.task}'`)).toBe(0);
    expect(n('comments', `task_id = '${ids.task}'`)).toBe(0);
    expect(n('activity', `task_id = '${ids.task}'`)).toBe(0);
    expect(n('notifications', `task_id = '${ids.task}'`)).toBe(0);
    expect(n('task_favorites', `task_id = '${ids.task}'`)).toBe(0);
    // the file stays in the project, just no longer attached
    expect(query(`select task_id, project_id from public.files where id = '${ids.file}'`)).toEqual([{ task_id: null, project_id: ids.project }]);
    // the other task and the project are untouched
    expect(n('tasks', `id = '${ids.task2}'`)).toBe(1);
    expect(n('projects', `id = '${ids.project}'`)).toBe(1);
  });

  it('deleting a project removes its tasks, files, events, saved views, project members and activity', async () => {
    const { owner, ids } = await buildWorkspace();
    const res = await owner.client.from('projects').delete().eq('id', ids.project).select();
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
    for (const [t, col] of [
      ['tasks', 'project_id'],
      ['files', 'project_id'],
      ['events', 'project_id'],
      ['saved_views', 'project_id'],
      ['project_members', 'project_id'],
      ['activity', 'project_id'],
      ['notifications', 'project_id'],
      ['project_favorites', 'project_id'],
    ]) {
      expect(n(t, `${col} = '${ids.project}'`), t).toBe(0);
    }
    expect(n('subtasks', `task_id in ('${ids.task}', '${ids.task2}')`)).toBe(0);
    expect(n('comments', `task_id = '${ids.task}'`)).toBe(0);
    // the workspace and its people survive
    expect(n('workspaces', `id = '${ids.ws}'`)).toBe(1);
    expect(n('members', `workspace_id = '${ids.ws}'`)).toBe(3);
  });

  it('removing an account keeps the work: the member row is deactivated, tasks stay', async () => {
    const { owner, ids } = await buildWorkspace();
    const ghost = await newUser('ghost', 'Gil Ghost');
    const mid = await inviteIn(owner.client, ids.ws, { email: ghost.email, name: 'Gil', role: 'member' });
    expect(okOf(await ghost.client.rpc('claim_invitations'))).toBe(1);
    okOf(await ghost.client.from('comments').insert({ id: id(), task_id: ids.task, author_id: mid, body: 'from gil' }));
    // deleting the auth user is an admin operation (service role); nothing else in the app does it
    const del = await admin().auth.admin.deleteUser(ghost.id);
    expect(del.error).toBeNull();
    expect(query(`select user_id, status from public.members where id = '${mid}'`)).toEqual([{ user_id: null, status: 'deactivated' }]);
    expect(n('comments', `task_id = '${ids.task}' and author_id = '${mid}'`)).toBe(1);
  });
});
