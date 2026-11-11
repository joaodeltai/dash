/* =====================================================================
   MAPPERS: pure translation between the in-memory workspace (`S.data`, the
   shape every page and action already works with) and database rows.

   - hydrate(rows, ctx)  rows fetched from Supabase  →  S.data
   - normalize(data)     repairs the in-memory state so it mirrors what the
                         database enforces (unique ids, one record per file,
                         no references to things that no longer exist)
   - flatten(state, ctx) S.data (+ prefs, views)     →  { table: Map(key → row) }

   The sync engine diffs two `flatten` results, so this file must stay free of
   DOM and network access and must be deterministic.
   ===================================================================== */

export const newId = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
        (+c ^ (globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
      );

/* Tables in dependency order: parents first. Inserts and updates run in this order, deletes in reverse.
   mode: 'full' (insert/update/delete) · 'insert' (append-only) · 'update' (rows are created by the database). */
export const TABLES = [
  { name: 'workspaces', pk: ['id'], mode: 'update' },
  { name: 'profiles', pk: ['id'], mode: 'update' },
  { name: 'teams', pk: ['id'], mode: 'full' },
  { name: 'members', pk: ['id'], mode: 'full' },
  { name: 'member_state', pk: ['member_id'], mode: 'update' },
  { name: 'projects', pk: ['id'], mode: 'full' },
  { name: 'project_members', pk: ['project_id', 'member_id'], mode: 'full' },
  { name: 'tasks', pk: ['id'], mode: 'full' },
  { name: 'subtasks', pk: ['id'], mode: 'full' },
  { name: 'task_dependencies', pk: ['task_id', 'depends_on_id'], mode: 'full' },
  { name: 'files', pk: ['id'], mode: 'full' },
  { name: 'comments', pk: ['id'], mode: 'full' },
  { name: 'activity', pk: ['id'], mode: 'insert' },
  { name: 'notifications', pk: ['id'], mode: 'update', deletable: true },
  { name: 'events', pk: ['id'], mode: 'full' },
  { name: 'saved_views', pk: ['id'], mode: 'full' },
  { name: 'task_favorites', pk: ['member_id', 'task_id'], mode: 'full' },
  { name: 'project_favorites', pk: ['member_id', 'project_id'], mode: 'full' },
];
export const TABLE = Object.fromEntries(TABLES.map(t => [t.name, t]));
export const keyOf = (table, row) => TABLE[table].pk.map(k => row[k]).join('|');

const STATUS = ['backlog', 'todo', 'progress', 'review', 'done'];
const PRIORITY = ['urgent', 'high', 'medium', 'low', 'none'];
const PSTATUS = ['planning', 'active', 'risk', 'hold', 'complete'];
const RECUR = ['Daily', 'Weekly', 'Every 2 weeks', 'Monthly'];
const PERMS = ['Can view', 'Can comment', 'Can edit', 'Full access'];
const NOTIF_TYPES = ['mention', 'assign', 'comment', 'update'];
const ROLE_UP = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- small converters ---------- */
const str = (v, max, fallback = '') => {
  const s = v == null ? '' : String(v);
  return (s || fallback).slice(0, max);
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
/* A calendar date the database will accept: well-formed and real (2026-02-30 is not). */
const dateOrNull = v => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? v : null;
};
const toIso = ms => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const toMs = iso => {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
};
const minsSince = iso => {
  const ms = toMs(iso);
  return ms == null ? null : Math.max(0, Math.round((Date.now() - ms) / 6e4));
};
export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
/* Legacy records only carry a formatted size ("4.2 MB"); recover an approximate byte count from it. */
export function parseBytes(label) {
  const m = /^([\d.]+)\s*(B|KB|MB|GB)$/i.exec(String(label || '').trim());
  if (!m) return 0;
  const mult = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[m[2].toUpperCase()];
  return Math.round(parseFloat(m[1]) * mult);
}

/* ---------- empty workspace ---------- */
export function emptyData() {
  return {
    ws: { id: null, name: 'Gr8r Studio', url: '', c: '#2F2E2A' },
    workspaces: [],
    me: null,
    members: [],
    teams: [],
    projects: [],
    tasks: [],
    comments: [],
    activity: [],
    notifs: [],
    files: [],
    events: [],
    projOrder: [],
    savedViews: [],
    recentSearches: [],
    notifPrefs: {},
  };
}

/* =====================================================================
   hydrate: database rows → S.data
   rows: { workspace, members, teams, projects, project_members, tasks, subtasks, task_dependencies, files,
           comments, activity, notifications, events, saved_views, task_favorites, project_favorites,
           member_state, profile }
   ctx:  { wsId, meId, userId, workspaces }
   ===================================================================== */
export function hydrate(rows, ctx) {
  const d = emptyData();
  const w = rows.workspace;
  d.ws = { id: w.id, name: w.name, url: w.slug, c: w.color };
  d.workspaces = (ctx.workspaces || []).map(x => ({ id: x.id, name: x.name, c: x.color, role: ROLE_UP[x.role] || 'Member' }));
  d.me = ctx.meId;

  d.teams = (rows.teams || []).map(t => ({ id: t.id, name: t.name, icon: t.icon, c: t.color, desc: t.description }));
  d.members = (rows.members || []).map(m => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: ROLE_UP[m.role] || 'Member',
    team: m.team_id || '',
    title: m.title,
    c: m.color,
    status: m.status,
    last: m.status === 'invited' ? null : minsSince(m.last_seen_at),
    tz: m.timezone || '—',
    userId: m.user_id || null,
  }));

  const pmBy = groupBy(rows.project_members || [], 'project_id');
  const favP = new Set((rows.project_favorites || []).map(f => f.project_id));
  const favT = new Set((rows.task_favorites || []).map(f => f.task_id));
  const lastTaskUpdate = {};
  for (const t of rows.tasks || []) {
    const ms = toMs(t.updated_at) || 0;
    if (ms > (lastTaskUpdate[t.project_id] || 0)) lastTaskUpdate[t.project_id] = ms;
  }
  d.projects = (rows.projects || []).map(p => {
    const pms = pmBy[p.id] || [];
    const perms = {};
    for (const pm of pms) if (pm.permission) perms[pm.member_id] = pm.permission;
    const lastMs = Math.max(toMs(p.updated_at) || 0, lastTaskUpdate[p.id] || 0);
    const o = {
      id: p.id,
      key: p.key,
      name: p.name,
      icon: p.icon,
      color: p.color,
      status: p.status,
      team: p.team_id || '',
      lead: p.lead_id || null,
      due: p.due_date,
      start: p.start_date,
      fav: favP.has(p.id),
      members: pms.map(pm => pm.member_id),
      perms,
      access: p.is_private ? 'private' : 'workspace',
      private: !!p.is_private,
      desc: p.description,
      milestones: Array.isArray(p.milestones) ? p.milestones : [],
      seq: p.task_seq,
      last: lastMs ? Math.max(0, Math.round((Date.now() - lastMs) / 6e4)) : 0,
      created: toMs(p.created_at) || 0,
      createdBy: p.created_by || null,
    };
    if (p.archived_at) {
      o.archived = true;
      o.archivedAt = toMs(p.archived_at);
    }
    return o;
  });

  const subBy = groupBy(rows.subtasks || [], 'task_id');
  const depBy = groupBy(rows.task_dependencies || [], 'task_id');
  const fileRows = [...(rows.files || [])].sort((a, b) => (toMs(b.created_at) || 0) - (toMs(a.created_at) || 0));
  d.files = fileRows.map(fileFromRow);
  const attBy = groupBy(
    d.files.filter(f => f.task),
    'task',
  );
  d.tasks = (rows.tasks || []).map(t => {
    const o = {
      id: t.id,
      key: t.key,
      project: t.project_id,
      title: t.title,
      status: t.status,
      assignee: t.assignee_id || null,
      priority: t.priority,
      due: t.due_date,
      start: t.start_date,
      labels: t.labels || [],
      subtasks: (subBy[t.id] || [])
        .sort((a, b) => a.position - b.position)
        .map(s => {
          const x = { id: s.id, title: s.title, done: !!s.done };
          if (s.assignee_id) x.assignee = s.assignee_id;
          if (s.due_date) x.due = s.due_date;
          if (s.note) x.note = s.note;
          return x;
        }),
      attachments: (attBy[t.id] || []).map(attachmentOf).reverse(),
      deps: (depBy[t.id] || []).map(x => x.depends_on_id),
      desc: t.description,
      estimate: t.estimate || null,
      created: toMs(t.created_at) || 0,
      updated: toMs(t.updated_at) || 0,
      order: t.position,
      fav: favT.has(t.id),
      recur: t.recurrence || null,
      createdBy: t.created_by || null,
    };
    if (t.completed_at) o.completedAt = toMs(t.completed_at);
    if (t.prev_status) o.prevStatus = t.prev_status;
    if (t.archived_at) {
      o.archived = true;
      o.archivedAt = toMs(t.archived_at);
    }
    return o;
  });

  d.comments = [...(rows.comments || [])]
    .sort((a, b) => (toMs(a.created_at) || 0) - (toMs(b.created_at) || 0))
    .map(c => ({ id: c.id, task: c.task_id, by: c.author_id || null, at: toMs(c.created_at) || 0, text: c.body, re: c.reactions || {} }));
  d.activity = [...(rows.activity || [])]
    .sort((a, b) => (toMs(b.created_at) || 0) - (toMs(a.created_at) || 0))
    .map(a => ({
      id: a.id,
      by: a.actor_id || null,
      verb: a.verb,
      task: a.task_id || null,
      project: a.project_id || null,
      at: toMs(a.created_at) || 0,
      extra: a.extra || '',
    }));
  d.notifs = [...(rows.notifications || [])]
    .sort((a, b) => (toMs(b.created_at) || 0) - (toMs(a.created_at) || 0))
    .map(n => {
      const o = { id: n.id, type: n.type, by: n.actor_id || null, text: n.text, snippet: n.snippet, at: toMs(n.created_at) || 0, read: !!n.read_at };
      if (n.task_id) o.task = n.task_id;
      if (n.project_id) o.project = n.project_id;
      if (n.read_at) o.readAt = toMs(n.read_at);
      return o;
    });
  d.events = [...(rows.events || [])]
    .sort((a, b) => (a.event_date + a.event_time).localeCompare(b.event_date + b.event_time))
    .map(e => ({ id: e.id, title: e.title, date: e.event_date, time: e.event_time, project: e.project_id || null }));
  d.savedViews = [...(rows.saved_views || [])]
    .sort((a, b) => (toMs(a.created_at) || 0) - (toMs(b.created_at) || 0))
    .map(v => ({
      id: v.id,
      project: v.project_id,
      name: v.name,
      type: v.type,
      filters: Array.isArray(v.config?.filters) ? v.config.filters : [],
      created: toMs(v.created_at) || 0,
    }));

  const st = rows.member_state?.state || {};
  d.projOrder = Array.isArray(st.projOrder) ? st.projOrder.filter(x => typeof x === 'string') : [];
  d.recentSearches = Array.isArray(st.recentSearches) ? st.recentSearches.filter(x => typeof x === 'string').slice(0, 5) : [];
  d.notifPrefs = rows.profile?.notif_prefs && typeof rows.profile.notif_prefs === 'object' ? { ...rows.profile.notif_prefs } : {};

  normalize(d);
  return { data: d, views: st.views && typeof st.views === 'object' ? st.views : {} };
}

function fileFromRow(f) {
  return {
    id: f.id,
    project: f.project_id,
    name: f.name,
    type: f.kind,
    size: fmtBytes(Number(f.size_bytes) || 0),
    bytes: Number(f.size_bytes) || 0,
    mime: f.mime || '',
    path: f.storage_path || null,
    by: f.uploaded_by || null,
    at: toMs(f.created_at) || 0,
    task: f.task_id || null,
  };
}
const attachmentOf = f => ({ id: f.id, name: f.name, type: f.type, size: f.size, bytes: f.bytes, mime: f.mime, path: f.path, by: f.by, at: f.at });

function groupBy(list, key) {
  const out = {};
  for (const x of list) (out[x[key]] ||= []).push(x);
  return out;
}

/* =====================================================================
   normalize: make the in-memory workspace consistent, mirroring what the
   database enforces (primary keys, foreign keys with ON DELETE CASCADE /
   SET NULL). Runs before every diff; it is idempotent.
   ===================================================================== */
export function normalize(d) {
  for (const k of ['members', 'teams', 'projects', 'tasks', 'comments', 'activity', 'notifs', 'files', 'events', 'savedViews', 'projOrder', 'recentSearches'])
    if (!Array.isArray(d[k])) d[k] = [];
  if (!d.notifPrefs || typeof d.notifPrefs !== 'object') d.notifPrefs = {};

  const memberIds = new Set(d.members.map(m => m.id));
  const teamIds = new Set(d.teams.map(t => t.id));
  const projectIds = new Set(d.projects.map(p => p.id));
  const hasMember = id => id != null && memberIds.has(id);

  for (const m of d.members) if (m.team && !teamIds.has(m.team)) m.team = '';

  for (const p of d.projects) {
    if (p.team && !teamIds.has(p.team)) p.team = '';
    if (p.lead && !hasMember(p.lead)) p.lead = null;
    p.members = [...new Set((p.members || []).filter(hasMember))];
    if (!p.perms || typeof p.perms !== 'object') p.perms = {};
    for (const k of Object.keys(p.perms)) if (!p.members.includes(k)) delete p.perms[k];
    if (!Array.isArray(p.milestones)) p.milestones = [];
    p.private = !!p.private;
    p.access = p.private ? 'private' : 'workspace';
    if (p.archived && !p.archivedAt) p.archivedAt = Date.now();
  }

  // tasks: drop the ones whose project is gone, then repair references
  d.tasks = d.tasks.filter(t => projectIds.has(t.project));
  const taskIds = new Set(d.tasks.map(t => t.id));
  const seenSub = new Set();
  for (const t of d.tasks) {
    if (t.assignee && !hasMember(t.assignee)) t.assignee = null;
    if (!Array.isArray(t.labels)) t.labels = [];
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    if (!Array.isArray(t.attachments)) t.attachments = [];
    t.deps = [...new Set((t.deps || []).filter(x => x !== t.id && taskIds.has(x)))];
    for (const s of t.subtasks) {
      // duplicated tasks used to copy subtask ids; ids must be unique across the workspace
      if (!s.id || seenSub.has(s.id)) s.id = newId();
      seenSub.add(s.id);
      if (s.assignee && !hasMember(s.assignee)) s.assignee = null;
    }
    if (t.archived && !t.archivedAt) t.archivedAt = Date.now();
  }

  // files: one record per file. `d.files` is the only source of truth; task.attachments is derived from it
  // below, so removing a record from `d.files` is all it takes to detach and delete a file.
  d.files = d.files.filter(f => projectIds.has(f.project));
  for (const f of d.files) {
    if (f.task && !taskIds.has(f.task)) f.task = null;
    if (typeof f.bytes !== 'number') f.bytes = parseBytes(f.size);
    if (f.task) {
      const t = d.tasks.find(x => x.id === f.task);
      if (t.project !== f.project) f.project = t.project;
    }
  }
  const attBy = groupBy(
    d.files.filter(f => f.task),
    'task',
  );
  for (const t of d.tasks) {
    const want = (attBy[t.id] || []).map(attachmentOf);
    const order = new Map(t.attachments.map((a, i) => [a.id, i]));
    want.sort((a, b) => (order.has(a.id) ? order.get(a.id) : 1e9) - (order.has(b.id) ? order.get(b.id) : 1e9) || a.at - b.at);
    t.attachments = want;
  }

  d.comments = d.comments.filter(c => taskIds.has(c.task));
  for (const c of d.comments) {
    if (!c.re || typeof c.re !== 'object') c.re = {};
    for (const e of Object.keys(c.re)) {
      c.re[e] = (c.re[e] || []).filter(hasMember);
      if (!c.re[e].length) delete c.re[e];
    }
  }
  d.activity = d.activity.filter(a => (!a.task || taskIds.has(a.task)) && (!a.project || projectIds.has(a.project)));
  // Authorship (comment, activity, notification, file) is left untouched when the author is gone: the database
  // clears it itself when the member row is deleted, and the UI shows such authors as former members.
  d.notifs = d.notifs.filter(n => (!n.task || taskIds.has(n.task)) && (!n.project || projectIds.has(n.project)));
  for (const n of d.notifs) {
    if (n.read && !n.readAt) n.readAt = Date.now();
    if (!n.read) delete n.readAt;
  }
  d.events = d.events.filter(e => !e.project || projectIds.has(e.project));
  d.savedViews = d.savedViews.filter(v => projectIds.has(v.project));

  // projOrder decides which projects are listed at all: every project must be in it exactly once
  const order = [...new Set(d.projOrder.filter(id => projectIds.has(id)))];
  const inOrder = new Set(order);
  const missing = d.projects.filter(p => !inOrder.has(p.id)).sort((a, b) => (a.created || 0) - (b.created || 0));
  d.projOrder = [...order, ...missing.map(p => p.id)];
  return d;
}

/* =====================================================================
   flatten: S.data (+ prefs, views) → rows keyed by primary key
   state: { data, prefs, views }
   ctx:   { wsId, meId, userId }
   ===================================================================== */
export function flatten(state, ctx) {
  const d = state.data;
  const out = Object.fromEntries(TABLES.map(t => [t.name, new Map()]));
  const put = (table, row) => out[table].set(keyOf(table, row), row);
  const ws = ctx.wsId;
  if (!ws || !ctx.meId) return out;

  put('workspaces', { id: ws, name: str(d.ws.name, 80, 'Workspace').trim() || 'Workspace', slug: slug(d.ws.url), color: str(d.ws.c, 32, '#2F2E2A') });
  put('profiles', {
    id: ctx.userId,
    full_name: str(state.prefs?.name, 120),
    prefs: cleanJson(state.prefs || {}),
    notif_prefs: cleanJson(d.notifPrefs || {}),
  });

  for (const t of d.teams)
    put('teams', {
      id: t.id,
      workspace_id: ws,
      name: str(t.name, 80, 'Team').trim() || 'Team',
      icon: str(t.icon, 40, 'users'),
      color: str(t.c, 32, '#8A867E'),
      description: str(t.desc, 500),
    });

  for (const m of d.members)
    put('members', {
      id: m.id,
      workspace_id: ws,
      email: str(m.email, 254).trim().toLowerCase(),
      name: str(m.name, 120, 'Member').trim() || 'Member',
      role: oneOf(String(m.role || '').toLowerCase(), ['owner', 'admin', 'member', 'guest'], 'member'),
      status: oneOf(m.status, ['active', 'invited', 'deactivated'], 'invited'),
      team_id: m.team || null,
      title: str(m.title, 120),
      color: str(m.c, 32, '#6B7280'),
      timezone: m.tz === '—' ? '' : str(m.tz, 80),
    });

  put('member_state', {
    member_id: ctx.meId,
    state: cleanJson({ projOrder: d.projOrder, recentSearches: (d.recentSearches || []).slice(0, 5), views: pruneViews(state.views || {}, d) }),
  });

  for (const p of d.projects) {
    put('projects', {
      id: p.id,
      workspace_id: ws,
      key: str(
        String(p.key || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ''),
        10,
        'P',
      ),
      name: str(p.name, 120, 'Untitled project').trim() || 'Untitled project',
      icon: str(p.icon, 40, 'folder'),
      color: str(p.color, 32, 'indigo'),
      status: oneOf(p.status, PSTATUS, 'planning'),
      team_id: p.team || null,
      lead_id: p.lead || null,
      start_date: dateOrNull(p.start),
      due_date: dateOrNull(p.due),
      description: str(p.desc, 20000),
      is_private: !!p.private,
      milestones: cleanJson((p.milestones || []).map(m => ({ name: str(m.name, 200), date: dateOrNull(m.date) }))),
      task_seq: Number.isInteger(p.seq) && p.seq >= 0 ? p.seq : 200,
      archived_at: p.archived ? toIso(p.archivedAt) : null,
      created_by: p.createdBy || ctx.userId,
    });
    for (const mid of p.members || []) put('project_members', { project_id: p.id, member_id: mid, permission: oneOf(p.perms?.[mid], PERMS, null) });
    if (p.fav) put('project_favorites', { member_id: ctx.meId, project_id: p.id });
  }

  for (const t of d.tasks) {
    put('tasks', {
      id: t.id,
      project_id: t.project,
      key: str(t.key, 24, 'T'),
      title: str(t.title, 500, 'Untitled').trim() || 'Untitled',
      description: str(t.desc, 100000),
      status: oneOf(t.status, STATUS, 'todo'),
      prev_status: oneOf(t.prevStatus, STATUS, null),
      priority: oneOf(t.priority, PRIORITY, 'none'),
      assignee_id: t.assignee || null,
      start_date: dateOrNull(t.start),
      due_date: dateOrNull(t.due),
      estimate: t.estimate ? str(t.estimate, 40) : null,
      labels: (t.labels || []).filter(x => typeof x === 'string').map(x => x.slice(0, 40)),
      recurrence: oneOf(t.recur, RECUR, null),
      position: Number.isFinite(t.order) ? t.order : 0,
      completed_at: toIso(t.completedAt),
      archived_at: t.archived ? toIso(t.archivedAt) : null,
      created_by: t.createdBy || ctx.userId,
      created_at: toIso(t.created) || toIso(0),
      updated_at: toIso(t.updated) || toIso(t.created) || toIso(0),
    });
    t.subtasks.forEach((s, i) =>
      put('subtasks', {
        id: s.id,
        task_id: t.id,
        title: str(s.title, 500, 'Untitled').trim() || 'Untitled',
        done: !!s.done,
        assignee_id: s.assignee || null,
        due_date: dateOrNull(s.due),
        note: str(s.note, 20000),
        position: i,
      }),
    );
    for (const dep of t.deps || []) put('task_dependencies', { task_id: t.id, depends_on_id: dep });
    if (t.fav) put('task_favorites', { member_id: ctx.meId, task_id: t.id });
  }

  for (const f of d.files)
    put('files', {
      id: f.id,
      project_id: f.project,
      task_id: f.task || null,
      name: str(f.name, 255, 'file'),
      kind: str(f.type, 20, 'other'),
      mime: str(f.mime, 255),
      size_bytes: Number.isFinite(f.bytes) ? Math.max(0, Math.round(f.bytes)) : 0,
      storage_path: f.path || null,
      uploaded_by: f.by || null,
      created_at: toIso(f.at) || toIso(0),
    });

  for (const c of d.comments)
    put('comments', {
      id: c.id,
      task_id: c.task,
      author_id: c.by || null,
      body: str(c.text, 20000, ' '),
      reactions: cleanJson(c.re || {}),
      created_at: toIso(c.at) || toIso(0),
    });

  for (const a of d.activity)
    put('activity', {
      id: a.id,
      workspace_id: ws,
      actor_id: a.by || null,
      verb: str(a.verb, 80, 'updated'),
      task_id: a.task || null,
      project_id: a.project || null,
      extra: str(a.extra, 600),
      created_at: toIso(a.at) || toIso(0),
    });

  for (const n of d.notifs) if (NOTIF_TYPES.includes(n.type)) put('notifications', { id: n.id, read_at: n.read ? toIso(n.readAt) : null });

  for (const e of d.events)
    put('events', {
      id: e.id,
      workspace_id: ws,
      project_id: e.project || null,
      title: str(e.title, 200, 'Event'),
      event_date: dateOrNull(e.date) || '1970-01-01',
      event_time: /^[0-2]\d:[0-5]\d$/.test(e.time || '') ? e.time : '',
    });

  for (const v of d.savedViews)
    put('saved_views', {
      id: v.id,
      project_id: v.project,
      name: str(v.name, 80, 'View').trim() || 'View',
      type: str(v.type, 20, 'list'),
      config: cleanJson({ filters: v.filters || [] }),
    });

  return out;
}

const slug = v =>
  String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';

/* JSON round trip: drops undefined/functions so values compare equal to what the database returns. */
const cleanJson = v => JSON.parse(JSON.stringify(v ?? null));

/* View configs are keyed by 'p:<projectId>' / 'sv:<savedViewId>'; drop the ones whose target is gone. */
function pruneViews(views, d) {
  const projects = new Set(d.projects.map(p => p.id));
  const saved = new Set(d.savedViews.map(v => v.id));
  const out = {};
  for (const [k, v] of Object.entries(views)) {
    if (k.startsWith('p:') && !projects.has(k.slice(2))) continue;
    if (k.startsWith('sv:') && !saved.has(k.slice(3))) continue;
    out[k] = v;
  }
  return out;
}

/* =====================================================================
   diff: two flatten() results → operations per table
   ===================================================================== */
export const stable = v => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return (
    '{' +
    Object.keys(v)
      .sort()
      .map(k => JSON.stringify(k) + ':' + stable(v[k]))
      .join(',') +
    '}'
  );
};

export function diff(base, cur) {
  const ops = {};
  let count = 0;
  for (const { name, pk } of TABLES) {
    const b = base[name] || new Map();
    const c = cur[name] || new Map();
    const inserts = [],
      updates = [],
      deletes = [];
    for (const [key, row] of c) {
      const old = b.get(key);
      if (!old) {
        inserts.push(row);
        continue;
      }
      let patch = null;
      for (const col of Object.keys(row)) {
        if (pk.includes(col)) continue;
        if (stable(row[col]) !== stable(old[col])) (patch ||= {})[col] = row[col];
      }
      if (patch) updates.push({ key, row, patch });
    }
    for (const [key, row] of b) if (!c.has(key)) deletes.push({ key, row });
    if (inserts.length || updates.length || deletes.length) {
      ops[name] = { inserts, updates, deletes };
      count += inserts.length + updates.length + deletes.length;
    }
  }
  return { ops, count };
}
