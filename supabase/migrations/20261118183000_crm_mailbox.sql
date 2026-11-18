-- =====================================================================
-- Caixa comercial do CRM (IMAP/SMTP da Hostinger).
--
-- A senha não fica nesta migration e não fica em texto puro. O navegador
-- grava só o ciphertext (AES-256-GCM) em crm_mailbox_secrets, e esse
-- ciphertext só é legível pela service role. A chave mestra não mora no
-- banco: é a variável EMAIL_CREDENTIALS_KEY, no servidor.
--
-- Esta migration não altera crm_deals, não toca no rascunho do lead e não muda
-- etapa de lead. Não há cron, não há trigger de envio e não há chamada
-- de rede. POP3 é só informação e nenhum código conecta nele.
-- =====================================================================

create table public.crm_mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  address text not null check (char_length(address) <= 254 and address ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  username text not null check (char_length(btrim(username)) between 1 and 254),
  imap_host text not null check (imap_host = 'imap.hostinger.com'),
  imap_port integer not null check (imap_port = 993),
  imap_secure boolean not null check (imap_secure),
  smtp_host text not null check (smtp_host = 'smtp.hostinger.com'),
  smtp_port integer not null check (smtp_port = 465),
  smtp_secure boolean not null check (smtp_secure),
  pop3_host text not null default 'pop.hostinger.com' check (pop3_host = 'pop.hostinger.com'),
  pop3_port integer not null default 995 check (pop3_port = 995),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_mailboxes is
  'Conexão da caixa comercial do workspace. Sem senha: o segredo mora em crm_mailbox_secrets.';
comment on column public.crm_mailboxes.pop3_host is
  'Só informação (pop.hostinger.com). O servidor não abre conexão POP3.';
comment on column public.crm_mailboxes.imap_secure is
  'SSL/TLS obrigatório. A leitura usa EXAMINE e BODY.PEEK e não marca a mensagem como lida.';

create trigger crm_mailboxes_touch
  before update on public.crm_mailboxes
  for each row execute function private.touch_updated_at();

-- O ciphertext não volta para o navegador: anon e authenticated não têm
-- grant, e a RLS está ligada sem nenhuma política (nega tudo). A service
-- role contorna a RLS e é o único papel que a função da Vercel usa.
create table public.crm_mailbox_secrets (
  mailbox_id uuid primary key references public.crm_mailboxes (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 1 and 4000),
  nonce text not null check (char_length(nonce) between 1 and 64),
  tag text not null check (char_length(tag) between 1 and 64),
  key_version smallint not null default 1 check (key_version >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.crm_mailbox_secrets is
  'Senha da caixa cifrada com AES-256-GCM. Não é a senha. A chave mestra é EMAIL_CREDENTIALS_KEY, fora do banco.';

create table public.crm_mailbox_status (
  mailbox_id uuid primary key references public.crm_mailboxes (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  total_messages integer not null default 0 check (total_messages >= 0),
  unseen_messages integer not null default 0 check (unseen_messages >= 0),
  last_sync_at timestamptz,
  last_error text not null default '' check (char_length(last_error) <= 80),
  updated_at timestamptz not null default now()
);

comment on table public.crm_mailbox_status is
  'Última leitura da caixa. Consulta do assistente: total_messages, unseen_messages, last_sync_at, last_error.';

create table public.crm_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mailbox_id uuid not null references public.crm_mailboxes (id) on delete cascade,
  imap_uid bigint not null check (imap_uid > 0),
  uid_validity bigint not null check (uid_validity >= 0),
  message_id text not null default '' check (char_length(message_id) <= 998),
  in_reply_to text not null default '' check (char_length(in_reply_to) <= 998),
  reference_ids text[] not null default '{}' check (cardinality(reference_ids) <= 32),
  from_email text not null default '' check (char_length(from_email) <= 254),
  from_name text not null default '' check (char_length(from_name) <= 200),
  subject text not null default '' check (char_length(subject) <= 500),
  snippet text not null default '' check (char_length(snippet) <= 500),
  received_at timestamptz,
  server_seen boolean not null default false,
  needs_triage boolean not null default false,
  synced_at timestamptz not null default now(),
  unique (mailbox_id, uid_validity, imap_uid)
);

comment on table public.crm_inbox_messages is
  'Cópia de leitura da caixa. server_seen é o flag observado; o servidor não altera flags, não move e não apaga.';
comment on column public.crm_inbox_messages.needs_triage is
  'Sinal de triagem. Não muda a etapa do lead.';

create index crm_inbox_messages_recent_idx
  on public.crm_inbox_messages (workspace_id, received_at desc);
create index crm_inbox_messages_triage_idx
  on public.crm_inbox_messages (workspace_id, received_at desc)
  where needs_triage;

create table public.crm_inbox_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message_id uuid not null references public.crm_inbox_messages (id) on delete cascade,
  deal_id uuid references public.crm_deals (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  match_reason text not null check (match_reason in ('from_email', 'in_reply_to', 'references')),
  created_at timestamptz not null default now(),
  check (deal_id is not null or contact_id is not null),
  unique nulls not distinct (message_id, deal_id, contact_id, match_reason)
);

comment on table public.crm_inbox_links is
  'Ligação entre uma mensagem lida e um lead ou contato. Não altera a etapa.';

create index crm_inbox_links_deal_idx on public.crm_inbox_links (deal_id);
create index crm_inbox_links_message_idx on public.crm_inbox_links (message_id);

create table public.crm_email_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  to_email text not null check (char_length(to_email) <= 254 and to_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  subject text not null default '' check (char_length(subject) <= 500),
  body text not null default '' check (char_length(body) <= 20000),
  body_sha256 text not null check (char_length(body_sha256) = 64),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_at is null or consumed_at >= approved_at)
);

comment on table public.crm_email_approvals is
  'Aprovação explícita de uma mensagem. Registrar a aprovação não envia. O envio ainda exige EMAIL_SENDING_ENABLED=true.';

create index crm_email_approvals_deal_idx
  on public.crm_email_approvals (workspace_id, deal_id, approved_at desc);

create table public.crm_sent_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  approval_id uuid not null unique references public.crm_email_approvals (id) on delete cascade,
  rfc_message_id text not null check (char_length(rfc_message_id) between 1 and 998),
  to_email text not null check (char_length(to_email) <= 254),
  sent_at timestamptz not null default now()
);

comment on table public.crm_sent_messages is
  'Message-ID de um envio já feito, para casar In-Reply-To e References. Nasce só depois de um envio aprovado e com a trava global ligada.';

create index crm_sent_messages_rfc_idx on public.crm_sent_messages (workspace_id, rfc_message_id);

-- ---------------------------------------------------------------------
-- Integridade entre workspaces. Esta função não escreve em crm_deals.
-- ---------------------------------------------------------------------

create or replace function private.crm_mail_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if tg_table_name = 'crm_email_approvals' then
    if tg_op = 'INSERT' then
      if uid is not null then
        new.approved_by := uid;
      end if;
      new.consumed_at := null;
      if not exists (
        select 1 from public.crm_deals d
        where d.id = new.deal_id and d.workspace_id = new.workspace_id
      ) then
        raise exception 'referenced record belongs to another workspace' using errcode = '23514';
      end if;
    elsif tg_op = 'UPDATE' then
      if uid is not null then
        raise exception 'approval rows cannot be edited' using errcode = '42501';
      end if;
      if new.workspace_id is distinct from old.workspace_id
         or new.deal_id is distinct from old.deal_id
         or new.to_email is distinct from old.to_email
         or new.subject is distinct from old.subject
         or new.body is distinct from old.body
         or new.body_sha256 is distinct from old.body_sha256
         or new.approved_by is distinct from old.approved_by
         or new.approved_at is distinct from old.approved_at then
        raise exception 'only the send timestamp of an approval can change' using errcode = '42501';
      end if;
      if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
        raise exception 'approval already used' using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'crm_inbox_links' then
    if new.deal_id is not null and not exists (
      select 1 from public.crm_deals d where d.id = new.deal_id and d.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.crm_inbox_messages m where m.id = new.message_id and m.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'crm_inbox_messages' then
    if not exists (
      select 1 from public.crm_mailboxes b where b.id = new.mailbox_id and b.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'crm_mailbox_secrets' then
    if not exists (
      select 1 from public.crm_mailboxes b where b.id = new.mailbox_id and b.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'crm_sent_messages' then
    if uid is not null then
      raise exception 'sent mail is recorded only by the server' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.crm_deals d where d.id = new.deal_id and d.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.crm_mail_guard() from public, anon;
grant execute on function private.crm_mail_guard() to authenticated, service_role;

create trigger crm_mailbox_secrets_guard
  before insert or update on public.crm_mailbox_secrets
  for each row execute function private.crm_mail_guard();
create trigger crm_inbox_messages_guard
  before insert or update on public.crm_inbox_messages
  for each row execute function private.crm_mail_guard();
create trigger crm_inbox_links_guard
  before insert or update on public.crm_inbox_links
  for each row execute function private.crm_mail_guard();
create trigger crm_email_approvals_guard
  before insert or update on public.crm_email_approvals
  for each row execute function private.crm_mail_guard();
create trigger crm_sent_messages_guard
  before insert or update on public.crm_sent_messages
  for each row execute function private.crm_mail_guard();

-- ---------------------------------------------------------------------
-- Privilégios. O segredo não é concedido ao navegador.
-- ---------------------------------------------------------------------

revoke all on public.crm_mailboxes, public.crm_mailbox_secrets, public.crm_mailbox_status,
  public.crm_inbox_messages, public.crm_inbox_links, public.crm_email_approvals, public.crm_sent_messages
  from public, anon, authenticated;

grant select on public.crm_mailboxes, public.crm_mailbox_status, public.crm_inbox_messages,
  public.crm_inbox_links, public.crm_sent_messages
  to authenticated;

grant select, insert on public.crm_email_approvals to authenticated;
grant insert, update, delete on public.crm_mailboxes to authenticated;

grant select, insert, update, delete on public.crm_mailboxes, public.crm_mailbox_secrets, public.crm_mailbox_status,
  public.crm_inbox_messages, public.crm_inbox_links, public.crm_email_approvals, public.crm_sent_messages
  to service_role;

alter table public.crm_mailboxes enable row level security;
alter table public.crm_mailbox_secrets enable row level security;
alter table public.crm_mailbox_secrets force row level security;
alter table public.crm_mailbox_status enable row level security;
alter table public.crm_inbox_messages enable row level security;
alter table public.crm_inbox_links enable row level security;
alter table public.crm_email_approvals enable row level security;
alter table public.crm_sent_messages enable row level security;

create policy crm_mailboxes_select on public.crm_mailboxes for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_mailboxes_insert on public.crm_mailboxes for insert to authenticated
  with check (private.is_admin(workspace_id));
create policy crm_mailboxes_update on public.crm_mailboxes for update to authenticated
  using (private.is_admin(workspace_id))
  with check (private.is_admin(workspace_id));
create policy crm_mailboxes_delete on public.crm_mailboxes for delete to authenticated
  using (private.is_admin(workspace_id));

create policy crm_mailbox_status_select on public.crm_mailbox_status for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_inbox_messages_select on public.crm_inbox_messages for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_inbox_links_select on public.crm_inbox_links for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_sent_messages_select on public.crm_sent_messages for select to authenticated
  using (private.can_write(workspace_id));

create policy crm_email_approvals_select on public.crm_email_approvals for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_email_approvals_insert on public.crm_email_approvals for insert to authenticated
  with check (private.can_write(workspace_id));

-- crm_mailbox_secrets de propósito não tem política. Sem grant e sem
-- política, o navegador não lê o ciphertext. Não publicar no Realtime:
-- o sync do app não conhece estas tabelas e não pode apagá-las.
