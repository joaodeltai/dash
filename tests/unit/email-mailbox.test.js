import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approvalFromDraft } from '../../src/core/email-mailbox.js';
import { TABLES } from '../../src/data/mappers.js';
import { MAILBOX_DEFAULTS, ENV } from '../../shared/mailbox.js';
import { parseKey, decryptPassword, encryptPassword, secretEquals } from '../../server/email/crypto.js';
import { assertWritable } from '../../server/email/errors.js';
import { deliverApproved, readSyncEnabled, runReadCron, sendDecision, sendingEnabled } from '../../server/email/gates.js';
import { FETCH_QUERY, READ_ONLY, normalizeFetched, readInbox, testImapLogin } from '../../server/email/imap-read.js';
import { matchInbound, normalizeEmail, normalizeMessageId } from '../../server/email/match.js';
import { buildSyncPlan, SYNC_WRITES } from '../../server/email/plan.js';
import { testSmtpLogin } from '../../server/email/smtp-check.js';
import { DEAL_LOOKUP } from '../../server/email/store.js';
import { checkMailboxInput } from '../../server/email/validate.js';
import { shapeReport } from '../../server/email/view.js';
import { sendConnection } from '../../server/email/operations.js';

const root = new URL('../..', import.meta.url);

describe('mailbox defaults', () => {
  it('suggests the Hostinger commercial mailbox and leaves the password out', () => {
    expect(MAILBOX_DEFAULTS).toMatchObject({
      address: 'contato@grupodeltai.com.br',
      username: 'contato@grupodeltai.com.br',
      imapHost: 'imap.hostinger.com',
      imapPort: 993,
      smtpHost: 'smtp.hostinger.com',
      smtpPort: 465,
      pop3Host: 'pop.hostinger.com',
      pop3Port: 995,
    });
    expect(MAILBOX_DEFAULTS.password).toBeUndefined();
    expect(ENV.credentialsKey).toBe('EMAIL_CREDENTIALS_KEY');
    expect(ENV.sendingEnabled).toBe('EMAIL_SENDING_ENABLED');
    expect(ENV.supabaseSecret).toBe('SUPABASE_SECRET_KEY');
  });
});

describe('password encryption', () => {
  const key = parseKey(Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'));

  it('rejects a missing or short master key and round-trips the password', () => {
    expect(parseKey('')).toBeNull();
    expect(parseKey(Buffer.from('short').toString('base64'))).toBeNull();
    const stored = encryptPassword('senha-da-caixa', key);
    expect(stored.ciphertext).not.toContain('senha-da-caixa');
    expect(decryptPassword(stored, key)).toBe('senha-da-caixa');
    const other = parseKey(Buffer.from('abcdef0123456789abcdef0123456789').toString('base64'));
    expect(() => decryptPassword(stored, other)).toThrow();
  });

  it('compares cron secrets without treating an empty value as a match', () => {
    expect(secretEquals('', '')).toBe(false);
    expect(secretEquals('abc', 'abcd')).toBe(false);
    expect(secretEquals('cron-secret', 'cron-secret')).toBe(true);
  });
});

describe('connection checks', () => {
  it('accepts only the Hostinger SSL endpoints', () => {
    const value = checkMailboxInput(
      {
        address: 'contato@grupodeltai.com.br',
        username: 'contato@grupodeltai.com.br',
        password: 'x',
        imapHost: 'imap.hostinger.com',
        imapPort: 993,
        smtpHost: 'smtp.hostinger.com',
        smtpPort: 465,
      },
      { requirePassword: true },
    );
    expect(value.imapHost).toBe('imap.hostinger.com');
    expect(() =>
      checkMailboxInput(
        { address: 'a@b.co', username: 'a@b.co', password: 'x', imapHost: '127.0.0.1', imapPort: 993, smtpHost: 'smtp.hostinger.com', smtpPort: 465 },
        { requirePassword: true },
      ),
    ).toThrow(/invalid_input/);
    expect(() =>
      checkMailboxInput(
        {
          address: 'contato@grupodeltai.com.br',
          username: 'contato@grupodeltai.com.br',
          password: '',
          imapHost: 'imap.hostinger.com',
          imapPort: 993,
          smtpHost: 'smtp.hostinger.com',
          smtpPort: 465,
        },
        { requirePassword: true },
      ),
    ).toThrow(/invalid_input/);
  });
});

describe('matching replies', () => {
  const contacts = [{ id: 'c1', email: 'Ana@Cliente.com' }];
  const deals = [{ id: 'd1', contact_id: 'c1', title: 'Rolagem' }];
  const sent = [{ deal_id: 'd2', contact_id: 'c9', rfc_message_id: '<outbound@grupodeltai.com.br>' }];

  it('matches the sender to the lead and a reply header to the sent message', () => {
    expect(normalizeEmail('Ana Souza <Ana@Cliente.com>')).toBe('ana@cliente.com');
    expect(normalizeMessageId('<Outbound@GrupoDeltai.com.br>')).toBe('outbound@grupodeltai.com.br');
    const bySender = matchInbound({ fromEmail: 'ana@cliente.com', inReplyTo: '', references: [] }, { contacts, deals, sent });
    expect(bySender).toEqual([{ dealId: 'd1', contactId: 'c1', reason: 'from_email' }]);
    const byHeader = matchInbound(
      { fromEmail: 'other@x.com', inReplyTo: '<outbound@grupodeltai.com.br>', references: ['<older@x>'] },
      { contacts, deals, sent },
    );
    expect(byHeader).toEqual([{ dealId: 'd2', contactId: 'c9', reason: 'in_reply_to' }]);
    const byRef = matchInbound({ fromEmail: '', inReplyTo: '', references: ['outbound@grupodeltai.com.br'] }, { contacts, deals, sent });
    expect(byRef[0].reason).toBe('references');
  });
});

describe('send gates', () => {
  it('stays off unless the flag is the exact string true and the approval is unused', () => {
    expect(sendingEnabled({})).toBe(false);
    expect(sendingEnabled({ EMAIL_SENDING_ENABLED: 'false' })).toBe(false);
    expect(sendingEnabled({ EMAIL_SENDING_ENABLED: 'TRUE' })).toBe(false);
    expect(sendingEnabled({ EMAIL_SENDING_ENABLED: 'true' })).toBe(true);
    expect(readSyncEnabled({})).toBe(false);
    expect(sendDecision({ enabled: false, approval: { id: 'a' } })).toMatchObject({ ok: false, sent: false, code: 'sending_disabled' });
    expect(sendDecision({ enabled: true, approval: null })).toMatchObject({ code: 'approval_required', sent: false });
    expect(sendDecision({ enabled: true, approval: { id: 'a', consumed_at: '2026-11-18' } })).toMatchObject({ code: 'approval_used' });
    expect(sendDecision({ enabled: true, approval: { id: 'a', consumed_at: null } }).ok).toBe(true);
  });

  it('does not call the transport when sending is off', async () => {
    let called = false;
    const result = await deliverApproved({
      enabled: false,
      approval: { id: 'a', to_email: 'a@b.co', subject: 'oi', body: 'texto' },
      transport: {
        send: () => {
          called = true;
        },
      },
    });
    expect(result).toMatchObject({ ok: false, sent: false, code: 'sending_disabled' });
    expect(called).toBe(false);
  });

  it('does not open SMTP from sendConnection while the flag is off', async () => {
    let opened = false;
    const result = await sendConnection({
      enabled: false,
      workspaceId: 'ws',
      approvalId: 'ap',
      key: null,
      createTransport: () => {
        opened = true;
        return { sendMail: () => Promise.reject(new Error('should not send')), close() {} };
      },
      store: {
        getApproval: async () => ({ id: 'ap', to_email: 'a@b.co', subject: 's', body: 'b', consumed_at: null }),
        getMailbox: async () => {
          throw new Error('should not read the mailbox');
        },
        getSecret: async () => {
          throw new Error('should not read the secret');
        },
      },
    });
    expect(result.sent).toBe(false);
    expect(opened).toBe(false);
  });
});

describe('read only sync', () => {
  it('plans inbox rows and never a deal write', () => {
    const plan = buildSyncPlan({
      fetched: {
        total: 4,
        unseen: 2,
        uidValidity: 3,
        messages: [{ imapUid: 8, fromEmail: 'ana@cliente.com', inReplyTo: '', references: [], subject: 'oi' }],
      },
      crm: { contacts: [{ id: 'c1', email: 'ana@cliente.com' }], deals: [{ id: 'd1', contact_id: 'c1' }], sent: [] },
      existing: [],
    });
    expect(plan.writes).toEqual(SYNC_WRITES);
    expect(plan.writes).not.toContain('crm_deals');
    expect(plan.messages[0].needsTriage).toBe(true);
    expect(plan.messages[0].links[0]).toMatchObject({ dealId: 'd1', reason: 'from_email' });
    const again = buildSyncPlan({
      fetched: { total: 4, unseen: 2, uidValidity: 3, messages: [{ imapUid: 8, fromEmail: 'ana@cliente.com', references: [] }] },
      crm: { contacts: [{ id: 'c1', email: 'ana@cliente.com' }], deals: [{ id: 'd1', contact_id: 'c1' }], sent: [] },
      existing: [{ imapUid: 8, uidValidity: 3, needsTriage: false }],
    });
    expect(again.messages[0].needsTriage).toBe(false);
  });

  it('opens IMAP read-only and fetches with the peek query', async () => {
    const calls = [];
    const client = {
      async connect() {
        calls.push('connect');
      },
      async status() {
        return { messages: 1, unseen: 1, uidValidity: 5 };
      },
      async getMailboxLock(path, options) {
        calls.push(['lock', path, options]);
        return {
          release() {
            calls.push('release');
          },
        };
      },
      async search() {
        return [4];
      },
      async *fetch(uids, query, options) {
        calls.push(['fetch', uids, query, options]);
        yield {
          uid: 4,
          envelope: {
            from: [{ address: 'ana@cliente.com', name: 'Ana' }],
            subject: 'Re',
            date: '2026-11-18T12:00:00.000Z',
            messageId: '<a@b>',
            inReplyTo: '<s@b>',
          },
          flags: new Set(['\\Seen']),
          headers: Buffer.from('References: <s@b> <older@b>\r\n'),
          bodyParts: new Map([['TEXT', Buffer.from('obrigado')]]),
        };
      },
      async logout() {
        calls.push('logout');
      },
      close() {
        calls.push('close');
      },
    };
    const box = await readInbox({ host: 'imap.hostinger.com', port: 993, user: 'u', password: 'p' }, { createClient: () => client });
    expect(box.total).toBe(1);
    expect(box.messages[0]).toMatchObject({ fromEmail: 'ana@cliente.com', serverSeen: true, snippet: 'obrigado', inReplyTo: 's@b' });
    expect(calls).toContainEqual(['lock', 'INBOX', READ_ONLY]);
    expect(calls).toContainEqual(['fetch', [4], FETCH_QUERY, { uid: true }]);
    expect(JSON.stringify(calls)).not.toMatch(/messageFlagsAdd|messageDelete|messageMove|setFlags/);
    const login = [];
    await testImapLogin(
      {},
      {
        createClient: () => ({
          async connect() {
            login.push('connect');
          },
          async logout() {
            login.push('logout');
          },
          close() {},
        }),
      },
    );
    expect(login).toEqual(['connect', 'logout']);
  });

  it('tests SMTP with verify and does not send', async () => {
    const calls = [];
    await testSmtpLogin(
      {},
      {
        createTransport: () => ({
          async verify() {
            calls.push('verify');
          },
          sendMail() {
            calls.push('send');
          },
          close() {
            calls.push('close');
          },
        }),
      },
    );
    expect(calls).toEqual(['verify', 'close']);
  });

  it('normalizes a peeked header without storing a password', () => {
    const row = normalizeFetched({ uid: 1, envelope: { from: [{ address: 'a@b.co' }] }, flags: new Set(), headers: Buffer.from('References: <m@x>\r\n') });
    expect(row.references).toEqual(['m@x']);
    expect(row.password).toBeUndefined();
  });
});

describe('public report and schema guards', () => {
  it('omits the ciphertext and the password from the status payload', () => {
    const report = shapeReport({
      mailbox: {
        address: 'contato@grupodeltai.com.br',
        username: 'contato@grupodeltai.com.br',
        imap_host: 'imap.hostinger.com',
        imap_port: 993,
        smtp_host: 'smtp.hostinger.com',
        smtp_port: 465,
        ciphertext: 'cipher-text',
        password: 'plain-secret',
      },
      hasPassword: true,
      status: { total_messages: 3, unseen_messages: 1, last_sync_at: null, last_error: '' },
      latestMessages: [
        { id: 'm1', from_email: 'ana@cliente.com', from_name: 'Ana', subject: 'Re', snippet: 'oi', received_at: null, server_seen: false, needs_triage: true },
      ],
      messages: [
        { id: 'm1', from_email: 'ana@cliente.com', from_name: 'Ana', subject: 'Re', snippet: 'oi', received_at: null, server_seen: false, needs_triage: true },
      ],
      links: [{ message_id: 'm1', deal_id: 'd1', contact_id: 'c1', match_reason: 'from_email' }],
      deals: [{ id: 'd1', title: 'Rolagem', stage_id: 's1' }],
      contacts: [{ id: 'c1', name: 'Ana', email: 'ana@cliente.com' }],
      approvals: [],
      sendingOn: false,
      readOn: false,
    });
    const raw = JSON.stringify(report);
    expect(raw).not.toContain('cipher-text');
    expect(raw).not.toContain('plain-secret');
    expect(raw).not.toContain('ciphertext');
    expect(report.sendingEnabled).toBe(false);
    expect(report.sent).toBe(false);
    expect(report.status).toMatchObject({ total: 3, unseen: 1 });
    expect(report.matched[0].deals[0]).toMatchObject({ id: 'd1', title: 'Rolagem', stageId: 's1' });
    expect(report.mailbox.pop3).toMatchObject({ host: 'pop.hostinger.com', port: 995, used: false });
  });

  it('refuses to write a lead, a draft, or an activity', () => {
    expect(() => assertWritable('crm_deals')).toThrow(/refused_write/);
    expect(() => assertWritable('crm_activities')).toThrow(/refused_write/);
    expect(() => assertWritable('email_draft')).toThrow(/refused_write/);
    expect(DEAL_LOOKUP.split(',').map(part => part.trim())).toEqual(['id', 'title', 'stage_id', 'contact_id']);
    expect(TABLES.map(table => table.name).some(name => name.startsWith('crm_mail') || name.startsWith('crm_inbox') || name === 'crm_email_approvals')).toBe(
      false,
    );
  });

  it('keeps the read cron and the migration away from sending and from email_draft', () => {
    const read = file => readFileSync(new URL(file, root), 'utf8');
    const dispatch = read('server/email/dispatch.js');
    const cron = dispatch.slice(dispatch.indexOf('async function onCron'), dispatch.indexOf('const ROUTES'));
    expect(cron).not.toMatch(/sendConnection|sendMail|deliverApproved/);
    expect(cron).toMatch(/syncConnection/);
    const ops = read('server/email/operations.js');
    const sync = ops.slice(ops.indexOf('export async function syncConnection'), ops.indexOf('export async function recordApproval'));
    expect(sync).not.toMatch(/deliverApproved|sendMail|email_draft|stage_id/);
    const store = read('server/email/store.js');
    expect(store).not.toMatch(/email_draft/);
    expect(store).not.toMatch(/from\('crm_deals'\)[\s\S]{0,120}\.(update|upsert|delete)/);
    const sql = read('supabase/migrations/20261118183000_crm_mailbox.sql');
    expect(sql.toLowerCase()).not.toContain('email_draft');
    expect(sql).not.toMatch(/update\s+public\.crm_deals/i);
    expect(sql).not.toMatch(/pg_cron|net\.http_post|cron\.schedule/i);
    expect(sql).toMatch(/force row level security/i);
    expect(sql).not.toMatch(/password\s+(text|bytea)/i);
    const imap = read('server/email/imap-read.js');
    expect(imap).toContain('readOnly: true');
    expect(imap).not.toMatch(/messageFlagsAdd|messageDelete|messageMove|setFlags/);
    expect(read('node_modules/imapflow/lib/commands/fetch.js')).toContain('.PEEK');
    expect(read('node_modules/nodemailer/lib/smtp-transport/index.js')).toMatch(/connection\.login/);
    const verify = read('node_modules/nodemailer/lib/smtp-transport/index.js');
    const verifyFn = verify.slice(verify.indexOf('verify(callback)'), verify.indexOf('verify(callback)') + 1800);
    expect(verifyFn).not.toMatch(/sendMail|MAIL FROM/i);
  });
});

describe('draft approval', () => {
  it('copies the chosen version and does not change the draft', () => {
    const draft = {
      assunto: 'Assunto A',
      corpo: 'Corpo A',
      email_decisor: 'ana@cliente.com',
      versao_ativa: 'A',
      versoes: [
        { rotulo: 'A', assunto: 'Assunto A', corpo: 'Corpo A', canal: 'email' },
        { rotulo: 'B', assunto: '', corpo: 'Nota', canal: 'linkedin' },
      ],
    };
    const before = JSON.stringify(draft);
    expect(approvalFromDraft(draft, 'A')).toMatchObject({ ok: true, sent: false, toEmail: 'ana@cliente.com', subject: 'Assunto A', body: 'Corpo A' });
    expect(approvalFromDraft(draft, 'B')).toMatchObject({ ok: false, code: 'not_an_email' });
    expect(approvalFromDraft({ ...draft, email_decisor: '[FALTA: e-mail do decisor]' }, 'A')).toMatchObject({ code: 'missing_recipient' });
    expect(JSON.stringify(draft)).toBe(before);
  });
});

describe('read cron', () => {
  it('skips the read when the flag is off and never reports a send', async () => {
    let ran = false;
    const skipped = await runReadCron({
      enabled: false,
      authorized: true,
      syncAll: async () => {
        ran = true;
        return 1;
      },
    });
    expect(skipped).toEqual({ ok: true, skipped: true, sent: false, mailboxes: 0 });
    expect(ran).toBe(false);
    const done = await runReadCron({ enabled: true, authorized: true, syncAll: async () => 2 });
    expect(done).toMatchObject({ ok: true, skipped: false, sent: false, mailboxes: 2 });
    await expect(runReadCron({ enabled: true, authorized: false, syncAll: async () => 1 })).rejects.toMatchObject({ code: 'auth_required' });
  });
});
