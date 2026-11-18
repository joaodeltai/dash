/* CRM create / lost-reason dialogs. */
import { esc } from '../core/utils.js';
import { tr } from '../core/i18n.js';
import { CRM_SIZES, CRM_SOURCES, columnStages, stageLabel } from '../core/crm.js';
import { D, S, crmStages } from '../core/store.js';

const field = (id, label, inner) =>
  `<div class="field"><label class="label" for="${id}">${label}</label>${inner}${S.ui.errors?.[id] ? `<span class="err">${esc(S.ui.errors[id])}</span>` : ''}</div>`;

export function crmModal(m, H, wrap) {
  if (m.type === 'deal') return wrap('', dealModal(H));
  if (m.type === 'company') return wrap('', companyModal(m, H));
  if (m.type === 'contact') return wrap('', contactModal(H));
  if (m.type === 'sequence') return wrap('sm', sequenceModal(H));
  if (m.type === 'lostDeal') return wrap('sm', lostModal(H));
  return '';
}

function dealModal(H) {
  const f = S.ui.crmForm || {};
  const stages = columnStages(crmStages()).filter(s => s.kind === 'open' || s.kind === 'nurture');
  const stage = f.stage && stages.some(s => s.id === f.stage) ? f.stage : stages[0]?.id || '';
  return `${H(tr('New deal'), tr('Creates the deal and, when the names are new, the company and the contact too.'))}
    <form class="modal-b" data-submit="submitDeal" style="gap:12px">
      ${field('crm-title', tr('Deal title'), `<input class="input" id="crm-title" data-in="crmForm" data-f="title" value="${esc(f.title || '')}" placeholder="${tr('e.g. Contact center rollout')}" autofocus aria-label="${tr('Deal title')}">`)}
      <div class="row" style="gap:8px;align-items:flex-start">
        ${field('crm-value', tr('Value'), `<input class="input" id="crm-value" data-in="crmForm" data-f="value" value="${esc(f.value || '')}" placeholder="${tr('R$ 0,00')}" inputmode="decimal" aria-label="${tr('Value')}">`)}
        ${field('crm-stage', tr('Stage'), `<select class="select" id="crm-stage" data-in="crmForm" data-f="stage" aria-label="${tr('Stage')}">${stages.map(s => `<option value="${s.id}" ${s.id === stage ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}</select>`)}
      </div>
      ${field(
        'crm-company',
        tr('Company'),
        `<input class="input" id="crm-company" data-in="crmForm" data-f="company" value="${esc(f.company || '')}" list="crm-co-list" placeholder="${tr('Company name')}" aria-label="${tr('Company')}"><datalist id="crm-co-list">${D()
          .companies.map(c => `<option value="${esc(c.name)}"></option>`)
          .join('')}</datalist>`,
      )}
      <div class="row" style="gap:8px;align-items:flex-start">
        ${field('crm-contact', tr('Contact'), `<input class="input" id="crm-contact" data-in="crmForm" data-f="contact" value="${esc(f.contact || '')}" placeholder="${tr("Person's name")}" aria-label="${tr('Contact')}">`)}
        ${field('crm-role', tr('Role'), `<input class="input" id="crm-role" data-in="crmForm" data-f="role" value="${esc(f.role || '')}" aria-label="${tr('Role')}">`)}
      </div>
      <div class="row" style="gap:8px;align-items:flex-start">
        ${field('crm-email', tr('Email'), `<input class="input" id="crm-email" type="email" data-in="crmForm" data-f="email" value="${esc(f.email || '')}" aria-label="${tr('Email')}">`)}
        ${field('crm-phone', tr('Phone / WhatsApp'), `<input class="input" id="crm-phone" data-in="crmForm" data-f="phone" value="${esc(f.phone || '')}" aria-label="${tr('Phone / WhatsApp')}">`)}
      </div>
      ${field('crm-source', tr('Source'), `<select class="select" id="crm-source" data-in="crmForm" data-f="source" aria-label="${tr('Source')}">${CRM_SOURCES.map(s => `<option value="${s.id}" ${(f.source || 'outbound') === s.id ? 'selected' : ''}>${tr(s.name)}</option>`).join('')}</select>`)}
    </form>
    <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">${tr('Cancel')}</button><button class="btn btn-primary" data-a="submitDeal">${tr('Create deal')}</button></div>`;
}

function companyModal(m, H) {
  const f = S.ui.crmForm || {};
  return `${H(m.edit ? tr('Edit company') : tr('New company'))}
    <form class="modal-b" data-submit="submitCompany" style="gap:12px">
      ${field('co-name', tr('Name'), `<input class="input" id="co-name" data-in="crmForm" data-f="name" value="${esc(f.name || '')}" autofocus aria-label="${tr('Name')}">`)}
      ${field('co-domain', tr('Domain'), `<input class="input" id="co-domain" data-in="crmForm" data-f="domain" value="${esc(f.domain || '')}" placeholder="empresa.com.br" aria-label="${tr('Domain')}">`)}
      <div class="row" style="gap:8px;align-items:flex-start">
        ${field('co-segment', tr('Segment'), `<input class="input" id="co-segment" data-in="crmForm" data-f="segment" value="${esc(f.segment || '')}" aria-label="${tr('Segment')}">`)}
        ${field('co-size', tr('Size'), `<select class="select" id="co-size" data-in="crmForm" data-f="size" aria-label="${tr('Size')}"><option value="">${tr('Not set')}</option>${CRM_SIZES.map(s => `<option value="${s.id}" ${f.size === s.id ? 'selected' : ''}>${tr(s.name)}</option>`).join('')}</select>`)}
      </div>
      <div class="row" style="gap:8px;align-items:flex-start">
        ${field('co-city', tr('City'), `<input class="input" id="co-city" data-in="crmForm" data-f="city" value="${esc(f.city || '')}" aria-label="${tr('City')}">`)}
        ${field('co-state', tr('State'), `<input class="input" id="co-state" data-in="crmForm" data-f="state" value="${esc(f.state || '')}" maxlength="8" placeholder="SP" aria-label="${tr('State')}" style="width:88px">`)}
      </div>
      ${field('co-source', tr('Source'), `<select class="select" id="co-source" data-in="crmForm" data-f="source" aria-label="${tr('Source')}"><option value="">${tr('No source')}</option>${CRM_SOURCES.map(s => `<option value="${s.id}" ${f.source === s.id ? 'selected' : ''}>${tr(s.name)}</option>`).join('')}</select>`)}
      ${field('co-notes', tr('Notes'), `<textarea class="textarea" id="co-notes" data-in="crmForm" data-f="notes" rows="3" aria-label="${tr('Notes')}">${esc(f.notes || '')}</textarea>`)}
    </form>
    <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">${tr('Cancel')}</button><button class="btn btn-primary" data-a="submitCompany">${tr('Save')}</button></div>`;
}

function contactModal(H) {
  const f = S.ui.crmForm || {};
  return `${H(tr('New contact'))}
    <form class="modal-b" data-submit="submitContact" style="gap:12px">
      ${field('ct-name', tr('Name'), `<input class="input" id="ct-name" data-in="crmForm" data-f="name" value="${esc(f.name || '')}" autofocus aria-label="${tr('Name')}">`)}
      ${field('ct-role', tr('Role'), `<input class="input" id="ct-role" data-in="crmForm" data-f="role" value="${esc(f.role || '')}" aria-label="${tr('Role')}">`)}
      ${field(
        'ct-company',
        tr('Company'),
        `<select class="select" id="ct-company" data-in="crmForm" data-f="company" aria-label="${tr('Company')}"><option value="">${tr('No company')}</option>${D()
          .companies.map(c => `<option value="${c.id}" ${f.company === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
          .join('')}</select>`,
      )}
      ${field('ct-email', tr('Email'), `<input class="input" id="ct-email" type="email" data-in="crmForm" data-f="email" value="${esc(f.email || '')}" aria-label="${tr('Email')}">`)}
      ${field('ct-phone', tr('Phone / WhatsApp'), `<input class="input" id="ct-phone" data-in="crmForm" data-f="phone" value="${esc(f.phone || '')}" aria-label="${tr('Phone / WhatsApp')}">`)}
      ${field('ct-linkedin', tr('LinkedIn'), `<input class="input" id="ct-linkedin" data-in="crmForm" data-f="linkedin" value="${esc(f.linkedin || '')}" placeholder="https://linkedin.com/in/…" aria-label="${tr('LinkedIn')}">`)}
    </form>
    <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">${tr('Cancel')}</button><button class="btn btn-primary" data-a="submitContact">${tr('Save')}</button></div>`;
}

function sequenceModal(H) {
  const f = S.ui.crmForm || {};
  return `${H(tr('New sequence'), tr('A plan an agent can follow. Nothing is sent from here.'))}
    <form class="modal-b" data-submit="submitSequence">
      ${field('sq-name', tr('Name'), `<input class="input" id="sq-name" data-in="crmForm" data-f="name" value="${esc(f.name || '')}" placeholder="${tr('e.g. First meeting follow-up')}" autofocus aria-label="${tr('Name')}">`)}
      ${field('sq-desc', tr('Description'), `<textarea class="textarea" id="sq-desc" data-in="crmForm" data-f="desc" rows="3" aria-label="${tr('Description')}">${esc(f.desc || '')}</textarea>`)}
    </form>
    <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">${tr('Cancel')}</button><button class="btn btn-primary" data-a="submitSequence">${tr('Create')}</button></div>`;
}

function lostModal(H) {
  return `${H(tr('Why was this deal lost?'), tr('A lost deal needs a reason, and it stays on the record.'))}
    <form class="modal-b" data-submit="confirmLostDeal">
      ${field('lost-reason', tr('Lost reason'), `<textarea class="textarea" id="lost-reason" rows="3" autofocus aria-label="${tr('Lost reason')}" placeholder="${tr('e.g. Budget went to another vendor')}"></textarea>`)}
    </form>
    <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">${tr('Cancel')}</button><button class="btn btn-primary" data-a="confirmLostDeal">${tr('Move to lost')}</button></div>`;
}
