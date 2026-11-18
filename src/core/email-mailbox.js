import { MISSING_DECIDER_EMAIL, parseEmailDraft } from './email-draft.js';

export function approvalFromDraft(draft, selected) {
  const parsed = parseEmailDraft(draft);
  if (!parsed) return { ok: false, code: 'no_draft' };
  const version = parsed.versoes.find(item => item.rotulo === selected) || parsed.versoes.find(item => item.rotulo === parsed.versao_ativa);
  if (!version) return { ok: false, code: 'no_draft' };
  if (version.canal === 'linkedin') return { ok: false, code: 'not_an_email' };
  if (parsed.email_decisor === MISSING_DECIDER_EMAIL) return { ok: false, code: 'missing_recipient' };
  return { ok: true, sent: false, toEmail: parsed.email_decisor, subject: version.assunto, body: version.corpo, channel: version.canal || 'email' };
}

export function repliesForDeal(messages, dealId) {
  return (messages || []).filter(message => (message.deals || []).some(deal => deal.id === dealId));
}

export function approvalsForDeal(approvals, dealId) {
  return (approvals || []).filter(row => row.dealId === dealId);
}
