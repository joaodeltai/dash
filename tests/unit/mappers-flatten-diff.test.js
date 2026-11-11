import { describe, expect, it } from 'vitest';
import { TABLES, diff, flatten, keyOf, normalize, stable } from '../../src/data/mappers.js';
import { ctx, ids, makeState, makeTask } from './fixtures.js';

const run = st => {
  normalize(st.data);
  return flatten(st, ctx);
};
const taskRow = (over = {}, flat = {}) => run(withTask(over, flat)).tasks.get('t1');
const withTask = (over = {}, flat = {}) => {
  const st = makeState();
  Object.assign(st.data, flat);
  st.data.tasks = [makeTask({ id: 't1', ...over })];
  return st;
};
const x = (ch, n) => ch.repeat(n);

describe('flatten: general shape', () => {
  it('returns an (empty) Map per table and nothing else when there is no workspace or member yet', () => {
    const st = makeState();
    for (const c of [
      { ...ctx, wsId: null },
      { ...ctx, meId: null },
    ]) {
      const out = flatten(st, c);
      expect(Object.keys(out)).toEqual(TABLES.map(t => t.name));
      for (const m of Object.values(out)) expect(m.size).toBe(0);
    }
  });

  it('keys rows by primary key, joining composite keys with |', () => {
    const st = withTask({ id: 't1', deps: ['t2'] });
    st.data.tasks.push(makeTask({ id: 't2' }));
    const out = run(st);
    expect(out.task_dependencies.has('t1|t2')).toBe(true);
    expect(keyOf('task_dependencies', { task_id: 'a', depends_on_id: 'b' })).toBe('a|b');
    expect(keyOf('member_state', { member_id: 'm' })).toBe('m');
  });

  it('stamps the workspace id on rows that need one and uses the current user for created_by', () => {
    const st = withTask({ createdBy: null });
    const out = run(st);
    expect(out.projects.get(ids.p1).workspace_id).toBe(ids.ws);
    expect(out.members.get(ids.me).workspace_id).toBe(ids.ws);
    expect(out.tasks.get('t1').created_by).toBe(ids.user);
  });
});

describe('flatten: validation and fallbacks', () => {
  it('empty or blank titles become "Untitled"', () => {
    for (const title of ['', '   ', undefined, null]) expect(taskRow({ title }).title).toBe('Untitled');
    expect(taskRow({ title: '  Hello  ' }).title).toBe('Hello');
    const st = withTask({
      subtasks: [
        { id: 's', title: '' },
        { id: 's2', title: '  ' },
      ],
    });
    expect([...run(st).subtasks.values()].map(s => s.title)).toEqual(['Untitled', 'Untitled']);
  });

  it('blank project, team, member, view and event names fall back to a default', () => {
    const st = makeState();
    st.data.projects[0].name = '   ';
    st.data.teams = [{ id: 'tm', name: '', icon: '', c: '', desc: undefined }];
    st.data.members[1].name = ' ';
    st.data.savedViews = [{ id: 'v', project: ids.p1, name: ' ', type: '' }];
    st.data.events = [{ id: 'e', title: '', date: '2026-01-01', time: '' }];
    const out = run(st);
    expect(out.projects.get(ids.p1).name).toBe('Untitled project');
    expect(out.teams.get('tm')).toMatchObject({ name: 'Team', icon: 'users', color: '#8A867E', description: '' });
    expect(out.members.get(ids.m2).name).toBe('Member');
    expect(out.saved_views.get('v')).toMatchObject({ name: 'View', type: 'list' });
    expect(out.events.get('e').title).toBe('Event');
  });

  it('invalid enum values fall back to the defaults', () => {
    const row = taskRow({ status: 'finished', prevStatus: 'nope', priority: 'critical', recur: 'Yearly' });
    expect(row).toMatchObject({ status: 'todo', prev_status: null, priority: 'none', recurrence: null });
    const st = makeState();
    st.data.projects[0].status = 'weird';
    st.data.members[0].role = 'Emperor';
    st.data.members[0].status = 'zombie';
    const out = run(st);
    expect(out.projects.get(ids.p1).status).toBe('planning');
    expect(out.members.get(ids.me)).toMatchObject({ role: 'member', status: 'invited' });
  });

  it('valid enum values pass through (roles are lowercased)', () => {
    expect(taskRow({ status: 'review', priority: 'urgent', recur: 'Every 2 weeks', prevStatus: 'backlog' })).toMatchObject({
      status: 'review',
      priority: 'urgent',
      recurrence: 'Every 2 weeks',
      prev_status: 'backlog',
    });
    const st = makeState();
    st.data.members[0].role = 'Admin';
    expect(run(st).members.get(ids.me).role).toBe('admin');
  });

  it.each(['31/12/2026', '2026-1-5', 20260101, '', 'tomorrow', {}, true])('a malformed date (%j) becomes null', bad => {
    expect(taskRow({ due: bad, start: bad }).due_date).toBeNull();
    expect(taskRow({ due: bad, start: bad }).start_date).toBeNull();
  });

  it('a well formed date is kept', () => {
    expect(taskRow({ due: '2026-02-28', start: '2024-02-29' })).toMatchObject({ due_date: '2026-02-28', start_date: '2024-02-29' });
  });

  // Postgres rejects dates that match the pattern but do not exist ("date/time field value out of range").
  it.each(['2026-13-45', '2026-02-30', '2026-02-29', '2026-04-31', '2026-00-10', '2026-06-00'])(
    'a date that does not exist on the calendar (%s) becomes null instead of being sent to the database',
    bad => {
      expect(taskRow({ due: bad }).due_date).toBeNull();
    },
  );

  it('dates in projects, subtasks and milestones are validated the same way', () => {
    const st = makeState();
    st.data.projects[0].due = 'x';
    st.data.projects[0].start = '2026-01-02';
    st.data.projects[0].milestones = [
      { name: 'm', date: 'x' },
      { name: 'n', date: '2026-05-05' },
    ];
    st.data.tasks = [makeTask({ id: 't1', subtasks: [{ id: 's', title: 's', due: 'bad' }] })];
    const out = run(st);
    expect(out.projects.get(ids.p1)).toMatchObject({
      due_date: null,
      start_date: '2026-01-02',
      milestones: [
        { name: 'm', date: null },
        { name: 'n', date: '2026-05-05' },
      ],
    });
    expect(out.subtasks.get('s').due_date).toBeNull();
  });

  it('event date and time are validated', () => {
    const st = makeState();
    st.data.events = [
      { id: 'a', title: 'a', date: 'bad', time: '9:30' },
      { id: 'b', title: 'b', date: '2026-01-01', time: '23:59' },
    ];
    const out = run(st);
    expect(out.events.get('a')).toMatchObject({ event_date: '1970-01-01', event_time: '' });
    expect(out.events.get('b')).toMatchObject({ event_date: '2026-01-01', event_time: '23:59' });
  });

  it('texts are cut at the column limit', () => {
    const st = withTask({ title: x('t', 600), key: x('K', 40), desc: x('d', 100001), estimate: x('e', 60), labels: [x('l', 50), 7, 'ok'] });
    st.data.projects[0].name = x('p', 200);
    st.data.projects[0].desc = x('d', 20001);
    st.data.projects[0].icon = x('i', 99);
    st.data.ws.name = x('w', 120);
    const out = run(st);
    const t = out.tasks.get('t1');
    expect(t.title).toHaveLength(500);
    expect(t.key).toHaveLength(24);
    expect(t.description).toHaveLength(100000);
    expect(t.estimate).toHaveLength(40);
    expect(t.labels).toEqual([x('l', 40), 'ok']);
    const p = out.projects.get(ids.p1);
    expect(p.name).toHaveLength(120);
    expect(p.description).toHaveLength(20000);
    expect(p.icon).toHaveLength(40);
    expect([...out.workspaces.values()][0].name).toHaveLength(80);
  });

  it('every text column of the remaining tables is cut at the database limit', () => {
    const st = withTask({ subtasks: [{ id: 's', title: x('s', 700), note: x('n', 30000) }] });
    st.data.files = [
      { id: 'f', project: ids.p1, task: null, name: x('f', 300), type: x('k', 30), mime: x('m', 300), size: '1 B', bytes: 1, path: null, by: null, at: 1 },
    ];
    st.data.comments = [{ id: 'c', task: 't1', by: ids.me, at: 1, text: x('c', 25000), re: {} }];
    st.data.activity = [{ id: 'a', by: ids.me, verb: x('v', 100), task: null, project: null, at: 1, extra: x('e', 700) }];
    st.data.events = [{ id: 'e', title: x('t', 300), date: '2026-01-01', time: '' }];
    st.data.savedViews = [{ id: 'v', project: ids.p1, name: x('n', 100), type: x('t', 30), filters: [] }];
    st.data.members[0].title = x('t', 200);
    st.data.members[0].name = x('n', 200);
    st.data.members[0].tz = x('z', 200);
    st.data.members[0].c = x('c', 99);
    st.data.teams = [{ id: 'tm', name: x('n', 200), icon: x('i', 99), c: x('c', 99), desc: x('d', 900) }];
    const out = run(st);
    expect(out.subtasks.get('s').title).toHaveLength(500);
    expect(out.subtasks.get('s').note).toHaveLength(20000);
    expect(out.files.get('f')).toMatchObject({
      name: expect.stringMatching(/^f{255}$/),
      kind: expect.stringMatching(/^k{20}$/),
      mime: expect.stringMatching(/^m{255}$/),
    });
    expect(out.comments.get('c').body).toHaveLength(20000);
    expect(out.activity.get('a').verb).toHaveLength(80);
    expect(out.activity.get('a').extra).toHaveLength(600);
    expect(out.events.get('e').title).toHaveLength(200);
    expect(out.saved_views.get('v').name).toHaveLength(80);
    expect(out.saved_views.get('v').type).toHaveLength(20);
    const m = out.members.get(ids.me);
    expect([m.title.length, m.name.length, m.timezone.length, m.color.length]).toEqual([120, 120, 80, 32]);
    expect(out.teams.get('tm')).toMatchObject({ name: expect.stringMatching(/^n{80}$/), description: expect.stringMatching(/^d{500}$/) });
  });

  it('member e-mails are trimmed and lowercased', () => {
    const st = makeState();
    st.data.members[0].email = '  Ana.Silva@Example.COM ';
    expect(run(st).members.get(ids.me).email).toBe('ana.silva@example.com');
  });

  it('project keys are upper-cased, stripped of symbols and limited to 10 characters', () => {
    const st = makeState();
    st.data.projects[0].key = 'we-b_1 x';
    expect(run(st).projects.get(ids.p1).key).toBe('WEB1X');
    st.data.projects[0].key = '---';
    expect(run(st).projects.get(ids.p1).key).toBe('P');
    st.data.projects[0].key = 'abcdefghijklmnop';
    expect(run(st).projects.get(ids.p1).key).toBe('ABCDEFGHIJ');
  });

  it('workspace slug is normalised to the database pattern', () => {
    const st = makeState();
    st.data.ws.url = '  My Cool_Workspace!! ';
    expect([...run(st).workspaces.values()][0].slug).toBe('my-cool-workspace');
    st.data.ws.url = '';
    expect([...run(st).workspaces.values()][0].slug).toBe('workspace');
    st.data.ws.url = 'a'.repeat(80);
    expect([...run(st).workspaces.values()][0].slug).toHaveLength(48);
  });

  it('numbers: position and file size are sanitised; the task counter belongs to the database and is never sent', () => {
    expect(taskRow({ order: NaN }).position).toBe(0);
    expect(taskRow({ order: '3' }).position).toBe(0);
    expect(taskRow({ order: 2.5 }).position).toBe(2.5);
    const st = makeState();
    st.data.projects[0].seq = -4;
    st.data.files = [
      { id: 'f1', project: ids.p1, name: 'a', type: 'x', mime: '', size: '', bytes: -5, at: 1 },
      { id: 'f2', project: ids.p1, name: 'b', type: 'x', mime: '', size: '', bytes: NaN, at: 1 },
      { id: 'f3', project: ids.p1, name: 'c', type: 'x', mime: '', size: '', bytes: 10.6, at: 1 },
    ];
    const out = run(st);
    expect('task_seq' in out.projects.get(ids.p1)).toBe(false);
    expect(['f1', 'f2', 'f3'].map(id => out.files.get(id).size_bytes)).toEqual([0, 0, 11]);
  });

  it('a comment with no text is stored as a single space (the column is NOT NULL, min length 1)', () => {
    const st = withTask();
    st.data.comments = [{ id: 'c', task: 't1', by: ids.me, at: 1, text: '', re: {} }];
    expect(run(st).comments.get('c').body).toBe(' ');
  });

  it('timestamps: missing ones fall back to the epoch, present ones are ISO strings', () => {
    const row = taskRow({ created: undefined, updated: undefined, completedAt: undefined });
    expect(row.created_at).toBe('1970-01-01T00:00:00.000Z');
    expect(row.updated_at).toBe('1970-01-01T00:00:00.000Z');
    expect(row.completed_at).toBeNull();
    expect(taskRow({ created: 5000, updated: undefined }).updated_at).toBe('1970-01-01T00:00:05.000Z');
    expect(taskRow({ completedAt: 86400000 }).completed_at).toBe('1970-01-02T00:00:00.000Z');
  });

  it('only archived items carry archived_at', () => {
    expect(taskRow({ archived: true, archivedAt: 1000 }).archived_at).toBe('1970-01-01T00:00:01.000Z');
    expect(taskRow({ archived: false, archivedAt: 1000 }).archived_at).toBeNull();
  });

  it('notifications of an unknown type are not sent', () => {
    const st = makeState();
    st.data.notifs = [
      { id: 'a', type: 'assign', by: null, read: false },
      { id: 'b', type: 'weird', by: null, read: false },
    ];
    expect([...run(st).notifications.keys()]).toEqual(['a']);
  });

  it('notifications carry only the id and read_at (everything else is created by the database)', () => {
    const st = makeState();
    st.data.notifs = [{ id: 'a', type: 'assign', by: ids.me, text: 'x', snippet: 'y', read: true, at: 5 }];
    expect(run(st).notifications.get('a')).toEqual({ id: 'a', read_at: expect.any(String) });
  });

  it('personal state only keeps view configs of projects and saved views that still exist', () => {
    const st = makeState();
    st.data.savedViews = [{ id: 'sv1', project: ids.p1, name: 'v' }];
    st.views = { [`p:${ids.p1}`]: { a: 1 }, 'p:gone': { a: 2 }, 'sv:sv1': { b: 1 }, 'sv:gone': { b: 2 }, other: { c: 3 } };
    const state = run(st).member_state.get(ids.me).state;
    expect(Object.keys(state.views).sort()).toEqual(['other', `p:${ids.p1}`, 'sv:sv1'].sort());
  });

  it('recent searches are capped at five', () => {
    const st = makeState();
    st.data.recentSearches = ['1', '2', '3', '4', '5', '6', '7'];
    expect(run(st).member_state.get(ids.me).state.recentSearches).toEqual(['1', '2', '3', '4', '5']);
  });

  it('does not emit favorites that are off', () => {
    const st = withTask({ fav: false });
    expect(run(st).task_favorites.size).toBe(0);
    st.data.tasks[0].fav = true;
    expect(run(st).task_favorites.get(`${ids.me}|t1`)).toEqual({ member_id: ids.me, task_id: 't1' });
  });

  it('project permissions: invalid values become null, members without permission are still listed', () => {
    const st = makeState();
    st.data.projects[0].perms = { [ids.me]: 'Can edit', [ids.m2]: 'Superuser' };
    const out = run(st);
    expect(out.project_members.get(`${ids.p1}|${ids.me}`).permission).toBe('Can edit');
    expect(out.project_members.get(`${ids.p1}|${ids.m2}`).permission).toBeNull();
  });

  it('member timezone placeholder is not stored', () => {
    const st = makeState();
    expect(run(st).members.get(ids.m2).timezone).toBe('');
  });

  it('does not mutate pages data beyond what normalize already did (calling flatten twice is a no-op)', () => {
    const st = withTask({ subtasks: [{ id: 's', title: 'x' }] });
    normalize(st.data);
    const a = flatten(st, ctx);
    const b = flatten(st, ctx);
    expect(diff(a, b).count).toBe(0);
  });
});

describe('stable()', () => {
  it('ignores object key order but respects array order', () => {
    expect(stable({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(stable({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(stable([1, 2])).not.toBe(stable([2, 1]));
  });
  it('treats undefined and null alike, and distinguishes other types', () => {
    expect(stable(undefined)).toBe(stable(null));
    expect(stable(0)).not.toBe(stable(null));
    expect(stable('1')).not.toBe(stable(1));
    expect(stable('')).not.toBe(stable(null));
  });
});

describe('diff', () => {
  const T = rows => ({ tasks: new Map(rows.map(r => [r.id, r])) });

  it('reports nothing when both sides are equal', () => {
    const a = T([{ id: '1', title: 'a' }]);
    expect(diff(a, T([{ id: '1', title: 'a' }]))).toEqual({ ops: {}, count: 0 });
  });

  it('detects inserts', () => {
    const d = diff(
      T([{ id: '1', title: 'a' }]),
      T([
        { id: '1', title: 'a' },
        { id: '2', title: 'b' },
      ]),
    );
    expect(d.count).toBe(1);
    expect(d.ops.tasks).toEqual({ inserts: [{ id: '2', title: 'b' }], updates: [], deletes: [] });
  });

  it('detects deletes, returning the old row', () => {
    const d = diff(
      T([
        { id: '1', title: 'a' },
        { id: '2', title: 'b' },
      ]),
      T([{ id: '1', title: 'a' }]),
    );
    expect(d.ops.tasks.deletes).toEqual([{ key: '2', row: { id: '2', title: 'b' } }]);
    expect(d.count).toBe(1);
  });

  it('updates only the columns that changed and never includes the primary key in the patch', () => {
    const base = T([{ id: '1', title: 'a', status: 'todo', due_date: null }]);
    const cur = T([{ id: '1', title: 'a', status: 'done', due_date: '2026-01-01' }]);
    const d = diff(base, cur);
    expect(d.ops.tasks.updates).toEqual([
      { key: '1', row: { id: '1', title: 'a', status: 'done', due_date: '2026-01-01' }, patch: { status: 'done', due_date: '2026-01-01' } },
    ]);
    expect(Object.keys(d.ops.tasks.updates[0].patch)).not.toContain('id');
  });

  it('a change of the primary key is an insert plus a delete, not an update', () => {
    const d = diff(T([{ id: '1', title: 'a' }]), T([{ id: '2', title: 'a' }]));
    expect(d.ops.tasks.inserts).toHaveLength(1);
    expect(d.ops.tasks.deletes).toHaveLength(1);
    expect(d.ops.tasks.updates).toHaveLength(0);
  });

  it('handles composite keys without putting key columns in the patch', () => {
    const k = (p, m, permission) => ({ project_id: p, member_id: m, permission });
    const mk = rows => ({ project_members: new Map(rows.map(r => [`${r.project_id}|${r.member_id}`, r])) });
    const d = diff(mk([k('p', 'm1', 'Can view'), k('p', 'm2', null)]), mk([k('p', 'm1', 'Can edit'), k('p', 'm3', null)]));
    expect(d.ops.project_members.updates).toEqual([{ key: 'p|m1', row: k('p', 'm1', 'Can edit'), patch: { permission: 'Can edit' } }]);
    expect(d.ops.project_members.inserts).toEqual([k('p', 'm3', null)]);
    expect(d.ops.project_members.deletes).toEqual([{ key: 'p|m2', row: k('p', 'm2', null) }]);
    expect(d.count).toBe(3);
  });

  it('ignores the key order of JSON objects but notices changes inside them', () => {
    const mk = c => ({ saved_views: new Map([['v', { id: 'v', config: c }]]) });
    expect(diff(mk({ filters: [{ a: 1, b: 2 }], x: 1 }), mk({ x: 1, filters: [{ b: 2, a: 1 }] })).count).toBe(0);
    const changed = diff(mk({ filters: [{ a: 1 }] }), mk({ filters: [{ a: 2 }] }));
    expect(changed.ops.saved_views.updates[0].patch).toEqual({ config: { filters: [{ a: 2 }] } });
    // array order is significant
    expect(diff(mk({ f: [1, 2] }), mk({ f: [2, 1] })).count).toBe(1);
  });

  it('treats undefined as null and a missing table as empty', () => {
    expect(diff({ tasks: new Map([['1', { id: '1', due: undefined }]]) }, { tasks: new Map([['1', { id: '1', due: null }]]) }).count).toBe(0);
    const d = diff({}, T([{ id: '1' }]));
    expect(d.ops.tasks.inserts).toHaveLength(1);
    expect(diff(T([{ id: '1' }]), {}).ops.tasks.deletes).toHaveLength(1);
  });

  it('keeps the ops grouped per table in dependency order', () => {
    const base = { projects: new Map(), tasks: new Map() };
    const cur = { tasks: new Map([['t', { id: 't' }]]), projects: new Map([['p', { id: 'p' }]]) };
    expect(Object.keys(diff(base, cur).ops)).toEqual(['projects', 'tasks']);
  });

  it('a state with no real changes has an empty diff against its own flatten, even after unrelated edits to other tables', () => {
    const st = withTask({});
    const base = run(st);
    st.data.tasks[0].title = 'changed';
    const d = diff(base, run(st));
    expect(Object.keys(d.ops)).toEqual(['tasks']);
    expect(d.ops.tasks.updates[0].patch).toEqual({ title: 'changed' });
  });
});
