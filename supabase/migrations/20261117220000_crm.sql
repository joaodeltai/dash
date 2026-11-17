-- =====================================================================
-- CRM: pipeline comercial por workspace.
--
-- Tabelas novas, isoladas das tarefas (tasks.status só aceita
-- backlog/todo/progress/review/done). Nada aqui altera tabelas
-- existentes, além de um trigger AFTER INSERT em workspaces que
-- semeia as etapas padrão de um workspace novo.
--
-- Quem pode ler e escrever: membros ativos com papel owner, admin ou
-- member (private.can_write). Convidados não enxergam o pipeline.
-- Agentes de IA gravam pela API do Supabase com o JWT de um membro
-- (as políticas valem) ou com a service role (ela ignora o RLS) e
-- assinam a linha em created_by_agent. created_by continua sendo a
-- conta da sessão, carimbada por trigger.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Etapas (configuráveis por workspace; o app traduz o nome em inglês)
-- ---------------------------------------------------------------------

create table public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('open', 'won', 'lost', 'nurture')),
  position integer not null,
  color text not null default 'gray' check (color in ('gray', 'blue', 'violet', 'teal', 'amber', 'orange', 'rose', 'green', 'red')),
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index crm_stages_workspace_idx on public.crm_stages (workspace_id, position);
comment on table public.crm_stages is 'Etapas do pipeline de vendas de um workspace. kind lost exige motivo na oportunidade.';

create table public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  domain text not null default '' check (char_length(domain) <= 253),
  segment text not null default '' check (char_length(segment) <= 80),
  size text not null default '' check (char_length(size) <= 20),
  city text not null default '' check (char_length(city) <= 80),
  state text not null default '' check (char_length(state) <= 8),
  source text not null default '' check (char_length(source) <= 40),
  notes text not null default '' check (char_length(notes) <= 20000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_companies_workspace_idx on public.crm_companies (workspace_id);
comment on column public.crm_companies.created_by_agent is 'Nome do agente de IA que criou a linha, vazio quando foi uma pessoa.';

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  role text not null default '' check (char_length(role) <= 120),
  email text not null default '' check (email = lower(email) and char_length(email) <= 254),
  phone text not null default '' check (char_length(phone) <= 40),
  linkedin text not null default '' check (char_length(linkedin) <= 500),
  notes text not null default '' check (char_length(notes) <= 20000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_contacts_workspace_idx on public.crm_contacts (workspace_id);
create index crm_contacts_company_idx on public.crm_contacts (company_id);

create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  company_id uuid references public.crm_companies (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  stage_id uuid not null references public.crm_stages (id) on delete restrict,
  value_cents bigint not null default 0 check (value_cents >= 0 and value_cents <= 100000000000000),
  source text not null default '' check (char_length(source) <= 40),
  intent_score integer not null default 0 check (intent_score between 0 and 100),
  owner_id uuid references public.members (id) on delete set null,
  next_step text not null default '' check (char_length(next_step) <= 300),
  next_step_on date,
  expected_close date,
  lost_reason text not null default '' check (char_length(lost_reason) <= 500),
  tags text[] not null default '{}' check (cardinality(tags) <= 16),
  position double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_deals_workspace_idx on public.crm_deals (workspace_id, stage_id, position);
create index crm_deals_company_idx on public.crm_deals (company_id);
create index crm_deals_owner_idx on public.crm_deals (owner_id);
comment on column public.crm_deals.value_cents is 'Valor em centavos de real (BRL).';
comment on column public.crm_deals.created_by_agent is 'Nome do agente de IA que criou a oportunidade, vazio quando foi uma pessoa.';
comment on column public.crm_deals.intent_score is 'Intenção de compra de 0 a 100.';

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  type text not null check (type in ('email', 'whatsapp', 'linkedin', 'call', 'meeting', 'note', 'stage_change')),
  direction text not null default 'internal' check (direction in ('inbound', 'outbound', 'internal')),
  content text not null default '' check (char_length(content) <= 20000),
  occurred_at timestamptz not null default now(),
  author_id uuid references public.members (id) on delete set null,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index crm_activities_deal_idx on public.crm_activities (deal_id, occurred_at desc);
create index crm_activities_workspace_idx on public.crm_activities (workspace_id);
comment on table public.crm_activities is 'Linha do tempo da oportunidade. stage_change também é gravado por trigger quando a etapa muda.';
comment on column public.crm_activities.created_by_agent is 'Nome do agente de IA que registrou a atividade, vazio quando foi uma pessoa.';

create table public.crm_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_sequences_workspace_idx on public.crm_sequences (workspace_id);
comment on table public.crm_sequences is 'Cadência de follow-up. O app guarda os passos; o envio fica a cargo de um agente.';

create table public.crm_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sequence_id uuid not null references public.crm_sequences (id) on delete cascade,
  position integer not null,
  channel text not null check (channel in ('email', 'whatsapp', 'linkedin', 'call')),
  delay_days integer not null default 0 check (delay_days between 0 and 3650),
  body text not null default '' check (char_length(body) <= 4000)
);
create index crm_sequence_steps_sequence_idx on public.crm_sequence_steps (sequence_id, position);

create table public.crm_sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sequence_id uuid not null references public.crm_sequences (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  step_index integer not null default 0 check (step_index >= 0),
  next_on date,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  created_at timestamptz not null default now(),
  unique (sequence_id, deal_id)
);
create index crm_enrollments_deal_idx on public.crm_sequence_enrollments (deal_id);
create index crm_enrollments_workspace_idx on public.crm_sequence_enrollments (workspace_id);

-- ---------------------------------------------------------------------
-- Etapas padrão: Lead novo … Ganho, mais Perdido e Nutrição.
-- O nome fica em inglês; a interface traduz.
-- ---------------------------------------------------------------------

create function private.seed_crm_stages(ws uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.crm_stages (workspace_id, slug, name, kind, position, color)
  select ws, v.slug, v.name, v.kind, v.position, v.color
  from (values
    ('new', 'New lead', 'open', 0, 'gray'),
    ('qualified', 'Qualified', 'open', 1, 'blue'),
    ('researched', 'Researched', 'open', 2, 'violet'),
    ('approached', 'Approached', 'open', 3, 'teal'),
    ('replied', 'Replied', 'open', 4, 'amber'),
    ('diag_scheduled', 'Diagnosis scheduled', 'open', 5, 'orange'),
    ('diag_done', 'Diagnosis done', 'open', 6, 'rose'),
    ('proposal', 'Proposal sent', 'open', 7, 'blue'),
    ('negotiation', 'Negotiation', 'open', 8, 'violet'),
    ('won', 'Won', 'won', 9, 'green'),
    ('lost', 'Lost', 'lost', 10, 'red'),
    ('nurture', 'Nurture', 'nurture', 11, 'gray')
  ) as v(slug, name, kind, position, color)
  on conflict (workspace_id, slug) do nothing;
end
$$;

create function private.workspaces_seed_crm() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_crm_stages(new.id);
  return new;
end
$$;

create trigger workspaces_seed_crm
  after insert on public.workspaces
  for each row execute function private.workspaces_seed_crm();

-- Workspaces que já existem ganham as etapas na hora em que esta migration roda.
do $$
declare r record;
begin
  for r in select id from public.workspaces loop
    perform private.seed_crm_stages(r.id);
  end loop;
end
$$;

revoke all on function private.seed_crm_stages(uuid) from public, anon, authenticated;
revoke all on function private.workspaces_seed_crm() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Integridade: mesmo workspace, motivo de perda, autoria, log de etapa.
-- A mudança de etapa grava uma atividade aqui, para um agente que só
-- atualiza a oportunidade também deixar rastro. Se o cliente já inseriu
-- uma atividade stage_change com o mesmo par de etapas nos últimos
-- minutos, o trigger não duplica.
-- ---------------------------------------------------------------------

create function private.crm_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  st_ws uuid;
  st_kind text;
  seq_ws uuid;
  deal_ws uuid;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'crm_stages' and old.slug in ('new', 'won', 'lost', 'nurture') then
      raise exception 'this stage cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'a CRM record cannot be moved to another workspace' using errcode = '42501';
  end if;

  if tg_table_name = 'crm_contacts' then
    if new.company_id is not null and not exists (
      select 1 from public.crm_companies c where c.id = new.company_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'crm_deals' then
    select s.workspace_id, s.kind into st_ws, st_kind from public.crm_stages s where s.id = new.stage_id;
    if st_ws is null then
      raise exception 'stage not found' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and st_ws is distinct from old.workspace_id then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    new.workspace_id := st_ws;
    if new.company_id is not null and not exists (
      select 1 from public.crm_companies c where c.id = new.company_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    if new.company_id is not null and new.contact_id is not null and exists (
      select 1 from public.crm_contacts c
      where c.id = new.contact_id and c.company_id is not null and c.company_id is distinct from new.company_id
    ) then
      raise exception 'contact does not belong to the company' using errcode = '23514';
    end if;
    if not private.in_workspace(new.owner_id, new.workspace_id) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    new.intent_score := least(100, greatest(0, coalesce(new.intent_score, 0)));
    new.value_cents := greatest(0, coalesce(new.value_cents, 0));
    if st_kind = 'lost' and char_length(btrim(coalesce(new.lost_reason, ''))) = 0 then
      raise exception 'a lost deal needs a reason' using errcode = '23514';
    end if;
    if st_kind = 'won' then
      if new.won_at is null then new.won_at := now(); end if;
      new.lost_at := null;
    elsif st_kind = 'lost' then
      if new.lost_at is null then new.lost_at := now(); end if;
      new.won_at := null;
    else
      new.won_at := null;
      new.lost_at := null;
    end if;
    if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id and not exists (
      select 1 from public.crm_activities a
      where a.deal_id = new.id
        and a.type = 'stage_change'
        and a.meta->>'to' = new.stage_id::text
        and a.meta->>'from' = old.stage_id::text
        and a.created_at > now() - interval '2 minutes'
    ) then
      insert into public.crm_activities (
        workspace_id, deal_id, company_id, contact_id, type, direction, content, occurred_at, author_id, created_by_agent, meta
      ) values (
        new.workspace_id, new.id, new.company_id, new.contact_id, 'stage_change', 'internal', '', now(),
        case when uid is null then null else private.my_member_id(new.workspace_id) end,
        case
          when new.created_by_agent is distinct from old.created_by_agent then coalesce(new.created_by_agent, '')
          else ''
        end,
        jsonb_build_object('from', old.stage_id, 'to', new.stage_id)
      );
    end if;
  elsif tg_table_name = 'crm_activities' then
    if tg_op = 'UPDATE' and (old.type = 'stage_change' or new.type = 'stage_change') then
      raise exception 'a stage change cannot be edited' using errcode = '42501';
    end if;
    select d.workspace_id into deal_ws from public.crm_deals d where d.id = new.deal_id;
    if deal_ws is null then
      raise exception 'deal not found' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and deal_ws is distinct from old.workspace_id then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    new.workspace_id := deal_ws;
    if tg_op = 'UPDATE' then
      new.deal_id := old.deal_id;
      new.author_id := old.author_id;
      new.created_at := old.created_at;
    end if;
    if new.company_id is not null and not exists (
      select 1 from public.crm_companies c where c.id = new.company_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.crm_contacts c where c.id = new.contact_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
  elsif tg_table_name = 'crm_sequence_steps' then
    select s.workspace_id into seq_ws from public.crm_sequences s where s.id = new.sequence_id;
    if seq_ws is null then
      raise exception 'sequence not found' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and seq_ws is distinct from old.workspace_id then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    new.workspace_id := seq_ws;
  elsif tg_table_name = 'crm_sequence_enrollments' then
    select d.workspace_id into deal_ws from public.crm_deals d where d.id = new.deal_id;
    select s.workspace_id into seq_ws from public.crm_sequences s where s.id = new.sequence_id;
    if deal_ws is null or seq_ws is null or deal_ws is distinct from seq_ws then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and deal_ws is distinct from old.workspace_id then
      raise exception 'a CRM record cannot be moved to another workspace' using errcode = '42501';
    end if;
    new.workspace_id := deal_ws;
  end if;

  if uid is not null and tg_table_name in ('crm_companies', 'crm_contacts', 'crm_deals', 'crm_sequences') then
    if tg_op = 'INSERT' then new.created_by := uid;
    elsif new.created_by is not null then new.created_by := old.created_by; end if;
  end if;
  if uid is not null and tg_table_name = 'crm_activities' and tg_op = 'INSERT' then
    new.author_id := private.my_member_id(new.workspace_id);
  end if;

  return new;
end
$$;

revoke all on function private.crm_guard() from public, anon;
grant execute on function private.crm_guard() to authenticated;

create trigger crm_stages_guard before delete on public.crm_stages
  for each row execute function private.crm_guard();
create trigger crm_companies_guard before update on public.crm_companies
  for each row execute function private.crm_guard();
create trigger crm_companies_stamp before insert on public.crm_companies
  for each row execute function private.crm_guard();
create trigger crm_contacts_guard before insert or update on public.crm_contacts
  for each row execute function private.crm_guard();
create trigger crm_deals_guard before insert or update on public.crm_deals
  for each row execute function private.crm_guard();
create trigger crm_activities_guard before insert or update on public.crm_activities
  for each row execute function private.crm_guard();
create trigger crm_sequences_guard before insert or update on public.crm_sequences
  for each row execute function private.crm_guard();
create trigger crm_steps_guard before insert or update on public.crm_sequence_steps
  for each row execute function private.crm_guard();
create trigger crm_enrollments_guard before insert or update on public.crm_sequence_enrollments
  for each row execute function private.crm_guard();

-- ---------------------------------------------------------------------
-- Privilégios e RLS. Convidado não lê nem escreve.
-- ---------------------------------------------------------------------

revoke all on public.crm_stages, public.crm_companies, public.crm_contacts, public.crm_deals,
  public.crm_activities, public.crm_sequences, public.crm_sequence_steps, public.crm_sequence_enrollments
  from anon, authenticated;

grant select, insert, update, delete on
  public.crm_stages, public.crm_companies, public.crm_contacts, public.crm_deals,
  public.crm_activities, public.crm_sequences, public.crm_sequence_steps, public.crm_sequence_enrollments
  to authenticated;

alter table public.crm_stages enable row level security;
alter table public.crm_companies enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_sequences enable row level security;
alter table public.crm_sequence_steps enable row level security;
alter table public.crm_sequence_enrollments enable row level security;

create policy crm_stages_select on public.crm_stages for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_stages_write on public.crm_stages for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

create policy crm_companies_select on public.crm_companies for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_companies_write on public.crm_companies for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

create policy crm_contacts_select on public.crm_contacts for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_contacts_write on public.crm_contacts for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

create policy crm_deals_select on public.crm_deals for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_deals_write on public.crm_deals for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

create policy crm_activities_select on public.crm_activities for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_activities_insert on public.crm_activities for insert to authenticated
  with check (private.can_write(workspace_id));
create policy crm_activities_update on public.crm_activities for update to authenticated
  using (private.can_write(workspace_id) and (author_id = private.my_member_id(workspace_id) or private.is_admin(workspace_id)))
  with check (private.can_write(workspace_id) and (author_id = private.my_member_id(workspace_id) or private.is_admin(workspace_id)));
create policy crm_activities_delete on public.crm_activities for delete to authenticated
  using (private.can_write(workspace_id) and (author_id = private.my_member_id(workspace_id) or private.is_admin(workspace_id)));

create policy crm_sequences_select on public.crm_sequences for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_sequences_write on public.crm_sequences for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

create policy crm_steps_select on public.crm_sequence_steps for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_steps_write on public.crm_sequence_steps for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

create policy crm_enrollments_select on public.crm_sequence_enrollments for select to authenticated
  using (private.can_write(workspace_id));
create policy crm_enrollments_write on public.crm_sequence_enrollments for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

-- FOR ALL policies also cover SELECT, which would make the dedicated select policies redundant but harmless.
-- Stages/companies/contacts/deals/sequences use FOR ALL, so the select policy is a second permissive policy. Fine.

alter publication supabase_realtime add table
  public.crm_stages, public.crm_companies, public.crm_contacts, public.crm_deals,
  public.crm_activities, public.crm_sequences, public.crm_sequence_steps, public.crm_sequence_enrollments;
