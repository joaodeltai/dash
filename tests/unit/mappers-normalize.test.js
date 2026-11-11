import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalize } from '../../src/data/mappers.js';
import { NOW, clone, ids, makeState, makeTask } from './fixtures.js';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const att = (id, over = {}) => ({
  id,
  name: id + '.txt',
  type: 'file',
  size: '1 KB',
  bytes: 1024,
  mime: 'text/plain',
  path: 'x/' + id,
  by: ids.me,
  at: 1000,
  ...over,
});
const file = (id, over = {}) => ({ ...att(id), project: ids.p1, task: null, ...over });

/* A deliberately broken workspace: every rule of normalize has something to repair. */
function messyState() {
  const st = makeState();
  const d = st.data;
  d.teams = [{ id: ids.team, name: 'T', icon: 'users', c: '#000', desc: '' }];
  d.members[1].team = 'gone-team';
  d.projects.push({
    id: ids.p2,
    key: 'B',
    name: 'B',
    status: 'active',
    team: 'gone-team',
    lead: 'gone-member',
    members: [ids.me, 'gone-member', ids.me],
    perms: { [ids.me]: 'Can edit', 'gone-member': 'Can view', [ids.m2]: 'Can view' },
    milestones: 'nope',
    private: 1,
    created: 5,
    archived: true,
  });
  d.projOrder = ['ghost', ids.p1, ids.p1];
  d.tasks = [
    makeTask({
      id: 't-a',
      title: 'A',
      assignee: 'gone-member',
      deps: ['t-a', 't-b', 'ghost-task', 't-b'],
      subtasks: [{ id: 'dup', title: 's1', assignee: 'gone-member' }, { id: 'dup', title: 's2' }, { title: 'no id' }],
      attachments: [att('att-1')],
      labels: null,
      archived: true,
    }),
    makeTask({ id: 't-b', title: 'B', subtasks: [{ id: 'dup', title: 'copied' }], attachments: [att('att-1')] }),
    makeTask({ id: 't-orphan', project: 'ghost-project' }),
  ];
  d.files = [
    file('f-keep', { task: 't-a' }),
    file('f-orphan-project', { project: 'ghost-project' }),
    file('f-orphan-task', { task: 'ghost-task', by: 'gone-member' }),
    file('f-nobytes', { bytes: undefined, size: '3 KB' }),
  ];
  d.comments = [
    { id: 'c1', task: 't-a', by: 'gone-member', at: 1, text: 'ok', re: { '👍': [ids.me, 'gone-member'], '🎉': ['gone-member'], '❤️': [] } },
    { id: 'c2', task: 'ghost-task', by: ids.me, at: 2, text: 'orphan', re: {} },
    { id: 'c3', task: 't-orphan', by: ids.me, at: 3, text: 'orphan via project', re: null },
  ];
  d.activity = [
    { id: 'a1', by: 'gone-member', verb: 'x', task: 't-a', project: ids.p1, at: 1 },
    { id: 'a2', by: ids.me, verb: 'x', task: 'ghost-task', project: null, at: 2 },
    { id: 'a3', by: ids.me, verb: 'x', task: null, project: 'ghost-project', at: 3 },
    { id: 'a4', by: ids.me, verb: 'x', task: null, project: null, at: 4 },
  ];
  d.notifs = [
    { id: 'n1', type: 'assign', by: 'gone-member', task: 't-a', project: ids.p1, at: 1, read: true },
    { id: 'n2', type: 'assign', by: ids.me, task: 'ghost-task', at: 2, read: false, readAt: 5 },
    { id: 'n3', type: 'assign', by: ids.me, project: 'ghost-project', at: 3, read: false },
  ];
  d.events = [
    { id: 'e1', title: 'ok', date: '2026-01-01', project: ids.p1 },
    { id: 'e2', title: 'gone', date: '2026-01-01', project: 'ghost-project' },
    { id: 'e3', title: 'ws', date: '2026-01-01', project: null },
  ];
  d.savedViews = [
    { id: 'v1', project: ids.p1, name: 'ok' },
    { id: 'v2', project: 'ghost-project', name: 'gone' },
  ];
  return st;
}

describe('normalize', () => {
  it('is idempotent on a clean state', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1', subtasks: [{ id: 's1', title: 's' }], attachments: [att('a1')], deps: [] }), makeTask({ id: 't2', deps: ['t1'] })];
    normalize(st.data);
    const once = clone(st.data);
    normalize(st.data);
    expect(clone(st.data)).toEqual(once);
  });

  it('is idempotent on a messy state (nothing is regenerated or re-stamped on the second pass)', () => {
    const st = messyState();
    normalize(st.data);
    const once = clone(st.data);
    normalize(st.data);
    normalize(st.data);
    expect(clone(st.data)).toEqual(once);
  });

  it('regenerates subtask ids that repeat across (or inside) tasks, keeping the first owner', () => {
    const st = messyState();
    normalize(st.data);
    const a = st.data.tasks.find(t => t.id === 't-a');
    const b = st.data.tasks.find(t => t.id === 't-b');
    expect(a.subtasks[0].id).toBe('dup');
    const all = [...a.subtasks, ...b.subtasks].map(s => s.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every(Boolean)).toBe(true);
    expect(b.subtasks[0].id).not.toBe('dup');
    expect(b.subtasks[0].title).toBe('copied');
  });

  it('derives task.attachments from files', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1' })];
    st.data.files = [file('f1', { task: 't1', at: 10 }), file('f2', { task: null })];
    normalize(st.data);
    expect(st.data.tasks[0].attachments.map(a => a.id)).toEqual(['f1']);
    expect(st.data.tasks[0].attachments[0]).toEqual(att('f1', { at: 10 }));
  });

  it('keeps the existing attachment order when files are listed in another order', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1', attachments: [att('a', { at: 3 }), att('b', { at: 1 }), att('c', { at: 2 })] })];
    st.data.files = [file('c', { task: 't1', at: 2 }), file('b', { task: 't1', at: 1 }), file('a', { task: 't1', at: 3 })];
    normalize(st.data);
    expect(st.data.tasks[0].attachments.map(a => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not promote an attachment that only exists in task.attachments: d.files is the only source of truth', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1', attachments: [att('only-here')] })];
    normalize(st.data);
    expect(st.data.files).toEqual([]);
    expect(st.data.tasks[0].attachments).toEqual([]);
  });

  it('removing a file record is all it takes to detach it (a removed file is not resurrected from the task)', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1' })];
    st.data.files = [file('f1', { task: 't1' })];
    normalize(st.data);
    expect(st.data.tasks[0].attachments.map(a => a.id)).toEqual(['f1']);
    st.data.files = [];
    normalize(st.data);
    expect(st.data.files).toEqual([]);
    expect(st.data.tasks[0].attachments).toEqual([]);
  });

  it('stale attachments copied between tasks (duplicated task) vanish; only files linked to the task remain', () => {
    const st = messyState();
    normalize(st.data);
    const a = st.data.tasks.find(t => t.id === 't-a');
    const b = st.data.tasks.find(t => t.id === 't-b');
    expect(a.attachments.map(x => x.id)).toEqual(['f-keep']);
    expect(b.attachments).toEqual([]);
    const ids2 = st.data.files.map(f => f.id);
    expect(new Set(ids2).size).toBe(ids2.length);
  });

  it('removes orphans: comments, activity, notifications, files, events, saved views, tasks without project', () => {
    const st = messyState();
    normalize(st.data);
    const d = st.data;
    expect(d.tasks.map(t => t.id)).toEqual(['t-a', 't-b']);
    expect(d.comments.map(c => c.id)).toEqual(['c1']);
    // history outlives a deleted task (the entry stays, detached); entries of a deleted project go with it
    expect(d.activity.map(a => a.id)).toEqual(['a1', 'a2', 'a4']);
    expect(d.activity.find(a => a.id === 'a2').task).toBeNull();
    expect(d.notifs.map(n => n.id)).toEqual(['n1']);
    expect(d.events.map(e => e.id)).toEqual(['e1', 'e3']);
    expect(d.savedViews.map(v => v.id)).toEqual(['v1']);
    expect(d.files.some(f => f.id === 'f-orphan-project')).toBe(false);
  });

  it('keeps a file whose task vanished but detaches it (task_id would be set null by the database)', () => {
    const st = messyState();
    normalize(st.data);
    const f = st.data.files.find(x => x.id === 'f-orphan-task');
    expect(f).toBeTruthy();
    expect(f.task).toBeNull();
    // authorship is left alone: the database clears it itself when the member row goes away
    expect(f.by).toBe('gone-member');
  });

  it('moves a file to the project of its task', () => {
    const st = makeState();
    st.data.projects.push({ id: ids.p2, key: 'B', name: 'B', members: [], perms: {}, milestones: [], created: 1 });
    st.data.tasks = [makeTask({ id: 't1', project: ids.p2 })];
    st.data.files = [file('f1', { task: 't1', project: ids.p1 })];
    normalize(st.data);
    expect(st.data.files[0].project).toBe(ids.p2);
  });

  it('recovers missing byte counts from the size label', () => {
    const st = messyState();
    normalize(st.data);
    expect(st.data.files.find(f => f.id === 'f-nobytes').bytes).toBe(3072);
  });

  it('removes dependencies on missing tasks, on itself and duplicates', () => {
    const st = messyState();
    normalize(st.data);
    expect(st.data.tasks.find(t => t.id === 't-a').deps).toEqual(['t-b']);
  });

  it('turns assignment references (task, subtask, project lead) to a missing member into null', () => {
    const st = messyState();
    normalize(st.data);
    const d = st.data;
    const a = d.tasks.find(t => t.id === 't-a');
    expect(a.assignee).toBeNull();
    expect(a.subtasks[0].assignee).toBeNull();
    expect(d.projects.find(p => p.id === ids.p2).lead).toBeNull();
  });

  it('leaves authorship (comment, activity, notification, file) alone when the author is gone', () => {
    const st = messyState();
    normalize(st.data);
    const d = st.data;
    expect(d.comments[0].by).toBe('gone-member');
    expect(d.activity[0].by).toBe('gone-member');
    expect(d.notifs[0].by).toBe('gone-member');
    expect(d.files.find(f => f.id === 'f-orphan-task').by).toBe('gone-member');
  });

  it('repairs project members, permissions, team, milestones and privacy', () => {
    const st = messyState();
    normalize(st.data);
    const p = st.data.projects.find(x => x.id === ids.p2);
    expect(p.members).toEqual([ids.me]);
    expect(p.perms).toEqual({ [ids.me]: 'Can edit' });
    expect(p.team).toBe('');
    expect(p.milestones).toEqual([]);
    expect(p.private).toBe(true);
    expect(p.access).toBe('private');
    expect(p.archivedAt).toBe(NOW);
    expect(st.data.members[1].team).toBe('');
  });

  it('makes projOrder list every project exactly once, keeping the user order', () => {
    const st = messyState();
    normalize(st.data);
    expect(st.data.projOrder).toEqual([ids.p1, ids.p2]);
    const st2 = makeState();
    st2.data.projects.push(
      { id: 'new-1', key: 'N', name: 'N', members: [], perms: {}, milestones: [], created: 10 },
      { id: 'old-1', key: 'O', name: 'O', members: [], perms: {}, milestones: [], created: 2 },
    );
    st2.data.projOrder = [ids.p1];
    normalize(st2.data);
    // missing ones are appended oldest first
    expect(st2.data.projOrder).toEqual([ids.p1, 'old-1', 'new-1']);
    st2.data.projOrder = ['new-1', 'new-1', 'ghost', 'old-1', ids.p1, 'old-1'];
    normalize(st2.data);
    expect(st2.data.projOrder).toEqual(['new-1', 'old-1', ids.p1]);
  });

  it('removes empty reactions and reactions from missing members', () => {
    const st = messyState();
    normalize(st.data);
    expect(st.data.comments[0].re).toEqual({ '👍': [ids.me] });
  });

  it('turns a missing reactions object into an empty one', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1' })];
    st.data.comments = [{ id: 'c', task: 't1', by: ids.me, at: 1, text: 'x', re: undefined }];
    normalize(st.data);
    expect(st.data.comments[0].re).toEqual({});
  });

  it('stamps readAt on read notifications and drops it from unread ones', () => {
    const st = makeState();
    st.data.notifs = [
      { id: 'r', type: 'assign', by: null, read: true },
      { id: 'u', type: 'assign', by: null, read: false, readAt: 99 },
    ];
    normalize(st.data);
    expect(st.data.notifs[0].readAt).toBe(NOW);
    expect(st.data.notifs[1].readAt).toBeUndefined();
  });

  it('creates missing collections instead of throwing', () => {
    const d = { members: [{ id: 'm' }], projects: [] };
    expect(() => normalize(d)).not.toThrow();
    expect(d.tasks).toEqual([]);
    expect(d.notifPrefs).toEqual({});
    expect(d.projOrder).toEqual([]);
  });

  it('returns the same object it received', () => {
    const st = makeState();
    expect(normalize(st.data)).toBe(st.data);
  });

  it('history outlives its task: the entry is detached and keeps the title it was given', () => {
    const st = makeState();
    st.data.tasks = [makeTask({ id: 't1', title: 'Write the brief' })];
    st.data.activity = [{ id: 'a1', by: ids.me, verb: 'created', task: 't1', project: ids.p1, at: 1, extra: '', label: 'Write the brief' }];
    st.data.tasks = [];
    normalize(st.data);
    expect(st.data.activity).toEqual([{ id: 'a1', by: ids.me, verb: 'created', task: null, project: ids.p1, at: 1, extra: '', label: 'Write the brief' }]);
    // idempotent
    normalize(st.data);
    expect(st.data.activity).toHaveLength(1);
  });
});
