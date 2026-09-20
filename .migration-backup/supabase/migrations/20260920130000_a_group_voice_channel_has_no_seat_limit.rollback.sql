-- Rollback for `20260920130000_a_group_voice_channel_has_no_seat_limit.sql`.
--
-- Puts the 2..20 CHECK back, the column default back to 10, every non-private
-- voice channel back to 10 seats, and drops the trigger that pins a private
-- chat at two.
--
-- ── THIS IS NOT THE WHOLE ROLLBACK, and running it alone is worse than
--    running nothing ────────────────────────────────────────────────────────
--
-- The change is three halves and this is one of them. Undo them together, in
-- this order, or the deployment lands in a state nothing was designed for:
--
--   1. the client and `supabase/functions/voice-gateway/` — `git revert` the
--      commit, redeploy the Edge Function into
--      `…/volumes/functions/voice-gateway/`, and `main` for the web bundle;
--   2. `/srv/letscube/voice/livekit.yaml` — `room.max_participants` back to
--      `10`, then `cd /srv/letscube/voice && docker compose up -d`, which
--      restarts the SFU and drops any call in progress;
--   3. this file, as `supabase_admin`.
--
-- Taking (3) alone leaves rows saying 10 while the SFU's fallback for a zero is
-- 0, and a gateway that still treats 0 as unlimited; taking (2) alone
-- reinstates the ten-person cap invisibly, which is the exact failure the
-- migration's header exists to describe.
--
-- ── WHAT THIS CANNOT RESTORE ────────────────────────────────────────────────
--
-- A seat count somebody deliberately chose while the migration was live. This
-- file writes **10** to every non-private channel, because 10 is what all three
-- of them carried in the 2026-09-20 baseline and there is no record anywhere of
-- a per-channel value before that. Read
-- `select id, chat_id, name, max_participants from public.voice_channels order by created_at`
-- first if anything was changed after the migration; `public.audit_logs` is the
-- only other place a change might show, and voice channel edits are not audited
-- there today.
--
-- A channel **created** while the migration was live carries the default 0 and
-- becomes 10 here, which for a channel that never had a limit is an invention
-- rather than a restoration. There is no better answer: the 2..20 CHECK being
-- restored cannot hold a 0.
--
-- Run it as `supabase_admin`: `public.voice_channels` is owned by that role and
-- `postgres` is not a member of it, so the ALTERs fail as `postgres`.

begin;

set local lock_timeout = '5s';

do $role$
begin
  if not pg_catalog.pg_has_role(
       current_user, (select relowner from pg_catalog.pg_class
                       where oid = 'public.voice_channels'::regclass), 'MEMBER') then
    raise exception
      'run this as supabase_admin: % cannot alter public.voice_channels', current_user;
  end if;
end
$role$;

-- The trigger goes first: with the CHECK about to forbid 0 anyway, leaving a
-- private-chat guard in place would be harmless, but it belongs to the change
-- being undone and a half-reverted object is how the next reader is misled.
drop trigger if exists trg_voice_channels_private_is_two on public.voice_channels;
drop function if exists private.enforce_private_chat_voice_seats();

-- Every unlimited channel takes a number again, before the CHECK that forbids
-- zero is added back. The order matters: the reverse fails on the scan.
update public.voice_channels vc
   set max_participants = 10,
       updated_at = pg_catalog.now()
  from public.chats c
 where c.id = vc.chat_id
   and c.type <> 'private'
   and vc.max_participants = 0;

-- Any row still at 0 — a private chat's, if one was somehow zeroed — becomes 2,
-- which is the only value the definition allows it.
update public.voice_channels
   set max_participants = 2,
       updated_at = pg_catalog.now()
 where max_participants = 0;

alter table public.voice_channels
  drop constraint if exists voice_channels_max_participants_check;

alter table public.voice_channels
  add constraint voice_channels_max_participants_check
  check (max_participants >= 2 and max_participants <= 20);

alter table public.voice_channels
  alter column max_participants set default 10;

do $check$
declare
  v_check   text;
  v_default text;
  v_zero    bigint;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_check
    from pg_catalog.pg_constraint
   where conrelid = 'public.voice_channels'::regclass
     and conname = 'voice_channels_max_participants_check';
  if v_check is null or v_check like '%= 0%' then
    raise exception 'the original seat CHECK was not restored: %', coalesce(v_check, '<missing>');
  end if;

  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'voice_channels'
     and column_name = 'max_participants';
  if coalesce(v_default, '') not like '10%' then
    raise exception 'the column default is % and not 10', coalesce(v_default, '<null>');
  end if;

  select pg_catalog.count(*) into v_zero
    from public.voice_channels where max_participants = 0;
  if v_zero <> 0 then
    raise exception '% voice channels still carry an unlimited seat count', v_zero;
  end if;

  if pg_catalog.to_regclass('public.voice_channels') is not null
     and exists (select 1 from pg_catalog.pg_trigger
                  where tgrelid = 'public.voice_channels'::regclass
                    and tgname = 'trg_voice_channels_private_is_two') then
    raise exception 'trg_voice_channels_private_is_two is still installed';
  end if;

  raise notice 'the ten-seat cap and the 2..20 CHECK are back; revert the gateway, the client and livekit.yaml with them';
end
$check$;

commit;
