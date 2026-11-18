export function fail(code, fields) {
  const err = new Error(code);
  err.code = code;
  if (fields?.length) err.fields = fields;
  return err;
}

export const HTTP_STATUS = {
  method: 405,
  auth_required: 401,
  forbidden: 403,
  admin_required: 403,
  invalid_input: 400,
  password_required: 400,
  not_configured: 409,
  sending_disabled: 403,
  approval_required: 403,
  approval_used: 409,
  not_an_email: 400,
  missing_recipient: 400,
  no_draft: 400,
  schema_missing: 503,
  missing_key: 503,
  missing_server_config: 503,
  missing_cron_secret: 503,
  imap_login_failed: 502,
  smtp_login_failed: 502,
  imap_read_failed: 502,
  send_failed: 502,
  database_error: 500,
  refused_write: 500,
  email_failed: 500,
};

export function mapDbError(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205' || /could not find the table/i.test(msg) || /does not exist/i.test(msg)) {
    return fail('schema_missing');
  }
  return fail('database_error');
}

export function assertWritable(table) {
  const forbidden = table === 'crm_deals' || table === 'crm_activities' || table === 'crm_research' || String(table).includes('email_draft');
  if (forbidden) throw fail('refused_write');
}
