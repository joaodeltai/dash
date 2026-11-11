/* =====================================================================
   PAGES
   ===================================================================== */
import { ago, esc, relDate } from '../core/utils.js';
import { tr, trn } from '../core/i18n.js';
import { actExtra, actVerb } from '../core/activity-text.js';
import { ic } from '../core/icons.js';
import { PR, ST } from '../core/constants.js';
import { D, S, commentsOf, isOver, mem, pColor, proj, task } from '../core/store.js';
import { authorAv, authorName, av, dueHtml, empty, lbl, prIcon, prPill, stIcon, stPill } from '../ui/helpers.js';
import { fxc } from '../shell/render.js';

/* ---------- shared list renderer ---------- */
/* Column headings are English keys: show them with tr(). */
export const LCOLS = {
  status: ['Status', '126px'],
  assignee: ['Assignee', '150px'],
  priority: ['Priority', '108px'],
  due: ['Due date', '104px'],
  labels: ['Labels', '168px'],
  project: ['Project', '160px'],
};
export function cellStatus(t) {
  return `<button class="pillbtn" data-a="pop" data-pop="status" data-id="${t.id}" aria-label="${tr('Status')}: ${tr(ST[t.status].name)}">${stPill(t.status)}</button>`;
}
export function cellAssignee(t) {
  const m = mem(t.assignee);
  return `<button class="pillbtn ${m ? '' : 'empty'}" data-a="pop" data-pop="assignee" data-id="${t.id}" aria-label="${tr('Assignee')}">${av(t.assignee, 'sm', false)}<span class="trunc">${m ? esc(m.name) : tr('Unassigned')}</span></button>`;
}
export function cellPrio(t) {
  return `<button class="pillbtn ${t.priority === 'none' ? 'empty' : ''}" data-a="pop" data-pop="priority" data-id="${t.id}" aria-label="${tr('Priority')}">${prPill(t.priority)}</button>`;
}
export function cellDue(t) {
  return `<button class="pillbtn ${t.due ? (isOver(t) ? 'over' : '') : 'empty'}" data-a="pop" data-pop="date" data-field="due" data-id="${t.id}" aria-label="${tr('Due date')}">${t.due ? `${ic('calendar', 13)}<span class="num">${relDate(t.due)}</span>` : `${ic('calendar', 13)}<span>${tr('Set date')}</span>`}</button>`;
}
export function cellLabels(t) {
  return `<button class="pillbtn ${t.labels.length ? '' : 'empty'}" data-a="pop" data-pop="labels" data-id="${t.id}" aria-label="${tr('Labels')}" style="gap:4px;overflow:hidden">${t.labels.length ? t.labels.slice(0, 2).map(lbl).join('') + (t.labels.length > 2 ? `<span class="faint" style="font-size:11px">+${t.labels.length - 2}</span>` : '') : `${ic('tag', 13)}<span>${tr('Add')}</span>`}</button>`;
}
export function cellProject(t) {
  const p = proj(t.project);
  return `<button class="pillbtn" data-a="pop" data-pop="project" data-id="${t.id}" aria-label="${tr('Project')}"><span class="pdot" style="--c:${pColor(p)}"></span><span class="trunc">${esc(p?.name)}</span></button>`;
}
export const CELL = { status: cellStatus, assignee: cellAssignee, priority: cellPrio, due: cellDue, labels: cellLabels, project: cellProject };

export function taskRow(t, cols, tpl, opt = {}) {
  const sel = S.ui.sel.has(t.id);
  const open = S.ui.openTasks[t.id];
  const editing = S.ui.editCell && S.ui.editCell.id === t.id && S.ui.editCell.f === 'title';
  const cc = commentsOf(t.id).length;
  const sd = t.subtasks.filter(s => s.done).length;
  return `<div class="trow ${t.status === 'done' ? 'done' : ''} ${sel ? 'sel' : ''}${fxc('done', t.id)}${fxc('added', t.id)}" style="--cols:${tpl}" data-task-row="${t.id}" data-group="${opt.group || ''}" data-lkey="${opt.key || ''}" data-ctx="task" data-id="${t.id}">
    <div class="handle" draggable="${opt.drag !== false}" data-drag-row="${t.id}" aria-hidden="true">${opt.drag !== false ? ic('grip-vertical', 14) : ''}</div>
    <div class="c-check">${
      opt.complete
        ? `<input type="checkbox" class="check round" ${t.status === 'done' ? 'checked' : ''} data-a="toggleDone" data-id="${t.id}" aria-label="${esc(tr('Mark {title} complete', { title: t.title }))}">`
        : `<input type="checkbox" class="check" ${sel ? 'checked' : ''} data-a="selRow" data-id="${t.id}" aria-label="${esc(tr('Select {title}', { title: t.title }))}">`
    }</div>
    <div class="ttl" ${editing ? '' : `data-a="openTask" data-id="${t.id}"`} data-dbl="editTitle">
      ${t.subtasks.length ? `<span class="ibtn ibtn-xs" data-a="expandRow" data-id="${t.id}" aria-label="${open ? tr('Hide subtasks') : tr('Show subtasks')}" aria-expanded="${!!open}" style="margin-left:-4px">${ic(open ? 'chevron-down' : 'chevron-right', 13)}</span>` : '<span style="width:18px;flex-shrink:0"></span>'}
      <span class="key">${esc(t.key)}</span>
      ${editing ? `<input class="inline-in" id="edit-title" data-in="noop" data-blur="commitTitle" data-key-enter="commitTitle" data-id="${t.id}" value="${esc(t.title)}" aria-label="${tr('Task title')}">` : `<span class="tt">${esc(t.title)}</span>`}
      ${t.recur ? `<span class="meta-mini" data-tip="${tr('Repeats {how}', { how: tr(t.recur).toLowerCase() })}">${ic('repeat', 11)}</span>` : ''}
      ${t.subtasks.length ? `<span class="meta-mini">${ic('list-checks', 11)}${sd}/${t.subtasks.length}</span>` : ''}
      ${cc ? `<span class="meta-mini">${ic('message-square', 11)}${cc}</span>` : ''}
    </div>
    ${cols.map(c => `<div class="c-meta c-${c === 'labels' ? 'lbl' : c}">${CELL[c](t)}</div>`).join('')}
    <div class="c-more"><button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="task" data-id="${t.id}" aria-label="${tr('More actions')}">${ic('ellipsis', 15)}</button></div>
  </div>
  ${open ? `<div class="subrows">${t.subtasks.map(s => `<div class="subrow ${s.done ? 'done' : ''}"><input type="checkbox" class="check" ${s.done ? 'checked' : ''} data-a="toggleSub" data-id="${t.id}" data-sid="${s.id}" aria-label="${tr('Complete subtask')}"><span>${esc(s.title)}</span></div>`).join('')}</div>` : ''}`;
}
export function listHtml(groups, key, opt = {}) {
  const cols = opt.cols || ['status', 'assignee', 'priority', 'due', 'labels'];
  const tpl = `18px 30px minmax(220px,1fr) ${cols.map(c => LCOLS[c][1]).join(' ')} 40px`;
  const all = groups.flatMap(g => g.tasks.map(t => t.id));
  const nSel = all.filter(id => S.ui.sel.has(id)).length;
  const total = all.length;
  if (!total && !opt.keepEmpty)
    return (
      opt.emptyHtml ||
      empty(
        'list-checks',
        tr('No tasks here'),
        tr('Add a task to get things moving.'),
        `<button class="btn btn-primary btn-sm" data-a="newTask" ${opt.project ? `data-project="${opt.project}"` : ''}>${ic('plus', 14)}${tr('New task')}</button>`,
      )
    );
  const v = S.views[key];
  return `<div class="tlist" role="table" aria-label="${tr('Tasks')}">
    <div class="thead" style="--cols:${tpl}" role="row">
      <div></div>
      <div>${opt.complete ? '' : `<input type="checkbox" class="check" data-a="selAll" data-key="${key}" ${nSel && nSel === total ? 'checked' : ''} ${nSel && nSel < total ? 'data-indet="1"' : ''} aria-label="${tr('Select all')}">`}</div>
      <div data-a="sortBy" data-key="${key}" data-f="title" style="cursor:pointer">${tr('Task')} ${v?.sort.f === 'title' ? ic(v.sort.dir > 0 ? 'arrow-up' : 'arrow-down', 11) : ''}</div>
      ${cols.map(c => `<div data-a="sortBy" data-key="${key}" data-f="${c === 'labels' ? 'manual' : c}" style="cursor:pointer">${tr(LCOLS[c][0])} ${v?.sort.f === c ? ic(v.sort.dir > 0 ? 'arrow-up' : 'arrow-down', 11) : ''}</div>`).join('')}
      <div></div>
    </div>
    ${groups
      .map(g => {
        const gk = key + ':' + g.key;
        const coll = S.ui.collapsedGroups[gk] ?? (g.collapsed || false);
        const comp = S.ui.composer && S.ui.composer.ctx === key && S.ui.composer.group === g.key;
        return `${
          groups.length > 1 || g.key !== 'all'
            ? `<div class="grp" data-grp-drop="${g.key}" data-key="${key}">
          <button class="ibtn ibtn-xs" data-a="toggleGroup" data-gk="${gk}" aria-expanded="${!coll}" aria-label="${tr('Toggle group')}">${ic(coll ? 'chevron-right' : 'chevron-down', 13)}</button>
          ${g.html || ''}<span>${esc(g.name)}</span><span class="cnt">${g.tasks.length}</span>
          ${opt.noAdd ? '' : `<button class="ibtn ibtn-xs" data-a="startComposer" data-ctx="${key}" data-group="${g.key}" data-gb="${esc(JSON.stringify(g.set || {}))}" aria-label="${esc(tr('Add task to {group}', { group: g.name }))}">${ic('plus', 13)}</button>`}
        </div>`
            : ''
        }
        ${coll ? '' : g.tasks.map(t => taskRow(t, cols, tpl, { group: g.key, drag: opt.drag, complete: opt.complete, key })).join('')}
        ${coll || opt.noAdd ? '' : comp ? `<div class="addrow" style="background:var(--surface-2)">${ic('plus', 14)}<input class="inline-in" id="composer-in" data-key-enter="commitComposer" placeholder="${tr('Task name — press Enter to add, Esc to cancel')}" aria-label="${tr('New task name')}"></div>` : `<button class="addrow" data-a="startComposer" data-ctx="${key}" data-group="${g.key}" data-gb="${esc(JSON.stringify(g.set || {}))}">${ic('plus', 14)}${tr('Add task')}</button>`}`;
      })
      .join('')}
  </div>${bulkBar(all)}`;
}
export function bulkBar(ids) {
  const n = ids.filter(id => S.ui.sel.has(id)).length;
  if (!n) return '';
  return `<div class="bulkbar${S.ui.fx.bulk ? ' enter' : ''}" role="toolbar" aria-label="${tr('Bulk actions')}"><b style="font-weight:600">${trn('{n} selected|task', '{n} selected|tasks', n)}</b><span class="sep"></span>
    <button class="btn btn-sm" data-a="pop" data-pop="bulk-status">${ic('circle-dot', 14)}${tr('Status')}</button>
    <button class="btn btn-sm" data-a="pop" data-pop="bulk-assignee">${ic('user', 14)}${tr('Assignee')}</button>
    <button class="btn btn-sm" data-a="pop" data-pop="bulk-priority">${ic('signal-high', 14)}${tr('Priority')}</button>
    <button class="btn btn-sm" data-a="bulkDelete">${ic('trash-2', 14)}${tr('Delete')}</button><span class="sep"></span>
    <button class="btn btn-sm" data-a="clearSel" aria-label="${tr('Clear selection')}">${ic('x', 14)}</button></div>`;
}

/* ---------- activity rendering ----------
   An entry outlives what it is about. `a.task` / `a.project` are set while the task and project exist; after a
   deletion the entry keeps the task's title in `a.label` and, for a deleted project, its name in `a.projectName`.
   Verb and detail are stored in English and shown in the reader's language. */
export function actHtml(a, opt = {}) {
  const t = a.task ? task(a.task) : null;
  const p = a.project ? proj(a.project) : null;
  // an entry about the project itself (no task) carries the project's name as its label
  const aboutProject = !a.task && p && (!a.label || a.label === p.name || a.verb === 'created project' || a.verb === 'changed status of project');
  const obj = t
    ? `<span class="obj" data-a="openTask" data-id="${t.id}">${esc(t.title)}</span>`
    : aboutProject
      ? `<span class="obj" data-a="go" data-r="project" data-id="${p.id}">${esc(p.name)}</span>`
      : a.label
        ? `<span style="font-weight:500" data-tip="${tr('deleted task')}">${esc(a.label)}</span>`
        : '';
  const extra = actExtra(a);
  const where = !opt.proj
    ? ''
    : p && !aboutProject
      ? tr('in {project}', { project: p.name })
      : !p && a.projectName && a.label !== a.projectName
        ? tr('in {project}', { project: tr('{project} (deleted)', { project: a.projectName }) })
        : '';
  return `<div class="fitem">${authorAv(a.by, 'sm')}<div class="grow"><b>${esc(a.by && a.by === D().me ? tr('You') : authorName(a.by))}</b> <span class="muted">${esc(actVerb(a))}</span> ${obj} ${extra ? `<span class="muted">${esc(extra)}</span>` : ''}${where ? ` <span class="faint">${esc(where)}</span>` : ''}</div><time>${ago(a.at)}</time></div>`;
}
export function miniRow(t, opt = {}) {
  const p = proj(t.project);
  return `<div class="mini ${t.status === 'done' ? 'done' : ''}${fxc('done', t.id)}${fxc('added', t.id)}" data-a="openTask" data-id="${t.id}" data-ctx="task" role="button" tabindex="0">
    <input type="checkbox" class="check round" ${t.status === 'done' ? 'checked' : ''} data-a="toggleDone" data-id="${t.id}" aria-label="${esc(tr('Complete {title}', { title: t.title }))}">
    <span data-tip="${tr(ST[t.status].name)}">${stIcon(t.status)}</span>
    <span class="tt">${esc(t.title)}</span>
    ${opt.noProj ? '' : `<span class="pj hide-m"><span class="pdot" style="--c:${pColor(p)}"></span><span class="trunc">${esc(p?.name)}</span></span>`}
    <span data-tip="${t.priority === 'none' ? tr('No priority') : tr('{priority} priority', { priority: tr(PR[t.priority].name) })}">${prIcon(t.priority)}</span>
    <span style="width:74px;text-align:right" class="hide-m">${dueHtml(t, false)}</span>
    ${opt.av === false ? '' : av(t.assignee, 'sm')}
  </div>`;
}
