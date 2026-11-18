import { ENV } from '../../shared/mailbox.js';
import { approvalFromDraft } from '../core/email-mailbox.js';
import { tr } from '../core/i18n.js';
import { S, deal } from '../core/store.js';
import { emailApi } from '../data/email-api.js';
import { ctx } from '../data/supabase.js';
import { render } from '../shell/render.js';
import { A } from './actions.js';
import { toast } from '../ui/toast.js';

let inflight = null;

function workspaceId() {
  return ctx.wsId || '';
}

function applyReport(payload, extra = {}) {
  const mail = S.ui.mail || {};
  S.ui.mail = {
    ...mail,
    ...extra,
    loaded: true,
    loading: false,
    busy: '',
    sendingEnabled: payload.sendingEnabled === true,
    readSyncEnabled: payload.readSyncEnabled === true,
    mailbox: payload.mailbox || null,
    status: payload.status || null,
    latest: payload.latest || [],
    matched: payload.matched || [],
    approvals: payload.approvals || [],
  };
}

export function mailErrorText(code, fields = []) {
  if (code === 'schema_missing') return tr('Apply the mailbox migration, then reload.');
  if (code === 'missing_key')
    return tr('Set {name} on the server before saving the password. It is a 32-byte key, base64, and it is not the mailbox password.', {
      name: ENV.credentialsKey,
    });
  if (code === 'missing_server_config') return tr('Set {name} on the server. Do not put it in a VITE_ variable.', { name: ENV.supabaseSecret });
  if (code === 'email_api_unavailable') return tr('The mailbox API runs on the deployed site. npm run dev does not serve it.');
  if (code === 'admin_required') return tr('Only an owner or an admin can change the connection.');
  if (code === 'auth_required') return tr('Sign in again to use the mailbox.');
  if (code === 'forbidden') return tr("You don't have access");
  if (code === 'not_configured') return tr('Save the mailbox password before this.');
  if (code === 'password_required' || (code === 'invalid_input' && fields.includes('password')))
    return tr('Enter the mailbox password. Leave it blank only after one is already saved.');
  if (code === 'invalid_input') return tr('Use imap.hostinger.com port 993 and smtp.hostinger.com port 465, with SSL/TLS.');
  if (code === 'imap_login_failed') return tr('IMAP login failed. Nothing was sent.');
  if (code === 'smtp_login_failed') return tr('SMTP login failed. Nothing was sent.');
  if (code === 'imap_read_failed') return tr('Could not read the mailbox. Nothing was sent, and no lead stage changed.');
  if (code === 'sending_disabled') return tr('Sending is off. Nothing was sent.');
  if (code === 'approval_required') return tr('This message has no approval yet. Nothing was sent.');
  if (code === 'not_an_email') return tr('This version is a LinkedIn note, not an email.');
  if (code === 'missing_recipient') return tr('This draft has no recipient email yet.');
  if (code === 'no_draft') return tr('No email draft on this lead yet.');
  return tr('The mailbox request failed. Nothing was sent.');
}

function formValues() {
  const read = id => document.getElementById(id)?.value ?? '';
  return {
    workspaceId: workspaceId(),
    address: read('mail-address').trim(),
    username: read('mail-username').trim(),
    password: document.getElementById('mail-password')?.value ?? '',
    imapHost: read('mail-imap-host').trim(),
    imapPort: Number(read('mail-imap-port')),
    smtpHost: read('mail-smtp-host').trim(),
    smtpPort: Number(read('mail-smtp-port')),
  };
}

function fail(payload) {
  const mail = S.ui.mail || {};
  S.ui.mail = {
    ...mail,
    loaded: true,
    loading: false,
    busy: '',
    error: payload.code || 'email_failed',
    errorText: mailErrorText(payload.code, payload.fields || []),
    notice: '',
  };
  render();
}

export function loadMailbox() {
  if (inflight) return inflight;
  const id = workspaceId();
  if (!id) {
    fail({ code: 'auth_required' });
    return Promise.resolve();
  }
  inflight = emailApi('status', { query: { workspaceId: id } })
    .then(payload => {
      if (!payload.ok) {
        fail(payload);
        return;
      }
      applyReport(payload, { error: '', errorText: '', notice: S.ui.mail?.notice || '' });
      render();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function run(busy, work, success) {
  S.ui.mail = { ...(S.ui.mail || {}), busy, error: '', errorText: '' };
  render();
  const payload = await work();
  if (!payload?.ok) {
    fail(payload || { code: 'email_failed' });
    toast(mailErrorText(payload?.code, payload?.fields), { kind: 'err' });
    return;
  }
  if (payload.mailbox || payload.latest || payload.status) {
    applyReport(payload, { error: '', errorText: '', notice: success });
    render();
  } else {
    S.ui.mail = { ...(S.ui.mail || {}), notice: success, busy: '', error: '', errorText: '' };
    await loadMailbox();
  }
  if (success) toast(success);
}

A.saveMailbox = () => {
  const body = formValues();
  return run('save', () => emailApi('mailbox', { method: 'PUT', body }), tr('Connection saved. The password is not shown again. Nothing was sent.'));
};

A.testImap = () => {
  const body = formValues();
  return run('imap', () => emailApi('test-imap', { method: 'POST', body }), tr('IMAP login succeeded. Nothing was sent.'));
};

A.testSmtp = () => {
  const body = formValues();
  return run('smtp', () => emailApi('test-smtp', { method: 'POST', body }), tr('SMTP login succeeded. Nothing was sent.'));
};

A.syncMailbox = () =>
  run(
    'sync',
    () => emailApi('sync', { method: 'POST', body: { workspaceId: workspaceId() } }),
    tr('Mailbox read. No message was marked read, and no lead stage changed.'),
  );

A.dismissTriage = el =>
  run(
    'triage',
    () => emailApi('triage', { method: 'POST', body: { workspaceId: workspaceId(), messageId: el.dataset.id } }),
    tr('Triage dismissed. The lead stage was not changed.'),
  );

if (typeof window !== 'undefined') window.addEventListener('dash:mail-load', () => void loadMailbox());

A.reloadMailbox = () => {
  S.ui.mail = { ...(S.ui.mail || {}), loaded: false, loading: false, error: '', errorText: '' };
  return loadMailbox();
};

A.approveEmailDraft = el => {
  const row = deal(el.dataset.id);
  if (!row) return;
  const chosen = S.ui.draftTab?.[row.id] || '';
  const approval = approvalFromDraft(row.draft, chosen);
  if (!approval.ok) {
    toast(mailErrorText(approval.code), { kind: 'err' });
    return;
  }
  return run(
    'approve',
    () =>
      emailApi('approve', {
        method: 'POST',
        body: {
          workspaceId: workspaceId(),
          dealId: row.id,
          toEmail: approval.toEmail,
          subject: approval.subject,
          body: approval.body,
          channel: approval.channel,
        },
      }),
    tr('Approval recorded. Nothing was sent.'),
  );
};
