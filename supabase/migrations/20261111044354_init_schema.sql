-- =====================================================================
-- Dash · schema inicial
--
-- Modelo: um usuário (auth.users / profiles) participa de workspaces por
-- meio de linhas em `members`. Todo dado de trabalho pertence a um
-- workspace e é protegido por RLS com base no papel do membro
-- (owner, admin, member, guest) e na permissão por projeto.
--
-- Funções com privilégio elevado (security definer) ficam no schema
-- `private`, que não é exposto pela Data API. O que precisa ser chamado
-- pelo cliente tem um wrapper `security invoker` em `public`.
-- =====================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  prefs jsonb not null default '{}'::jsonb,
  notif_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Dados e preferências pessoais do usuário (um por conta).';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  color text not null default '#2F2E2A' check (char_length(color) <= 32),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  icon text not null default 'users' check (char_length(icon) <= 40),
  color text not null default '#8A867E' check (char_length(color) <= 32),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now()
);
create index teams_workspace_idx on public.teams (workspace_id);

-- Identidade de uma pessoa DENTRO de um workspace. `user_id` nulo = convite
-- pendente (a linha é vinculada à conta quando a pessoa entra com o mesmo e-mail).
create table public.members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'guest')),
  status text not null default 'invited' check (status in ('active', 'invited', 'deactivated')),
  team_id uuid references public.teams (id) on delete set null,
  title text not null default '' check (char_length(title) <= 120),
  color text not null default '#6B7280' check (char_length(color) <= 32),
  timezone text not null default '' check (char_length(timezone) <= 80),
  last_seen_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (workspace_id, user_id)
);
create index members_user_idx on public.members (user_id);
create index members_team_idx on public.members (team_id);
create index members_email_pending_idx on public.members (email) where user_id is null;

-- Estado pessoal do membro no workspace (ordem dos projetos, buscas recentes, configuração das views).
create table public.member_state (
  member_id uuid primary key references public.members (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null check (key ~ '^[A-Z0-9]{1,10}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  icon text not null default 'folder' check (char_length(icon) <= 40),
  color text not null default 'indigo' check (char_length(color) <= 32),
  status text not null default 'planning' check (status in ('planning', 'active', 'risk', 'hold', 'complete')),
  team_id uuid references public.teams (id) on delete set null,
  lead_id uuid references public.members (id) on delete set null,
  start_date date,
  due_date date,
  description text not null default '' check (char_length(description) <= 20000),
  is_private boolean not null default false,
  milestones jsonb not null default '[]'::jsonb check (jsonb_typeof(milestones) = 'array'),
  task_seq integer not null default 200 check (task_seq >= 0),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_workspace_idx on public.projects (workspace_id);
create index projects_team_idx on public.projects (team_id);
create index projects_lead_idx on public.projects (lead_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  permission text check (permission in ('Can view', 'Can comment', 'Can edit', 'Full access')),
  created_at timestamptz not null default now(),
  primary key (project_id, member_id)
);
create index project_members_member_idx on public.project_members (member_id);
create index project_members_workspace_idx on public.project_members (workspace_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 24),
  title text not null check (char_length(title) between 1 and 500),
  description text not null default '' check (char_length(description) <= 100000),
  status text not null default 'todo' check (status in ('backlog', 'todo', 'progress', 'review', 'done')),
  prev_status text check (prev_status in ('backlog', 'todo', 'progress', 'review', 'done')),
  priority text not null default 'none' check (priority in ('urgent', 'high', 'medium', 'low', 'none')),
  assignee_id uuid references public.members (id) on delete set null,
  start_date date,
  due_date date,
  estimate text check (char_length(estimate) <= 40),
  labels text[] not null default '{}'::text[],
  recurrence text check (recurrence in ('Daily', 'Weekly', 'Every 2 weeks', 'Monthly')),
  position double precision not null default 0,
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_workspace_idx on public.tasks (workspace_id);
create index tasks_assignee_idx on public.tasks (assignee_id);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  done boolean not null default false,
  assignee_id uuid references public.members (id) on delete set null,
  due_date date,
  note text not null default '' check (char_length(note) <= 20000),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index subtasks_task_idx on public.subtasks (task_id);
create index subtasks_workspace_idx on public.subtasks (workspace_id);
create index subtasks_assignee_idx on public.subtasks (assignee_id);

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_id uuid not null references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
create index task_dependencies_depends_idx on public.task_dependencies (depends_on_id);
create index task_dependencies_workspace_idx on public.task_dependencies (workspace_id);

-- Um único registro por arquivo: aparece na aba Files do projeto e, se `task_id`
-- estiver preenchido, também como anexo da tarefa. O conteúdo fica no Storage.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  name text not null check (char_length(name) between 1 and 255),
  kind text not null default 'file' check (char_length(kind) <= 20),
  mime text not null default '' check (char_length(mime) <= 255),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text check (char_length(storage_path) <= 1024),
  uploaded_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index files_project_idx on public.files (project_id);
create index files_task_idx on public.files (task_id);
create index files_workspace_idx on public.files (workspace_id);
create index files_uploaded_by_idx on public.files (uploaded_by);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.members (id) on delete set null,
  body text not null check (char_length(body) between 1 and 20000),
  reactions jsonb not null default '{}'::jsonb check (jsonb_typeof(reactions) = 'object'),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_task_idx on public.comments (task_id);
create index comments_workspace_idx on public.comments (workspace_id);
create index comments_author_idx on public.comments (author_id);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references public.members (id) on delete set null,
  verb text not null check (char_length(verb) between 1 and 80),
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  extra text not null default '' check (char_length(extra) <= 600),
  created_at timestamptz not null default now()
);
create index activity_workspace_created_idx on public.activity (workspace_id, created_at desc);
create index activity_task_idx on public.activity (task_id);
create index activity_project_idx on public.activity (project_id);
create index activity_actor_idx on public.activity (actor_id);

-- Geradas por triggers (atribuição, menção, comentário, mudança de status). O cliente só marca como lida ou apaga.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_id uuid not null references public.members (id) on delete cascade,
  actor_id uuid references public.members (id) on delete set null,
  type text not null check (type in ('mention', 'assign', 'comment', 'update')),
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 200),
  snippet text not null default '' check (char_length(snippet) <= 400),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_workspace_idx on public.notifications (workspace_id);
create index notifications_task_idx on public.notifications (task_id);
create index notifications_project_idx on public.notifications (project_id);
create index notifications_actor_idx on public.notifications (actor_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  event_date date not null,
  event_time text not null default '' check (event_time = '' or event_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index events_workspace_idx on public.events (workspace_id);
create index events_project_idx on public.events (project_id);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  type text not null default 'list' check (char_length(type) <= 20),
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index saved_views_project_idx on public.saved_views (project_id);
create index saved_views_workspace_idx on public.saved_views (workspace_id);

-- Favoritos são pessoais (um membro não vê os favoritos do outro).
create table public.task_favorites (
  member_id uuid not null references public.members (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, task_id)
);
create index task_favorites_task_idx on public.task_favorites (task_id);
create index task_favorites_workspace_idx on public.task_favorites (workspace_id);

create table public.project_favorites (
  member_id uuid not null references public.members (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, project_id)
);
create index project_favorites_project_idx on public.project_favorites (project_id);
create index project_favorites_workspace_idx on public.project_favorites (workspace_id);

-- ---------------------------------------------------------------------
-- Funções auxiliares de autorização (schema private, security definer)
-- ---------------------------------------------------------------------

create function private.my_member_id(ws uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.id from public.members m
  where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.status = 'active'
$$;

create function private.my_role(ws uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.members m
  where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.status = 'active'
$$;

create function private.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.my_role(ws) is not null $$;

create function private.can_write(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role(ws) in ('owner', 'admin', 'member'), false) $$;

create function private.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role(ws) in ('owner', 'admin'), false) $$;

-- Nível de acesso do usuário atual a um projeto:
-- 0 sem acesso · 1 ver · 2 comentar · 3 editar · 4 acesso total.
-- Visibilidade: dono do workspace (sempre, para que nenhum projeto fique órfão), líder do projeto, criador
-- (enquanto não for convidado), membro do projeto, ou qualquer não-convidado quando o projeto não é privado.
create function private.project_perm(pid uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case
      -- coalesce: lead_id e created_by podem ser nulos, e "nulo" nunca pode virar acesso
      when not coalesce(
        m.role = 'owner'
        or p.lead_id is not distinct from m.id
        or (p.created_by is not distinct from (select auth.uid()) and m.role <> 'guest')
        or pm.member_id is not null
        or (not p.is_private and m.role <> 'guest'),
        false
      ) then 0
      when m.role in ('owner', 'admin') or p.lead_id is not distinct from m.id
        or (p.created_by is not distinct from (select auth.uid()) and m.role <> 'guest') then 4
      when pm.permission = 'Full access' then 4
      when pm.permission = 'Can edit' then 3
      when pm.permission = 'Can comment' then 2
      when pm.permission = 'Can view' then 1
      when m.role = 'guest' then 2
      else 3
    end
    from public.projects p
    join public.members m on m.workspace_id = p.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'
    left join public.project_members pm on pm.project_id = p.id and pm.member_id = m.id
    where p.id = pid
  ), 0)
$$;

-- O mesmo critério de visibilidade, para um membro qualquer (usado ao entregar notificações).
create function private.member_can_see_project(mid uuid, pid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.members m on m.id = mid and m.workspace_id = p.workspace_id and m.status = 'active'
    left join public.project_members pm on pm.project_id = p.id and pm.member_id = m.id
    where p.id = pid
      and coalesce(
        m.role = 'owner' or p.lead_id is not distinct from m.id or (p.created_by is not distinct from m.user_id and m.role <> 'guest')
        or pm.member_id is not null or (not p.is_private and m.role <> 'guest'),
        false
      )
  )
$$;

create function private.in_workspace(mid uuid, ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select mid is null or exists (select 1 from public.members m where m.id = mid and m.workspace_id = ws) $$;

create function private.task_perm(tid uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select coalesce((select private.project_perm(t.project_id) from public.tasks t where t.id = tid), 0) $$;

-- Caminho no Storage: {workspace_id}/{project_id}/{file_id}/{nome}. Devolve o nível de acesso ao projeto do caminho.
create function private.storage_perm(object_name text) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  parts text[] := string_to_array(object_name, '/');
  ws uuid;
  pid uuid;
begin
  if array_length(parts, 1) < 4 then return 0; end if;
  begin
    ws := parts[1]::uuid;
    pid := parts[2]::uuid;
  exception when others then
    return 0;
  end;
  if not exists (select 1 from public.projects p where p.id = pid and p.workspace_id = ws) then return 0; end if;
  return private.project_perm(pid);
end
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------
-- Triggers de consistência
-- ---------------------------------------------------------------------

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces for each row execute function private.touch_updated_at();
create trigger members_touch before update on public.members for each row execute function private.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function private.touch_updated_at();
create trigger member_state_touch before update on public.member_state for each row execute function private.touch_updated_at();

-- O workspace de uma linha filha é sempre o do pai: o valor enviado pelo cliente é ignorado.
create function private.set_ws_from_project() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.project_id is not null then
    begin
      select p.workspace_id into strict new.workspace_id from public.projects p where p.id = new.project_id;
    exception when no_data_found then
      raise exception 'project % not found', new.project_id using errcode = '23503';
    end;
  end if;
  return new;
end
$$;

create function private.set_ws_from_task() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    select t.workspace_id into strict new.workspace_id from public.tasks t where t.id = new.task_id;
  exception when no_data_found then
    raise exception 'task % not found', new.task_id using errcode = '23503';
  end;
  return new;
end
$$;

create function private.set_ws_from_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    select m.workspace_id into strict new.workspace_id from public.members m where m.id = new.member_id;
  exception when no_data_found then
    raise exception 'member % not found', new.member_id using errcode = '23503';
  end;
  return new;
end
$$;

-- Referências a pessoas e times precisam ser do mesmo workspace da linha (as FKs sozinhas não garantem isso).
-- Roda depois dos triggers *_set_ws (ordem alfabética do nome), quando workspace_id já é o do pai.
create function private.check_same_workspace() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  ok boolean := true;
begin
  case tg_table_name
    when 'tasks' then ok := private.in_workspace(new.assignee_id, new.workspace_id);
    when 'subtasks' then ok := private.in_workspace(new.assignee_id, new.workspace_id);
    when 'projects' then
      ok := private.in_workspace(new.lead_id, new.workspace_id)
        and (new.team_id is null or exists (select 1 from public.teams t where t.id = new.team_id and t.workspace_id = new.workspace_id));
    when 'project_members' then ok := private.in_workspace(new.member_id, new.workspace_id);
    when 'members' then
      ok := new.team_id is null or exists (select 1 from public.teams t where t.id = new.team_id and t.workspace_id = new.workspace_id);
    when 'task_dependencies' then
      ok := exists (select 1 from public.tasks t where t.id = new.depends_on_id and t.workspace_id = new.workspace_id);
    when 'files' then
      ok := new.task_id is null or exists (select 1 from public.tasks t where t.id = new.task_id and t.project_id = new.project_id);
    when 'task_favorites' then ok := private.in_workspace(new.member_id, new.workspace_id);
    when 'project_favorites' then ok := private.in_workspace(new.member_id, new.workspace_id);
    else ok := true;
  end case;
  if not ok then
    raise exception 'referenced record belongs to another workspace' using errcode = '23514';
  end if;
  return new;
end
$$;

-- Atividade: projeto e workspace vêm da tarefa (ou do projeto) a que o registro se refere.
create function private.set_activity_refs() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.task_id is not null then
    begin
      select t.project_id, t.workspace_id into strict new.project_id, new.workspace_id from public.tasks t where t.id = new.task_id;
    exception when no_data_found then
      raise exception 'task % not found', new.task_id using errcode = '23503';
    end;
  elsif new.project_id is not null then
    begin
      select p.workspace_id into strict new.workspace_id from public.projects p where p.id = new.project_id;
    exception when no_data_found then
      raise exception 'project % not found', new.project_id using errcode = '23503';
    end;
  end if;
  return new;
end
$$;

-- Autoria não é escolhida pelo cliente: quem cria é o usuário da sessão, e isso não muda depois.
create function private.stamp_author() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then return new; end if; -- manutenção direta no banco (sem sessão de usuário)
  if tg_table_name = 'files' then
    -- em update só é aceito limpar o valor (é o que a FK faz quando o membro é apagado)
    if tg_op = 'INSERT' then new.uploaded_by := private.my_member_id(new.workspace_id);
    elsif new.uploaded_by is not null then new.uploaded_by := old.uploaded_by; end if;
  else
    if tg_op = 'INSERT' then new.created_by := uid;
    elsif new.created_by is not null then new.created_by := old.created_by; end if;
  end if;
  return new;
end
$$;

-- Projetos: o workspace não muda; líder e privacidade só mudam por quem tem acesso total.
create function private.guard_project_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
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

-- Conta apagada: a pessoa deixa de ser membro ativo (a linha fica para preservar autoria e histórico).
create function private.member_account_removed() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.user_id is not null and new.user_id is null then
    new.status := 'deactivated';
  end if;
  return new;
end
$$;

create trigger tasks_set_ws before insert or update of project_id, workspace_id on public.tasks for each row execute function private.set_ws_from_project();
create trigger files_set_ws before insert or update of project_id, workspace_id on public.files for each row execute function private.set_ws_from_project();
create trigger events_set_ws before insert or update of project_id, workspace_id on public.events for each row execute function private.set_ws_from_project();
create trigger saved_views_set_ws before insert or update of project_id, workspace_id on public.saved_views for each row execute function private.set_ws_from_project();
create trigger project_members_set_ws before insert or update of project_id, workspace_id on public.project_members for each row execute function private.set_ws_from_project();
create trigger project_favorites_set_ws before insert or update of project_id, workspace_id on public.project_favorites for each row execute function private.set_ws_from_project();
create trigger subtasks_set_ws before insert or update of task_id, workspace_id on public.subtasks for each row execute function private.set_ws_from_task();
create trigger task_dependencies_set_ws before insert or update of task_id, workspace_id on public.task_dependencies for each row execute function private.set_ws_from_task();
create trigger comments_set_ws before insert or update of task_id, workspace_id on public.comments for each row execute function private.set_ws_from_task();
create trigger task_favorites_set_ws before insert or update of task_id, workspace_id on public.task_favorites for each row execute function private.set_ws_from_task();
create trigger member_state_set_ws before insert or update of member_id, workspace_id on public.member_state for each row execute function private.set_ws_from_member();
create trigger task_favorites_z_same_ws before insert or update on public.task_favorites for each row execute function private.check_same_workspace();
create trigger project_favorites_z_same_ws before insert or update on public.project_favorites for each row execute function private.check_same_workspace();

-- nomes começam com "z" para rodar depois dos triggers *_set_ws
create trigger tasks_z_same_ws before insert or update on public.tasks for each row execute function private.check_same_workspace();
create trigger subtasks_z_same_ws before insert or update on public.subtasks for each row execute function private.check_same_workspace();
create trigger projects_z_same_ws before insert or update on public.projects for each row execute function private.check_same_workspace();
create trigger project_members_z_same_ws before insert or update on public.project_members for each row execute function private.check_same_workspace();
create trigger members_z_same_ws before insert or update on public.members for each row execute function private.check_same_workspace();
create trigger task_dependencies_z_same_ws before insert or update on public.task_dependencies for each row execute function private.check_same_workspace();
create trigger files_z_same_ws before insert or update on public.files for each row execute function private.check_same_workspace();

create trigger projects_stamp before insert or update on public.projects for each row execute function private.stamp_author();
create trigger tasks_stamp before insert or update on public.tasks for each row execute function private.stamp_author();
create trigger events_stamp before insert or update on public.events for each row execute function private.stamp_author();
create trigger saved_views_stamp before insert or update on public.saved_views for each row execute function private.stamp_author();
create trigger files_z_stamp before insert or update on public.files for each row execute function private.stamp_author();

create trigger projects_guard before update on public.projects for each row execute function private.guard_project_update();
create trigger activity_set_refs before insert on public.activity for each row execute function private.set_activity_refs();
create trigger members_account_removed before update of user_id on public.members for each row execute function private.member_account_removed();

-- Membros: o próprio membro edita seus dados de exibição; papel, status e vínculo de conta
-- só mudam por admin (e a posse do workspace não muda pela API).
create function private.guard_member_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  admin boolean;
begin
  if coalesce(current_setting('app.bypass_member_guard', true), '') = '1' or (select auth.uid()) is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- o dono só sai junto com o workspace (cascata da exclusão do próprio workspace)
    if old.role = 'owner' and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      raise exception 'the workspace owner cannot be removed' using errcode = '42501';
    end if;
    return old;
  end if;
  admin := private.is_admin(new.workspace_id);
  if tg_op = 'INSERT' then
    if new.user_id is not null or new.status <> 'invited' or new.role = 'owner' then
      raise exception 'members can only be added as pending invitations' using errcode = '42501';
    end if;
    if new.role = 'admin' and not admin then
      raise exception 'only admins can invite admins' using errcode = '42501';
    end if;
    new.invited_by := (select auth.uid());
    return new;
  end if;
  if new.workspace_id is distinct from old.workspace_id or new.user_id is distinct from old.user_id then
    raise exception 'workspace and account of a member cannot be changed' using errcode = '42501';
  end if;
  if new.email is distinct from old.email and (old.user_id is not null or not admin) then
    raise exception 'member email cannot be changed' using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    if not admin or old.role = 'owner' or new.role = 'owner' then
      raise exception 'not allowed to change this role' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    if not admin or old.role = 'owner' or (new.status = 'active' and old.user_id is null) then
      raise exception 'not allowed to change this member status' using errcode = '42501';
    end if;
  end if;
  if new.team_id is distinct from old.team_id and not private.can_write(new.workspace_id) then
    raise exception 'not allowed to change teams' using errcode = '42501';
  end if;
  -- Nome, cargo, cor e fuso são do próprio membro (ou de um admin); os demais só mexem na alocação de time.
  if not admin and old.user_id is distinct from (select auth.uid())
     and (new.name, new.title, new.color, new.timezone) is distinct from (old.name, old.title, old.color, old.timezone) then
    raise exception 'not allowed to edit another member' using errcode = '42501';
  end if;
  new.last_seen_at := old.last_seen_at;
  new.invited_by := old.invited_by;
  return new;
end
$$;
create trigger members_guard before insert or update or delete on public.members for each row execute function private.guard_member_write();

-- Comentários: quem não é o autor só pode alterar reações.
create function private.guard_comment_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return new; end if;
  -- o próprio banco limpa a autoria quando o membro é apagado (FK on delete set null)
  if new.author_id is null and old.author_id is not null and not exists (select 1 from public.members m where m.id = old.author_id) then
    return new;
  end if;
  if new.task_id is distinct from old.task_id or new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
    raise exception 'comment task, author and date cannot be changed' using errcode = '42501';
  end if;
  if new.body is distinct from old.body or new.edited_at is distinct from old.edited_at then
    if old.author_id is distinct from private.my_member_id(old.workspace_id) then
      raise exception 'only the author can edit a comment' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger comments_guard before update on public.comments for each row execute function private.guard_comment_update();

-- ---------------------------------------------------------------------
-- Notificações geradas no banco
-- ---------------------------------------------------------------------

create function private.status_name(s text) returns text
language sql immutable set search_path = ''
as $$
  select case s when 'backlog' then 'Backlog' when 'todo' then 'To Do' when 'progress' then 'In Progress'
    when 'review' then 'Review' when 'done' then 'Done' else s end
$$;

create function private.notify(ws uuid, recipient uuid, actor uuid, kind text, tid uuid, pid uuid, txt text, snip text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if recipient is null or recipient is not distinct from actor then return; end if;
  -- Cada pessoa pode silenciar um tipo de notificação em profiles.notif_prefs (chave inapp_<tipo> = false).
  insert into public.notifications (workspace_id, recipient_id, actor_id, type, task_id, project_id, text, snippet)
  select ws, m.id, actor, kind, tid, pid, left(txt, 200), left(snip, 400)
  from public.members m
  join public.profiles p on p.id = m.user_id
  where m.id = recipient and m.workspace_id = ws and m.status = 'active'
    and coalesce(p.notif_prefs ->> ('inapp_' || kind), 'true') <> 'false'
    and (pid is null or private.member_can_see_project(m.id, pid));
end
$$;

create function private.notify_task_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := private.my_member_id(new.workspace_id);
  due_txt text := case when new.due_date is null then 'No due date' else 'Due ' || to_char(new.due_date, 'Mon FMDD') end;
begin
  if tg_op = 'INSERT' then
    perform private.notify(new.workspace_id, new.assignee_id, actor, 'assign', new.id, new.project_id, 'assigned you',
      due_txt || ' · ' || initcap(new.priority) || ' priority');
    return null;
  end if;
  if new.archived_at is not null then return null; end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform private.notify(new.workspace_id, new.assignee_id, actor, 'assign', new.id, new.project_id, 'assigned you',
      due_txt || ' · ' || initcap(new.priority) || ' priority');
  elsif new.status is distinct from old.status then
    if new.status = 'done' then
      perform private.notify(new.workspace_id, new.assignee_id, actor, 'update', new.id, new.project_id, 'completed', new.title);
    else
      perform private.notify(new.workspace_id, new.assignee_id, actor, 'update', new.id, new.project_id,
        'moved to ' || private.status_name(new.status), private.status_name(old.status) || ' → ' || private.status_name(new.status));
    end if;
  end if;
  return null;
end
$$;
create trigger tasks_notify after insert or update of assignee_id, status on public.tasks for each row execute function private.notify_task_change();

create function private.notify_comment() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  r record;
  mentioned uuid[] := '{}';
begin
  select id, project_id, assignee_id into t from public.tasks where id = new.task_id;
  for r in
    select m.id from public.members m
    where m.workspace_id = new.workspace_id and m.id is distinct from new.author_id
      and new.body ~ ('@' || regexp_replace(m.name, '([][\\.^$*+?(){}|-])', '\\\1', 'g') || '([^[:alnum:]_]|$)')
  loop
    mentioned := mentioned || r.id;
    perform private.notify(new.workspace_id, r.id, new.author_id, 'mention', t.id, t.project_id, 'mentioned you in', new.body);
  end loop;
  if t.assignee_id is not null and not (t.assignee_id = any (mentioned)) then
    perform private.notify(new.workspace_id, t.assignee_id, new.author_id, 'comment', t.id, t.project_id, 'commented on', new.body);
  end if;
  return null;
end
$$;
create trigger comments_notify after insert on public.comments for each row execute function private.notify_comment();

-- ---------------------------------------------------------------------
-- Contas, workspaces e convites
-- ---------------------------------------------------------------------

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 120)
  )
  on conflict (id) do nothing;
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- Vincula convites pendentes (mesmo e-mail, já confirmado) à conta que acabou de entrar.
create function private.claim_invitations() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  u record;
  n integer := 0;
begin
  if uid is null then return 0; end if;
  select lower(au.email) as email, au.email_confirmed_at, p.full_name
    into u
    from auth.users au left join public.profiles p on p.id = au.id
    where au.id = uid;
  if u.email is null or u.email_confirmed_at is null then return 0; end if;
  perform set_config('app.bypass_member_guard', '1', true);
  update public.members m
     set user_id = uid,
         status = 'active',
         name = coalesce(nullif(btrim(u.full_name), ''), m.name),
         last_seen_at = now()
   where m.user_id is null and m.status = 'invited' and m.email = u.email
     and not exists (select 1 from public.members x where x.workspace_id = m.workspace_id and x.user_id = uid);
  get diagnostics n = row_count;
  perform set_config('app.bypass_member_guard', '', true);
  return n;
end
$$;

create function private.slugify(txt text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(left(btrim(regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]+', '-', 'g'), '-'), 48), ''), 'workspace')
$$;

create function private.create_workspace(p_name text, p_slug text, p_color text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  prof record;
  base text := private.slugify(coalesce(nullif(btrim(p_slug), ''), p_name));
  candidate text := base;
  i integer := 1;
  ws_id uuid;
  mem_id uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'workspace name is required' using errcode = '22023'; end if;
  if (select count(*) from public.members m where m.user_id = uid and m.role = 'owner') >= 25 then
    raise exception 'workspace limit reached' using errcode = '54000';
  end if;
  select p.email, p.full_name into prof from public.profiles p where p.id = uid;
  if prof.email is null then raise exception 'profile not found' using errcode = '42501'; end if;
  while exists (select 1 from public.workspaces w where w.slug = candidate) loop
    i := i + 1;
    candidate := base || '-' || i;
  end loop;
  insert into public.workspaces (name, slug, color, created_by)
  values (btrim(p_name), candidate, coalesce(nullif(btrim(p_color), ''), '#2F2E2A'), uid)
  returning id into ws_id;
  perform set_config('app.bypass_member_guard', '1', true);
  insert into public.members (workspace_id, user_id, email, name, role, status, color, last_seen_at)
  values (ws_id, uid, prof.email, coalesce(nullif(btrim(prof.full_name), ''), split_part(prof.email, '@', 1)), 'owner', 'active', '#5A67D8', now())
  returning id into mem_id;
  perform set_config('app.bypass_member_guard', '', true);
  insert into public.member_state (member_id, workspace_id) values (mem_id, ws_id);
  return jsonb_build_object('workspace_id', ws_id, 'member_id', mem_id, 'slug', candidate);
end
$$;

create function private.workspace_slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from public.workspaces w where w.slug = private.slugify(p_slug)) $$;

create function private.touch_presence(ws uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.bypass_member_guard', '1', true);
  update public.members set last_seen_at = now()
   where workspace_id = ws and user_id = (select auth.uid()) and status = 'active';
  perform set_config('app.bypass_member_guard', '', true);
end
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Wrappers expostos pela Data API (security invoker).
create function public.claim_invitations() returns integer
language sql security invoker set search_path = ''
as $$ select private.claim_invitations() $$;

create function public.create_workspace(p_name text, p_slug text default null, p_color text default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.create_workspace(p_name, p_slug, p_color) $$;

create function public.workspace_slug_available(p_slug text) returns boolean
language sql security invoker set search_path = ''
as $$ select private.workspace_slug_available(p_slug) $$;

create function public.touch_presence(ws uuid) returns void
language sql security invoker set search_path = ''
as $$ select private.touch_presence(ws) $$;

revoke all on function public.claim_invitations() from public, anon;
revoke all on function public.create_workspace(text, text, text) from public, anon;
revoke all on function public.workspace_slug_available(text) from public, anon;
revoke all on function public.touch_presence(uuid) from public, anon;
grant execute on function public.claim_invitations() to authenticated;
grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.workspace_slug_available(text) to authenticated;
grant execute on function public.touch_presence(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Privilégios: só usuários autenticados acessam; o papel anon não lê nada.
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, prefs, notif_prefs) on public.profiles to authenticated;
grant select, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on
  public.teams, public.members, public.member_state, public.projects, public.project_members, public.tasks,
  public.subtasks, public.task_dependencies, public.files, public.comments, public.events, public.saved_views,
  public.task_favorites, public.project_favorites
  to authenticated;
grant select, insert on public.activity to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.teams enable row level security;
alter table public.members enable row level security;
alter table public.member_state enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.subtasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.files enable row level security;
alter table public.comments enable row level security;
alter table public.activity enable row level security;
alter table public.notifications enable row level security;
alter table public.events enable row level security;
alter table public.saved_views enable row level security;
alter table public.task_favorites enable row level security;
alter table public.project_favorites enable row level security;

-- profiles: cada um vê e edita só o seu.
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces: criados pela função create_workspace.
create policy workspaces_select on public.workspaces for select to authenticated using (private.is_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));
create policy workspaces_delete on public.workspaces for delete to authenticated using (private.my_role(id) = 'owner');

-- members
create policy members_select on public.members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(workspace_id));
create policy members_insert on public.members for insert to authenticated with check (private.can_write(workspace_id));
create policy members_update on public.members for update to authenticated
  using (user_id = (select auth.uid()) or private.can_write(workspace_id))
  with check (user_id = (select auth.uid()) or private.can_write(workspace_id));
create policy members_delete on public.members for delete to authenticated
  using (private.is_admin(workspace_id) or (status = 'invited' and invited_by = (select auth.uid())));

-- member_state: pessoal.
create policy member_state_all on public.member_state for all to authenticated
  using (member_id = private.my_member_id(workspace_id))
  with check (member_id = private.my_member_id(workspace_id));

-- teams
create policy teams_select on public.teams for select to authenticated using (private.is_member(workspace_id));
create policy teams_insert on public.teams for insert to authenticated with check (private.can_write(workspace_id));
create policy teams_update on public.teams for update to authenticated
  using (private.can_write(workspace_id)) with check (private.can_write(workspace_id));
create policy teams_delete on public.teams for delete to authenticated using (private.can_write(workspace_id));

-- projects
create policy projects_select on public.projects for select to authenticated
  using (
    private.is_member(workspace_id)
    and ((created_by = (select auth.uid()) and private.my_role(workspace_id) <> 'guest') or private.project_perm(id) >= 1)
  );
create policy projects_insert on public.projects for insert to authenticated
  with check (private.can_write(workspace_id));
create policy projects_update on public.projects for update to authenticated
  using (private.project_perm(id) >= 3) with check (private.project_perm(id) >= 3);
create policy projects_delete on public.projects for delete to authenticated using (private.project_perm(id) >= 4);

-- project_members
create policy project_members_select on public.project_members for select to authenticated
  using (project_id in (select p.id from public.projects p));
-- Quem edita o projeto pode adicionar pessoas com a permissão padrão; conceder uma permissão explícita,
-- alterá-la ou remover outra pessoa exige acesso total. Cada um pode sair do projeto.
create policy project_members_insert on public.project_members for insert to authenticated
  with check (private.project_perm(project_id) >= 4 or (private.project_perm(project_id) >= 3 and permission is null));
create policy project_members_update on public.project_members for update to authenticated
  using (private.project_perm(project_id) >= 4) with check (private.project_perm(project_id) >= 4);
create policy project_members_delete on public.project_members for delete to authenticated
  using (private.project_perm(project_id) >= 4 or member_id = private.my_member_id(workspace_id));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (project_id in (select p.id from public.projects p));
create policy tasks_insert on public.tasks for insert to authenticated with check (private.project_perm(project_id) >= 3);
create policy tasks_update on public.tasks for update to authenticated
  using (private.project_perm(project_id) >= 3) with check (private.project_perm(project_id) >= 3);
create policy tasks_delete on public.tasks for delete to authenticated using (private.project_perm(project_id) >= 3);

-- subtasks
create policy subtasks_select on public.subtasks for select to authenticated
  using (task_id in (select t.id from public.tasks t));
create policy subtasks_insert on public.subtasks for insert to authenticated with check (private.task_perm(task_id) >= 3);
create policy subtasks_update on public.subtasks for update to authenticated
  using (private.task_perm(task_id) >= 3) with check (private.task_perm(task_id) >= 3);
create policy subtasks_delete on public.subtasks for delete to authenticated using (private.task_perm(task_id) >= 3);

-- task_dependencies
-- As duas pontas precisam ser visíveis: o cliente nunca recebe (nem apaga por engano) vínculos com tarefas que não enxerga.
create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (task_id in (select t.id from public.tasks t) and depends_on_id in (select t.id from public.tasks t));
create policy task_dependencies_insert on public.task_dependencies for insert to authenticated
  with check (private.task_perm(task_id) >= 3 and private.task_perm(depends_on_id) >= 1);
create policy task_dependencies_update on public.task_dependencies for update to authenticated
  using (private.task_perm(task_id) >= 3) with check (private.task_perm(task_id) >= 3 and private.task_perm(depends_on_id) >= 1);
create policy task_dependencies_delete on public.task_dependencies for delete to authenticated
  using (private.task_perm(task_id) >= 3);

-- files
create policy files_select on public.files for select to authenticated
  using (project_id in (select p.id from public.projects p));
create policy files_insert on public.files for insert to authenticated with check (private.project_perm(project_id) >= 3);
create policy files_update on public.files for update to authenticated
  using (private.project_perm(project_id) >= 3) with check (private.project_perm(project_id) >= 3);
create policy files_delete on public.files for delete to authenticated using (private.project_perm(project_id) >= 3);

-- comments
create policy comments_select on public.comments for select to authenticated
  using (task_id in (select t.id from public.tasks t));
create policy comments_insert on public.comments for insert to authenticated
  with check (private.task_perm(task_id) >= 2 and author_id = private.my_member_id(workspace_id));
create policy comments_update on public.comments for update to authenticated
  using (private.task_perm(task_id) >= 2) with check (private.task_perm(task_id) >= 2);
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = private.my_member_id(workspace_id) or private.is_admin(workspace_id));

-- activity: somente inserção, em nome próprio.
create policy activity_select on public.activity for select to authenticated
  using (private.is_member(workspace_id) and (project_id is null or project_id in (select p.id from public.projects p)));
create policy activity_insert on public.activity for insert to authenticated
  with check (actor_id = private.my_member_id(workspace_id) and (project_id is null or private.project_perm(project_id) >= 2));

-- notifications: só o destinatário.
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = private.my_member_id(workspace_id));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = private.my_member_id(workspace_id)) with check (recipient_id = private.my_member_id(workspace_id));
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = private.my_member_id(workspace_id));

-- events
create policy events_select on public.events for select to authenticated
  using (private.is_member(workspace_id) and (project_id is null or project_id in (select p.id from public.projects p)));
create policy events_insert on public.events for insert to authenticated
  with check (private.can_write(workspace_id) and (project_id is null or private.project_perm(project_id) >= 3));
create policy events_update on public.events for update to authenticated
  using (private.can_write(workspace_id) and (project_id is null or private.project_perm(project_id) >= 3))
  with check (private.can_write(workspace_id) and (project_id is null or private.project_perm(project_id) >= 3));
create policy events_delete on public.events for delete to authenticated
  using (private.can_write(workspace_id) and (project_id is null or private.project_perm(project_id) >= 3));

-- saved_views: compartilhadas entre quem vê o projeto; alteradas por quem pode editá-lo.
create policy saved_views_select on public.saved_views for select to authenticated
  using (project_id in (select p.id from public.projects p));
create policy saved_views_insert on public.saved_views for insert to authenticated with check (private.project_perm(project_id) >= 3);
create policy saved_views_update on public.saved_views for update to authenticated
  using (private.project_perm(project_id) >= 3) with check (private.project_perm(project_id) >= 3);
create policy saved_views_delete on public.saved_views for delete to authenticated using (private.project_perm(project_id) >= 3);

-- favoritos: pessoais.
create policy task_favorites_all on public.task_favorites for all to authenticated
  using (member_id = private.my_member_id(workspace_id))
  with check (member_id = private.my_member_id(workspace_id) and private.task_perm(task_id) >= 1);
create policy project_favorites_all on public.project_favorites for all to authenticated
  using (member_id = private.my_member_id(workspace_id))
  with check (member_id = private.my_member_id(workspace_id) and private.project_perm(project_id) >= 1);

-- ---------------------------------------------------------------------
-- Storage: bucket privado `files`, caminho {workspace}/{projeto}/{arquivo}/{nome}
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create policy dash_files_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and private.storage_perm(name) >= 1);
create policy dash_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and private.storage_perm(name) >= 3);
create policy dash_files_update on storage.objects for update to authenticated
  using (bucket_id = 'files' and private.storage_perm(name) >= 3)
  with check (bucket_id = 'files' and private.storage_perm(name) >= 3);
create policy dash_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and private.storage_perm(name) >= 3);

-- ---------------------------------------------------------------------
-- Realtime: mudanças feitas por outros membros/dispositivos chegam ao cliente.
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table
  public.workspaces, public.teams, public.members, public.projects, public.project_members, public.tasks,
  public.subtasks, public.task_dependencies, public.files, public.comments, public.activity,
  public.notifications, public.events, public.saved_views;
