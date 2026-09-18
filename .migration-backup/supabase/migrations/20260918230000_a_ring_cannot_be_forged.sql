/**
 * A ring cannot be written except by the function that checks who may ring.
 *
 * Found by verifying `20260918220000_a_private_chat_can_ring.sql` on the applied
 * database rather than by reading it. Its own self-check asserted that no client
 * holds **UPDATE** on the three ring columns, which is true, and it asserted
 * nothing about INSERT — so the verification printed this:
 *
 *     column_name      | authenticated_may
 *     ring_answered_at | INSERT,SELECT
 *     ring_caller      | INSERT,SELECT
 *     ring_started_at  | INSERT,SELECT
 *
 * **The two grants do not behave the same way, and that is the whole finding.**
 * UPDATE on this table is held column by column — seven of them, named in that
 * migration — so a column added later is not in the list and gets nothing.
 * INSERT is held at the **table** level, and a table-level grant covers every
 * column the table will ever have. A new column therefore arrives readable and
 * writable-on-insert without anybody granting it anything.
 *
 * ── What that made possible ─────────────────────────────────────────────────
 *
 * `voice_channels` INSERT is governed by «admins manage voice channels» =
 * `is_chat_admin(chat_id)`, and in a private chat that is whoever opened it. So
 * that participant could insert a room **with the ring columns already set**,
 * which is a ring nobody checked:
 *
 * - `voice_call_ring` refuses a caller the other side has blocked
 *   (`blocked_from_chat`). A direct insert consults no such thing, so **a
 *   blocked person could still make the other one's devices ring** — the one
 *   gate the owner's answer of 2026-09-18 rests on («every private chat, minus
 *   the block list»), stepped around entirely.
 * - It also refuses a second ring and an occupied room. A direct insert refuses
 *   neither.
 * - And `ring_caller` is free text as far as the constraint is concerned: it
 *   need not be the person inserting the row.
 *
 * Not a live vulnerability — nothing in any shell writes this table directly and
 * the columns are a few minutes old — but it is the shape of one, and it is
 * cheaper to close than to remember.
 *
 * ── The fix, and the attempt that quietly did nothing ──────────────────────
 *
 * The obvious spelling is `revoke insert (ring_started_at, ...) from
 * authenticated`, and **it is a no-op against a table-level grant**. Postgres
 * accepts it without complaint, and `column_privileges` afterwards reads exactly
 * as it did before:
 *
 *     ring_answered_at | INSERT,SELECT
 *     ring_caller      | INSERT,SELECT
 *     ring_started_at  | INSERT,SELECT
 *
 * A column-level revoke cannot cut a privilege held at the table level; the
 * table grant is still there and still covers every column. Caught here only
 * because the self-check compared the result against what it wanted instead of
 * assuming the statement had worked — the same shape as every «the migration
 * ran, so the thing is true» mistake this project has written down.
 *
 * So the table grant is **replaced**: revoked whole, then re-granted as the
 * explicit list of the fourteen columns that held it before, which is precisely
 * how UPDATE on this table is already expressed. The list is asserted below in
 * both directions — every one of the fourteen still has INSERT, and none of the
 * three ring columns does — because getting it wrong breaks every voice channel
 * a group creates, silently, at the next «create channel».
 *
 * **Left as it was, deliberately:** those fourteen include `participant_count`,
 * `active_since` and `call_announced_at`, which no client has any business
 * setting — `call_announced_at` in particular is the latch that decides whether
 * a group call announces itself in the conversation. Narrowing them is a real
 * question and a separate one; this file preserves the existing set exactly so
 * that the only behaviour it changes is the forgery it was written for.
 *
 * The residue is worth writing down twice: **a column added to this table in
 * future now arrives with neither INSERT nor UPDATE**, because both are
 * column lists. That is the safe direction, and the previous migration's
 * `grant select (...)` shows what a new column needs.
 */

begin;

revoke insert on public.voice_channels from authenticated;
revoke insert on public.voice_channels from anon;

grant insert (
  id, chat_id, name, position, max_participants, speak_role,
  participant_count, active_since, archived, created_by, created_at,
  updated_at, category_id, call_announced_at
) on public.voice_channels to authenticated;

do $$
declare
  v_bad text;
begin
  -- Nothing but SELECT, for either client role.
  select string_agg(format('%s:%s:%s', grantee, column_name, privilege_type), ', ')
    into v_bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'voice_channels'
     and column_name in ('ring_started_at', 'ring_caller', 'ring_answered_at')
     and grantee in ('authenticated', 'anon')
     and privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception 'a ring column is still writable by a client: %', v_bad;
  end if;

  -- And SELECT is still there: revoking one privilege must not take the other,
  -- because Realtime sends only the columns the subscriber may read and the ring
  -- would go silently invisible.
  select string_agg(c, ', ') into v_bad
    from unnest(array['ring_started_at', 'ring_caller', 'ring_answered_at']) as c
   where not exists (
     select 1 from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'voice_channels'
        and column_name = c and grantee = 'authenticated' and privilege_type = 'SELECT'
   );
  if v_bad is not null then
    raise exception 'authenticated lost SELECT on: %', v_bad;
  end if;

  -- The columns a client legitimately writes on insert must be untouched. The
  -- revoke rewrites a table-level grant into a column list, and getting that
  -- wrong would break every voice channel a group creates.
  select string_agg(c, ', ') into v_bad
    from unnest(array['id', 'chat_id', 'name', 'position', 'max_participants',
                      'speak_role', 'participant_count', 'active_since', 'archived',
                      'created_by', 'created_at', 'updated_at', 'category_id',
                      'call_announced_at']) as c
   where not exists (
     select 1 from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'voice_channels'
        and column_name = c and grantee = 'authenticated' and privilege_type = 'INSERT'
   );
  if v_bad is not null then
    raise exception 'authenticated lost INSERT on a column it needs: %', v_bad;
  end if;
end;
$$;

commit;
