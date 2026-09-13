/**
 * Voice channels: the tables, the rules and the six functions the gateway and
 * the reconciler call.
 *
 * THE OWNER asked for Discord-shaped voice channels. `docs/proposals/2026-09-13-voice-channels.md`
 * is the plan; this is its slice 2 database half. Slice 1 is already done and
 * measured (`docs/operations/voice-probe.md`): a LiveKit SFU runs on this host,
 * and a client whose network carries no UDP reaches it over TCP, which was the
 * one assumption the whole plan rested on.
 *
 * ONE DECISION GOVERNS THE REST: **the SFU owns the truth about who is in a
 * call, and this database only mirrors it.** Everything below follows from
 * that. No client ever writes `voice_participants` — the table has no INSERT,
 * UPDATE or DELETE policy at all, which with RLS on denies every write that is
 * not `SECURITY DEFINER`. That is `public.notifications` exactly, and here it is
 * the mechanism that makes the rule true rather than a convention somebody has
 * to remember.
 *
 * WHY A MIRROR AT ALL, when the SDK tells a participant who else is there: the
 * people who are *not* in the call. A chat list badge, a member list, the cap
 * check in the gateway and RLS itself cannot ask a WebRTC session anything.
 *
 * `joined_at` is deliberately **not** `default now()`: it is the moment LiveKit
 * reports for that participant, and `voice_participant_left` compares against it
 * before deleting. Without that comparison, joining from a second device
 * produces a webhook ordering — «left» for the old session arriving after
 * «joined» for the new one — that deletes the row somebody is currently using.
 * One column and one `and`, and the bug it prevents reproduces only when
 * somebody changes device mid-call.
 *
 * `participant_count` is a denormalisation, and denormalised counters lie. The
 * guard is that nothing ever increments it: every function that touches it
 * recomputes it in the same statement from `voice_participants`. It cannot
 * drift, and it saves the chat list a join and N subscriptions.
 *
 * OWNER. Apply as the owner of `public.chats` (postgres on this deployment).
 *
 * Lock: CREATE TABLE takes no lock on anything existing; the publication change
 * takes a brief lock on the publication. `lock_timeout` gives up after five
 * seconds rather than queue behind a long transaction.
 *
 * Rollback: 20260913150000_voice_channels.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

-- ── the tables ──────────────────────────────────────────────────────────────

create table if not exists public.voice_channels (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            uuid not null references public.chats(id) on delete cascade,
  name               text not null,
  position           integer not null default 0,
  max_participants   smallint not null default 10,
  speak_role         public.chat_member_role not null default 'member',
  participant_count  integer not null default 0,
  active_since       timestamptz null,
  archived           boolean not null default false,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default pg_catalog.now(),
  updated_at         timestamptz not null default pg_catalog.now(),
  constraint voice_channels_name_length_check
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 64),
  constraint voice_channels_max_participants_check
    check (max_participants between 2 and 20),
  constraint voice_channels_count_check
    check (participant_count >= 0)
);

comment on table public.voice_channels is
  'A room inside a group that people join to talk. The SFU owns who is in it; this row holds what the people outside need to know.';
comment on column public.voice_channels.participant_count is
  'Recomputed by every function that touches it, never incremented, so it cannot drift from voice_participants.';
comment on column public.voice_channels.speak_role is
  'The lowest chat role that may publish audio. A listen-only channel is this column, not a feature.';

create index if not exists voice_channels_chat_idx
  on public.voice_channels (chat_id, position);

-- One per chat for now. Dropping this index is how the product grows to many.
create unique index if not exists voice_channels_one_per_chat_idx
  on public.voice_channels (chat_id) where not archived;

create table if not exists public.voice_participants (
  channel_id        uuid not null references public.voice_channels(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  joined_at         timestamptz not null,
  confirmed_at      timestamptz not null default pg_catalog.now(),
  primary key (channel_id, user_id)
);

comment on table public.voice_participants is
  'A mirror of what the SFU reports. No client writes it: there is no write policy, which with RLS on denies everything that is not SECURITY DEFINER.';
comment on column public.voice_participants.joined_at is
  'What LiveKit reported, not now(). voice_participant_left compares against it so a second device cannot delete the session it just replaced.';

create index if not exists voice_participants_stale_idx
  on public.voice_participants (confirmed_at);

-- DELETE payloads must carry `channel_id` for the realtime subscribers that
-- filter on it; without this they carry the primary key only.
alter table public.voice_participants replica identity full;

create table if not exists private.voice_webhook_events (
  event_id    uuid primary key,
  received_at timestamptz not null default pg_catalog.now()
);

comment on table private.voice_webhook_events is
  'Webhook idempotency. Private because PostgREST here exposes public, storage and graphql_public, and this is nobody business but the worker.';

-- ── the helper the participants policy needs ────────────────────────────────

create or replace function public.voice_channel_chat(vc uuid)
returns uuid
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
  select chat_id from public.voice_channels where id = vc
$function$;

revoke all on function public.voice_channel_chat(uuid) from public, anon;
grant execute on function public.voice_channel_chat(uuid) to authenticated;

-- ── who may reach the tables at all ─────────────────────────────────────────

/**
 * Table privileges, stated rather than inherited.
 *
 * The rehearsal caught this: created by `supabase_admin`, the tables carried no
 * grant for `authenticated` at all, and a member reading their own group's
 * channel got «permission denied» before any policy was consulted. The default
 * privileges here differ by who creates the table, so a migration that relies on
 * them behaves differently depending on which role applies it.
 *
 * `voice_participants` gets SELECT and nothing else. The absent write policies
 * already deny every write; the absent write grant means the attempt does not
 * reach them.
 */
grant select, insert, delete on public.voice_channels to authenticated;
-- UPDATE is granted per column, never table-wide, and that distinction is the
-- whole of it: a column-level REVOKE cannot carve a hole out of a table-level
-- GRANT. The rehearsal proved it — with `grant update` on the table and
-- `revoke update (participant_count)` after it, a member still set the count to
-- 99. These are the columns an administrator may really change; the two the SFU
-- owns are simply never granted.
grant update (name, position, max_participants, speak_role, archived, updated_at)
  on public.voice_channels to authenticated;
grant select on public.voice_participants to authenticated;
grant all on public.voice_channels, public.voice_participants to service_role;

-- ── who may read what ───────────────────────────────────────────────────────

alter table public.voice_channels enable row level security;
alter table public.voice_participants enable row level security;

drop policy if exists "members read voice channels" on public.voice_channels;
create policy "members read voice channels"
  on public.voice_channels for select
  to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "admins manage voice channels" on public.voice_channels;
create policy "admins manage voice channels"
  on public.voice_channels for all
  to authenticated
  using      (public.is_chat_admin(chat_id))
  with check (public.is_chat_admin(chat_id));

drop policy if exists "members read voice participants" on public.voice_participants;
create policy "members read voice participants"
  on public.voice_participants for select
  to authenticated
  using (public.is_chat_member(public.voice_channel_chat(channel_id)));

-- And the belt to the braces above: if a table-wide UPDATE is ever granted here
-- by hand, this revoke takes the two columns back out of it.
revoke update (participant_count, active_since) on public.voice_channels from authenticated;

-- The ban policies, by the names the rest of the product uses. The loop that
-- added them everywhere else runs over a fixed list and will not pick up a new
-- table.
drop policy if exists "block banned reads" on public.voice_channels;
create policy "block banned reads"
  on public.voice_channels as restrictive for select to authenticated
  using (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (insert)" on public.voice_channels;
create policy "block banned writes (insert)"
  on public.voice_channels as restrictive for insert to authenticated
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (update)" on public.voice_channels;
create policy "block banned writes (update)"
  on public.voice_channels as restrictive for update to authenticated
  using      (not public.is_banned(auth.uid()))
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (delete)" on public.voice_channels;
create policy "block banned writes (delete)"
  on public.voice_channels as restrictive for delete to authenticated
  using (not public.is_banned(auth.uid()));

drop policy if exists "block banned reads" on public.voice_participants;
create policy "block banned reads"
  on public.voice_participants as restrictive for select to authenticated
  using (not public.is_banned(auth.uid()));

-- ── what the gateway and the reconciler call ────────────────────────────────

/**
 * Recompute one channel's count from the rows, in one statement.
 *
 * Every function below ends with this rather than adding or subtracting one,
 * which is the whole reason the counter can be trusted.
 */
create or replace function private.voice_channel_recount(p_channel_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  update public.voice_channels
     set participant_count = (
           select pg_catalog.count(*)
             from public.voice_participants
            where channel_id = p_channel_id
         ),
         updated_at = pg_catalog.now()
   where id = p_channel_id;
$function$;

revoke all on function private.voice_channel_recount(uuid) from public, anon, authenticated, service_role;

create or replace function public.voice_participant_joined(
  p_channel_id uuid,
  p_user_id uuid,
  p_joined_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if p_channel_id is null or p_user_id is null or p_joined_at is null then
    return;
  end if;
  insert into public.voice_participants (channel_id, user_id, joined_at, confirmed_at)
  values (p_channel_id, p_user_id, p_joined_at, pg_catalog.now())
  on conflict (channel_id, user_id) do update
    set joined_at = greatest(public.voice_participants.joined_at, excluded.joined_at),
        confirmed_at = pg_catalog.now();
  perform private.voice_channel_recount(p_channel_id);
end;
$function$;

/**
 * Somebody left — but only if the session that left is not older than the one
 * the table holds.
 *
 * This is the duplicate-identity case. Joining from a second device makes
 * LiveKit disconnect the first, and the two webhooks are not ordered: «left»
 * for the old session can arrive after «joined» for the new one. Deleting
 * unconditionally would then remove the row for a call that is still running,
 * and the reconciler would put it back thirty seconds later — a flicker nobody
 * could reproduce without a second device.
 */
create or replace function public.voice_participant_left(
  p_channel_id uuid,
  p_user_id uuid,
  p_joined_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if p_channel_id is null or p_user_id is null then
    return;
  end if;
  delete from public.voice_participants
   where channel_id = p_channel_id
     and user_id = p_user_id
     and (p_joined_at is null or joined_at <= p_joined_at);
  perform private.voice_channel_recount(p_channel_id);
end;
$function$;

/**
 * The whole set, atomically, as the reconciler observed it.
 *
 * The reconciler calls this only when LiveKit answered. An error there means «I
 * do not know», never «the room is empty», and an empty array written on a
 * failed read would empty a room full of people.
 */
create or replace function public.voice_participants_replace(
  p_channel_id uuid,
  p_user_ids uuid[],
  p_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_observed timestamptz := coalesce(p_observed_at, pg_catalog.now());
begin
  if p_channel_id is null then
    return;
  end if;

  delete from public.voice_participants
   where channel_id = p_channel_id
     and not (user_id = any (coalesce(p_user_ids, array[]::uuid[])));

  if p_user_ids is not null and array_length(p_user_ids, 1) > 0 then
    insert into public.voice_participants (channel_id, user_id, joined_at, confirmed_at)
    select p_channel_id, ids.id, v_observed, v_observed
      from unnest(p_user_ids) as ids(id)
    on conflict (channel_id, user_id) do update
      set confirmed_at = v_observed;
  end if;

  perform private.voice_channel_recount(p_channel_id);
end;
$function$;

create or replace function public.voice_channel_set_active(
  p_channel_id uuid,
  p_active_since timestamptz
)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  update public.voice_channels
     set active_since = p_active_since,
         updated_at = pg_catalog.now()
   where id = p_channel_id;
$function$;

/**
 * Rows nobody has confirmed lately.
 *
 * The last layer of section 3.6: a participant whose room vanished with the
 * server, whose webhook never arrived and whom no reconciliation covered,
 * because the channel itself stopped being listed.
 */
create or replace function public.voice_participants_reap(p_older_than timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_channels uuid[];
  v_deleted integer;
begin
  if p_older_than is null then
    return 0;
  end if;

  with gone as (
    delete from public.voice_participants
     where confirmed_at < p_older_than
    returning channel_id
  )
  select pg_catalog.array_agg(distinct channel_id), pg_catalog.count(*)
    into v_channels, v_deleted
    from gone;

  if v_channels is not null then
    perform private.voice_channel_recount(channel_id)
       from unnest(v_channels) as channel_id;
  end if;

  return coalesce(v_deleted, 0);
end;
$function$;

/** True the first time an event id is seen, false every time after. */
create or replace function public.voice_webhook_event_seen(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if p_event_id is null then
    return false;
  end if;
  insert into private.voice_webhook_events (event_id) values (p_event_id)
  on conflict (event_id) do nothing;
  return found;
end;
$function$;

/** Idempotency rows older than a day, cleared by the same worker that writes them. */
create or replace function public.voice_webhook_events_purge(p_older_than timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_deleted integer;
begin
  if p_older_than is null then
    return 0;
  end if;
  delete from private.voice_webhook_events where received_at < p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.voice_participant_joined(uuid,uuid,timestamptz)',
    'public.voice_participant_left(uuid,uuid,timestamptz)',
    'public.voice_participants_replace(uuid,uuid[],timestamptz)',
    'public.voice_channel_set_active(uuid,timestamptz)',
    'public.voice_participants_reap(timestamptz)',
    'public.voice_webhook_event_seen(uuid)',
    'public.voice_webhook_events_purge(timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$grants$;

-- ── realtime ────────────────────────────────────────────────────────────────

do $publish$
declare
  v_table text;
begin
  foreach v_table in array array['voice_channels', 'voice_participants']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
      raise notice 'published public.%', v_table;
    end if;
  end loop;
end
$publish$;

-- ── the self-check, which raises rather than committing half of this ────────

do $check$
declare
  v_missing text := '';
  v_signature text;
begin
  if pg_catalog.to_regclass('public.voice_channels') is null
     or pg_catalog.to_regclass('public.voice_participants') is null
     or pg_catalog.to_regclass('private.voice_webhook_events') is null then
    v_missing := v_missing || ' tables';
  end if;

  -- Row level security on, and — the part that matters — no write policy on the
  -- participants at all. A permissive write policy appearing here later is the
  -- one change that would break the rule this whole design rests on.
  if not (select relrowsecurity from pg_class where oid = 'public.voice_participants'::regclass) then
    v_missing := v_missing || ' participants_rls';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'voice_participants'
       and cmd in ('INSERT', 'UPDATE', 'DELETE') and permissive = 'PERMISSIVE'
  ) then
    v_missing := v_missing || ' participants_have_a_write_policy';
  end if;

  foreach v_signature in array array[
    'public.voice_participant_joined(uuid,uuid,timestamptz)',
    'public.voice_participant_left(uuid,uuid,timestamptz)',
    'public.voice_participants_replace(uuid,uuid[],timestamptz)',
    'public.voice_channel_set_active(uuid,timestamptz)',
    'public.voice_participants_reap(timestamptz)',
    'public.voice_webhook_event_seen(uuid)',
    'public.voice_webhook_events_purge(timestamptz)'
  ]
  loop
    if not pg_catalog.has_function_privilege('service_role', v_signature, 'execute') then
      v_missing := v_missing || ' no_service_role_on_' || v_signature;
    end if;
    if pg_catalog.has_function_privilege('authenticated', v_signature, 'execute') then
      v_missing := v_missing || ' leaked_to_authenticated_' || v_signature;
    end if;
  end loop;

  -- The two columns the SFU owns must not be writable by a client. Asked of the
  -- privilege itself, because the first attempt granted UPDATE table-wide and a
  -- column revoke after it changed nothing at all.
  if pg_catalog.has_column_privilege('authenticated', 'public.voice_channels', 'participant_count', 'update')
     or pg_catalog.has_column_privilege('authenticated', 'public.voice_channels', 'active_since', 'update') then
    v_missing := v_missing || ' count_is_writable';
  end if;
  if not pg_catalog.has_column_privilege('authenticated', 'public.voice_channels', 'name', 'update') then
    v_missing := v_missing || ' name_is_not_writable';
  end if;

  if (
    select pg_catalog.count(*) from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('voice_channels', 'voice_participants')
  ) <> 2 then
    v_missing := v_missing || ' publication';
  end if;

  if (select relreplident from pg_class where oid = 'public.voice_participants'::regclass) <> 'f' then
    v_missing := v_missing || ' replica_identity';
  end if;

  if v_missing <> '' then
    raise exception 'the voice channel migration is half applied:%', v_missing;
  end if;
end
$check$;

commit;
