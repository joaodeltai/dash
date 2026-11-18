/* Deal drawer and the company / contact record drawer. */
import { emailDraftCard } from '../core/email-draft.js';
import { dealReplySection } from '../pages/crm-email.js';
import { ago, esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr } from '../core/i18n.js';
import { CRM_DIRECTIONS, CRM_SOURCES, actType, brl, columnStages, sourceLabel, stageLabel } from '../core/crm.js';
import { D, S, company, contact, crmStage, crmStages, sequence } from '../core/store.js';
import { authorAv, authorName } from '../ui/helpers.js';
import { fxc } from '../shell/render.js';

const sel = (f, id, inner, label) => `<select class="select" data-in="crmDeal" data-f="${f}" data-id="${id}" aria-label="${esc(label)}">${inner}</select>`;

export function dealDrawer(d) {
  const u = S.ui;
  const stage = crmStage(d.stage);
  const stages = columnStages(crmStages());
  const people = D().members.filter(m => m.status !== 'deactivated');
  const peopleContacts = D().contacts.filter(c => !d.company || !c.company || c.company === d.company || c.id === d.contact);
  const cos = D().companies;
  const acts = D().crmActivities.filter(a => a.deal === d.id);
  const enrolled = D().enrollments.filter(e => e.deal === d.id);
  const openSeqs = D().sequences.filter(s => s.active && !enrolled.some(e => e.sequence === s.id));
  const person = contact(d.contact);
  return `<aside class="drawer crm-drawer ${u.fx.drawer ? 'enter' : ''}" role="dialog" aria-modal="false" aria-labelledby="crm-h" tabindex="-1">
    <h2 class="sr" id="crm-h">${tr('Deal: {title}', { title: esc(d.title) })}</h2>
    <div class="drawer-h">
      <span class="pillbtn" style="font-size:12.5px">${ic('handshake', 13)}${tr('CRM')}</span>
      <span class="sp"></span>
      <button class="ibtn ibtn-sm" data-a="deleteDeal" data-id="${d.id}" data-tip="${tr('Delete deal')}" aria-label="${tr('Delete deal')}">${ic('trash-2', 15)}</button>
      <button class="ibtn ibtn-sm" data-a="closeDeal" data-tip="${tr('Close  Esc')}" aria-label="${tr('Close')}">${ic('x', 16)}</button>
    </div>
    <div class="drawer-b" data-keep="deal:${d.id}">
      <textarea class="ttl-edit" id="d-title" rows="1" data-autosize data-blur="crmDeal" data-f="title" data-id="${d.id}" aria-label="${tr('Deal title')}">${esc(d.title)}</textarea>
      <dl class="kv" style="margin-top:12px">
        <dt>${ic('circle-dot', 14)}${tr('Stage')}</dt><dd>${sel('stage', d.id, stages.map(s => `<option value="${s.id}" ${s.id === d.stage ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join(''), tr('Stage'))}</dd>
        <dt>${ic('banknote', 14)}${tr('Value')}</dt><dd><input class="input" data-blur="crmDeal" data-f="value" data-id="${d.id}" value="${esc(brl(d.value))}" aria-label="${tr('Value')}" inputmode="decimal"></dd>
        <dt>${ic('gauge', 14)}${tr('Intent')}</dt><dd><input class="input" data-blur="crmDeal" data-f="intent" data-id="${d.id}" type="number" min="0" max="100" value="${Math.round(d.intent || 0)}" aria-label="${tr('Intent score')}"></dd>
        <dt>${ic('building-2', 14)}${tr('Company')}</dt><dd>${sel('company', d.id, `<option value="">${tr('No company')}</option>${cos.map(c => `<option value="${c.id}" ${c.id === d.company ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`, tr('Company'))}${d.company ? `<button class="link" data-a="openCompany" data-id="${d.company}" style="margin-left:8px">${tr('Open')}</button>` : `<button class="link" data-a="newCompany" data-deal="${d.id}" style="margin-left:8px">${tr('New company')}</button>`}</dd>
        <dt>${ic('contact', 14)}${tr('Contact')}</dt><dd>${sel('contact', d.id, `<option value="">${tr('No contact')}</option>${peopleContacts.map(c => `<option value="${c.id}" ${c.id === d.contact ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`, tr('Contact'))}${person ? `<div class="faint" style="font-size:12px;margin-top:4px">${esc([person.role, person.email, person.phone].filter(Boolean).join(' · '))}${person.linkedin ? ` · <a href="${esc(person.linkedin)}" target="_blank" rel="noopener">${tr('LinkedIn')}</a>` : ''}</div>` : `<button class="link" data-a="newContact" data-company="${d.company || ''}" data-deal="${d.id}">${tr('New contact')}</button>`}</dd>
        <dt>${ic('user', 14)}${tr('Assignee')}</dt><dd>${sel('owner', d.id, `<option value="">${tr('Unassigned')}</option>${people.map(m => `<option value="${m.id}" ${m.id === d.owner ? 'selected' : ''}>${esc(m.name)}${m.id === D().me ? ` (${tr('you')})` : ''}</option>`).join('')}`, tr('Assignee'))}</dd>
        <dt>${ic('signpost', 14)}${tr('Source')}</dt><dd>${sel('source', d.id, `<option value="">${tr('No source')}</option>${CRM_SOURCES.map(s => `<option value="${s.id}" ${s.id === d.source ? 'selected' : ''}>${tr(s.name)}</option>`).join('')}${d.source && !CRM_SOURCES.some(s => s.id === d.source) ? `<option value="${esc(d.source)}" selected>${esc(d.source)}</option>` : ''}`, tr('Source'))}</dd>
        <dt>${ic('footprints', 14)}${tr('Next step')}</dt><dd><input class="input" data-blur="crmDeal" data-f="nextStep" data-id="${d.id}" value="${esc(d.nextStep || '')}" placeholder="${tr('What happens next')}" aria-label="${tr('Next step')}"></dd>
        <dt>${ic('calendar', 14)}${tr('Due')}</dt><dd><input class="input" type="date" data-in="crmDeal" data-f="nextOn" data-id="${d.id}" value="${esc(d.nextOn || '')}" aria-label="${tr('Next step date')}"></dd>
        <dt>${ic('calendar-check', 14)}${tr('Forecast')}</dt><dd><input class="input" type="date" data-in="crmDeal" data-f="closeOn" data-id="${d.id}" value="${esc(d.closeOn || '')}" aria-label="${tr('Expected close')}"></dd>
        <dt>${ic('tags', 14)}${tr('Tags')}</dt><dd><input class="input" data-blur="crmDeal" data-f="tags" data-id="${d.id}" value="${esc((d.tags || []).join(', '))}" placeholder="${tr('comma, separated')}" aria-label="${tr('Tags')}"></dd>
        ${stage?.kind === 'lost' ? `<dt>${ic('circle-x', 14)}${tr('Lost reason')}</dt><dd><input class="input" data-blur="crmDeal" data-f="lostReason" data-id="${d.id}" value="${esc(d.lostReason || '')}" aria-label="${tr('Lost reason')}"></dd>` : ''}
      </dl>
      ${d.agent ? `<p class="faint" style="font-size:12px;margin:8px 0 0">${tr('Created by agent {name}', { name: esc(d.agent) })}</p>` : ''}
      ${emailDraftCard(d.draft, { dealId: d.id, selected: S.ui.draftTab?.[d.id] || '', mark: ic('mail', 14) })}
      ${dealReplySection(d)}

      <div class="dsec" style="margin-top:18px">
        <div class="dsec-h"><h3>${tr('Activity')}</h3><span class="cnt num">${acts.length}</span></div>
        <form class="crm-log" data-submit="logCrmActivity">
          <div class="row" style="gap:6px;flex-wrap:wrap">
            <select class="select" id="crm-log-type" aria-label="${tr('Activity type')}">${['note', 'email', 'whatsapp', 'linkedin', 'call', 'meeting'].map(id => `<option value="${id}">${tr(actType(id).name)}</option>`).join('')}</select>
            <select class="select" id="crm-log-dir" aria-label="${tr('Direction')}">${CRM_DIRECTIONS.map(dirc => `<option value="${dirc.id}" ${dirc.id === 'outbound' ? 'selected' : ''}>${tr(dirc.name)}</option>`).join('')}</select>
          </div>
          <textarea class="textarea" id="crm-log" rows="2" placeholder="${tr('Log a note, a call, a message…')}" aria-label="${tr('Activity note')}"></textarea>
          <div class="row"><span class="sp"></span><button class="btn btn-primary btn-sm" type="submit">${ic('plus', 13)}${tr('Log activity')}</button></div>
        </form>
        <div class="crm-timeline">
          ${acts.map(a => activityRow(a)).join('') || `<p class="faint" style="font-size:13px">${tr('No activity yet. Stage changes are logged automatically.')}</p>`}
        </div>
      </div>

      <div class="dsec">
        <div class="dsec-h"><h3>${tr('Sequences')}</h3></div>
        ${enrolled
          .map(e => {
            const seq = sequence(e.sequence);
            return `<div class="row" style="gap:8px;min-height:32px;font-size:13px">${ic('workflow', 14)}<span class="trunc grow">${esc(seq?.name || tr('Deleted sequence'))}</span>
              <select class="select" data-in="crmEnroll" data-id="${e.id}" aria-label="${tr('Enrollment status')}">
                ${['active', 'paused', 'done'].map(st => `<option value="${st}" ${e.status === st ? 'selected' : ''}>${tr(st === 'active' ? 'Active' : st === 'paused' ? 'Paused' : 'Done|sequence')}</option>`).join('')}
              </select></div>`;
          })
          .join('')}
        ${
          openSeqs.length
            ? `<form class="row" data-submit="enrollDeal" style="gap:6px;margin-top:6px"><select class="select grow" id="crm-enroll" aria-label="${tr('Sequence')}">${openSeqs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button class="btn btn-secondary btn-sm" type="submit">${tr('Enroll')}</button></form>`
            : `<p class="faint" style="font-size:12.5px;margin:6px 0 0">${tr('No active sequence left to enroll.')}</p>`
        }
      </div>
    </div>
  </aside>`;
}

function activityRow(a) {
  const kind = actType(a.type);
  const editing = S.ui.crmEdit === a.id && a.type !== 'stage_change';
  const mine = a.by === D().me;
  const body =
    a.type === 'stage_change'
      ? stageMove(a)
      : editing
        ? `<textarea class="textarea" data-blur="crmActivity" data-id="${a.id}" aria-label="${tr('Edit activity')}">${esc(a.content)}</textarea>`
        : `<div class="crm-act-body">${esc(a.content)}</div>`;
  return `<article class="crm-act${fxc('added', a.id)}">
    <div class="row" style="gap:8px;align-items:flex-start">
      <span class="crm-act-ic">${ic(kind.icon, 14)}</span>
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:6px;font-size:12.5px;color:var(--text-2)">${authorAv(a.by, 'sm')}<b style="color:var(--text);font-weight:550">${esc(authorName(a.by))}</b><span>${tr(kind.name)}</span>${a.direction && a.direction !== 'internal' ? `<span class="faint">${tr(CRM_DIRECTIONS.find(d => d.id === a.direction)?.name || a.direction)}</span>` : ''}${a.agent ? `<span class="badge gray">${tr('Agent {name}', { name: esc(a.agent) })}</span>` : ''}<span class="sp"></span><time class="faint">${ago(a.at)}</time>
          ${mine && a.type !== 'stage_change' ? `<button class="ibtn ibtn-xs" data-a="editCrmActivity" data-id="${a.id}" aria-label="${tr('Edit')}">${ic('pencil', 12)}</button><button class="ibtn ibtn-xs" data-a="deleteCrmActivity" data-id="${a.id}" aria-label="${tr('Delete')}">${ic('trash-2', 12)}</button>` : ''}
        </div>
        ${body}
      </div>
    </div>
  </article>`;
}

function stageMove(a) {
  const from = crmStage(a.meta?.from);
  const to = crmStage(a.meta?.to);
  return `<div class="crm-act-body">${tr('Moved from {from} to {to}', {
    from: from ? stageLabel(from) : tr('an unknown stage'),
    to: to ? stageLabel(to) : tr('an unknown stage'),
  })}</div>`;
}

export function recordDrawer() {
  const rec = S.ui.crmRecord;
  if (!rec) return '';
  if (rec.kind === 'company') return companyDrawer(company(rec.id));
  if (rec.kind === 'contact') return contactDrawer(contact(rec.id));
  return '';
}

function companyDrawer(c) {
  if (!c) return '';
  const deals = D().deals.filter(d => d.company === c.id);
  return `<aside class="drawer crm-drawer ${S.ui.fx.drawer ? 'enter' : ''}" role="dialog" aria-labelledby="co-h" tabindex="-1">
    <h2 class="sr" id="co-h">${tr('Company: {name}', { name: esc(c.name) })}</h2>
    <div class="drawer-h"><span class="pillbtn">${ic('building-2', 13)}${tr('Company')}</span><span class="sp"></span>
      <button class="ibtn ibtn-sm" data-a="deleteCompany" data-id="${c.id}" aria-label="${tr('Delete company')}">${ic('trash-2', 15)}</button>
      <button class="ibtn ibtn-sm" data-a="closeDeal" aria-label="${tr('Close')}">${ic('x', 16)}</button>
    </div>
    <div class="drawer-b" data-keep="co:${c.id}">
      ${field(tr('Name'), `<input class="input" data-blur="crmCompany" data-f="name" data-id="${c.id}" value="${esc(c.name)}" aria-label="${tr('Name')}">`)}
      ${field(tr('Domain'), `<input class="input" data-blur="crmCompany" data-f="domain" data-id="${c.id}" value="${esc(c.domain)}" placeholder="empresa.com.br" aria-label="${tr('Domain')}">`)}
      ${field(tr('Segment'), `<input class="input" data-blur="crmCompany" data-f="segment" data-id="${c.id}" value="${esc(c.segment)}" aria-label="${tr('Segment')}">`)}
      ${field(tr('Size'), `<select class="select" data-in="crmCompany" data-f="size" data-id="${c.id}" aria-label="${tr('Size')}"><option value="">${tr('Not set')}</option>${['1-10', '11-50', '51-200', '201-1000', '1000+'].map(id => `<option value="${id}" ${c.size === id ? 'selected' : ''}>${tr(sizeName(id))}</option>`).join('')}</select>`)}
      <div class="row" style="gap:8px">${field(tr('City'), `<input class="input" data-blur="crmCompany" data-f="city" data-id="${c.id}" value="${esc(c.city)}" aria-label="${tr('City')}">`)}${field(tr('State'), `<input class="input" data-blur="crmCompany" data-f="state" data-id="${c.id}" value="${esc(c.state)}" maxlength="8" placeholder="SP" aria-label="${tr('State')}" style="width:72px">`)}</div>
      ${field(tr('Source'), sourceSelect('crmCompany', c))}<div class="field"><label class="label">${tr('Notes')}</label><textarea class="textarea" data-blur="crmCompany" data-f="notes" data-id="${c.id}" rows="4" aria-label="${tr('Notes')}">${esc(c.notes)}</textarea></div>
      <div class="dsec"><div class="dsec-h"><h3>${tr('Deals')}</h3><span class="cnt num">${deals.length}</span><button class="btn btn-ghost btn-sm" data-a="filterCompanyDeals" data-id="${c.id}">${tr('Show on the board')}</button></div>
        ${deals.map(d => `<button class="row crm-mini" data-a="openDeal" data-id="${d.id}"><span class="trunc grow">${esc(d.title)}</span><span class="num">${brl(d.value)}</span><span class="faint">${esc(stageLabel(crmStage(d.stage)))}</span></button>`).join('') || `<p class="faint">${tr('No deals for this company yet.')}</p>`}
      </div>
      ${c.agent ? `<p class="faint" style="font-size:12px">${tr('Created by agent {name}', { name: esc(c.agent) })}</p>` : ''}
    </div>
  </aside>`;
}

function contactDrawer(c) {
  if (!c) return '';
  const cos = D().companies;
  return `<aside class="drawer crm-drawer ${S.ui.fx.drawer ? 'enter' : ''}" role="dialog" aria-labelledby="ct-h" tabindex="-1">
    <h2 class="sr" id="ct-h">${tr('Contact: {name}', { name: esc(c.name) })}</h2>
    <div class="drawer-h"><span class="pillbtn">${ic('contact', 13)}${tr('Contact')}</span><span class="sp"></span>
      <button class="ibtn ibtn-sm" data-a="deleteContact" data-id="${c.id}" aria-label="${tr('Delete contact')}">${ic('trash-2', 15)}</button>
      <button class="ibtn ibtn-sm" data-a="closeDeal" aria-label="${tr('Close')}">${ic('x', 16)}</button>
    </div>
    <div class="drawer-b" data-keep="ct:${c.id}">
      ${field(tr('Name'), `<input class="input" data-blur="crmContact" data-f="name" data-id="${c.id}" value="${esc(c.name)}" aria-label="${tr('Name')}">`)}
      ${field(tr('Role'), `<input class="input" data-blur="crmContact" data-f="role" data-id="${c.id}" value="${esc(c.role)}" placeholder="${tr('e.g. Head of operations')}" aria-label="${tr('Role')}">`)}
      ${field(tr('Company'), `<select class="select" data-in="crmContact" data-f="company" data-id="${c.id}" aria-label="${tr('Company')}"><option value="">${tr('No company')}</option>${cos.map(co => `<option value="${co.id}" ${co.id === c.company ? 'selected' : ''}>${esc(co.name)}</option>`).join('')}</select>`)}
      ${field(tr('Email'), `<input class="input" type="email" data-blur="crmContact" data-f="email" data-id="${c.id}" value="${esc(c.email)}" aria-label="${tr('Email')}">`)}
      ${field(tr('Phone / WhatsApp'), `<input class="input" data-blur="crmContact" data-f="phone" data-id="${c.id}" value="${esc(c.phone)}" aria-label="${tr('Phone / WhatsApp')}">`)}
      ${field(tr('LinkedIn'), `<input class="input" data-blur="crmContact" data-f="linkedin" data-id="${c.id}" value="${esc(c.linkedin)}" placeholder="https://linkedin.com/in/…" aria-label="${tr('LinkedIn')}">`)}
      <div class="field"><label class="label">${tr('Notes')}</label><textarea class="textarea" data-blur="crmContact" data-f="notes" data-id="${c.id}" rows="4" aria-label="${tr('Notes')}">${esc(c.notes)}</textarea></div>
      ${c.agent ? `<p class="faint" style="font-size:12px">${tr('Created by agent {name}', { name: esc(c.agent) })}</p>` : ''}
    </div>
  </aside>`;
}

const field = (label, inner) => `<div class="field"><label class="label">${label}</label>${inner}</div>`;
function sourceSelect(handler, row) {
  return `<select class="select" data-in="${handler}" data-f="source" data-id="${row.id}" aria-label="${tr('Source')}"><option value="">${tr('No source')}</option>${CRM_SOURCES.map(s => `<option value="${s.id}" ${row.source === s.id ? 'selected' : ''}>${tr(s.name)}</option>`).join('')}${row.source && !CRM_SOURCES.some(s => s.id === row.source) ? `<option value="${esc(row.source)}" selected>${esc(sourceLabel(row.source))}</option>` : ''}</select>`;
}
function sizeName(id) {
  return (
    {
      '1-10': '1 to 10 people',
      '11-50': '11 to 50 people',
      '51-200': '51 to 200 people',
      '201-1000': '201 to 1,000 people',
      '1000+': 'More than 1,000 people',
    }[id] || id
  );
}
