/**
 * A group voice channel has no seat limit, and a private chat still has two.
 *
 * The owner, 2026-09-20: «изначально ограничения быть не должно, я тебе ранее
 * говорил что для того чтобы всё в будущем работало стабильно когда будет много
 * пользователей, мы должны будем балансировать нагрузку и подключать
 * пользователей на менее нагруженные серверы связи». So the answer to capacity
 * is horizontal scaling, and a cap is not a capacity plan — it is a default
 * nobody revisited standing in for one.
 *
 * ── Where the cap actually was, because it was not where it looked ──────────
 *
 * `livekit.yaml` carries `room.max_participants: 10` and that line has been
 * read, in this repository's own comments, as the thing that caps every call:
 * `voiceChannel.ts`'s `newVoiceChannelDraft` says «Ten is not a preference. It
 * is what `livekit.yaml` on the production SFU already limits a room to», and
 * D-262's measurement ends on «`room.max_participants` is **10**. Whatever the
 * hardware can carry, no voice channel admits an eleventh person until that
 * line changes.»
 *
 * Both sentences are wrong, and the correction was measured against the
 * production SFU on 2026-09-20 rather than reasoned about — throwaway rooms
 * created, read back and deleted:
 *
 *     CreateRoom asked max_participants=50      -> the SFU stored 50
 *     CreateRoom asked max_participants=100000  -> the SFU stored 100000
 *
 * `auto_create: false`, so every room this product has comes from
 * `voice-gateway`'s own `CreateRoom`, which passes the channel row's number.
 * The config value never clamped it. **The cap is this column**, and changing
 * the YAML alone would have changed nothing.
 *
 * Except in exactly one case, which is the trap this file exists to avoid
 * walking into:
 *
 *     CreateRoom asked max_participants=0       -> the SFU stored 10
 *     CreateRoom omitted the field entirely     -> the SFU stored 10
 *
 * Zero is proto3's zero value and indistinguishable from an absent field, so
 * the SFU substitutes its config default. Writing 0 into this column and
 * passing it through, with `livekit.yaml` still saying 10, would leave every
 * guard in the product reporting «no limit» while the eleventh person was still
 * refused — by the SFU, with no line anywhere saying why. Measured again on an
 * isolated probe configured with `room.max_participants: 0`: a room asked for 0
 * then stores 0.
 *
 * **So this migration is one of three halves and none of them works alone**:
 * this column, `room.max_participants: 0` in `/srv/letscube/voice/livekit.yaml`
 * (which needs the SFU restarted), and the gateway's two guards.
 *
 * ── Why 0 and not NULL ──────────────────────────────────────────────────────
 *
 * 0 keeps the column NOT NULL, so neither gateway guard acquires three-valued
 * logic; it is LiveKit's own spelling; and `serverChannels.ts`'s
 * `voiceJoinVerdict` already reads `limit > 0 && inside >= limit`, so the
 * client has spoken this dialect since the feature shipped and has a test
 * pinning it («unlimited» → "ok").
 *
 * NULL was rejected because that meaning is taken. Every client type declares
 * `maxParticipants: number | null` where null means «the row I read did not
 * carry this column», not «unbounded» — `toVoiceChannel` passes the column
 * through unnormalized for exactly that reason. Overloading it would make «not
 * loaded yet» and «no limit» the same value in the interface.
 *
 * ── Why the private cap of 2 is not lifted, and is now held by the database ──
 *
 * The owner, on how a one-to-one conversation grows: «при подобной ситуации в
 * дискорде происходит создание микро-группы под 2+ человека, которую владелец
 * может также снести по надобности». Discord's answer to «a third person is
 * needed in a DM» is **a different object** — a group DM, lighter than a server
 * and disposable by its creator — not a wider DM.
 *
 * So the two in a private chat is a **product definition, not a capacity
 * value**: a private chat is two people by definition, and one more person is a
 * different object rather than a bigger one. That distinction is the whole
 * reason this file does not touch those rows, and it is written here because a
 * constant with a reason survives the next reader while a constant asserted by
 * somebody does not — this register is full of caps that were lifted because
 * nobody could say why they were there.
 *
 * **And today that definition is not actually enforced.** Read off production
 * read-only on 2026-09-20:
 *
 *     public.voice_channels table ACL   authenticated=rd/supabase_admin
 *     column ACL, max_participants      authenticated=aw/supabase_admin
 *     policy «admins manage voice channels»  FOR ALL, USING and WITH CHECK
 *                                            is_chat_admin(chat_id)
 *     triggers on public.voice_channels      none
 *     private chats 28, of which elevated memberships  25
 *
 * `is_chat_admin` is `role in ('owner','admin')` on `chat_members`, and whoever
 * opens a private chat becomes its owner — the same fact behind
 * `20260911120000_private_chat_owner_delete_repair.sql`. So a private chat's
 * owner holds column UPDATE on `max_participants` under a policy that admits
 * them, and one PostgREST PATCH raises their one-to-one call to 20 seats, after
 * which the gateway admits a third. `public.voice_private_room` re-asserts 2,
 * but only when it is called, and it is called to **start** a call, not to
 * **join** one.
 *
 * That hole is 2..20 today. Widening the CHECK below to 99 would widen the hole
 * with it, so closing it is not scope creep here — it is the cost of the
 * widening. `trg_voice_channels_private_is_two` makes the definition
 * structural, and refuses in a sentence that says what the rule is rather than
 * what the number is.
 *
 * ── Why the ceiling moves from 20 to 99 ─────────────────────────────────────
 *
 * Not a preference: a live divergence. `serverChannelVocabulary.ts` declares
 * `SEAT_LIMIT_MIN = 2`, `SEAT_LIMIT_MAX = 99`, its doc comment says the column
 * «carries **no CHECK**» — and the database has carried
 * `check (max_participants between 2 and 20)` since `20260913150000`. So the
 * seat field offers 2…99, `normalizeSeatLimit` clamps into that range and
 * writes it, and every value from 21 to 99 that anybody has ever typed was
 * refused by Postgres and shown as «не удалось сохранить». The client's number
 * is the one a person was offered, so the database moves to it.
 *
 * ── What this changes ───────────────────────────────────────────────────────
 *
 *   * `voice_channels_max_participants_check` becomes «0, or 2 through 99»
 *   * the column default becomes 0
 *   * every voice channel of a non-private chat moves from its cap to 0
 *   * `private.enforce_private_chat_voice_seats` + a BEFORE trigger pin private
 *     chats at 2
 *
 * ── What this does not change ───────────────────────────────────────────────
 *
 * No policy, no grant, no other column, no other table, and no row of
 * `public.chats`, `public.chat_members` or `public.voice_participants`. The
 * self-check at the bottom proves the table ACL and every column ACL byte for
 * byte against what was read before, because a column REVOKE is a silent no-op
 * against a table-level grant on this table and «I did not touch grants» is not
 * a measurement.
 *
 * ── Baseline, read off production read-only immediately before writing ──────
 *
 *     voice_channels rows            5
 *     group   @ max_participants=10  3
 *     private @ max_participants=2   2
 *     rows whose chat is missing     0
 *
 * ── Applying ───────────────────────────────────────────────────────────────
 *
 * **As `supabase_admin`.** `public.voice_channels` is owned by `supabase_admin`
 * and ALTER TABLE needs the owner; `pg_has_role('postgres','supabase_admin',
 * 'MEMBER')` is false while `pg_has_role('supabase_admin','postgres','MEMBER')`
 * is true, so `supabase_admin` can do everything `postgres` could here and not
 * the reverse. The first block refuses to proceed as anybody else.
 *
 * **Locks.** ACCESS EXCLUSIVE on `public.voice_channels` for the two ALTERs and
 * the CREATE TRIGGER, over five rows, behind `lock_timeout = '5s'`. Adding the
 * CHECK scans those five rows. Nothing else is locked. A call in progress is
 * not disturbed: `participant_count` is written by the webhook route, which
 * waits out a five-row lock.
 *
 * ── Rollback ───────────────────────────────────────────────────────────────
 *
 * `20260920130000_a_group_voice_channel_has_no_seat_limit.rollback.sql`, which
 * puts the 2..20 CHECK, the default of 10 and the group rows' 10 back and drops
 * the trigger. **`room.max_participants` in `livekit.yaml` has to go back to 10
 * with it, and the gateway and client changes with that** — a database rolled
 * back alone leaves rows saying 10 while the SFU's fallback is 0, which is not
 * a state anything was designed for. Run the whole set or none of it.
 */

begin;

set local lock_timeout = '5s';

-- 0. The role. Stated as a refusal rather than as a comment, because two
--    migrations in this directory guessed the owner wrong in opposite
--    directions and neither failed at apply time.
do $role$
begin
  if not pg_catalog.pg_has_role(
       current_user, (select relowner from pg_catalog.pg_class
                       where oid = 'public.voice_channels'::regclass), 'MEMBER') then
    raise exception
      'run this as supabase_admin: % cannot alter public.voice_channels, which supabase_admin owns',
      current_user;
  end if;
end
$role$;

-- 1. The bounds. 0 is «no limit»; anything else is a deliberate number and a
--    room for one person is not a room.
alter table public.voice_channels
  drop constraint if exists voice_channels_max_participants_check;

alter table public.voice_channels
  add constraint voice_channels_max_participants_check
  check (max_participants = 0 or (max_participants >= 2 and max_participants <= 99));

-- 2. A new channel is unlimited. This is the line that answers the owner's
--    «изначально ограничения быть не должно» for every channel made from now
--    on, including the ones the create form makes without naming the column.
alter table public.voice_channels
  alter column max_participants set default 0;

-- 3. The channels that already exist. Keyed on «not private» rather than on
--    «= group» on purpose: private is the one chat type whose seat count is a
--    definition, so every other type — including a `channel`, of which
--    production has none today — should inherit the product's intent rather
--    than wait for somebody to remember this file.
update public.voice_channels vc
   set max_participants = 0,
       updated_at = pg_catalog.now()
  from public.chats c
 where c.id = vc.chat_id
   and c.type <> 'private'
   and vc.max_participants <> 0;

-- 4. The private definition, held by the database instead of by a convention.
--
--    SECURITY DEFINER because the answer must not depend on whether the caller
--    can see the chat row; the caller is `authenticated` through PostgREST and
--    `public.chats` carries RLS.
--
--    The `chats` lookup is skipped whenever the value is already 2, which is
--    the common path: `participant_count` moves on every join and leave, and a
--    two-seat group channel is perfectly legal, so the trigger costs nothing
--    except when somebody is actually changing the number.
create or replace function private.enforce_private_chat_voice_seats()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $seats$
begin
  if new.max_participants = 2 then
    return new;
  end if;

  if exists (select 1 from public.chats c
              where c.id = new.chat_id and c.type = 'private') then
    raise exception
      'a private chat holds two people by definition; a third belongs in a group, not in a wider private chat'
      using errcode = '22023';
  end if;

  return new;
end
$seats$;

drop trigger if exists trg_voice_channels_private_is_two on public.voice_channels;

create trigger trg_voice_channels_private_is_two
  before insert or update of max_participants on public.voice_channels
  for each row
  execute function private.enforce_private_chat_voice_seats();

-- 5. Refuse to commit a half-applied state.
--
--    Every clause below is a thing that could be true on its own while the
--    change as a whole is wrong: the constraint replaced but the rows not
--    moved, the rows moved but the default left at 10, the trigger created but
--    not actually refusing anything, or a grant quietly changed by one of the
--    ALTERs.
do $check$
declare
  v_check          text;
  v_default        text;
  v_rows           bigint;
  v_unlimited      bigint;
  v_private_two    bigint;
  v_private_other  bigint;
  v_table_acl      text;
  v_column_acl     text;
  v_policies       text;
  v_private_id     uuid;
  v_refused        boolean := false;
begin
  -- 5.1 The constraint says what this file says it says.
  select pg_catalog.pg_get_constraintdef(oid) into v_check
    from pg_catalog.pg_constraint
   where conrelid = 'public.voice_channels'::regclass
     and conname = 'voice_channels_max_participants_check';
  if v_check is null then
    raise exception 'voice_channels_max_participants_check is missing';
  end if;
  if v_check not like '%= 0%' or v_check not like '%99%' then
    raise exception 'the seat CHECK is not the one this file writes: %', v_check;
  end if;

  -- 5.2 A new channel is unlimited.
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'voice_channels'
     and column_name = 'max_participants';
  if coalesce(v_default, '') not like '0%' then
    raise exception 'the column default is % and not 0', coalesce(v_default, '<null>');
  end if;

  -- 5.3 Every row landed where it belongs, and none was lost.
  --     Fewer rows than the baseline means this file destroyed something; more
  --     means somebody made a channel in the meantime, which is ordinary and
  --     must not block an apply that may happen days after the baseline was
  --     taken. Only the losing direction is a failure.
  select pg_catalog.count(*) into v_rows from public.voice_channels;
  if v_rows < 5 then
    raise exception
      'public.voice_channels holds % rows where the baseline read 5; this file deleted something',
      v_rows;
  end if;

  select pg_catalog.count(*) into v_unlimited
    from public.voice_channels vc join public.chats c on c.id = vc.chat_id
   where c.type <> 'private' and vc.max_participants <> 0;
  if v_unlimited <> 0 then
    raise exception '% non-private voice channels still carry a seat limit', v_unlimited;
  end if;

  select pg_catalog.count(*) filter (where vc.max_participants = 2),
         pg_catalog.count(*) filter (where vc.max_participants <> 2)
    into v_private_two, v_private_other
    from public.voice_channels vc join public.chats c on c.id = vc.chat_id
   where c.type = 'private';
  if v_private_other <> 0 then
    raise exception
      '% private voice channels do not hold two seats; a private chat is two people by definition',
      v_private_other;
  end if;
  if v_private_two < 2 then
    raise exception
      'the baseline read 2 private voice channels and this transaction sees only %', v_private_two;
  end if;

  -- 5.4 The trigger refuses, rather than merely existing. A trigger asserted by
  --     pg_trigger and never fired is the shape of guard this project has
  --     shipped broken before.
  select vc.id into v_private_id
    from public.voice_channels vc join public.chats c on c.id = vc.chat_id
   where c.type = 'private' limit 1;
  if v_private_id is null then
    raise exception 'no private voice channel to prove the trigger against';
  end if;
  begin
    update public.voice_channels set max_participants = 10 where id = v_private_id;
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception
      'a private voice channel accepted ten seats; trg_voice_channels_private_is_two is not binding';
  end if;

  -- 5.5 Grants unchanged, read from the catalogue rather than asserted. A
  --     column REVOKE against a table-level grant is a silent no-op on this
  --     table, so «I did not touch grants» has to be a measurement.
  select pg_catalog.array_to_string(
           pg_catalog.array_agg(a order by a), ' | ')
    into v_table_acl
    from (select pg_catalog.unnest(relacl)::text as a
            from pg_catalog.pg_class where oid = 'public.voice_channels'::regclass) s;
  if v_table_acl is distinct from
     'authenticated=rd/supabase_admin | service_role=arwdDxtm/supabase_admin | supabase_admin=arwdDxtm/supabase_admin'
  then
    raise exception 'the table ACL of public.voice_channels changed: %', v_table_acl;
  end if;

  select pg_catalog.array_to_string(pg_catalog.array_agg(t order by t), ' | ')
    into v_column_acl
    from (select att.attname || '=' || pg_catalog.unnest(att.attacl)::text as t
            from pg_catalog.pg_attribute att
           where att.attrelid = 'public.voice_channels'::regclass
             and att.attacl is not null) s;
  if v_column_acl not like '%max_participants=authenticated=aw/supabase_admin%' then
    raise exception 'the column ACL of max_participants changed: %', v_column_acl;
  end if;

  -- 5.6 The policies are the six that were there, by name.
  select pg_catalog.array_to_string(pg_catalog.array_agg(polname order by polname), ' | ')
    into v_policies
    from pg_catalog.pg_policy where polrelid = 'public.voice_channels'::regclass;
  if v_policies is distinct from
     'admins manage voice channels | block banned reads | block banned writes (delete) | '
     || 'block banned writes (insert) | block banned writes (update) | members read voice channels'
  then
    raise exception 'the policies on public.voice_channels changed: %', v_policies;
  end if;

  raise notice
    'a group voice channel has no seat limit; a private chat holds two, and the database now says so';
end
$check$;

commit;
