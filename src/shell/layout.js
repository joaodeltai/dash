/* ---------- shell ---------- */
import { tr } from '../core/i18n.js';
import { MOD, TODAY, diffD, esc, parse } from '../core/utils.js';
import { ic, wsLogo } from '../core/icons.js';
import { PSTAT } from '../core/constants.js';
import { D, S, allTasks, canCreate, mem, pColor, proj, team, teamsList, visibleProjects } from '../core/store.js';
import { av } from '../ui/helpers.js';
import { ROUTE_NAMES } from './render.js';
import { skeleton } from './skeletons.js';
import { pageHome } from '../pages/home.js';
import { pageOverview } from '../pages/overview.js';
import { pageMyTasks } from '../pages/my-tasks.js';
import { pageTasks } from '../pages/tasks.js';
import { pageInbox } from '../pages/inbox.js';
import { pageNotifications } from '../pages/notifications.js';
import { pageFavorites } from '../pages/favorites.js';
import { pageProjects } from '../pages/projects.js';
import { pageMember, pageMembers, pageTeam, pageTeams } from '../pages/members.js';
import { pageActivity } from '../pages/activity.js';
import { pageSearch } from '../pages/search.js';
import { page404, stateFailed } from '../pages/errors.js';
import { pageProject } from '../pages/project.js';
import { pageWsCalendar } from '../views/calendar.js';
import { pageWsTimeline } from '../views/timeline.js';
import { pageSettings } from '../pages/settings.js';
import { pageStates, pageSystem } from '../pages/design-system.js';
import { pageArchive } from '../features/archive.js';

export function renderShell() {
  const u = S.ui;
  return `<button class="skip" data-a="skipToContent">${tr('Skip to content')}</button><div class="shell ${u.collapsed ? 'collapsed' : ''} ${u.mnav ? 'mnav' : ''} ${u.fx.tabs ? 'fx-tabs' : ''}">
    ${renderSidebar()}
    ${u.mnav ? '<div class="side-scrim" data-a="closeMnav"></div>' : ''}
    <main class="main" id="main">
      ${renderTopbar()}
      ${u.offline ? `<div class="offline-bar" role="alert">${ic('wifi-off', 15)}<span><b>${tr("You're offline.")}</b> ${tr("Changes won't be saved until your connection is back.")}</span><span class="sp"></span><button class="btn btn-sm btn-secondary" data-a="retryOnline">${tr('Try again')}</button></div>` : ''}
      <div class="content ${u.fx.route ? 'fx-route' : ''}" id="main-content" tabindex="-1" data-keep="c:${u.route}:${u.params.id || ''}:${u.params.tab || ''}:${u.params.sec || ''}">${u.loading ? skeleton() : renderPage()}</div>
    </main>
    ${renderBottomNav()}
  </div>`;
}
export function renderPage() {
  const r = S.ui.route;
  try {
    const P = {
      home: pageHome,
      inbox: pageInbox,
      mytasks: pageMyTasks,
      favorites: pageFavorites,
      notifications: pageNotifications,
      search: pageSearch,
      overview: pageOverview,
      projects: pageProjects,
      project: pageProject,
      tasks: pageTasks,
      calendar: pageWsCalendar,
      timeline: pageWsTimeline,
      members: pageMembers,
      member: pageMember,
      teams: pageTeams,
      team: pageTeam,
      activity: pageActivity,
      settings: pageSettings,
      // Internal galleries: development builds only.
      ...(import.meta.env.DEV ? { system: pageSystem, states: pageStates } : {}),
      archive: pageArchive,
    };
    return (P[r] || page404)();
  } catch (e) {
    console.error(e);
    return stateFailed();
  }
}

export function sItem(route, label, icon, opt = {}) {
  const on = S.ui.route === route && (!opt.id || S.ui.params.id === opt.id);
  return `<button class="sitem ${on ? 'on' : ''}" data-a="${opt.act || 'go'}" data-r="${route}" ${opt.id ? `data-id="${opt.id}"` : ''} ${S.ui.collapsed ? `data-tip="${esc(label)}" data-tip-pos="right"` : ''} ${on ? 'aria-current="page"' : ''}>${ic(icon, 16)}<span class="trunc">${esc(label)}</span>${opt.ct ? `<span class="ct ${opt.dot ? 'dotc' : ''}">${opt.ct}</span>` : ''}${opt.kbd ? `<span class="ct hide-m"><kbd>${opt.kbd}</kbd></span>` : ''}</button>`;
}
export function renderSidebar() {
  const u = S.ui,
    d = D();
  const unreadInbox = d.notifs.filter(n => !n.read && n.type !== 'update').length;
  const unreadAll = d.notifs.filter(n => !n.read).length;
  const myOpen = allTasks().filter(t => t.assignee === d.me && t.status !== 'done' && t.due && diffD(parse(t.due), TODAY) <= 0).length;
  const projs = visibleProjects().filter(p => p.status !== 'complete');
  const inProj = u.route === 'project' ? u.params.id : null;
  return `<nav class="side" aria-label="${tr('Main')}">
    <div class="side-top">
      <div class="row" style="gap:2px">
        <button class="ws grow" data-a="pop" data-pop="ws" aria-haspopup="menu" aria-label="${tr('Switch workspace')}">
          ${wsLogo(d.ws, 22)}
          <span class="ws-name trunc">${esc(d.ws.name)}</span>
          <span class="chev-d faint">${ic('chevrons-up-down', 13)}</span>
        </button>
        ${u.collapsed ? '' : `<button class="ibtn ibtn-sm hide-m" data-a="toggleSide" data-tip="${tr('Collapse sidebar')}  [" aria-label="${tr('Collapse sidebar')}">${ic('panel-left', 15)}</button>`}
      </div>
    </div>
    <div class="side-scroll" data-keep="side">
      ${u.collapsed ? `<button class="sitem" data-a="toggleSide" data-tip="${tr('Expand sidebar')}" data-tip-pos="right" aria-label="${tr('Expand sidebar')}">${ic('panel-left', 16)}</button>` : ''}
      ${sItem('home', tr('Home'), 'house')}
      ${sItem('inbox', tr('Inbox'), 'inbox', { ct: unreadInbox || '', dot: true })}
      ${sItem('mytasks', tr('My Tasks'), 'circle-check', { ct: myOpen || '' })}
      ${sItem('favorites', tr('Favorites'), 'star')}
      ${sItem('notifications', tr('Notifications'), 'bell', { ct: unreadAll || '' })}
      <div class="sgroup">
        <div class="sgroup-h">${tr('Workspace')}</div>
        ${sItem('overview', tr('Overview'), 'layout-dashboard')}
        ${sItem('projects', tr('Projects'), 'folder-kanban')}
        ${sItem('tasks', tr('Tasks'), 'list-checks')}
        ${sItem('calendar', tr('Calendar'), 'calendar')}
        ${sItem('timeline', tr('Timeline'), 'chart-gantt')}
        ${sItem('members', tr('Members'), 'users')}
        ${sItem('activity', tr('Activity'), 'activity')}
      </div>
      <div class="sgroup" id="side-projects">
        <div class="sgroup-h"><span>${tr('Projects')}</span><span class="sp"></span>${canCreate() ? `<button class="ibtn ibtn-xs" data-a="newProject" data-tip="${tr('New project')}  P" aria-label="${tr('New project')}">${ic('plus', 14)}</button>` : ''}</div>
        ${projs
          .map(p => {
            const open = !!u.expanded[p.id];
            const on = inProj === p.id;
            return `<div class="sproj" data-proj-drop="${p.id}">
            <div class="sitem ${on ? 'on' : ''}" draggable="true" data-drag-proj="${p.id}" data-a="go" data-r="project" data-id="${p.id}" data-ctx="project" role="link" tabindex="0" ${u.collapsed ? `data-tip="${esc(p.name)}" data-tip-pos="right"` : ''}>
              <span class="pico" style="--c:${pColor(p)}" data-a="toggleExpand" data-id="${p.id}" aria-label="${tr('Toggle sub-pages')}">${ic(p.icon, 12)}</span>
              <span class="trunc">${esc(p.name)}</span>
              ${p.fav ? `<span class="fav">${ic('star', 11)}</span>` : ''}
              ${p.private ? `<span class="faint" style="margin-left:4px">${ic('lock', 11)}</span>` : ''}
              <span class="sdot" style="background:${PSTAT[p.status].c}" title="${tr(PSTAT[p.status].name)}"></span>
              <span class="hov"><span class="ibtn ibtn-xs" data-a="ctxBtn" data-ctx="project" data-id="${p.id}" aria-label="${tr('Project options')}">${ic('ellipsis', 14)}</span><span class="ibtn ibtn-xs" data-a="toggleExpand" data-id="${p.id}" aria-label="${tr('Expand')}">${ic('chevron-right', 13, 'chev ' + (open ? 'open' : ''))}</span></span>
            </div>
            <div class="sub ${open && !u.collapsed ? 'open' : ''}">
              ${[
                ['board', 'Board', 'square-kanban'],
                ['list', 'List', 'list'],
                ['timeline', 'Timeline', 'chart-gantt'],
                ['files', 'Files', 'paperclip'],
              ]
                .map(
                  ([tab, n, i]) =>
                    `<button class="sitem ${on && u.params.tab === tab ? 'on' : ''}" data-a="go" data-r="project" data-id="${p.id}" data-tab="${tab}">${ic(i, 14)}<span>${tr(n)}</span></button>`,
                )
                .join('')}
            </div>
          </div>`;
          })
          .join('')}
        ${sItem('archive', tr('Archive'), 'archive', { ct: D().tasks.filter(t => t.archived).length + D().projects.filter(p => p.archived).length || '' })}
      </div>
      <div class="sgroup">
        <div class="sgroup-h"><span>${tr('Teams')}</span><span class="sp"></span><button class="ibtn ibtn-xs" data-a="newTeam" data-tip="${tr('New team')}" aria-label="${tr('New team')}">${ic('plus', 14)}</button></div>
        ${teamsList()
          .map(t => sItem('team', t.name, t.icon, { id: t.id }))
          .join('')}
      </div>
    </div>
    <div class="side-bot">
      <button class="sitem" data-a="pop" data-pop="help" ${u.collapsed ? `data-tip="${tr('Help')}" data-tip-pos="right"` : ''}>${ic('circle-help', 16)}<span>${tr('Help & resources')}</span></button>
      ${sItem('settings', tr('Settings'), 'settings')}
      <button class="sitem" data-a="pop" data-pop="user" style="height:36px" ${u.collapsed ? `data-tip="${tr('Profile')}" data-tip-pos="right"` : ''}>${av(d.me, 'presence', false)}<span class="trunc" style="color:var(--text);font-weight:500">${esc(S.prefs.name)}</span><span class="ct">${ic('chevrons-up-down', 13)}</span></button>
    </div>
  </nav>`;
}

export function crumbs() {
  const u = S.ui,
    r = u.route,
    out = [];
  const c = (label, act = '', cur = false, icon = '') => `<button class="${cur ? 'cur' : ''}" ${act}>${icon}${esc(label)}</button>`;
  if (r === 'project') {
    const p = proj(u.params.id);
    out.push(c(tr('Projects'), 'data-a="go" data-r="projects"'));
    if (p)
      out.push(
        c(
          p.name,
          `data-a="go" data-r="project" data-id="${p.id}" data-tab="overview"`,
          true,
          `<span class="pico" style="--c:${pColor(p)};width:16px;height:16px;border-radius:4px;display:grid;place-items:center;color:${pColor(p)}">${ic(p.icon, 11)}</span>`,
        ),
      );
  } else if (r === 'member') {
    out.push(c(tr('Members'), 'data-a="go" data-r="members"'));
    out.push(c(mem(u.params.id)?.name || tr('Member'), '', true));
  } else if (r === 'team') {
    out.push(c(tr('Teams'), 'data-a="go" data-r="teams"'));
    out.push(c(team(u.params.id)?.name || tr('Team'), '', true));
  } else if (r === 'settings') {
    out.push(c(tr('Settings'), '', true));
  } else out.push(c(tr(ROUTE_NAMES[r] || 'Not found'), '', true));
  return out.join('<span class="sep">/</span>');
}
export function renderTopbar() {
  return `<header class="topbar">
    <button class="ibtn" data-a="openMnav" aria-label="${tr('Open navigation')}" style="display:none" id="mnav-btn">${ic('menu', 17)}</button>
    <style>@media(max-width:900px){#mnav-btn{display:inline-flex!important}}</style>
    <nav class="crumbs trunc" aria-label="${tr('Breadcrumb')}">${crumbs()}</nav>
    <span class="sp"></span>
    <span class="sync-state" id="sync-state" role="status" data-s="${S.ui.sync || 'idle'}">${{ saving: tr('Saving…'), offline: tr('Offline'), error: tr('Not saved') }[S.ui.sync] || ''}</span>
    <button class="topsearch" data-a="openPalette" aria-label="${tr('Search and commands')}">${ic('search', 14)}<span class="lbltxt">${tr('Search or jump to…')}</span><span class="kbd">${MOD}K</span></button>
    <button class="ibtn" data-a="go" data-r="notifications" data-tip="${tr('Notifications')}" aria-label="${tr('Notifications')}">${ic('bell', 16)}${D().notifs.some(n => !n.read) ? '<span style="position:absolute;top:6px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px var(--surface)"></span>' : ''}</button>
    <button class="btn btn-secondary btn-sm" data-a="pop" data-pop="create" aria-haspopup="menu" aria-label="${tr('Create new')}">${ic('plus', 14)}<span class="hide-m">${tr('New')}</span>${ic('chevron-down', 12, 'hide-m')}</button>
    <button class="ibtn hide-m" data-a="pop" data-pop="user" aria-label="${tr('Account menu')}" style="width:auto;padding:0 2px">${av(D().me, 'md', false)}</button>
  </header>`;
}
export function renderBottomNav() {
  const r = S.ui.route;
  const unread = D().notifs.some(n => !n.read && n.type !== 'update');
  const b = (route, label, icon, extra = '') =>
    `<button class="${r === route ? 'on' : ''}" data-a="go" data-r="${route}">${ic(icon, 19)}<span>${label}</span>${extra}</button>`;
  return `<nav class="bottomnav" aria-label="${tr('Primary')}">
    ${b('home', tr('Home'), 'house')}${b('mytasks', tr('My Tasks'), 'circle-check')}${b('projects', tr('Projects'), 'folder-kanban')}${b('inbox', tr('Inbox'), 'inbox', unread ? '<span class="bdot"></span>' : '')}
    <button data-a="openMnav">${ic('ellipsis', 19)}<span>${tr('More')}</span></button>
  </nav>`;
}
