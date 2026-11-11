/* ---------------- POPOVERS ---------------- */
import { $, MOD, TODAY, addD, dOff, diffD, esc, fmtDate, iso, parse } from '../core/utils.js';
import { ic, wsLogo } from '../core/icons.js';
import { getLang, monthYear, tr, wdShort } from '../core/i18n.js';
import { LABELS, PRIOS, PSTAT, STATUSES } from '../core/constants.js';
import { D, S, allTasks, canCreate, canManage, canSee, me, mem, pColor, proj, task, visibleProjects } from '../core/store.js';
import { av, avStack, prIcon, stIcon } from '../ui/helpers.js';
import { focusKey, render } from '../shell/render.js';
import { FIELDS, viewOf } from '../shell/view-engine.js';
import { TCOLS } from '../views/table.js';
import { startOfWeek, visibleEvents } from '../views/calendar.js';
import { ctxMenu } from './context-menu.js';

export function openPop(el, extra = {}) {
  const r = el.getBoundingClientRect();
  const d = el.dataset;
  S.ui.popOpener = focusKey(el);
  S.ui.pop = {
    type: d.pop,
    id: d.id,
    key: d.key,
    i: d.i != null ? +d.i : undefined,
    field: d.field,
    date: d.date,
    x: r.left,
    y: r.bottom + 4,
    top: r.top,
    w: r.width,
    q: '',
    ...extra,
  };
  if (d.pop === 'date') {
    const tk = task(d.id);
    const cur = S.ui.pop.id === '__form' ? S.ui.form[d.field] : d.field === 'subdue' ? tk?.subtasks[+d.i]?.due : tk?.[d.field];
    S.ui.pop.m = iso(cur ? parse(cur) : TODAY);
  }
  render();
  setTimeout(() => {
    const q = $('.pop input[data-pop-q]');
    if (q) {
      q.focus();
      return;
    }
    const first = $('.pop.floating .mi[aria-checked="true"]') || $('.pop.floating .mi, .pop.floating button, .pop.floating input');
    first?.focus({ preventScroll: true });
  }, 10);
}
export function placePop() {
  const el = $('.pop.floating');
  const p = S.ui.pop;
  if (!el || !p) return;
  const w = el.offsetWidth,
    h = el.offsetHeight;
  let x = p.x,
    y = p.y;
  if (x + w > innerWidth - 8) x = Math.max(8, (p.right ? p.x : p.x + (p.w || 0)) - w);
  if (y + h > innerHeight - 8) y = Math.max(8, (p.top != null ? p.top - 4 : p.y) - h);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}
export function closePop() {
  if (S.ui.pop) {
    S.ui.pop = null;
    render();
  }
}
export function tgt(p) {
  return p.id === '__form' ? S.ui.form : task(p.id);
}
export function popList(items, opt = {}) {
  const q = (S.ui.pop.q || '').toLowerCase();
  const list = items.filter(it => !q || it.name.toLowerCase().includes(q) || (it.alt || '').toLowerCase().includes(q));
  return `${opt.search ? `<div class="pin"><input data-pop-q data-in="popQ" id="pop-q" placeholder="${esc(opt.search)}" value="${esc(S.ui.pop.q || '')}" aria-label="${esc(opt.search)}"></div>` : ''}
    ${list.map(it => `<button class="mi" data-a="${it.act || 'popPick'}" data-v="${esc(it.id)}" role="${opt.multi ? 'menuitemcheckbox' : 'menuitemradio'}" aria-checked="${!!it.on}">${it.html || ''}<span class="trunc">${esc(it.name)}</span>${it.kbd ? `<span class="r"><kbd>${it.kbd}</kbd></span>` : ''}${it.on ? `<span class="ck">${ic('check', 14)}</span>` : ''}</button>`).join('') || `<div class="mi faint" style="cursor:default">${tr('No matches')}</div>`}`;
}
export function miniCal(p, val) {
  const m = parse(p.m);
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addD(start, i));
  // Two letters are ambiguous in Portuguese (qua/qui, seg/sex), so there the initial is shown.
  const wdn = Array.from({ length: 7 }, (_, i) => {
    const w = wdShort((i + S.prefs.weekStart) % 7);
    return getLang() === 'pt-BR' ? w.slice(0, 1).toUpperCase() : w.slice(0, 2);
  });
  return `<div style="padding:6px 6px 2px;width:252px">
    <div class="row" style="margin-bottom:6px"><b style="font-weight:600;font-size:13px;padding-left:4px">${monthYear(m)}</b><span class="sp"></span><button class="ibtn ibtn-xs" data-a="popMonth" data-d="-1" aria-label="${tr('Previous month')}">${ic('chevron-left', 14)}</button><button class="ibtn ibtn-xs" data-a="popMonth" data-d="1" aria-label="${tr('Next month')}">${ic('chevron-right', 14)}</button></div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;font-size:11px">${wdn.map(d => `<span class="faint" style="padding:3px 0">${d}</span>`).join('')}
    ${cells
      .map(d => {
        const ds = iso(d);
        const on = ds === val;
        const today = diffD(d, TODAY) === 0;
        return `<button data-a="popPick" data-v="${ds}" style="height:30px;border-radius:6px;font-size:12px;${on ? 'background:var(--accent);color:var(--on-accent);font-weight:600' : today ? 'color:var(--accent);font-weight:600;box-shadow:inset 0 0 0 1px var(--accent-line)' : d.getMonth() !== m.getMonth() ? 'color:var(--text-3)' : ''}" onmouseover="if(!this.style.background)this.style.background='var(--surface-2)'" onmouseout="if(this.style.background==='var(--surface-2)')this.style.background=''" aria-label="${fmtDate(ds, true)}" class="num">${d.getDate()}</button>`;
      })
      .join('')}</div></div>`;
}
export function popHtml(p) {
  let inner = '',
    cls = '',
    style = '';
  const t = ['status', 'priority', 'assignee', 'labels', 'date', 'project', 'deps', 'recur', 'estimate'].includes(p.type) ? tgt(p) : null;
  switch (p.type) {
    case 'create':
      inner = `<div class="mh">${tr('Create')}</div><button class="mi" data-a="newTask">${ic('circle-check', 15)}${tr('Task')}<span class="r"><kbd>N</kbd></span></button><button class="mi" data-a="newEvent">${ic('calendar-plus', 15)}${tr('Event')}</button>${canCreate() ? `<button class="mi" data-a="newProject">${ic('folder-plus', 15)}${tr('Project')}<span class="r"><kbd>P</kbd></span></button>` : ''}<button class="mi" data-a="newTeam">${ic('users', 15)}${tr('Team')}</button>${canCreate() ? `<div class="msep"></div><button class="mi" data-a="invite">${ic('user-plus', 15)}${tr('Invite member')}</button>` : ''}`;
      style = 'width:220px';
      break;
    case 'subassignee': {
      const tk = task(p.id);
      const sb = tk?.subtasks[p.i];
      if (!sb) break;
      inner = popList(
        [
          { id: '', name: tr('Unassigned'), alt: 'Unassigned', html: av(null, 'sm', false), on: !sb.assignee },
          ...D()
            .members.filter(m => m.status !== 'deactivated')
            .map(m => ({ id: m.id, name: m.name + (m.id === D().me ? ` (${tr('you')})` : ''), html: av(m.id, 'sm', false), on: sb.assignee === m.id })),
        ],
        { search: tr('Assign subtask to…') },
      );
      break;
    }
    case 'status':
      inner = popList(STATUSES.map((s, i) => ({ id: s.id, name: tr(s.name), alt: s.name, html: stIcon(s.id), on: t?.status === s.id, kbd: i + 1 })));
      break;
    case 'priority':
      inner = popList(PRIOS.map(x => ({ id: x.id, name: tr(x.name), alt: x.name, html: prIcon(x.id), on: t?.priority === x.id })));
      break;
    case 'assignee':
      inner = popList(
        [
          { id: '', name: tr('Unassigned'), alt: 'Unassigned', html: av(null, 'sm', false), on: !t?.assignee },
          ...D()
            .members.filter(m => m.status !== 'deactivated')
            .map(m => ({ id: m.id, name: m.name + (m.id === D().me ? ` (${tr('you')})` : ''), html: av(m.id, 'sm', false), on: t?.assignee === m.id })),
        ],
        { search: tr('Assign to…') },
      );
      break;
    case 'labels':
      inner = popList(
        LABELS.map(l => ({
          id: l.id,
          name: tr(l.name),
          alt: l.name,
          html: `<span class="pdot" style="--c:${l.c}"></span>`,
          on: t?.labels.includes(l.id),
          act: 'popToggleLabel',
        })),
        { search: tr('Filter labels…'), multi: true },
      );
      break;
    case 'project':
      inner = popList(
        visibleProjects()
          .filter(q => canSee(q) && q.status !== 'complete')
          .map(q => ({ id: q.id, name: q.name, html: `<span class="pdot" style="--c:${pColor(q)}"></span>`, on: t?.project === q.id })),
        { search: tr('Move to project…') },
      );
      break;
    case 'recur':
      inner = popList(
        [
          ['Does not repeat', tr('Does not repeat')],
          ['Daily', tr('Daily')],
          ['Weekly', tr('Weekly')],
          ['Every 2 weeks', tr('Every 2 weeks')],
          ['Monthly', tr('Monthly')],
        ].map(([x, label]) => ({
          id: x,
          name: label,
          alt: x,
          html: ic('repeat', 14),
          on: (t?.recur || 'Does not repeat') === x,
        })),
      );
      break;
    case 'estimate':
      inner = popList(
        ['30m', '1h', '2h', '4h', '1d', '2d', '3d', '5d', '8d']
          .map(x => ({ id: x, name: x, html: ic('timer', 14), on: t?.estimate === x }))
          .concat([{ id: '', name: tr('Clear estimate'), html: ic('x', 14) }]),
      );
      break;
    case 'deps': {
      if (!t) break;
      const cands = D().tasks.filter(x => x.project === t.project && x.id !== t.id && !x.archived);
      inner = popList(
        cands.map(x => ({ id: x.id, name: `${x.key}  ${x.title}`, html: stIcon(x.status), on: t.deps.includes(x.id), act: 'popToggleDep' })),
        { search: tr('Blocked by…'), multi: true },
      );
      break;
    }
    case 'date': {
      const val = p.field === 'subdue' ? t?.subtasks[p.i]?.due : t?.[p.field];
      const q = [
        [tr('Today'), 0],
        [tr('Tomorrow'), 1],
        [tr('Next week'), 7 - ((TODAY.getDay() + 6) % 7)],
        [tr('In 2 weeks'), 14],
      ];
      inner = `<div class="row" style="gap:4px;padding:4px;flex-wrap:wrap">${q.map(([n, d]) => `<button class="badge" data-a="popPick" data-v="${dOff(d)}" style="cursor:pointer">${n}</button>`).join('')}${val ? `<button class="badge" data-a="popPick" data-v="" style="cursor:pointer;color:var(--red)">${tr('Clear')}</button>` : ''}</div><div class="msep"></div>${miniCal(p, val)}`;
      style = 'min-width:0';
      break;
    }
    case 'pstatus': {
      const pr = proj(p.id);
      if (!pr) break;
      inner = popList(
        Object.entries(PSTAT).map(([k, v]) => ({
          id: k,
          name: tr(v.name),
          alt: v.name,
          html: `<span class="pdot" style="--c:${v.c};border-radius:50%"></span>`,
          on: pr.status === k,
        })),
      );
      break;
    }
    case 'role': {
      const m = mem(p.id);
      if (!canManage(m)) break;
      inner =
        `<div class="mh">${tr('Role for {name}', { name: esc(m.name) })}</div>` +
        [
          ['Admin', tr('Admin'), tr('Manage members, settings, and all projects')],
          ['Member', tr('Member'), tr('Create projects and work on tasks')],
          ['Guest', tr('Guest'), tr('Only sees projects they are invited to')],
        ]
          .map(
            ([r, name, desc]) =>
              `<button class="mi" data-a="popPick" data-v="${r}" style="height:auto;padding:7px 8px;align-items:flex-start"><div class="grow" style="white-space:normal"><div style="font-weight:500">${name}</div><div class="faint" style="font-size:11.5px">${desc}</div></div>${m.role === r ? `<span class="ck">${ic('check', 14)}</span>` : ''}</button>`,
          )
          .join('');
      style = 'width:300px';
      break;
    }
    case 'ws':
      inner = `<div class="mh">${tr('Workspaces')}</div>${D()
        .workspaces.map(
          w =>
            `<button class="mi" data-a="switchWs" data-v="${w.id}">${wsLogo(w, 20)}<span class="grow">${esc(w.name)}</span><span class="faint" style="font-size:11px">${esc(tr(w.role || ''))}</span>${w.id === D().ws.id ? `<span class="ck">${ic('check', 14)}</span>` : ''}</button>`,
        )
        .join(
          '',
        )}<div class="msep"></div><button class="mi" data-a="newWorkspace">${ic('plus', 15)}${tr('Create workspace')}</button><button class="mi" data-a="go" data-r="settings" data-sec="workspace">${ic('settings', 15)}${tr('Workspace settings')}</button>${canCreate() ? `<button class="mi" data-a="invite">${ic('user-plus', 15)}${tr('Invite members')}</button>` : ''}<div class="msep"></div><button class="mi" data-a="signOut">${ic('log-out', 15)}${tr('Sign out')}</button>`;
      style = 'width:260px';
      break;
    case 'user':
      inner = `<div class="row" style="padding:8px 8px 10px;gap:10px">${av(D().me, 'lg', false)}<div style="min-width:0"><div style="font-weight:600">${esc(S.prefs.name)}</div><div class="faint trunc" style="font-size:12px">${esc(me()?.email)}</div></div></div><div class="msep"></div>
      <button class="mi" data-a="go" data-r="member" data-id="${D().me}">${ic('user', 15)}${tr('View profile')}</button><button class="mi" data-a="go" data-r="settings" data-sec="profile">${ic('settings', 15)}${tr('Account settings')}</button>
      <div class="msep"></div><div class="mh">${tr('Theme')}</div><div style="padding:2px 6px 6px"><div class="seg" style="width:100%">${[
        ['light', 'sun', tr('Light')],
        ['dark', 'moon', tr('Dark')],
        ['system', 'monitor', tr('System')],
      ]
        .map(
          ([k, i, n]) =>
            `<button class="${S.prefs.theme === k ? 'on' : ''}" style="flex:1;justify-content:center" data-a="setTheme" data-v="${k}">${ic(i, 13)}${n}</button>`,
        )
        .join('')}</div></div>
      <div class="msep"></div><button class="mi" data-a="shortcuts">${ic('keyboard', 15)}${tr('Keyboard shortcuts')}<span class="r"><kbd>?</kbd></span></button><button class="mi" data-a="signOut">${ic('log-out', 15)}${tr('Sign out')}</button>`;
      style = 'width:260px';
      break;
    case 'help':
      inner = `<div class="mh">${tr('Help & resources')}</div><button class="mi" data-a="shortcuts">${ic('keyboard', 15)}${tr('Keyboard shortcuts')}<span class="r"><kbd>?</kbd></span></button><button class="mi" data-a="openPalette">${ic('command', 15)}${tr('Command menu')}<span class="r"><kbd>${MOD}K</kbd></span></button>${
        // Internal component galleries exist only in development builds.
        import.meta.env.DEV
          ? `<div class="msep"></div><div class="mh">Development</div><button class="mi" data-a="go" data-r="system">${ic('component', 15)}Design system</button><button class="mi" data-a="go" data-r="states">${ic('layers', 15)}System states</button>`
          : ''
      }`;
      style = 'width:260px';
      break;
    case 'sort': {
      const v = viewOf(p.key);
      inner =
        `<div class="mh">${tr('Sort by')}</div>` +
        [
          ['manual', tr('Manual')],
          ['priority', tr('Priority')],
          ['due', tr('Due date')],
          ['start', tr('Start date')],
          ['title', tr('Title')],
          ['status', tr('Status')],
          ['assignee', tr('Assignee')],
          ['created', tr('Created')],
          ['updated', tr('Last updated')],
        ]
          .map(
            ([k, n]) =>
              `<button class="mi" data-a="setSort" data-key="${p.key}" data-v="${k}">${n}${v.sort.f === k ? `<span class="ck">${ic('check', 14)}</span>` : ''}</button>`,
          )
          .join('') +
        `<div class="msep"></div><div style="padding:4px 6px"><div class="seg" style="width:100%"><button class="${v.sort.dir > 0 ? 'on' : ''}" style="flex:1;justify-content:center" data-a="setSortDir" data-key="${p.key}" data-v="1">${ic('arrow-up', 12)}${tr('Ascending')}</button><button class="${v.sort.dir < 0 ? 'on' : ''}" style="flex:1;justify-content:center" data-a="setSortDir" data-key="${p.key}" data-v="-1">${ic('arrow-down', 12)}${tr('Descending')}</button></div></div>`;
      style = 'width:240px';
      break;
    }
    case 'group': {
      const v = viewOf(p.key);
      inner =
        `<div class="mh">${tr('Group by')}</div>` +
        [
          ['status', tr('Status'), 'circle-dot'],
          ['priority', tr('Priority'), 'signal-high'],
          ['assignee', tr('Assignee'), 'user'],
          ['project', tr('Project'), 'folder'],
          ['due', tr('Due date'), 'calendar'],
          ['none', tr('No grouping'), 'minus'],
        ]
          .map(
            ([k, n, i]) =>
              `<button class="mi" data-a="setGroup" data-key="${p.key}" data-v="${k}">${ic(i, 15)}${n}${v.group === k ? `<span class="ck">${ic('check', 14)}</span>` : ''}</button>`,
          )
          .join('');
      break;
    }
    case 'cols': {
      const v = viewOf(p.key);
      inner =
        `<div class="mh">${tr('Visible columns')}</div>` +
        TCOLS.filter(c => c[0] !== 'title')
          .map(
            c =>
              `<label class="mi" style="cursor:pointer"><input type="checkbox" class="check" data-a="toggleCol2" data-key="${p.key}" data-v="${c[0]}" ${v.hidden.includes(c[0]) ? '' : 'checked'}>${tr(c[1])}</label>`,
          )
          .join('') +
        `<div class="msep"></div><button class="mi" data-a="resetCols" data-key="${p.key}">${ic('rotate-ccw', 14)}${tr('Reset widths')}</button>`;
      break;
    }
    case 'filter':
      inner = filterBuilder(p);
      cls = 'fbuild';
      style = 'max-width:560px';
      break;
    case 'fvals': {
      const v = viewOf(p.key);
      const f = v.filters[p.i];
      if (!f) break;
      inner =
        `<div class="mh">${f.op === 'not' ? tr('{field} is not', { field: tr(FIELDS[f.f].name) }) : tr('{field} is', { field: tr(FIELDS[f.f].name) })}</div>` +
        FIELDS[f.f]
          .opts()
          .map(
            o =>
              `<label class="mi" style="cursor:pointer"><input type="checkbox" class="check" data-a="fToggleVal" data-key="${p.key}" data-i="${p.i}" data-v="${o.id}" ${f.v.includes(o.id) ? 'checked' : ''}>${o.html || ''}${esc(optName(f.f, o))}</label>`,
          )
          .join('');
      break;
    }
    case 'daylist': {
      const ds = p.date;
      // Project calendars list only that project's items; the workspace calendar lists everything visible.
      const pid = p.key?.startsWith('p:') ? p.key.slice(2) : p.key?.startsWith('sv:') ? D().savedViews.find(v => v.id === p.key.slice(3))?.project : null;
      const evs = p.key === 'my' ? [] : visibleEvents(pid).filter(e => e.date === ds);
      const ts = allTasks().filter(x => x.due === ds && (!pid || x.project === pid));
      inner =
        `<div class="mh">${fmtDate(ds, true)}</div>` +
        (p.key === 'my'
          ? ''
          : `<button class="mi" data-a="newEvent" data-date="${ds}" ${pid ? `data-project="${pid}"` : ''}>${ic('calendar-plus', 14)}${tr('Add event')}</button>`) +
        `<button class="mi" data-a="newTask" data-due="${ds}" ${pid ? `data-project="${pid}"` : ''}>${ic('plus', 14)}${tr('Add task')}</button>` +
        (evs.length || ts.length ? '<div class="msep"></div>' : `<div class="mi faint" style="cursor:default">${tr('Nothing scheduled')}</div>`) +
        evs
          .map(
            e =>
              `<button class="mi" data-a="pop" data-pop="event" data-id="${e.id}">${ic('clock', 14)}<span class="trunc">${esc(e.title)}</span><span class="r">${esc(e.time || tr('All day'))}</span></button>`,
          )
          .join('') +
        ts
          .map(
            x =>
              `<button class="mi" data-a="openTask" data-id="${x.id}">${stIcon(x.status)}<span class="trunc">${esc(x.title)}</span><span class="r">${av(x.assignee, 'sm', false)}</span></button>`,
          )
          .join('');
      style = 'width:280px';
      break;
    }
    case 'event': {
      const e = D().events.find(x => x.id === p.id);
      const pr = e?.project ? proj(e.project) : null;
      if (!e || (pr && !canSee(pr))) break;
      inner = `<div style="padding:10px 10px 6px"><div class="row" style="gap:8px;margin-bottom:6px"><span class="pdot" style="--c:${pColor(pr)};border-radius:50%"></span><b style="font-size:14px;font-weight:600;overflow-wrap:anywhere">${esc(e.title)}</b></div><div class="muted" style="font-size:12.5px;display:flex;flex-direction:column;gap:4px"><span class="row" style="gap:6px">${ic('calendar', 13)}${fmtDate(e.date, true)} · ${esc(e.time || tr('All day'))}</span><span class="row" style="gap:6px">${ic('folder', 13)}${esc(pr?.name || tr('No project'))}</span>${pr ? `<span class="row" style="gap:6px">${ic('users', 13)}${avStack(pr.members, 5)}</span>` : ''}</div></div><div class="msep"></div>${pr ? `<button class="mi" data-a="go" data-r="project" data-id="${pr.id}" data-tab="overview">${ic('arrow-up-right', 14)}${tr('Open project')}</button>` : ''}<button class="mi" data-a="editEvent" data-id="${e.id}">${ic('pencil', 14)}${tr('Edit event')}</button><button class="mi danger" data-a="delEvent" data-id="${e.id}">${ic('trash-2', 14)}${tr('Delete event')}</button>`;
      style = 'width:270px';
      break;
    }
    case 'emoji':
      inner = `<div class="row" style="gap:2px;padding:2px">${['👍', '🎉', '❤️', '👀', '🚀', '✅'].map(e => `<button class="ibtn" data-a="react" data-id="${p.id}" data-e="${e}" style="font-size:16px" aria-label="${tr('React {e}', { e })}">${e}</button>`).join('')}</div>`;
      style = 'min-width:0';
      break;
    case 'ctx':
      inner = ctxMenu(p);
      break;
    case 'bulk-status':
      inner = STATUSES.map(s => `<button class="mi" data-a="bulkSet" data-f="status" data-v="${s.id}">${stIcon(s.id)}${tr(s.name)}</button>`).join('');
      break;
    case 'bulk-priority':
      inner = PRIOS.map(s => `<button class="mi" data-a="bulkSet" data-f="priority" data-v="${s.id}">${prIcon(s.id)}${tr(s.name)}</button>`).join('');
      break;
    case 'bulk-assignee':
      inner = [{ id: '', name: tr('Unassigned') }, ...D().members]
        .map(m => `<button class="mi" data-a="bulkSet" data-f="assignee" data-v="${m.id}">${av(m.id || null, 'sm', false)}${esc(m.name)}</button>`)
        .join('');
      break;
  }
  if (!inner) return '';
  return `<div class="pop floating ${cls} ${S.ui.fx.pop ? 'enter' : ''}" role="menu" style="left:${p.x}px;top:${p.y}px;${style}" data-pop-root>${inner}</div>`;
}
/* Filter option labels: built-in vocabulary is translated; project and member names are user content. */
function optName(field, o) {
  if (field === 'project') return o.name;
  if (field === 'assignee') return o.id === 'none' ? tr('Unassigned') : o.id === D().me ? `${o.name.slice(0, -6)} (${tr('you')})` : o.name;
  return tr(o.name);
}
export function filterBuilder(p) {
  const v = viewOf(p.key);
  const rows = v.filters
    .map((f, i) => {
      const F = FIELDS[f.f];
      const opts = F.opts();
      const names = f.v.map(id => {
        const o = opts.find(x => x.id === id);
        return o ? optName(f.f, o) : id;
      });
      const open = p.edit === i;
      return `<div class="frow"><span class="conj">${i ? tr('and') : tr('Where')}</span>
      <select class="select" data-in="fField" data-key="${p.key}" data-i="${i}" aria-label="${tr('Field')}">${Object.entries(FIELDS)
        .map(([k, x]) => `<option value="${k}" ${f.f === k ? 'selected' : ''}>${tr(x.name)}</option>`)
        .join('')}</select>
      <select class="select" data-in="fOp" data-key="${p.key}" data-i="${i}" aria-label="${tr('Operator')}"><option value="is" ${f.op === 'is' ? 'selected' : ''}>${tr('is')}</option><option value="not" ${f.op === 'not' ? 'selected' : ''}>${tr('is not')}</option></select>
      <button class="valbtn" data-a="fEdit" data-i="${i}" aria-expanded="${open}"><span class="trunc grow">${names.length ? esc(names.join(', ')) : `<span class="faint">${tr('Select…')}</span>`}</span>${ic('chevron-down', 12)}</button>
      <button class="ibtn ibtn-xs" data-a="rmFilter" data-key="${p.key}" data-i="${i}" aria-label="${tr('Remove filter')}">${ic('trash-2', 13)}</button></div>
      ${open ? `<div style="margin-left:50px;border:1px solid var(--border);border-radius:var(--r);padding:4px;max-height:200px;overflow:auto">${opts.map(o => `<label class="mi" style="cursor:pointer;min-height:28px"><input type="checkbox" class="check" data-a="fToggleVal" data-key="${p.key}" data-i="${i}" data-v="${o.id}" ${f.v.includes(o.id) ? 'checked' : ''}>${o.html || ''}${esc(optName(f.f, o))}</label>`).join('')}</div>` : ''}`;
    })
    .join('');
  return `<div class="mh fb-h">${tr('Filter by')}${v.filters.length ? `<button class="btn btn-sm btn-ghost" data-a="clearFilters" data-key="${p.key}">${tr('Clear all')}</button>` : ''}</div>
    ${rows ? `<div class="fb-rows">${rows}</div>` : `<p class="fb-empty">${tr('No filters applied. Combine filters to narrow the task list, e.g. Status is In Progress and Assignee is Sarah.')}</p>`}
    <div class="msep"></div><div class="fb-add"><span class="faint">${tr('Add filter:')}</span>${Object.entries(FIELDS)
      .map(
        ([k, x]) => `<button class="badge" style="cursor:pointer" data-a="addFilter" data-key="${p.key}" data-f="${k}">${ic(x.icon, 11)}${tr(x.name)}</button>`,
      )
      .join('')}</div>`;
}
