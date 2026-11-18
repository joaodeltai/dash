/* Casa uma mensagem lida com contatos e leads. Não escreve nada. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const wrapped = raw.match(/<([^>]+)>/);
  const email = (wrapped ? wrapped[1] : raw).trim();
  return EMAIL.test(email) && email.length <= 254 ? email : '';
}

export function normalizeMessageId(value) {
  return String(value || '')
    .trim()
    .replace(/^<|>$/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 998);
}

export function parseReferences(value) {
  const text = String(value || '').replace(/\r?\n[ \t]+/g, ' ');
  const ids = [];
  for (const match of text.matchAll(/<([^<>\s]+)>/g)) {
    const id = normalizeMessageId(match[1]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 32);
}

export function referencesFromHeader(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ');
  const line = unfolded.split(/\r?\n/).find(l => /^references\s*:/i.test(l)) || '';
  return parseReferences(line.replace(/^references\s*:/i, ''));
}

/* links: { dealId, contactId, reason } com reason from_email | in_reply_to | references */
export function matchInbound(message, { contacts = [], deals = [], sent = [] } = {}) {
  const from = normalizeEmail(message.fromEmail);
  const links = [];
  const seen = new Set();
  const add = (dealId, contactId, reason) => {
    if (!dealId && !contactId) return;
    const key = `${dealId || ''}|${contactId || ''}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ dealId: dealId || null, contactId: contactId || null, reason });
  };

  if (from) {
    for (const contact of contacts) {
      if (normalizeEmail(contact.email) !== from) continue;
      const own = deals.filter(deal => deal.contact_id === contact.id);
      if (!own.length) add(null, contact.id, 'from_email');
      for (const deal of own) add(deal.id, contact.id, 'from_email');
    }
  }

  const replyTo = normalizeMessageId(message.inReplyTo);
  const refs = new Set((message.references || []).map(normalizeMessageId).filter(Boolean));
  if (replyTo) refs.add(replyTo);
  for (const id of refs) {
    const hit = sent.find(row => normalizeMessageId(row.rfc_message_id) === id);
    if (!hit) continue;
    const reason = replyTo && replyTo === id ? 'in_reply_to' : 'references';
    add(hit.deal_id, hit.contact_id || null, reason);
  }
  return links;
}
