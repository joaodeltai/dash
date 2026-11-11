/* =====================================================================
   SETTINGS · AUTH · ONBOARDING · DESIGN SYSTEM · SYSTEM STATES
   ===================================================================== */
import { dOff, esc, fmtDate } from '../core/utils.js';
import { ic, wsLogo } from '../core/icons.js';
import { LANGS, shortDay, tr, trn, wdLong } from '../core/i18n.js';
import { D, S, me } from '../core/store.js';
import { av, pIcon } from '../ui/helpers.js';
import { permsTable, teamsGrid } from './members.js';
import { page404 } from './errors.js';
import { SHORTCUTS } from '../overlays/modals.js';

export const SET_NAV = [
  [
    'General',
    [
      ['workspace', 'Workspace', 'building-2'],
      ['appearance', 'Appearance', 'palette'],
      ['datetime', 'Date & time', 'clock'],
    ],
  ],
  [
    'Workspace',
    [
      ['members', 'Members', 'users'],
      ['teams', 'Teams', 'users-round'],
      ['projects', 'Projects', 'folder-kanban'],
      ['permissions', 'Permissions', 'shield'],
    ],
  ],
  [
    'Personal',
    [
      ['profile', 'Profile', 'user'],
      ['notifications', 'Notifications', 'bell'],
      ['preferences', 'Preferences', 'sliders-horizontal'],
      ['shortcuts', 'Keyboard shortcuts', 'keyboard'],
    ],
  ],
  [
    'Security',
    [
      ['password', 'Password', 'key-round'],
      ['sessions', 'Sessions', 'monitor-smartphone'],
    ],
  ],
];
export function srow(t, d, ctl) {
  return `<div class="srow"><div><div class="t">${t}</div>${d ? `<div class="d">${d}</div>` : ''}</div><div class="row">${ctl}</div></div>`;
}
const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
export const tog = (k, on, src = 'pref', label = k) =>
  `<input type="checkbox" class="toggle" data-in="${src}Toggle" data-k="${k}" ${on ? 'checked' : ''} aria-label="${label}">`;
export const sel = (k, opts, v) =>
  `<select class="select" style="width:auto;min-width:180px" data-in="prefSel" data-k="${k}" aria-label="${k}">${opts
    .map(o => {
      const [val, n] = Array.isArray(o) ? o : [o, o];
      return `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${n}</option>`;
    })
    .join('')}</select>`;
/* Browser and OS of this device, read from the user agent. */
export function deviceInfo(ua = navigator.userAgent) {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'this device';
  return {
    name: tr('{browser} on {os}', { browser: browser === 'Browser' ? tr('Browser') : browser, os: os === 'this device' ? tr('this device') : os }),
    mobile: os === 'iOS' || os === 'Android',
  };
}
export function pageSettings() {
  let sec = S.ui.params.sec || S.ui.settings || 'appearance';
  if (sec.startsWith('notif-')) sec = 'notifications'; // old links from before the notification sections were merged
  const title = SET_NAV.flatMap(g => g[1]).find(x => x[0] === sec) || ['appearance', 'Appearance'];
  return `<div class="set">
    <nav class="set-nav" aria-label="${tr('Settings')}">${SET_NAV.map(([g, items]) => `<div class="gh">${tr(g)}</div>${items.map(([k, n, i]) => `<button class="sitem ${sec === k ? 'on' : ''}" data-a="go" data-r="settings" data-sec="${k}">${ic(i, 15)}<span>${tr(n)}</span></button>`).join('')}`).join('')}</nav>
    <div class="set-body" data-keep="set:${sec}"><div class="set-in">${settingsBody(sec, title[1])}</div></div>
  </div>`;
}
export function settingsBody(sec, title) {
  const P = S.prefs;
  const d = D();
  const np = d.notifPrefs;
  const role = me().role;
  const isOwner = role === 'Owner';
  const canAdmin = isOwner || role === 'Admin';
  const H = lead => `<h1>${tr(title)}</h1><p class="lead">${lead}</p>`;
  switch (sec) {
    case 'workspace':
      return (
        H(tr('Your workspace name, handle, and identity.')) +
        `
      <form data-submit="saveWorkspace">
      <div class="sblock" style="margin-top:0"><div class="row" style="gap:14px;margin-bottom:18px">${wsLogo(d.ws, 52)}${
        canAdmin
          ? `<div><div class="label" style="margin-bottom:6px">${tr('Workspace icon')}</div><div class="swatches">${['#2F2E2A', '#5A67D8', '#3B82C4', '#23918A', '#C54B78', '#C48A1E'].map(c => `<button type="button" class="sw ${d.ws.c === c ? 'on' : ''}" style="--c:${c};width:22px;height:22px" data-a="wsColor" data-v="${c}" aria-label="${tr('Color {c}', { c })}"></button>`).join('')}</div></div>`
          : ''
      }</div>
      <div class="col" style="gap:14px;max-width:440px"><div class="field"><label class="label" for="ws-name">${tr('Workspace name')}</label><input class="input" id="ws-name" value="${esc(d.ws.name)}" ${canAdmin ? '' : 'disabled'}></div>
      <div class="field"><label class="label" for="ws-url">${tr('Workspace handle')}</label><input class="input" id="ws-url" value="${esc(d.ws.url)}" autocapitalize="none" spellcheck="false" ${canAdmin ? '' : 'disabled'}><span class="hint">${canAdmin ? tr('Lowercase letters, numbers, and hyphens. Must be unique.') : tr('Only owners and admins can change workspace settings.')}</span></div>
      ${canAdmin ? `<div><button class="btn btn-primary" data-a="saveWorkspace" id="ws-save">${tr('Save changes')}</button></div>` : ''}</div></div></form>
      ${isOwner ? `<div class="sblock"><h2 style="color:var(--red)">${tr('Danger zone')}</h2>${srow(tr('Delete workspace'), tr('Permanently delete this workspace, its projects, tasks, and files. This cannot be undone.'), `<button class="btn btn-danger-ghost" style="border:1px solid color-mix(in srgb,var(--red) 35%,transparent)" data-a="delWorkspace">${tr('Delete workspace')}</button>`)}</div>` : ''}`
      );
    case 'appearance':
      return (
        H(tr('Customize how Gr8r looks on this device.')) +
        `
      <div class="sblock" style="margin-top:0"><h2>${tr('Theme')}</h2><div class="themecards" style="margin-top:12px" role="radiogroup" aria-label="${tr('Theme')}">${[
        ['light', tr('Light')],
        ['dark', tr('Dark')],
        ['system', tr('System')],
      ]
        .map(([k, n]) => {
          const L = { bg: '#FBFAF8', s: '#F2F1EE', t: '#1D1C1A', b: '#E3E1DC', a: '#4B5BD6' },
            Dk = { bg: '#1D1D1C', s: '#151514', t: '#ECEAE5', b: '#333230', a: '#8E9AF3' };
          const pv = c =>
            `<div class="s" style="background:${c.s}"><i style="background:${c.b};width:70%"></i><i style="background:${c.a};width:55%"></i><i style="background:${c.b};width:80%"></i><i style="background:${c.b};width:60%"></i></div><div class="m" style="background:${c.bg}"><i style="background:${c.t};width:45%;height:7px"></i><i style="background:${c.b}"></i><i style="background:${c.b};width:80%"></i><i style="background:${c.a};width:30%;height:10px;margin-top:4px"></i></div>`;
          return `<button class="tcard ${P.theme === k ? 'on' : ''}" role="radio" aria-checked="${P.theme === k}" data-a="setTheme" data-v="${k}"><div class="tprev" style="${k === 'system' ? 'grid-template-columns:1fr 1fr;display:grid' : ''}">${k === 'system' ? `<div style="display:grid;grid-template-columns:30% 1fr">${pv(L)}</div><div style="display:grid;grid-template-columns:30% 1fr">${pv(Dk)}</div>` : pv(k === 'light' ? L : Dk)}</div><span class="row" style="font-weight:500;font-size:13px;gap:6px">${ic(k === 'light' ? 'sun' : k === 'dark' ? 'moon' : 'monitor', 14)}${n}${P.theme === k ? `<span class="sp"></span><span style="color:var(--accent)">${ic('circle-check', 15)}</span>` : ''}</span></button>`;
        })
        .join('')}</div></div>
      <div class="sblock"><h2>${tr('Accent color')}</h2>${srow(
        tr('Accent'),
        tr('Used for primary buttons, focus rings, and selection.'),
        `<div class="swatches" role="radiogroup" aria-label="${tr('Accent color')}">${[
          ['indigo', '#4B5BD6', tr('Indigo')],
          ['blue', '#2F6CD4', tr('Blue')],
          ['violet', '#7348CC', tr('Violet')],
          ['teal', '#1A7F7A', tr('Teal')],
          ['rose', '#B93D68', tr('Rose')],
          ['graphite', '#34332F', tr('Graphite')],
        ]
          .map(
            ([k, c, n]) =>
              `<button class="sw ${P.accent === k ? 'on' : ''}" style="--c:${c}" role="radio" aria-checked="${P.accent === k}" data-a="setPref" data-k="accent" data-v="${k}" aria-label="${n}" data-tip="${n}">${P.accent === k ? ic('check', 13) : ''}</button>`,
          )
          .join('')}</div>`,
      )}</div>
      <div class="sblock"><h2>${tr('Density')}</h2>
        ${srow(tr('Sidebar density'), tr('Compact fits more projects on screen.'), `<div class="seg">${['comfortable', 'compact'].map(k => `<button class="${P.side === k ? 'on' : ''}" data-a="setPref" data-k="side" data-v="${k}">${k === 'comfortable' ? tr('Comfortable') : tr('Compact')}</button>`).join('')}</div>`)}
        ${srow(tr('Task display'), tr('Row height in lists and card padding on boards.'), `<div class="seg">${['comfortable', 'compact'].map(k => `<button class="${P.density === k ? 'on' : ''}" data-a="setPref" data-k="density" data-v="${k}">${k === 'comfortable' ? tr('Comfortable') : tr('Compact')}</button>`).join('')}</div>`)}
        ${srow(
          tr('Motion'),
          tr('Reduce animations for drawers, modals, and transitions.'),
          sel(
            'motion',
            [
              ['system', tr('Follow system')],
              ['reduce', tr('Reduce motion')],
            ],
            P.motion,
          ),
        )}
      </div>`
      );
    case 'datetime':
      return (
        H(tr('How dates and times appear across the workspace.')) +
        srow(
          tr('Language'),
          tr('The language of the interface. It is saved to your profile.'),
          sel(
            'lang',
            LANGS.map(l => [l.id, l.name]),
            P.lang,
          ),
        ) +
        srow(
          tr('Date format'),
          tr('Preview: {date}', { date: `<b>${fmtDate(dOff(8))}</b>` }),
          sel(
            'dateFmt',
            [
              ['MMM d', shortDay(new Date(2026, 9, 1))],
              ['d/M', '1/10'],
              ['M/d', '10/1'],
              ['yyyy-MM-dd', '2026-10-01'],
            ],
            P.dateFmt,
          ),
        ) +
        srow(
          tr('Start week on'),
          tr('Affects calendars and the timeline.'),
          sel(
            'weekStart',
            [
              ['1', cap(wdLong(1))],
              ['0', cap(wdLong(0))],
              ['6', cap(wdLong(6))],
            ],
            P.weekStart,
          ),
        )
      );
    case 'members':
      return (
        H(trn('{n} person has access to {ws}.', '{n} people have access to {ws}.', d.members.length, { ws: esc(d.ws.name) })) +
        `<div class="row" style="margin-bottom:12px">${role === 'Guest' ? '' : `<button class="btn btn-primary" data-a="invite">${ic('user-plus', 14)}${tr('Invite member')}</button>`}<button class="btn btn-secondary" data-a="go" data-r="members">${tr('Open member directory')}</button></div>
      <div class="panel" style="overflow:hidden">${d.members.map(m => `<div class="mini" style="min-height:52px;cursor:default" data-ctx="member" data-id="${m.id}">${av(m.id, 'md', false)}<div class="grow"><div style="font-weight:500">${esc(m.name)}</div><div class="faint" style="font-size:12px">${esc(m.email)}</div></div>${m.status === 'invited' ? `<span class="badge amber">${tr('Invited')}</span>` : ''}${canAdmin && m.role !== 'Owner' ? `<button class="pillbtn bordered" data-a="pop" data-pop="role" data-id="${m.id}">${tr(m.role)}${ic('chevron-down', 12)}</button>` : `<span class="pillbtn">${m.role === 'Owner' ? ic('crown', 13) : ''}${tr(m.role)}</span>`}<button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="member" data-id="${m.id}" aria-label="${tr('Options')}">${ic('ellipsis', 14)}</button></div>`).join('')}</div>`
      );
    case 'teams':
      return H(tr('Teams group people and projects.')) + teamsGrid();
    case 'projects': {
      const arch = d.projects.filter(p => p.archived);
      return (
        H(tr('Defaults for new projects and archived work.')) +
        srow(
          tr('Default project view'),
          tr('The tab that opens when you open a project.'),
          sel(
            'defaultTab',
            [
              ['board', tr('Board')],
              ['list', tr('List')],
              ['table', tr('Table')],
              ['overview', tr('Overview')],
              ['timeline', tr('Timeline')],
            ],
            P.defaultTab || 'board',
          ),
        ) +
        `<div class="sblock"><h2>${tr('Archived projects')}</h2>${arch.length ? arch.map(p => `<div class="srow"><div class="row">${pIcon(p, '', 14)}<b style="font-weight:500">${esc(p.name)}</b></div><div class="row"><button class="btn btn-secondary btn-sm" data-a="restoreProject" data-id="${p.id}">${tr('Restore')}</button><button class="btn btn-danger-ghost btn-sm" data-a="delProject" data-id="${p.id}">${tr('Delete')}</button></div></div>`).join('') : `<p class="faint" style="padding:12px 0">${tr('No archived projects. Archived projects are hidden from the sidebar but keep all their tasks.')}</p>`}<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" data-a="go" data-r="archive">${ic('archive', 13)}${tr('Open archive')}</button></div></div>`
      );
    }
    case 'permissions':
      return (
        H(tr('What each role can do. These rules are enforced by the database.')) +
        `<div class="sblock"><h2>${tr('Role permissions')}</h2><div style="margin-top:12px">${permsTable()}</div></div>`
      );
    case 'notifications':
      return (
        H(tr('Choose which in-app notifications you receive in your Inbox.')) +
        srow(tr('Mentions'), tr('When someone @mentions you.'), tog('inapp_mention', np.inapp_mention !== false, 'np', tr('Mentions'))) +
        srow(tr('Assignments'), tr('When a task is assigned to you.'), tog('inapp_assign', np.inapp_assign !== false, 'np', tr('Assignments'))) +
        srow(tr('Comments'), tr('When someone comments on a task assigned to you.'), tog('inapp_comment', np.inapp_comment !== false, 'np', tr('Comments'))) +
        srow(
          tr('Task updates'),
          tr('When the status of a task assigned to you changes.'),
          tog('inapp_update', np.inapp_update !== false, 'np', tr('Task updates')),
        ) +
        `<p class="faint" style="font-size:12.5px;margin-top:16px">${tr('Email and push notifications are not available.')}</p>`
      );
    case 'profile': {
      const err = S.ui.errors.pname2;
      return (
        H(tr('How you appear to others in the workspace.')) +
        `<form data-submit="saveProfile" class="col" style="gap:16px;max-width:440px">
      <div class="row" style="gap:14px">${av(d.me, 'xl', false)}<div><div class="label" style="margin-bottom:6px">${tr('Avatar color')}</div><div class="swatches">${['#5A67D8', '#C54B78', '#3B82C4', '#23918A', '#C48A1E', '#8662C9'].map(c => `<button type="button" class="sw ${me().c === c ? 'on' : ''}" style="--c:${c};width:22px;height:22px" data-a="avColor" data-v="${c}" aria-label="${tr('Color')}"></button>`).join('')}</div></div></div>
      <div class="field"><label class="label" for="pf-name">${tr('Full name')}</label><input class="input ${err ? 'is-error' : ''}" id="pf-name" value="${esc(P.name)}">${err ? `<span class="err">${ic('circle-alert', 12)}${err}</span>` : ''}</div>
      <div class="field"><label class="label" for="pf-title">${tr('Title')}</label><input class="input" id="pf-title" value="${esc(P.title)}"></div>
      <div class="field"><label class="label" for="pf-email">${tr('Email')}</label><input class="input" id="pf-email" value="${esc(me().email)}" disabled><span class="hint">${tr('This is the email you sign in with.')}</span></div>
      <div><button class="btn btn-primary" data-a="saveProfile" id="pf-save">${tr('Save profile')}</button></div></form>`
      );
    }
    case 'preferences':
      return (
        H(tr('Personal defaults for how you work.')) +
        srow(
          tr('Open on launch'),
          tr('The page you see when Gr8r opens.'),
          sel(
            'home',
            [
              ['home', tr('Home')],
              ['mytasks', tr('My tasks')],
              ['inbox', tr('Inbox')],
            ],
            P.home,
          ),
        ) +
        srow(
          tr('Open tasks in'),
          tr('Side panel keeps your place in the list.'),
          sel(
            'openTasks',
            [
              ['drawer', tr('Side panel')],
              ['full', tr('Full page')],
            ],
            P.openTasks,
          ),
        ) +
        srow(tr('Confirm before deleting tasks'), '', tog('confirmDel', P.confirmDel !== false, 'pref', tr('Confirm before deleting tasks')))
      );
    case 'shortcuts':
      return (
        H(tr('Move faster with the keyboard.')) +
        SHORTCUTS.map(
          ([g, list]) =>
            `<div class="sblock" style="margin-top:18px"><h2>${tr(g)}</h2>${list.map(([n, k]) => `<div class="srow" style="padding:9px 0"><span>${tr(n)}</span><span class="row" style="gap:4px">${k.map((x, i) => `${i && k[0] === 'G' ? `<span class="faint" style="font-size:11px">${tr('then')}</span>` : ''}<kbd>${x}</kbd>`).join('')}</span></div>`).join('')}</div>`,
        ).join('')
      );
    case 'password': {
      const e = S.ui.errors;
      const pw = S.ui.pwNew || '';
      return (
        H(tr("Use a long password you don't use anywhere else.")) +
        `${S.ui.pwDone ? `<div class="alert ok" style="margin-bottom:14px">${ic('circle-check', 15)}<span>${tr('Password updated. Other sessions stay signed in.')}</span></div>` : ''}<form data-submit="savePassword" class="col" style="gap:14px;max-width:400px">
      <div class="field"><label class="label" for="pw-cur">${tr('Current password')}</label><input type="password" class="input ${e.pwCur ? 'is-error' : ''}" id="pw-cur" autocomplete="current-password">${e.pwCur ? `<span class="err">${ic('circle-alert', 12)}${e.pwCur}</span>` : ''}</div>
      <div class="field"><label class="label" for="pw-new">${tr('New password')}</label><input type="password" class="input ${e.pwNew ? 'is-error' : ''}" id="pw-new" data-in="pwStrength" value="${esc(pw)}" autocomplete="new-password">${strengthMeter(pw)}${e.pwNew ? `<span class="err">${ic('circle-alert', 12)}${e.pwNew}</span>` : `<span class="hint">${tr('At least 10 characters with a number or symbol.')}</span>`}</div>
      <div class="field"><label class="label" for="pw-conf">${tr('Confirm new password')}</label><input type="password" class="input ${e.pwConf ? 'is-error' : ''}" id="pw-conf" autocomplete="new-password">${e.pwConf ? `<span class="err">${ic('circle-alert', 12)}${e.pwConf}</span>` : ''}</div>
      <div><button class="btn btn-primary" data-a="savePassword" id="pw-save">${tr('Update password')}</button></div></form>`
      );
    }
    case 'sessions': {
      const dev = deviceInfo();
      return (
        H(tr('The browser you are signed in on, and a way to end other sessions.')) +
        srow(
          `<span class="row" style="gap:8px">${ic(dev.mobile ? 'smartphone' : 'monitor', 15)}${esc(dev.name)}<span class="badge green">${tr('This device')}</span></span>`,
          esc(me().email),
          '',
        ) +
        `<div class="row" style="margin-top:16px;gap:8px;flex-wrap:wrap"><button class="btn btn-danger-ghost" data-a="revokeAll">${tr('Sign out of all other sessions')}</button><button class="btn btn-secondary" data-a="signOut">${ic('log-out', 14)}${tr('Sign out')}</button></div>`
      );
    }
  }
  return page404();
}
export function strengthMeter(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  const c = ['var(--red)', 'var(--red)', 'var(--amber)', 'var(--green)', 'var(--green)'][s];
  const n = [tr('Too short'), tr('Weak'), tr('Fair'), tr('Good'), tr('Strong')][s];
  return pw
    ? `<div class="row" style="gap:8px"><div class="strength grow" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i < s ? 'on' : ''}" style="--c:${c}"></i>`).join('')}</div><span style="font-size:11.5px;color:${c};width:60px;text-align:right">${n}</span></div>`
    : '';
}
