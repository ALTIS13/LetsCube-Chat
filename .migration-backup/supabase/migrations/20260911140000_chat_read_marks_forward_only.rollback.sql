-- Rollback of 20260911140000_chat_read_marks_forward_only.sql.
--
-- Removes the guard. Marks already written stay as they are; after this, a
-- direct PATCH can move a member's marks backwards, into the future, or — for a
-- chat administrator — on another member's row again. Roll back
-- 20260911141000 first if it is applied: its read times assume marks that only
-- move forward.

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_guard_chat_member_read_marks on public.chat_members;
drop function if exists private.guard_chat_member_read_marks();
drop function if exists private.advance_read_mark(timestamptz, timestamptz, timestamptz);

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.chat_members'::regclass
       and tgname = 'trg_guard_chat_member_read_marks'
  ) or pg_catalog.to_regprocedure('private.guard_chat_member_read_marks()') is not null then
    raise exception 'rollback incomplete: the read-mark guard is still present';
  end if;
end
$$;

commit;
