-- =====================================================================
-- Prospecção: pesquisa com histórico, nota de intenção em partes,
-- ficha da empresa, origem dos dados do contato e versão da mensagem.
--
-- Não altera o significado das colunas que o app já grava. As colunas
-- novas têm padrão vazio, então as linhas que já existem continuam
-- válidas. A tabela nova segue o mesmo isolamento das outras crm_*:
-- workspace_id, created_by_agent, RLS por private.can_write (convidado
-- não vê), carimbo de autoria e updated_at.
--
-- Nota de intenção. As quatro partes moram na pesquisa (crm_research),
-- porque a nota é o resultado de uma passagem do Pesquisador e o
-- negócio guarda várias pesquisas. A soma máxima é 100 (30+20+35+15).
-- intent_score da pesquisa é coluna gerada: não dá para gravar um total
-- diferente da soma, e o cliente não envia essa coluna.
-- crm_deals.intent_score continua sendo o total do negócio. Não é
-- gerada (as partes não estão nessa tabela). Dois triggers mantêm o
-- total igual à soma da pesquisa mais recente (scored_at, created_at, id):
--   - ao gravar ou apagar uma pesquisa, o total do negócio é atualizado;
--   - ao gravar o negócio, o total enviado é trocado por essa soma
--     quando já existe pesquisa. Assim o sync do app, que reenvia a
--     linha inteira, não apaga a nota que o agente acabou de calcular.
-- Sem pesquisa, o total enviado (o controle da tela, de 0 a 100)
-- continua valendo. Apagar a última pesquisa não zera o negócio: fica
-- o último total aplicado.
--
-- Versão da mensagem. crm_activities.type já é o canal (email,
-- whatsapp, linkedin, call, …). message_variant é o texto usado naquela
-- abordagem, só em saída e só nesses quatro canais, para o Analista
-- agregar conversão sem uma tabela paralela. Vazio significa que a
-- atividade não entra na comparação.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Empresa: redes, porte real, fundação, o que vende.
-- social_links é um objeto livre, por exemplo
-- {"linkedin":"https://…","instagram":"https://…"}. Os valores são
-- texto por convenção; o check só exige objeto e um tamanho máximo,
-- para o formato poder crescer sem outra migration.
-- ---------------------------------------------------------------------

alter table public.crm_companies
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists employee_count integer,
  add column if not exists founded_year integer,
  add column if not exists offering text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_social_links_shape' and conrelid = 'public.crm_companies'::regclass) then
    alter table public.crm_companies
      add constraint crm_companies_social_links_shape
      check (jsonb_typeof(social_links) = 'object' and char_length(social_links::text) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_employee_count_range' and conrelid = 'public.crm_companies'::regclass) then
    alter table public.crm_companies
      add constraint crm_companies_employee_count_range
      check (employee_count is null or employee_count between 0 and 10000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_founded_year_range' and conrelid = 'public.crm_companies'::regclass) then
    alter table public.crm_companies
      add constraint crm_companies_founded_year_range
      check (founded_year is null or founded_year between 1800 and 2100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_offering_len' and conrelid = 'public.crm_companies'::regclass) then
    alter table public.crm_companies
      add constraint crm_companies_offering_len
      check (char_length(offering) <= 4000);
  end if;
end
$$;

comment on column public.crm_companies.social_links is
  'Links de redes e perfis. Objeto JSON, por exemplo {"linkedin":"https://…","instagram":"https://…"}.';
comment on column public.crm_companies.employee_count is
  'Número de funcionários. Nulo quando ainda não se sabe.';
comment on column public.crm_companies.founded_year is
  'Ano de fundação. Nulo quando não se sabe. O intervalo 1800–2100 é largo de propósito.';
comment on column public.crm_companies.offering is
  'O que a empresa vende, em texto curto. Diferente de notes, que é o caderno interno.';

-- ---------------------------------------------------------------------
-- Contato: de onde veio cada dado. Vazio quando não há fonte.
-- ---------------------------------------------------------------------

alter table public.crm_contacts
  add column if not exists email_source text not null default '',
  add column if not exists phone_source text not null default '',
  add column if not exists linkedin_source text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_contacts_email_source_len' and conrelid = 'public.crm_contacts'::regclass) then
    alter table public.crm_contacts
      add constraint crm_contacts_email_source_len
      check (char_length(email_source) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_contacts_phone_source_len' and conrelid = 'public.crm_contacts'::regclass) then
    alter table public.crm_contacts
      add constraint crm_contacts_phone_source_len
      check (char_length(phone_source) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_contacts_linkedin_source_len' and conrelid = 'public.crm_contacts'::regclass) then
    alter table public.crm_contacts
      add constraint crm_contacts_linkedin_source_len
      check (char_length(linkedin_source) <= 120);
  end if;
end
$$;

comment on column public.crm_contacts.email_source is
  'De onde veio o e-mail (site, Apollo, indicação…). Vazio se não há fonte.';
comment on column public.crm_contacts.phone_source is
  'De onde veio o telefone. Vazio se não há fonte.';
comment on column public.crm_contacts.linkedin_source is
  'De onde veio o LinkedIn. Vazio se não há fonte.';

-- ---------------------------------------------------------------------
-- Atividade: qual versão do texto foi enviada.
-- O canal continua sendo type. A variante só faz sentido numa abordagem
-- de saída (e-mail, WhatsApp, LinkedIn ou ligação).
-- ---------------------------------------------------------------------

alter table public.crm_activities
  add column if not exists message_variant text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_activities_message_variant_ok' and conrelid = 'public.crm_activities'::regclass) then
    alter table public.crm_activities
      add constraint crm_activities_message_variant_ok
      check (
        char_length(message_variant) <= 80
        and message_variant !~ '[\n\r]'
        and (
          message_variant = ''
          or (direction = 'outbound' and type in ('email', 'whatsapp', 'linkedin', 'call'))
        )
      );
  end if;
end
$$;

create index if not exists crm_activities_variant_idx
  on public.crm_activities (workspace_id, message_variant, type)
  where message_variant <> '';

comment on column public.crm_activities.message_variant is
  'Versão do texto enviado nesta abordagem (ex.: custo-v3). Vazio fora de e-mail, WhatsApp, LinkedIn ou ligação de saída. O Analista agrega por este valor; o canal é type.';

-- ---------------------------------------------------------------------
-- Pesquisa. Várias por negócio, da mais recente para a mais antiga.
-- intent_score não se grava: é a soma das quatro partes.
-- ---------------------------------------------------------------------

create table if not exists public.crm_research (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  icp_decision text not null check (icp_decision in ('keep', 'maybe', 'drop')),
  icp_reason text not null default '' check (char_length(icp_reason) <= 2000),
  why_them text not null default '' check (char_length(why_them) <= 4000),
  why_now text not null default '' check (char_length(why_now) <= 4000),
  trigger_event text not null default '' check (char_length(trigger_event) <= 500),
  trigger_event_on date,
  angle text not null default '' check (char_length(angle) <= 300 and angle !~ '[\n\r]'),
  proofs text not null default '' check (char_length(proofs) <= 8000),
  do_not_mention text not null default '' check (char_length(do_not_mention) <= 4000),
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  gaps text[] not null default '{}' check (cardinality(gaps) <= 32),
  icp_fit smallint not null default 0 check (icp_fit between 0 and 30),
  buying_power smallint not null default 0 check (buying_power between 0 and 20),
  intent_signal smallint not null default 0 check (intent_signal between 0 and 35),
  angle_quality smallint not null default 0 check (angle_quality between 0 and 15),
  intent_score integer generated always as (icp_fit + buying_power + intent_signal + angle_quality) stored,
  score_cutoff integer not null default 65 check (score_cutoff between 0 and 100),
  scored_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_by_agent text not null default '' check (char_length(created_by_agent) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_research_intent_total check (intent_score between 0 and 100)
);

create index if not exists crm_research_deal_idx
  on public.crm_research (deal_id, scored_at desc, created_at desc, id desc);
create index if not exists crm_research_workspace_idx
  on public.crm_research (workspace_id, scored_at desc);
create index if not exists crm_research_company_idx
  on public.crm_research (company_id);
create index if not exists crm_research_contact_idx
  on public.crm_research (contact_id);

comment on table public.crm_research is
  'Pesquisa de prospecção de um negócio. Várias linhas por negócio guardam o histórico. A mais recente (scored_at, created_at, id) define crm_deals.intent_score.';
comment on column public.crm_research.icp_decision is
  'Decisão de ICP: keep, maybe ou drop.';
comment on column public.crm_research.icp_reason is
  'Por que a decisão de ICP foi essa.';
comment on column public.crm_research.why_them is
  'Por que esta empresa.';
comment on column public.crm_research.why_now is
  'Por que agora.';
comment on column public.crm_research.trigger_event is
  'Evento-gatilho que justifica o contato, em uma linha.';
comment on column public.crm_research.trigger_event_on is
  'Data do evento-gatilho. Pode ser anterior à pesquisa.';
comment on column public.crm_research.angle is
  'Ângulo da abordagem, em uma frase, sem quebra de linha.';
comment on column public.crm_research.proofs is
  'Provas que o SDR pode usar.';
comment on column public.crm_research.do_not_mention is
  'O que não mencionar na abordagem.';
comment on column public.crm_research.confidence is
  'Confiança da pesquisa: high (A, alta), medium (M, média) ou low (B, baixa). O trigger aceita os aliases e grava o valor em inglês.';
comment on column public.crm_research.gaps is
  'Lacunas, cada item no formato [FALTA: …]. O trigger embrulha um texto solto nesse formato.';
comment on column public.crm_research.icp_fit is
  'Fit de ICP, de 0 a 30.';
comment on column public.crm_research.buying_power is
  'Poder de compra do cargo, de 0 a 20.';
comment on column public.crm_research.intent_signal is
  'Força e recência do sinal de intenção, de 0 a 35.';
comment on column public.crm_research.angle_quality is
  'Qualidade do ângulo, de 0 a 15.';
comment on column public.crm_research.intent_score is
  'Soma das quatro partes, de 0 a 100. Coluna gerada: não envie valor.';
comment on column public.crm_research.score_cutoff is
  'Corte aplicado nesta pesquisa, inteiro de 0 a 100. O padrão do time é 65. Não entra na soma.';
comment on column public.crm_research.scored_at is
  'Data da pesquisa e da pontuação. É ela que decide qual pesquisa é a mais recente.';
comment on column public.crm_research.created_by_agent is
  'Nome do agente de IA que gravou a pesquisa, vazio quando foi uma pessoa.';

comment on column public.crm_deals.intent_score is
  'Total de intenção de 0 a 100. Com pesquisa, é a soma da crm_research mais recente. Sem pesquisa, vale o valor enviado (0 a 100).';

-- ---------------------------------------------------------------------
-- Total mais recente de um negócio. Volátil de propósito: um trigger
-- AFTER INSERT precisa enxergar a linha que acabou de entrar. Stable
-- poderia ser cacheada no início do comando e devolver a nota antiga.
-- ---------------------------------------------------------------------

create or replace function private.crm_latest_intent(deal uuid) returns integer
language sql security definer set search_path = ''
as $$
  select r.intent_score
  from public.crm_research r
  where r.deal_id = deal
  order by r.scored_at desc, r.created_at desc, r.id desc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Integridade da pesquisa: mesmo workspace do negócio, autoria, e os
-- aliases de confiança (A/alta, M/média, B/baixa) e de lacuna.
-- O crm_guard existente não é reescrito; esta função só olha a tabela nova.
-- ---------------------------------------------------------------------

create or replace function private.crm_research_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  deal_ws uuid;
  g text;
  piece text;
  cleaned text[] := '{}'::text[];
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'a CRM record cannot be moved to another workspace' using errcode = '42501';
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
  if new.company_id is not null and new.contact_id is not null and exists (
    select 1 from public.crm_contacts c
    where c.id = new.contact_id and c.company_id is not null and c.company_id is distinct from new.company_id
  ) then
    raise exception 'contact does not belong to the company' using errcode = '23514';
  end if;

  new.angle := btrim(replace(replace(coalesce(new.angle, ''), e'\n', ' '), e'\r', ' '));

  new.icp_decision := lower(btrim(coalesce(new.icp_decision, '')));
  if new.icp_decision not in ('keep', 'maybe', 'drop') then
    raise exception 'icp decision must be keep, maybe or drop' using errcode = '23514';
  end if;

  new.confidence := case lower(btrim(coalesce(new.confidence, '')))
    when 'a' then 'high'
    when 'alta' then 'high'
    when 'high' then 'high'
    when 'm' then 'medium'
    when 'media' then 'medium'
    when 'média' then 'medium'
    when 'medium' then 'medium'
    when 'b' then 'low'
    when 'baixa' then 'low'
    when 'low' then 'low'
    else ''
  end;
  if new.confidence = '' then
    raise exception 'confidence must be high, medium or low' using errcode = '23514';
  end if;

  foreach g in array coalesce(new.gaps, '{}'::text[]) loop
    g := btrim(coalesce(g, ''));
    if g = '' then
      raise exception 'each gap must look like [FALTA: ...]' using errcode = '23514';
    end if;
    if g !~ '^\[FALTA: .{1,180}\]$' then
      piece := btrim(regexp_replace(g, '[\[\]]', '', 'g'));
      g := '[FALTA: ' || left(piece, 180) || ']';
    end if;
    if g !~ '^\[FALTA: .{1,180}\]$' then
      raise exception 'each gap must look like [FALTA: ...]' using errcode = '23514';
    end if;
    cleaned := array_append(cleaned, g);
  end loop;
  if cardinality(cleaned) > 32 then
    raise exception 'a research row can list at most 32 gaps' using errcode = '23514';
  end if;
  new.gaps := cleaned;

  if uid is not null then
    if tg_op = 'INSERT' then new.created_by := uid;
    elsif new.created_by is not null then new.created_by := old.created_by; end if;
  end if;

  return new;
end
$$;

-- Quando o negócio está sendo apagado, a cascata apaga as pesquisas e o
-- trigger de nota não pode atualizar a linha que já está saindo.
create or replace function private.crm_note_deal_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config(
    'app.crm_deleting_deals',
    concat_ws(',', nullif(current_setting('app.crm_deleting_deals', true), ''), old.id::text),
    true
  );
  return old;
end
$$;

-- Copia a soma da pesquisa mais recente para o negócio. Não zera o
-- negócio quando não sobra pesquisa. Ignora a corrida de uma exclusão
-- em cascata (o mesmo comando já está apagando o negócio).
create or replace function private.crm_sync_deal_intent() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  targets uuid[];
  target uuid;
  latest integer;
  deleting text;
begin
  if tg_op = 'DELETE' then
    targets := array[old.deal_id];
  elsif tg_op = 'UPDATE' and new.deal_id is distinct from old.deal_id then
    targets := array[old.deal_id, new.deal_id];
  else
    targets := array[new.deal_id];
  end if;

  deleting := current_setting('app.crm_deleting_deals', true);
  foreach target in array targets loop
    if deleting is not null and target::text = any (string_to_array(deleting, ',')) then
      continue;
    end if;
    latest := private.crm_latest_intent(target);
    if latest is null then
      continue;
    end if;
    begin
      update public.crm_deals d
         set intent_score = latest
       where d.id = target
         and d.intent_score is distinct from latest;
    exception
      when triggered_data_change_violation then
        null;
    end;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

-- No update do negócio, a nota do cliente perde para a pesquisa mais
-- recente. Roda depois de crm_deals_guard (ordem alfabética), que já
-- limitou o valor enviado a 0–100.
create or replace function private.crm_apply_latest_intent() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  latest integer;
begin
  latest := private.crm_latest_intent(new.id);
  if latest is not null then
    new.intent_score := latest;
  end if;
  return new;
end
$$;

revoke all on function private.crm_latest_intent(uuid) from public, anon;
revoke all on function private.crm_research_guard() from public, anon;
revoke all on function private.crm_note_deal_delete() from public, anon;
revoke all on function private.crm_sync_deal_intent() from public, anon;
revoke all on function private.crm_apply_latest_intent() from public, anon;

grant execute on function private.crm_latest_intent(uuid) to authenticated;
grant execute on function private.crm_research_guard() to authenticated;
grant execute on function private.crm_note_deal_delete() to authenticated;
grant execute on function private.crm_sync_deal_intent() to authenticated;
grant execute on function private.crm_apply_latest_intent() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function private.crm_latest_intent(uuid) to service_role;
    grant execute on function private.crm_research_guard() to service_role;
    grant execute on function private.crm_note_deal_delete() to service_role;
    grant execute on function private.crm_sync_deal_intent() to service_role;
    grant execute on function private.crm_apply_latest_intent() to service_role;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'crm_research_guard' and tgrelid = 'public.crm_research'::regclass
  ) then
    create trigger crm_research_guard before insert or update on public.crm_research
      for each row execute function private.crm_research_guard();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'crm_research_touch' and tgrelid = 'public.crm_research'::regclass
  ) then
    create trigger crm_research_touch before update on public.crm_research
      for each row execute function private.touch_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'crm_research_sync_intent' and tgrelid = 'public.crm_research'::regclass
  ) then
    create trigger crm_research_sync_intent after insert or update or delete on public.crm_research
      for each row execute function private.crm_sync_deal_intent();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'crm_deals_note_delete' and tgrelid = 'public.crm_deals'::regclass
  ) then
    create trigger crm_deals_note_delete before delete on public.crm_deals
      for each row execute function private.crm_note_deal_delete();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'crm_deals_intent' and tgrelid = 'public.crm_deals'::regclass
  ) then
    create trigger crm_deals_intent before insert or update on public.crm_deals
      for each row execute function private.crm_apply_latest_intent();
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Privilégios e RLS. Iguais aos de empresa e negócio: membro ativo
-- owner, admin ou member. Convidado não lê nem escreve.
-- ---------------------------------------------------------------------

revoke all on public.crm_research from anon, authenticated;
grant select, insert, update, delete on public.crm_research to authenticated;

alter table public.crm_research enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'crm_research' and p.polname = 'crm_research_select'
  ) then
    create policy crm_research_select on public.crm_research for select to authenticated
      using (private.can_write(workspace_id));
  end if;
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'crm_research' and p.polname = 'crm_research_write'
  ) then
    create policy crm_research_write on public.crm_research for all to authenticated
      using (private.can_write(workspace_id))
      with check (private.can_write(workspace_id));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_research'
  ) then
    alter publication supabase_realtime add table public.crm_research;
  end if;
end
$$;
