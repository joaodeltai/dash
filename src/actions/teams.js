/* =====================================================================
   ACTIONS · TEAMS: create, edit, delete
   ===================================================================== */
import { $, uid } from '../core/utils.js';
import { PCOLORS } from '../core/constants.js';
import { D, S, mem, team, teamsList } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { go, render } from '../shell/render.js';
import { tr, trn } from '../core/i18n.js';
import { openModal } from '../overlays/modals.js';
import { A, IN, confirmDlg, restore, snapshot } from './actions.js';

A.newTeam = () => {
  S.ui.pop = null;
  S.ui.errors = {};
  S.ui.tform = { name: '', desc: '', icon: 'users', color: 'teal', members: [] };
  openModal({ type: 'team' });
};
A.editTeam = el => {
  const t = team(el.dataset.id);
  if (!t) return;
  S.ui.pop = null;
  S.ui.errors = {};
  S.ui.tform = {
    name: t.name,
    desc: t.desc,
    icon: t.icon,
    color: Object.keys(PCOLORS).find(k => PCOLORS[k] === t.c) || 'slate',
    members: D()
      .members.filter(m => m.team === t.id)
      .map(m => m.id),
  };
  openModal({ type: 'team', edit: t.id });
};
IN.tform = el => {
  S.ui.tform[el.dataset.f] = el.value;
  if (el.dataset.f === 'name' && S.ui.errors.tname && el.value.trim()) {
    S.ui.errors.tname = null;
    render();
  }
};
A.tformSet = el => {
  S.ui.tform[el.dataset.f] = el.dataset.v;
  render();
};
A.tformMember = el => {
  const l = S.ui.tform.members;
  const id = el.dataset.id;
  S.ui.tform.members = l.includes(id) ? l.filter(x => x !== id) : [...l, id];
  render();
};
A.submitTeam = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const f = S.ui.tform;
  f.name = ($('#tm-name')?.value || '').trim();
  f.desc = ($('#tm-desc')?.value || '').trim();
  if (!f.name) {
    S.ui.errors.tname = tr('Give the team a name');
    render();
    $('#tm-name')?.focus();
    return;
  }
  if (teamsList().some(t => t.name.toLowerCase() === f.name.toLowerCase() && t.id !== m.edit)) {
    S.ui.errors.tname = tr('A team called “{name}” already exists', { name: f.name });
    render();
    $('#tm-name')?.focus();
    return;
  }
  let t;
  const ok = mutate(() => {
    if (m.edit) {
      t = team(m.edit);
      Object.assign(t, { name: f.name, desc: f.desc, icon: f.icon, c: PCOLORS[f.color] });
      D().members.forEach(x => {
        if (x.team === t.id && !f.members.includes(x.id)) x.team = '';
      });
    } else {
      t = { id: uid('tm'), name: f.name, desc: f.desc || tr('No description yet.'), icon: f.icon, c: PCOLORS[f.color] };
      teamsList().push(t);
    }
    f.members.forEach(id => {
      const x = mem(id);
      if (x) x.team = t.id;
    });
  });
  if (!ok) return;
  S.ui.modals.pop();
  if (m.edit) {
    render();
    toast(tr('Saved {name}', { name: t.name }));
  } else {
    go('team', { id: t.id });
    toast(tr('Created {name}', { name: t.name }));
  }
};
A.delTeam = el => {
  const t = team(el.dataset.id);
  const n = D().members.filter(x => x.team === t.id).length;
  const np = D().projects.filter(p => p.team === t.id).length;
  S.ui.modals.pop();
  confirmDlg({
    title: tr('Delete {name}?', { name: t.name }),
    body: tr(
      n
        ? np
          ? '<b>{members}</b> will have no team and <b>{projects}</b> will need a new team. People and projects are not deleted.'
          : '<b>{members}</b> will have no team. People and projects are not deleted.'
        : np
          ? 'The team has no members and <b>{projects}</b> will need a new team. People and projects are not deleted.'
          : 'The team has no members. People and projects are not deleted.',
      {
        members: trn('{n} member', '{n} members', n),
        projects: trn('{n} project', '{n} projects', np),
      },
    ),
    ok: tr('Delete team'),
    danger: true,
    icon: 'users',
    run: () => {
      const snap = snapshot();
      if (
        mutate(() => {
          D().teams = teamsList().filter(x => x !== t);
          D().members.forEach(x => {
            if (x.team === t.id) x.team = '';
          });
          D().projects.forEach(p => {
            if (p.team === t.id) p.team = '';
          });
        })
      ) {
        if (S.ui.route === 'team') go('teams');
        toast(tr('Deleted {name}', { name: t.name }), { action: tr('Undo'), onAction: () => restore(snap) });
      }
    },
  });
};
