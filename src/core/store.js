/* ---------- store ---------- */
import { TODAY, diffD, iso, parse, uid } from './utils.js';
import { PCOLORS } from './constants.js';
import { emptyData, normalize } from '../data/mappers.js';

/* Workspace data lives in Supabase (see src/data/backend.js). Only presentation preferences are cached in
   this browser, so the theme and sidebar state apply before the workspace has loaded. */
export const PREFS_KEY = 'dash.prefs';
export const DEFAULT_PREFS = {
  theme: 'system',
  accent: 'indigo',
  side: 'comfortable',
  density: 'comfortable',
  weekStart: 1,
  dateFmt: 'MMM d',
  lang: 'English (US)',
  tz: '',
  motion: 'system',
  home: 'home',
  openTasks: 'drawer',
  name: '',
  title: '',
};
const LOCAL_PREFS = ['theme', 'accent', 'side', 'density', 'motion', 'dateFmt', 'weekStart'];
export function loadCached() {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (j && typeof j === 'object') return j;
  } catch {
    /* storage blocked or corrupt: use defaults */
  }
  return null;
}
export const saved = loadCached();
export const S = {
  data: emptyData(),
  prefs: Object.assign({}, DEFAULT_PREFS, saved?.prefs || {}),
  views: {},
  ui: {
    fx: {},
    booting: true,
    bootError: null,
    sync: 'idle',
    auth: null,
    authStep: 'login',
    onb: 0,
    onbData: { use: 'product', team: 'kanban', size: 'Just me', ws: '', proj: 'My first project', tmpl: 'web', invites: '' },
    route: 'home',
    params: {},
    history: [],
    collapsed: !!saved?.collapsed,
    mnav: false,
    expanded: {},
    drawer: null,
    drawerFull: false,
    drawerTab: 'comments',
    modals: [],
    pop: null,
    palette: null,
    loading: false,
    offline: false,
    sel: new Set(),
    composer: null,
    editCell: null,
    openTasks: {},
    collapsedGroups: {},
    calDate: iso(TODAY),
    calMode: 'month',
    tlZoom: 'week',
    tlGroup: 'status',
    fileView: 'grid',
    projView: 'grid',
    homeTab: 'upcoming',
    inboxCat: 'all',
    inboxUnread: false,
    inboxSel: null,
    notifFilter: 'all',
    settings: 'appearance',
    searchQ: '',
    searchCat: 'all',
    myView: 'list',
    membersTab: 'members',
    collapsedCols: {},
    errors: {},
    drafts: {},
  },
};
/* Remembers presentation preferences in this browser. */
export function cachePrefs() {
  try {
    const prefs = Object.fromEntries(LOCAL_PREFS.filter(k => S.prefs[k] != null).map(k => [k, S.prefs[k]]));
    localStorage.setItem(PREFS_KEY, JSON.stringify({ prefs, collapsed: S.ui.collapsed }));
  } catch {
    /* storage full or blocked: preferences just won't be remembered on this device */
  }
}
/* The backend registers the function that persists the workspace (the sync engine's scheduler). */
let persist = () => {};
export function setPersist(fn) {
  persist = fn;
}
/* Called after every mutation: schedules a sync of whatever changed in S.data / S.prefs / S.views. */
export function save() {
  // Keep the in-memory workspace consistent right away (derived attachments, no dangling references),
  // so the render that follows a mutation already shows what will be stored.
  if (S.data.me) normalize(S.data);
  cachePrefs();
  persist();
}

/* ---------- lookups ---------- */
export const D = () => S.data;
export const me = () => D().members.find(m => m.id === D().me);
export const mem = id => D().members.find(m => m.id === id);
export const proj = id => D().projects.find(p => p.id === id);
export const task = id => D().tasks.find(t => t.id === id);
export const pColor = p => PCOLORS[p?.color] || PCOLORS.slate;
export const visibleProjects = () =>
  D()
    .projOrder.map(proj)
    .filter(Boolean)
    .filter(p => !p.archived);
export const canSee = p => !p.private || p.members.includes(D().me);
export const tasksOf = pid => D().tasks.filter(t => t.project === pid && !t.archived);
export const allTasks = () => D().tasks.filter(t => !t.archived && canSee(proj(t.project)));
export const isOver = t => t.due && t.status !== 'done' && diffD(parse(t.due), TODAY) < 0;
export const commentsOf = tid => D().comments.filter(c => c.task === tid);
export function progressOf(pid) {
  const ts = tasksOf(pid);
  if (!ts.length) return 0;
  return Math.round((ts.filter(t => t.status === 'done').length / ts.length) * 100);
}
export function taskProg(t) {
  if (t.status === 'done') return 100;
  if (t.subtasks.length) return Math.round((t.subtasks.filter(s => s.done).length / t.subtasks.length) * 100);
  return { backlog: 0, todo: 5, progress: 45, review: 80 }[t.status] || 0;
}

/* ---------- activity + notification helpers ---------- */
export function logAct(verb, t, extra = '') {
  D().activity.unshift({ id: uid('a'), by: D().me, verb, task: t?.id || null, project: t?.project || null, at: Date.now(), extra });
  if (t) t.updated = Date.now();
}

/* ---------- teams ---------- */
export const NO_TEAM = { id: '', name: 'No team', icon: 'users', c: '#8A867E', desc: '' };
export function teamsList() {
  const d = D();
  if (!d.teams) d.teams = [];
  return d.teams;
}
export function team(id) {
  return teamsList().find(t => t.id === id) || null;
}
export const TM = new Proxy({}, { get: (_, k) => team(k) || NO_TEAM });
