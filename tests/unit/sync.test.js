import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_HOLD_MS, classify, createSync } from '../../src/data/sync.js';
import { TABLES, flatten, normalize } from '../../src/data/mappers.js';
import { NOW, ctx, ids, makeState, makeTask } from './fixtures.js';
import { createFakeClient, err, ok } from './fake-client.js';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

/* Wires the engine to a fake client and an in-memory state; the baseline starts equal to the state. */
function setup(prepare) {
  const st = makeState();
  prepare?.(st);
  const fake = createFakeClient();
  const seen = { status: [], rejected: [], auth: [], files: [], server: [] };
  const sync = createSync({
    getClient: () => fake.client,
    getContext: () => ctx,
    getState: () => st,
    onStatus: s => seen.status.push(s),
    onRejected: e => seen.rejected.push(e),
    onAuthLost: e => seen.auth.push(e),
    onDeletedFiles: p => seen.files.push(p),
    // what the app does with database-decided values: show them in place of the provisional ones
    onServerValues: (table, rows) => {
      seen.server.push({ table, rows });
      for (const r of rows) Object.assign(st.data[table].find(x => x.id === r.id) || {}, { key: r.key });
    },
  });
  const commit = () => {
    normalize(st.data);
    sync.setBaseline(flatten(st, ctx));
  };
  commit();
  seen.status.length = 0;
  return { st, fake, sync, seen, commit, d: st.data };
}

const file = (id, over = {}) => ({
  id,
  project: ids.p1,
  task: null,
  name: id + '.txt',
  type: 'file',
  mime: 'text/plain',
  size: '1 KB',
  bytes: 1024,
  path: `${ids.ws}/${ids.p1}/${id}/${id}.txt`,
  by: ids.me,
  at: 1000,
  ...over,
});
const tick = ms => vi.advanceTimersByTimeAsync(ms);
const tableOrder = fake => fake.calls.map(c => c.table);

describe('inserts', () => {
  it('sends new rows as upsert with ignoreDuplicates (so a retry or a realtime echo never fails)', async () => {
    const { d, fake, sync } = setup();
    d.tasks.push(makeTask({ id: 't1', title: 'New' }));
    await sync.flush();
    const [call, ...rest] = fake.calls;
    expect(rest).toEqual([]);
    expect(call).toMatchObject({ table: 'tasks', op: 'upsert', opts: { onConflict: 'id', ignoreDuplicates: true } });
    expect(call.rows).toHaveLength(1);
    expect(call.rows[0]).toMatchObject({ id: 't1', title: 'New', project_id: ids.p1 });
    expect(sync.pending()).toBe(0);
    expect(sync.baselineRow('tasks', 't1')).toMatchObject({ title: 'New' });
  });

  it('uses the composite key as conflict target for join tables', async () => {
    const { d, fake, sync } = setup();
    d.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't2', deps: ['t1'] }));
    d.projects[0].members.push('m-new');
    d.members.push({ id: 'm-new', name: 'New', email: 'n@x.io', role: 'Member', status: 'active', c: '#000' });
    await sync.flush();
    expect(fake.of('upsert', 'task_dependencies')[0].opts).toEqual({ onConflict: 'task_id,depends_on_id', ignoreDuplicates: true });
    expect(fake.of('upsert', 'project_members')[0].opts.onConflict).toBe('project_id,member_id');
  });

  it('inserts parents before children, in table dependency order', async () => {
    const { d, fake, sync } = setup();
    d.projects.push({ id: 'p-new', key: 'NEW', name: 'New', members: [ids.me], perms: {}, milestones: [], created: 5, fav: true });
    d.tasks.push(makeTask({ id: 't-new', project: 'p-new', subtasks: [{ id: 's-new', title: 's' }], fav: true }));
    d.comments.push({ id: 'c-new', task: 't-new', by: ids.me, at: 1, text: 'hi', re: {} });
    d.files.push(file('f-new', { project: 'p-new', task: 't-new' }));
    await sync.flush();
    const order = tableOrder(fake);
    const idx = n => order.indexOf(n);
    expect(idx('projects')).toBeLessThan(idx('tasks'));
    expect(idx('tasks')).toBeLessThan(idx('subtasks'));
    expect(idx('tasks')).toBeLessThan(idx('comments'));
    expect(idx('tasks')).toBeLessThan(idx('files'));
    expect(order).toContain('project_favorites');
    // the order of calls follows TABLES
    const rank = n => TABLES.findIndex(t => t.name === n);
    expect(order.map(rank)).toEqual([...order.map(rank)].sort((a, b) => a - b));
  });

  it('sends inserts in chunks of 200 rows', async () => {
    const { d, fake, sync } = setup();
    for (let i = 0; i < 450; i++) d.tasks.push(makeTask({ id: 'bulk-' + i }));
    await sync.flush();
    expect(fake.of('upsert', 'tasks').map(c => c.rows.length)).toEqual([200, 200, 50]);
    expect(sync.pending()).toBe(0);
  });

  it('inserts activity (append-only) but never updates or deletes it', async () => {
    const { d, fake, sync, commit } = setup(st => {
      st.data.activity = [{ id: 'a1', by: ids.me, verb: 'created', task: null, project: ids.p1, at: 1, extra: '' }];
    });
    d.activity.unshift({ id: 'a2', by: ids.me, verb: 'moved', task: null, project: ids.p1, at: 2, extra: '' });
    await sync.flush();
    expect(fake.of('upsert', 'activity')).toHaveLength(1);
    expect(fake.of('upsert', 'activity')[0].rows[0].id).toBe('a2');
    fake.reset();
    d.activity[0].verb = 'edited';
    d.activity[1].extra = 'tampered';
    await sync.flush({ force: true });
    expect(fake.calls).toEqual([]);
    expect(sync.pending()).toBe(0);
    d.activity.length = 0;
    await sync.flush({ force: true });
    await tick(DELETE_HOLD_MS * 2);
    expect(fake.calls).toEqual([]);
    expect(sync.baselineRow('activity', 'a1')).toBeUndefined();
    commit();
  });

  it('does not insert notifications (the database creates them) but adopts them into the baseline', async () => {
    const { d, fake, sync } = setup();
    d.notifs.push({ id: 'n-new', type: 'assign', by: ids.m2, text: 'assigned you', at: 1, read: false });
    await sync.flush();
    expect(fake.calls).toEqual([]);
    expect(sync.pending()).toBe(0);
    expect(sync.baselineRow('notifications', 'n-new')).toEqual({ id: 'n-new', read_at: null });
  });
});

describe('updates', () => {
  it('sends only the changed columns, without the primary key', async () => {
    const { d, fake, sync, commit } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks[0].title = 'Renamed';
    d.tasks[0].priority = 'high';
    await sync.flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: 'tasks',
      op: 'update',
      patch: { title: 'Renamed', priority: 'high' },
      filter: { in: ['id', ['t1']] },
      opts: { count: 'exact' },
    });
    expect(Object.keys(fake.calls[0].patch).sort()).toEqual(['priority', 'title']);
    expect(sync.baselineRow('tasks', 't1')).toMatchObject({ title: 'Renamed' });
    commit();
  });

  it('groups rows that receive the exact same patch into one request', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't2' }), makeTask({ id: 't3' })));
    for (const t of d.tasks) t.status = 'done';
    await sync.flush();
    expect(fake.of('update', 'tasks')).toHaveLength(1);
    expect(fake.calls[0].patch).toEqual({ status: 'done' });
    expect(fake.calls[0].filter.in).toEqual(['id', ['t1', 't2', 't3']]);
  });

  it('separates rows whose patches differ', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't2' }), makeTask({ id: 't3' })));
    d.tasks[0].status = 'done';
    d.tasks[1].status = 'done';
    d.tasks[2].status = 'review';
    await sync.flush();
    const updates = fake.of('update', 'tasks');
    expect(updates).toHaveLength(2);
    expect(updates.map(c => [c.patch.status, c.filter.in[1]]).sort()).toEqual([
      ['done', ['t1', 't2']],
      ['review', ['t3']],
    ]);
  });

  it('updates rows with a composite key one by one using match()', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.projects[0].perms = { [ids.m2]: 'Can view' };
    });
    d.projects[0].perms[ids.m2] = 'Can edit';
    await sync.flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: 'project_members',
      op: 'update',
      patch: { permission: 'Can edit' },
      filter: { match: { project_id: ids.p1, member_id: ids.m2 } },
    });
  });

  it('marking a notification as read updates read_at only', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.notifs = [{ id: 'n1', type: 'assign', by: ids.m2, text: 'x', snippet: 's', at: 1, read: false }];
    });
    d.notifs[0].read = true;
    await sync.flush();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: 'notifications', op: 'update', filter: { in: ['id', ['n1']] } });
    expect(Object.keys(fake.calls[0].patch)).toEqual(['read_at']);
    expect(fake.calls[0].patch.read_at).toMatch(/^2026-03-10T12:00:00/);
  });

  it('changes to other notification fields never reach the database', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.notifs = [{ id: 'n1', type: 'assign', by: ids.m2, text: 'x', snippet: 's', at: 1, read: false }];
    });
    Object.assign(d.notifs[0], { text: 'changed', snippet: 'changed', type: 'mention', by: ids.me, at: 99 });
    await sync.flush({ force: true });
    expect(fake.calls).toEqual([]);
  });

  it('personal tables in update mode (member_state, profiles, workspaces) are updated, never inserted', async () => {
    const { d, st, fake, sync } = setup();
    d.recentSearches = ['hello'];
    st.prefs = { ...st.prefs, theme: 'dark' };
    d.ws.name = 'Renamed WS';
    await sync.flush();
    expect(fake.of('upsert')).toEqual([]);
    expect(fake.of('update', 'member_state')[0]).toMatchObject({ filter: { in: ['member_id', [ids.me]] } });
    expect(fake.of('update', 'member_state')[0].patch.state.recentSearches).toEqual(['hello']);
    expect(fake.of('update', 'workspaces')[0]).toMatchObject({ patch: { name: 'Renamed WS' }, filter: { in: ['id', [ids.ws]] } });
    expect(fake.of('update', 'profiles')[0].patch.prefs).toMatchObject({ theme: 'dark' });
  });

  it('a mid-flight edit is sent in the same flush', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    let first = true;
    fake.hooks.before = () => {
      if (first) {
        first = false;
        d.tasks[0].title = 'Edited while saving';
      }
    };
    d.tasks[0].status = 'done';
    await sync.flush();
    expect(fake.of('update', 'tasks').map(c => c.patch)).toEqual([{ status: 'done' }, { title: 'Edited while saving' }]);
    expect(sync.pending()).toBe(0);
  });

  it('a task update that changes nothing in the row does not call the server', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1', labels: ['a'] })));
    d.tasks[0].labels = ['a'];
    d.tasks[0].title = String(d.tasks[0].title);
    await sync.flush();
    expect(fake.calls).toEqual([]);
  });
});

describe('deletes and undo', () => {
  it('holds a delete for DELETE_HOLD_MS before sending it', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks.length = 0;
    await sync.flush();
    expect(fake.calls).toEqual([]);
    expect(sync.pending()).toBe(1);
    await tick(DELETE_HOLD_MS - 500);
    expect(fake.calls).toEqual([]);
    await tick(600);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: 'tasks', op: 'delete', filter: { in: ['id', ['t1']] } });
    expect(sync.pending()).toBe(0);
    expect(sync.baselineRow('tasks', 't1')).toBeUndefined();
  });

  it('is driven by schedule(): debounce, then the hold, then the delete', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks.length = 0;
    sync.schedule();
    await tick(200);
    expect(sync.pending()).toBe(1);
    await tick(100);
    expect(fake.calls).toEqual([]);
    await tick(DELETE_HOLD_MS + 100);
    expect(fake.of('delete', 'tasks')).toHaveLength(1);
  });

  it('cancels the delete when the state is restored before the hold ends (undo)', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't2' })));
    const snapshot = [...d.tasks];
    d.tasks.splice(0, 1);
    await sync.flush();
    await tick(3000);
    d.tasks = snapshot; // Undo
    await sync.flush();
    await tick(DELETE_HOLD_MS * 3);
    expect(fake.calls).toEqual([]);
    expect(sync.pending()).toBe(0);
    expect(sync.baselineRow('tasks', 't1')).toBeTruthy();
  });

  it('after an undo, a new delete of the same row starts a fresh hold window', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    const snapshot = [...d.tasks];
    d.tasks.length = 0;
    await sync.flush();
    await tick(5000);
    d.tasks = snapshot;
    await sync.flush();
    await tick(500);
    d.tasks = [];
    await sync.flush();
    await tick(DELETE_HOLD_MS - 500);
    expect(fake.calls).toEqual([]);
    await tick(700);
    expect(fake.of('delete', 'tasks')).toHaveLength(1);
  });

  it('flush({ force: true }) sends held deletes at once', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks.length = 0;
    await sync.flush();
    expect(fake.calls).toEqual([]);
    await sync.flush({ force: true });
    expect(fake.of('delete', 'tasks')).toHaveLength(1);
    expect(sync.pending()).toBe(0);
  });

  it('deletes children before parents', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.tasks.push(makeTask({ id: 't1', subtasks: [{ id: 's1', title: 's' }], deps: [] }));
      st.data.comments.push({ id: 'c1', task: 't1', by: ids.me, at: 1, text: 'x', re: {} });
      st.data.files.push(file('f1', { task: 't1' }));
    });
    d.tasks = d.tasks.filter(t => t.id !== 't1'); // normalize cascades to comments; the file is detached
    d.files = [];
    await sync.flush({ force: true });
    const order = fake.of('delete').map(c => c.table);
    expect(order).toEqual(expect.arrayContaining(['comments', 'files', 'subtasks', 'tasks']));
    const idx = n => order.indexOf(n);
    for (const child of ['comments', 'files', 'subtasks']) expect(idx(child), child).toBeLessThan(idx('tasks'));
    const rank = n => TABLES.findIndex(t => t.name === n);
    expect(order.map(rank)).toEqual([...order.map(rank)].sort((a, b) => b - a));
  });

  it('deleting a project deletes what hangs from it first, and leaves its tasks to the cascade', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.projects.push({ id: 'p2', key: 'B', name: 'B', members: [ids.me], perms: {}, milestones: [], created: 2 });
      st.data.tasks.push(makeTask({ id: 't1', project: 'p2', subtasks: [{ id: 's1', title: 's' }], deps: [] }));
      st.data.comments.push({ id: 'c1', task: 't1', by: ids.me, at: 1, text: 'x', re: {} });
      st.data.files.push(file('f1', { project: 'p2', task: 't1' }));
    });
    d.projects = d.projects.filter(p => p.id !== 'p2'); // normalize cascades to tasks, comments and files
    await sync.flush({ force: true });
    const order = fake.of('delete').map(c => c.table);
    expect(order).toEqual(expect.arrayContaining(['comments', 'files', 'subtasks', 'project_members', 'projects']));
    // the tasks go with the project in the database, so the history records one deletion, not one per task
    expect(order).not.toContain('tasks');
    const idx = n => order.indexOf(n);
    for (const child of ['comments', 'files', 'subtasks', 'project_members']) expect(idx(child), child).toBeLessThan(idx('projects'));
    expect(sync.pending()).toBe(0);
  });

  it('a delete that shares its table with a pending insert is sent without waiting (unique constraints)', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.members.push({ id: 'm-x', name: 'X', email: 'x@x.io', role: 'Member', status: 'active', c: '#000' });
      st.data.projects[0].members = [ids.me, ids.m2];
    });
    d.projects[0].members = [ids.me, 'm-x']; // m2 removed (delete), m-x added (insert) in project_members
    await sync.flush();
    expect(fake.of('upsert', 'project_members')).toHaveLength(1);
    expect(fake.of('delete', 'project_members')).toHaveLength(1);
  });

  it('deletes rows with a composite key one request each using match()', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.tasks.push(makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c', deps: ['a', 'b'] }));
    });
    d.tasks[2].deps = [];
    await sync.flush({ force: true });
    const dels = fake.of('delete', 'task_dependencies');
    expect(dels.map(c => c.filter.match)).toEqual([
      { task_id: 'c', depends_on_id: 'a' },
      { task_id: 'c', depends_on_id: 'b' },
    ]);
  });

  it('notifications can be deleted', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.notifs = [{ id: 'n1', type: 'assign', by: null, at: 1, read: true }];
    });
    d.notifs.length = 0;
    await sync.flush({ force: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: 'notifications', op: 'delete', filter: { in: ['id', ['n1']] } });
  });

  it('personal tables never receive deletes (workspace, profile, member_state)', async () => {
    const { d, fake, sync } = setup();
    d.ws.name = 'x';
    await sync.flush({ force: true });
    expect(fake.of('delete')).toEqual([]);
  });

  it('calls onDeletedFiles with the storage paths of deleted files, only after the database accepted the delete', async () => {
    const { d, fake, sync, seen } = setup(st => {
      st.data.files.push(file('f1'), file('f2', { path: null }), file('f3'));
    });
    d.files = d.files.filter(f => f.id === 'f3');
    await sync.flush({ force: true });
    expect(fake.of('delete', 'files')).toHaveLength(1);
    expect(seen.files).toEqual([[`${ids.ws}/${ids.p1}/f1/f1.txt`]]);
  });

  it('does not call onDeletedFiles when there is no stored content, or when the delete fails', async () => {
    const { d, fake, sync, seen } = setup(st => {
      st.data.files.push(file('f1', { path: null }), file('f2'));
    });
    d.files = d.files.filter(f => f.id === 'f2');
    await sync.flush({ force: true });
    expect(seen.files).toEqual([]);
    d.files = [];
    fake.failWhen(c => c.table === 'files' && c.op === 'delete', err(403, 'denied', '42501'));
    await sync.flush({ force: true });
    expect(seen.files).toEqual([]);
    expect(seen.rejected).toHaveLength(1);
  });

  it('a file whose task is deleted survives with no task (ON DELETE SET NULL)', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.tasks.push(makeTask({ id: 't1' }));
      st.data.files.push(file('f1', { task: 't1' }));
    });
    d.tasks.length = 0;
    await sync.flush({ force: true });
    expect(fake.of('delete', 'files')).toEqual([]);
    expect(fake.of('update', 'files')[0]).toMatchObject({ patch: { task_id: null } });
  });
});

describe('errors', () => {
  it.each([
    [400, 'bad request', '23514'],
    [403, 'new row violates row-level security policy', '42501'],
    [404, 'not found', 'PGRST116'],
    [409, 'duplicate key', '23505'],
    [422, 'unprocessable', undefined],
  ])('a %i response is a rejection: onRejected once, status error, no retry loop', async (status, message, code) => {
    const { d, fake, sync, seen } = setup();
    fake.failWhen(c => c.table === 'tasks', err(status, message, code));
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    expect(seen.rejected).toHaveLength(1);
    expect(seen.rejected[0]).toMatchObject({ kind: 'rejected', table: 'tasks', op: 'insert', code, message });
    expect(seen.status).toEqual(['saving', 'error']);
    expect(sync.status()).toBe('error');
    const calls = fake.calls.length;
    await tick(120000);
    expect(fake.calls.length).toBe(calls);
    expect(seen.rejected).toHaveLength(1);
    expect(sync.baselineRow('tasks', 't1')).toBeUndefined();
  });

  it('a rejected update reports the table and operation', async () => {
    const { d, fake, sync, seen } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    fake.failWhen(c => c.op === 'update', err(403, 'permission denied', '42501'));
    d.tasks[0].title = 'x';
    await sync.flush();
    expect(seen.rejected[0]).toMatchObject({ table: 'tasks', op: 'update', code: '42501' });
  });

  it('a rejected delete is reported', async () => {
    const { d, fake, sync, seen } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    fake.failWhen(c => c.op === 'delete', err(409, 'fk', '23503'));
    d.tasks.length = 0;
    await sync.flush({ force: true });
    expect(seen.rejected[0]).toMatchObject({ table: 'tasks', op: 'delete', code: '23503' });
  });

  it('a 401 means the session was lost: onAuthLost, not onRejected', async () => {
    const { d, fake, sync, seen } = setup();
    fake.failWhen(() => true, err(401, 'JWT expired', 'PGRST301'));
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    expect(seen.auth).toHaveLength(1);
    expect(seen.rejected).toEqual([]);
    expect(sync.status()).toBe('error');
    await tick(60000);
    expect(fake.calls).toHaveLength(1);
  });

  it.each([
    ['no status (fetch failed)', err(0, 'TypeError: Failed to fetch')],
    ['500', err(500, 'internal')],
    ['503', err(503, 'unavailable')],
    ['429', err(429, 'too many requests')],
    ['408', err(408, 'timeout')],
    ['thrown network error', new TypeError('fetch failed')],
  ])('%s puts the engine offline and retries later', async (_label, failure) => {
    const { d, fake, sync, seen } = setup();
    fake.failWhen(() => true, failure, { times: 1 });
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    expect(sync.status()).toBe('offline');
    expect(seen.rejected).toEqual([]);
    expect(sync.pending()).toBe(1);
    expect(fake.calls).toHaveLength(1);
    await tick(1400);
    expect(fake.calls).toHaveLength(1);
    await tick(200);
    expect(fake.calls).toHaveLength(2);
    expect(sync.status()).toBe('idle');
    expect(seen.status).toEqual(['saving', 'offline', 'saving', 'idle']);
    expect(sync.pending()).toBe(0);
    expect(sync.baselineRow('tasks', 't1')).toBeTruthy();
  });

  it('backs off between retries: 1.5s, 3s, 6s, 12s, then 30s', async () => {
    const { d, fake, sync } = setup();
    fake.failWhen(() => true, err(0, 'Failed to fetch'));
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    const times = [];
    let last = fake.calls.length;
    for (let t = 0; t < 120000 && times.length < 6; t += 100) {
      await tick(100);
      if (fake.calls.length > last) {
        times.push(t + 100);
        last = fake.calls.length;
      }
    }
    // attempt k+1 happens RETRY_MS[k] after attempt k
    const gaps = times.map((t, i) => t - (times[i - 1] ?? 0));
    expect(gaps[0]).toBeGreaterThanOrEqual(1500);
    expect(gaps[0]).toBeLessThan(1700);
    expect(gaps[1]).toBeGreaterThanOrEqual(3000);
    expect(gaps[1]).toBeLessThan(3200);
    expect(gaps[2]).toBeGreaterThanOrEqual(6000);
    expect(gaps[3]).toBeGreaterThanOrEqual(12000);
    expect(gaps[4]).toBeGreaterThanOrEqual(30000);
  });

  it('an update that touched fewer rows than expected is a rejection (no permission or row gone)', async () => {
    const { d, fake, sync, seen } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    fake.failWhen(c => c.op === 'update', ok({ count: 0 }));
    d.tasks[0].status = 'done';
    await sync.flush();
    expect(seen.rejected).toHaveLength(1);
    expect(seen.rejected[0]).toMatchObject({ kind: 'rejected', code: 'NOT_UPDATED', table: 'tasks', op: 'update' });
    expect(sync.baselineRow('tasks', 't1').status).toBe('todo');
    expect(sync.status()).toBe('error');
  });

  it('a bulk update that touched only some of the rows is a rejection', async () => {
    const { d, fake, sync, seen } = setup(st => st.data.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't2' }), makeTask({ id: 't3' })));
    fake.failWhen(c => c.op === 'update', ok({ count: 2 }));
    for (const t of d.tasks) t.status = 'done';
    await sync.flush();
    expect(seen.rejected[0]).toMatchObject({ code: 'NOT_UPDATED' });
  });

  it('an update with an exact count is accepted, and a missing count is tolerated', async () => {
    const { d, fake, sync, seen } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    fake.failWhen(c => c.op === 'update', ok({ count: null }));
    d.tasks[0].status = 'done';
    await sync.flush();
    expect(seen.rejected).toEqual([]);
    expect(sync.baselineRow('tasks', 't1').status).toBe('done');
  });

  it('after a rejection the next flush tries again with whatever is still different', async () => {
    const { d, fake, sync, seen } = setup();
    fake.failWhen(c => c.table === 'tasks', err(403, 'denied', '42501'), { times: 1 });
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    expect(seen.rejected).toHaveLength(1);
    await sync.flush();
    expect(fake.of('upsert', 'tasks')).toHaveLength(2);
    expect(sync.status()).toBe('idle');
  });
});

describe('setBaseline and stop', () => {
  it('discards work in flight: the stale response does not touch the new baseline nor start another cycle', async () => {
    const { d, st, fake, sync, seen } = setup();
    const fresh = flatten(st, ctx); // what a reload would give: no t1
    let release;
    fake.hooks.before = () => new Promise(r => (release = r));
    d.tasks.push(makeTask({ id: 't1' }));
    const inFlight = sync.flush();
    await tick(0);
    expect(fake.calls).toHaveLength(1);
    sync.setBaseline(fresh);
    release();
    await inFlight;
    expect(sync.baselineRow('tasks', 't1')).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
    expect(seen.rejected).toEqual([]);
    expect(sync.status()).toBe('idle');
  });

  it('ignores an error that arrives after the baseline was replaced', async () => {
    const { d, st, fake, sync, seen } = setup();
    const fresh = flatten(st, ctx);
    let release;
    fake.hooks.before = () => new Promise(r => (release = r));
    fake.failWhen(() => true, err(403, 'denied', '42501'));
    d.tasks.push(makeTask({ id: 't1' }));
    const inFlight = sync.flush();
    await tick(0);
    sync.setBaseline(fresh);
    release();
    await inFlight;
    expect(seen.rejected).toEqual([]);
    expect(sync.status()).toBe('idle');
    await tick(60000);
    expect(fake.calls).toHaveLength(1);
  });

  it('drops deletes that were on hold and the timers that would have sent them', async () => {
    const { d, st, fake, sync } = setup(s => s.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks.length = 0;
    await sync.flush();
    expect(sync.pending()).toBe(1);
    sync.setBaseline(flatten(st, ctx));
    expect(sync.pending()).toBe(0);
    await tick(DELETE_HOLD_MS * 3);
    expect(fake.calls).toEqual([]);
  });

  it('cancels a scheduled cycle and a pending offline retry', async () => {
    const { d, st, fake, sync } = setup();
    fake.failWhen(() => true, err(0, 'Failed to fetch'), { times: 1 });
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    expect(sync.status()).toBe('offline');
    sync.setBaseline(flatten(st, ctx));
    expect(sync.status()).toBe('idle');
    await tick(60000);
    expect(fake.calls).toHaveLength(1);
  });

  it('stop() clears the baseline and every timer', async () => {
    const { d, fake, sync } = setup(s => s.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks.length = 0;
    sync.schedule();
    sync.stop();
    expect(sync.hasBaseline()).toBe(false);
    await tick(DELETE_HOLD_MS * 2);
    expect(fake.calls).toEqual([]);
    expect(sync.pending()).toBe(0);
    await sync.flush();
    expect(fake.calls).toEqual([]);
  });

  it('does nothing without a baseline or without a workspace context', async () => {
    const fake = createFakeClient();
    const st = makeState();
    const sync = createSync({ getClient: () => fake.client, getContext: () => ({ wsId: null }), getState: () => st });
    sync.schedule();
    await sync.flush();
    expect(fake.calls).toEqual([]);
    expect(sync.pending()).toBe(0);
    expect(sync.hasBaseline()).toBe(false);
  });
});

describe('scheduling', () => {
  it('debounces rapid schedule() calls into one cycle', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    d.tasks[0].title = 'a';
    sync.schedule();
    await tick(100);
    d.tasks[0].title = 'ab';
    sync.schedule();
    await tick(100);
    d.tasks[0].title = 'abc';
    sync.schedule();
    await tick(200);
    expect(fake.calls).toEqual([]);
    await tick(100);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].patch).toEqual({ title: 'abc' });
  });

  it('flush() while a cycle is running waits for it and then runs another one', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    let release;
    fake.hooks.before = () => new Promise(r => (release = r));
    d.tasks[0].title = 'first';
    const a = sync.flush();
    await tick(0);
    expect(sync.isRunning()).toBe(true);
    const b = sync.flush();
    release();
    fake.hooks.before = null;
    await Promise.all([a, b]);
    expect(sync.isRunning()).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(sync.pending()).toBe(0);
  });

  it('reports saving then idle', async () => {
    const { d, sync, seen } = setup();
    d.tasks.push(makeTask({ id: 't1' }));
    await sync.flush();
    expect(seen.status).toEqual(['saving', 'idle']);
  });

  it('nothing to send keeps the status idle and makes no call', async () => {
    const { fake, sync, seen } = setup();
    await sync.flush();
    expect(fake.calls).toEqual([]);
    expect(seen.status).toEqual([]);
  });
});

describe('classify', () => {
  it('splits errors into auth, network and rejected', () => {
    expect(classify({ message: 'x' }, 401)).toBe('auth');
    expect(classify({ code: 'PGRST301', message: 'x' }, 400)).toBe('auth');
    expect(classify({ message: 'JWT expired' }, 400)).toBe('auth');
    expect(classify({ message: 'x' }, 0)).toBe('network');
    expect(classify({ message: 'x' }, undefined)).toBe('network');
    expect(classify({ message: 'x' }, 502)).toBe('network');
    expect(classify({ message: 'x' }, 429)).toBe('network');
    expect(classify({ message: 'x' }, 408)).toBe('network');
    expect(classify({ message: 'TypeError: Failed to fetch' }, 400)).toBe('network');
    expect(classify({ message: 'Load failed' }, 400)).toBe('network');
    expect(classify({ message: 'duplicate key' }, 409)).toBe('rejected');
    expect(classify({ message: 'permission denied' }, 403)).toBe('rejected');
    expect(classify({ message: 'bad' }, 400)).toBe('rejected');
  });
});

describe('columns decided by the database (task keys)', () => {
  it('reads the key back when inserting tasks, adopts it in the baseline and reports it', async () => {
    const { d, fake, sync, seen } = setup();
    d.tasks.push(makeTask({ id: 't1', key: 'WEB-201' }));
    // someone else took WEB-201 a moment earlier: the database answers with the next free key
    fake.failWhen(
      c => c.op === 'upsert' && c.table === 'tasks',
      () => ({ data: [{ id: 't1', key: 'WEB-207' }], error: null, status: 201 }),
    );
    await sync.flush();
    expect(fake.of('upsert', 'tasks')[0].select).toBe('id,key');
    expect(seen.server).toEqual([{ table: 'tasks', rows: [{ id: 't1', key: 'WEB-207' }] }]);
    expect(sync.baselineRow('tasks', 't1').key).toBe('WEB-207');
    // the app now shows the real key, so nothing is left to send
    expect(d.tasks[0].key).toBe('WEB-207');
    expect(sync.pending()).toBe(0);
    expect(fake.of('update', 'tasks')).toEqual([]);
  });

  it('keeps the provisional key when the database confirms it', async () => {
    const { d, fake, sync, seen } = setup();
    d.tasks.push(makeTask({ id: 't1', key: 'WEB-201' }));
    fake.failWhen(
      c => c.op === 'upsert' && c.table === 'tasks',
      () => ({ data: [{ id: 't1', key: 'WEB-201' }], error: null, status: 201 }),
    );
    await sync.flush();
    expect(sync.baselineRow('tasks', 't1').key).toBe('WEB-201');
    expect(seen.server).toEqual([{ table: 'tasks', rows: [{ id: 't1', key: 'WEB-201' }] }]);
    expect(sync.pending()).toBe(0);
  });

  it('a retried insert that the database ignores (already there) returns nothing and changes nothing', async () => {
    const { d, fake, sync, seen } = setup();
    d.tasks.push(makeTask({ id: 't1', key: 'WEB-201' }));
    fake.failWhen(
      c => c.op === 'upsert' && c.table === 'tasks',
      () => ({ data: [], error: null, status: 201 }),
    );
    await sync.flush();
    expect(seen.server).toEqual([]);
    expect(sync.baselineRow('tasks', 't1').key).toBe('WEB-201');
  });

  it('does not read anything back from tables without database-decided columns', async () => {
    const { d, fake, sync } = setup(st => st.data.tasks.push(makeTask({ id: 't1' })));
    d.comments.push({ id: 'c1', task: 't1', by: ids.me, at: 1, text: 'hi', re: {} });
    await sync.flush();
    expect(fake.of('upsert', 'comments')[0].select).toBeUndefined();
  });

  it('reads the key back when a task moves to another project, not on ordinary edits', async () => {
    const { d, fake, sync, seen } = setup(st => {
      st.data.projects.push({ ...st.data.projects[0], id: ids.p2, key: 'APP', name: 'App', members: [], perms: {} });
      st.data.tasks.push(makeTask({ id: 't1', key: 'WEB-201' }));
    });
    d.tasks[0].title = 'Renamed';
    await sync.flush();
    expect(fake.of('update', 'tasks')[0].select).toBeUndefined();
    expect(seen.server).toEqual([]);

    fake.reset();
    d.tasks[0].project = ids.p2;
    d.tasks[0].key = 'APP-201';
    fake.failWhen(
      c => c.op === 'update' && c.table === 'tasks',
      () => ({ data: [{ id: 't1', key: 'APP-230' }], error: null, status: 200, count: 1 }),
    );
    await sync.flush();
    const call = fake.of('update', 'tasks')[0];
    expect(call.patch).toEqual({ project_id: ids.p2, key: 'APP-201' });
    expect(call.select).toBe('id,key');
    expect(sync.baselineRow('tasks', 't1').key).toBe('APP-230');
    expect(d.tasks[0].key).toBe('APP-230');
    expect(seen.server).toEqual([{ table: 'tasks', rows: [{ id: 't1', key: 'APP-230' }] }]);
  });
});

describe('deleting a project', () => {
  it('leaves its tasks to the cascade: one request for the project, none for each task', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.projects.push({ ...st.data.projects[0], id: ids.p2, key: 'APP', name: 'App', members: [], perms: {} });
      st.data.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't2' }), makeTask({ id: 't3', project: ids.p2 }));
    });
    d.projects = d.projects.filter(p => p.id !== ids.p1);
    d.projOrder = d.projOrder.filter(x => x !== ids.p1);
    await sync.flush({ force: true });
    expect(fake.of('delete', 'tasks')).toEqual([]);
    expect(fake.of('delete', 'projects')).toHaveLength(1);
    expect(sync.baselineRow('tasks', 't1')).toBeUndefined();
    expect(sync.baselineRow('tasks', 't3')).toBeDefined();
    expect(sync.pending()).toBe(0);
  });

  it('a task deleted on its own in the same cycle is still deleted explicitly', async () => {
    const { d, fake, sync } = setup(st => {
      st.data.projects.push({ ...st.data.projects[0], id: ids.p2, key: 'APP', name: 'App', members: [], perms: {} });
      st.data.tasks.push(makeTask({ id: 't1' }), makeTask({ id: 't3', project: ids.p2 }));
    });
    d.projects = d.projects.filter(p => p.id !== ids.p1);
    d.projOrder = d.projOrder.filter(x => x !== ids.p1);
    d.tasks = d.tasks.filter(t => t.id !== 't3');
    await sync.flush({ force: true });
    const call = fake.of('delete', 'tasks');
    expect(call).toHaveLength(1);
    expect(call[0].filter.in).toEqual(['id', ['t3']]);
  });
});
