/* ---------- WORKSPACE TASKS ---------- */
import { ic } from '../core/icons.js';
import { tr } from '../core/i18n.js';
import { allTasks, canSee, visibleProjects } from '../core/store.js';
import { applyView, groupTasks, viewOf, viewToolbar } from '../shell/view-engine.js';
import { listHtml } from '../components/task-list.js';
import { boardHtml } from '../views/board.js';
import { tableHtml } from '../views/table.js';

export function pageTasks() {
  const key = 'tasks';
  const v = viewOf(key);
  v.mode = v.mode || 'list';
  const ts = applyView(allTasks(), v);
  const right = `<div class="seg">${[
    ['list', tr('List'), 'list'],
    ['board', tr('Board'), 'square-kanban'],
    ['table', tr('Table'), 'table-2'],
  ]
    .map(
      ([k, n, i]) =>
        `<button class="${v.mode === k ? 'on' : ''}" data-a="setViewMode" data-key="${key}" data-v="${k}">${ic(i, 13)}<span class="hide-m">${n}</span></button>`,
    )
    .join('')}</div>`;
  let body;
  if (v.mode === 'board') body = boardHtml(ts, key, {});
  else if (v.mode === 'table') body = tableHtml(ts, key);
  else body = `<div class="list-wrap">${listHtml(groupTasks(ts, v.group), key, { cols: ['status', 'assignee', 'priority', 'due', 'project'] })}</div>`;
  return `<div class="page flush">
    <div class="ph"><div><h1>${tr('Tasks')}</h1><p>${tr('Every task across {n} projects.', { n: visibleProjects().filter(canSee).length })}</p></div><div class="acts"><button class="btn btn-primary" data-a="newTask">${ic('plus', 14)}${tr('New task')}</button></div></div>
    ${viewToolbar(key, { right, cols: v.mode === 'table', group: v.mode !== 'board' })}
    ${body}
  </div>`;
}
