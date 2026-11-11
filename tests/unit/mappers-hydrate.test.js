import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLES, diff, flatten, hydrate, keyOf, normalize, parseBytes, fmtBytes } from '../../src/data/mappers.js';
import { NOW, clone, ctx, flatToRows, ids, makeRows } from './fixtures.js';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const byId = (list, id) => list.find(x => x.id === id);
const stateOf = ({ data, views }) => ({ data, prefs: { name: 'Ana', theme: 'dark' }, views });
const ms = iso => Date.parse(iso);

describe('hydrate', () => {
  it('builds the workspace, the member list and the workspace switcher', () => {
    const { data } = hydrate(makeRows(), ctx);
    expect(data.ws).toEqual({ id: ids.ws, name: 'Gr8r', url: 'gr8r', c: '#112233' });
    expect(data.workspaces).toEqual([{ id: ids.ws, name: 'Gr8r', c: '#112233', role: 'Owner' }]);
    expect(data.me).toBe(ids.me);
    expect(data.teams).toEqual([{ id: ids.team, name: 'Design', icon: 'palette', c: '#ff00aa', desc: 'Pixels' }]);
    expect(data.members).toHaveLength(3);
    expect(byId(data.members, ids.me)).toEqual({
      id: ids.me,
      name: 'Ana',
      email: 'ana@x.io',
      role: 'Owner',
      team: ids.team,
      title: 'Lead',
      c: '#111111',
      status: 'active',
      last: 10,
      tz: 'UTC',
      userId: ids.user,
    });
    // empty timezone is shown as an em dash, a guest keeps its role, a pending invitation has no "last seen"
    expect(byId(data.members, ids.m2)).toMatchObject({ role: 'Guest', tz: '—', last: null, team: '' });
    expect(byId(data.members, ids.m3)).toMatchObject({ role: 'Member', status: 'invited', last: null, userId: null });
  });

  it('builds projects with members, permissions, privacy, milestones and archive state', () => {
    const { data } = hydrate(makeRows(), ctx);
    const p1 = byId(data.projects, ids.p1);
    expect(p1).toMatchObject({
      key: 'WEB',
      name: 'Website',
      status: 'active',
      team: ids.team,
      lead: ids.me,
      start: '2026-03-01',
      due: '2026-04-01',
      fav: true,
      members: [ids.me, ids.m2],
      perms: { [ids.me]: 'Full access', [ids.m2]: 'Can comment' },
      access: 'workspace',
      private: false,
      milestones: [
        { name: 'Alpha', date: '2026-03-15' },
        { name: 'Beta', date: null },
      ],
      seq: 205,
      createdBy: ids.user,
    });
    expect(p1.archived).toBeUndefined();
    // last activity is the newest between the project row and its tasks (26 hours before "now")
    expect(p1.last).toBe(26 * 60);
    const p2 = byId(data.projects, ids.p2);
    expect(p2).toMatchObject({
      private: true,
      access: 'private',
      archived: true,
      archivedAt: ms('2026-02-01T00:00:00+00:00'),
      perms: {},
      members: [ids.me],
      fav: false,
    });
  });

  it('builds tasks with ordered subtasks, dependencies, attachments, completion, recurrence and favorites', () => {
    const { data } = hydrate(makeRows(), ctx);
    const t1 = byId(data.tasks, ids.t1);
    expect(t1).toMatchObject({
      key: 'WEB-201',
      project: ids.p1,
      title: 'Design home',
      status: 'done',
      prevStatus: 'review',
      assignee: ids.m2,
      priority: 'high',
      due: '2026-03-12',
      start: '2026-03-02',
      labels: ['ui', 'urgent'],
      estimate: '3d',
      recur: 'Weekly',
      order: 1.5,
      completedAt: ms('2026-03-09T09:00:00+00:00'),
      fav: false,
      deps: [],
      createdBy: ids.user,
    });
    expect(t1.subtasks).toEqual([
      { id: ids.s1, title: 'First', done: false },
      { id: ids.s2, title: 'Second', done: true, assignee: ids.me, due: '2026-03-11', note: 'n' },
    ]);
    expect(t1.attachments).toEqual([
      {
        id: ids.f1,
        name: 'spec.pdf',
        type: 'pdf',
        size: '2 KB',
        bytes: 2048,
        mime: 'application/pdf',
        path: `${ids.ws}/${ids.p1}/${ids.f1}/spec.pdf`,
        by: ids.me,
        at: ms('2026-03-03T00:00:00+00:00'),
      },
    ]);
    const t2 = byId(data.tasks, ids.t2);
    expect(t2).toMatchObject({ deps: [ids.t1], fav: true, recur: null, estimate: null, assignee: null });
    expect(t2.completedAt).toBeUndefined();
    expect(byId(data.tasks, ids.t3)).toMatchObject({ archived: true, archivedAt: ms('2026-02-02T00:00:00+00:00') });
  });

  it('lists every file once, newest first, with a readable size', () => {
    const { data } = hydrate(makeRows(), ctx);
    expect(data.files.map(f => f.id)).toEqual([ids.f2, ids.f1]);
    expect(data.files[0]).toMatchObject({ name: 'logo.png', type: 'image', size: '5.0 MB', bytes: 5242880, path: null, by: null, task: null, project: ids.p1 });
    expect(data.files[1]).toMatchObject({ task: ids.t1 });
  });

  it('builds comments with reactions, activity, notifications, events and saved views', () => {
    const { data } = hydrate(makeRows(), ctx);
    expect(data.comments).toEqual([
      { id: ids.c1, task: ids.t1, by: ids.m2, at: ms('2026-03-06T00:00:00+00:00'), text: 'Looks good @Ana', re: { '👍': [ids.me, ids.m2], '🎉': [ids.me] } },
    ]);
    expect(data.activity).toEqual([
      {
        id: ids.a1,
        by: ids.me,
        verb: 'completed',
        task: ids.t1,
        project: ids.p1,
        at: ms('2026-03-09T09:00:00+00:00'),
        extra: 'x',
        label: '',
        projectName: null,
      },
    ]);
    expect(data.events).toEqual([{ id: ids.e1, title: 'Launch', date: '2026-04-01', time: '09:30', project: ids.p1 }]);
    expect(data.savedViews).toEqual([
      { id: ids.v1, project: ids.p1, name: 'Mine', type: 'board', filters: [{ k: 'assignee', v: ids.me }], created: ms('2026-03-02T00:00:00+00:00') },
    ]);
  });

  it('maps read and unread notifications', () => {
    const { data } = hydrate(makeRows(), ctx);
    // newest first
    expect(data.notifs.map(n => n.id)).toEqual([ids.n1, ids.n2]);
    expect(data.notifs[0]).toEqual({
      id: ids.n1,
      type: 'mention',
      by: ids.m2,
      text: 'mentioned you in',
      snippet: 'Looks good',
      at: ms('2026-03-06T00:00:00+00:00'),
      read: false,
      task: ids.t1,
      project: ids.p1,
    });
    expect(data.notifs[1]).toEqual({
      id: ids.n2,
      type: 'assign',
      by: null,
      text: 'assigned you',
      snippet: '',
      at: ms('2026-03-05T00:00:00+00:00'),
      read: true,
      readAt: ms('2026-03-07T00:00:00+00:00'),
    });
  });

  it('reads the personal state: project order, recent searches, view configs and notification preferences', () => {
    const { data, views } = hydrate(makeRows(), ctx);
    expect(data.projOrder).toEqual([ids.p2, ids.p1]);
    expect(data.recentSearches).toEqual(['a', 'b']);
    expect(data.notifPrefs).toEqual({ inapp_assign: false });
    expect(views).toEqual({ [`p:${ids.p1}`]: { type: 'board' } });
  });

  it('tolerates empty or missing optional rows', () => {
    const rows = { workspace: makeRows().workspace };
    const { data, views } = hydrate(rows, { ...ctx, workspaces: undefined });
    expect(data.projects).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.workspaces).toEqual([]);
    expect(data.projOrder).toEqual([]);
    expect(data.notifPrefs).toEqual({});
    expect(views).toEqual({});
  });

  it('ignores malformed personal state instead of throwing', () => {
    const rows = makeRows();
    rows.member_state.state = { projOrder: 'nope', recentSearches: [1, 'x', null, 'y', 'z', 'a', 'b', 'c'], views: 7 };
    rows.profile.notif_prefs = 'broken';
    const { data, views } = hydrate(rows, ctx);
    // projOrder is repaired by normalize: every project listed once, oldest first
    expect(data.projOrder).toEqual([ids.p1, ids.p2]);
    expect(data.recentSearches).toEqual(['x', 'y', 'z', 'a', 'b']);
    expect(data.notifPrefs).toEqual({});
    expect(views).toEqual({});
  });

  it('falls back to Member for an unknown role', () => {
    const rows = makeRows();
    rows.members[0].role = 'superuser';
    expect(byId(hydrate(rows, ctx).data.members, ids.me).role).toBe('Member');
  });

  it('does not mutate the rows it receives', () => {
    const rows = makeRows();
    const before = clone(rows);
    hydrate(rows, ctx);
    expect(clone(rows)).toEqual(before);
  });
});

describe('flatten(hydrate(rows)) is stable', () => {
  const build = () => {
    const h = hydrate(makeRows(), ctx);
    return stateOf(h);
  };

  it('running normalize + flatten twice gives the same result (no phantom diffs)', () => {
    const state = build();
    normalize(state.data);
    const first = flatten(state, ctx);
    normalize(state.data);
    const second = flatten(state, ctx);
    expect(diff(first, second)).toEqual({ ops: {}, count: 0 });
    for (const { name } of TABLES) expect([...second[name]]).toEqual([...first[name]]);
  });

  it('is stable even when the state goes through a JSON round trip', () => {
    const state = build();
    const first = flatten(state, ctx);
    const copy = { ...state, data: clone(state.data) };
    expect(diff(first, flatten(copy, ctx)).count).toBe(0);
  });

  it('re-hydrating the flattened rows yields an identical state', () => {
    const state = build();
    const flat = flatten(state, ctx);
    const again = hydrate(flatToRows(flat, { notifications: makeRows().notifications }), ctx);
    const flat2 = flatten(stateOf(again), ctx);
    expect(diff(flat, flat2).count).toBe(0);
  });

  it('reproduces the original database rows column by column (no ghost updates against the server)', () => {
    const rows = makeRows();
    const flat = flatten(stateOf(hydrate(rows, ctx)), ctx);
    const canon = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toISOString() : v);
    const source = {
      teams: rows.teams,
      members: rows.members,
      projects: rows.projects,
      project_members: rows.project_members,
      tasks: rows.tasks,
      subtasks: rows.subtasks,
      task_dependencies: rows.task_dependencies,
      files: rows.files,
      comments: rows.comments,
      activity: rows.activity,
      events: rows.events,
      saved_views: rows.saved_views,
      task_favorites: rows.task_favorites,
      project_favorites: rows.project_favorites,
    };
    for (const [table, list] of Object.entries(source)) {
      expect(flat[table].size, table).toBe(list.length);
      for (const src of list) {
        const got = flat[table].get(keyOf(table, src));
        expect(got, `${table} ${keyOf(table, src)}`).toBeTruthy();
        for (const [col, value] of Object.entries(got)) expect(canon(value), `${table}.${col}`).toEqual(canon(src[col]));
      }
    }
    // notifications: only read_at is sent
    expect(flat.notifications.get(ids.n1)).toEqual({ id: ids.n1, read_at: null });
    expect(canon(flat.notifications.get(ids.n2).read_at)).toBe(canon(rows.notifications[1].read_at));
    expect(flat.member_state.get(ids.me).state).toEqual(rows.member_state.state);
  });
});

describe('round trip of each entity (memory → rows → memory)', () => {
  const roundTrip = state => {
    normalize(state.data);
    const flat = flatten(state, ctx);
    return hydrate(flatToRows(flat), ctx);
  };

  it('task with subtasks, dependencies, attachments, archived, done and recurrence', () => {
    const base = hydrate(makeRows(), ctx);
    const st = stateOf(base);
    const t = byId(st.data.tasks, ids.t2);
    Object.assign(t, {
      status: 'done',
      completedAt: ms('2026-03-09T00:00:00Z'),
      prevStatus: 'review',
      archived: true,
      archivedAt: ms('2026-03-10T00:00:00Z'),
      recur: 'Every 2 weeks',
      labels: ['a', 'b'],
      estimate: '2h',
      subtasks: [
        { id: 'sub-1', title: 'one', done: true, assignee: ids.m2, due: '2026-03-20', note: 'hello' },
        { id: 'sub-2', title: 'two', done: false },
      ],
      deps: [ids.t1],
    });
    // attachments are files linked to the task (d.files is the source of truth)
    const attachment = { id: 'att-1', name: 'a.txt', type: 'file', size: '1 KB', bytes: 1024, mime: 'text/plain', path: 'p/a.txt', by: ids.me, at: 5000 };
    st.data.files.push({ ...attachment, project: ids.p1, task: ids.t2 });
    normalize(st.data);
    const after = roundTrip(st).data;
    const got = byId(after.tasks, ids.t2);
    expect(got.subtasks).toEqual(t.subtasks);
    expect(got.deps).toEqual([ids.t1]);
    expect(got.attachments).toEqual([attachment]);
    expect(got).toMatchObject({ status: 'done', archived: true, recur: 'Every 2 weeks', labels: ['a', 'b'], estimate: '2h', prevStatus: 'review' });
    expect(got.completedAt).toBe(t.completedAt);
    expect(got.archivedAt).toBe(t.archivedAt);
    expect(byId(after.files, 'att-1')).toMatchObject({ task: ids.t2, project: ids.p1 });
  });

  it('project with members, permissions, privacy and milestones', () => {
    const st = stateOf(hydrate(makeRows(), ctx));
    const p = byId(st.data.projects, ids.p1);
    p.private = true;
    p.members = [ids.me, ids.m2, ids.m3];
    p.perms = { [ids.m2]: 'Can view', [ids.m3]: 'Can edit' };
    p.milestones = [{ name: 'M1', date: '2026-05-01' }];
    p.fav = false;
    const got = byId(roundTrip(st).data.projects, ids.p1);
    expect(got).toMatchObject({ private: true, access: 'private', fav: false });
    expect([...got.members].sort()).toEqual([ids.me, ids.m2, ids.m3].sort());
    expect(got.perms).toEqual({ [ids.m2]: 'Can view', [ids.m3]: 'Can edit' });
    expect(got.milestones).toEqual([{ name: 'M1', date: '2026-05-01' }]);
  });

  it('comments with reactions', () => {
    const st = stateOf(hydrate(makeRows(), ctx));
    st.data.comments.push({ id: 'c-new', task: ids.t2, by: ids.me, at: ms('2026-03-08T00:00:00Z'), text: 'hi', re: { '❤️': [ids.me] } });
    const got = roundTrip(st).data.comments;
    expect(got.map(c => c.id)).toEqual([ids.c1, 'c-new']);
    expect(got[1]).toEqual(st.data.comments[1]);
    expect(got[0].re).toEqual({ '👍': [ids.me, ids.m2], '🎉': [ids.me] });
  });

  it('favorites on tasks and projects', () => {
    const st = stateOf(hydrate(makeRows(), ctx));
    byId(st.data.tasks, ids.t1).fav = true;
    byId(st.data.tasks, ids.t2).fav = false;
    byId(st.data.projects, ids.p1).fav = false;
    byId(st.data.projects, ids.p2).fav = true;
    const after = roundTrip(st).data;
    expect(after.tasks.filter(t => t.fav).map(t => t.id)).toEqual([ids.t1]);
    expect(after.projects.filter(p => p.fav).map(p => p.id)).toEqual([ids.p2]);
  });

  it('saved views and personal state', () => {
    const st = stateOf(hydrate(makeRows(), ctx));
    st.data.savedViews.push({ id: 'sv2', project: ids.p1, name: 'Late', type: 'list', filters: [{ k: 'due', v: 'late' }], created: 99000 });
    st.data.recentSearches = ['x', 'y'];
    st.data.projOrder = [ids.p1, ids.p2];
    st.views = { [`p:${ids.p1}`]: { type: 'list' }, 'sv:sv2': { sort: 'due' } };
    const out = roundTrip(st);
    // `created` comes from the database (created_at), the client never sends it
    expect(byId(out.data.savedViews, 'sv2')).toEqual({ ...st.data.savedViews[1], created: 0 });
    expect(out.data.recentSearches).toEqual(['x', 'y']);
    expect(out.data.projOrder).toEqual([ids.p1, ids.p2]);
    expect(out.views).toEqual(st.views);
  });

  it('read and unread notifications keep their state', () => {
    const rows = makeRows();
    const st = stateOf(hydrate(rows, ctx));
    st.data.notifs[0].read = true; // n1 was unread
    st.data.notifs[1].read = false; // n2 was read
    normalize(st.data); // the sync engine always normalizes first: it stamps readAt
    const flat = flatten(st, ctx);
    expect(flat.notifications.get(ids.n1).read_at).toMatch(/^2026-03-10T12:00:00/);
    expect(flat.notifications.get(ids.n2).read_at).toBeNull();
    // the same notification read at a known time keeps that time
    st.data.notifs[1].read = true;
    st.data.notifs[1].readAt = ms('2026-03-07T00:00:00+00:00');
    normalize(st.data);
    expect(flatten(st, ctx).notifications.get(ids.n2).read_at).toBe('2026-03-07T00:00:00.000Z');
  });

  it('personal profile settings', () => {
    const st = stateOf(hydrate(makeRows(), ctx));
    st.data.notifPrefs = { inapp_assign: false, inapp_mention: true };
    const flat = flatten(st, ctx);
    expect(flat.profiles.get(ids.user)).toEqual({
      id: ids.user,
      full_name: 'Ana',
      prefs: { name: 'Ana', theme: 'dark' },
      notif_prefs: { inapp_assign: false, inapp_mention: true },
    });
  });
});

describe('byte helpers', () => {
  it('formats and parses sizes', () => {
    expect(fmtBytes(10)).toBe('10 B');
    expect(fmtBytes(2048)).toBe('2 KB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
    expect(parseBytes('4.2 MB')).toBe(Math.round(4.2 * 1048576));
    expect(parseBytes('12 kb')).toBe(12288);
    expect(parseBytes('garbage')).toBe(0);
    expect(parseBytes(null)).toBe(0);
  });
});
