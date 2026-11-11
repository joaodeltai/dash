-- =====================================================================
-- 1. Chave de tarefa (WEB-201) atribuída pelo banco, única no workspace.
--    Antes o navegador escolhia o número; duas pessoas criando tarefas ao
--    mesmo tempo no mesmo projeto podiam receber a mesma chave.
-- 2. Histórico de atividade preservado quando a tarefa ou o projeto é
--    excluído (antes era apagado junto, por cascata).
-- 3. Índices para as chaves estrangeiras apontadas pelo advisor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chave de tarefa
-- ---------------------------------------------------------------------

-- O contador do projeto nunca recua, venha o valor de onde vier (versões antigas do app ainda o enviam).
create or replace function private.guard_project_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.task_seq := greatest(new.task_seq, old.task_seq);
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'a project cannot be moved to another workspace' using errcode = '42501';
  end if;
  if (select auth.uid()) is null then return new; end if;
  -- líder apagado do workspace: a FK limpa o campo, sem exigir permissão de quem removeu o membro
  if new.lead_id is null and old.lead_id is not null and new.is_private is not distinct from old.is_private
     and not exists (select 1 from public.members m where m.id = old.lead_id) then
    return new;
  end if;
  if (new.lead_id is distinct from old.lead_id or new.is_private is distinct from old.is_private) and private.project_perm(old.id) < 4 then
    raise exception 'only people with full access can change the project lead or privacy' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Dados existentes: o contador passa a ser pelo menos o maior número já usado no projeto...
update public.projects p
   set task_seq = greatest(
     p.task_seq,
     coalesce((select max(substring(t.key from '-(\d{1,9})$')::integer) from public.tasks t where t.project_id = p.id and t.key ~ '-\d{1,9}$'), 0)
   );

-- ...e chaves repetidas são renumeradas (a tarefa mais antiga mantém a sua).
do $$
declare
  r record;
  pkey text;
  seq integer;
  candidate text;
begin
  for r in
    select d.id, d.project_id, d.workspace_id
    from (
      select t.id, t.project_id, t.workspace_id,
             row_number() over (partition by t.workspace_id, t.key order by t.created_at, t.id) as rn
      from public.tasks t
    ) d
    where d.rn > 1
  loop
    loop
      update public.projects p set task_seq = p.task_seq + 1 where p.id = r.project_id returning p.key, p.task_seq into pkey, seq;
      candidate := pkey || '-' || seq;
      exit when not exists (select 1 from public.tasks t where t.workspace_id = r.workspace_id and t.key = candidate);
    end loop;
    update public.tasks set key = candidate where id = r.id;
  end loop;
end
$$;

create unique index tasks_workspace_key_uidx on public.tasks (workspace_id, key);

-- A chave vem do contador do projeto, dentro da mesma transação que grava a tarefa. O UPDATE trava a linha do
-- projeto, então criações simultâneas no mesmo projeto entram em fila e cada uma recebe um número diferente.
-- O valor enviado pelo cliente é ignorado. A chave só muda quando a tarefa vai para outro projeto.
create function private.assign_task_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  pkey text;
  seq integer;
  candidate text;
begin
  if tg_op = 'UPDATE' and new.project_id is not distinct from old.project_id then
    new.key := old.key;
    return new;
  end if;
  loop
    update public.projects p set task_seq = p.task_seq + 1 where p.id = new.project_id returning p.key, p.task_seq into pkey, seq;
    if not found then
      raise exception 'project % not found', new.project_id using errcode = '23503';
    end if;
    candidate := pkey || '-' || seq;
    -- dois projetos podem ter a mesma sigla, e a sigla de um projeto pode ter mudado: pula números já usados
    exit when not exists (
      select 1 from public.tasks t where t.workspace_id = new.workspace_id and t.key = candidate and t.id <> new.id
    );
  end loop;
  new.key := candidate;
  return new;
end
$$;
revoke all on function private.assign_task_key() from public, anon;

-- "z" no nome: roda depois de tasks_set_ws, quando workspace_id já é o do projeto.
create trigger tasks_z_key before insert or update on public.tasks for each row execute function private.assign_task_key();

-- ---------------------------------------------------------------------
-- 2. Histórico de atividade preservado
-- ---------------------------------------------------------------------

-- subject: título da tarefa (ou nome do projeto) a que o registro se refere, para continuar legível depois da exclusão.
-- project_name / restricted: preenchidos quando o projeto é excluído (nome e se era privado).
alter table public.activity
  add column subject text not null default '' check (char_length(subject) <= 500),
  add column project_name text check (char_length(project_name) <= 120),
  add column restricted boolean not null default false;

update public.activity a set subject = left(t.title, 500) from public.tasks t where t.id = a.task_id;
update public.activity a set subject = left(p.name, 500) from public.projects p where a.task_id is null and p.id = a.project_id;

-- Excluir a tarefa ou o projeto deixa de apagar o histórico. As chaves estrangeiras de activity continuam com
-- ON DELETE CASCADE; os triggers keep_task_history e keep_project_history (abaixo) desvinculam os registros
-- antes da exclusão, então a cascata não encontra nada para apagar. Nada é removido do schema nesta migration.

-- Projeto, workspace e título vêm da tarefa (ou do projeto) a que o registro se refere. O cliente não escolhe
-- subject, project_name nem restricted: só os triggers abaixo (que ligam app.activity_internal) os informam.
create or replace function private.set_activity_refs() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  internal boolean := coalesce(current_setting('app.activity_internal', true), '') = '1';
begin
  if not internal then
    new.subject := '';
    new.project_name := null;
    new.restricted := false;
  end if;
  if new.task_id is not null then
    begin
      select t.project_id, t.workspace_id, left(t.title, 500)
        into strict new.project_id, new.workspace_id, new.subject
        from public.tasks t where t.id = new.task_id;
    exception when no_data_found then
      raise exception 'task % not found', new.task_id using errcode = '23503';
    end;
  elsif new.project_id is not null then
    declare
      pname text;
    begin
      select p.workspace_id, left(p.name, 500) into strict new.workspace_id, pname from public.projects p where p.id = new.project_id;
      if not internal then new.subject := pname; end if;
    exception when no_data_found then
      raise exception 'project % not found', new.project_id using errcode = '23503';
    end;
  end if;
  return new;
end
$$;

-- Tarefa excluída: os registros dela são desvinculados (task_id nulo), passam a mostrar o título final e entra
-- um registro "deleted". Quando o projeto inteiro está sendo excluído, o registro da exclusão é o do projeto.
-- Na exclusão do workspace não há o que guardar: o histórico vai junto com ele.
create function private.keep_task_history() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  update public.activity a set task_id = null, subject = left(old.title, 500) where a.task_id = old.id;
  if not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;
  end if;
  perform set_config('app.activity_internal', '1', true);
  insert into public.activity (workspace_id, actor_id, verb, project_id, subject, extra)
  values (old.workspace_id, private.my_member_id(old.workspace_id), 'deleted', old.project_id, left(old.title, 500), old.key);
  perform set_config('app.activity_internal', '', true);
  return old;
end
$$;
create trigger tasks_keep_history before delete on public.tasks for each row execute function private.keep_task_history();

-- Projeto excluído: os registros dele são desvinculados (project_id nulo), guardam o nome do projeto e se era
-- privado, e entra um registro "deleted project". Na exclusão do workspace inteiro nada é guardado.
create function private.keep_project_history() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  update public.activity a
     set project_id = null,
         subject = coalesce((select left(t.title, 500) from public.tasks t where t.id = a.task_id), a.subject),
         project_name = left(old.name, 120),
         restricted = old.is_private
   where a.project_id = old.id;
  perform set_config('app.activity_internal', '1', true);
  insert into public.activity (workspace_id, actor_id, verb, subject, project_name, restricted)
  values (old.workspace_id, private.my_member_id(old.workspace_id), 'deleted project', left(old.name, 500), left(old.name, 120), old.is_private);
  perform set_config('app.activity_internal', '', true);
  return old;
end
$$;
create trigger projects_keep_history before delete on public.projects for each row execute function private.keep_project_history();

revoke all on function private.keep_task_history() from public, anon;
revoke all on function private.keep_project_history() from public, anon;

-- Quem lê o histórico:
--   · de um projeto existente: quem enxerga o projeto (como antes);
--   · do workspace, sem projeto: qualquer membro (como antes);
--   · de um projeto excluído: quem fez a ação, o dono do workspace e, se o projeto não era privado,
--     os demais membros que não são convidados. O que era privado continua restrito depois de excluído.
alter policy activity_select on public.activity
  using (
    private.is_member(workspace_id)
    and (
      project_id in (select p.id from public.projects p)
      or (
        project_id is null
        and (
          project_name is null
          or actor_id = private.my_member_id(workspace_id)
          or private.my_role(workspace_id) = 'owner'
          or (not restricted and private.my_role(workspace_id) <> 'guest')
        )
      )
    )
  );

-- ---------------------------------------------------------------------
-- 3. Índices para chaves estrangeiras sem índice
-- ---------------------------------------------------------------------

create index events_created_by_idx on public.events (created_by);
create index member_state_workspace_idx on public.member_state (workspace_id);
create index members_invited_by_idx on public.members (invited_by);
create index projects_created_by_idx on public.projects (created_by);
create index saved_views_created_by_idx on public.saved_views (created_by);
create index tasks_created_by_idx on public.tasks (created_by);
create index workspaces_created_by_idx on public.workspaces (created_by);
