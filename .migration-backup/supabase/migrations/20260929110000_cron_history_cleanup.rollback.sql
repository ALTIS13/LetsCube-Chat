-- Rollback of 20260929110000_cron_history_cleanup.sql: the job stops. History
-- it already deleted is gone; it held run logs only, no user data.
begin;

select cron.unschedule('letscube-cron-history-cleanup')
 where exists (select 1 from cron.job where jobname = 'letscube-cron-history-cleanup');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'letscube-cron-history-cleanup') then
    raise exception 'cron_history_cleanup_rollback_incomplete';
  end if;
end;
$$;

commit;
