/* Rascunho de e-mail de um lead (crm_deals.email_draft).

   O objeto, quando existe, tem forma fixa. assunto e corpo do topo são a
   versão ativa (versao_ativa). versoes traz cada texto, com rótulo A, B, C…
   na ordem, e canal opcional email ou linkedin. Nulo significa que o lead
   não tem rascunho. A mesma regra está no check do banco. */
import { tr } from './i18n.js';
import { esc } from './utils.js';

export const MISSING_DECIDER_EMAIL = '[FALTA: e-mail do decisor]';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROOT_KEYS = ['assunto', 'corpo', 'email_decisor', 'versao_ativa', 'versoes'];

const isString = v => typeof v === 'string';
const oneLine = s => !/[\r\n]/.test(s);
const sameKeys = (value, expected) => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, i) => key === expected[i]);
};

/* null quando o valor está vazio ou fora do formato. Um objeto válido volta
   canônico, para a gravação não mudar o que o banco já aceitou. */
export function parseEmailDraft(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!sameKeys(value, ROOT_KEYS)) return null;

  const assunto = value.assunto;
  const corpo = value.corpo;
  const email = value.email_decisor;
  const ativa = value.versao_ativa;
  const versoes = value.versoes;
  if (!isString(assunto) || !isString(corpo) || !isString(email) || !isString(ativa) || !Array.isArray(versoes)) return null;
  if (assunto.length > 500 || !oneLine(assunto) || corpo.length > 20000) return null;
  if (email !== MISSING_DECIDER_EMAIL && (email.length > 254 || !oneLine(email) || /\s/.test(email) || !EMAIL_RE.test(email))) return null;
  if (versoes.length > 26) return null;
  if (!versoes.length) {
    if (ativa !== '' || assunto !== '' || corpo !== '') return null;
    return { assunto: '', email_decisor: email, corpo: '', versao_ativa: '', versoes: [] };
  }
  if (!/^[A-Z]$/.test(ativa)) return null;

  const out = [];
  let matched = false;
  for (let i = 0; i < versoes.length; i++) {
    const item = versoes[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const canal = Object.prototype.hasOwnProperty.call(item, 'canal');
    if (!sameKeys(item, canal ? ['assunto', 'canal', 'corpo', 'rotulo'] : ['assunto', 'corpo', 'rotulo'])) return null;
    if (!isString(item.rotulo) || !isString(item.assunto) || !isString(item.corpo)) return null;
    if (item.rotulo !== String.fromCharCode(65 + i)) return null;
    if (item.assunto.length > 500 || !oneLine(item.assunto) || item.corpo.length > 20000) return null;
    const next = { rotulo: item.rotulo, assunto: item.assunto, corpo: item.corpo };
    if (canal) {
      if (item.canal !== 'email' && item.canal !== 'linkedin') return null;
      next.canal = item.canal;
    }
    if (item.rotulo === ativa) {
      if (item.assunto !== assunto || item.corpo !== corpo) return null;
      matched = true;
    }
    out.push(next);
  }
  if (!matched) return null;
  return { assunto, email_decisor: email, corpo, versao_ativa: ativa, versoes: out };
}

const channelName = canal => (canal === 'email' ? tr('Email') : canal === 'linkedin' ? tr('LinkedIn') : '');

/* Cartão só de leitura. selected escolhe a aba; sem escolha, vale a versão ativa. */
export function emailDraftCard(draft, { dealId = '', selected = '', mark = '' } = {}) {
  const parsed = parseEmailDraft(draft);
  const head = `<header class="draft-card-h">${mark}<span class="badge amber">${esc(tr('Draft|email'))}</span><span class="draft-state">${esc(tr('Not sent'))}</span>`;
  if (!parsed) {
    return `<section class="draft-card is-empty" aria-label="${esc(tr('Email draft'))}">${head}</header><p class="draft-empty">${esc(tr('No email draft on this lead yet.'))}</p></section>`;
  }
  const version = parsed.versoes.find(v => v.rotulo === selected) || parsed.versoes.find(v => v.rotulo === parsed.versao_ativa) || null;
  const safeId = String(dealId).replace(/[^A-Za-z0-9_-]/g, '') || 'lead';
  const missing = parsed.email_decisor === MISSING_DECIDER_EMAIL;
  const tabs = parsed.versoes
    .map(v => {
      const on = version?.rotulo === v.rotulo;
      const canal = channelName(v.canal);
      return `<button type="button" class="draft-tab" role="tab" id="draft-tab-${safeId}-${v.rotulo}" aria-selected="${on ? 'true' : 'false'}" aria-controls="draft-panel-${safeId}" data-a="pickDraftVersion" data-id="${esc(dealId)}" data-v="${esc(v.rotulo)}" aria-label="${esc(tr('Version {label}', { label: v.rotulo }))}">${esc(v.rotulo)}${canal ? `<span>${esc(canal)}</span>` : ''}</button>`;
    })
    .join('');
  const panel = version
    ? `<h3 class="draft-subject">${version.assunto ? esc(version.assunto) : `<span class="faint">${esc(tr('No subject'))}</span>`}</h3></header>
      <div class="draft-tabs" role="tablist" aria-label="${esc(tr('Email draft'))}">${tabs}</div>
      <div class="draft-panel" role="tabpanel" id="draft-panel-${safeId}" aria-labelledby="draft-tab-${safeId}-${version.rotulo}">
        <dl class="draft-route">
          <div><dt>${esc(tr('From|email'))}</dt><dd>${esc(tr('Not sent'))}</dd></div>
          <div><dt>${esc(tr('To|email'))}</dt><dd class="${missing ? 'is-missing' : ''}">${esc(parsed.email_decisor)}</dd></div>
        </dl>
        <div class="draft-body">${esc(version.corpo)}</div>
      </div>`
    : `<h3 class="draft-subject"><span class="faint">${esc(tr('No subject'))}</span></h3></header>
      <p class="draft-empty">${esc(tr('This draft has no versions.'))}</p>
      <dl class="draft-route">
        <div><dt>${esc(tr('From|email'))}</dt><dd>${esc(tr('Not sent'))}</dd></div>
        <div><dt>${esc(tr('To|email'))}</dt><dd class="${missing ? 'is-missing' : ''}">${esc(parsed.email_decisor)}</dd></div>
      </dl>`;
  return `<section class="draft-card" aria-label="${esc(tr('Email draft'))}">${head}${panel}</section>`;
}
