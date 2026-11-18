import { MAILBOX_DEFAULTS, ENV, MAILBOX_MIGRATION } from '../../shared/mailbox.js';
import { esc, ago } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr, trn } from '../core/i18n.js';
import { S, crmStage, isAdmin } from '../core/store.js';
import { stageLabel } from '../core/crm.js';

const val = (id, fallback) => {
  const node = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (node && document.activeElement === node) return node.value;
  return fallback;
};

function field(id, label, value, opts = {}) {
  const attrs = [
    opts.readOnly ? 'readonly' : '',
    opts.disabled ? 'disabled' : '',
    opts.auto ? `autocomplete="${opts.auto}"` : 'autocomplete="off"',
    opts.spell === false ? 'spellcheck="false"' : '',
    opts.inputmode ? `inputmode="${opts.inputmode}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<label class="mail-field ${opts.wide ? 'wide' : ''}"><span>${esc(label)}</span><input class="input" id="${id}" type="${opts.type || 'text'}" value="${esc(value ?? '')}" ${attrs}></label>`;
}

function when(iso) {
  const ts = Date.parse(iso || '');
  return Number.isNaN(ts) ? '—' : ago(ts);
}

export function pageCrmEmail() {
  if (!S.ui.mail?.loaded && !S.ui.mail?.loading) {
    S.ui.mail = { loading: true, error: '', notice: '', latest: [], matched: [], approvals: [], sendingEnabled: false };
    if (typeof window !== 'undefined') queueMicrotask(() => window.dispatchEvent(new Event('dash:mail-load')));
  }
  const mail = S.ui.mail || {};
  if (mail.loading && !mail.loaded) {
    return `<div class="mail-wrap"><p class="mail-note">${esc(tr('Loading mailbox…'))}</p></div>`;
  }
  return `<div class="mail-wrap">
    ${banner(mail)}
    ${settings(mail)}
    ${status(mail)}
    ${replies(mail)}
    ${sending(mail)}
  </div>`;
}

function banner(mail) {
  if (mail.error === 'schema_missing') {
    return `<section class="panel mail-card"><h2>${esc(tr('Email settings'))}</h2><p>${esc(tr('Apply {migration}, then reload. The lead stages and drafts stay as they are.', { migration: MAILBOX_MIGRATION }))}</p><button class="btn btn-secondary btn-sm" data-a="reloadMailbox">${esc(tr('Try again'))}</button></section>`;
  }
  if (mail.error === 'email_api_unavailable') {
    return `<section class="panel mail-card"><h2>${esc(tr('Email settings'))}</h2><p>${esc(tr('The mailbox API runs on the deployed site. npm run dev does not serve it.'))}</p><button class="btn btn-secondary btn-sm" data-a="reloadMailbox">${esc(tr('Try again'))}</button></section>`;
  }
  return '';
}

function settings(mail) {
  if (mail.error === 'schema_missing' || mail.error === 'email_api_unavailable') return '';
  const saved = mail.mailbox;
  const admin = isAdmin();
  const address = val('mail-address', saved?.address || MAILBOX_DEFAULTS.address);
  const username = val('mail-username', saved?.username || MAILBOX_DEFAULTS.username);
  const imapHost = val('mail-imap-host', saved?.imap?.host || MAILBOX_DEFAULTS.imapHost);
  const imapPort = val('mail-imap-port', String(saved?.imap?.port || MAILBOX_DEFAULTS.imapPort));
  const smtpHost = val('mail-smtp-host', saved?.smtp?.host || MAILBOX_DEFAULTS.smtpHost);
  const smtpPort = val('mail-smtp-port', String(saved?.smtp?.port || MAILBOX_DEFAULTS.smtpPort));
  const busy = mail.busy;
  return `<section class="panel mail-card" aria-labelledby="mail-h">
    <div class="panel-h"><h2 id="mail-h">${esc(tr('Email settings'))}</h2></div>
    <p class="mail-note">${esc(tr('Connect {address}. The password is encrypted before it is stored and is never shown again.', { address: MAILBOX_DEFAULTS.address }))}</p>
    <div class="mail-grid">
      ${field('mail-address', tr('Mailbox address'), address, { disabled: !admin, spell: false, auto: 'off' })}
      ${field('mail-username', tr('Username'), username, { disabled: !admin, spell: false, auto: 'off' })}
      <label class="mail-field wide"><span>${esc(tr('Password'))}</span>
        ${admin ? `<input class="input" id="mail-password" type="password" autocomplete="new-password" spellcheck="false" placeholder="${esc(saved?.hasPassword ? tr('Saved. Leave blank to keep it.') : '')}">` : `<input class="input" type="password" value="" disabled placeholder="${esc(tr('Only an owner or an admin can change it.'))}">`}
      </label>
      ${field('mail-imap-host', tr('IMAP host'), imapHost, { disabled: !admin, spell: false })}
      ${field('mail-imap-port', tr('IMAP port'), imapPort, { disabled: !admin, inputmode: 'numeric' })}
      <p class="mail-field"><span>${esc(tr('IMAP security'))}</span><span class="badge">${esc(tr('SSL/TLS'))}</span></p>
      ${field('mail-smtp-host', tr('SMTP host'), smtpHost, { disabled: !admin, spell: false })}
      ${field('mail-smtp-port', tr('SMTP port'), smtpPort, { disabled: !admin, inputmode: 'numeric' })}
      <p class="mail-field"><span>${esc(tr('SMTP security'))}</span><span class="badge">${esc(tr('SSL/TLS'))}</span></p>
    </div>
    <p class="mail-note">${esc(tr('POP3 {host}:{port} is informational. The CRM does not connect to it.', { host: MAILBOX_DEFAULTS.pop3Host, port: MAILBOX_DEFAULTS.pop3Port }))}</p>
    <p class="mail-note">${saved?.hasPassword ? esc(tr('A password is saved for this workspace.')) : esc(tr('No password saved yet.'))}</p>
    ${mail.error && mail.error !== 'schema_missing' ? `<p class="mail-error" role="alert">${esc(mail.errorText || mail.error)}</p>` : ''}
    ${mail.notice ? `<p class="mail-ok" role="status">${esc(mail.notice)}</p>` : ''}
    <div class="mail-actions">
      ${admin ? `<button class="btn btn-primary btn-sm" data-a="saveMailbox" ${busy ? 'disabled' : ''}>${esc(tr('Save connection'))}</button>` : ''}
      <button class="btn btn-secondary btn-sm" data-a="testImap" ${busy ? 'disabled' : ''}>${esc(tr('Test IMAP'))}</button>
      <button class="btn btn-secondary btn-sm" data-a="testSmtp" ${busy ? 'disabled' : ''}>${esc(tr('Test SMTP'))}</button>
    </div>
    ${admin ? '' : `<p class="mail-note">${esc(tr('Only an owner or an admin can change the connection. You can still test it and read the mailbox.'))}</p>`}
  </section>`;
}

function status(mail) {
  if (!mail.loaded || mail.error === 'schema_missing') return '';
  const total = mail.status?.total;
  const unseen = mail.status?.unseen;
  return `<section class="panel mail-card">
    <div class="panel-h"><h2>${esc(tr('Mailbox'))}</h2>
      <button class="btn btn-secondary btn-sm" data-a="syncMailbox" ${mail.busy ? 'disabled' : ''}>${ic('refresh-cw', 14)}${esc(tr('Read mailbox'))}</button>
    </div>
    <div class="mail-stats">
      <div class="stat"><span class="k">${esc(tr('Total messages'))}</span><span class="v">${total == null ? '—' : esc(String(total))}</span></div>
      <div class="stat"><span class="k">${esc(tr('Unread'))}</span><span class="v">${unseen == null ? '—' : esc(String(unseen))}</span></div>
      <div class="stat"><span class="k">${esc(tr('Last read'))}</span><span class="v">${esc(mail.status?.lastSyncAt ? when(mail.status.lastSyncAt) : tr('Not read yet'))}</span></div>
    </div>
    ${mail.status?.lastError ? `<p class="mail-error">${esc(tr('Last read failed ({code}). Nothing was sent, and no lead stage changed.', { code: mail.status.lastError }))}</p>` : ''}
    <p class="mail-note">${esc(tr('Reading uses IMAP examine and BODY.PEEK. Messages are not marked read, moved, or deleted.'))}</p>
    ${
      (mail.latest || []).length
        ? `<ul class="mail-list">${mail.latest.map(message => messageRow(message)).join('')}</ul>`
        : `<p class="mail-note">${esc(tr('No messages copied yet. Read the mailbox after the password is saved.'))}</p>`
    }
  </section>`;
}

function messageRow(message) {
  const who = message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail || tr('Unknown sender');
  const deals = (message.deals || []).map(deal => deal.title || tr('Deal')).join(', ');
  return `<li class="mail-msg">
    <div class="mail-msg-h"><b class="trunc">${esc(message.subject || tr('No subject'))}</b><span class="faint">${esc(when(message.receivedAt))}</span></div>
    <div class="mail-note">${esc(who)}${message.serverSeen ? ` · ${esc(tr('Seen on the server'))}` : ` · ${esc(tr('Unread on the server'))}`}</div>
    ${message.snippet ? `<p class="mail-snippet">${esc(message.snippet)}</p>` : ''}
    ${deals ? `<div class="mail-note">${esc(tr('Matched to {deals}. The stage was not changed.', { deals }))}</div>` : ''}
    ${message.needsTriage ? `<button class="btn btn-ghost btn-sm" data-a="dismissTriage" data-id="${esc(message.id)}">${esc(tr('Dismiss triage'))}</button>` : ''}
  </li>`;
}

function replies(mail) {
  if (!mail.loaded || mail.error === 'schema_missing') return '';
  const rows = mail.matched || [];
  return `<section class="panel mail-card">
    <div class="panel-h"><h2>${esc(tr('Replies for triage'))}</h2></div>
    <p class="mail-note">${esc(tr('A match links the sender, or In-Reply-To and References, to a lead. It does not move the lead to another stage.'))}</p>
    ${
      rows.length
        ? `<ul class="mail-list">${rows
            .map(message => {
              const links = (message.deals || [])
                .map(deal => {
                  const stage = stageLabel(crmStage(deal.stageId));
                  return `<button class="link" data-a="openDeal" data-id="${esc(deal.id)}">${esc(deal.title || tr('Deal'))}</button>${stage ? ` <span class="faint">${esc(stage)}</span>` : ''}`;
                })
                .join(', ');
              return `<li class="mail-msg"><div class="mail-msg-h"><b class="trunc">${esc(message.subject || tr('No subject'))}</b><span class="faint">${esc(when(message.receivedAt))}</span></div>
                <div class="mail-note">${esc(message.fromEmail || '')}</div>
                ${message.snippet ? `<p class="mail-snippet">${esc(message.snippet)}</p>` : ''}
                <div class="mail-note">${links || esc(tr('Matched to a contact, with no lead yet.'))}</div>
              </li>`;
            })
            .join('')}</ul>`
        : `<p class="mail-note">${esc(tr('No reply matched to a lead yet.'))}</p>`
    }
  </section>`;
}

function sending(mail) {
  if (!mail.loaded || mail.error === 'schema_missing') return '';
  return `<section class="panel mail-card">
    <div class="panel-h"><h2>${esc(tr('Sending'))}</h2>${mail.sendingEnabled ? `<span class="badge amber">${esc(tr('Sending on'))}</span>` : `<span class="badge">${esc(tr('Sending off'))}</span>`}</div>
    <p class="mail-note">${esc(tr('Sending is off unless {name} is the exact text true. Approving a draft records the approval and does not send it. No job sends mail.', { name: ENV.sendingEnabled }))}</p>
    <p class="mail-note">${esc(trn('{n} approval recorded in this workspace.', '{n} approvals recorded in this workspace.', (mail.approvals || []).length))}</p>
  </section>`;
}

export function dealReplySection(deal) {
  const mail = S.ui.mail;
  const replies = (mail?.matched || []).filter(message => (message.deals || []).some(row => row.id === deal.id));
  const approvals = (mail?.approvals || []).filter(row => row.dealId === deal.id);
  const open = approvals.find(row => !row.consumedAt);
  return `<div class="dsec">
    <div class="dsec-h"><h3>${esc(tr('Mailbox replies'))}</h3><button class="btn btn-ghost btn-sm" data-a="go" data-r="crm" data-tab="email">${esc(tr('Email settings'))}</button></div>
    <p class="faint" style="font-size:12.5px">${esc(tr('Replies matched to this lead. The stage was not changed.'))}</p>
    ${
      replies.length
        ? replies
            .map(
              message =>
                `<article class="mail-reply"><b>${esc(message.subject || tr('No subject'))}</b><div class="faint">${esc(message.fromEmail || '')} · ${esc(when(message.receivedAt))}</div>${message.snippet ? `<p>${esc(message.snippet)}</p>` : ''}</article>`,
            )
            .join('')
        : `<p class="faint" style="font-size:12.5px">${esc(tr('No reply matched to this lead yet.'))}</p>`
    }
    ${open ? `<p class="faint" style="font-size:12.5px">${esc(tr('This version is approved for sending. Nothing was sent.'))}</p>` : `<button class="btn btn-secondary btn-sm" data-a="approveEmailDraft" data-id="${esc(deal.id)}">${esc(tr('Approve this version for sending'))}</button>`}
  </div>`;
}
