import { MAILBOX_DEFAULTS } from '../../shared/mailbox.js';
import { fail } from './errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkMailboxInput(input, { requirePassword }) {
  const fields = [];
  const address = String(input?.address || '')
    .trim()
    .toLowerCase();
  const username = String(input?.username || '').trim();
  const password = input?.password == null ? '' : String(input.password);
  const imapHost = String(input?.imapHost || '')
    .trim()
    .toLowerCase();
  const smtpHost = String(input?.smtpHost || '')
    .trim()
    .toLowerCase();
  const imapPort = Number(input?.imapPort);
  const smtpPort = Number(input?.smtpPort);

  if (!EMAIL.test(address) || address.length > 254) fields.push('address');
  if (!username || username.length > 254) fields.push('username');
  if (imapHost !== MAILBOX_DEFAULTS.imapHost) fields.push('imapHost');
  if (smtpHost !== MAILBOX_DEFAULTS.smtpHost) fields.push('smtpHost');
  if (imapPort !== MAILBOX_DEFAULTS.imapPort) fields.push('imapPort');
  if (smtpPort !== MAILBOX_DEFAULTS.smtpPort) fields.push('smtpPort');
  if (requirePassword && !password) fields.push('password');
  if (password.length > 200) fields.push('password');

  if (fields.length) throw fail('invalid_input', [...new Set(fields)]);
  return {
    address,
    username,
    password,
    imapHost,
    imapPort,
    smtpHost,
    smtpPort,
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value, field = 'workspaceId') {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw fail('invalid_input', [field]);
  return id;
}
