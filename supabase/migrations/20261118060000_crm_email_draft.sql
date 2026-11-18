-- =====================================================================
-- Rascunho de e-mail no lead (crm_deals).
--
-- crm_deals é o lead/negócio. O rascunho não é uma abordagem: ele mora
-- no próprio negócio e as atividades que só guardavam o texto saem da
-- linha do tempo, para não contarem como contato feito.
--
-- email_draft é nulo quando não há rascunho. Quando preenchido, a forma
-- é fixa:
--   {
--     "assunto": "...",            -- assunto da versão ativa
--     "email_decisor": "...",      -- e-mail do contato, ou o marcador de falta
--     "corpo": "...",              -- corpo da versão ativa, com as quebras
--     "versao_ativa": "A",         -- rótulo da versão que assunto/corpo repetem
--     "versoes": [
--       { "rotulo": "A", "assunto": "...", "corpo": "...", "canal": "email" }
--     ]
--   }
-- assunto e corpo do topo são a versão ativa, não um texto à parte.
-- canal só existe na versão e só aceita email ou linkedin.
-- Os rótulos são A, B, C… na ordem do array, no máximo 26.
--
-- A migração dos rascunhos que já estão em crm_activities identifica a
-- linha pela marcação, nunca por id:
--   direction = outbound
--   type diferente de stage_change
--   meta.status (sem caixa e sem espaço nas pontas) = rascunho
--   meta.aprovado = false (booleano ou texto false/f/0)
-- Cada atividade vira uma versão. O corpo é o content inteiro, sem
-- corte. O assunto é a primeira linha "Assunto: …", ou vazio quando o
-- texto não tem essa linha (é o caso do LinkedIn). O e-mail do decisor
-- vem do contato do negócio; se não houver um e-mail utilizável, fica
-- '[FALTA: e-mail do decisor]'.
-- A ordem é e-mail, depois LinkedIn, depois a data e o id. A primeira
-- versão é a ativa.
--
-- O delete só apaga a atividade de rascunho cujo texto está, inteiro,
-- no rascunho do negócio. Nota, mudança de etapa e mensagem já enviada
-- não entram no predicado. crm_activities não tem trigger de delete, e
-- a mudança de etapa só é gravada quando stage_id muda. Este update
-- grava só email_draft.
-- A função pode rodar de novo: não sobrescreve um rascunho já gravado
-- e não apaga atividade cujo texto não esteja no campo.
-- =====================================================================

alter table public.crm_deals
  add column if not exists email_draft jsonb;

comment on column public.crm_deals.email_draft is
  'Rascunho de e-mail do lead, não enviado. Nulo se não há rascunho. assunto e corpo repetem a versão ativa; versoes guarda cada texto (rótulo A, B, C…, canal opcional email ou linkedin) e email_decisor é o e-mail do contato ou [FALTA: e-mail do decisor].';

-- ---------------------------------------------------------------------
-- Uma atividade de saída ainda é rascunho? Usado pela cópia e por quem
-- quiser conferir, no SQL, se sobrou algum.
-- ---------------------------------------------------------------------

create or replace function private.crm_activity_is_draft(direction text, type text, meta jsonb) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select
    coalesce(direction, '') = 'outbound'
    and coalesce(type, '') <> 'stage_change'
    and lower(btrim(coalesce(meta->>'status', ''))) = 'rascunho'
    and (
      meta->'aprovado' = 'false'::jsonb
      or lower(btrim(coalesce(meta->>'aprovado', ''))) in ('false', 'f', '0')
    );
$$;

-- ---------------------------------------------------------------------
-- O check da coluna. Nulo passa. Qualquer outra forma é recusada, para
-- o app e um agente não gravarem um objeto pela metade.
-- ---------------------------------------------------------------------

create or replace function private.crm_email_draft_ok(draft jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  n int;
  i int;
  nkeys int;
  v jsonb;
  rotulo text;
  found boolean := false;
begin
  if draft is null then
    return true;
  end if;
  if jsonb_typeof(draft) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(draft)) <> 5 then
    return false;
  end if;
  if not (
    draft ? 'assunto'
    and draft ? 'corpo'
    and draft ? 'email_decisor'
    and draft ? 'versao_ativa'
    and draft ? 'versoes'
  ) then
    return false;
  end if;
  if jsonb_typeof(draft->'assunto') <> 'string'
     or jsonb_typeof(draft->'corpo') <> 'string'
     or jsonb_typeof(draft->'email_decisor') <> 'string'
     or jsonb_typeof(draft->'versao_ativa') <> 'string'
     or jsonb_typeof(draft->'versoes') <> 'array' then
    return false;
  end if;
  if char_length(draft->>'assunto') > 500 or (draft->>'assunto') ~ '[\n\r]' then
    return false;
  end if;
  if char_length(draft->>'corpo') > 20000 then
    return false;
  end if;
  if draft->>'email_decisor' is distinct from '[FALTA: e-mail do decisor]'
     and (
       char_length(draft->>'email_decisor') > 254
       or (draft->>'email_decisor') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     ) then
    return false;
  end if;

  n := jsonb_array_length(draft->'versoes');
  if n > 26 then
    return false;
  end if;
  if n = 0 then
    return draft->>'versao_ativa' = '' and draft->>'assunto' = '' and draft->>'corpo' = '';
  end if;
  if draft->>'versao_ativa' !~ '^[A-Z]$' then
    return false;
  end if;

  for i in 0 .. n - 1 loop
    v := draft->'versoes'->i;
    if jsonb_typeof(v) <> 'object' then
      return false;
    end if;
    select count(*) into nkeys from jsonb_object_keys(v);
    if nkeys = 4 then
      if not (v ? 'rotulo' and v ? 'assunto' and v ? 'corpo' and v ? 'canal') then
        return false;
      end if;
      if jsonb_typeof(v->'canal') <> 'string' or (v->>'canal') not in ('email', 'linkedin') then
        return false;
      end if;
    elsif nkeys = 3 then
      if not (v ? 'rotulo' and v ? 'assunto' and v ? 'corpo') then
        return false;
      end if;
    else
      return false;
    end if;
    if jsonb_typeof(v->'rotulo') <> 'string'
       or jsonb_typeof(v->'assunto') <> 'string'
       or jsonb_typeof(v->'corpo') <> 'string' then
      return false;
    end if;
    rotulo := v->>'rotulo';
    if rotulo is distinct from chr(65 + i) then
      return false;
    end if;
    if char_length(v->>'assunto') > 500 or (v->>'assunto') ~ '[\n\r]' then
      return false;
    end if;
    if char_length(v->>'corpo') > 20000 then
      return false;
    end if;
    if rotulo = draft->>'versao_ativa' then
      if (v->>'assunto') is distinct from (draft->>'assunto')
         or (v->>'corpo') is distinct from (draft->>'corpo') then
        return false;
      end if;
      found := true;
    end if;
  end loop;

  return found;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_deals_email_draft_ok' and conrelid = 'public.crm_deals'::regclass
  ) then
    alter table public.crm_deals
      add constraint crm_deals_email_draft_ok
      check (private.crm_email_draft_ok(email_draft));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Copia os rascunhos para o negócio e só então apaga essas atividades.
-- Não mexe em stage_id. Não sobrescreve email_draft já preenchido.
-- ---------------------------------------------------------------------

create or replace function private.crm_move_email_drafts() returns void
language plpgsql set search_path = ''
as $$
declare
  target uuid;
  row_n int;
  total int;
  item jsonb;
  versions jsonb;
  assunto text;
  canal text;
  active_assunto text;
  active_corpo text;
  email text;
  draft jsonb;
  act record;
begin
  for target in
    select distinct a.deal_id
    from public.crm_activities a
    where private.crm_activity_is_draft(a.direction, a.type, a.meta)
  loop
    select count(*) into total
    from public.crm_activities a
    where a.deal_id = target
      and private.crm_activity_is_draft(a.direction, a.type, a.meta);
    if total > 26 then
      raise exception 'o negócio % tem mais de 26 rascunhos', target using errcode = '23514';
    end if;

    versions := '[]'::jsonb;
    row_n := 0;
    active_assunto := '';
    active_corpo := '';
    for act in
      select a.type, a.content, a.occurred_at, a.id
      from public.crm_activities a
      where a.deal_id = target
        and private.crm_activity_is_draft(a.direction, a.type, a.meta)
      order by
        case when a.type = 'email' then 0 when a.type = 'linkedin' then 1 else 2 end,
        a.occurred_at,
        a.id
    loop
      row_n := row_n + 1;
      assunto := left(btrim(coalesce(substring(coalesce(act.content, '') from 'Assunto:[[:space:]]*([^\r\n]+)'), '')), 500);
      canal := case when act.type in ('email', 'linkedin') then act.type else null end;
      item := jsonb_strip_nulls(jsonb_build_object(
        'rotulo', chr(64 + row_n),
        'assunto', assunto,
        'corpo', coalesce(act.content, ''),
        'canal', canal
      ));
      versions := versions || jsonb_build_array(item);
      if row_n = 1 then
        active_assunto := assunto;
        active_corpo := coalesce(act.content, '');
      end if;
    end loop;

    select case
      when c.email is not null
       and lower(btrim(c.email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       and char_length(lower(btrim(c.email))) <= 254
        then lower(btrim(c.email))
      else '[FALTA: e-mail do decisor]'
    end
      into email
    from public.crm_deals d
    left join public.crm_contacts c on c.id = d.contact_id
    where d.id = target;

    draft := jsonb_build_object(
      'assunto', active_assunto,
      'email_decisor', coalesce(email, '[FALTA: e-mail do decisor]'),
      'corpo', active_corpo,
      'versao_ativa', 'A',
      'versoes', versions
    );
    if not private.crm_email_draft_ok(draft) then
      raise exception 'rascunho gerado não passou na validação (negócio %)', target using errcode = '23514';
    end if;

    update public.crm_deals d
       set email_draft = draft
     where d.id = target
       and d.email_draft is null;
  end loop;

  -- Só some a atividade cujo corpo e assunto estão no campo do negócio.
  -- Uma linha que não foi copiada permanece. stage_id não entra no update.
  delete from public.crm_activities a
   using public.crm_deals d
   where a.deal_id = d.id
     and d.email_draft is not null
     and private.crm_activity_is_draft(a.direction, a.type, a.meta)
     and exists (
       select 1
       from jsonb_array_elements(d.email_draft->'versoes') v
       where v->>'corpo' = coalesce(a.content, '')
         and v->>'assunto' = left(btrim(coalesce(substring(coalesce(a.content, '') from 'Assunto:[[:space:]]*([^\r\n]+)'), '')), 500)
     );
end
$$;

-- O check roda com o usuário que grava. authenticated precisa executar a
-- validação. A cópia fica só com o dono da função e com a service role:
-- um membro não reaplica a migração pelo navegador.
revoke all on function private.crm_activity_is_draft(text, text, jsonb) from public;
revoke all on function private.crm_email_draft_ok(jsonb) from public;
revoke all on function private.crm_move_email_drafts() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.crm_activity_is_draft(text, text, jsonb) from anon;
    revoke all on function private.crm_email_draft_ok(jsonb) from anon;
    revoke all on function private.crm_move_email_drafts() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.crm_activity_is_draft(text, text, jsonb) from authenticated;
    revoke all on function private.crm_move_email_drafts() from authenticated;
    grant execute on function private.crm_email_draft_ok(jsonb) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function private.crm_activity_is_draft(text, text, jsonb) to service_role;
    grant execute on function private.crm_email_draft_ok(jsonb) to service_role;
    grant execute on function private.crm_move_email_drafts() to service_role;
  end if;
end
$$;

do $$
begin
  perform private.crm_move_email_drafts();
end
$$;
