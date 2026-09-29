-- pg_cron keeps every run of every job in `cron.job_run_details` and never
-- deletes one. Measured 2026-09-29: 220,822 rows, 210 MB, the oldest from
-- 2026-06-18; 176,566 of them from `kub-send-push-notifications`, which runs
-- every ten seconds. Found while adding `letscube-task-reminders` (the rollout
-- record's §3); approved by the owner on 2026-09-29 («подтверждаю»).
--
-- `letscube-cron-history-cleanup` keeps seven days, which is more than any
-- health query here reads (the reminder job's reads its last five runs). It
-- runs hourly and deletes at most 50,000 rows a run, so the 158,267 rows past
-- the week go in bounded steps over the first hours rather than in one burst,
-- and afterwards each run deletes a few hundred. It runs as `postgres`, as the
-- other `letscube-` jobs do, which holds DELETE on the table.
--
-- The table's file keeps its size, and autovacuum lets later rows reuse the
-- space. Shrinking it would need VACUUM FULL, an exclusive lock that every
-- job start would wait on, and 55 GB are free, so that is not done here.
--
-- Rollback: 20260929110000_cron_history_cleanup.rollback.sql.
begin;

select cron.schedule(
  'letscube-cron-history-cleanup',
  '17 * * * *',
  $cmd$delete from cron.job_run_details where runid in (select runid from cron.job_run_details where end_time < now() - interval '7 days' order by runid limit 50000)$cmd$
);

do $$
begin
  if not exists (
    select 1 from cron.job
     where jobname = 'letscube-cron-history-cleanup'
       and schedule = '17 * * * *'
       and active
       and username = 'postgres'
       and command like 'delete from cron.job_run_details where runid in (%limit 50000)'
  ) then
    raise exception 'cron_history_cleanup_incomplete';
  end if;
end;
$$;

commit;
