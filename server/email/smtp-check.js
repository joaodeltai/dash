import { createTransport } from 'nodemailer';
import { fail } from './errors.js';

/* verify() autentica e desliga. Não chama sendMail. */
export function createSmtpTransport(creds) {
  return createTransport({
    host: creds.host,
    port: creds.port,
    secure: true,
    auth: { user: creds.user, pass: creds.password },
    tls: { rejectUnauthorized: true, servername: creds.host },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
    logger: false,
    debug: false,
  });
}

export async function testSmtpLogin(creds, deps = {}) {
  const transport = (deps.createTransport || createSmtpTransport)(creds);
  try {
    await transport.verify();
    return { ok: true, protocol: 'smtp', sent: false };
  } catch {
    throw fail('smtp_login_failed');
  } finally {
    try {
      transport.close?.();
    } catch {
      /* already closed */
    }
  }
}
