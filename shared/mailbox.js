/* Valores sugeridos da caixa comercial e os nomes exatos dos segredos do servidor.
   Este arquivo não tem senha, chave nem segredo. A senha da caixa nunca fica aqui. */

export const MAILBOX_DEFAULTS = {
  address: 'contato@grupodeltai.com.br',
  username: 'contato@grupodeltai.com.br',
  imapHost: 'imap.hostinger.com',
  imapPort: 993,
  smtpHost: 'smtp.hostinger.com',
  smtpPort: 465,
  pop3Host: 'pop.hostinger.com',
  pop3Port: 995,
};

export const MAILBOX_MIGRATION = 'supabase/migrations/20261118183000_crm_mailbox.sql';

/* Nomes das variáveis no servidor (Vercel). Nenhuma usa o prefixo VITE_. */
export const ENV = {
  credentialsKey: 'EMAIL_CREDENTIALS_KEY',
  sendingEnabled: 'EMAIL_SENDING_ENABLED',
  readSyncEnabled: 'EMAIL_READ_SYNC_ENABLED',
  supabaseUrl: 'SUPABASE_URL',
  supabasePublishable: 'SUPABASE_PUBLISHABLE_KEY',
  supabaseSecret: 'SUPABASE_SECRET_KEY',
  cronSecret: 'CRON_SECRET',
};

export const MAILBOX_ROUTE = '#/crm/email';
