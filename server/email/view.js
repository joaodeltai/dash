import { MAILBOX_DEFAULTS } from '../../shared/mailbox.js';

/* Resposta pública. Não copia ciphertext, nonce, tag nem senha. */
export function publicMailbox(row, hasPassword) {
  if (!row) return null;
  return {
    address: row.address,
    username: row.username,
    hasPassword: !!hasPassword,
    imap: { host: row.imap_host, port: row.imap_port, secure: true },
    smtp: { host: row.smtp_host, port: row.smtp_port, secure: true },
    pop3: { host: MAILBOX_DEFAULTS.pop3Host, port: MAILBOX_DEFAULTS.pop3Port, secure: true, used: false },
  };
}

export function shapeReport({ mailbox, hasPassword, status, latestMessages, messages, links, deals, contacts, approvals, sendingOn, readOn }) {
  const dealById = new Map((deals || []).map(deal => [deal.id, deal]));
  const contactById = new Map((contacts || []).map(contact => [contact.id, contact]));
  const linksByMessage = new Map();
  for (const link of links || []) {
    const list = linksByMessage.get(link.message_id) || [];
    list.push(link);
    linksByMessage.set(link.message_id, list);
  }
  const present = message => {
    const grouped = new Map();
    const contactIds = new Map();
    for (const link of linksByMessage.get(message.id) || []) {
      if (link.deal_id) {
        const entry = grouped.get(link.deal_id) || {
          id: link.deal_id,
          title: dealById.get(link.deal_id)?.title || '',
          stageId: dealById.get(link.deal_id)?.stage_id || null,
          reasons: [],
        };
        if (!entry.reasons.includes(link.match_reason)) entry.reasons.push(link.match_reason);
        grouped.set(link.deal_id, entry);
      }
      if (link.contact_id) {
        const entry = contactIds.get(link.contact_id) || {
          id: link.contact_id,
          name: contactById.get(link.contact_id)?.name || '',
          email: contactById.get(link.contact_id)?.email || '',
          reasons: [],
        };
        if (!entry.reasons.includes(link.match_reason)) entry.reasons.push(link.match_reason);
        contactIds.set(link.contact_id, entry);
      }
    }
    return {
      id: message.id,
      fromEmail: message.from_email,
      fromName: message.from_name,
      subject: message.subject,
      snippet: message.snippet,
      receivedAt: message.received_at,
      serverSeen: message.server_seen,
      needsTriage: message.needs_triage,
      deals: [...grouped.values()],
      contacts: [...contactIds.values()],
    };
  };
  const latest = (latestMessages || messages || []).map(present);
  const matched = (messages || []).map(present).filter(message => message.deals.length || message.contacts.length);
  return {
    ok: true,
    sent: false,
    sendingEnabled: sendingOn === true,
    readSyncEnabled: readOn === true,
    mailbox: publicMailbox(mailbox, hasPassword),
    status: {
      total: status ? status.total_messages : null,
      unseen: status ? status.unseen_messages : null,
      lastSyncAt: status?.last_sync_at || null,
      lastError: status?.last_error || '',
    },
    latest,
    matched,
    matchedReplies: matched.length,
    approvals: (approvals || []).map(row => ({
      id: row.id,
      dealId: row.deal_id,
      toEmail: row.to_email,
      subject: row.subject,
      approvedAt: row.approved_at,
      consumedAt: row.consumed_at,
    })),
  };
}
