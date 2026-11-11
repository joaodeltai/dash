import { describe, expect, it } from 'vitest';
import { ALL_TABLES, as, available, denied, id, memberId, okOf, query, rowsOf, tag, user, world } from './helpers.js';

/* Workspace A is seeded with one row in every table. Bea (workspace B) must not be able to see or touch any of it. */
const seed = () => world.seed;
const spec = () => ({
  profiles: { key: 'id', value: user('a').id, patch: { full_name: 'hacked' } },
  workspaces: { key: 'id', value: world.wsA, patch: { name: 'hacked' } },
  teams: { key: 'id', value: seed().team, patch: { name: 'hacked' } },
  members: { key: 'id', value: memberId('a'), patch: { title: 'hacked' } },
  member_state: { key: 'member_id', value: memberId('a'), patch: { state: { hacked: true } } },
  projects: { key: 'id', value: seed().project, patch: { name: 'hacked' } },
  project_members: { key: 'project_id', value: seed().project, patch: { permission: 'Can view' } },
  tasks: { key: 'id', value: seed().task1, patch: { title: 'hacked' } },
  subtasks: { key: 'id', value: seed().subtask, patch: { title: 'hacked' } },
  task_dependencies: { key: 'task_id', value: seed().task1, patch: { depends_on_id: seed().task1 } },
  files: { key: 'id', value: seed().file, patch: { name: 'hacked' } },
  comments: { key: 'id', value: seed().comment, patch: { reactions: { x: [] } } },
  activity: { key: 'id', value: seed().activity, patch: { verb: 'hacked' } },
  notifications: { reader: 'mem', key: 'id', value: seed().notification, patch: { read_at: new Date().toISOString() } },
  events: { key: 'id', value: seed().event, patch: { title: 'hacked' } },
  saved_views: { key: 'id', value: seed().view, patch: { name: 'hacked' } },
  task_favorites: { key: 'task_id', value: seed().task1, patch: { task_id: seed().task2 } },
  project_favorites: { key: 'project_id', value: seed().project, patch: { project_id: id() } },
});
const fingerprint = (table, key, value) => query(`select md5(t::text) as h from public.${table} t where ${key} = '${value}' order by 1`).map(r => r.h);

describe.skipIf(!available)('isolation between workspaces', () => {
  it('the fixture covers every table', () => {
    expect(Object.keys(spec()).sort()).toEqual([...ALL_TABLES].sort());
    for (const [t, s] of Object.entries(spec())) expect(fingerprint(t, s.key, s.value).length, `${t} has a seeded row`).toBeGreaterThan(0);
  });

  describe.each(ALL_TABLES)('%s', table => {
    it('a legitimate member of workspace A sees the row (control)', async () => {
      const s = spec()[table];
      const rows = okOf(
        await as(s.reader || 'a')
          .from(table)
          .select('*')
          .eq(s.key, s.value),
      );
      expect(rows.length, 'owner of the workspace must see its own row').toBeGreaterThan(0);
    });

    it('user B does not read it, by key', async () => {
      const s = spec()[table];
      const res = await as('b').from(table).select('*').eq(s.key, s.value);
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    });

    it('user B does not read it when listing the whole table', async () => {
      const s = spec()[table];
      const rows = okOf(await as('b').from(table).select('*').limit(1000));
      expect(rows.some(r => r[s.key] === s.value)).toBe(false);
      expect(rows.some(r => r.workspace_id === world.wsA)).toBe(false);
    });

    it('user B cannot change it, by key', async () => {
      const s = spec()[table];
      const before = fingerprint(table, s.key, s.value);
      const res = await as('b').from(table).update(s.patch).eq(s.key, s.value).select();
      expect(res.data ?? []).toEqual([]);
      expect(fingerprint(table, s.key, s.value)).toEqual(before);
    });

    it('user B cannot delete it, by key', async () => {
      const s = spec()[table];
      const before = fingerprint(table, s.key, s.value);
      const res = await as('b').from(table).delete().eq(s.key, s.value).select();
      expect(res.data ?? []).toEqual([]);
      expect(fingerprint(table, s.key, s.value)).toEqual(before);
    });
  });

  describe('user B cannot create rows inside workspace A', () => {
    const attempts = () => ({
      teams: { workspace_id: world.wsA, name: 'planted' },
      members: { workspace_id: world.wsA, email: `planted-${tag()}@x.io`, name: 'planted', status: 'invited', role: 'member' },
      projects: { id: id(), workspace_id: world.wsA, key: 'PLANT', name: 'planted', created_by: user('b').id },
      project_members: { project_id: seed().project, member_id: memberId('b') },
      tasks: { project_id: seed().project, key: 'P-1', title: 'planted' },
      subtasks: { task_id: seed().task1, title: 'planted' },
      task_dependencies: { task_id: seed().task2, depends_on_id: seed().task1 },
      files: { project_id: seed().project, name: 'planted' },
      comments: { task_id: seed().task1, author_id: memberId('b'), body: 'planted' },
      activity: { workspace_id: world.wsA, actor_id: memberId('b'), verb: 'planted' },
      events: { workspace_id: world.wsA, title: 'planted', event_date: '2026-01-01' },
      saved_views: { project_id: seed().project, name: 'planted' },
      task_favorites: { member_id: memberId('b'), task_id: seed().task1 },
      project_favorites: { member_id: memberId('b'), project_id: seed().project },
      member_state: { member_id: memberId('a'), workspace_id: world.wsA, state: {} },
    });
    it.each([
      'teams',
      'members',
      'projects',
      'project_members',
      'tasks',
      'subtasks',
      'task_dependencies',
      'files',
      'comments',
      'activity',
      'events',
      'saved_views',
      'task_favorites',
      'project_favorites',
      'member_state',
    ])('%s', async table => {
      const before = query(`select count(*)::int as n from public.${table}`)[0].n;
      denied(await as('b').from(table).insert(attempts()[table]));
      expect(query(`select count(*)::int as n from public.${table}`)[0].n).toBe(before);
    });

    it('cannot insert with a forged workspace_id on a child row either', async () => {
      denied(await as('b').from('tasks').insert({ project_id: seed().project, workspace_id: world.wsB, key: 'P-2', title: 'planted' }));
      denied(
        await as('b')
          .from('comments')
          .insert({ task_id: seed().task1, workspace_id: world.wsB, author_id: memberId('b'), body: 'planted' }),
      );
    });
  });

  describe('user B cannot reach workspace A through relations or by moving its own rows', () => {
    it('embedding A rows through a foreign key returns nothing', async () => {
      const res = await as('b').from('tasks').select('id, projects(id, name), comments(id, body)').eq('id', seed().task1);
      expect(res.data ?? []).toEqual([]);
    });

    it('cannot move its own member row into workspace A', async () => {
      denied(await as('b').from('members').update({ workspace_id: world.wsA }).eq('id', memberId('b')));
      expect(rowsOf('members', { id: memberId('b') })[0].workspace_id).toBe(world.wsB);
    });

    it('cannot move its own project into workspace A by changing workspace_id', async () => {
      const pid = id();
      okOf(
        await as('b')
          .from('projects')
          .insert({ id: pid, workspace_id: world.wsB, key: 'MINE', name: 'mine', created_by: user('b').id }),
      );
      const res = await as('b').from('projects').update({ workspace_id: world.wsA }).eq('id', pid).select();
      expect(rowsOf('projects', { id: pid })[0].workspace_id, `update answered: ${JSON.stringify(res.error || res.data)}`).toBe(world.wsB);
      // and nothing of B's ended up listed in A's workspace
      expect(query(`select count(*)::int as n from public.projects where workspace_id = '${world.wsA}' and created_by = '${user('b').id}'`)[0].n).toBe(0);
    });

    it('cannot move its own team, event or favorites into workspace A', async () => {
      const team = id();
      okOf(await as('b').from('teams').insert({ id: team, workspace_id: world.wsB, name: 'mine' }));
      denied(await as('b').from('teams').update({ workspace_id: world.wsA }).eq('id', team));
      expect(rowsOf('teams', { id: team })[0].workspace_id).toBe(world.wsB);
      const ev = id();
      okOf(await as('b').from('events').insert({ id: ev, workspace_id: world.wsB, title: 'mine', event_date: '2026-01-01' }));
      denied(await as('b').from('events').update({ workspace_id: world.wsA }).eq('id', ev));
      expect(rowsOf('events', { id: ev })[0].workspace_id).toBe(world.wsB);
    });

    it('cannot attach its own task to a project of workspace A', async () => {
      const pid = id();
      okOf(
        await as('b')
          .from('projects')
          .insert({ id: pid, workspace_id: world.wsB, key: 'MINE', name: 'mine', created_by: user('b').id }),
      );
      const tid = id();
      okOf(await as('b').from('tasks').insert({ id: tid, project_id: pid, key: 'M-1', title: 'mine' }));
      denied(await as('b').from('tasks').update({ project_id: seed().project }).eq('id', tid));
      expect(rowsOf('tasks', { id: tid })[0].project_id).toBe(pid);
    });

    it('cannot make a task of its own depend on, or favorite, a task of workspace A', async () => {
      const pid = id();
      okOf(
        await as('b')
          .from('projects')
          .insert({ id: pid, workspace_id: world.wsB, key: 'MINE', name: 'mine', created_by: user('b').id }),
      );
      const tid = id();
      okOf(await as('b').from('tasks').insert({ id: tid, project_id: pid, key: 'M-1', title: 'mine' }));
      denied(await as('b').from('task_dependencies').insert({ task_id: tid, depends_on_id: seed().task1 }));
      denied(
        await as('b')
          .from('task_favorites')
          .insert({ member_id: memberId('b'), task_id: seed().task1 }),
      );
    });

    it('claim_invitations binds nothing for an account that was never invited', async () => {
      const claimed = okOf(await as('b').rpc('claim_invitations'));
      expect(claimed).toBe(0);
    });
  });
});
