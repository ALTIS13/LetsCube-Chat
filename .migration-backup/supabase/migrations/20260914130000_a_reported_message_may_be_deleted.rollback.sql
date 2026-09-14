/**
 * Rollback for 20260914130000_a_reported_message_may_be_deleted.sql.
 *
 * It restores the bidirectional CHECK, which re-introduces the defect: a
 * reported message can no longer be deleted, and neither can the chat holding
 * it. Worth knowing before running this rather than after.
 *
 * It refuses outright if any row already carries the state the migration
 * allowed — a report about a message whose message has since gone. Adding the
 * old constraint back would fail on those rows anyway; failing with a sentence
 * that says which rows and why is better than failing with a row count.
 */

begin;

set local lock_timeout = '5s';

do $guard$
declare
  v_rows bigint;
begin
  select count(*) into v_rows
    from public.content_reports
   where kind = 'message' and message_id is null;
  if v_rows > 0 then
    raise exception
      'rolling back would discard % report(s) whose message has been deleted; decide what happens to them first', v_rows;
  end if;
end
$guard$;

alter table public.content_reports
  drop constraint if exists content_reports_message_present;

alter table public.content_reports
  add constraint content_reports_message_present
  check ((kind = 'message') = (message_id is not null));

commit;
