-- Proposal only. Do not apply automatically.
--
-- Schedules the deployed `recurring-tasks-run-due` Edge Function through Supabase Cron.
-- Before applying, create these Vault secrets in Supabase Dashboard or SQL editor:
--
--   kub_project_url
--     Example value: https://<project-ref>.supabase.co
--
--   kub_recurring_scheduler_token
--     Same random token as the Edge Function secret KUB_RECURRING_SCHEDULER_TOKEN.
--
-- The token value must not be committed to git or copied into docs.

begin;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kub-recurring-tasks-run-due') then
    perform cron.unschedule('kub-recurring-tasks-run-due');
  end if;
end
$$;

select cron.schedule(
  'kub-recurring-tasks-run-due',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
        from vault.decrypted_secrets
       where name = 'kub_project_url'
       limit 1
    ) || '/functions/v1/recurring-tasks-run-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-kub-scheduler-token', (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'kub_recurring_scheduler_token'
         limit 1
      )
    ),
    body := jsonb_build_object(
      'source', 'supabase-cron',
      'limit', 50
    )
  ) as request_id;
  $$
);

commit;

-- Verify after manual application:
--
-- select jobid, schedule, command
--   from cron.job
--  where jobname = 'kub-recurring-tasks-run-due';
--
-- select *
--   from net._http_response
--  order by created desc
--  limit 10;
