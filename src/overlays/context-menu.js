/* ---------------- CONTEXT MENUS ---------------- */
import { ic } from '../core/icons.js';
import { ST } from '../core/constants.js';
import { tr } from '../core/i18n.js';
import { D, canCreate, canManage, mem, proj, task, visibleProjects } from '../core/store.js';

export function ctxMenu(p) {
  const I = (act, icon, label, extra = '', r = '') =>
    `<button class="mi ${extra}" data-a="${act}" data-id="${p.id}" data-key="${p.key || ''}">${ic(icon, 15)}${label}${r ? `<span class="r">${r}</span>` : ''}</button>`;
  const sep = '<div class="msep"></div>';
  if (p.ctx === 'task') {
    const t = task(p.id);
    if (!t) return '';
    return (
      I('openTask', 'panel-right-open', tr('Open')) +
      I('editTask', 'pencil', tr('Edit'), '', 'E') +
      I('toggleDone', t.status === 'done' ? 'rotate-ccw' : 'circle-check', t.status === 'done' ? tr('Reopen') : tr('Mark complete')) +
      sep +
      I('ctxStatus', 'circle-dot', tr('Status…')) +
      I('ctxAssign', 'user', tr('Assign to…')) +
      I('ctxPrio', 'signal-high', tr('Priority…')) +
      I('ctxMove', 'folder-input', tr('Move to project…')) +
      sep +
      I('toggleFavTask', 'star', t.fav ? tr('Remove from favorites') : tr('Add to favorites')) +
      I('copyLink', 'link', tr('Copy link')) +
      I('dupTask', 'copy', tr('Duplicate')) +
      I('archiveTask', 'archive', tr('Archive|verb')) +
      sep +
      I('delTask', 'trash-2', tr('Delete'), 'danger')
    );
  }
  if (p.ctx === 'project') {
    const pr = proj(p.id);
    if (!pr) return '';
    return (
      I('openProject', 'arrow-up-right', tr('Open')) +
      I('toggleFavProj', 'star', pr.fav ? tr('Remove from favorites') : tr('Add to favorites')) +
      I('editProject', 'pencil', tr('Rename & edit')) +
      I('share', 'share-2', tr('Share')) +
      I('copyLink', 'link', tr('Copy link')) +
      (canCreate() ? I('dupProject', 'copy', tr('Duplicate')) : '') +
      sep +
      (visibleProjects().indexOf(pr) > 0 ? I('projUp', 'arrow-up', tr('Move up in sidebar')) : '') +
      (visibleProjects().indexOf(pr) < visibleProjects().length - 1 ? I('projDown', 'arrow-down', tr('Move down in sidebar')) : '') +
      sep +
      I('archiveProject', 'archive', pr.status === 'complete' ? tr('Archive|verb') : tr('Archive project')) +
      I('delProject', 'trash-2', tr('Delete project'), 'danger')
    );
  }
  if (p.ctx === 'column') {
    return (
      `<div class="mh">${tr(ST[p.id].name)}</div>` +
      I('colAdd', 'plus', tr('Add task')) +
      I('colCollapse', 'fold-horizontal', tr('Collapse column')) +
      (p.id !== 'done' ? I('colDoneAll', 'check-check', tr('Mark all as done')) : I('colArchive', 'archive', tr('Archive completed'))) +
      I('colSortPrio', 'arrow-down-wide-narrow', tr('Sort by priority'))
    );
  }
  if (p.ctx === 'member') {
    const m = mem(p.id);
    if (!m) return '';
    const invited = m.status === 'invited';
    // Owners and admins manage other members; never the owner, never themselves (the database enforces this too).
    const manage = canManage(m);
    return (
      I('viewProfile', 'user', tr('View profile')) +
      (invited ? '' : I('assignToMember', 'plus', tr('Assign a task'))) +
      I('copyEmail', 'mail', tr('Copy email')) +
      (invited && canCreate() ? I('copyInviteLink', 'link', tr('Copy sign-up link')) : '') +
      (manage
        ? (invited ? '' : I('ctxRole', 'shield', tr('Change role…'))) +
          sep +
          I('removeMember', invited ? 'user-x' : 'user-minus', invited ? tr('Cancel invitation') : tr('Remove from workspace'), 'danger')
        : '')
    );
  }
  if (p.ctx === 'file') {
    const f = D().files.find(x => x.id === p.id);
    if (!f) return '';
    return (
      I('previewFile', 'eye', tr('Preview')) +
      (f.path
        ? I('downloadFile', 'download', tr('Download')) +
          I('openFile', 'external-link', tr('Open in new tab')) +
          I('copyFileLink', 'link', tr('Copy temporary link'), '', '1 h')
        : '') +
      sep +
      I('renameFile', 'pencil', tr('Rename')) +
      (f.path ? I('dupFile', 'copy', tr('Duplicate')) : '') +
      sep +
      I('delFile', 'trash-2', tr('Delete'), 'danger')
    );
  }
  if (p.ctx === 'savedview') {
    return `<button class="mi" data-a="renameView" data-id="${p.vid}">${ic('pencil', 15)}${tr('Rename view')}</button><button class="mi danger" data-a="delView" data-id="${p.vid}">${ic('trash-2', 15)}${tr('Delete view')}</button>`;
  }
  return '';
}
