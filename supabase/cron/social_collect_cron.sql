-- =====================================================================
-- Dash · Redes sociais · agendamento da coleta diária
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION e não é aplicado por `supabase db push`.
-- Rode-o à mão, uma vez, no SQL Editor do projeto, depois de:
--   1. aplicar a migration 20261111170127_social_networks.sql;
--   2. criar os secrets da função (SOCIAL_COLLECT_SECRET, APIFY_TOKEN);
--   3. fazer o deploy da função social-collect com --no-verify-jwt.
-- O passo a passo completo está em docs/social/README.md.
--
-- Horário: 06:00 em America/Sao_Paulo. O pg_cron do Supabase conta em UTC e
-- o Brasil não tem horário de verão, então 06:00 de Brasília = 09:00 UTC.
-- =====================================================================

-- 1) Extensões (se já estiverem ligadas, nada muda).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Endereço da função e segredo compartilhado, guardados no Vault (criptografados).
--    TROQUE os dois valores antes de rodar. O segredo é o mesmo valor do secret
--    SOCIAL_COLLECT_SECRET da função. Não salve este arquivo com os valores preenchidos.
select vault.create_secret('https://<ref-do-projeto>.supabase.co/functions/v1/social-collect', 'social_collect_url');
select vault.create_secret('<mesmo-valor-de-SOCIAL_COLLECT_SECRET>', 'social_collect_secret');

-- 3) Agendamento. Rodar de novo com o mesmo nome substitui o agendamento anterior.
select cron.schedule(
  'social-collect-daily',
  '0 9 * * *', -- 09:00 UTC = 06:00 America/Sao_Paulo
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'social_collect_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-collect-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'social_collect_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) as request_id;
  $$
);

-- ---------------------------------------------------------------------
-- Conferência (somente leitura)
-- ---------------------------------------------------------------------
-- O agendamento existe?
--   select jobid, jobname, schedule, active from cron.job where jobname = 'social-collect-daily';
-- As últimas execuções do agendador:
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'social-collect-daily') order by start_time desc limit 5;
-- A resposta HTTP da função (fica guardada por 6 horas):
--   select status_code, timed_out, error_msg, left(content, 300) as content, created from net._http_response order by created desc limit 5;
-- O resultado de cada rede:
--   select platform, status, message, accounts_ok, accounts_total, finished_at from public.social_last_runs;

-- ---------------------------------------------------------------------
-- Para desligar a coleta automática
-- ---------------------------------------------------------------------
--   select cron.unschedule('social-collect-daily');
