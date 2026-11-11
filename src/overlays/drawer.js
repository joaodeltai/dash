/* =====================================================================
   OVERLAYS: drawer, modals, popovers, context menus, command palette
   ===================================================================== */
import { MOD, TODAY, ago, diffD, esc, fmtDate, parse, relDate, sanitizeHtml } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr, trn } from '../core/i18n.js';
import { actExtra, actVerb } from '../core/activity-text.js';
import { D, S, commentsOf, isOver, mem, pColor, proj, task } from '../core/store.js';
import { FORMER_MEMBER, FT, authorAv, authorName, av, filePrev, fileType, fmtComment, lbl, progBar } from '../ui/helpers.js';
import { fxc } from '../shell/render.js';
import { cellAssignee, cellDue, cellPrio, cellProject, cellStatus } from '../components/task-list.js';
import { modalHtml } from './modals.js';
import { popHtml } from './popovers.js';
import { paletteHtml } from './palette.js';
import { subtaskHtml } from '../features/subtasks.js';

export function renderLayer() {
  const u = S.ui;
  let h = '';
  if (u.drawer && task(u.drawer))
    h += (u.drawerFull ? `<div class="drawer-scrim full${u.fx.drawer ? ' enter' : ''}" data-a="closeDrawer"></div>` : '') + drawerHtml(task(u.drawer));
  u.modals.forEach((m, i) => {
    const en = u.fx.modal === i + 1;
    h += `<div class="scrim${en ? ' enter' : ''}" data-a="closeModal" style="z-index:${60 + i * 2}"></div><div class="modal-wrap" data-a="closeModalBg" style="z-index:${61 + i * 2}">${en ? modalHtml(m).replace('class="modal ', 'class="modal enter ') : modalHtml(m)}</div>`;
  });
  if (u.palette) h += `<div class="scrim" data-a="closePalette" style="z-index:89"></div>${paletteHtml()}`;
  if (u.pop) h += popHtml(u.pop);
  return h;
}

/* ---------------- TASK DRAWER ---------------- */
export function drawerHtml(t) {
  const p = proj(t.project);
  const u = S.ui;
  const cs = commentsOf(t.id);
  const sd = t.subtasks.filter(s => s.done).length;
  const acts = D().activity.filter(a => a.task === t.id);
  const tab = u.drawerTab;
  const prop = (icon, label, val) => `<dt>${ic(icon, 14)}${label}</dt><dd>${val}</dd>`;
  const ups = (u.uploads || []).filter(x => x.task === t.id);
  const ment =
    u.mention && u.mention.tid === t.id
      ? D()
          .members.filter(
            m => m.name.toLowerCase().startsWith(u.mention.q.toLowerCase()) || m.name.split(' ')[1]?.toLowerCase().startsWith(u.mention.q.toLowerCase()),
          )
          .slice(0, 5)
      : [];
  const sub = u.subOpen && u.subOpen.tid === t.id ? t.subtasks.find(s => s.id === u.subOpen.sid) : null;
  return `<aside class="drawer ${u.drawerFull ? 'full' : ''} ${u.fx.drawer ? 'enter' : ''} ${u.fx.tabs ? 'fx-tabs' : ''}" role="dialog" aria-modal="${u.drawerFull}" aria-labelledby="d-h" tabindex="-1">
    <h2 class="sr" id="d-h">${sub ? tr('Subtask: {title}', { title: esc(sub.title) }) : tr('Task: {title}', { title: esc(t.title) })}</h2>
    <div class="drawer-h">
      <button class="pillbtn" data-a="go" data-r="project" data-id="${p.id}" data-tab="board" style="font-size:12.5px"><span class="pdot" style="--c:${pColor(p)}"></span>${esc(p.name)}</button><span class="faint">/</span><span class="mono faint" style="font-size:11.5px;padding:0 6px">${esc(t.key)}</span>
      <span class="sp"></span>
      <button class="btn btn-sm ${t.status === 'done' ? 'btn-secondary' : 'btn-ghost'}" data-a="toggleDone" data-id="${t.id}" style="${t.status === 'done' ? 'color:var(--green)' : ''}">${ic(t.status === 'done' ? 'circle-check' : 'circle', 14)}<span class="hide-m">${t.status === 'done' ? tr('Completed|task') : tr('Mark complete')}</span></button>
      <button class="ibtn ibtn-sm" data-a="toggleFavTask" data-id="${t.id}" data-tip="${t.fav ? tr('Unfavorite') : tr('Favorite')}" aria-pressed="${t.fav}" aria-label="${tr('Favorite')}" style="${t.fav ? 'color:var(--amber)' : ''}">${ic('star', 15)}</button>
      <button class="ibtn ibtn-sm" data-a="copyLink" data-id="${t.id}" data-tip="${tr('Copy link')}" aria-label="${tr('Copy link')}">${ic('link', 15)}</button>
      <button class="ibtn ibtn-sm hide-m" data-a="toggleDrawerFull" data-tip="${u.drawerFull ? tr('Side panel') : tr('Full page')}" aria-label="${tr('Toggle full page')}">${ic(u.drawerFull ? 'minimize-2' : 'maximize-2', 15)}</button>
      <button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="task" data-id="${t.id}" aria-label="${tr('More')}">${ic('ellipsis', 15)}</button>
      <button class="ibtn ibtn-sm" data-a="closeDrawer" data-tip="${tr('Close  Esc')}" aria-label="${tr('Close')}">${ic('x', 16)}</button>
    </div>
    <div class="drawer-b" data-keep="drawer:${t.id}${sub ? ':' + sub.id : ''}">${
      sub
        ? subtaskHtml(t, sub)
        : `
      ${t.status === 'done' ? `<div class="alert ok" style="margin-bottom:12px">${ic('circle-check', 15)}<span>${tr('Completed {when}.', { when: t.completedAt ? ago(t.completedAt) : '' })} <button class="link" data-a="toggleDone" data-id="${t.id}">${tr('Reopen task')}</button></span></div>` : isOver(t) ? `<div class="alert danger" style="margin-bottom:12px">${ic('clock-alert', 15)}<span>${trn('Overdue by {n} day.', 'Overdue by {n} days.', -diffD(parse(t.due), TODAY))} <button class="link" data-a="pop" data-pop="date" data-field="due" data-id="${t.id}">${tr('Reschedule')}</button></span></div>` : ''}
      <textarea class="ttl-edit" id="d-title" rows="1" data-autosize data-blur="commitDrawerTitle" data-key-enter="blur" data-id="${t.id}" aria-label="${tr('Task title')}">${esc(t.title)}</textarea>
      <dl class="kv" style="margin-top:12px;${u.drawerFull ? 'grid-template-columns:112px minmax(0,1fr) 112px minmax(0,1fr)' : ''}">
        ${prop('circle-dot', tr('Status'), cellStatus(t))}
        ${prop('signal-high', tr('Priority'), cellPrio(t))}
        ${prop('user', tr('Assignee'), cellAssignee(t))}
        ${prop('calendar', tr('Due date'), cellDue(t))}
        ${prop('calendar-arrow-up', tr('Start date'), `<button class="pillbtn ${t.start ? '' : 'empty'}" data-a="pop" data-pop="date" data-field="start" data-id="${t.id}">${ic('calendar', 13)}${t.start ? fmtDate(t.start) : tr('Set date')}</button>`)}
        ${prop('folder', tr('Project'), cellProject(t))}
        ${prop('tag', tr('Labels'), `<button class="pillbtn ${t.labels.length ? '' : 'empty'}" data-a="pop" data-pop="labels" data-id="${t.id}" style="flex-wrap:wrap;height:auto;min-height:26px;padding:3px 7px">${t.labels.length ? t.labels.map(lbl).join('') : ic('tag', 13) + tr('Add labels')}</button>`)}
        ${prop('repeat', tr('Repeat'), `<button class="pillbtn ${t.recur ? '' : 'empty'}" data-a="pop" data-pop="recur" data-id="${t.id}">${ic('repeat', 13)}${t.recur ? tr(t.recur) : tr('Does not repeat')}</button>`)}
        ${prop('timer', tr('Estimate'), `<button class="pillbtn ${t.estimate ? '' : 'empty'}" data-a="pop" data-pop="estimate" data-id="${t.id}">${ic('timer', 13)}${t.estimate ? esc(t.estimate) : tr('Add estimate')}</button>`)}
        ${prop('git-branch', tr('Blocked by'), `<button class="pillbtn ${t.deps.length ? '' : 'empty'}" data-a="pop" data-pop="deps" data-id="${t.id}" style="height:auto;min-height:26px;flex-wrap:wrap">${t.deps.length ? t.deps.map(d => (task(d) ? `<span class="depchip mono" style="font-size:11px;padding:1px 5px;border-radius:4px;background:var(--surface-3)">${esc(task(d).key)}</span><span class="trunc" style="max-width:160px">${esc(task(d).title)}</span>` : '')).join('') : ic('git-branch', 13) + tr('None')}</button>`)}
      </dl>

      <div class="dsec"><div class="dsec-h"><h3 id="d-desc-l">${tr('Description')}</h3><div class="rte-tb" role="toolbar" aria-label="${tr('Formatting')}" aria-controls="d-desc">
          ${[
            ['bold', 'bold', tr('Bold')],
            ['italic', 'italic', tr('Italic')],
            ['insertUnorderedList', 'list', tr('Bulleted list')],
            ['insertOrderedList', 'list-ordered', tr('Numbered list')],
            ['formatBlock:h3', 'heading', tr('Heading')],
            ['createLink', 'link', tr('Link')],
          ]
            .map(([c, i, n]) => `<button class="ibtn ibtn-xs" data-cmd="${c}" data-tip="${n}" aria-label="${n}">${ic(i, 13)}</button>`)
            .join('')}
        </div></div>
        <div class="rte"><div class="rte-body" id="d-desc" contenteditable="true" data-rte="${t.id}" data-ph="${tr('Add a description…')}" role="textbox" aria-multiline="true" aria-labelledby="d-desc-l">${sanitizeHtml(t.desc)}</div></div>
      </div>

      <div class="dsec"><div class="dsec-h"><h3>${tr('Subtasks')}</h3><span class="cnt num">${sd}/${t.subtasks.length}</span>${t.subtasks.length ? `<span style="width:90px;display:flex">${progBar(Math.round((sd / t.subtasks.length) * 100), sd === t.subtasks.length ? 'green' : '')}</span>` : ''}</div>
        ${t.subtasks.map(s => `<div class="subt ${s.done ? 'done' : ''}${fxc('added', s.id)}${fxc('done', s.id)}"><input type="checkbox" class="check" ${s.done ? 'checked' : ''} data-a="toggleSub" data-id="${t.id}" data-sid="${s.id}" aria-label="${s.done ? tr('Reopen subtask {title}', { title: esc(s.title) }) : tr('Complete subtask {title}', { title: esc(s.title) })}"><button class="s" data-a="openSub" data-id="${t.id}" data-sid="${s.id}">${esc(s.title)}</button>${s.due ? `<span class="due ${!s.done && diffD(parse(s.due), TODAY) < 0 ? 'over' : ''}">${ic('calendar', 12)}${relDate(s.due)}</span>` : ''}${s.assignee ? av(s.assignee, 'sm') : ''}<button class="ibtn ibtn-xs x" data-a="openSub" data-id="${t.id}" data-sid="${s.id}" aria-label="${tr('Open subtask details')}" tabindex="-1">${ic('chevron-right', 14)}</button></div>`).join('')}
        <div class="subt" style="color:var(--text-3)">${ic('plus', 15)}<input class="inline-in" id="d-sub" data-key-enter="addSub" data-id="${t.id}" placeholder="${tr('Add subtask')}" aria-label="${tr('Add subtask')}" style="font-size:13.5px"></div>
      </div>

      <div class="dsec"><div class="dsec-h"><h3>${tr('Attachments')}</h3><span class="cnt">${t.attachments.length}</span><div class="acts"><label class="btn btn-sm btn-ghost" style="cursor:pointer">${ic('upload', 13)}${tr('Upload')}<input type="file" multiple hidden data-in="uploadFiles" data-task="${t.id}" data-project="${t.project}"></label></div></div>
        ${ups.map(x => `<div class="upl" style="margin-bottom:6px"><span class="ftype" style="--c:${FT[fileType(x.name)].c}">${ic(FT[fileType(x.name)].i, 14)}</span><div class="grow"><div class="row"><span class="trunc">${esc(x.name)}</span><span class="sp"></span><span class="faint num" id="upct-${x.id}" style="font-size:11px">${x.pct}%</span></div><div class="prog" style="margin-top:5px"><i id="upbar-${x.id}" style="width:${x.pct}%"></i></div></div></div>`).join('')}
        ${t.attachments.length ? `<div class="att">${t.attachments.map(f => `<div class="attc" data-a="filePreview" data-tid="${t.id}" data-aid="${f.id}" role="button" tabindex="0">${filePrev(f)}<div class="fi"><div class="trunc" style="font-weight:500">${esc(f.name)}</div><div class="faint">${tr(FT[f.type]?.n || 'File')} · ${f.size}</div></div><button class="ibtn ibtn-xs x" data-a="rmAttach" data-id="${t.id}" data-aid="${f.id}" aria-label="${tr('Remove attachment')}">${ic('x', 12)}</button></div>`).join('')}</div>` : !ups.length ? `<label class="dropzone" style="padding:12px" data-dropzone-task="${t.id}">${ic('paperclip', 15)}<span>${tr('Drop files or click to attach')}</span><input type="file" multiple hidden data-in="uploadFiles" data-task="${t.id}" data-project="${t.project}"></label>` : ''}
      </div>

      <div class="dsec">
        <div class="tabs" style="margin-bottom:6px">${[
          ['comments', tr('Comments'), cs.length],
          ['activity', tr('Activity'), acts.length],
        ]
          .map(
            ([k, n, c]) =>
              `<button class="tab ${tab === k ? 'on' : ''}" data-a="set" data-k="drawerTab" data-v="${k}">${n}<span class="cnt">${c}</span></button>`,
          )
          .join('')}</div>
        ${
          tab === 'comments'
            ? `
          ${cs.length ? cs.map(commentHtml).join('') : `<p class="faint" style="font-size:13px;margin:10px 0">${tr('No comments yet. Start the conversation.')}</p>`}
          <div class="row" style="align-items:flex-start;gap:10px;margin-top:8px">${av(D().me, 'md', false)}<div class="grow" style="position:relative">
            <div class="cbox"><textarea id="d-cmt" data-in="draft" data-id="${t.id}" data-key-mod-enter="postComment" placeholder="${tr('Leave a comment… type @ to mention')}" aria-label="${tr('Comment')}" rows="2" data-autosize>${esc(u.drafts[t.id] || '')}</textarea>
            <div class="row"><button class="ibtn ibtn-xs" data-a="insertAt" data-id="${t.id}" data-tip="${tr('Mention someone')}" aria-label="${tr('Mention')}">${ic('at-sign', 14)}</button><label class="ibtn ibtn-xs" data-tip="${tr('Attach file')}" style="cursor:pointer">${ic('paperclip', 14)}<input type="file" multiple hidden data-in="uploadFiles" data-task="${t.id}" data-project="${t.project}"></label><span class="sp"></span><span class="faint hide-m" style="font-size:11px">${MOD}+Enter</span><button class="btn btn-primary btn-sm" data-a="postComment" data-id="${t.id}">${tr('Comment')}</button></div></div>
            ${ment.length ? `<div class="pop" style="position:absolute;top:auto;bottom:calc(100% + 4px);left:0">${ment.map(m => `<button class="mi" data-a="pickMention" data-id="${t.id}" data-name="${esc(m.name)}">${av(m.id, 'sm', false)}${esc(m.name)}<span class="r">${esc(m.title)}</span></button>`).join('')}</div>` : ''}
          </div></div>`
            : `
          <div style="padding-top:4px">${acts.map(a => `<div class="act-line"><span class="ico">${authorAv(a.by, 'sm', false)}</span><span class="grow"><b>${esc(a.by && a.by === D().me ? tr('You') : authorName(a.by))}</b> ${esc(drawerVerb(a))}${a.extra ? ' ' + esc(actExtra(a)) : ''}</span><time class="faint" style="font-size:11.5px">${ago(a.at)}</time></div>`).join('')}
          <div class="act-line"><span class="ico">${ic('plus', 13)}</span><span class="grow">${tr('Task created')}</span><time class="faint" style="font-size:11.5px">${ago(t.created)}</time></div></div>`
        }
      </div>`
    }
    </div>
  </aside>`;
}
/* The drawer already shows which task it is, so a verb that ends in "of" / "de" ("changed due date of") drops it. */
const drawerVerb = a => {
  const v = actVerb(a);
  return a.verb.endsWith(' of') ? v.replace(/ (of|de|do|da)$/, '') : v;
};
export function commentHtml(c) {
  const mine = c.by === D().me;
  return `<div class="cmt">${authorAv(c.by, 'md', false)}<div class="body"><div class="who"><b>${esc(authorName(c.by))}</b><time>${ago(c.at)}</time>${mine ? `<span class="sp"></span><button class="ibtn ibtn-xs" data-a="delComment" data-id="${c.id}" aria-label="${tr('Delete comment')}" data-tip="${tr('Delete')}">${ic('trash-2', 12)}</button>` : ''}</div><div class="txt">${fmtComment(c.text)}</div>
    <div class="reacts">${Object.entries(c.re || {})
      .filter(([, v]) => v.length)
      .map(
        ([e, v]) =>
          `<button class="react ${v.includes(D().me) ? 'mine' : ''}" data-a="react" data-id="${c.id}" data-e="${esc(e)}" aria-label="${esc(e)} ${v.length}" title="${esc(v.map(i => mem(i)?.name || tr(FORMER_MEMBER)).join(', '))}">${esc(e)}<span class="num">${v.length}</span></button>`,
      )
      .join(
        '',
      )}<button class="react" data-a="pop" data-pop="emoji" data-id="${c.id}" aria-label="${tr('Add reaction')}" style="color:var(--text-3)">${ic('smile-plus', 13)}</button></div></div></div>`;
}
