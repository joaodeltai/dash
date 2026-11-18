/* CRM: pipeline kanban, companies, contacts, follow-up sequences. */
import { TODAY, esc, iso, relDate } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr, trn } from '../core/i18n.js';
import {
  CRM_SOURCES,
  CRM_TABS,
  actType,
  brl,
  columnStages,
  filterDeals,
  nextStepTone,
  pipelineMetrics,
  sizeLabel,
  sourceLabel,
  stageColor,
  stageLabel,
} from '../core/crm.js';
import { D, S, canCreate, company, contact, crmStages } from '../core/store.js';
import { av, empty } from '../ui/helpers.js';

const today = () => iso(TODAY);
const pct = r => (r == null ? '—' : Math.round(r * 100) + '%');
const filters = () => Object.assign({ stage: 'all', source: 'all', tag: 'all', owner: 'all', overdue: false, company: '' }, S.ui.crmFilter);
const q = () => S.ui.crmQ || '';

function opts(list, value) {
  return list.map(([id, label]) => `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

export function pageCrm() {
  if (D().crmReady === false) return schemaMissing();
  if (!canCreate()) return noAccess();
  const tab = CRM_TABS.some(t => t[0] === S.ui.params.tab) ? S.ui.params.tab : 'pipeline';
  return `<div class="page flush crm-page">
    ${header(tab)}
    <nav class="tabs crm-tabs" aria-label="${tr('CRM')}">
      ${CRM_TABS.map(([k, n, i]) => `<button class="tab ${tab === k ? 'on' : ''}" ${tab === k ? 'aria-current="page"' : ''} data-a="go" data-r="crm" data-tab="${k}">${ic(i, 14)}${tr(n)}</button>`).join('')}
    </nav>
    <div class="pbody crm-body${S.ui.fx.tab ? ' fx-tab' : ''}">${tab === 'pipeline' ? pipeline() : tab === 'companies' ? companies() : tab === 'contacts' ? contacts() : sequences()}</div>
  </div>`;
}

function header(tab) {
  const actions = {
    pipeline: `<button class="btn btn-secondary btn-sm" data-a="newCompany">${ic('building-2', 14)}${tr('New company')}</button><button class="btn btn-primary btn-sm" data-a="newDeal">${ic('plus', 14)}${tr('New deal')}</button>`,
    companies: `<button class="btn btn-primary btn-sm" data-a="newCompany">${ic('plus', 14)}${tr('New company')}</button>`,
    contacts: `<button class="btn btn-primary btn-sm" data-a="newContact">${ic('plus', 14)}${tr('New contact')}</button>`,
    sequences: `<button class="btn btn-primary btn-sm" data-a="newSequence">${ic('plus', 14)}${tr('New sequence')}</button>`,
  };
  return `<div class="ph"><div><h1>${tr('CRM')}</h1><p>${tr('Sales pipeline of {name}.', { name: esc(D().ws.name) })}</p></div><div class="acts">${actions[tab] || ''}</div></div>`;
}

function schemaMissing() {
  return `<div class="page"><div class="panel">${empty(
    'database',
    tr('CRM is not in the database yet'),
    tr('Apply the migration supabase/migrations/20261117220000_crm.sql, then reload. The rest of the workspace keeps working until then.'),
  )}</div></div>`;
}
function noAccess() {
  return `<div class="page"><div class="panel">${empty('lock', tr("You don't have access"), tr('Guests cannot open the sales pipeline.'))}</div></div>`;
}

function pipeline() {
  const stages = columnStages(crmStages());
  const f = filters();
  const deals = filterDeals(D().deals, {
    ...f,
    q: q(),
    stages,
    companies: D().companies,
    contacts: D().contacts,
    today: today(),
  });
  const metrics = pipelineMetrics(D().deals, stages);
  const tags = [...new Set(D().deals.flatMap(d => d.tags || []))].sort((a, b) => a.localeCompare(b));
  const owners = D().members.filter(m => m.status !== 'deactivated');
  const companyFilter = f.company ? company(f.company) : null;
  const filtered = f.stage !== 'all' || f.source !== 'all' || f.tag !== 'all' || f.owner !== 'all' || f.overdue || f.company || q();
  return `${metricsHtml(metrics, stages)}
    <div class="crm-tools">
      <div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="crm-q" data-in="crmQ" placeholder="${tr('Search deals')}" value="${esc(q())}" aria-label="${tr('Search deals')}"></div>
      <select class="select" data-in="crmFilter" data-f="stage" aria-label="${tr('Stage')}">${opts([['all', tr('All stages')], ...stages.map(s => [s.id, stageLabel(s)])], f.stage)}</select>
      <select class="select" data-in="crmFilter" data-f="source" aria-label="${tr('Source')}">${opts([['all', tr('All sources')], ...CRM_SOURCES.map(s => [s.id, tr(s.name)])], f.source)}</select>
      <select class="select" data-in="crmFilter" data-f="tag" aria-label="${tr('Tags')}">${opts([['all', tr('All tags')], ...tags.map(t => [t, t])], f.tag)}</select>
      <select class="select" data-in="crmFilter" data-f="owner" aria-label="${tr('Assignee')}">${opts([['all', tr('All owners')], ['none', tr('Unassigned')], ...owners.map(m => [m.id, m.name])], f.owner)}</select>
      <label class="checkline"><input type="checkbox" data-in="crmFilter" data-f="overdue" ${f.overdue ? 'checked' : ''}>${tr('Overdue next step')}</label>
      ${companyFilter ? `<button class="pillbtn" data-a="clearCrmCompany">${ic('building-2', 12)}${esc(companyFilter.name)}${ic('x', 12)}</button>` : ''}
      ${filtered ? `<button class="btn btn-ghost btn-sm" data-a="clearCrmFilters">${tr('Clear filters')}</button>` : ''}
    </div>
    ${
      stages.length
        ? board(stages, deals)
        : `<div class="panel" style="margin:14px var(--gutter)">${empty('square-kanban', tr('No stages yet'), tr('The pipeline stages are created with the workspace. Reload if you just applied the migration.'))}</div>`
    }`;
}

function metricsHtml(m, stages) {
  const conv = m.conversions
    .map(
      c =>
        `<span class="crm-conv" title="${esc(tr('{fromN} reached {from}, {toN} reached {to}', { fromN: c.fromN, toN: c.toN, from: stageLabel(c.from), to: stageLabel(c.to) }))}">${esc(stageLabel(c.from))} <span class="faint">→</span> ${esc(stageLabel(c.to))} <b>${pct(c.rate)}</b></span>`,
    )
    .join('');
  return `<div class="crm-metrics">
    <div class="stats">
      <div class="stat"><span class="k">${tr('Open pipeline')}</span><span class="v">${brl(m.openValue)}</span><span class="d">${trn('{n} open deal', '{n} open deals', m.openN)}</span></div>
      <div class="stat"><span class="k">${tr('Won this month')}</span><span class="v">${brl(m.wonMonth)}</span><span class="d">${trn('{n} deal', '{n} deals', m.wonMonthN)}</span></div>
      <div class="stat"><span class="k">${tr('Win rate')}</span><span class="v">${pct(m.winRate)}</span><span class="d">${tr('{won} won · {lost} lost', { won: m.wonN, lost: m.lostN })}</span></div>
      <div class="stat"><span class="k">${tr('Overdue next step')}</span><span class="v">${
        D().deals.filter(
          d =>
            nextStepTone(
              d,
              stages.find(s => s.id === d.stage),
              today(),
            ) === 'over',
        ).length
      }</span><span class="d">${tr('across the open pipeline')}</span></div>
    </div>
    ${conv ? `<div class="crm-funnel" aria-label="${tr('Conversion between stages')}">${conv}</div>` : ''}
  </div>`;
}

function board(stages, deals) {
  const day = today();
  return `<div class="board crm-board" data-keep="crm-board">${stages
    .map(s => {
      const col = deals.filter(d => d.stage === s.id).sort((a, b) => a.order - b.order);
      const sum = col.reduce((n, d) => n + (d.value || 0), 0);
      const side = s.kind === 'lost' || s.kind === 'nurture';
      return `<section class="bcol ${side ? 'side' : ''} ${s.kind === 'won' ? 'won' : ''}" data-drop-stage="${s.id}" aria-label="${esc(stageLabel(s))}">
        <div class="bcol-h"><span class="sdot" style="background:${stageColor(s.color)}"></span><span class="trunc">${esc(stageLabel(s))}</span><span class="cnt">${col.length}</span>
          <span class="deal-sum">${brl(sum)}</span>
          <span class="acts"><button class="ibtn ibtn-xs" data-a="newDeal" data-stage="${s.id}" data-tip="${tr('Add deal')}" aria-label="${tr('Add deal to {name}', { name: stageLabel(s) })}">${ic('plus', 14)}</button></span>
        </div>
        <div class="bcol-b" data-stage-body="${s.id}">
          ${col.map(d => card(d, s, day)).join('')}
          <button class="addcard" data-a="newDeal" data-stage="${s.id}">${ic('plus', 14)}${tr('Add deal')}</button>
        </div>
      </section>`;
    })
    .join('')}</div>`;
}

function card(d, stage, day) {
  const co = company(d.company);
  const person = contact(d.contact);
  const tone = nextStepTone(d, stage, day);
  const tags = d.tags || [];
  const intent = Math.max(0, Math.min(100, Math.round(d.intent || 0)));
  const heat = intent >= 70 ? 'var(--green)' : intent >= 40 ? 'var(--amber)' : 'var(--gray)';
  return `<div class="kcard dealcard" draggable="true" data-drag-deal="${d.id}" data-a="openDeal" data-id="${d.id}" role="button" tabindex="0" aria-label="${esc(d.title)}">
    <div class="title">${esc(d.title)}</div>
    <div class="deal-who trunc">${esc(co?.name || tr('No company'))}${person ? ` · ${esc(person.name)}` : ''}</div>
    ${
      tags.length
        ? `<div class="deal-tags">${tags
            .slice(0, 3)
            .map(t => `<span class="deal-tag">${esc(t)}</span>`)
            .join('')}${tags.length > 3 ? `<span class="deal-tag">+${tags.length - 3}</span>` : ''}</div>`
        : ''
    }
    <div class="meta">
      <span class="m deal-value">${brl(d.value)}</span>
      <span class="intent" style="--p:${intent};--heat:${heat}" data-tip="${tr('Intent {n}', { n: intent })}"><i></i><b>${intent}</b></span>
      ${d.nextOn ? `<span class="m due ${tone}">${ic(tone === 'over' ? 'clock-alert' : 'calendar', 12)}${relDate(d.nextOn)}</span>` : ''}
      <span class="m" style="margin-left:auto">${av(d.owner, 'sm')}</span>
    </div>
  </div>`;
}

function companies() {
  const query = q().trim().toLowerCase();
  const rows = D().companies.filter(c => !query || [c.name, c.domain, c.segment, c.city, c.state].join(' ').toLowerCase().includes(query));
  return `${searchRow(tr('Search companies'))}
    ${
      !D().companies.length
        ? `<div class="panel" style="margin:0 var(--gutter)">${empty('building-2', tr('No companies yet'), tr('Add the companies you sell to. A deal can create one at the same time.'), `<button class="btn btn-primary btn-sm" data-a="newCompany">${ic('plus', 14)}${tr('New company')}</button>`)}</div>`
        : !rows.length
          ? `<div class="panel" style="margin:0 var(--gutter)">${empty('search-x', tr('No results found'), tr('No companies match your search.'), `<button class="btn btn-secondary btn-sm" data-a="clearCrmFilters">${tr('Clear filters')}</button>`)}</div>`
          : `<div class="tbl-wrap crm-table"><table class="tbl"><thead><tr>
              <th>${tr('Company')}</th><th>${tr('Domain')}</th><th>${tr('Segment')}</th><th>${tr('Size')}</th><th>${tr('City')}</th><th>${tr('Source')}</th><th>${tr('Deals')}</th><th>${tr('Open pipeline')}</th>
            </tr></thead><tbody>${rows
              .map(c => {
                const mine = D().deals.filter(d => d.company === c.id);
                const open = mine.filter(d => crmStages().find(s => s.id === d.stage)?.kind === 'open');
                return `<tr data-a="openCompany" data-id="${c.id}" style="cursor:pointer"><td class="trunc" style="font-weight:550">${esc(c.name)}</td><td class="muted trunc">${esc(c.domain || '—')}</td><td class="trunc">${esc(c.segment || '—')}</td><td>${esc(c.size ? sizeLabel(c.size) : '—')}</td><td class="trunc">${esc([c.city, c.state].filter(Boolean).join(' / ') || '—')}</td><td>${esc(c.source ? sourceLabel(c.source) : '—')}</td><td class="num">${mine.length}</td><td class="num">${brl(open.reduce((n, d) => n + (d.value || 0), 0))}</td></tr>`;
              })
              .join('')}</tbody></table></div>`
    }`;
}

function contacts() {
  const query = q().trim().toLowerCase();
  const rows = D().contacts.filter(c => {
    const co = company(c.company);
    return !query || [c.name, c.role, c.email, c.phone, co?.name].join(' ').toLowerCase().includes(query);
  });
  return `${searchRow(tr('Search contacts'))}
    ${
      !D().contacts.length
        ? `<div class="panel" style="margin:0 var(--gutter)">${empty('contact', tr('No contacts yet'), tr('Contacts are the people you talk to inside a company.'), `<button class="btn btn-primary btn-sm" data-a="newContact">${ic('plus', 14)}${tr('New contact')}</button>`)}</div>`
        : !rows.length
          ? `<div class="panel" style="margin:0 var(--gutter)">${empty('search-x', tr('No results found'), tr('No contacts match your search.'), `<button class="btn btn-secondary btn-sm" data-a="clearCrmFilters">${tr('Clear filters')}</button>`)}</div>`
          : `<div class="tbl-wrap crm-table"><table class="tbl"><thead><tr>
              <th>${tr('Name')}</th><th>${tr('Role')}</th><th>${tr('Company')}</th><th>${tr('Email')}</th><th>${tr('Phone / WhatsApp')}</th><th>${tr('LinkedIn')}</th>
            </tr></thead><tbody>${rows
              .map(c => {
                const co = company(c.company);
                return `<tr data-a="openContact" data-id="${c.id}" style="cursor:pointer"><td class="trunc" style="font-weight:550">${esc(c.name)}</td><td class="trunc">${esc(c.role || '—')}</td><td class="trunc">${esc(co?.name || '—')}</td><td class="trunc">${esc(c.email || '—')}</td><td>${esc(c.phone || '—')}</td><td class="trunc">${esc(c.linkedin ? c.linkedin.replace(/^https?:\/\//, '') : '—')}</td></tr>`;
              })
              .join('')}</tbody></table></div>`
    }`;
}

function sequences() {
  const list = D().sequences;
  if (!list.length)
    return `<div class="panel" style="margin:14px var(--gutter)">${empty('workflow', tr('No sequences yet'), tr('A sequence is a follow-up plan. Sending the messages is left to an agent; here you design the steps and enroll deals.'), `<button class="btn btn-primary btn-sm" data-a="newSequence">${ic('plus', 14)}${tr('New sequence')}</button>`)}</div>`;
  return `<div class="crm-seqs">${list
    .map(s => {
      const enrolled = D().enrollments.filter(e => e.sequence === s.id);
      const open = S.ui.crmStep === s.id;
      return `<section class="panel crm-seq">
        <div class="panel-h"><h2 class="trunc">${esc(s.name)}</h2>${s.active ? `<span class="badge green">${tr('Active')}</span>` : `<span class="badge gray">${tr('Paused')}</span>`}
          <span class="faint" style="font-size:12px">${trn('{n} step', '{n} steps', s.steps.length)} · ${trn('{n} enrollment', '{n} enrollments', enrolled.length)}</span>
          <div class="acts"><button class="btn btn-ghost btn-sm" data-a="toggleSequence" data-id="${s.id}">${s.active ? tr('Pause') : tr('Activate')}</button><button class="ibtn ibtn-sm" data-a="deleteSequence" data-id="${s.id}" aria-label="${tr('Delete sequence')}">${ic('trash-2', 14)}</button></div>
        </div>
        ${s.desc ? `<p class="crm-seq-desc">${esc(s.desc)}</p>` : ''}
        <ol class="crm-steps">${s.steps
          .map(
            (step, i) =>
              `<li><span class="num">${i + 1}</span>${ic(actType(step.channel).icon, 14)}<span>${tr(actType(step.channel).name)}</span><span class="faint">${trn('after {n} day', 'after {n} days', step.delay || 0)}</span><span class="trunc grow">${esc(step.body || tr('No message yet'))}</span><button class="ibtn ibtn-xs" data-a="removeStep" data-id="${s.id}" data-sid="${step.id}" aria-label="${tr('Remove step')}">${ic('x', 12)}</button></li>`,
          )
          .join('')}</ol>
        ${
          open
            ? `<form class="crm-step-form" data-submit="saveStep" data-id="${s.id}">
                <select class="select" id="step-ch-${s.id}" aria-label="${tr('Channel')}">${['email', 'whatsapp', 'linkedin', 'call'].map(id => `<option value="${id}">${tr(actType(id).name)}</option>`).join('')}</select>
                <label class="checkline">${tr('Wait')}<input class="input" id="step-delay-${s.id}" type="number" min="0" max="3650" value="2" aria-label="${tr('Days to wait')}" style="width:64px">${tr('days')}</label>
                <input class="input grow" id="step-body-${s.id}" placeholder="${tr('Message outline')}" aria-label="${tr('Message outline')}">
                <button class="btn btn-secondary btn-sm" type="button" data-a="cancelStep">${tr('Cancel')}</button>
                <button class="btn btn-primary btn-sm" type="submit">${tr('Add step')}</button>
              </form>`
            : `<div class="crm-seq-foot"><button class="btn btn-ghost btn-sm" data-a="startStep" data-id="${s.id}">${ic('plus', 13)}${tr('Add step')}</button></div>`
        }
      </section>`;
    })
    .join('')}</div>`;
}

function searchRow(label) {
  return `<div class="crm-tools"><div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="crm-q" data-in="crmQ" placeholder="${esc(label)}" value="${esc(q())}" aria-label="${esc(label)}"></div></div>`;
}

export function crmTabLabel(tab) {
  return tr((CRM_TABS.find(t => t[0] === tab) || CRM_TABS[0])[1]);
}
