import { matchInbound } from './match.js';

/* Plano de gravação de uma leitura. A lista writes é a allowlist:
   crm_deals, email_draft e a etapa não entram. */
export const SYNC_WRITES = ['crm_inbox_messages', 'crm_inbox_links', 'crm_mailbox_status'];

export function buildSyncPlan({ fetched, crm, existing = [] }) {
  const prev = new Map(existing.map(row => [`${row.uidValidity}:${row.imapUid}`, row]));
  const messages = (fetched.messages || []).map(message => {
    const links = matchInbound(message, crm);
    const old = prev.get(`${fetched.uidValidity}:${message.imapUid}`);
    const needsTriage = old ? !!old.needsTriage : links.length > 0;
    return { ...message, links, needsTriage };
  });
  return {
    writes: SYNC_WRITES,
    messages,
    status: {
      total: Number(fetched.total) || 0,
      unseen: Number(fetched.unseen) || 0,
      uidValidity: Number(fetched.uidValidity) || 0,
      lastError: '',
    },
  };
}
