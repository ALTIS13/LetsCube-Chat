/**
 * A member's read and delivered marks move forward only, never past the
 * present, and only by that member.
 *
 * `chat_members.last_read_at` is the chat-wide read pointer: the unread count
 * (`chat_list_summaries`), the private «Прочитано» check and the group receipts
 * all compare it with `messages.created_at`. `last_delivered_at` is the same for
 * «Доставлено». Read from the migrations before writing this, three paths write
 * them:
 *
 *   - `mark_chat_read(uuid)` (20260714090000) and `mark_chat_delivered(uuid)`
 *     (20260507), which store the greater of the stored value and `now()`;
 *   - `group_invite_accept` (20260511), which INSERTs the row with both marks at
 *     the moment of acceptance — an INSERT, which this change does not touch;
 *   - a direct PostgREST PATCH, which the policy `chat_members update`
 *     (20260504_chats_membership_hardening.sql:339) allows for the member's own
 *     row AND for every row of a chat the caller administers.
 *
 * The RPCs never move a mark backwards; the third path can. A stale client can
 * write an older value, any client can write a value in the future (which zeroes
 * its own unread counts for every message not yet sent), and a chat owner or
 * administrator can write another member's marks and so forge a read receipt.
 * The per-message read times added in 20260911141000 are derived from each
 * advance of the pointer, so a pointer anyone can move is a read time anyone
 * can forge.
 *
 * This adds one BEFORE UPDATE trigger, fired only when an UPDATE names one of
 * the two columns:
 *
 *   - a session with a user who is not the row's member keeps both marks as
 *     they were (a role change by an administrator still goes through — it
 *     does not name these columns);
 *   - otherwise each mark becomes the later of the stored value and the new
 *     value, both clamped to `now()`; a NULL leaves the mark as it was.
 *
 * Nothing is raised: a stale device's late report is accepted and ignored,
 * which is what "never backwards" means for a client that cannot know it is
 * stale. A mark already stored in the future is clamped to `now()` on its next
 * update — the only case where a stored value goes down, from a moment that has
 * not happened.
 *
 * Owner: the role that applies this. The trigger function is SECURITY DEFINER
 * only to read `auth.uid()` without depending on the caller's schema
 * privileges; it touches no table.
 *
 * Lock: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on `chat_members`, which every
 * read receipt updates. `lock_timeout` makes the apply fail in five seconds
 * rather than queue receipts behind a long transaction.
 *
 * Rollback: 20260911140000_chat_read_marks_forward_only.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

-- The rule as a pure function, so the self-check below can prove it without
-- writing a row.
create or replace function private.advance_read_mark(
  p_stored timestamptz,
  p_requested timestamptz,
  p_now timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_requested is null then p_stored
    when p_stored is null then least(p_requested, p_now)
    else greatest(least(p_stored, p_now), least(p_requested, p_now))
  end
$function$;

create or replace function private.guard_chat_member_read_marks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
begin
  -- Only the member moves their own marks. A session without a user (the
  -- service role, maintenance) is still held to forward-only below.
  if v_actor is not null and v_actor is distinct from old.user_id then
    new.last_read_at := old.last_read_at;
    new.last_delivered_at := old.last_delivered_at;
    return new;
  end if;

  if new.last_read_at is distinct from old.last_read_at then
    new.last_read_at := private.advance_read_mark(old.last_read_at, new.last_read_at, v_now);
  end if;
  if new.last_delivered_at is distinct from old.last_delivered_at then
    new.last_delivered_at := private.advance_read_mark(old.last_delivered_at, new.last_delivered_at, v_now);
  end if;
  return new;
end
$function$;

revoke all on function private.advance_read_mark(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_chat_member_read_marks()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_chat_member_read_marks on public.chat_members;
create trigger trg_guard_chat_member_read_marks
  before update of last_read_at, last_delivered_at on public.chat_members
  for each row execute function private.guard_chat_member_read_marks();

-- Refuse to commit unless the trigger is in place and the rule is the one
-- described. A mark that can still move backwards is invisible from the
-- interface until a read time is wrong.
do $$
declare
  v_now constant timestamptz := pg_catalog.now();
  v_hour constant interval := interval '1 hour';
  v_trigger record;
  v_columns text[];
begin
  select t.tgenabled, t.tgtype, t.tgattr, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.chat_members'::regclass
     and t.tgname = 'trg_guard_chat_member_read_marks'
     and not t.tgisinternal;
  if not found then
    raise exception 'the read-mark guard trigger is missing';
  end if;
  if v_trigger.tgenabled = 'D' then
    raise exception 'the read-mark guard trigger is disabled';
  end if;
  -- tgtype bits: 1 = row, 2 = before, 16 = update.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) = 0 or (v_trigger.tgtype & 16) = 0 then
    raise exception 'the read-mark guard must be a BEFORE UPDATE row trigger (tgtype %)', v_trigger.tgtype;
  end if;
  if v_trigger.fn <> 'private.guard_chat_member_read_marks()' then
    raise exception 'the read-mark guard calls % instead', v_trigger.fn;
  end if;
  select pg_catalog.array_agg(a.attname::text order by a.attname)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.chat_members'::regclass
     and a.attnum = any (v_trigger.tgattr::smallint[]);
  if v_columns is distinct from array['last_delivered_at', 'last_read_at'] then
    raise exception 'the read-mark guard fires for columns % instead of the two marks', v_columns;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = 'private.guard_chat_member_read_marks()'::regprocedure
       and p.prosecdef
       and exists (select 1 from pg_catalog.unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    raise exception 'the guard function must be SECURITY DEFINER with a fixed search_path';
  end if;

  -- The rule itself, case by case.
  if private.advance_read_mark(null, v_now - v_hour, v_now) is distinct from v_now - v_hour then
    raise exception 'a first read mark is not stored as given';
  end if;
  if private.advance_read_mark(v_now - v_hour, v_now - 2 * v_hour, v_now) is distinct from v_now - v_hour then
    raise exception 'an older read mark moved the pointer backwards';
  end if;
  if private.advance_read_mark(v_now - 2 * v_hour, v_now - v_hour, v_now) is distinct from v_now - v_hour then
    raise exception 'a newer read mark did not move the pointer forward';
  end if;
  if private.advance_read_mark(v_now - v_hour, v_now + v_hour, v_now) is distinct from v_now then
    raise exception 'a read mark in the future was not clamped to now';
  end if;
  if private.advance_read_mark(v_now - v_hour, null, v_now) is distinct from v_now - v_hour then
    raise exception 'a NULL cleared the read mark';
  end if;
  if private.advance_read_mark(v_now + v_hour, v_now - 2 * v_hour, v_now) is distinct from v_now then
    raise exception 'a stored future mark was not brought back to now';
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'private.guard_chat_member_read_marks()', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'private.guard_chat_member_read_marks()', 'EXECUTE') then
    raise exception 'the guard function is executable by an API role';
  end if;
  if pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
     or pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'schema private is usable by an API role';
  end if;
end
$$;

commit;
