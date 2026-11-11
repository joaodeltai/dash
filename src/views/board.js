/* ---------- BOARD ---------- */
import { esc } from '../core/utils.js';
import { tr, trn } from '../core/i18n.js';
import { ic } from '../core/icons.js';
import { PR, STATUSES } from '../core/constants.js';
import { S, commentsOf, pColor, proj } from '../core/store.js';
import { av, dueHtml, lbl, prIcon, progBar, stIcon } from '../ui/helpers.js';
import { fxc } from '../shell/render.js';

export function kcard(t, opt = {}) {
  const cc = commentsOf(t.id).length;
  const ac = t.attachments.length;
  const sd = t.subtasks.filter(s => s.done).length;
  const p = proj(t.project);
  return `<div class="kcard ${t.status === 'done' ? 'done' : ''}${fxc('done', t.id)}${fxc('added', t.id)}${fxc('moved', t.id)}" draggable="true" data-drag-card="${t.id}" data-a="openTask" data-id="${t.id}" data-ctx="task" role="button" tabindex="0" aria-label="${esc(t.title)}">
    ${t.labels.length ? `<div class="labels">${t.labels.map(lbl).join('')}</div>` : ''}
    <div class="top">${t.status === 'done' ? `<span class="done-ic" style="margin:2px 7px 0 0;display:inline-flex" aria-label="${tr('Done')}">${stIcon('done', 14)}</span>` : ''}<div class="title">${esc(t.title)}</div></div>
    ${t.subtasks.length ? `<div class="subp">${ic('list-checks', 12)}<span class="num">${sd}/${t.subtasks.length}</span>${progBar(Math.round((sd / t.subtasks.length) * 100), sd === t.subtasks.length ? 'green' : '')}</div>` : ''}
    <div class="meta">
      ${opt.showProj ? `<span class="m" data-tip="${esc(p.name)}"><span class="pdot" style="--c:${pColor(p)}"></span></span>` : ''}
      <span class="key">${esc(t.key)}</span>
      <button class="m" data-a="pop" data-pop="priority" data-id="${t.id}" data-tip="${tr(PR[t.priority].name)}" aria-label="${tr('Priority: {name}', { name: tr(PR[t.priority].name) })}">${prIcon(t.priority, 13)}</button>
      ${t.due ? `<button class="m" data-a="pop" data-pop="date" data-field="due" data-id="${t.id}" aria-label="${tr('Due date')}">${dueHtml(t)}</button>` : ''}
      ${t.recur ? `<span class="m" data-tip="${tr('Repeats {freq}', { freq: tr(t.recur).toLowerCase() })}">${ic('repeat', 12)}</span>` : ''}
      ${cc ? `<span class="m" aria-label="${trn('{n} comment', '{n} comments', cc)}">${ic('message-square', 12)}${cc}</span>` : ''}
      ${ac ? `<span class="m" aria-label="${trn('{n} attachment', '{n} attachments', ac)}">${ic('paperclip', 12)}${ac}</span>` : ''}
      <button class="m" data-a="pop" data-pop="assignee" data-id="${t.id}" style="margin-left:auto" aria-label="${tr('Assignee')}">${av(t.assignee, 'sm')}</button>
    </div>
    <div class="hacts"><button class="ibtn ibtn-xs" data-a="toggleDone" data-id="${t.id}" data-tip="${t.status === 'done' ? tr('Reopen') : tr('Mark complete')}" aria-label="${t.status === 'done' ? tr('Reopen') : tr('Mark complete')}">${ic(t.status === 'done' ? 'rotate-ccw' : 'check', 13)}</button><button class="ibtn ibtn-xs" data-a="editTask" data-id="${t.id}" data-tip="${tr('Quick edit')}" aria-label="${tr('Quick edit')}">${ic('pencil', 12)}</button><button class="ibtn ibtn-xs" data-a="ctxBtn" data-ctx="task" data-id="${t.id}" aria-label="${tr('More')}">${ic('ellipsis', 13)}</button></div>
  </div>`;
}
export function boardHtml(ts, key, opt = {}) {
  return `<div class="board" data-keep="board:${key}">${STATUSES.map(s => {
    const col = ts.filter(t => t.status === s.id).sort((a, b) => a.order - b.order);
    const ck = key + ':' + s.id;
    if (S.ui.collapsedCols[ck])
      return `<div class="bcol collapsed" data-a="toggleCol" data-ck="${ck}" data-drop-col="${s.id}" data-key="${key}" role="button" aria-label="${tr('Expand {name}', { name: tr(s.name) })}" title="${tr('Expand')}">${stIcon(s.id)}<span class="vname">${tr(s.name)}<span class="faint">${col.length}</span></span></div>`;
    const comp = S.ui.composer && S.ui.composer.ctx === key && S.ui.composer.group === s.id;
    return `<section class="bcol" data-drop-col="${s.id}" data-key="${key}" aria-label="${tr(s.name)}">
      <div class="bcol-h">${stIcon(s.id)}<span>${tr(s.name)}</span><span class="cnt">${col.length}</span>
        <span class="acts"><button class="ibtn ibtn-xs" data-a="startComposer" data-ctx="${key}" data-group="${s.id}" data-gb='${JSON.stringify({ status: s.id, ...(opt.project ? { project: opt.project } : {}) })}' data-tip="${tr('Add task')}" aria-label="${tr('Add task to {name}', { name: tr(s.name) })}">${ic('plus', 14)}</button><button class="ibtn ibtn-xs" data-a="ctxBtn" data-ctx="column" data-id="${s.id}" data-key="${key}" aria-label="${tr('Column options')}">${ic('ellipsis', 14)}</button></span></div>
      <div class="bcol-b" data-col-body="${s.id}">
        ${col.map(t => kcard(t, { showProj: !opt.project })).join('')}
        ${
          comp
            ? `<div class="composer"><textarea id="composer-in" data-key-enter="commitComposer" placeholder="${tr('Task name')}" rows="2" aria-label="${tr('New task name')}"></textarea><div class="row"><span class="faint" style="font-size:11px">${tr('Enter to add · Esc to cancel')}</span><span class="sp"></span><button class="btn btn-sm btn-ghost" data-a="cancelComposer">${tr('Cancel')}</button><button class="btn btn-sm btn-primary" data-a="commitComposer">${tr('Add')}</button></div></div>`
            : `<button class="addcard" data-a="startComposer" data-ctx="${key}" data-group="${s.id}" data-gb='${JSON.stringify({ status: s.id, ...(opt.project ? { project: opt.project } : {}) })}'>${ic('plus', 14)}${tr('Add task')}</button>`
        }
      </div>
    </section>`;
  }).join('')}</div>`;
}
