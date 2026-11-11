/* ---------- HOME ---------- */
import { DAY, TODAY, diffD, esc, fmtDate, parse } from '../core/utils.js';
import { longDay, tr, trn } from '../core/i18n.js';
import { ic } from '../core/icons.js';
import { D, S, allTasks, canCreate, canSee, isOver, me, pColor, progressOf, proj, visibleProjects } from '../core/store.js';
import { av, avStack, empty, pIcon, pStatus, prIcon, progBar } from '../ui/helpers.js';
import { sortTasks } from '../shell/view-engine.js';
import { actHtml, miniRow } from '../components/task-list.js';

export function pageHome() {
  const h = new Date().getHours();
  const greet = h < 12 ? tr('Good morning') : h < 18 ? tr('Good afternoon') : tr('Good evening');
  const all = allTasks();
  const mineAll = all.filter(t => t.assignee === D().me);
  const activeP = visibleProjects().filter(p => canSee(p) && p.status !== 'complete');
  const open = all.filter(t => t.status !== 'done');
  const doneWk = all.filter(t => t.status === 'done' && t.completedAt && Date.now() - t.completedAt < 7 * DAY);
  const over = all.filter(isOver);
  const tab = S.ui.homeTab;
  const lists = {
    upcoming: sortTasks(
      mineAll.filter(t => t.status !== 'done' && !isOver(t)),
      { f: 'due', dir: 1 },
    ),
    overdue: mineAll.filter(isOver),
    completed: sortTasks(
      mineAll.filter(t => t.status === 'done'),
      { f: 'updated', dir: 1 },
    ),
  };
  const cur = lists[tab].slice(0, 7);
  const dl = (lab, a, b) => {
    const ts = sortTasks(
      open.filter(t => t.due && diffD(parse(t.due), TODAY) >= a && diffD(parse(t.due), TODAY) <= b),
      { f: 'priority', dir: 1 },
    );
    return { lab, ts };
  };
  const dls = [dl(tr('Today'), 0, 0), dl(tr('Tomorrow'), 1, 1), dl(tr('This week'), 2, 7)];
  return `<div class="page">
    <div class="ph"><div><h1>${greet}, ${esc((S.prefs.name || me()?.name || '').split(' ')[0])}</h1><p><span class="num">${longDay(TODAY)}</span> · ${tr("Here's what's happening across your workspace.")}</p></div>
      <div class="acts">${canCreate() ? `<button class="btn btn-secondary hide-m" data-a="invite">${ic('user-plus', 14)}${tr('Invite member')}</button><button class="btn btn-secondary hide-m" data-a="newProject">${ic('folder-plus', 14)}${tr('New project')}</button>` : ''}<button class="btn btn-primary" data-a="newTask">${ic('plus', 14)}${tr('New task')}</button></div></div>
    <div class="stats" style="margin-bottom:16px">
      <button class="stat" data-a="go" data-r="projects"><span class="k">${ic('folder-kanban', 14)}${tr('Active projects')}</span><span class="v">${activeP.length}</span><span class="d">${tr('{n} at risk', { n: activeP.filter(p => p.status === 'risk').length })}</span></button>
      <button class="stat" data-a="goTasks" data-f="open"><span class="k">${ic('circle-dashed', 14)}${tr('Open tasks')}</span><span class="v">${open.length}</span><span class="d">${trn('{n} assigned to you', '{n} assigned to you|plural', open.filter(t => t.assignee === D().me).length)}</span></button>
      <button class="stat" data-a="goTasks" data-f="done"><span class="k">${ic('circle-check', 14)}${tr('Completed|tasks')}</span><span class="v">${doneWk.length}</span><span class="d up">${tr('this week')}</span></button>
      <button class="stat" data-a="goTasks" data-f="overdue"><span class="k">${ic('clock-alert', 14)}${tr('Overdue')}</span><span class="v" style="${over.length ? 'color:var(--red)' : ''}">${over.length}</span><span class="d ${over.length ? 'bad' : ''}">${over.length ? tr('need attention') : tr('all on track')}</span></button>
    </div>
    <div class="grid2">
      <div class="stack">
        <section class="panel" aria-labelledby="h-mytasks">
          <div class="panel-h"><h2 id="h-mytasks">${tr('My tasks')}</h2>
            <div class="acts"><div class="seg" role="tablist">${[
              ['upcoming', tr('Upcoming')],
              ['overdue', tr('Overdue')],
              ['completed', tr('Completed|tasks')],
            ]
              .map(
                ([k, n]) =>
                  `<button role="tab" class="${tab === k ? 'on' : ''}" data-a="set" data-k="homeTab" data-v="${k}">${n} <span class="faint">${lists[k].length}</span></button>`,
              )
              .join('')}</div>
            <button class="ibtn ibtn-sm" data-a="go" data-r="mytasks" data-tip="${tr('Open My Tasks')}" aria-label="${tr('Open My Tasks')}">${ic('arrow-up-right', 15)}</button></div></div>
          ${cur.length ? cur.map(t => miniRow(t, { av: false })).join('') : empty(tab === 'overdue' ? 'circle-check' : 'list-checks', tab === 'overdue' ? tr('Nothing overdue') : tr('No tasks here'), tab === 'overdue' ? tr('Every task assigned to you is on schedule.') : tr('Add a task to get things moving.'), '', 'sm')}
          ${lists[tab].length > 7 ? `<button class="addrow" style="padding-left:14px;border-top:1px solid var(--divider);border-bottom:0" data-a="go" data-r="mytasks">${tr('View all {n} tasks', { n: lists[tab].length })} ${ic('arrow-right', 13)}</button>` : ''}
        </section>
        <section class="panel">
          <div class="panel-h"><h2>${tr('Project progress')}</h2><div class="acts"><button class="btn btn-sm btn-ghost" data-a="go" data-r="projects">${tr('All projects')}</button></div></div>
          ${
            activeP.length
              ? ''
              : empty(
                  'folder-kanban',
                  tr('No active projects'),
                  canCreate() ? tr('Create a project to start tracking progress here.') : tr("Projects you're added to will show up here."),
                  canCreate() ? `<button class="btn btn-primary btn-sm" data-a="newProject">${ic('plus', 14)}${tr('New project')}</button>` : '',
                  'sm',
                  3,
                )
          }
          <div style="overflow-x:auto;${activeP.length ? '' : 'display:none'}"><table class="perm-t" style="min-width:560px"><thead><tr><th style="padding-left:14px">${tr('Project')}</th><th style="text-align:left">${tr('Status')}</th><th style="text-align:left;width:26%">${tr('Progress')}</th><th style="text-align:left">${tr('Due')}</th><th style="text-align:right;padding-right:14px">${tr('Team')}</th></tr></thead><tbody>
          ${activeP
            .filter(canSee)
            .map(p => {
              const pr = progressOf(p.id);
              return `<tr style="cursor:pointer" data-a="go" data-r="project" data-id="${p.id}" data-tab="overview"><td style="padding-left:14px"><span class="row">${pIcon(p, '', 14)}<b style="font-weight:500">${esc(p.name)}</b></span></td><td style="text-align:left">${pStatus(p.status)}</td><td><span class="row">${progBar(pr, p.status === 'risk' ? 'red' : '')}<span class="num faint" style="font-size:11.5px;width:30px">${pr}%</span></span></td><td style="text-align:left" class="num muted">${fmtDate(p.due)}</td><td style="text-align:right;padding-right:14px">${avStack(p.members, 3)}</td></tr>`;
            })
            .join('')}
          </tbody></table></div>
        </section>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="panel-h"><h2>${tr('Upcoming deadlines')}</h2><div class="acts"><button class="btn btn-sm btn-ghost" data-a="go" data-r="calendar">${ic('calendar', 13)}${tr('Calendar')}</button></div></div>
          <div class="panel-b" style="padding-bottom:6px">
          ${dls
            .map(
              g => `<div style="margin-bottom:10px"><div class="row" style="font-size:11.5px;font-weight:600;color:var(--text-2);margin-bottom:4px">${g.lab}<span class="faint" style="font-weight:500">${g.ts.length}</span></div>
            ${
              g.ts.length
                ? g.ts
                    .slice(0, 4)
                    .map(
                      t =>
                        `<div class="row" style="height:30px;cursor:pointer;gap:8px;font-size:13px" data-a="openTask" data-id="${t.id}"><span class="pdot" style="--c:${pColor(proj(t.project))}"></span><span class="trunc grow">${esc(t.title)}</span>${prIcon(t.priority, 13)}${av(t.assignee, 'sm')}</div>`,
                    )
                    .join('') +
                  (g.ts.length > 4 ? `<div class="faint" style="font-size:11.5px;padding-left:16px">${tr('+{n} more', { n: g.ts.length - 4 })}</div>` : '')
                : `<div class="faint" style="font-size:12.5px;padding:4px 0 2px">${tr('Nothing due')}</div>`
            }</div>`,
            )
            .join('')}
          </div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>${tr('Recent activity')}</h2><div class="acts"><button class="btn btn-sm btn-ghost" data-a="go" data-r="activity">${tr('View all')}</button></div></div>
          <div class="panel-b feed lined">${
            D()
              .activity.slice(0, 7)
              .map(a => actHtml(a, { proj: true }))
              .join('') || `<span class="faint" style="font-size:12.5px">${tr('No activity yet')}</span>`
          }</div>
        </section>
      </div>
    </div>
  </div>`;
}
