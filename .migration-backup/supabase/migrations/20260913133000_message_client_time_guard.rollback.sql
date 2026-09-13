/**
 * Rollback for 20260913133000_message_client_time_guard.sql (D-177 item 7).
 *
 * Written by hand rather than lifted from the proposal: section 5.1 carries one
 * SQL block, and the `drop trigger if exists` inside it is part of applying the
 * guard, not of undoing it. A rollback extracted by looking for that line would
 * have been a copy of the migration.
 *
 * After this, `client_sent_at` and `edited_at` are free-form client values
 * again, which is the state every row before 2026-09-13 was written in.
 */

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_guard_message_client_times on public.messages;
drop function if exists private.guard_message_client_times();
drop function if exists private.clamp_client_timestamp(timestamptz, timestamptz, interval);

do $check$
begin
  if exists (
    select 1
      from pg_catalog.pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgname = 'trg_guard_message_client_times'
       and not tgisinternal
  ) then
    raise exception 'the client-time guard survived its own rollback';
  end if;
end
$check$;

commit;
