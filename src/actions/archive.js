/* =====================================================================
   ACTIONS · ARCHIVE: restore and purge
   ===================================================================== */
import { esc } from '../core/utils.js';
import { logAct, task } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { tr } from '../core/i18n.js';
import { A, confirmDlg, deleteTasks } from './actions.js';

A.restoreTask = el => {
  const t = task(el.dataset.id);
  if (
    mutate(() => {
      t.archived = false;
      t.archivedAt = null;
      logAct('restored', t);
    })
  )
    toast(tr('Restored “{title}”', { title: t.title }), { action: tr('Open'), onAction: () => A.openTask({ dataset: { id: t.id } }) });
};
A.purgeTask = el => {
  const t = task(el.dataset.id);
  confirmDlg({
    title: tr('Delete task permanently?'),
    body: tr("<b>{title}</b>, its subtasks, comments, and attachments will be deleted for everyone. This can't be undone.", { title: esc(t.title) }),
    ok: tr('Delete permanently'),
    danger: true,
    run: () => {
      if (mutate(() => deleteTasks([t.id]))) toast(tr('Deleted “{title}”', { title: t.title }));
    },
  });
};
