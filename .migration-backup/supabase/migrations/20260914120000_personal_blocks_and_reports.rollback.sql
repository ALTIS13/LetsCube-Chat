/**
 * Rollback for 20260914120000_personal_blocks_and_reports.sql.
 *
 * Order matters: the policy on `public.messages` calls `blocked_from_chat`, and
 * the function reads `user_blocks`, so they come off in that order.
 *
 * **This discards every block and every report.** A block is a person's own
 * decision about who may write to them, and a report is somebody's complaint
 * that nobody has answered yet. Neither is recoverable from anywhere else.
 * Worth knowing before running this rather than after.
 */

begin;

set local lock_timeout = '5s';

drop policy if exists "block writes to someone who refused you" on public.messages;

drop function if exists public.blocked_from_chat(uuid, uuid);

drop table if exists public.content_reports;
drop table if exists public.user_blocks;

do $check$
begin
  if pg_catalog.to_regclass('public.user_blocks') is not null
     or pg_catalog.to_regclass('public.content_reports') is not null then
    raise exception 'a table survived its own rollback';
  end if;
  if pg_catalog.to_regproc('public.blocked_from_chat') is not null then
    raise exception 'public.blocked_from_chat survived the rollback';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'messages'
       and policyname = 'block writes to someone who refused you'
  ) then
    raise exception 'the refusal on public.messages survived the rollback';
  end if;
end
$check$;

commit;
