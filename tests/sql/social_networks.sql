-- Cenários da migration 20261111170127 (redes sociais), executados como usuários simulados.
-- Roda dentro de uma transação que é desfeita no fim: não deixa nada no banco.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/social_networks.sql
--
-- Termina com "NOTICE: PASS" ou com um erro listando o que falhou.
--
-- Cobre: isolamento entre workspaces (leitura e escrita), convidado sem acesso, upsert idempotente em
-- social_snapshots, workspace herdado da conta, o que a API pode gravar, permissões da coleta automática
-- (service_role), configuração da coleta só por admin, crescimento com resultado conhecido e última execução por rede.
begin;

do $test$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ug uuid := gen_random_uuid();
  wa uuid; wb uuid;
  ax uuid := gen_random_uuid(); ay uuid := gen_random_uuid(); az uuid := gen_random_uuid(); -- contas do workspace A
  bx uuid := gen_random_uuid();                                                             -- conta do workspace B
  ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid();                               -- coletores de A e de B
  td date := (now() at time zone 'America/Sao_Paulo')::date;
  claims_a text; claims_b text; claims_m text; claims_g text;
  r jsonb; fails text[] := '{}'; n int; v bigint; ws uuid; rec record; t text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-a@dash-check.invalid', '', now(), '{}', '{"full_name":"Social A"}', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-b@dash-check.invalid', '', now(), '{}', '{"full_name":"Social B"}', now(), now()),
         (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-m@dash-check.invalid', '', now(), '{}', '{"full_name":"Social M"}', now(), now()),
         (ug, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-g@dash-check.invalid', '', now(), '{}', '{"full_name":"Social G"}', now(), now());
  claims_a := json_build_object('sub', ua, 'role', 'authenticated')::text;
  claims_b := json_build_object('sub', ub, 'role', 'authenticated')::text;
  claims_m := json_build_object('sub', um, 'role', 'authenticated')::text;
  claims_g := json_build_object('sub', ug, 'role', 'authenticated')::text;

  -- A é dono do workspace A; B é dono do workspace B
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  r := public.create_workspace('Social A', 'social-a-' || substr(ua::text, 1, 8), null);
  wa := (r ->> 'workspace_id')::uuid;
  perform set_config('request.jwt.claims', claims_b, true);
  r := public.create_workspace('Social B', 'social-b-' || substr(ub::text, 1, 8), null);
  wb := (r ->> 'workspace_id')::uuid;

  -- M é member e G é guest do workspace A (inseridos direto, como manutenção)
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.bypass_member_guard', '1', true);
  insert into public.members (workspace_id, user_id, email, name, role, status)
  values (wa, um, 'social-m@dash-check.invalid', 'Social M', 'member', 'active'),
         (wa, ug, 'social-g@dash-check.invalid', 'Social G', 'guest', 'active');
  perform set_config('app.bypass_member_guard', '', true);

  -- ---------------------------------------------------------------
  -- 1. cada dono cria contas, metas e coletor no próprio workspace
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  insert into public.social_accounts (id, workspace_id, brand, platform, handle) values
    (ax, wa, 'Acme', 'instagram', 'acme'),
    (ay, wa, 'Acme', 'tiktok', 'acme.tt'),
    (az, wa, 'Beta', 'youtube', 'betachannel');
  insert into public.social_goals (account_id, target_value, target_date) values (ax, 5000, td + 90);
  insert into public.social_collectors (id, workspace_id, platform, actor, input_template, field_map)
  values (ca, wa, 'instagram', 'apify/instagram-profile-scraper', '{"usernames":"{{handles}}"}', '{"account_key":"username","snapshot":{"followers":"followersCount"}}');
  select created_by into ws from public.social_accounts where id = ax;
  if ws is distinct from ua then fails := array_append(fails, 'account-author-not-stamped'); end if;

  perform set_config('request.jwt.claims', claims_b, true);
  insert into public.social_accounts (id, workspace_id, brand, platform, handle) values (bx, wb, 'Other', 'instagram', 'other');
  insert into public.social_snapshots (account_id, date, followers, source) values (bx, td, 77, 'manual');
  insert into public.social_goals (account_id, target_value) values (bx, 100);
  insert into public.social_collectors (id, workspace_id, platform, actor) values (cb, wb, 'instagram', 'someone/actor');

  -- a mesma conta não entra duas vezes na mesma rede (sem diferenciar maiúsculas)
  begin
    insert into public.social_accounts (workspace_id, brand, platform, handle) values (wb, 'Other', 'instagram', 'OTHER');
    fails := array_append(fails, 'duplicate-account-accepted');
  exception when unique_violation then null;
  end;

  -- ---------------------------------------------------------------
  -- 2. gravação idempotente: o mesmo upsert duas vezes deixa uma linha só
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_a, true);
  for n in 1..2 loop
    insert into public.social_snapshots (account_id, date, followers, source) values (ax, td, 1800, 'manual')
    on conflict (account_id, date) do update set followers = excluded.followers, source = excluded.source, collected_at = now();
  end loop;
  select count(*) into n from public.social_snapshots where account_id = ax and date = td;
  if n is distinct from 1 then fails := array_append(fails, (('upsert-duplicated-rows=' || n))::text); end if;
  -- gravar de novo com outro valor substitui, sem criar linha
  insert into public.social_snapshots (account_id, date, followers, source) values (ax, td, 1801, 'csv')
  on conflict (account_id, date) do update set followers = excluded.followers, source = excluded.source;
  select count(*), max(followers) into n, v from public.social_snapshots where account_id = ax and date = td;
  if n is distinct from 1 or v is distinct from 1801 then fails := array_append(fails, (format('upsert-replace(rows=%s,value=%s)', n, v))::text); end if;
  -- um insert simples do mesmo dia é recusado pela chave única
  begin
    insert into public.social_snapshots (account_id, date, followers) values (ax, td, 1);
    fails := array_append(fails, 'plain-duplicate-accepted');
  exception when unique_violation then null;
  end;
  update public.social_snapshots set followers = 1800, source = 'manual' where account_id = ax and date = td;

  -- o workspace da fotografia é o da conta, mesmo que o cliente envie outro
  insert into public.social_snapshots (workspace_id, account_id, date, followers) values (wb, ax, td - 3, 1700);
  select workspace_id into ws from public.social_snapshots where account_id = ax and date = td - 3;
  if ws is distinct from wa then fails := array_append(fails, 'snapshot-workspace-forged'); end if;
  -- e o workspace de uma conta não muda
  update public.social_accounts set workspace_id = wb where id = ax;
  select workspace_id into ws from public.social_accounts where id = ax;
  if ws is distinct from wa then fails := array_append(fails, 'account-moved-workspace'); end if;

  -- ---------------------------------------------------------------
  -- 3. isolamento: B não lê nem escreve nada do workspace A
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_b, true);
  select count(*) into n from public.social_accounts where workspace_id = wa;
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-accounts=' || n))::text); end if;
  select count(*) into n from public.social_snapshots where workspace_id = wa or account_id in (ax, ay, az);
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-snapshots=' || n))::text); end if;
  select count(*) into n from public.social_goals where workspace_id = wa;
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-goals=' || n))::text); end if;
  select count(*) into n from public.social_collectors where workspace_id = wa;
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-collectors=' || n))::text); end if;
  select count(*) into n from public.social_account_growth where workspace_id = wa;
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-growth=' || n))::text); end if;
  select count(*) into n from public.social_brand_growth where workspace_id = wa;
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-brand-growth=' || n))::text); end if;
  -- B enxerga só o que é seu
  select count(*) into n from public.social_accounts;
  if n is distinct from 1 then fails := array_append(fails, (('B-own-accounts=' || n))::text); end if;
  select count(*) into n from public.social_snapshots;
  if n is distinct from 1 then fails := array_append(fails, (('B-own-snapshots=' || n))::text); end if;

  begin
    insert into public.social_accounts (workspace_id, brand, platform, handle) values (wa, 'Hack', 'instagram', 'hack');
    fails := array_append(fails, 'B-inserted-account-in-A');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_snapshots (account_id, date, followers) values (ax, td - 300, 1);
    fails := array_append(fails, 'B-inserted-snapshot-in-A');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_snapshots (account_id, date, followers) values (ax, td, 1)
    on conflict (account_id, date) do update set followers = excluded.followers;
    fails := array_append(fails, 'B-upserted-snapshot-in-A');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_goals (account_id, target_value) values (ay, 10);
    fails := array_append(fails, 'B-inserted-goal-in-A');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_collectors (workspace_id, platform, actor) values (wa, 'tiktok', 'evil/actor');
    fails := array_append(fails, 'B-inserted-collector-in-A');
  exception when insufficient_privilege then null;
  end;
  update public.social_accounts set brand = 'Hacked' where id = ax;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'B-updated-A-account'); end if;
  update public.social_snapshots set followers = 1 where account_id = ax;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'B-updated-A-snapshot'); end if;
  update public.social_collectors set actor = 'evil/actor' where id = ca;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'B-updated-A-collector'); end if;
  delete from public.social_accounts where id = ax;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'B-deleted-A-account'); end if;
  delete from public.social_snapshots where account_id = ax;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'B-deleted-A-snapshot'); end if;
  delete from public.social_goals where account_id = ax;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'B-deleted-A-goal'); end if;
  -- B não consegue levar uma fotografia sua para uma conta de A
  begin
    update public.social_snapshots set account_id = ax, date = td - 20 where account_id = bx;
    get diagnostics n = row_count;
    if n is distinct from 0 then fails := array_append(fails, 'B-moved-snapshot-into-A'); end if;
  exception when insufficient_privilege then null;
  end;

  -- nada mudou em A
  execute 'reset role';
  select brand into t from public.social_accounts where id = ax;
  if t is distinct from 'Acme' then fails := array_append(fails, 'A-account-changed'); end if;
  select count(*) into n from public.social_snapshots where account_id = ax;
  if n is distinct from 2 then fails := array_append(fails, (('A-snapshots-changed=' || n))::text); end if;
  select actor into t from public.social_collectors where id = ca;
  if t is distinct from 'apify/instagram-profile-scraper' then fails := array_append(fails, 'A-collector-changed'); end if;

  -- ---------------------------------------------------------------
  -- 4. convidado não vê nem grava; member grava números mas não configura a coleta
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_g, true);
  execute 'set local role authenticated';
  select (select count(*) from public.social_accounts) + (select count(*) from public.social_snapshots) + (select count(*) from public.social_goals)
       + (select count(*) from public.social_collectors) + (select count(*) from public.social_account_growth) into n;
  if n is distinct from 0 then fails := array_append(fails, (('guest-reads=' || n))::text); end if;
  begin
    insert into public.social_accounts (workspace_id, brand, platform, handle) values (wa, 'Guest', 'instagram', 'guest');
    fails := array_append(fails, 'guest-inserted-account');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_snapshots (account_id, date, followers) values (ax, td - 301, 5);
    fails := array_append(fails, 'guest-inserted-snapshot');
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', claims_m, true);
  select count(*) into n from public.social_accounts;
  if n is distinct from 3 then fails := array_append(fails, (('member-reads-accounts=' || n))::text); end if;
  insert into public.social_snapshots (account_id, date, followers, source) values (ay, td, 650, 'manual'), (ay, td - 5, 500, 'csv');
  begin
    insert into public.social_collectors (workspace_id, platform, actor) values (wa, 'tiktok', 'member/actor');
    fails := array_append(fails, 'member-inserted-collector');
  exception when insufficient_privilege then null;
  end;
  update public.social_collectors set actor = 'member/actor' where id = ca;
  get diagnostics n = row_count;
  if n is distinct from 0 then fails := array_append(fails, 'member-updated-collector'); end if;

  -- ---------------------------------------------------------------
  -- 5. o que a API não grava: origem automática, publicações e histórico da coleta
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_a, true);
  begin
    insert into public.social_snapshots (account_id, date, followers, source) values (ax, td - 302, 1750, 'apify');
    fails := array_append(fails, 'api-wrote-automatic-source');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_posts (account_id, external_id) values (ax, 'forged');
    fails := array_append(fails, 'api-inserted-post');
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.social_collect_runs (workspace_id, platform, status) values (wa, 'instagram', 'success');
    fails := array_append(fails, 'api-inserted-run');
  exception when insufficient_privilege then null;
  end;
  -- trocar o actor de uma rede é mudar uma linha (admin)
  update public.social_collectors set actor = 'other/instagram-scraper' where workspace_id = wa and platform = 'instagram';
  get diagnostics n = row_count;
  select actor into t from public.social_collectors where id = ca;
  if n is distinct from 1 or t is distinct from 'other/instagram-scraper' then fails := array_append(fails, 'admin-could-not-swap-actor'); end if;

  -- ---------------------------------------------------------------
  -- 6. coleta automática (service_role): grava fotografias, publicações e execuções
  -- ---------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  select count(*) into n from public.social_accounts where workspace_id in (wa, wb);
  if n is distinct from 4 then fails := array_append(fails, (('service-reads-accounts=' || n))::text); end if;
  select count(*) into n from public.social_collectors where id in (ca, cb);
  if n is distinct from 2 then fails := array_append(fails, (('service-reads-collectors=' || n))::text); end if;
  -- histórico da conta X com resultado conhecido (ver item 7)
  insert into public.social_snapshots (account_id, date, followers, source) values
    (ax, td - 40, 1000, 'apify'), (ax, td - 30, 1200, 'apify'), (ax, td - 29, 1250, 'apify'), (ax, td - 10, 1500, 'apify'),
    (ax, td - 7, 1600, 'apify'), (ax, td - 6, 1650, 'apify'), -- td-29 e td-6 ficam logo depois das fronteiras: não podem virar base
    (ax, td + 2, 9999, 'apify'),            -- data futura: fora da conta
    (ax, td - 1, null, 'apify')             -- sem audiência: fora da conta
  on conflict (account_id, date) do update set followers = excluded.followers, source = excluded.source;
  -- a coleta do dia roda duas vezes: continua uma linha
  for n in 1..2 loop
    insert into public.social_snapshots (account_id, date, followers, following, posts_count, source) values (ax, td, 1800, 120, 45, 'apify')
    on conflict (account_id, date) do update set followers = excluded.followers, following = excluded.following,
      posts_count = excluded.posts_count, source = excluded.source, collected_at = now();
    insert into public.social_posts (account_id, external_id, url, caption, likes, comments, shares, views, posted_at)
    values (ax, 'p1', 'https://example.invalid/p1', 'First', 100, 20, 5, 3000, now() - interval '2 days'),
           (ax, 'p2', 'https://example.invalid/p2', 'Second', 300, 40, null, null, now() - interval '1 day')
    on conflict (account_id, external_id) do update set likes = excluded.likes, comments = excluded.comments,
      shares = excluded.shares, views = excluded.views, collected_at = now();
  end loop;
  select count(*) into n from public.social_snapshots where account_id = ax and date = td;
  if n is distinct from 1 then fails := array_append(fails, (('service-upsert-duplicated=' || n))::text); end if;
  select count(*) into n from public.social_posts where account_id = ax;
  if n is distinct from 2 then fails := array_append(fails, (('posts-duplicated=' || n))::text); end if;
  select engagement into v from public.social_posts where account_id = ax and external_id = 'p1';
  if v is distinct from 125 then fails := array_append(fails, (('engagement-p1=' || v))::text); end if;
  select engagement into v from public.social_posts where account_id = ax and external_id = 'p2';
  if v is distinct from 340 then fails := array_append(fails, (('engagement-p2=' || v))::text); end if;
  select workspace_id into ws from public.social_posts where account_id = ax and external_id = 'p1';
  if ws is distinct from wa then fails := array_append(fails, 'post-workspace-not-inherited'); end if;
  insert into public.social_collect_runs (workspace_id, platform, collector_id, status, message, accounts_total, accounts_ok, snapshots_written, posts_written, started_at, finished_at)
  values (wa, 'instagram', ca, 'success', '', 1, 1, 1, 2, now() - interval '2 days', now() - interval '2 days'),
         (wa, 'instagram', ca, 'error', 'actor run failed: 404', 1, 0, 0, 0, now() - interval '1 hour', now() - interval '1 hour'),
         (wa, 'tiktok', null, 'error', 'old failure', 1, 0, 0, 0, now() - interval '3 days', now() - interval '3 days'),
         (wa, 'tiktok', null, 'success', '', 1, 1, 1, 0, now() - interval '2 hours', now() - interval '2 hours'),
         (wb, 'instagram', cb, 'error', 'failure in B', 1, 0, 0, 0, now(), now());
  -- a coleta não apaga nem altera contas e configuração
  begin
    delete from public.social_accounts where id = bx;
    fails := array_append(fails, 'service-deleted-account');
  exception when insufficient_privilege then null;
  end;
  begin
    update public.social_collectors set actor = 'x/y' where id = cb;
    fails := array_append(fails, 'service-updated-collector');
  exception when insufficient_privilege then null;
  end;

  -- ---------------------------------------------------------------
  -- 7. crescimento com resultado conhecido
  --    X (Acme): 1000 há 40 dias, 1200 há 30, 1250 há 29, 1500 há 10, 1600 há 7, 1650 há 6, 1700 há 3, 1800 hoje
  --    Y (Acme): 500 há 5 dias, 650 hoje (menos de 7 dias de histórico: a base é a primeira fotografia)
  --    Z (Beta): sem fotografias
  -- ---------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  select * into rec from public.social_account_growth where account_id = ax;
  if rec.followers is distinct from 1800 or rec.last_date is distinct from td or rec.first_followers is distinct from 1000 or rec.first_date is distinct from td - 40 then
    fails := array_append(fails, (format('X-latest(%s,%s,%s,%s)', rec.followers, rec.last_date, rec.first_followers, rec.first_date))::text);
  end if;
  if rec.followers_7d_ago is distinct from 1600 or rec.growth_7d is distinct from 200 or rec.growth_7d_pct is distinct from 12.50 then
    fails := array_append(fails, (format('X-7d(%s,%s,%s)', rec.followers_7d_ago, rec.growth_7d, rec.growth_7d_pct))::text);
  end if;
  if rec.followers_30d_ago is distinct from 1200 or rec.growth_30d is distinct from 600 or rec.growth_30d_pct is distinct from 50.00 then
    fails := array_append(fails, (format('X-30d(%s,%s,%s)', rec.followers_30d_ago, rec.growth_30d, rec.growth_30d_pct))::text);
  end if;
  if rec.growth_total is distinct from 800 or rec.growth_total_pct is distinct from 80.00 then
    fails := array_append(fails, (format('X-total(%s,%s)', rec.growth_total, rec.growth_total_pct))::text);
  end if;
  select * into rec from public.social_account_growth where account_id = ay;
  if rec.followers is distinct from 650 or rec.growth_7d is distinct from 150 or rec.growth_7d_pct is distinct from 30.00 or rec.growth_30d is distinct from 150 or rec.growth_total is distinct from 150 or rec.growth_total_pct is distinct from 30.00 then
    fails := array_append(fails, (format('Y(%s,%s,%s,%s,%s,%s)', rec.followers, rec.growth_7d, rec.growth_7d_pct, rec.growth_30d, rec.growth_total, rec.growth_total_pct))::text);
  end if;
  select * into rec from public.social_account_growth where account_id = az;
  if rec.account_id is null or rec.followers is not null or rec.growth_7d is not null or rec.growth_30d is not null or rec.growth_total is not null then
    fails := array_append(fails, 'Z-should-be-empty');
  end if;
  -- por marca: Acme = X + Y
  select * into rec from public.social_brand_growth where workspace_id = wa and brand = 'Acme';
  if rec.accounts is distinct from 2 or rec.accounts_with_data is distinct from 2 or rec.followers is distinct from 2450 then
    fails := array_append(fails, (format('Acme-total(%s,%s,%s)', rec.accounts, rec.accounts_with_data, rec.followers))::text);
  end if;
  if rec.growth_7d is distinct from 350 or rec.growth_7d_pct is distinct from 16.67 then fails := array_append(fails, (format('Acme-7d(%s,%s)', rec.growth_7d, rec.growth_7d_pct))::text); end if;
  if rec.growth_30d is distinct from 750 or rec.growth_30d_pct is distinct from 44.12 then fails := array_append(fails, (format('Acme-30d(%s,%s)', rec.growth_30d, rec.growth_30d_pct))::text); end if;
  if rec.growth_total is distinct from 950 or rec.growth_total_pct is distinct from 63.33 then fails := array_append(fails, (format('Acme-all(%s,%s)', rec.growth_total, rec.growth_total_pct))::text); end if;
  if rec.last_date is distinct from td then fails := array_append(fails, (('Acme-last-date=' || rec.last_date))::text); end if;
  select * into rec from public.social_brand_growth where workspace_id = wa and brand = 'Beta';
  if rec.accounts is distinct from 1 or rec.accounts_with_data is distinct from 0 or rec.followers is distinct from 0 or rec.growth_7d is distinct from 0 or rec.growth_7d_pct is not null then
    fails := array_append(fails, (format('Beta(%s,%s,%s,%s,%s)', rec.accounts, rec.accounts_with_data, rec.followers, rec.growth_7d, rec.growth_7d_pct))::text);
  end if;
  select count(*) into n from public.social_brand_growth;
  if n is distinct from 2 then fails := array_append(fails, (('A-brand-rows=' || n))::text); end if;

  -- ---------------------------------------------------------------
  -- 8. última execução por rede: instagram com erro (e mensagem), tiktok com sucesso; B não vê as de A
  -- ---------------------------------------------------------------
  select status, message into rec from public.social_last_runs where workspace_id = wa and platform = 'instagram';
  if rec.status is distinct from 'error' or rec.message is distinct from 'actor run failed: 404' then fails := array_append(fails, (format('last-run-instagram(%s,%s)', rec.status, rec.message))::text); end if;
  select status into t from public.social_last_runs where workspace_id = wa and platform = 'tiktok';
  if t is distinct from 'success' then fails := array_append(fails, (('last-run-tiktok=' || t))::text); end if;
  select count(*) into n from public.social_last_runs;
  if n is distinct from 2 then fails := array_append(fails, (('A-last-runs=' || n))::text); end if;
  select count(*) into n from public.social_posts;
  if n is distinct from 2 then fails := array_append(fails, (('A-reads-posts=' || n))::text); end if;
  perform set_config('request.jwt.claims', claims_b, true);
  select (select count(*) from public.social_collect_runs where workspace_id = wa) + (select count(*) from public.social_last_runs where workspace_id = wa)
       + (select count(*) from public.social_posts) into n;
  if n is distinct from 0 then fails := array_append(fails, (('B-reads-A-runs-or-posts=' || n))::text); end if;
  select count(*) into n from public.social_last_runs;
  if n is distinct from 1 then fails := array_append(fails, (('B-own-last-runs=' || n))::text); end if;

  -- ---------------------------------------------------------------
  -- 9. apagar a conta leva fotografias, publicações e metas; o papel anon não tem acesso
  -- ---------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_a, true);
  delete from public.social_accounts where id = ax;
  execute 'reset role';
  select (select count(*) from public.social_snapshots where account_id = ax) + (select count(*) from public.social_posts where account_id = ax)
       + (select count(*) from public.social_goals where account_id = ax) into n;
  if n is distinct from 0 then fails := array_append(fails, (('orphans-after-account-delete=' || n))::text); end if;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  foreach t in array array['social_accounts', 'social_snapshots', 'social_posts', 'social_goals', 'social_collectors', 'social_collect_runs',
                           'social_account_growth', 'social_brand_growth', 'social_last_runs'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      fails := array_append(fails, (('anon-can-read-' || t))::text);
    exception when insufficient_privilege then null;
    end;
  end loop;
  execute 'reset role';

  -- toda tabela nova tem RLS ligado
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and c.relname like 'social\_%' and c.relrowsecurity;
  if n is distinct from 6 then fails := array_append(fails, (('tables-with-rls=' || n))::text); end if;

  if array_length(fails, 1) is not null then
    raise exception 'FAIL: %', array_to_string(fails, ', ');
  end if;
  raise notice 'PASS';
end
$test$;

rollback;
