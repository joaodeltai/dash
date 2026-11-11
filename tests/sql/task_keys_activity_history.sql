-- Cenários da migration 20261111145659 (chave de tarefa e histórico preservado), executados como usuários simulados.
-- Roda dentro de uma transação que é desfeita no fim: não deixa nada no banco.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/task_keys_activity_history.sql
--
-- Termina com "NOTICE: PASS" ou com um erro listando o que falhou.
begin;

do $test$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); ug uuid := gen_random_uuid();
  ws uuid; ma uuid;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid();
  r jsonb; fails text[] := '{}'; k1 text; k2 text; k3 text; k4 text; k text; n int; rec record;
  claims_a text; claims_b text; claims_g text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest-a@dash-check.invalid', '', now(), '{}', '{"full_name":"Test A"}', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest-b@dash-check.invalid', '', now(), '{}', '{"full_name":"Test B"}', now(), now()),
         (ug, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sqltest-g@dash-check.invalid', '', now(), '{}', '{"full_name":"Test G"}', now(), now());
  claims_a := json_build_object('sub', ua, 'role', 'authenticated')::text;
  claims_b := json_build_object('sub', ub, 'role', 'authenticated')::text;
  claims_g := json_build_object('sub', ug, 'role', 'authenticated')::text;

  -- A cria o workspace, um projeto aberto e um privado com a MESMA sigla
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  r := public.create_workspace('SQL Test', 'sql-test-' || substr(ua::text, 1, 8), null);
  ws := (r ->> 'workspace_id')::uuid; ma := (r ->> 'member_id')::uuid;
  insert into public.projects (id, workspace_id, key, name) values (p1, ws, 'WEB', 'Website');
  insert into public.projects (id, workspace_id, key, name, is_private) values (p2, ws, 'WEB', 'Secret', true);

  -- 1. três tarefas chegam com a mesma chave (o que acontecia com criação simultânea): cada uma recebe a sua
  insert into public.tasks (id, project_id, key, title) values (t1, p1, 'WEB-201', 'First'), (t2, p1, 'WEB-201', 'Second'), (t3, p1, 'WEB-201', 'Third');
  insert into public.tasks (id, project_id, key, title) values (t4, p2, 'WEB-201', 'Hidden');
  select key into k1 from public.tasks where id = t1;
  select key into k2 from public.tasks where id = t2;
  select key into k3 from public.tasks where id = t3;
  select key into k4 from public.tasks where id = t4;
  if not (array[k1, k2, k3] <@ array['WEB-201', 'WEB-202', 'WEB-203'] and k1 <> k2 and k2 <> k3 and k1 <> k3) then
    fails := fails || format('keys-not-unique(%s,%s,%s)', k1, k2, k3);
  end if;
  -- outro projeto com a mesma sigla pula os números já usados no workspace
  if k4 <> 'WEB-204' then fails := fails || ('same-prefix-project-key=' || k4); end if;

  -- 2. a chave não muda em edições, nem a pedido do cliente
  update public.tasks set title = 'First!', key = 'HACK-1' where id = t1;
  select key into k from public.tasks where id = t1;
  if k <> k1 then fails := fails || ('key-changed-on-update=' || k); end if;

  -- 3. mover de projeto gera uma chave nova do projeto de destino
  update public.tasks set project_id = p2 where id = t2;
  select key into k from public.tasks where id = t2;
  if k <> 'WEB-205' then fails := fails || ('moved-key=' || k); end if;

  -- 4. o contador não recua
  update public.projects set task_seq = 1 where id = p1;
  select task_seq into n from public.projects where id = p1;
  if n <> 203 then fails := fails || ('seq-went-back=' || n); end if;

  -- 5. o cliente não escolhe subject / project_name / restricted
  insert into public.activity (id, workspace_id, actor_id, verb, task_id, subject, project_name, restricted)
  values (gen_random_uuid(), ws, ma, 'created', t1, 'spoof', 'spoof', true), (gen_random_uuid(), ws, ma, 'created', t4, 'spoof', 'spoof', true);
  select * into rec from public.activity where task_id = t1;
  if rec.subject <> 'First!' or rec.project_name is not null or rec.restricted or rec.project_id <> p1 then fails := fails || 'activity-insert-not-stamped'; end if;

  -- 6. excluir a tarefa preserva o histórico dela e registra a exclusão
  delete from public.tasks where id = t1;
  select count(*) into n from public.activity where verb = 'created' and subject = 'First!' and task_id is null and project_id = p1;
  if n <> 1 then fails := fails || ('history-lost-on-task-delete=' || n); end if;
  select count(*) into n from public.activity where verb = 'deleted' and subject = 'First!' and extra = k1 and actor_id = ma and project_id = p1 and task_id is null;
  if n <> 1 then fails := fails || ('no-deleted-entry=' || n); end if;

  insert into public.members (workspace_id, email, name, role)
  values (ws, 'sqltest-b@dash-check.invalid', 'Test B', 'member'), (ws, 'sqltest-g@dash-check.invalid', 'Test G', 'guest');

  -- B (membro) vê o histórico do projeto aberto e não o do privado; G (convidado) não vê nada
  execute 'reset role';
  perform set_config('request.jwt.claims', claims_b, true);
  execute 'set local role authenticated';
  n := public.claim_invitations();
  if n <> 1 then fails := fails || ('claim-b=' || n); end if;
  select count(*) into n from public.activity;
  if n <> 2 then fails := fails || ('member-visibility-before=' || n); end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', claims_g, true);
  execute 'set local role authenticated';
  n := public.claim_invitations();
  if n <> 1 then fails := fails || ('claim-g=' || n); end if;
  select count(*) into n from public.activity;
  if n <> 0 then fails := fails || ('guest-visibility-before=' || n); end if;

  -- 7. excluir o projeto privado: o histórico fica, restrito a quem agiu e ao dono
  execute 'reset role';
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  delete from public.projects where id = p2;
  select count(*) into n from public.activity where project_name = 'Secret' and restricted and project_id is null;
  if n <> 2 then fails := fails || ('private-project-history=' || n); end if;
  select count(*) into n from public.activity where verb = 'created' and subject = 'Hidden' and task_id is null;
  if n <> 1 then fails := fails || ('private-task-history=' || n); end if;
  select count(*) into n from public.activity where verb = 'deleted' and project_name = 'Secret';
  if n <> 0 then fails := fails || ('task-deleted-entries-during-project-delete=' || n); end if;
  select count(*) into n from public.activity where verb = 'deleted project' and subject = 'Secret' and actor_id = ma;
  if n <> 1 then fails := fails || ('no-deleted-project-entry=' || n); end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', claims_b, true);
  execute 'set local role authenticated';
  select count(*) into n from public.activity where project_name = 'Secret';
  if n <> 0 then fails := fails || ('member-sees-deleted-private-project=' || n); end if;

  -- 8. excluir o projeto aberto: o histórico fica visível para os membros, não para convidados
  execute 'reset role';
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  delete from public.projects where id = p1;
  select count(*) into n from public.activity where project_name = 'Website' and not restricted and project_id is null;
  if n <> 3 then fails := fails || ('public-project-history=' || n); end if;
  select count(*) into n from public.tasks;
  if n <> 0 then fails := fails || ('tasks-left=' || n); end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', claims_b, true);
  execute 'set local role authenticated';
  select count(*) into n from public.activity;
  if n <> 3 then fails := fails || ('member-visibility-after=' || n); end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', claims_g, true);
  execute 'set local role authenticated';
  select count(*) into n from public.activity;
  if n <> 0 then fails := fails || ('guest-visibility-after=' || n); end if;

  -- 9. excluir o workspace continua funcionando e leva o histórico junto
  execute 'reset role';
  perform set_config('request.jwt.claims', claims_a, true);
  execute 'set local role authenticated';
  delete from public.workspaces where id = ws;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.activity where workspace_id = ws;
  if n <> 0 then fails := fails || ('activity-left-after-workspace-delete=' || n); end if;
  select count(*) into n from public.workspaces where id = ws;
  if n <> 0 then fails := fails || 'workspace-not-deleted'; end if;

  if array_length(fails, 1) is not null then
    raise exception 'FAIL: %', array_to_string(fails, ', ');
  end if;
  raise notice 'PASS';
end
$test$;

rollback;
