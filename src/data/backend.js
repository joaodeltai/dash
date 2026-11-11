/* =====================================================================
   BACKEND: session lifecycle, workspace loading, realtime, file storage.
   This is the only module (besides sync.js) that talks to Supabase.
   ===================================================================== */
import { AUTH_PROVIDERS, MAX_FILE_BYTES, SUPABASE_KEY, SUPABASE_URL, ctx, isConfigured, sb, urlIntent } from './supabase.js';
import { TABLE, emptyData, flatten, fmtBytes, hydrate, keyOf, newId, stable } from './mappers.js';
import { createSync } from './sync.js';
import { DEFAULT_PREFS, S, cachePrefs, setPersist, task } from '../core/store.js';
import { fileType } from '../ui/helpers.js';
import { toast } from '../ui/toast.js';
import { openUrl, render } from '../shell/render.js';

export { AUTH_PROVIDERS, MAX_FILE_BYTES, ctx, isConfigured };
const WS_KEY = 'dash.ws';
const ACTIVITY_LIMIT = 1000;
const NOTIF_LIMIT = 500;

export class BackendError extends Error {
  constructor(message, { code, status, kind } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.kind = kind;
  }
}
const fail = (error, status) =>
  new BackendError(error?.message || 'Something went wrong', { code: error?.code, status, kind: !status || status >= 500 ? 'network' : 'rejected' });
const unwrap = res => {
  if (res.error) throw fail(res.error, res.status);
  return res.data;
};

/* ---------------------------------------------------------------------
   Sync wiring
   --------------------------------------------------------------------- */
export const sync = createSync({
  getClient: () => sb,
  getContext: () => ctx,
  getState: () => ({ data: S.data, prefs: S.prefs, views: S.views }),
  onStatus(status) {
    const wasOffline = S.ui.offline;
    S.ui.sync = status;
    if (status === 'offline' && !wasOffline) {
      S.ui.offline = true;
      render();
    } else if (status === 'idle' && wasOffline && navigator.onLine !== false) {
      S.ui.offline = false;
      render();
      toast('Back online. All changes are saved.');
    }
    paintSyncState();
  },
  onRejected(err) {
    console.error('[sync] change rejected', err.table, err.op, err.code, err.message);
    toast(`Couldn't save your last change. ${friendly(err)}`, { kind: 'err', ms: 7000 });
    void refresh({ force: true });
  },
  onAuthLost() {
    toast('Your session expired. Sign in again to keep working.', { kind: 'err', ms: 7000 });
    void sb.auth.signOut({ scope: 'local' });
  },
  onDeletedFiles(paths) {
    void sb.storage.from('files').remove(paths);
  },
});

export function friendly(err) {
  if (err?.code === '42501' || err?.code === 'NOT_UPDATED' || /row-level security|permission denied|not allowed/i.test(err?.message || ''))
    return "You don't have permission to do that.";
  if (err?.code === '23505') return err.table === 'members' ? 'That person is already in this workspace.' : 'That already exists.';
  if (err?.code === '23503') return 'Something it depends on no longer exists.';
  if (err?.kind === 'network') return 'Check your connection and try again.';
  return err?.message || 'Please try again.';
}

/* A tiny "Saving…" hint without a full re-render. */
function paintSyncState() {
  const el = document.getElementById('sync-state');
  if (!el) return;
  const s = S.ui.sync;
  el.dataset.s = s || 'idle';
  el.textContent = s === 'saving' ? 'Saving…' : s === 'offline' ? 'Offline' : s === 'error' ? 'Not saved' : '';
}

const stateOf = () => ({ data: S.data, prefs: S.prefs, views: S.views });

/* ---------------------------------------------------------------------
   Boot and auth state
   --------------------------------------------------------------------- */
let booted = false;
let entering = null;

export async function boot(initialRoute) {
  setPersist(() => sync.schedule());
  if (!isConfigured) {
    S.ui.booting = false;
    S.ui.auth = 'setup';
    render();
    return;
  }
  S.ui.booting = true;
  render();

  sb.auth.onAuthStateChange((event, session) => {
    // Never await Supabase calls inside this callback (it holds the auth lock): defer the work.
    if (event === 'PASSWORD_RECOVERY') {
      S.ui.af = { email: session?.user?.email || '', name: '' };
      setTimeout(() => showAuth('reset'), 0);
    } else if (event === 'SIGNED_OUT') {
      setTimeout(() => {
        teardown();
        showAuth('login');
      }, 0);
    } else if (event === 'SIGNED_IN' && booted && session && session.user.id !== ctx.userId) {
      setTimeout(() => void enterSession(session).catch(bootFailed), 0);
    } else if (event === 'USER_UPDATED' && session) {
      ctx.email = session.user.email;
    }
  });

  window.addEventListener('online', () => void retryConnection());
  window.addEventListener('offline', () => {
    S.ui.offline = true;
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void sync.flush({ force: true });
    else if (Date.now() - lastPull > 60000) void refresh();
  });
  window.addEventListener('pagehide', () => void sync.flush({ force: true }));

  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    booted = true;
    if (urlIntent.error) {
      S.ui.errors = { login: urlIntent.error.replace(/\+/g, ' ') };
      return showAuth('login');
    }
    const asked = String(initialRoute || '').replace(/^#\/?/, '');
    if (!data.session) return showAuth(['login', 'signup', 'forgot'].includes(asked) ? asked : 'login');
    if (urlIntent.recovery) {
      setIdentity(data.session);
      S.ui.af = { email: ctx.email, name: '' };
      return showAuth('reset');
    }
    await enterSession(data.session, initialRoute);
  } catch (err) {
    booted = true;
    bootFailed(err);
  }
}

function bootFailed(err) {
  console.error('[boot]', err);
  S.ui.booting = false;
  S.ui.bootError = friendly(err instanceof BackendError ? err : { kind: 'network', message: err?.message });
  render();
}

function showAuth(screen) {
  S.ui.booting = false;
  S.ui.bootError = null;
  S.ui.loading = false;
  S.ui.auth = screen;
  render();
}

function setIdentity(session) {
  ctx.userId = session.user.id;
  ctx.email = session.user.email || '';
}

/* Signed in: link pending invitations, find the user's workspaces, open one (or start onboarding). */
export function enterSession(session, initialRoute) {
  if (entering) return entering;
  entering = (async () => {
    setIdentity(session);
    S.ui.af = { email: ctx.email, name: '' };
    S.ui.booting = true;
    S.ui.bootError = null;
    render();
    await sb.rpc('claim_invitations').then(unwrap);
    ctx.profile = unwrap(await sb.from('profiles').select('*').eq('id', ctx.userId).single());
    await loadMemberships();
    if (!ctx.workspaces.length) {
      S.ui.booting = false;
      S.ui.auth = 'onboarding';
      S.ui.onb = 0;
      S.ui.onbData.ws = '';
      S.ui.onbData.url = '';
      render();
      return;
    }
    let stored = null;
    try {
      stored = localStorage.getItem(WS_KEY);
    } catch {
      /* storage blocked: fall back to the first workspace */
    }
    const target = ctx.workspaces.find(w => w.id === stored) || ctx.workspaces[0];
    // a deep link opened while signed out is honoured once the person is in
    await openWorkspace(target.id, { route: initialRoute ?? location.hash });
  })().finally(() => {
    entering = null;
  });
  return entering;
}

async function loadMemberships() {
  const rows = unwrap(
    await sb
      .from('members')
      .select('id, role, workspace_id, created_at, workspaces(id, name, slug, color)')
      .eq('user_id', ctx.userId)
      .eq('status', 'active')
      .order('created_at'),
  );
  ctx.workspaces = rows
    .filter(r => r.workspaces)
    .map(r => ({ id: r.workspaces.id, name: r.workspaces.name, slug: r.workspaces.slug, color: r.workspaces.color, role: r.role, memberId: r.id }));
}

function teardown() {
  unsubscribe();
  sync.stop();
  Object.assign(ctx, { userId: null, email: null, wsId: null, meId: null, workspaces: [], profile: null });
  S.data = emptyData();
  S.views = {};
  Object.assign(S.ui, {
    drawer: null,
    modals: [],
    pop: null,
    palette: null,
    sel: new Set(),
    offline: false,
    loading: false,
    history: [],
    route: 'home',
    params: {},
  });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* history unavailable */
  }
}

/* ---------------------------------------------------------------------
   Loading a workspace
   --------------------------------------------------------------------- */
async function fetchAll(table, build = q => q, order = TABLE[table]?.pk || ['id']) {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = build(sb.from(table).select('*'));
    for (const col of order) q = q.order(col);
    const res = await q.range(from, from + page - 1);
    if (res.error) throw fail(res.error, res.status);
    out.push(...res.data);
    if (res.data.length < page) break;
  }
  return out;
}

async function fetchRows(wsId) {
  const inWs = q => q.eq('workspace_id', wsId);
  const [
    workspace,
    profile,
    members,
    teams,
    projects,
    project_members,
    tasks,
    subtasks,
    task_dependencies,
    files,
    comments,
    activity,
    notifications,
    events,
    saved_views,
    task_favorites,
    project_favorites,
  ] = await Promise.all([
    sb
      .from('workspaces')
      .select('*')
      .eq('id', wsId)
      .maybeSingle()
      .then(unwrap)
      .then(w => {
        // no row = the workspace is gone or this account was removed from it
        if (!w) throw new BackendError('You are no longer a member of this workspace.', { code: 'NOT_A_MEMBER', kind: 'rejected' });
        return w;
      }),
    sb.from('profiles').select('*').eq('id', ctx.userId).single().then(unwrap),
    fetchAll('members', inWs, ['created_at', 'id']),
    fetchAll('teams', inWs, ['created_at', 'id']),
    fetchAll('projects', inWs, ['created_at', 'id']),
    fetchAll('project_members', inWs),
    fetchAll('tasks', inWs),
    fetchAll('subtasks', inWs),
    fetchAll('task_dependencies', inWs),
    fetchAll('files', inWs),
    fetchAll('comments', inWs),
    sb.from('activity').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(ACTIVITY_LIMIT).then(unwrap),
    sb.from('notifications').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(NOTIF_LIMIT).then(unwrap),
    fetchAll('events', inWs),
    fetchAll('saved_views', inWs),
    fetchAll('task_favorites', inWs),
    fetchAll('project_favorites', inWs),
  ]);
  const mine = members.find(m => m.user_id === ctx.userId && m.status === 'active');
  if (!mine) throw new BackendError('You are no longer a member of this workspace.', { code: 'NOT_A_MEMBER', kind: 'rejected' });
  const member_state = unwrap(await sb.from('member_state').select('*').eq('member_id', mine.id).maybeSingle());
  if (!member_state)
    unwrap(await sb.from('member_state').upsert({ member_id: mine.id, workspace_id: wsId, state: {} }, { onConflict: 'member_id', ignoreDuplicates: true }));
  return {
    mine,
    rows: {
      workspace,
      profile,
      members,
      teams,
      projects,
      project_members,
      tasks,
      subtasks,
      task_dependencies,
      files,
      comments,
      activity,
      notifications,
      events,
      saved_views,
      task_favorites,
      project_favorites,
      member_state: member_state || { state: {} },
    },
  };
}

/* Puts freshly fetched rows in memory and makes them the new sync baseline. */
function applyRows({ mine, rows }, wsId) {
  ctx.wsId = wsId;
  ctx.meId = mine.id;
  ctx.profile = rows.profile;
  const { data, views } = hydrate(rows, ctx);
  const meRow = data.members.find(m => m.id === mine.id);
  if (meRow) meRow.last = 0;
  S.data = data;
  S.views = views;
  S.prefs = { ...DEFAULT_PREFS, ...(rows.profile.prefs || {}), name: mine.name, title: mine.title || '' };
  cachePrefs();
  sync.setBaseline(flatten(stateOf(), ctx));
  if (S.ui.drawer && !task(S.ui.drawer)) S.ui.drawer = null;
}

let lastPull = 0;
export async function openWorkspace(wsId, { route } = {}) {
  if (sync.hasBaseline()) await sync.flush({ force: true }).catch(() => {});
  unsubscribe();
  sync.stop();
  if (!S.ui.booting) {
    S.ui.loading = true;
    render();
  }
  const loaded = await fetchRows(wsId);
  applyRows(loaded, wsId);
  lastPull = Date.now();
  try {
    localStorage.setItem(WS_KEY, wsId);
  } catch {
    /* storage blocked: the workspace choice just won't be remembered */
  }
  subscribe(wsId);
  void sb.rpc('touch_presence', { ws: wsId });
  Object.assign(S.ui, {
    booting: false,
    bootError: null,
    loading: false,
    auth: null,
    drawer: null,
    modals: [],
    pop: null,
    palette: null,
    history: [],
    expanded: {},
  });
  S.ui.sel.clear();
  S.ui.route = 'home';
  S.ui.params = {};
  const notice = openUrl(route || '');
  if (notice) toast(notice, { kind: 'info', ms: 6000 });
}

/* Re-reads the workspace from the database. Skipped while local changes are waiting to be saved, unless forced
   (a rejected change: the server state wins and the local edit is dropped). */
let pulling = null;
let pullAgain = null;
export function refresh({ force = false } = {}) {
  if (!ctx.wsId || !sync.hasBaseline()) return Promise.resolve();
  if (pulling) return pulling;
  const busy = () => sync.isRunning() || sync.pending() > 0;
  const later = () => {
    // Whatever is pending must be on its way to the database, or the refresh would wait forever
    // (state can change during a render, without any action calling save()).
    sync.schedule();
    clearTimeout(pullAgain);
    pullAgain = setTimeout(() => void refresh(), 2500);
  };
  if (!force && busy()) {
    later();
    return Promise.resolve();
  }
  const wsId = ctx.wsId;
  pulling = (async () => {
    try {
      const loaded = await fetchRows(wsId);
      if (ctx.wsId !== wsId) return;
      if (!force && busy()) return later();
      applyRows(loaded, wsId);
      lastPull = Date.now();
      renderWhenSafe();
    } catch (err) {
      if (err?.code === 'NOT_A_MEMBER') {
        toast('You no longer have access to this workspace.', { kind: 'err', ms: 7000 });
        await reenter();
      } else if (force) console.error('[refresh]', err);
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

/* A background refresh must not wipe what someone is typing: wait until no field or dialog is in use. */
let safeTimer = null;
function renderWhenSafe(tries = 0) {
  clearTimeout(safeTimer);
  const a = document.activeElement;
  const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  const busy = typing || S.ui.modals.length || S.ui.pop || S.ui.palette || S.ui.composer || S.ui.editCell || S.ui.auth;
  if (busy && tries < 40) {
    safeTimer = setTimeout(() => renderWhenSafe(tries + 1), 1500);
    return;
  }
  if (!S.ui.auth) render();
}

async function reenter() {
  const { data } = await sb.auth.getSession();
  unsubscribe();
  sync.stop();
  ctx.wsId = null;
  ctx.meId = null;
  S.data = emptyData();
  if (data.session) await enterSession(data.session).catch(bootFailed);
  else showAuth('login');
}

export async function retryConnection() {
  if (navigator.onLine === false) return false;
  try {
    await sync.flush();
    if (sync.status() === 'offline') return false;
    const wasOffline = S.ui.offline;
    S.ui.offline = false;
    await refresh();
    if (wasOffline) render();
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------
   Realtime: changes made by other people or other devices
   --------------------------------------------------------------------- */
const RT_TABLES = [
  'workspaces',
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
  'notifications',
  'events',
  'saved_views',
];
let channel = null;
let rtQueue = [];
let rtTimer = null;

function subscribe(wsId) {
  unsubscribe();
  channel = sb.channel('ws:' + wsId);
  const queue = table => payload => {
    rtQueue.push({ table, payload });
    clearTimeout(rtTimer);
    rtTimer = setTimeout(drainRealtime, 700);
  };
  for (const table of RT_TABLES) {
    const filter = table === 'workspaces' ? `id=eq.${wsId}` : `workspace_id=eq.${wsId}`;
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, queue(table));
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, queue(table));
    // A DELETE event only carries the primary key, so it cannot be filtered by workspace. Keys we do not know
    // (other workspaces, or our own deletes) are ignored in isEcho().
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, queue(table));
  }
  channel.subscribe();
}
function unsubscribe() {
  clearTimeout(rtTimer);
  clearTimeout(pullAgain);
  rtQueue = [];
  if (channel) void sb.removeChannel(channel);
  channel = null;
}
function drainRealtime() {
  if (!sync.hasBaseline()) return (rtQueue = []);
  if (sync.isRunning() || sync.pending() > 0) {
    sync.schedule();
    rtTimer = setTimeout(drainRealtime, 900);
    return;
  }
  const foreign = rtQueue.some(({ table, payload }) => !isEcho(table, payload));
  rtQueue = [];
  if (foreign) void refresh();
}
/* Our own writes come back through realtime too; they already match what we know is in the database. */
function isEcho(table, payload) {
  const def = TABLE[table];
  if (!def) return true;
  if (payload.eventType === 'DELETE') {
    const key = def.pk.map(k => payload.old?.[k]).join('|');
    return !sync.baselineRow(table, key);
  }
  const row = payload.new || {};
  const base = sync.baselineRow(table, keyOf(table, row));
  if (!base) return false;
  return Object.keys(base).every(col => sameValue(base[col], row[col]));
}
function sameValue(a, b) {
  if (a === b || (a == null && b == null)) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'string' && typeof b === 'string' && a.includes('T') && b.includes('T')) {
    const x = Date.parse(a),
      y = Date.parse(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y;
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return stable(a) === stable(b);
}

/* ---------------------------------------------------------------------
   Auth operations
   --------------------------------------------------------------------- */
const redirectTo = () => location.origin + location.pathname;
let pendingCredentials = null; // kept in memory only, for the "I've verified my email" step

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (/email not confirmed/i.test(error.message)) {
      pendingCredentials = { email, password };
      throw new BackendError('Confirm your email address before signing in.', { code: 'EMAIL_NOT_CONFIRMED', kind: 'rejected' });
    }
    if (/invalid login credentials/i.test(error.message))
      throw new BackendError('Incorrect email or password.', { code: 'INVALID_CREDENTIALS', kind: 'rejected' });
    throw authFail(error);
  }
  pendingCredentials = null;
  await enterSession(data.session);
}

export async function signUp(name, email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirectTo() } });
  if (error) {
    if (error.code === 'user_already_exists' || /already registered/i.test(error.message || ''))
      throw new BackendError('An account with this email already exists. Sign in instead.', { code: 'USER_EXISTS', kind: 'rejected' });
    throw authFail(error);
  }
  // With email confirmation on, Supabase answers a sign-up for an existing address with an empty identity list.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
    throw new BackendError('An account with this email already exists. Sign in instead.', { code: 'USER_EXISTS', kind: 'rejected' });
  if (data.session) {
    pendingCredentials = null;
    await enterSession(data.session);
    return { needsVerification: false };
  }
  pendingCredentials = { email, password };
  return { needsVerification: true };
}

/* Called from the "Verify your email" screen once the person says they clicked the link. */
export async function completeVerification() {
  const { data } = await sb.auth.getSession();
  if (data.session) return enterSession(data.session);
  if (!pendingCredentials) throw new BackendError('Sign in to continue.', { code: 'NEEDS_LOGIN', kind: 'rejected' });
  const { email, password } = pendingCredentials;
  await signIn(email, password);
}

export async function resendVerification(email) {
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } });
  if (error) throw authFail(error);
}

export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  if (error) throw authFail(error);
}

/* Sets a new password for the current session (recovery link or settings). */
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw authFail(error);
}

/* Settings → Password: the current password is checked before it can be replaced. */
export async function changePassword(current, next) {
  const { error } = await sb.auth.signInWithPassword({ email: ctx.email, password: current });
  if (error) throw new BackendError('Your current password is incorrect.', { code: 'INVALID_CREDENTIALS', kind: 'rejected' });
  await updatePassword(next);
}

/* After a recovery link: the session already exists, continue into the app. */
export async function continueAfterReset() {
  const { data } = await sb.auth.getSession();
  if (data.session) return enterSession(data.session);
  showAuth('login');
}

export async function signInWithProvider(provider) {
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
  if (error) throw authFail(error);
}

export async function signOut() {
  if (sync.hasBaseline()) await Promise.race([sync.flush({ force: true }).catch(() => {}), new Promise(r => setTimeout(r, 4000))]);
  pendingCredentials = null;
  const { error } = await sb.auth.signOut();
  if (error) {
    // even if the server could not be reached, drop the local session
    await sb.auth.signOut({ scope: 'local' });
  }
}

/* Ends every other session of this account (other browsers and devices). */
export async function signOutOtherSessions() {
  const { error } = await sb.auth.signOut({ scope: 'others' });
  if (error) throw authFail(error);
}

function authFail(error) {
  const msg = error?.message || 'Something went wrong';
  if (/rate limit|too many|only request this after/i.test(msg))
    return new BackendError('Too many attempts. Wait a moment and try again.', { code: 'RATE_LIMIT', kind: 'rejected' });
  if (/weak|at least \d+ characters|password should/i.test(msg)) return new BackendError(msg, { code: 'WEAK_PASSWORD', kind: 'rejected' });
  if (/different from the old password/i.test(msg))
    return new BackendError('Choose a password you have not used before.', { code: 'SAME_PASSWORD', kind: 'rejected' });
  if (/failed to fetch|network|load failed/i.test(msg))
    return new BackendError("Can't reach the server. Check your connection and try again.", { kind: 'network' });
  return new BackendError(msg, { code: error?.code, status: error?.status, kind: 'rejected' });
}

/* ---------------------------------------------------------------------
   Workspaces
   --------------------------------------------------------------------- */
export async function slugAvailable(slug) {
  return unwrap(await sb.rpc('workspace_slug_available', { p_slug: slug }));
}

/* Creates a workspace owned by the current user and opens it (empty). */
export async function createWorkspace({ name, slug, color }) {
  const created = unwrap(await sb.rpc('create_workspace', { p_name: name, p_slug: slug || null, p_color: color || null }));
  await loadMemberships();
  await openWorkspace(created.workspace_id);
  return created;
}

export async function switchWorkspace(wsId) {
  if (wsId === ctx.wsId) return;
  await loadMemberships();
  if (!ctx.workspaces.some(w => w.id === wsId)) throw new BackendError('You no longer have access to that workspace.', { kind: 'rejected' });
  await openWorkspace(wsId);
}

/* Owner only. Removes stored files first (the database cascade cannot reach the storage bucket). */
export async function deleteWorkspace() {
  const wsId = ctx.wsId;
  const paths = S.data.files.map(f => f.path).filter(Boolean);
  unsubscribe();
  sync.stop();
  const res = await sb.from('workspaces').delete({ count: 'exact' }).eq('id', wsId);
  if (res.error || !res.count) {
    await openWorkspace(wsId);
    throw res.error ? fail(res.error, res.status) : new BackendError('Only the workspace owner can delete it.', { code: '42501', kind: 'rejected' });
  }
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from('files').remove(paths.slice(i, i + 100));
  try {
    localStorage.removeItem(WS_KEY);
  } catch {
    /* nothing to clear */
  }
  ctx.wsId = null;
  ctx.meId = null;
  S.data = emptyData();
  await loadMemberships();
  if (ctx.workspaces.length) await openWorkspace(ctx.workspaces[0].id);
  else {
    S.ui.auth = 'onboarding';
    S.ui.onb = 0;
    S.ui.onbData.ws = '';
    S.ui.onbData.url = '';
    render();
  }
}

/* ---------------------------------------------------------------------
   Files (Supabase Storage, private bucket `files`)
   --------------------------------------------------------------------- */
const safeName = name =>
  String(name || 'file')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-120) || 'file';

/* Uploads one file and returns the record to store in `D().files` (and in the task's attachments).
   opts: { project, task?, onProgress?(0..1), signal? } */
export function uploadFile(file, { project, task: taskId = null, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!ctx.wsId || !project) return reject(new BackendError('Pick a project before uploading.', { kind: 'rejected' }));
    if (file.size > MAX_FILE_BYTES)
      return reject(new BackendError(`${file.name} is larger than ${fmtBytes(MAX_FILE_BYTES)}.`, { code: 'TOO_LARGE', kind: 'rejected' }));
    const id = newId();
    const path = `${ctx.wsId}/${project}/${id}/${safeName(file.name)}`;
    sb.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return reject(new BackendError('Sign in again to upload files.', { kind: 'rejected' }));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/files/${path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('apikey', SUPABASE_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () => reject(new BackendError(`Couldn't upload ${file.name}. Check your connection.`, { kind: 'network' }));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            id,
            name: file.name,
            type: fileType(file.name),
            size: fmtBytes(file.size),
            bytes: file.size,
            mime: file.type || '',
            path,
            by: ctx.meId,
            at: Date.now(),
            project,
            task: taskId,
          });
        } else {
          let msg = '';
          try {
            msg = JSON.parse(xhr.responseText).message || '';
          } catch {
            /* non-JSON error body */
          }
          const denied = xhr.status === 403 || /row-level security|unauthorized/i.test(msg);
          reject(
            new BackendError(denied ? "You don't have permission to upload files to this project." : `Couldn't upload ${file.name}${msg ? ': ' + msg : '.'}`, {
              status: xhr.status,
              kind: xhr.status >= 500 ? 'network' : 'rejected',
            }),
          );
        }
      };
      xhr.send(file);
    }, reject);
  });
}

/* Temporary link to a stored file. `download` forces a download with that file name instead of opening it. */
export async function fileUrl(path, { download, expires = 3600 } = {}) {
  if (!path) throw new BackendError('This file has no stored content.', { code: 'NO_CONTENT', kind: 'rejected' });
  const { data, error } = await sb.storage.from('files').createSignedUrl(path, expires, download ? { download } : undefined);
  if (error) throw fail(error, error.status || 400);
  return data.signedUrl;
}

/* Copies a stored file (Files → Duplicate). Returns the new storage path. */
export async function copyStoredFile(path, project, name) {
  const id = newId();
  const to = `${ctx.wsId}/${project}/${id}/${safeName(name)}`;
  const { error } = await sb.storage.from('files').copy(path, to);
  if (error) throw fail(error, error.status || 400);
  return { id, path: to };
}

/* Removes uploads that never got a database record (e.g. the task form was cancelled). */
export async function discardUploads(paths) {
  const list = (paths || []).filter(Boolean);
  if (list.length) await sb.storage.from('files').remove(list);
}

/* Saves now (used before leaving a screen that must not lose changes). */
export const saveNow = () => sync.flush();
