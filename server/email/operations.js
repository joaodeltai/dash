import { createHash, randomUUID } from 'node:crypto';
import { decryptPassword, encryptPassword } from './crypto.js';
import { fail } from './errors.js';
import { deliverApproved, sendDecision } from './gates.js';
import { normalizeEmail, normalizeMessageId } from './match.js';
import { buildSyncPlan } from './plan.js';
import { readInbox, testImapLogin } from './imap-read.js';
import { testSmtpLogin } from './smtp-check.js';
import { checkMailboxInput } from './validate.js';
import { publicMailbox, shapeReport } from './view.js';

async function passwordFor(store, key, mailbox, typed) {
  if (typed) return String(typed);
  if (!mailbox) throw fail('not_configured');
  const secret = await store.getSecret(mailbox.id);
  if (!secret) throw fail('not_configured');
  if (!key) throw fail('missing_key');
  return decryptPassword(secret, key);
}

export async function saveConnection({ store, key, userId, workspaceId, input }) {
  const existing = await store.getMailbox(workspaceId);
  const secret = existing ? await store.getSecret(existing.id) : null;
  const parsed = checkMailboxInput(input, { requirePassword: !secret });
  if (parsed.password && !key) throw fail('missing_key');
  const mailbox = await store.upsertMailbox({
    workspaceId,
    userId,
    address: parsed.address,
    username: parsed.username,
    imapHost: parsed.imapHost,
    imapPort: parsed.imapPort,
    smtpHost: parsed.smtpHost,
    smtpPort: parsed.smtpPort,
  });
  if (parsed.password) await store.upsertSecret(mailbox.id, workspaceId, encryptPassword(parsed.password, key));
  return { ok: true, sent: false, mailbox: publicMailbox(mailbox, !!(parsed.password || secret)) };
}

export async function loginImap({ store, key, workspaceId, input, test = testImapLogin }) {
  const parsed = checkMailboxInput({ ...input, password: input?.password || 'placeholder' }, { requirePassword: false });
  const mailbox = await store.getMailbox(workspaceId);
  const password = await passwordFor(store, key, mailbox, input?.password);
  await test({ host: parsed.imapHost, port: parsed.imapPort, user: parsed.username || mailbox?.username, password });
  return { ok: true, protocol: 'imap', sent: false };
}

export async function loginSmtp({ store, key, workspaceId, input, test = testSmtpLogin }) {
  const parsed = checkMailboxInput({ ...input, password: input?.password || 'placeholder' }, { requirePassword: false });
  const mailbox = await store.getMailbox(workspaceId);
  const password = await passwordFor(store, key, mailbox, input?.password);
  await test({ host: parsed.smtpHost, port: parsed.smtpPort, user: parsed.username || mailbox?.username, password });
  return { ok: true, protocol: 'smtp', sent: false };
}

export async function syncConnection({ store, key, workspaceId, read = readInbox }) {
  const mailbox = await store.getMailbox(workspaceId);
  const password = await passwordFor(store, key, mailbox, '');
  let fetched;
  try {
    fetched = await read({ host: mailbox.imap_host, port: mailbox.imap_port, user: mailbox.username, password });
  } catch (err) {
    await store.saveError(mailbox.id, workspaceId, err?.code || 'imap_read_failed');
    throw err?.code ? err : fail('imap_read_failed');
  }
  const crm = await store.loadCrm(workspaceId);
  const existing = await store.existingMessages(
    mailbox.id,
    fetched.uidValidity,
    fetched.messages.map(message => message.imapUid).filter(uid => uid > 0),
  );
  const plan = buildSyncPlan({ fetched, crm, existing });
  await store.savePlan(mailbox, plan);
  return { ok: true, sent: false, plan };
}

export async function recordApproval({ store, workspaceId, userId, input }) {
  const to = normalizeEmail(input?.toEmail);
  if (!to) throw fail('missing_recipient');
  const dealId = String(input?.dealId || '');
  const deal = await store.getDeal(workspaceId, dealId);
  if (!deal) throw fail('invalid_input', ['dealId']);
  if (input?.channel === 'linkedin') throw fail('not_an_email');
  const body = String(input?.body || '').slice(0, 20000);
  const subject = String(input?.subject || '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
  const row = await store.insertApproval({
    workspaceId,
    dealId,
    toEmail: to,
    subject,
    body,
    bodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    userId,
  });
  return { ok: true, sent: false, approvalId: row.id };
}

export async function sendConnection({ store, key, enabled, workspaceId, approvalId, createTransport }) {
  const approval = await store.getApproval(workspaceId, approvalId);
  const decision = sendDecision({ enabled, approval });
  if (!decision.ok) return decision;
  const mailbox = await store.getMailbox(workspaceId);
  const password = await passwordFor(store, key, mailbox, '');
  const rfcMessageId = `<${randomUUID()}@grupodeltai.com.br>`;
  const transport = createTransport({ host: mailbox.smtp_host, port: mailbox.smtp_port, user: mailbox.username, password });
  try {
    const result = await deliverApproved({
      enabled: true,
      approval: { ...approval, from: mailbox.address, rfcMessageId },
      transport: { send: message => transport.sendMail(message) },
    });
    if (!result.sent) return result;
    const messageId = normalizeMessageId(result.messageId);
    await store.markSent({ approval, rfcMessageId: messageId });
    return { ok: true, sent: true, messageId };
  } finally {
    try {
      transport.close?.();
    } catch {
      /* already closed */
    }
  }
}

export async function dismissTriage({ store, workspaceId, messageId }) {
  await store.setTriage(workspaceId, messageId, false);
  return { ok: true, sent: false };
}

export async function buildReport(store, workspaceId, { sendingOn, readOn }) {
  const mailbox = await store.getMailbox(workspaceId);
  const hasPassword = mailbox ? await store.hasSecret(mailbox.id) : false;
  const status = mailbox ? await store.getStatus(mailbox.id) : null;
  const latestMessages = mailbox ? await store.latestMessages(workspaceId) : [];
  const triageMessages = mailbox ? await store.triageMessages(workspaceId) : [];
  const seen = new Set(latestMessages.map(message => message.id));
  const messages = [...latestMessages, ...triageMessages.filter(message => !seen.has(message.id))];
  const links = messages.length ? await store.linksFor(messages.map(message => message.id)) : [];
  const dealIds = [...new Set(links.map(link => link.deal_id).filter(Boolean))];
  const contactIds = [...new Set(links.map(link => link.contact_id).filter(Boolean))];
  const deals = dealIds.length ? await store.dealsByIds(dealIds) : [];
  const contacts = contactIds.length ? await store.contactsByIds(contactIds) : [];
  const approvals = await store.listApprovals(workspaceId);
  return shapeReport({
    mailbox,
    hasPassword,
    status,
    latestMessages,
    messages,
    links,
    deals,
    contacts,
    approvals,
    sendingOn,
    readOn,
  });
}
