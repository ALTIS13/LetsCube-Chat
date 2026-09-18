/**
 * Three things the voice tables got wrong, all of them live on 2026-09-18.
 *
 * None of these is a design question. Each was found by measuring production
 * and each contradicts something the interface already does.
 *
 * ── 1. A group may have one voice room, and the interface offers many ────────
 *
 * MEASURED: `voice_channels_one_per_chat_idx UNIQUE (chat_id) WHERE (NOT
 * archived)`, created by `20260913150000_voice_channels.sql:83-84` with the
 * comment «One per chat for now. Dropping this index is how the product grows
 * to many».
 *
 * The product grew to many on 2026-09-14 and nobody dropped it. `ChannelRail`
 * and `ChannelManageModal` are a genuine multi-room surface with no guard on
 * the count, and the create form's kind toggle lets an administrator draft a
 * second voice room. The insert then fails with SQLSTATE 23505, which
 * `classifyChannelWriteError` does not know — it handles 42501 and the
 * missing-object states — so the administrator is told «Такая запись уже
 * существует.» about a room they have never seen.
 *
 * Text channels were never capped: `20260427_topics.sql:25-26` caps only the
 * *general* topic. Only voice is capped, and nothing anywhere says so.
 *
 * So the index goes. The interface has been built for many for four days, the
 * references this product is shaped after both have many, and the alternative —
 * guarding the button — would mean teaching the interface a rule the database
 * documented as temporary.
 *
 * **This also corrects a register entry.** D-191 states that an administrator
 * «could always have made a second room, a third», reasoned from the
 * `admins manage voice channels FOR ALL` policy. That was false about the live
 * database: a policy is not the whole gate, which this project has now recorded
 * three times. It becomes true with this migration.
 *
 * ── 2. A voice room cannot be moved between headings ─────────────────────────
 *
 * MEASURED: `authenticated` holds UPDATE on six columns of `voice_channels` —
 * `archived`, `max_participants`, `name`, `position`, `speak_role`,
 * `updated_at` — and **not** on `category_id`. The column grant was written by
 * the 2026-09-13 migration; `category_id` arrived on 2026-09-14 and fell
 * outside it. The policy would allow the move and the privilege check refuses
 * first, so an administrator can create a room inside a heading and can never
 * move it out.
 *
 * **And a note written this morning was wrong about this.**
 * `20260918120000_chat_roles_and_member_tags.sql:125` says renaming or
 * reordering a voice channel is refused by a privilege the policy never sees.
 * It is not: `name` and `position` are both granted. The check that produced
 * that sentence asked `has_table_privilege(..., 'UPDATE')`, which is false for
 * a privilege granted per column — the table-level answer says nothing about
 * the columns. The real gap was `category_id` all along, and it is closed here.
 *
 * ── 3. One row has been driving a write loop for four days ──────────────────
 *
 * MEASURED: `voice_channels` holds one row, `voice_participants` holds none,
 * and the SFU has held no room since 2026-09-13 — yet that row's `active_since`
 * is 2026-09-13 21:53:40, thirty-four minutes after the last webhook. INFERRED
 * from the gap: it was set by a direct `voice_channel_set_active` call during
 * QA rather than by the SFU.
 *
 * The reconciler selects on `participant_count.gt.0,active_since.not.is.null`,
 * so it matches this empty channel on every pass, twice a minute, for ever. It
 * recounts unconditionally: measured at **11,867 lifetime UPDATEs on a one-row
 * table**, each one a Realtime broadcast to every subscribed member, plus two
 * twirp calls to the SFU per pass. Only a `room_finished` webhook clears the
 * flag, and that needs somebody to join and leave first — so nothing in the
 * running system ever will.
 *
 * The flag is cleared here for any room that has nobody in it. That is the
 * data half; the reconciler is taught to clear it itself in the same batch of
 * work, so this cannot silently accumulate again.
 *
 * ── Applying ────────────────────────────────────────────────────────────────
 *
 * Take and verify a schema backup first. One transaction, a self-check that
 * raises rather than committing a half-applied state, and a rollback beside it
 * in `…_voice_rooms_many_and_the_stuck_flag.rollback.sql`.
 *
 * **Run it as `supabase_admin`, not as `postgres`.** `voice_channels` and
 * `voice_participants` are owned by `supabase_admin` — unlike `topics`,
 * `chat_roles` and most of `public`, which `postgres` owns — and `create index`
 * needs ownership. As `postgres` the rehearsal drops the old index and then
 * stops on «must be owner of table voice_channels», which leaves a rolled-back
 * transaction and no harm, but wastes a round trip. The same trap caught
 * `private.media_variant_jobs` on 2026-09-05.
 */

begin;

set local lock_timeout = '5s';

-- 1. Many rooms per group.
drop index if exists public.voice_channels_one_per_chat_idx;

-- The index was also the only thing making `(chat_id)` fast for the rail's
-- read, so the plain index it leaves behind is not optional. `position` and
-- `created_at` match the order `buildChannelTree` asks for, the same shape
-- `chat_channel_categories` uses for its own list.
create index if not exists voice_channels_chat_position_idx
  on public.voice_channels (chat_id, position, created_at)
  where not archived;

comment on index public.voice_channels_chat_position_idx is
  'The rail''s read: every live room of one chat, in the order it draws them. '
  'Replaces voice_channels_one_per_chat_idx, which was a UNIQUE(chat_id) cap '
  'from the days when a group had one room.';

-- 2. A room can be moved between headings.
grant update (category_id) on public.voice_channels to authenticated;

-- 3. The stuck flag, and only where nobody is in the room.
update public.voice_channels
   set active_since = null,
       updated_at = now()
 where active_since is not null
   and coalesce(participant_count, 0) = 0;

do $$
declare
  v_unique integer;
  v_ordered integer;
  v_category boolean;
  v_stuck integer;
begin
  select count(*) into v_unique
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'voice_channels'
     and indexname = 'voice_channels_one_per_chat_idx';
  if v_unique <> 0 then
    raise exception 'the one-room index is still there, so a second voice room still fails on 23505';
  end if;

  select count(*) into v_ordered
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'voice_channels'
     and indexname = 'voice_channels_chat_position_idx';
  if v_ordered <> 1 then
    raise exception 'the replacement index is missing, so the rail reads a chat''s rooms without one';
  end if;

  select has_column_privilege('authenticated', 'public.voice_channels', 'category_id', 'UPDATE')
    into v_category;
  if not v_category then
    raise exception 'authenticated still cannot update category_id, so a room cannot leave its heading';
  end if;

  -- Every column the interface writes, asked one at a time, because the
  -- table-level answer is false while six columns are granted and that is
  -- exactly the mistake this migration is correcting.
  if not (
    has_column_privilege('authenticated', 'public.voice_channels', 'name', 'UPDATE')
    and has_column_privilege('authenticated', 'public.voice_channels', 'position', 'UPDATE')
    and has_column_privilege('authenticated', 'public.voice_channels', 'archived', 'UPDATE')
    and has_column_privilege('authenticated', 'public.voice_channels', 'max_participants', 'UPDATE')
    and has_column_privilege('authenticated', 'public.voice_channels', 'speak_role', 'UPDATE')
  ) then
    raise exception 'a column the channel screen writes lost its grant';
  end if;

  select count(*) into v_stuck
    from public.voice_channels
   where active_since is not null
     and coalesce(participant_count, 0) = 0;
  if v_stuck <> 0 then
    raise exception 'an empty room is still marked active, so the reconciler still rewrites it twice a minute';
  end if;

  raise notice 'a group may have many voice rooms, a room may change heading, and no empty room is marked active';
end
$$;

commit;
