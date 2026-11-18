import { ImapFlow } from 'imapflow';
import { fail } from './errors.js';
import { normalizeMessageId, referencesFromHeader } from './match.js';

/* Envelope não marca a mensagem como lida. headers e o trecho de texto
   saem por BODY.PEEK no imapflow. A caixa abre com EXAMINE (readOnly). */
export const FETCH_QUERY = {
  uid: true,
  envelope: true,
  flags: true,
  headers: ['references'],
  bodyParts: [{ key: 'TEXT', start: 0, maxLength: 1200 }],
};

export const READ_ONLY = { readOnly: true };

export function createImapClient(creds) {
  return new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: true,
    auth: { user: creds.user, pass: creds.password },
    logger: false,
    logRaw: false,
    emitLogs: false,
    tls: { rejectUnauthorized: true, servername: creds.host },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    disableAutoIdle: true,
  });
}

export function cleanSnippet(value) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
  let visible = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    visible += code < 32 || code === 127 ? ' ' : char;
  }
  return visible.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function textOf(bodyParts) {
  if (!(bodyParts instanceof Map)) return '';
  for (const [key, value] of bodyParts) {
    if (String(key).toLowerCase() === 'text') return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  }
  return '';
}

export function normalizeFetched(msg) {
  const env = msg?.envelope || {};
  const from = (env.from && env.from[0]) || {};
  const flags = msg?.flags ? [...msg.flags] : [];
  const received = env.date ? new Date(env.date) : null;
  return {
    imapUid: Number(msg?.uid),
    messageId: normalizeMessageId(env.messageId),
    inReplyTo: normalizeMessageId(env.inReplyTo),
    references: referencesFromHeader(msg?.headers),
    fromEmail: String(from.address || '')
      .trim()
      .toLowerCase(),
    fromName: String(from.name || '')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 200),
    subject: String(env.subject || '')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 500),
    snippet: cleanSnippet(textOf(msg?.bodyParts)),
    receivedAt: received && !Number.isNaN(received.getTime()) ? received.toISOString() : null,
    serverSeen: flags.some(flag => String(flag).toLowerCase() === '\\seen'),
  };
}

async function closeClient(client) {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
}

export async function testImapLogin(creds, deps = {}) {
  const client = (deps.createClient || createImapClient)(creds);
  try {
    await client.connect();
    return { ok: true, protocol: 'imap', sent: false };
  } catch (err) {
    throw fail(err?.authenticationFailed ? 'imap_login_failed' : 'imap_read_failed');
  } finally {
    await closeClient(client);
  }
}

export async function readInbox(creds, deps = {}) {
  const limit = Math.min(Math.max(Number(deps.limit) || 20, 1), 30);
  const client = (deps.createClient || createImapClient)(creds);
  let lock;
  try {
    await client.connect();
    const status = await client.status('INBOX', { messages: true, unseen: true, uidValidity: true });
    lock = await client.getMailboxLock('INBOX', READ_ONLY);
    const total = Number(status?.messages) || 0;
    const unseen = Number(status?.unseen) || 0;
    const uidValidity = Number(status?.uidValidity) || 0;
    let uids = [];
    if (total > 0) {
      const found = await client.search({ all: true }, { uid: true });
      uids = (found || []).slice(-limit);
    }
    const messages = [];
    if (uids.length) {
      for await (const msg of client.fetch(uids, FETCH_QUERY, { uid: true })) messages.push(normalizeFetched(msg));
    }
    return { total, unseen, uidValidity, messages };
  } catch (err) {
    if (err?.code === 'imap_login_failed' || err?.code === 'imap_read_failed') throw err;
    throw fail(err?.authenticationFailed ? 'imap_login_failed' : 'imap_read_failed');
  } finally {
    try {
      lock?.release();
    } catch {
      /* already released */
    }
    await closeClient(client);
  }
}
