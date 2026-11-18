-- Rascunho de e-mail: validação, cópia e o que não pode ser apagado.
-- Roda numa transação desfeita no fim. Não precisa do schema inteiro do app:
-- cria só as tabelas que a migration nova lê, aplica o arquivo e confere.
--
--   psql -v ON_ERROR_STOP=1 -f tests/sql/crm_email_draft.sql
--
-- Termina com "NOTICE: PASS" ou com um erro listando o que falhou.
begin;

create schema if not exists private;

create table public.crm_contacts (
  id uuid primary key,
  email text
);

create table public.crm_deals (
  id uuid primary key,
  contact_id uuid,
  stage_id uuid not null
);

create table public.crm_activities (
  id uuid primary key,
  deal_id uuid not null,
  type text not null,
  direction text not null,
  content text not null default '',
  meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

-- O trigger de produção só registra etapa quando stage_id muda, e não há
-- trigger de delete em crm_activities. Este imita a parte perigosa: se a
-- cópia alterar a etapa, nasce uma atividade stage_change extra.
create or replace function private.test_stage_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    insert into public.crm_activities (id, deal_id, type, direction, content, meta)
    values (gen_random_uuid(), new.id, 'stage_change', 'internal', '', jsonb_build_object('from', old.stage_id, 'to', new.stage_id));
  end if;
  return new;
end
$$;

create trigger crm_deals_test_stage
  before update on public.crm_deals
  for each row execute function private.test_stage_touch();

\ir ../../supabase/migrations/20261118060000_crm_email_draft.sql

do $test$
declare
  deal1 uuid := '10000000-0000-4000-8000-000000000001';
  deal2 uuid := '10000000-0000-4000-8000-000000000002';
  contact1 uuid := '20000000-0000-4000-8000-000000000001';
  stage1 uuid := '30000000-0000-4000-8000-000000000001';
  stage2 uuid := '30000000-0000-4000-8000-000000000002';
  email_body text := $email$
[BLOQUEADO: domínio secundário aquecido ainda não existe]
[RASCUNHO — NÃO ENVIADO — aguardando aprovação do João]

--- Versão A ---
Assunto: Agendamento pelo WhatsApp na Fortius

Oi, Alexandre,

Quando o pedido chega à noite, alguém responde?

--- Versão B ---
Assunto: Pedidos de consulta na Fortius

Oi, Alexandre,

Como vocês lidam com a fila?
$email$;
  email_late text := $email$
[RASCUNHO — NÃO ENVIADO]

--- Versão A ---
Assunto: Segunda carta

Corpo da segunda carta.
$email$;
  linkedin_body text := $li$[RASCUNHO — NÃO ENVIADO — mensagem para o João mandar manualmente no LinkedIn, se aprovar]

Oi, Alexandre. Vi o WhatsApp da Fortius.$li$;
  draft jsonb;
  again jsonb;
  fails text[] := '{}';
  n int;
  got_stage uuid;
begin
  email_body := btrim(email_body, e'\n');
  email_late := btrim(email_late, e'\n');
  linkedin_body := btrim(linkedin_body, e'\n');

  insert into public.crm_contacts (id, email) values (contact1, 'Alexandre@Fortius.com.br');
  insert into public.crm_deals (id, contact_id, stage_id) values
    (deal1, contact1, stage1),
    (deal2, null, stage2);

  insert into public.crm_activities (id, deal_id, type, direction, content, meta, occurred_at) values
    ('40000000-0000-4000-8000-000000000001', deal1, 'email', 'outbound', email_body,
      '{"status":" rascunho ","aprovado":false,"para":"alexandre@fortius.com.br"}'::jsonb, '2026-11-18 04:26:18+00'),
    ('40000000-0000-4000-8000-000000000002', deal1, 'email', 'outbound', email_late,
      '{"status":"Rascunho","aprovado":"false"}'::jsonb, '2026-11-18 04:26:19+00'),
    ('40000000-0000-4000-8000-000000000003', deal1, 'linkedin', 'outbound', linkedin_body,
      '{"status":"rascunho","aprovado":false,"canal":"linkedin"}'::jsonb, '2026-11-18 04:26:18+00'),
    ('40000000-0000-4000-8000-000000000004', deal1, 'note', 'internal', 'fala em rascunho, mas é nota', '{}'::jsonb, '2026-11-18 04:00:00+00'),
    ('40000000-0000-4000-8000-000000000005', deal1, 'stage_change', 'internal', '', '{"from":"a","to":"b"}'::jsonb, '2026-11-18 04:00:00+00'),
    ('40000000-0000-4000-8000-000000000006', deal1, 'email', 'outbound', 'Mensagem já enviada',
      '{"status":"enviado","aprovado":true}'::jsonb, '2026-11-18 05:00:00+00'),
    ('40000000-0000-4000-8000-000000000007', deal1, 'email', 'inbound', 'Resposta do decisor',
      '{"status":"rascunho","aprovado":false}'::jsonb, '2026-11-18 05:10:00+00'),
    ('40000000-0000-4000-8000-000000000008', deal2, 'linkedin', 'outbound', 'Oi, sem e-mail.',
      '{"status":"rascunho","aprovado":false}'::jsonb, '2026-11-18 04:26:18+00');

  perform private.crm_move_email_drafts();

  select email_draft, stage_id into draft, got_stage from public.crm_deals where id = deal1;
  if got_stage is distinct from stage1 then fails := fails || 'stage-changed'; end if;
  if draft->>'versao_ativa' is distinct from 'A' then fails := fails || 'active-not-a'; end if;
  if draft->>'email_decisor' is distinct from 'alexandre@fortius.com.br' then fails := fails || 'decider-email'; end if;
  if draft->>'assunto' is distinct from 'Agendamento pelo WhatsApp na Fortius' then fails := fails || 'subject'; end if;
  if draft->>'corpo' is distinct from email_body then fails := fails || 'body-not-whole'; end if;
  if draft->>'corpo' not like '%Pedidos de consulta na Fortius%' then fails := fails || 'second-subject-dropped'; end if;
  if jsonb_array_length(draft->'versoes') is distinct from 3 then fails := fails || 'version-count'; end if;
  if draft->'versoes'->0->>'rotulo' is distinct from 'A' or draft->'versoes'->0->>'canal' is distinct from 'email' then fails := fails || 'version-a'; end if;
  if draft->'versoes'->0->>'corpo' is distinct from email_body then fails := fails || 'version-a-body'; end if;
  if draft->'versoes'->1->>'rotulo' is distinct from 'B' or draft->'versoes'->1->>'assunto' is distinct from 'Segunda carta' then fails := fails || 'version-b'; end if;
  if draft->'versoes'->1->>'corpo' is distinct from email_late then fails := fails || 'version-b-body'; end if;
  if draft->'versoes'->2->>'rotulo' is distinct from 'C'
     or draft->'versoes'->2->>'canal' is distinct from 'linkedin'
     or draft->'versoes'->2->>'assunto' is distinct from ''
     or draft->'versoes'->2->>'corpo' is distinct from linkedin_body then fails := fails || 'version-c'; end if;

  select email_draft, stage_id into draft, got_stage from public.crm_deals where id = deal2;
  if got_stage is distinct from stage2 then fails := fails || 'stage-2-changed'; end if;
  if draft->>'email_decisor' is distinct from '[FALTA: e-mail do decisor]' then fails := fails || 'missing-email'; end if;
  if draft->>'assunto' is distinct from '' or draft->>'versao_ativa' is distinct from 'A' then fails := fails || 'linkedin-only-active'; end if;
  if draft->'versoes'->0->>'corpo' is distinct from 'Oi, sem e-mail.' then fails := fails || 'linkedin-only-body'; end if;

  select count(*) into n from public.crm_activities where private.crm_activity_is_draft(direction, type, meta);
  if n <> 0 then fails := fails || 'drafts-left'; end if;

  select count(*) into n from public.crm_activities where id = '40000000-0000-4000-8000-000000000004';
  if n <> 1 then fails := fails || 'note-deleted'; end if;
  select count(*) into n from public.crm_activities where type = 'stage_change';
  if n <> 1 then fails := fails || 'stage-row'; end if;
  select count(*) into n from public.crm_activities where id in (
    '40000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000007'
  );
  if n <> 2 then fails := fails || 'kept-messages'; end if;

  select email_draft into again from public.crm_deals where id = deal1;
  perform private.crm_move_email_drafts();
  select email_draft into draft from public.crm_deals where id = deal1;
  if draft is distinct from again then fails := fails || 'not-idempotent'; end if;
  select count(*) into n from public.crm_activities where type = 'stage_change';
  if n <> 1 then fails := fails || 'second-run-stage'; end if;

  begin
    update public.crm_deals set email_draft = '{"assunto":"x"}'::jsonb where id = deal1;
    fails := fails || 'invalid-accepted';
  exception
    when check_violation then
      null;
  end;

  update public.crm_deals set email_draft = null where id = deal2;
  if (select email_draft from public.crm_deals where id = deal2) is not null then fails := fails || 'null-rejected'; end if;

  begin
    update public.crm_deals
       set email_draft = jsonb_build_object(
         'assunto', 'Carta B',
         'email_decisor', '[FALTA: e-mail do decisor]',
         'corpo', 'texto B',
         'versao_ativa', 'B',
         'versoes', jsonb_build_array(
           jsonb_build_object('rotulo', 'A', 'assunto', 'Carta A', 'corpo', 'texto A', 'canal', 'email'),
           jsonb_build_object('rotulo', 'B', 'assunto', 'Carta B', 'corpo', 'texto B')
         )
       )
     where id = deal2;
  exception
    when check_violation then
      fails := fails || 'active-b-rejected';
  end;

  begin
    update public.crm_deals
       set email_draft = jsonb_build_object(
         'assunto', 'Carta A',
         'email_decisor', 'lia@acme.com.br',
         'corpo', 'texto A',
         'versao_ativa', 'A',
         'versoes', jsonb_build_array(
           jsonb_build_object('rotulo', 'A', 'assunto', 'Carta A', 'corpo', 'texto A', 'canal', 'whatsapp')
         )
       )
     where id = deal2;
    fails := fails || 'whatsapp-accepted';
  exception
    when check_violation then
      null;
  end;

  if cardinality(fails) > 0 then
    raise exception 'FAIL: %', array_to_string(fails, ', ');
  end if;
  raise notice 'PASS';
end
$test$;

rollback;
