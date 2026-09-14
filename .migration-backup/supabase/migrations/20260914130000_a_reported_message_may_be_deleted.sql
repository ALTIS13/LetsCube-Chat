/**
 * A reported message may be deleted, and deleting it must not fail.
 *
 * Found the same day `20260914120000_personal_blocks_and_reports.sql` was
 * applied, before its interface shipped, by reading the constraint list back
 * off production rather than off the file that wrote it.
 *
 * Two objects on `public.content_reports` contradict each other:
 *
 *   content_reports_message_id_fkey  FOREIGN KEY (message_id)
 *     REFERENCES messages(id) ON DELETE SET NULL
 *   content_reports_message_present  CHECK ((kind = 'message') = (message_id IS NOT NULL))
 *
 * `ON DELETE SET NULL` performs an UPDATE on the referencing row, and an UPDATE
 * re-checks every CHECK. So the moment a reported message is deleted, Postgres
 * sets `message_id` to null and the CHECK refuses the new row — and the refusal
 * propagates outwards, so **the delete itself fails**.
 *
 * Measured, not reasoned: a temporary pair carrying these two definitions
 * verbatim, on production, inside a transaction that rolled back —
 *   «the delete was REFUSED -> new row for relation "probe_rep" violates check
 *    constraint "probe_message_present"».
 *
 * It is reachable, and not by an administrator. `messages_chat_id_fkey` is
 * ON DELETE CASCADE and «Удалить группу» is an ordinary control
 * (`ChatHeader.tsx:96`, `ChatInfoPanel.tsx:1010`, `ChatList.tsx:461` all run
 * `from("chats").delete()`), so an owner whose group holds one reported message
 * could no longer delete their own group, and the answer they would get names a
 * table they have never heard of.
 *
 * **The fix is to stop the CHECK being bidirectional.** Only one of its two
 * halves was ever a rule:
 *
 *   - a report that is not about a message must not carry a message id — real,
 *     and rehearsal rule 11 pins it;
 *   - a report about a message must carry one — true when it is filed, and not
 *     something the row can promise for ever, because the message it names can
 *     be deleted out from under it.
 *
 * The complaint outlives the evidence on purpose: SET NULL rather than CASCADE,
 * because «somebody complained and the message is gone» is a thing staff need
 * to be able to see, and a row that deletes itself with the evidence would hide
 * exactly the case worth looking at.
 *
 * The client half is `reportedMessageView` in `lib/contentReportQueue.ts`,
 * which grows a fifth state for it: a message id that is gone is not the same
 * claim as a message this reader may not look at.
 *
 * Rollback: `20260914130000_a_reported_message_may_be_deleted.rollback.sql`,
 * which restores the bidirectional CHECK — and will refuse to do so if any row
 * already carries the state this migration allows.
 */

begin;

set local lock_timeout = '5s';

alter table public.content_reports
  drop constraint if exists content_reports_message_present;

alter table public.content_reports
  add constraint content_reports_message_present
  check (kind = 'message' or message_id is null);

do $check$
declare
  v_def text;
  v_fk text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_catalog.pg_constraint
   where conrelid = 'public.content_reports'::regclass
     and conname = 'content_reports_message_present';
  if v_def is null then
    raise exception 'the constraint is gone rather than replaced';
  end if;
  if v_def like '%=%(message_id IS NOT NULL)%' then
    raise exception 'the bidirectional form survived: %', v_def;
  end if;
  if v_def not like '%message_id IS NULL%' then
    raise exception 'the new constraint does not allow a deleted message: %', v_def;
  end if;

  -- The half that is a rule must still be a rule.
  if v_def not like '%kind%message%' then
    raise exception 'the new constraint no longer mentions the kind: %', v_def;
  end if;

  -- And the referential action this exists for must be untouched. A CASCADE
  -- here would delete the complaint along with the evidence.
  select pg_get_constraintdef(oid) into v_fk
    from pg_catalog.pg_constraint
   where conrelid = 'public.content_reports'::regclass
     and conname = 'content_reports_message_id_fkey';
  if v_fk is null or v_fk not like '%ON DELETE SET NULL%' then
    raise exception 'content_reports.message_id no longer sets null on delete: %', coalesce(v_fk, '(absent)');
  end if;

  raise notice 'content_reports_message_present is now one-directional: %', v_def;
end
$check$;

commit;
