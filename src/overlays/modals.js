/* ---------------- MODALS ---------------- */
import { $$, MOD, ago, esc, fmtDate } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { PCOLORS, PICONS } from '../core/constants.js';
import { D, S, canCreate, canSee, isAdmin, mem, pColor, proj, task, teamsList, visibleProjects } from '../core/store.js';
import { FT, authorName, av, lbl, prPill, stPill } from '../ui/helpers.js';
import { MAX_MB, imageState } from '../ui/file-urls.js';
import { focusKey, render } from '../shell/render.js';
import { teamModal } from '../features/teams.js';

export function openModal(m) {
  S.ui.modalOpeners = S.ui.modalOpeners || [];
  S.ui.modalOpeners[S.ui.modals.length] = S.ui.popOpener && S.ui.pop ? S.ui.popOpener : focusKey(document.activeElement);
  S.ui.modals.push(m);
  S.ui.pop = null;
  render();
  setTimeout(() => {
    const all = $$('.modal');
    const last = all[all.length - 1];
    const af = last?.querySelector('[autofocus]');
    (af || last?.querySelector('input,textarea,button'))?.focus();
  }, 30);
}
export function closeModal() {
  S.ui.modals.pop();
  S.ui.pop = null;
  render();
}
export function modalHtml(m) {
  const H = (title, sub = '') =>
    `<div class="modal-h"><div><h2 id="mt-${m.type}">${title}</h2>${sub ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${sub}</div>` : ''}</div><button class="ibtn ibtn-sm" data-a="closeModal" aria-label="Close">${ic('x', 16)}</button></div>`;
  const wrap = (cls, inner) => `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="mt-${m.type}">${inner}</div>`;
  switch (m.type) {
    case 'task':
      return wrap('', taskModal(m, H));
    case 'project':
      return wrap('', projectModal(m, H));
    case 'share':
      return wrap('', shareModal(m, H));
    case 'invite':
      return wrap('', inviteModal(m, H));
    case 'confirm':
      return wrap('sm', confirmModal(m, H));
    case 'prompt':
      return wrap(
        'sm',
        `${H(m.title)}<form class="modal-b" data-submit="promptSubmit"><div class="field"><label class="label" for="prompt-in">${esc(m.label)}</label><input class="input" id="prompt-in" value="${esc(m.value || '')}" autofocus></div></form><div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="promptSubmit">${esc(m.ok || 'Save')}</button></div>`,
      );
    case 'shortcuts':
      return wrap('lg', shortcutsModal(H));
    case 'team':
      return wrap('', teamModal(m, H));
    case 'event':
      return wrap('sm', eventModal(m, H));
    case 'filePreview':
      return wrap('lg', filePreviewModal(m, H));
    case 'saveView':
      return wrap(
        'sm',
        `${H('Save view', 'Save the current filters as a tab on this project.')}<form class="modal-b" data-submit="saveViewSubmit"><div class="field"><label class="label" for="sv-name">View name</label><input class="input" id="sv-name" placeholder="e.g. Design review queue" autofocus></div><div class="field"><label class="label" for="sv-type">Layout</label><select class="select" id="sv-type"><option value="list">List</option><option value="board">Board</option><option value="table">Table</option></select></div>${m.nf ? `<div class="hint">${m.nf} filter${m.nf > 1 ? 's' : ''} will be saved with this view.</div>` : '<div class="alert info">' + ic('info', 14) + '<span>No filters are active — the view will show all tasks. You can add filters after saving.</span></div>'}</form><div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="saveViewSubmit">Save view</button></div>`,
      );
  }
  return '';
}
export function formChip(pop, html, label) {
  return `<button class="pillbtn bordered" data-a="pop" data-pop="${pop}" data-id="__form" ${pop === 'date' ? `data-field="${label}"` : ''} aria-label="${esc(label)}">${html}</button>`;
}
export function taskModal(m, H) {
  const f = S.ui.form;
  const p = proj(f.project);
  const err = S.ui.errors.title;
  return `${H(m.edit ? 'Edit task' : 'New task', m.edit ? `<span class="mono">${task(m.edit)?.key}</span>` : '')}
  <form class="modal-b" data-submit="submitTask" style="gap:12px">
    <div class="field"><label class="sr" for="f-title">Task name</label><input class="input input-lg ${err ? 'is-error' : ''}" id="f-title" data-in="form" data-f="title" value="${esc(f.title)}" placeholder="Task name" autofocus aria-invalid="${!!err}" aria-describedby="f-title-err" style="font-size:15px;font-weight:500">${err ? `<span class="err" id="f-title-err">${ic('circle-alert', 12)}${err}</span>` : ''}</div>
    <div class="field"><label class="sr" for="f-desc">Description</label><textarea class="textarea" id="f-desc" data-in="form" data-f="desc" placeholder="Add a description… (optional)" rows="3">${esc(f.desc)}</textarea></div>
    <div class="row" style="flex-wrap:wrap;gap:6px">
      ${formChip('project', `<span class="pdot" style="--c:${pColor(p)}"></span>${esc(p?.name || 'Project')}`, 'Project')}
      ${formChip('status', stPill(f.status), 'Status')}
      ${formChip('assignee', `${av(f.assignee, 'sm', false)}${esc(mem(f.assignee)?.name || 'Assignee')}`, 'Assignee')}
      ${formChip('priority', prPill(f.priority), 'Priority')}
      ${formChip('date', `${ic('calendar', 13)}${f.due ? 'Due ' + fmtDate(f.due) : 'Due date'}`, 'due')}
      ${formChip('date', `${ic('calendar-arrow-up', 13)}${f.start ? 'Starts ' + fmtDate(f.start) : 'Start date'}`, 'start')}
      ${formChip('labels', f.labels.length ? f.labels.map(lbl).join('') : `${ic('tag', 13)}Labels`, 'Labels')}
      ${formChip('recur', `${ic('repeat', 13)}${f.recur || 'Repeat'}`, 'Repeat')}
    </div>
    <div class="field"><span class="label">Subtasks</span>
      ${f.subtasks.map((s, i) => `<div class="subt" style="padding:0 4px">${ic('circle', 13)}<span class="s">${esc(s.title)}</span><button type="button" class="ibtn ibtn-xs x" style="opacity:1" data-a="formRmSub" data-i="${i}" aria-label="Remove">${ic('x', 12)}</button></div>`).join('')}
      <div class="inwrap">${ic('plus', 14)}<input class="input" id="f-sub" data-key-enter="formAddSub" placeholder="Add a subtask and press Enter"></div></div>
    <div class="field"><span class="label">Attachments</span>
      ${
        (f.existing || []).length || f.files.length
          ? `<div class="col" style="gap:4px">${[
              ...(f.existing || []).map(
                x =>
                  `<div class="upl" style="padding:6px 10px"><span class="ftype" style="--c:${(FT[x.type] || FT.other).c};width:22px;height:22px">${ic((FT[x.type] || FT.other).i, 12)}</span><span class="grow trunc">${esc(x.name)}</span><span class="faint" style="font-size:11.5px">${esc(x.size)}</span><button type="button" class="ibtn ibtn-xs" data-a="formRmExisting" data-id="${x.id}" aria-label="Remove ${esc(x.name)}">${ic('x', 12)}</button></div>`,
              ),
              ...f.files.map(
                (x, i) =>
                  `<div class="upl" style="padding:6px 10px"><span class="ftype" style="--c:${(FT[x.type] || FT.other).c};width:22px;height:22px">${ic((FT[x.type] || FT.other).i, 12)}</span><span class="grow trunc">${esc(x.name)}</span><span class="faint" style="font-size:11.5px">${x.size} · uploads when you save</span><button type="button" class="ibtn ibtn-xs" data-a="formRmFile" data-i="${i}" aria-label="Remove ${esc(x.name)}">${ic('x', 12)}</button></div>`,
              ),
            ].join('')}</div>`
          : ''
      }
      <label class="dropzone" data-dropzone-form style="padding:10px">${ic('paperclip', 14)}<span>Attach files <span class="faint">— up to ${MAX_MB} MB each</span></span><input type="file" multiple hidden data-in="formFiles"></label></div>
  </form>
  <div class="modal-f">${m.edit ? '' : `<label class="row" style="gap:8px;font-size:12.5px;color:var(--text-2);cursor:pointer"><input type="checkbox" class="toggle" id="f-more" data-in="formMore" ${f.more ? 'checked' : ''}>Create more</label>`}<span class="sp"></span>
    <span class="faint hide-m" style="font-size:11.5px"><kbd>${MOD}</kbd> <kbd>↵</kbd></span>
    <button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitTask" id="f-submit">${m.edit ? 'Save changes' : 'Create task'}</button></div>`;
}
export const TEMPLATES = [
  { id: 'blank', name: 'Blank project', icon: 'file', desc: 'Start from scratch', tasks: [] },
  {
    id: 'product',
    name: 'Product Development',
    icon: 'target',
    desc: 'Discovery to launch',
    tasks: ['Define problem statement', 'User research plan', 'Write PRD', 'Design exploration', 'Build MVP', 'Beta launch'],
  },
  {
    id: 'web',
    name: 'Website',
    icon: 'globe',
    desc: 'IA, design, build, launch',
    tasks: ['Sitemap & information architecture', 'Wireframes', 'Visual design', 'Build page templates', 'Content migration', 'QA & launch'],
  },
  {
    id: 'mkt',
    name: 'Marketing Campaign',
    icon: 'megaphone',
    desc: 'Brief, assets, channels',
    tasks: ['Campaign brief', 'Audience research', 'Creative assets', 'Channel plan', 'Launch campaign', 'Performance report'],
  },
  {
    id: 'design',
    name: 'Design Project',
    icon: 'palette',
    desc: 'Discovery to handoff',
    tasks: ['Discovery workshop', 'Moodboard', 'Concept directions', 'Refinement', 'Developer handoff'],
  },
  {
    id: 'software',
    name: 'Software Development',
    icon: 'code',
    desc: 'Spec, build, ship',
    tasks: ['Technical spec', 'Set up repo & CI', 'Implement core API', 'Write tests', 'Code review', 'Deploy to staging'],
  },
  {
    id: 'personal',
    name: 'Personal Project',
    icon: 'heart',
    desc: 'Plan your own goals',
    tasks: ['Brain dump ideas', 'Pick top 3 priorities', 'Schedule focus time', 'Weekly review'],
  },
];
export function projectModal(m, H) {
  const f = S.ui.pform;
  const err = S.ui.errors.pname;
  return `${H(m.edit ? 'Project settings' : 'New project', m.edit ? '' : 'Projects hold tasks, files, and conversations for one body of work.')}
  <form class="modal-b" data-submit="submitProject">
    <div class="row" style="gap:10px;align-items:flex-start">
      <button type="button" class="picon lg" style="--c:${PCOLORS[f.color]};cursor:default;flex-shrink:0;margin-top:22px" aria-hidden="true" tabindex="-1">${ic(f.icon, 18)}</button>
      <div class="field grow"><label class="label" for="p-name">Project name</label><input class="input ${err ? 'is-error' : ''}" id="p-name" data-in="pform" data-f="name" value="${esc(f.name)}" placeholder="e.g. Website Redesign" autofocus aria-invalid="${!!err}">${err ? `<span class="err">${ic('circle-alert', 12)}${err}</span>` : ''}</div>
    </div>
    <div class="field"><label class="label" for="p-desc">Description</label><textarea class="textarea" id="p-desc" data-in="pform" data-f="desc" rows="2" placeholder="What is this project about?">${esc(f.desc)}</textarea></div>
    <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:220px"><span class="label">Icon</span><div class="iconpick" role="radiogroup" aria-label="Icon">${PICONS.map(i => `<button type="button" role="radio" aria-checked="${f.icon === i}" class="${f.icon === i ? 'on' : ''}" data-a="pformSet" data-f="icon" data-v="${i}" aria-label="${i}">${ic(i, 15)}</button>`).join('')}</div></div>
      <div class="field"><span class="label">Color</span><div class="swatches" role="radiogroup" aria-label="Color" style="max-width:140px">${Object.entries(
        PCOLORS,
      )
        .map(
          ([k, v]) =>
            `<button type="button" role="radio" aria-checked="${f.color === k}" class="sw ${f.color === k ? 'on' : ''}" style="--c:${v};width:22px;height:22px" data-a="pformSet" data-f="color" data-v="${k}" aria-label="${k}">${f.color === k ? ic('check', 12) : ''}</button>`,
        )
        .join('')}</div></div>
    </div>
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-team">Team</label><select class="select" id="p-team" data-in="pform" data-f="team"><option value="" ${f.team ? '' : 'selected'}>No team</option>${teamsList()
        .map(t => `<option value="${t.id}" ${f.team === t.id ? 'selected' : ''}>${esc(t.name)}</option>`)
        .join('')}</select></div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-lead">Lead</label><select class="select" id="p-lead" data-in="pform" data-f="lead">${D()
        .members.filter(x => x.status === 'active')
        .map(x => `<option value="${x.id}" ${f.lead === x.id ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</select></div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-due">Target date</label><input type="date" class="input" id="p-due" data-in="pform" data-f="due" value="${f.due || ''}"></div>
    </div>
    ${milestonesField(f)}
    ${m.edit ? '' : `<div class="field"><span class="label">Template</span><div class="tmpls" role="radiogroup">${TEMPLATES.map(t => `<button type="button" role="radio" aria-checked="${f.tmpl === t.id}" class="opt ${f.tmpl === t.id ? 'on' : ''}" data-a="pformSet" data-f="tmpl" data-v="${t.id}" style="padding:10px">${ic(t.icon, 16)}<b style="font-size:12.5px">${t.name}</b><span>${t.tasks.length ? t.tasks.length + ' starter tasks' : t.desc}</span></button>`).join('')}</div></div>`}
  </form>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitProject">${m.edit ? 'Save changes' : 'Create project'}</button></div>`;
}
/* Milestones: one row per milestone (name + date). Rows stay in the order typed; they are sorted by date on save. */
export function milestonesField(f) {
  const ms = f.ms || [];
  const errs = S.ui.errors.pms || {};
  return `<fieldset class="field" style="border:0;padding:0;margin:0;min-width:0"><legend class="label" style="margin-bottom:6px">Milestones <span class="faint" style="font-weight:400">· ${ms.length}</span></legend>
    ${ms
      .map((x, i) => {
        const e = errs[i];
        return `<div class="field" style="margin-bottom:6px"><div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
          <div class="grow" style="min-width:150px"><label class="sr" for="p-ms-n-${i}">Milestone ${i + 1} name</label><input class="input ${e ? 'is-error' : ''}" id="p-ms-n-${i}" data-in="pms" data-f="name" data-i="${i}" data-key-enter="pmsEnter" maxlength="200" value="${esc(x.name)}" placeholder="e.g. Beta launch" aria-invalid="${!!e}" ${e ? `aria-describedby="p-ms-e-${i}"` : ''}></div>
          <div><label class="sr" for="p-ms-d-${i}">Milestone ${i + 1} date</label><input type="date" class="input ${e ? 'is-error' : ''}" id="p-ms-d-${i}" data-in="pms" data-f="date" data-i="${i}" value="${esc(x.date || '')}" aria-invalid="${!!e}"></div>
          <button type="button" class="ibtn ibtn-sm" data-a="pmsRm" data-i="${i}" aria-label="Remove milestone ${i + 1}">${ic('x', 14)}</button>
        </div>${e ? `<span class="err" id="p-ms-e-${i}" role="alert">${ic('circle-alert', 12)}${e}</span>` : ''}</div>`;
      })
      .join('')}
    ${ms.length ? '' : '<span class="hint" style="margin-bottom:6px">No milestones yet. Add key dates to see them on the timeline and in the project overview.</span>'}
    <div><button type="button" class="btn btn-secondary btn-sm" data-a="pmsAdd">${ic('plus', 14)}Add milestone</button></div></fieldset>`;
}
/* Event form (create and edit). The submit button sits in the footer, tied to the form by id, so Enter submits. */
export function eventModal(m, H) {
  const f = S.ui.evform;
  const er = S.ui.errors;
  const projs = visibleProjects().filter(canSee);
  const cur = proj(f.project);
  if (cur && !projs.includes(cur)) projs.push(cur);
  const msg = (id, t) => (t ? `<span class="err" id="${id}" role="alert">${ic('circle-alert', 12)}${t}</span>` : '');
  return `${H(m.edit ? 'Edit event' : 'New event')}
  <form class="modal-b" id="ev-form" data-submit="submitEvent" novalidate>
    <div class="field"><label class="label" for="ev-title">Title</label><input class="input ${er.etitle ? 'is-error' : ''}" id="ev-title" data-in="evform" data-f="title" data-key-mod-enter="evSubmit" maxlength="200" value="${esc(f.title)}" placeholder="e.g. Design review" autocomplete="off" autofocus aria-invalid="${!!er.etitle}" ${er.etitle ? 'aria-describedby="ev-title-err"' : ''}>${msg('ev-title-err', er.etitle)}</div>
    <div class="row" style="gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="ev-date">Date</label><input type="date" class="input ${er.edate ? 'is-error' : ''}" id="ev-date" data-in="evform" data-f="date" data-key-mod-enter="evSubmit" value="${esc(f.date)}" aria-invalid="${!!er.edate}" ${er.edate ? 'aria-describedby="ev-date-err"' : ''}>${msg('ev-date-err', er.edate)}</div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="ev-time">Time <span class="faint" style="font-weight:400">(optional)</span></label><input type="time" class="input ${er.etime ? 'is-error' : ''}" id="ev-time" data-in="evform" data-f="time" data-key-mod-enter="evSubmit" value="${esc(f.time)}" aria-invalid="${!!er.etime}" ${er.etime ? 'aria-describedby="ev-time-err"' : ''}>${msg('ev-time-err', er.etime)}</div>
    </div>
    <div class="field"><label class="label" for="ev-project">Project <span class="faint" style="font-weight:400">(optional)</span></label><select class="select" id="ev-project" data-in="evform" data-f="project"><option value="">No project</option>${projs
      .map(p => `<option value="${p.id}" ${f.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('')}</select><span class="hint">Events without a project are visible to everyone in the workspace.</span></div>
  </form>
  <div class="modal-f">${m.edit ? `<button type="button" class="btn btn-danger-ghost" data-a="delEvent" data-id="${m.edit}">${ic('trash-2', 14)}Delete</button>` : ''}<span class="sp"></span>
    <span class="faint hide-m" style="font-size:11.5px"><kbd>${MOD}</kbd> <kbd>↵</kbd></span>
    <button type="button" class="btn btn-secondary" data-a="closeModal">Cancel</button><button type="submit" form="ev-form" class="btn btn-primary" id="ev-submit">${m.edit ? 'Save changes' : 'Add event'}</button></div>`;
}
export const PERMS = ['Can view', 'Can comment', 'Can edit', 'Full access'];
export function shareModal(m, H) {
  const p = proj(m.id);
  p.perms = p.perms || {};
  p.access = p.access || 'workspace';
  return `${H(`Share “${esc(p.name)}”`)}
  <div class="modal-b">
    <form class="row" style="gap:6px" data-submit="shareInvite"><div class="grow"><label class="sr" for="share-in">Invite by email</label><input class="input" id="share-in" placeholder="${canCreate() ? 'Add people by name or email' : 'Add workspace members by name'}" value="${esc(S.ui.shareQ || '')}" data-in="shareQ" autofocus></div>
      <select class="select" id="share-perm" style="width:132px" aria-label="Permission">${PERMS.map(x => `<option ${x === 'Can edit' ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button class="btn btn-primary" data-a="shareInvite" type="button">Invite</button></form>
    ${
      S.ui.shareQ
        ? `<div class="panel" style="padding:4px">${
            D()
              .members.filter(
                x => !p.members.includes(x.id) && (x.name.toLowerCase().includes(S.ui.shareQ.toLowerCase()) || x.email.includes(S.ui.shareQ.toLowerCase())),
              )
              .map(
                x =>
                  `<button class="mi" data-a="shareAdd" data-id="${p.id}" data-mid="${x.id}">${av(x.id, 'sm', false)}${esc(x.name)}<span class="r">${esc(x.email)}</span></button>`,
              )
              .join('') ||
            `<div class="mi faint" style="cursor:default">${!canCreate() ? 'No matching members in this workspace' : S.ui.shareQ.includes('@') ? `Press Invite to add ${esc(S.ui.shareQ)} as a guest. No email is sent: they get access when they sign up with this address.` : 'No matching members — enter an email to invite someone new'}</div>`
          }</div>`
        : ''
    }
    <div><div class="eyebrow" style="margin-bottom:4px">People with access</div>
      ${p.members
        .map(id => {
          const x = mem(id);
          if (!x) return '';
          const perm = id === p.lead ? 'Full access' : p.perms[id] || (x.role === 'Guest' ? 'Can comment' : 'Can edit');
          return `<div class="row" style="height:44px">${av(id, 'md', false)}<div class="grow"><div style="font-weight:500;font-size:13px">${esc(x.name)}${id === D().me ? ' <span class="faint" style="font-weight:400">(you)</span>' : ''}</div><div class="faint" style="font-size:11.5px">${esc(x.email)}${id === p.lead ? ' · Project lead' : ''}</div></div>
          ${id === p.lead ? `<span class="muted" style="font-size:12.5px;padding-right:8px">Full access</span>` : `<select class="select" style="width:auto;height:26px;font-size:12px;border-color:transparent;background-color:transparent" data-in="sharePerm" data-id="${p.id}" data-mid="${id}" aria-label="Permission for ${esc(x.name)}">${PERMS.map(q => `<option ${q === perm ? 'selected' : ''}>${q}</option>`).join('')}<option value="__remove">Remove access</option></select>`}</div>`;
        })
        .join('')}
    </div>
    <div style="border-top:1px solid var(--divider);padding-top:12px"><div class="eyebrow" style="margin-bottom:8px">General access</div>
      <div class="row" style="gap:10px"><span class="ftype" style="--c:var(--text-2)">${ic(p.access === 'private' ? 'lock' : 'building-2', 14)}</span><div class="grow"><select class="select" style="height:28px;width:auto;border-color:transparent;padding-left:4px;font-weight:500" data-in="shareAccess" data-id="${p.id}" aria-label="General access"><option value="private" ${p.access === 'private' ? 'selected' : ''}>Only people invited</option><option value="workspace" ${p.access === 'workspace' ? 'selected' : ''}>Everyone at ${esc(D().ws.name)}</option></select><div class="faint" style="font-size:11.5px;padding-left:4px">${p.access === 'private' ? 'Only people listed above can open this project.' : 'Anyone in the workspace can view and comment.'}</div></div></div></div>
  </div>
  <div class="modal-f"><button class="btn btn-secondary" data-a="copyLink" data-pid="${p.id}">${ic('link', 14)}Copy link</button><span class="sp"></span><button class="btn btn-primary" data-a="closeModal">Done</button></div>`;
}
export function inviteModal(m, H) {
  const err = S.ui.errors.invite;
  return `${H('Invite to ' + esc(D().ws.name), 'No email is sent. People join automatically when they sign up or log in with the address you add here.')}
  <form class="modal-b" data-submit="submitInvite">
    <div class="field"><label class="label" for="inv-emails">Email addresses</label><textarea class="textarea ${err ? 'is-error' : ''}" id="inv-emails" placeholder="name@company.com, another@company.com" rows="3" autofocus>${esc(S.ui.inviteDraft || '')}</textarea>${err ? `<span class="err">${ic('circle-alert', 12)}${err}</span>` : '<span class="hint">Separate multiple addresses with commas.</span>'}</div>
    <div class="row" style="gap:12px"><div class="field grow"><label class="label" for="inv-role">Role</label><select class="select" id="inv-role">${(isAdmin() ? ['Member', 'Admin', 'Guest'] : ['Member', 'Guest']).map(r => `<option>${r}</option>`).join('')}</select></div>
    <div class="field grow"><label class="label" for="inv-team">Team</label><select class="select" id="inv-team"><option value="">No team</option>${teamsList()
      .map(t => `<option value="${t.id}">${esc(t.name)}</option>`)
      .join('')}</select></div></div>
    <div class="alert info">${ic('info', 14)}<span><b>Guests</b> can only see projects they're added to and can't create projects.</span></div>
    <div class="alert info">${ic('link', 14)}<span>Let them know they're invited: copy the sign-up link and send it yourself. They'll see ${esc(D().ws.name)} as soon as they create an account with the invited email.</span></div>
  </form>
  <div class="modal-f"><button class="btn btn-ghost" data-a="copyInviteLink">${ic('link', 14)}Copy sign-up link</button><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitInvite" id="inv-submit">Invite</button></div>`;
}
export function confirmModal(m) {
  const needs = m.typeName;
  const ok = !needs || (S.ui.confirmText || '') === needs;
  return `<div class="modal-b" style="padding-top:18px;gap:10px">
    <div class="row" style="gap:12px;align-items:flex-start"><span class="ftype" style="--c:${m.danger ? 'var(--red)' : 'var(--amber)'};width:34px;height:34px;border-radius:9px">${ic(m.icon || (m.danger ? 'trash-2' : 'archive'), 17)}</span>
    <div class="grow"><h2 id="mt-confirm" style="font-size:15px;font-weight:600;margin:4px 0 6px">${esc(m.title)}</h2><p class="muted" style="margin:0;font-size:13px;line-height:1.55">${m.body}</p></div></div>
    ${needs ? `<div class="field" style="margin-top:6px"><label class="label" for="confirm-in" style="font-weight:400;color:var(--text-2)">Type <b style="color:var(--text);font-weight:600">${esc(needs)}</b> to confirm</label><input class="input" id="confirm-in" data-in="confirmText" autocomplete="off" autofocus value="${esc(S.ui.confirmText || '')}"></div>` : ''}
  </div>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal" ${needs ? '' : 'autofocus'}>Cancel</button><button class="btn ${m.danger ? 'btn-danger' : 'btn-primary'}" data-a="confirmOk" ${ok ? '' : 'disabled'}>${esc(m.ok)}</button></div>`;
}
export const SHORTCUTS = [
  [
    'General',
    [
      ['Command menu', [MOD, 'K']],
      ['Search', ['/']],
      ['Keyboard shortcuts', ['?']],
      ['Toggle sidebar', ['[']],
      ['Toggle dark mode', [MOD, 'Shift', 'L']],
      ['Close panel or dialog', ['Esc']],
    ],
  ],
  [
    'Create',
    [
      ['New task', ['N']],
      ['New project', ['P']],
      ['Submit form', [MOD, '↵']],
      ['Send comment', [MOD, '↵']],
    ],
  ],
  [
    'Navigate',
    [
      ['Go to Home', ['G', 'H']],
      ['Go to My Tasks', ['G', 'T']],
      ['Go to Projects', ['G', 'P']],
      ['Go to Inbox', ['G', 'I']],
      ['Go to Calendar', ['G', 'C']],
      ['Go to Settings', ['G', 'S']],
    ],
  ],
  [
    'Command menu',
    [
      ['Move selection', ['↑', '↓']],
      ['Run command', ['↵']],
      ['Search mode', ['Tab']],
    ],
  ],
];
export function shortcutsModal(H) {
  return `${H('Keyboard shortcuts')}<div class="modal-b" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px">${SHORTCUTS.map(
    ([g, all]) => [g, all.filter(([n]) => canCreate() || n !== 'New project')],
  )
    .map(
      ([g, list]) =>
        `<div><div class="eyebrow" style="margin-bottom:6px">${g}</div>${list.map(([n, k]) => `<div class="row" style="height:30px;font-size:13px;border-bottom:1px solid var(--divider)"><span class="grow">${n}</span>${k.map((x, i) => `${i && k[0] === 'G' ? '<span class="faint" style="font-size:11px">then</span>' : ''}<kbd>${x}</kbd>`).join('')}</div>`).join('')}</div>`,
    )
    .join('')}</div>`;
}
export function filePreviewModal(m, H) {
  const f = D().files.find(x => x.id === m.file?.id) || m.file;
  const t = FT[f.type] || FT.other;
  const box =
    'border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;background:var(--sunken);display:grid;place-items:center;min-height:220px;max-height:62vh;';
  const note = (icon, text, extra = '') =>
    `<div class="col" style="align-items:center;gap:10px;padding:32px 20px;text-align:center;color:var(--text-2);font-size:13px"><span style="color:${t.c}">${ic(icon, 34)}</span><span style="max-width:380px">${text}</span>${extra}</div>`;
  let body;
  if (!f.path) body = note('file-x', "This file has no stored content, so it can't be previewed, downloaded or shared. Upload it again to replace it.");
  else if (f.type === 'img') {
    const im = imageState(f.path);
    if (im.state === 'ready')
      body = `<img data-fpath="${esc(f.path)}" src="${esc(im.url)}" alt="${esc(f.name)}" style="display:block;max-width:100%;max-height:62vh;object-fit:contain">`;
    else if (im.state === 'error')
      body = note(
        'image-off',
        esc(im.error),
        im.broken ? '' : `<button class="btn btn-secondary btn-sm" data-a="retryPreview" data-id="${f.id}">${ic('rotate-ccw', 13)}Try again</button>`,
      );
    else body = note('loader', 'Loading preview…');
  } else body = note(t.i, `No preview for ${esc(t.n.toLowerCase())} files here. Download it or open it in a new tab.`);
  const can = f.path ? '' : 'disabled';
  return `${H(esc(f.name), `${t.n} · ${esc(f.size)}${proj(f.project) ? ' · ' + esc(proj(f.project).name) : ''} · Uploaded by ${esc(f.by === D().me ? 'you' : authorName(f.by))} ${ago(f.at)}`)}
  <div class="modal-b"><div style="${box}">${body}</div>
  ${m.tid && task(m.tid) ? `<div class="row faint" style="font-size:12.5px">${ic('link', 13)}Attached to <button class="link" data-a="openTask" data-id="${m.tid}">${esc(task(m.tid).title)}</button></div>` : ''}</div>
  <div class="modal-f"><button class="btn btn-ghost" data-a="copyFileLink" data-id="${f.id}" ${can} title="Creates a private link that stops working after 1 hour">${ic('link', 14)}Copy temporary link</button><span class="sp"></span><button class="btn btn-secondary" data-a="openFile" data-id="${f.id}" ${can}>${ic('external-link', 14)}Open in new tab</button><button class="btn btn-primary" data-a="downloadFile" data-id="${f.id}" ${can}>${ic('download', 14)}Download</button></div>`;
}
