-- =====================================================================
-- Conteúdo: banco de ideias, planejamento e kanban de produção.
--
-- Tabelas novas, isoladas das tarefas (tasks.status só aceita
-- backlog/todo/progress/review/done e as chaves CONT-* / WEB-* ficam
-- nos projetos). Nada aqui altera tabelas existentes, além de um
-- trigger AFTER INSERT em workspaces que semeia as colunas padrão.
--
-- Quem pode ler e escrever: membros ativos com papel owner, admin ou
-- member (private.can_write). Convidados não enxergam a área.
-- A chave PEC-N é atribuída pelo banco, única no workspace.
-- Publicar continua manual: não há integração com Buffer nem Trello.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Etapas do workspace. O nome fica em inglês; a interface traduz.
-- kind idea e planning ficam fora do quadro. production e published
-- são as colunas, de Descarregar até Postado. Gravar e Editar nascem
-- visíveis. Intenção de comando não é etapa.
-- ---------------------------------------------------------------------

create table if not exists public.content_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('idea', 'planning', 'production', 'published')),
  position integer not null,
  color text not null default 'gray' check (color in ('gray', 'blue', 'violet', 'teal', 'amber', 'orange', 'rose', 'green', 'red')),
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index if not exists content_stages_workspace_idx on public.content_stages (workspace_id, position);
comment on table public.content_stages is 'Etapas de conteúdo de um workspace. idea e planning não entram no kanban.';

-- Contador da chave PEC-N. O cliente não escreve nesta tabela.
create table if not exists public.content_counters (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  seq integer not null default 0 check (seq >= 0)
);
comment on table public.content_counters is 'Próximo número da chave PEC de um workspace. Só os triggers escrevem.';

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stage_id uuid not null references public.content_stages (id) on delete restrict,
  key text not null check (key ~ '^PEC-[0-9]{1,9}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  source text not null default '' check (char_length(source) <= 500),
  format text not null default '' check (format in ('', 'short', 'long', 'video', 'social')),
  brand text not null default '' check (brand in ('', 'deltai', 'fync')),
  theme text not null default '' check (char_length(theme) <= 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 16),
  objective text not null default '' check (char_length(objective) <= 4000),
  audience text not null default '' check (char_length(audience) <= 2000),
  hook text not null default '' check (char_length(hook) <= 2000),
  pillar text not null default '' check (char_length(pillar) <= 2000),
  key_points text not null default '' check (char_length(key_points) <= 8000),
  cta text not null default '' check (char_length(cta) <= 1000),
  body text not null default '' check (char_length(body) <= 100000),
  target_on date,
  trello_card_id text not null default '' check (char_length(trello_card_id) <= 40),
  position double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, key)
);
create index if not exists content_items_workspace_idx on public.content_items (workspace_id, stage_id, position);
create unique index if not exists content_items_trello_uidx
  on public.content_items (workspace_id, trello_card_id)
  where trello_card_id <> '';
comment on table public.content_items is 'Ideias e peças de conteúdo. O estágio separa o banco de ideias do quadro.';
comment on column public.content_items.key is 'Chave PEC-N, única no workspace, atribuída por trigger.';
comment on column public.content_items.brand is 'Marca: deltai (deltAI) ou fync (Fync). Nunca Finout.';
comment on column public.content_items.format is 'short, long, video ou social (Post X/Threads). Vazio numa ideia ainda sem formato.';
comment on column public.content_items.theme is 'Tema livre. Build in public é o tema fixo que já existia no Trello.';
comment on column public.content_items.body is 'Corpo em HTML sanitizado, no mesmo padrão da descrição da tarefa.';
comment on column public.content_items.trello_card_id is 'Id do card do Trello, reservado para a importação. Vazio no MVP.';

create table if not exists public.content_item_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  item_id uuid not null references public.content_items (id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'substack', 'blog', 'x', 'threads', 'instagram')),
  body text not null default '' check (char_length(body) <= 100000),
  unique (item_id, channel)
);
create index if not exists content_item_channels_item_idx on public.content_item_channels (item_id);
comment on table public.content_item_channels is 'Canais de uma peça. body é a versão daquele canal quando difere do corpo.';

-- ---------------------------------------------------------------------
-- Etapas padrão e contador. O nome fica em inglês; a interface traduz.
-- ---------------------------------------------------------------------

create or replace function private.seed_content(ws uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.content_stages (workspace_id, slug, name, kind, position, color)
  select ws, v.slug, v.name, v.kind, v.position, v.color
  from (values
    ('ideas', 'Ideas', 'idea', 0, 'gray'),
    ('planning', 'Planning', 'planning', 1, 'blue'),
    ('unload', 'Unload', 'production', 2, 'violet'),
    ('structure', 'Structure', 'production', 3, 'teal'),
    ('polish', 'Polish', 'production', 4, 'amber'),
    ('record', 'Record', 'production', 5, 'orange'),
    ('edit', 'Edit', 'production', 6, 'rose'),
    ('ready', 'Ready to post', 'production', 7, 'blue'),
    ('posted', 'Posted', 'published', 8, 'green')
  ) as v(slug, name, kind, position, color)
  on conflict (workspace_id, slug) do nothing;

  insert into public.content_counters (workspace_id, seq)
  values (ws, 0)
  on conflict (workspace_id) do nothing;
end
$$;

create or replace function private.workspaces_seed_content() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.seed_content(new.id);
  return new;
end
$$;

drop trigger if exists workspaces_seed_content on public.workspaces;
create trigger workspaces_seed_content
  after insert on public.workspaces
  for each row execute function private.workspaces_seed_content();

-- Workspaces que já existem ganham as etapas na hora em que esta migration roda.
do $$
declare r record;
begin
  for r in select id from public.workspaces loop
    perform private.seed_content(r.id);
  end loop;
end
$$;

revoke all on function private.seed_content(uuid) from public, anon, authenticated;
revoke all on function private.workspaces_seed_content() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Chave PEC-N. O valor enviado pelo cliente é ignorado na inserção.
-- Num update a chave não muda.
-- ---------------------------------------------------------------------

create or replace function private.assign_content_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
  candidate text;
begin
  if tg_op = 'UPDATE' then
    new.key := old.key;
    return new;
  end if;
  if new.workspace_id is null then
    raise exception 'content item needs a workspace' using errcode = '23503';
  end if;
  loop
    update public.content_counters c
       set seq = c.seq + 1
     where c.workspace_id = new.workspace_id
     returning c.seq into n;
    if not found then
      insert into public.content_counters as c (workspace_id, seq)
      values (new.workspace_id, 1)
      on conflict (workspace_id) do update set seq = c.seq + 1
      returning c.seq into n;
    end if;
    candidate := 'PEC-' || n;
    exit when not exists (
      select 1 from public.content_items t
      where t.workspace_id = new.workspace_id and t.key = candidate and t.id is distinct from new.id
    );
  end loop;
  new.key := candidate;
  return new;
end
$$;

revoke all on function private.assign_content_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Integridade: mesmo workspace, autoria, etapa protegida.
-- ---------------------------------------------------------------------

create or replace function private.content_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  st_ws uuid;
  item_ws uuid;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'content_stages' and old.slug in (
      'ideas', 'planning', 'unload', 'structure', 'polish', 'record', 'edit', 'ready', 'posted'
    ) then
      raise exception 'this stage cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'a content record cannot be moved to another workspace' using errcode = '42501';
  end if;

  if tg_table_name = 'content_items' then
    select s.workspace_id into st_ws from public.content_stages s where s.id = new.stage_id;
    if st_ws is null then
      raise exception 'stage not found' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and st_ws is distinct from old.workspace_id then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    new.workspace_id := st_ws;
    if uid is not null then
      if tg_op = 'INSERT' then new.created_by := uid;
      elsif new.created_by is not null then new.created_by := old.created_by;
      end if;
    end if;
  elsif tg_table_name = 'content_item_channels' then
    select i.workspace_id into item_ws from public.content_items i where i.id = new.item_id;
    if item_ws is null then
      raise exception 'content item not found' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and item_ws is distinct from old.workspace_id then
      raise exception 'referenced record belongs to another workspace' using errcode = '23514';
    end if;
    new.workspace_id := item_ws;
    if tg_op = 'UPDATE' then
      new.item_id := old.item_id;
      new.channel := old.channel;
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.content_guard() from public, anon;
grant execute on function private.content_guard() to authenticated;

drop trigger if exists content_stages_guard on public.content_stages;
create trigger content_stages_guard before delete on public.content_stages
  for each row execute function private.content_guard();

drop trigger if exists content_items_a_guard on public.content_items;
create trigger content_items_a_guard before insert or update on public.content_items
  for each row execute function private.content_guard();

-- "z" no nome: roda depois do guard, quando workspace_id já é o da etapa.
drop trigger if exists content_items_z_key on public.content_items;
create trigger content_items_z_key before insert or update on public.content_items
  for each row execute function private.assign_content_key();

drop trigger if exists content_channels_guard on public.content_item_channels;
create trigger content_channels_guard before insert or update on public.content_item_channels
  for each row execute function private.content_guard();

-- ---------------------------------------------------------------------
-- Privilégios e RLS. Convidado não lê nem escreve.
-- O contador só é lido; quem incrementa é o trigger da chave.
-- ---------------------------------------------------------------------

revoke all on public.content_stages, public.content_items, public.content_item_channels, public.content_counters
  from anon, authenticated;

grant select, insert, update, delete on public.content_stages, public.content_items, public.content_item_channels
  to authenticated;
grant select on public.content_counters to authenticated;

alter table public.content_stages enable row level security;
alter table public.content_items enable row level security;
alter table public.content_item_channels enable row level security;
alter table public.content_counters enable row level security;

drop policy if exists content_stages_select on public.content_stages;
create policy content_stages_select on public.content_stages for select to authenticated
  using (private.can_write(workspace_id));
drop policy if exists content_stages_write on public.content_stages;
create policy content_stages_write on public.content_stages for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

drop policy if exists content_items_select on public.content_items;
create policy content_items_select on public.content_items for select to authenticated
  using (private.can_write(workspace_id));
drop policy if exists content_items_write on public.content_items;
create policy content_items_write on public.content_items for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

drop policy if exists content_channels_select on public.content_item_channels;
create policy content_channels_select on public.content_item_channels for select to authenticated
  using (private.can_write(workspace_id));
drop policy if exists content_channels_write on public.content_item_channels;
create policy content_channels_write on public.content_item_channels for all to authenticated
  using (private.can_write(workspace_id))
  with check (private.can_write(workspace_id));

drop policy if exists content_counters_select on public.content_counters;
create policy content_counters_select on public.content_counters for select to authenticated
  using (private.can_write(workspace_id));

do $$
declare t text;
begin
  foreach t in array array['content_stages', 'content_items', 'content_item_channels']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
