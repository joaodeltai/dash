import { HTTP_STATUS } from './errors.js';
import { runReadCron } from './gates.js';
import { buildReport, dismissTriage, loginImap, loginSmtp, recordApproval, saveConnection, sendConnection, syncConnection } from './operations.js';
import { createSmtpTransport } from './smtp-check.js';
import { bearer, cronAuthorized, requireMember, serverConfig, serviceDb } from './session.js';
import { createStore } from './store.js';
import { requireUuid } from './validate.js';

function json(res, status, body) {
  res.status(status).json(body);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if (raw.length > 100000) {
    const err = new Error('invalid_input');
    err.code = 'invalid_input';
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('invalid_input');
    err.code = 'invalid_input';
    throw err;
  }
}

function workspaceFrom(req, body) {
  return requireUuid(body?.workspaceId || req.query?.workspaceId);
}

async function context(req, { admin = false, body } = {}) {
  const cfg = serverConfig();
  const payload = body || (req.method === 'GET' ? {} : await readBody(req));
  const workspaceId = workspaceFrom(req, payload);
  const auth = await requireMember(cfg, bearer(req), workspaceId, { admin });
  return { cfg, payload, workspaceId, auth, store: createStore(auth.db) };
}

async function onMailbox(req) {
  if (req.method === 'GET') {
    const { cfg, workspaceId, store } = await context(req);
    return buildReport(store, workspaceId, { sendingOn: cfg.sendingOn, readOn: cfg.readOn });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const { cfg, payload, workspaceId, auth, store } = await context(req, { admin: true });
    const saved = await saveConnection({ store, key: cfg.key, userId: auth.user.id, workspaceId, input: payload });
    const report = await buildReport(store, workspaceId, { sendingOn: cfg.sendingOn, readOn: cfg.readOn });
    return { ...report, mailbox: saved.mailbox };
  }
  return null;
}

async function onTest(req, which) {
  if (req.method !== 'POST') return null;
  const { cfg, payload, workspaceId, store } = await context(req);
  if (which === 'imap') return loginImap({ store, key: cfg.key, workspaceId, input: payload });
  return loginSmtp({ store, key: cfg.key, workspaceId, input: payload });
}

async function onSync(req) {
  if (req.method !== 'POST') return null;
  const { cfg, workspaceId, store } = await context(req);
  await syncConnection({ store, key: cfg.key, workspaceId });
  return buildReport(store, workspaceId, { sendingOn: cfg.sendingOn, readOn: cfg.readOn });
}

async function onStatus(req) {
  if (req.method !== 'GET') return null;
  const { cfg, workspaceId, store } = await context(req);
  const live = req.query?.live === '1' || req.query?.live === 'true';
  if (live) await syncConnection({ store, key: cfg.key, workspaceId });
  return buildReport(store, workspaceId, { sendingOn: cfg.sendingOn, readOn: cfg.readOn });
}

async function onApprove(req) {
  if (req.method !== 'POST') return null;
  const { payload, workspaceId, auth, store } = await context(req);
  return recordApproval({ store, workspaceId, userId: auth.user.id, input: payload });
}

async function onSend(req) {
  if (req.method !== 'POST') return null;
  const { cfg, payload, workspaceId, store } = await context(req, { admin: true });
  const approvalId = requireUuid(payload.approvalId, 'approvalId');
  return sendConnection({
    store,
    key: cfg.key,
    enabled: cfg.sendingOn,
    workspaceId,
    approvalId,
    createTransport: createSmtpTransport,
  });
}

async function onTriage(req) {
  if (req.method !== 'POST') return null;
  const { payload, workspaceId, store } = await context(req);
  const messageId = requireUuid(payload.messageId, 'messageId');
  await dismissTriage({ store, workspaceId, messageId });
  return buildReport(store, workspaceId, { sendingOn: serverConfig().sendingOn, readOn: serverConfig().readOn });
}

async function onCron(req) {
  if (req.method !== 'POST') return null;
  const cfg = serverConfig();
  if (!cfg.cronSecret) {
    const err = new Error('missing_cron_secret');
    err.code = 'missing_cron_secret';
    throw err;
  }
  const db = cronAuthorized(cfg, bearer(req)) ? serviceDb(cfg) : null;
  return runReadCron({
    enabled: cfg.readOn,
    authorized: !!db,
    syncAll: async () => {
      const store = createStore(db);
      const ids = await store.listWorkspaces();
      let done = 0;
      for (const workspaceId of ids) {
        try {
          await syncConnection({ store, key: cfg.key, workspaceId });
          done += 1;
        } catch (err) {
          console.error('[email] cron_read', err?.code || 'imap_read_failed');
        }
      }
      return done;
    },
  });
}

const ROUTES = {
  mailbox: onMailbox,
  'test-imap': req => onTest(req, 'imap'),
  'test-smtp': req => onTest(req, 'smtp'),
  sync: onSync,
  status: onStatus,
  approve: onApprove,
  send: onSend,
  triage: onTriage,
  'cron-sync': onCron,
};

export async function dispatch(req, res) {
  const action = String(req.query?.action || '');
  const handler = ROUTES[action];
  if (!handler) return json(res, 404, { ok: false, code: 'method' });
  try {
    const body = await handler(req);
    if (!body) return json(res, 405, { ok: false, code: 'method' });
    return json(res, 200, body);
  } catch (err) {
    const code = HTTP_STATUS[err?.code] ? err.code : 'email_failed';
    console.error('[email]', action, code);
    const payload = { ok: false, code, sent: false };
    if (Array.isArray(err?.fields)) payload.fields = err.fields;
    return json(res, HTTP_STATUS[code] || 500, payload);
  }
}
