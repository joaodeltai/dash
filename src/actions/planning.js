/* =====================================================================
   ACTIONS · PLANNING: calendar events (create / edit / delete) and the
   milestone rows of the project form
   ===================================================================== */
import { $, TODAY, fmtDate, iso, parse, uid } from '../core/utils.js';
import { D, S, canSee, proj } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { closeModal, openModal } from '../overlays/modals.js';
import { dateVisible } from '../views/calendar.js';
import { A, IN, KEY, curProjectId, restore, snapshot } from './actions.js';

const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(parse(s).getTime()) && iso(parse(s)) === s;
const validTime = s => !s || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const byWhen = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
const short = (t, n = 40) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const topModal = () => S.ui.modals[S.ui.modals.length - 1];

/* ---------- events ---------- */
A.newEvent = el => {
  const d = el?.dataset || {};
  const p = proj(d.project || curProjectId());
  S.ui.errors = {};
  S.ui.evform = { title: '', date: validDate(d.date) ? d.date : iso(TODAY), time: '', project: p && canSee(p) ? p.id : '' };
  openModal({ type: 'event' });
};
A.editEvent = el => {
  const e = D().events.find(x => x.id === el.dataset.id);
  const p = e?.project ? proj(e.project) : null;
  if (!e || (p && !canSee(p))) return;
  S.ui.errors = {};
  S.ui.evform = { title: e.title, date: e.date, time: e.time || '', project: p ? p.id : '' };
  openModal({ type: 'event', edit: e.id });
};
IN.evform = el => {
  S.ui.evform[el.dataset.f] = el.value;
  const k = { title: 'etitle', date: 'edate', time: 'etime' }[el.dataset.f];
  if (k && S.ui.errors[k]) {
    S.ui.errors[k] = null;
    render();
  }
};
KEY.evSubmit = () => A.submitEvent();
A.submitEvent = () => {
  const m = topModal();
  if (m?.type !== 'event') return;
  const f = S.ui.evform;
  f.title = ($('#ev-title')?.value ?? f.title).trim();
  f.date = $('#ev-date')?.value ?? f.date;
  f.time = $('#ev-time')?.value ?? f.time;
  f.project = $('#ev-project')?.value ?? f.project;
  const er = {};
  if (!f.title) er.etitle = 'Give the event a title';
  else if (f.title.length > 200) er.etitle = 'Titles can be up to 200 characters';
  if (!f.date) er.edate = 'Pick a date for the event';
  else if (!validDate(f.date)) er.edate = 'Enter a valid date';
  if (!validTime(f.time)) er.etime = 'Enter a valid time';
  S.ui.errors = er;
  const bad = Object.keys(er)[0];
  if (bad) {
    render();
    $({ etitle: '#ev-title', edate: '#ev-date', etime: '#ev-time' }[bad])?.focus();
    return;
  }
  if (m.edit && !D().events.some(x => x.id === m.edit)) {
    closeModal();
    toast('That event no longer exists', { kind: 'err' });
    return;
  }
  const p = f.project ? proj(f.project) : null;
  const project = p && canSee(p) ? p.id : null;
  if (
    !mutate(() => {
      const data = { title: f.title, date: f.date, time: f.time || '', project };
      if (m.edit) {
        const ev = D().events.find(x => x.id === m.edit);
        Object.assign(ev, data);
      } else D().events.push({ id: uid(), ...data });
      D().events.sort(byWhen);
    })
  )
    return;
  S.ui.modals.pop();
  if (!dateVisible(f.date)) S.ui.calDate = f.date;
  render();
  toast(m.edit ? 'Event updated' : `Event added on ${fmtDate(f.date)}`);
};
A.delEvent = el => {
  const e = D().events.find(x => x.id === el.dataset.id);
  if (!e) return;
  const m = topModal();
  if (m?.type === 'event' && m.edit === e.id) S.ui.modals.pop();
  S.ui.pop = null;
  const snap = snapshot();
  if (
    mutate(() => {
      D().events = D().events.filter(x => x !== e);
    })
  )
    toast(`Deleted “${short(e.title)}”`, { action: 'Undo', onAction: () => restore(snap), ms: 5000 });
};

/* ---------- milestone rows (project form) ---------- */
IN.pms = el => {
  const row = S.ui.pform.ms[+el.dataset.i];
  if (!row) return;
  row[el.dataset.f] = el.value;
  if (S.ui.errors.pms?.[el.dataset.i]) {
    delete S.ui.errors.pms[el.dataset.i];
    render();
  }
};
A.pmsAdd = () => {
  const f = S.ui.pform;
  const last = f.ms[f.ms.length - 1];
  f.ms.push({ name: '', date: last?.date || f.due || iso(TODAY) });
  S.ui.errors.pms = null;
  render();
  setTimeout(() => $(`#p-ms-n-${f.ms.length - 1}`)?.focus(), 0);
};
A.pmsRm = el => {
  S.ui.pform.ms.splice(+el.dataset.i, 1);
  S.ui.errors.pms = null;
  render();
};
// Enter in a milestone name: jump to the next row, or start a new one from the last row.
KEY.pmsEnter = el => {
  const i = +el.dataset.i;
  if (i < S.ui.pform.ms.length - 1) $(`#p-ms-n-${i + 1}`)?.focus();
  else if (el.value.trim()) A.pmsAdd();
};
