-- =====================================================================
-- Dash · Redes sociais
--
-- Acompanha o crescimento das contas de redes sociais de um workspace:
-- contas por marca, uma fotografia diária dos números de cada conta,
-- publicações, metas e a configuração e o histórico da coleta automática.
--
-- Esta migration só cria objetos novos. Nenhuma tabela, função, política
-- ou dado que já existia é modificado.
--
-- Acesso: owner, admin e member do workspace leem e escrevem; convidado
-- (guest) não vê nada desta área. A coleta automática grava com a chave
-- secreta do projeto (papel service_role), que não passa pelo RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Uma conta em uma rede. `brand` agrupa as contas da mesma marca; `handle` é o identificador
-- da conta na rede (usuário, URL do canal ou, para um site, o ID da propriedade do GA4).
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand text not null check (char_length(btrim(brand)) between 1 and 80),
  platform text not null check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  handle text not null check (char_length(btrim(handle)) between 1 and 200),
  display_name text not null default '' check (char_length(display_name) <= 120),
  url text not null default '' check (char_length(url) <= 500),
  -- falso = a coleta automática ignora a conta (os números continuam podendo ser lançados à mão)
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index social_accounts_identity_uidx on public.social_accounts (workspace_id, platform, lower(handle));
create index social_accounts_workspace_brand_idx on public.social_accounts (workspace_id, brand);
create index social_accounts_created_by_idx on public.social_accounts (created_by);
comment on table public.social_accounts is 'Contas de redes sociais acompanhadas pelo workspace, agrupadas por marca.';

-- Os números de uma conta em um dia. Uma linha por conta e por dia: gravar de novo o mesmo dia substitui os valores.
-- `followers` é o tamanho da audiência (seguidores, inscritos, assinantes ou usuários ativos, conforme a rede).
create table public.social_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  date date not null,
  followers bigint check (followers >= 0),
  following bigint check (following >= 0),
  posts_count bigint check (posts_count >= 0),
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  extra jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('apify', 'ga4', 'manual', 'csv')),
  collected_at timestamptz not null default now(),
  constraint social_snapshots_account_date_key unique (account_id, date)
);
create index social_snapshots_workspace_date_idx on public.social_snapshots (workspace_id, date);
comment on table public.social_snapshots is 'Fotografia diária dos números de cada conta (uma linha por conta e por dia).';

-- Publicações trazidas pela coleta automática. `external_id` é o identificador da publicação na rede.
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 200),
  url text not null default '' check (char_length(url) <= 1000),
  caption text not null default '' check (char_length(caption) <= 5000),
  post_type text not null default '' check (char_length(post_type) <= 40),
  posted_at timestamptz,
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  views bigint check (views >= 0),
  engagement bigint generated always as (coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0)) stored,
  source text not null default 'apify' check (source in ('apify', 'ga4', 'manual', 'csv')),
  collected_at timestamptz not null default now(),
  constraint social_posts_account_external_key unique (account_id, external_id)
);
create index social_posts_workspace_engagement_idx on public.social_posts (workspace_id, engagement desc);
create index social_posts_workspace_posted_idx on public.social_posts (workspace_id, posted_at desc);
comment on table public.social_posts is 'Publicações de cada conta, com os números de engajamento da última coleta.';

-- Meta de uma conta: chegar a `target_value` em uma métrica, opcionalmente até `target_date`.
create table public.social_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  metric text not null default 'followers' check (metric in ('followers', 'following', 'posts_count', 'views', 'likes', 'comments', 'shares')),
  target_value bigint not null check (target_value > 0),
  target_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_goals_account_metric_key unique (account_id, metric)
);
create index social_goals_workspace_idx on public.social_goals (workspace_id);
create index social_goals_created_by_idx on public.social_goals (created_by);
comment on table public.social_goals is 'Metas por conta e por métrica.';

-- Como coletar cada rede. Uma linha por rede e por workspace: trocar o actor de uma rede é mudar esta linha.
--   provider        apify (roda um actor) ou ga4 (consulta a Google Analytics Data API)
--   actor           identificador do actor na Apify, no formato usuario/nome
--   input_template  entrada enviada ao actor; {{handles}} e {{urls}} viram listas, {{handle}} e {{url}} viram texto
--   field_map       onde está cada número na resposta (ver docs/social/README.md)
--   batch           verdadeiro = uma execução com todas as contas da rede; falso = uma execução por conta
create table public.social_collectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  provider text not null default 'apify' check (provider in ('apify', 'ga4')),
  actor text not null default '' check (char_length(actor) <= 200),
  input_template jsonb not null default '{}'::jsonb check (jsonb_typeof(input_template) = 'object'),
  field_map jsonb not null default '{}'::jsonb check (jsonb_typeof(field_map) = 'object'),
  batch boolean not null default true,
  timeout_secs integer not null default 120 check (timeout_secs between 10 and 300),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_collectors_workspace_platform_key unique (workspace_id, platform)
);
comment on table public.social_collectors is 'Configuração da coleta automática de cada rede (actor, entrada e mapa de campos). Não guarda credenciais.';

-- Uma linha por rede a cada execução da coleta, com o resultado.
create table public.social_collect_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null check (platform ~ '^[a-z][a-z0-9_]{1,31}$'),
  collector_id uuid references public.social_collectors (id) on delete set null,
  status text not null check (status in ('success', 'partial', 'error')),
  message text not null default '' check (char_length(message) <= 2000),
  accounts_total integer not null default 0 check (accounts_total >= 0),
  accounts_ok integer not null default 0 check (accounts_ok >= 0),
  snapshots_written integer not null default 0 check (snapshots_written >= 0),
  posts_written integer not null default 0 check (posts_written >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);
create index social_collect_runs_latest_idx on public.social_collect_runs (workspace_id, platform, finished_at desc);
create index social_collect_runs_collector_idx on public.social_collect_runs (collector_id);
comment on table public.social_collect_runs is 'Histórico da coleta automática: uma linha por rede e por execução, com status e mensagem de erro.';

-- ---------------------------------------------------------------------
-- Triggers de consistência
-- ---------------------------------------------------------------------

-- O workspace de uma linha filha é sempre o da conta: o valor enviado pelo cliente é ignorado.
create function private.social_set_ws_from_account() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    select a.workspace_id into strict new.workspace_id from public.social_accounts a where a.id = new.account_id;
  exception when no_data_found then
    raise exception 'social account % not found', new.account_id using errcode = '23503';
  end;
  return new;
end
$$;

-- O workspace de uma conta não muda depois de criada.
create function private.social_keep_workspace() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.workspace_id := old.workspace_id;
  return new;
end
$$;

revoke all on function private.social_set_ws_from_account() from public, anon;
revoke all on function private.social_keep_workspace() from public, anon;

create trigger social_snapshots_set_ws before insert or update of account_id, workspace_id on public.social_snapshots
  for each row execute function private.social_set_ws_from_account();
create trigger social_posts_set_ws before insert or update of account_id, workspace_id on public.social_posts
  for each row execute function private.social_set_ws_from_account();
create trigger social_goals_set_ws before insert or update of account_id, workspace_id on public.social_goals
  for each row execute function private.social_set_ws_from_account();

create trigger social_accounts_keep_ws before update of workspace_id on public.social_accounts
  for each row execute function private.social_keep_workspace();
create trigger social_collectors_keep_ws before update of workspace_id on public.social_collectors
  for each row execute function private.social_keep_workspace();

-- Reaproveita as funções que o schema já tem para `updated_at` e autoria.
create trigger social_accounts_touch before update on public.social_accounts for each row execute function private.touch_updated_at();
create trigger social_goals_touch before update on public.social_goals for each row execute function private.touch_updated_at();
create trigger social_collectors_touch before update on public.social_collectors for each row execute function private.touch_updated_at();
create trigger social_accounts_stamp before insert or update on public.social_accounts for each row execute function private.stamp_author();
create trigger social_goals_stamp before insert or update on public.social_goals for each row execute function private.stamp_author();

-- ---------------------------------------------------------------------
-- Crescimento
-- ---------------------------------------------------------------------

-- Crescimento da audiência de cada conta. "Hoje" é a data em America/Sao_Paulo.
--   followers        valor da fotografia mais recente (até hoje)
--   growth_7d        followers menos o valor da fotografia mais recente com data até hoje - 7 dias
--   growth_30d       o mesmo, com 30 dias
--   growth_total     followers menos o valor da primeira fotografia
-- Conta com menos de 7 (ou 30) dias de histórico: a base é a primeira fotografia.
-- Fotografias sem `followers` ou com data futura não entram. Conta sem fotografia aparece com valores nulos.
create view public.social_account_growth with (security_invoker = true) as
with today as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
s as (
  select sn.account_id, sn.date, sn.followers
  from public.social_snapshots sn
  cross join today
  where sn.followers is not null and sn.date <= today.d
),
latest as (
  select distinct on (s.account_id) s.account_id, s.date, s.followers from s order by s.account_id, s.date desc
),
earliest as (
  select distinct on (s.account_id) s.account_id, s.date, s.followers from s order by s.account_id, s.date asc
),
base7 as (
  select distinct on (s.account_id) s.account_id, s.followers
  from s cross join today
  where s.date <= today.d - 7
  order by s.account_id, s.date desc
),
base30 as (
  select distinct on (s.account_id) s.account_id, s.followers
  from s cross join today
  where s.date <= today.d - 30
  order by s.account_id, s.date desc
)
select
  a.id as account_id,
  a.workspace_id,
  a.brand,
  a.platform,
  a.handle,
  l.date as last_date,
  l.followers,
  e.date as first_date,
  e.followers as first_followers,
  coalesce(b7.followers, e.followers) as followers_7d_ago,
  l.followers - coalesce(b7.followers, e.followers) as growth_7d,
  round(100.0 * (l.followers - coalesce(b7.followers, e.followers)) / nullif(coalesce(b7.followers, e.followers), 0), 2) as growth_7d_pct,
  coalesce(b30.followers, e.followers) as followers_30d_ago,
  l.followers - coalesce(b30.followers, e.followers) as growth_30d,
  round(100.0 * (l.followers - coalesce(b30.followers, e.followers)) / nullif(coalesce(b30.followers, e.followers), 0), 2) as growth_30d_pct,
  l.followers - e.followers as growth_total,
  round(100.0 * (l.followers - e.followers) / nullif(e.followers, 0), 2) as growth_total_pct
from public.social_accounts a
left join latest l on l.account_id = a.id
left join earliest e on e.account_id = a.id
left join base7 b7 on b7.account_id = a.id
left join base30 b30 on b30.account_id = a.id;
comment on view public.social_account_growth is 'Audiência atual de cada conta e crescimento em 7 dias, 30 dias e desde a primeira fotografia.';

-- Totais por marca: soma das contas da marca. Os percentuais são calculados sobre a soma das bases.
create view public.social_brand_growth with (security_invoker = true) as
select
  g.workspace_id,
  g.brand,
  count(*)::integer as accounts,
  count(g.followers)::integer as accounts_with_data,
  coalesce(sum(g.followers), 0)::bigint as followers,
  coalesce(sum(g.growth_7d), 0)::bigint as growth_7d,
  round(100.0 * sum(g.growth_7d) / nullif(sum(g.followers_7d_ago), 0), 2) as growth_7d_pct,
  coalesce(sum(g.growth_30d), 0)::bigint as growth_30d,
  round(100.0 * sum(g.growth_30d) / nullif(sum(g.followers_30d_ago), 0), 2) as growth_30d_pct,
  coalesce(sum(g.growth_total), 0)::bigint as growth_total,
  round(100.0 * sum(g.growth_total) / nullif(sum(g.first_followers), 0), 2) as growth_total_pct,
  max(g.last_date) as last_date
from public.social_account_growth g
group by g.workspace_id, g.brand;
comment on view public.social_brand_growth is 'Audiência e crescimento somados por marca (7 dias, 30 dias e total).';

-- A execução mais recente da coleta de cada rede (a tela avisa quando o status é error).
create view public.social_last_runs with (security_invoker = true) as
select distinct on (r.workspace_id, r.platform)
  r.id, r.workspace_id, r.platform, r.collector_id, r.status, r.message,
  r.accounts_total, r.accounts_ok, r.snapshots_written, r.posts_written, r.started_at, r.finished_at
from public.social_collect_runs r
order by r.workspace_id, r.platform, r.finished_at desc, r.id;
comment on view public.social_last_runs is 'Última execução da coleta automática de cada rede.';

-- ---------------------------------------------------------------------
-- Privilégios: só usuários autenticados e a coleta automática; o papel anon não lê nada.
-- ---------------------------------------------------------------------

revoke all on
  public.social_accounts, public.social_snapshots, public.social_posts, public.social_goals,
  public.social_collectors, public.social_collect_runs,
  public.social_account_growth, public.social_brand_growth, public.social_last_runs
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on
  public.social_accounts, public.social_snapshots, public.social_goals, public.social_collectors
  to authenticated;
grant select on
  public.social_posts, public.social_collect_runs,
  public.social_account_growth, public.social_brand_growth, public.social_last_runs
  to authenticated;

-- A coleta automática lê contas e configuração, grava fotografias e publicações e registra cada execução.
grant select on public.social_accounts, public.social_collectors to service_role;
grant select, insert, update on public.social_snapshots, public.social_posts to service_role;
grant select, insert on public.social_collect_runs to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.social_accounts enable row level security;
alter table public.social_snapshots enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_goals enable row level security;
alter table public.social_collectors enable row level security;
alter table public.social_collect_runs enable row level security;

-- social_accounts
create policy social_accounts_select on public.social_accounts for select to authenticated using (private.can_write(workspace_id));
create policy social_accounts_insert on public.social_accounts for insert to authenticated with check (private.can_write(workspace_id));
create policy social_accounts_update on public.social_accounts for update to authenticated
  using (private.can_write(workspace_id)) with check (private.can_write(workspace_id));
create policy social_accounts_delete on public.social_accounts for delete to authenticated using (private.can_write(workspace_id));

-- social_snapshots: pela API só entram números lançados à mão ou importados de CSV.
create policy social_snapshots_select on public.social_snapshots for select to authenticated using (private.can_write(workspace_id));
create policy social_snapshots_insert on public.social_snapshots for insert to authenticated
  with check (private.can_write(workspace_id) and source in ('manual', 'csv'));
create policy social_snapshots_update on public.social_snapshots for update to authenticated
  using (private.can_write(workspace_id)) with check (private.can_write(workspace_id) and source in ('manual', 'csv'));
create policy social_snapshots_delete on public.social_snapshots for delete to authenticated using (private.can_write(workspace_id));

-- social_posts: somente leitura pela API (quem grava é a coleta automática).
create policy social_posts_select on public.social_posts for select to authenticated using (private.can_write(workspace_id));

-- social_goals
create policy social_goals_select on public.social_goals for select to authenticated using (private.can_write(workspace_id));
create policy social_goals_insert on public.social_goals for insert to authenticated with check (private.can_write(workspace_id));
create policy social_goals_update on public.social_goals for update to authenticated
  using (private.can_write(workspace_id)) with check (private.can_write(workspace_id));
create policy social_goals_delete on public.social_goals for delete to authenticated using (private.can_write(workspace_id));

-- social_collectors: quem configura a coleta é owner ou admin.
create policy social_collectors_select on public.social_collectors for select to authenticated using (private.can_write(workspace_id));
create policy social_collectors_insert on public.social_collectors for insert to authenticated with check (private.is_admin(workspace_id));
create policy social_collectors_update on public.social_collectors for update to authenticated
  using (private.is_admin(workspace_id)) with check (private.is_admin(workspace_id));
create policy social_collectors_delete on public.social_collectors for delete to authenticated using (private.is_admin(workspace_id));

-- social_collect_runs: somente leitura pela API.
create policy social_collect_runs_select on public.social_collect_runs for select to authenticated using (private.can_write(workspace_id));
