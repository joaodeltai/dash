/* CRM mutations. They change S.data and save(), the same way tasks do.
   A stage change also leaves a pending activity so the timeline updates immediately;
   the database trigger writes the real stage_change row, and the next refresh replaces the pending one. */
import { $, TODAY, addD, esc, iso, uid } from '../core/utils.js';
import { tr } from '../core/i18n.js';
import { parseBrl, stageLabel } from '../core/crm.js';
import { D, S, canCreate, company, contact, crmStage, crmStages, deal, sequence } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { go, render } from '../shell/render.js';
import { closeModal, openModal } from '../overlays/modals.js';
import { A, BLUR, IN, confirmDlg, restore, snapshot } from './actions.js';

const now = () => Date.now();
const blankCompany = (over = {}) => ({
  id: uid(),
  name: '',
  domain: '',
  segment: '',
  size: '',
  city: '',
  state: '',
  source: '',
  notes: '',
  agent: '',
  created: now(),
  updated: now(),
  ...over,
});
const blankContact = (over = {}) => ({
  id: uid(),
  company: null,
  name: '',
  role: '',
  email: '',
  phone: '',
  linkedin: '',
  notes: '',
  agent: '',
  created: now(),
  updated: now(),
  ...over,
});

function ready() {
  if (D().crmReady === false) {
    toast(tr('Apply the CRM migration before adding deals.'), { kind: 'info' });
    return false;
  }
  if (!canCreate()) return false;
  return true;
}

export function moveDeal(d, stageId, { order, lostReason } = {}) {
  const next = crmStage(stageId);
  if (!d || !next) return false;
  const same = d.stage === stageId;
  if (same && order == null) return false;
  const reason = (lostReason || '').trim();
  if (!same && next.kind === 'lost' && !reason && !(d.lostReason || '').trim()) {
    openModal({ type: 'lostDeal', id: d.id, stage: stageId, order: order ?? null });
    return false;
  }
  mutate(() => {
    if (!same) {
      const from = d.stage;
      d.stage = stageId;
      if (next.kind === 'lost') {
        d.lostReason = reason || d.lostReason.trim();
        d.lostAt = now();
        d.wonAt = null;
      } else if (next.kind === 'won') {
        d.wonAt = d.wonAt || now();
        d.lostAt = null;
      } else {
        d.wonAt = null;
        d.lostAt = null;
      }
      D().crmActivities.unshift({
        id: uid(),
        deal: d.id,
        company: d.company,
        contact: d.contact,
        type: 'stage_change',
        direction: 'internal',
        content: '',
        at: now(),
        by: D().me,
        agent: '',
        meta: { from, to: stageId },
        pending: true,
      });
    }
    if (order != null) d.order = order;
    d.updated = now();
  });
  return true;
}

function orderInColumn(stageId, beforeId, selfId, fallback) {
  const col = D()
    .deals.filter(x => x.stage === stageId && x.id !== selfId)
    .sort((a, b) => a.order - b.order);
  if (!beforeId) return col.length ? col[col.length - 1].order + 1 : fallback;
  const i = col.findIndex(x => x.id === beforeId);
  if (i < 0) return fallback;
  const prev = col[i - 1];
  const nx = col[i];
  return prev ? (prev.order + nx.order) / 2 : nx.order - 1;
}

A.openDeal = el => {
  if (!deal(el.dataset.id)) return;
  S.ui.drawer = null;
  S.ui.crmRecord = null;
  S.ui.deal = el.dataset.id;
  S.ui.crmEdit = null;
  render();
  const dr = $('.drawer');
  if (dr && !dr.contains(document.activeElement)) dr.focus({ preventScroll: true });
};
A.pickDraftVersion = el => {
  const id = el.dataset.id;
  const rotulo = el.dataset.v || '';
  const row = deal(id);
  if (!row?.draft?.versoes?.some(v => v.rotulo === rotulo)) return;
  if (!S.ui.draftTab || typeof S.ui.draftTab !== 'object') S.ui.draftTab = {};
  if (S.ui.draftTab[id] === rotulo) return;
  S.ui.draftTab[id] = rotulo;
  render();
};
A.closeDeal = () => {
  S.ui.deal = null;
  S.ui.crmRecord = null;
  S.ui.crmEdit = null;
  render();
};
A.openCompany = el => {
  S.ui.deal = null;
  S.ui.crmRecord = { kind: 'company', id: el.dataset.id };
  render();
};
A.openContact = el => {
  S.ui.deal = null;
  S.ui.crmRecord = { kind: 'contact', id: el.dataset.id };
  render();
};

A.newDeal = el => {
  if (!ready()) return;
  S.ui.pop = null;
  const open = crmStages().filter(s => s.kind === 'open' || s.kind === 'nurture');
  const stage = el?.dataset?.stage && open.some(s => s.id === el.dataset.stage) ? el.dataset.stage : open[0]?.id || '';
  S.ui.errors = {};
  S.ui.crmForm = { title: '', value: '', stage, company: '', contact: '', role: '', email: '', phone: '', source: 'outbound' };
  openModal({ type: 'deal' });
};
A.submitDeal = () => {
  if (!ready()) return;
  const f = S.ui.crmForm || {};
  const title = ($('#crm-title')?.value ?? f.title ?? '').trim();
  const valueText = $('#crm-value')?.value ?? f.value ?? '';
  const cents = parseBrl(valueText);
  const stage = $('#crm-stage')?.value || f.stage;
  const companyName = ($('#crm-company')?.value ?? f.company ?? '').trim();
  const contactName = ($('#crm-contact')?.value ?? f.contact ?? '').trim();
  const email = ($('#crm-email')?.value ?? f.email ?? '').trim().toLowerCase();
  S.ui.errors = {};
  if (!title) S.ui.errors['crm-title'] = tr('Give the deal a title');
  if (cents == null) S.ui.errors['crm-value'] = tr('Enter a value in reais, or leave it blank');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) S.ui.errors['crm-email'] = tr('Enter a valid email address');
  if (!crmStage(stage)) S.ui.errors['crm-stage'] = tr('Pick a stage');
  if (Object.keys(S.ui.errors).length) {
    S.ui.crmForm = { ...f, title, value: valueText, stage, company: companyName, contact: contactName, email };
    render();
    return;
  }
  let created;
  mutate(() => {
    let companyId = null;
    if (companyName) {
      const existing = D().companies.find(c => c.name.toLowerCase() === companyName.toLowerCase());
      if (existing) companyId = existing.id;
      else {
        const row = blankCompany({ name: companyName, source: $('#crm-source')?.value || f.source || '' });
        D().companies.push(row);
        companyId = row.id;
      }
    }
    let contactId = null;
    if (contactName) {
      const existing = D().contacts.find(c => c.company === companyId && c.name.toLowerCase() === contactName.toLowerCase());
      if (existing) contactId = existing.id;
      else {
        const row = blankContact({
          company: companyId,
          name: contactName,
          role: ($('#crm-role')?.value ?? f.role ?? '').trim(),
          email,
          phone: ($('#crm-phone')?.value ?? f.phone ?? '').trim(),
        });
        D().contacts.push(row);
        contactId = row.id;
      }
    }
    const siblings = D().deals.filter(d => d.stage === stage);
    created = {
      id: uid(),
      title,
      company: companyId,
      contact: contactId,
      stage,
      value: cents || 0,
      source: $('#crm-source')?.value || f.source || '',
      intent: 0,
      owner: D().me,
      nextStep: '',
      nextOn: null,
      closeOn: null,
      lostReason: '',
      tags: [],
      order: siblings.length ? Math.max(...siblings.map(d => d.order)) + 1 : 1,
      agent: '',
      wonAt: null,
      lostAt: null,
      created: now(),
      updated: now(),
    };
    D().deals.push(created);
  });
  if (!created) return;
  closeModal();
  if (S.ui.route !== 'crm') go('crm', { tab: 'pipeline' });
  S.ui.deal = created.id;
  S.ui.crmRecord = null;
  render();
  toast(tr('Deal created'), { action: tr('Open'), onAction: () => A.openDeal({ dataset: { id: created.id } }) });
};

A.confirmLostDeal = () => {
  const m = S.ui.modals[S.ui.modals.length - 1];
  const reason = ($('#lost-reason')?.value || '').trim();
  if (!reason) {
    S.ui.errors = { 'lost-reason': tr('A lost deal needs a reason') };
    render();
    return;
  }
  const d = deal(m?.id);
  closeModal();
  if (d) moveDeal(d, m.stage, { order: m.order, lostReason: reason });
};

A.newCompany = el => {
  if (!ready()) return;
  S.ui.pop = null;
  S.ui.errors = {};
  S.ui.crmForm = { name: '', domain: '', segment: '', size: '', city: '', state: '', source: '', notes: '', deal: el?.dataset?.deal || '' };
  openModal({ type: 'company' });
};
A.submitCompany = () => {
  const f = S.ui.crmForm || {};
  const name = ($('#co-name')?.value ?? f.name ?? '').trim();
  if (!name) {
    S.ui.errors = { 'co-name': tr('Give the company a name') };
    render();
    return;
  }
  const read = id => $(id)?.value ?? '';
  let row;
  mutate(() => {
    row = blankCompany({
      name,
      domain: read('#co-domain').trim(),
      segment: read('#co-segment').trim(),
      size: read('#co-size'),
      city: read('#co-city').trim(),
      state: read('#co-state').trim(),
      source: read('#co-source'),
      notes: read('#co-notes'),
    });
    D().companies.push(row);
    const target = deal(f.deal);
    if (target) {
      target.company = row.id;
      target.updated = now();
    }
  });
  closeModal();
  if (row && !f.deal) {
    S.ui.deal = null;
    S.ui.crmRecord = { kind: 'company', id: row.id };
    render();
  }
};

A.newContact = el => {
  if (!ready()) return;
  S.ui.pop = null;
  S.ui.errors = {};
  S.ui.crmForm = {
    name: '',
    role: '',
    company: el?.dataset?.company || '',
    email: '',
    phone: '',
    linkedin: '',
    deal: el?.dataset?.deal || '',
  };
  openModal({ type: 'contact' });
};
A.submitContact = () => {
  const f = S.ui.crmForm || {};
  const name = ($('#ct-name')?.value ?? f.name ?? '').trim();
  const email = ($('#ct-email')?.value ?? f.email ?? '').trim().toLowerCase();
  S.ui.errors = {};
  if (!name) S.ui.errors['ct-name'] = tr('Give the contact a name');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) S.ui.errors['ct-email'] = tr('Enter a valid email address');
  if (Object.keys(S.ui.errors).length) {
    render();
    return;
  }
  let row;
  mutate(() => {
    row = blankContact({
      name,
      role: ($('#ct-role')?.value ?? '').trim(),
      company: $('#ct-company')?.value || null,
      email,
      phone: ($('#ct-phone')?.value ?? '').trim(),
      linkedin: ($('#ct-linkedin')?.value ?? '').trim(),
    });
    D().contacts.push(row);
    const target = deal(f.deal);
    if (target) {
      target.contact = row.id;
      if (row.company) target.company = row.company;
      target.updated = now();
    }
  });
  closeModal();
  if (row && f.deal && deal(f.deal)) {
    S.ui.deal = f.deal;
    S.ui.crmRecord = null;
    render();
  }
};

A.newSequence = () => {
  if (!ready()) return;
  S.ui.errors = {};
  S.ui.crmForm = { name: '', desc: '' };
  openModal({ type: 'sequence' });
};
A.submitSequence = () => {
  const name = ($('#sq-name')?.value ?? '').trim();
  if (!name) {
    S.ui.errors = { 'sq-name': tr('Give the sequence a name') };
    render();
    return;
  }
  mutate(() => {
    D().sequences.push({
      id: uid(),
      name,
      desc: ($('#sq-desc')?.value ?? '').trim(),
      active: true,
      agent: '',
      created: now(),
      updated: now(),
      steps: [],
    });
  });
  closeModal();
  if (S.ui.route !== 'crm') go('crm', { tab: 'sequences' });
};

A.deleteDeal = el => {
  const d = deal(el.dataset.id);
  if (!d) return;
  confirmDlg({
    title: tr('Delete this deal?'),
    body: tr('{title} and its activity will be removed.', { title: `<b>${esc(d.title)}</b>` }),
    ok: tr('Delete'),
    danger: true,
    run: () => {
      const snap = snapshot();
      mutate(() => {
        D().deals = D().deals.filter(x => x.id !== d.id);
        D().crmActivities = D().crmActivities.filter(a => a.deal !== d.id);
        D().enrollments = D().enrollments.filter(e => e.deal !== d.id);
        if (S.ui.deal === d.id) S.ui.deal = null;
      });
      toast(tr('Deal deleted'), { action: tr('Undo'), onAction: () => restore(snap) });
    },
  });
};
A.deleteCompany = el => {
  const c = company(el.dataset.id);
  if (!c) return;
  confirmDlg({
    title: tr('Delete this company?'),
    body: tr('{name} is removed. Deals and contacts stay, without the company.', { name: `<b>${esc(c.name)}</b>` }),
    ok: tr('Delete'),
    danger: true,
    run: () => {
      const snap = snapshot();
      mutate(() => {
        D().companies = D().companies.filter(x => x.id !== c.id);
        for (const person of D().contacts) if (person.company === c.id) person.company = null;
        for (const item of D().deals) if (item.company === c.id) item.company = null;
        if (S.ui.crmRecord?.id === c.id) S.ui.crmRecord = null;
      });
      toast(tr('Company deleted'), { action: tr('Undo'), onAction: () => restore(snap) });
    },
  });
};
A.deleteContact = el => {
  const c = contact(el.dataset.id);
  if (!c) return;
  confirmDlg({
    title: tr('Delete this contact?'),
    body: tr('{name} is removed. Deals that pointed at them stay.', { name: `<b>${esc(c.name)}</b>` }),
    ok: tr('Delete'),
    danger: true,
    run: () => {
      const snap = snapshot();
      mutate(() => {
        D().contacts = D().contacts.filter(x => x.id !== c.id);
        for (const item of D().deals) if (item.contact === c.id) item.contact = null;
        if (S.ui.crmRecord?.id === c.id) S.ui.crmRecord = null;
      });
      toast(tr('Contact deleted'), { action: tr('Undo'), onAction: () => restore(snap) });
    },
  });
};

function commitDealField(el) {
  const d = deal(el.dataset.id);
  if (!d) return;
  const f = el.dataset.f;
  const raw = el.value;
  if (f === 'stage') {
    if (raw && raw !== d.stage) moveDeal(d, raw);
    return;
  }
  if (f === 'value') {
    const cents = parseBrl(raw);
    if (cents == null) {
      toast(tr('Enter a value in reais, or leave it blank'), { kind: 'err' });
      render();
      return;
    }
    if (cents === d.value) return;
    mutate(() => {
      d.value = cents;
      d.updated = now();
    });
    return;
  }
  if (f === 'intent') {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    if (n === d.intent) return;
    mutate(() => {
      d.intent = n;
      d.updated = now();
    });
    return;
  }
  if (f === 'company') {
    const id = raw || null;
    if (id === d.company) return;
    mutate(() => {
      d.company = id;
      const person = contact(d.contact);
      if (person && id && person.company && person.company !== id) d.contact = null;
      d.updated = now();
    });
    return;
  }
  if (f === 'contact') {
    const id = raw || null;
    if (id === d.contact) return;
    mutate(() => {
      d.contact = id;
      const person = contact(id);
      if (person?.company) d.company = person.company;
      d.updated = now();
    });
    return;
  }
  if (f === 'owner') {
    const id = raw || null;
    if (id === d.owner) return;
    mutate(() => {
      d.owner = id;
      d.updated = now();
    });
    return;
  }
  if (f === 'source') {
    if (raw === (d.source || '')) return;
    mutate(() => {
      d.source = raw;
      d.updated = now();
    });
    return;
  }
  if (f === 'tags') {
    const tags = raw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    if (tags.join('\u0000') === (d.tags || []).join('\u0000')) return;
    mutate(() => {
      d.tags = tags;
      d.updated = now();
    });
    return;
  }
  if (f === 'nextOn' || f === 'closeOn') {
    const value = raw || null;
    if (value === (d[f] || null)) return;
    mutate(() => {
      d[f] = value;
      d.updated = now();
    });
    return;
  }
  if (f === 'lostReason') {
    const text = raw.trim();
    if (!text) {
      toast(tr('A lost deal needs a reason'), { kind: 'err' });
      render();
      return;
    }
    if (text === d.lostReason) return;
    mutate(() => {
      d.lostReason = text;
      d.updated = now();
    });
    return;
  }
  const text = f === 'title' ? raw.trim() : raw;
  if (f === 'title' && !text) {
    toast(tr('Give the deal a title'), { kind: 'err' });
    render();
    return;
  }
  const key = f === 'nextStep' ? 'nextStep' : 'title';
  if (text === d[key]) return;
  mutate(() => {
    d[key] = text;
    d.updated = now();
  });
}
IN.crmDeal = el => commitDealField(el);
BLUR.crmDeal = el => commitDealField(el);

function commitRecord(el, kind) {
  const row = kind === 'company' ? company(el.dataset.id) : contact(el.dataset.id);
  if (!row) return;
  const f = el.dataset.f;
  let value = el.value;
  if (f === 'name') {
    value = value.trim();
    if (!value) {
      toast(kind === 'company' ? tr('Give the company a name') : tr('Give the contact a name'), { kind: 'err' });
      render();
      return;
    }
  }
  if (f === 'email') {
    value = value.trim().toLowerCase();
    if (value && !/^\S+@\S+\.\S+$/.test(value)) {
      toast(tr('Enter a valid email address'), { kind: 'err' });
      render();
      return;
    }
  }
  if (f === 'company') value = value || null;
  if ((row[f] || '') === (value || '') || row[f] === value) return;
  mutate(() => {
    row[f] = typeof value === 'string' ? value.trim() : value;
    if (f === 'email') row.email = value;
    row.updated = now();
  });
}
IN.crmCompany = el => commitRecord(el, 'company');
BLUR.crmCompany = el => commitRecord(el, 'company');
IN.crmContact = el => commitRecord(el, 'contact');
BLUR.crmContact = el => commitRecord(el, 'contact');

A.logCrmActivity = () => {
  const d = deal(S.ui.deal);
  const text = ($('#crm-log')?.value || '').trim();
  const type = $('#crm-log-type')?.value || 'note';
  const direction = type === 'note' ? 'internal' : $('#crm-log-dir')?.value || 'outbound';
  if (!d || !text) {
    if (d && !text) toast(tr('Write something to log'), { kind: 'info' });
    return;
  }
  mutate(() => {
    D().crmActivities.unshift({
      id: uid(),
      deal: d.id,
      company: d.company,
      contact: d.contact,
      type,
      direction,
      content: text,
      at: now(),
      by: D().me,
      agent: '',
      meta: {},
    });
    d.updated = now();
  });
};
A.editCrmActivity = el => {
  S.ui.crmEdit = el.dataset.id;
  render();
};
BLUR.crmActivity = el => {
  const a = D().crmActivities.find(x => x.id === el.dataset.id);
  S.ui.crmEdit = null;
  if (!a || a.type === 'stage_change') {
    render();
    return;
  }
  const text = el.value.trim();
  if (!text || text === a.content) {
    render();
    return;
  }
  mutate(() => {
    a.content = text;
  });
};
A.deleteCrmActivity = el => {
  const id = el.dataset.id;
  const a = D().crmActivities.find(x => x.id === id);
  if (!a || a.type === 'stage_change') return;
  mutate(() => {
    D().crmActivities = D().crmActivities.filter(x => x.id !== id);
  });
};

A.enrollDeal = () => {
  const d = deal(S.ui.deal);
  const id = $('#crm-enroll')?.value;
  const seq = sequence(id);
  if (!d || !seq) return;
  if (D().enrollments.some(e => e.deal === d.id && e.sequence === seq.id)) return;
  const delay = seq.steps[0]?.delay || 0;
  mutate(() => {
    D().enrollments.push({
      id: uid(),
      sequence: seq.id,
      deal: d.id,
      status: 'active',
      step: 0,
      nextOn: iso(addD(TODAY, delay)),
      agent: '',
    });
  });
  toast(tr('Enrolled in {name}', { name: seq.name }));
};
IN.crmEnroll = el => {
  const row = D().enrollments.find(e => e.id === el.dataset.id);
  if (!row || row.status === el.value) return;
  mutate(() => {
    row.status = el.value;
  });
};

A.startStep = el => {
  S.ui.crmStep = el.dataset.id;
  render();
};
A.cancelStep = () => {
  S.ui.crmStep = null;
  render();
};
A.saveStep = el => {
  const id = el.dataset.id || el.closest('form')?.dataset.id;
  const seq = sequence(id);
  if (!seq) return;
  const channel = $(`#step-ch-${id}`)?.value || 'email';
  const delay = Math.max(0, Math.min(3650, Math.round(Number($(`#step-delay-${id}`)?.value) || 0)));
  const body = ($(`#step-body-${id}`)?.value || '').trim();
  mutate(() => {
    seq.steps.push({ id: uid(), channel, delay, body });
    seq.updated = now();
    S.ui.crmStep = null;
  });
};
A.removeStep = el => {
  const seq = sequence(el.dataset.id);
  if (!seq) return;
  mutate(() => {
    seq.steps = seq.steps.filter(s => s.id !== el.dataset.sid);
    seq.updated = now();
  });
};
A.toggleSequence = el => {
  const seq = sequence(el.dataset.id);
  if (!seq) return;
  mutate(() => {
    seq.active = !seq.active;
    seq.updated = now();
  });
};
A.deleteSequence = el => {
  const seq = sequence(el.dataset.id);
  if (!seq) return;
  confirmDlg({
    title: tr('Delete this sequence?'),
    body: tr('{name} and its enrollments will be removed. Deals stay.', { name: `<b>${esc(seq.name)}</b>` }),
    ok: tr('Delete'),
    danger: true,
    run: () => {
      mutate(() => {
        D().sequences = D().sequences.filter(s => s.id !== seq.id);
        D().enrollments = D().enrollments.filter(e => e.sequence !== seq.id);
      });
    },
  });
};

IN.crmQ = el => {
  S.ui.crmQ = el.value;
  render();
};
IN.crmForm = el => {
  S.ui.crmForm = S.ui.crmForm || {};
  S.ui.crmForm[el.dataset.f] = el.value;
};
IN.crmFilter = el => {
  S.ui.crmFilter = Object.assign({ stage: 'all', source: 'all', tag: 'all', owner: 'all', overdue: false, company: '' }, S.ui.crmFilter);
  S.ui.crmFilter[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
  render();
};
A.clearCrmFilters = () => {
  S.ui.crmQ = '';
  S.ui.crmFilter = { stage: 'all', source: 'all', tag: 'all', owner: 'all', overdue: false, company: '' };
  render();
};
A.clearCrmCompany = () => {
  S.ui.crmFilter = Object.assign({ stage: 'all', source: 'all', tag: 'all', owner: 'all', overdue: false }, S.ui.crmFilter, { company: '' });
  render();
};
A.filterCompanyDeals = el => {
  S.ui.crmFilter = Object.assign({ stage: 'all', source: 'all', tag: 'all', owner: 'all', overdue: false }, S.ui.crmFilter, { company: el.dataset.id });
  S.ui.crmRecord = null;
  go('crm', { tab: 'pipeline' });
};

export function dropDeal(id, stageId, beforeId) {
  const d = deal(id);
  const stage = crmStage(stageId);
  if (!d || !stage) return;
  const from = d.stage;
  const order = orderInColumn(stageId, beforeId, d.id, d.order);
  if (from === stageId && order === d.order) return;
  const moved = moveDeal(d, stageId, { order });
  if (moved && from !== stageId) toast(tr('Moved “{title}” to {stage}', { title: d.title, stage: stageLabel(stage) }), { ms: 2200 });
}
