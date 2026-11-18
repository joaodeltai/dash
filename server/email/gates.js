/* O envio só passa se a trava global estiver exatamente ligada E houver
   uma aprovação ainda não consumida. Ler a caixa não passa por aqui. */

export function sendingEnabled(env = process.env) {
  return env.EMAIL_SENDING_ENABLED === 'true';
}

export function readSyncEnabled(env = process.env) {
  return env.EMAIL_READ_SYNC_ENABLED === 'true';
}

export function sendDecision({ enabled, approval }) {
  if (enabled !== true) return { ok: false, sent: false, code: 'sending_disabled' };
  if (!approval?.id) return { ok: false, sent: false, code: 'approval_required' };
  if (approval.consumed_at) return { ok: false, sent: false, code: 'approval_used' };
  return { ok: true, sent: false };
}

export async function deliverApproved({ enabled, approval, transport }) {
  const decision = sendDecision({ enabled, approval });
  if (!decision.ok) return decision;
  const info = await transport.send({
    from: approval.from,
    to: approval.to_email,
    subject: approval.subject,
    text: approval.body,
    messageId: approval.rfcMessageId,
  });
  return { ok: true, sent: true, messageId: info?.messageId || approval.rfcMessageId };
}

/* O job periódico só chama syncAll. Não recebe função de envio. */
export async function runReadCron({ enabled, authorized, syncAll }) {
  if (!authorized) {
    const err = new Error('auth_required');
    err.code = 'auth_required';
    throw err;
  }
  if (enabled !== true) return { ok: true, skipped: true, sent: false, mailboxes: 0 };
  const mailboxes = await syncAll();
  return { ok: true, skipped: false, sent: false, mailboxes };
}
