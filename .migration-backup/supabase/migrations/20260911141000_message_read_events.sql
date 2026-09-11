/**
 * The exact time each member read each message, a read report that says what
 * was read rather than when it arrived, and a seven-day retention for both.
 *
 * WHAT EXISTS. Reads are one pointer per member, `chat_members.last_read_at`.
 * The client reports reads through `mark_chat_read(uuid)` (20260714090000),
 * which stores `now()` — the moment the request reached the server. «Детали»,
 * «Прочитано» and «Кто прочитал» show that pointer, which is when the reader
 * last read the chat, not when they read this message. And because the pointer
 * is `now()`, a report that arrives late marks as read whatever was sent while
 * it was in flight, including messages that device never drew.
 *
 * THE DESIGN. Every advance of a member's pointer is recorded as an event:
 * chat, member, `read_through` (the new pointer) and `read_at` (the clock when
 * it moved). A message's read time for a member is the `read_at` of the first
 * event whose `read_through` reaches the message's `created_at`.
 *
 *   - Recorded by an AFTER UPDATE trigger on `chat_members`, so every path that
 *     advances the pointer produces an event — the new RPC, the old
 *     `mark_chat_read` an unupdated client still calls, anything else. The
 *     database can therefore go out before the client.
 *   - The first covering event is one index seek. Events for one member are
 *     ordered in `read_through` (the pointer only advances) and in `read_at`
 *     (successive updates of one `chat_members` row are serialised by its row
 *     lock, and `read_at` is `clock_timestamp()` taken inside the update), so
 *     the event with the smallest `read_through` at or past the message is also
 *     the earliest. The primary key (chat, member, read_through) INCLUDE
 *     (read_at) answers it as an index-only scan.
 *   - Alternatives measured against it: a row per message per reader writes
 *     (unread messages × members) rows on every read of a busy group, where an
 *     event is one row per advance; publishing events to Realtime would send a
 *     second change per read to every subscriber of the table, where the sync
 *     already travels on the `chat_members` UPDATE the pointer produces (see
 *     REALTIME below).
 *
 * `mark_chat_read_through(chat, read_through)` is the read report the client
 * now sends: the `created_at` of the newest message it has drawn. The pointer
 * becomes the later of the stored value and `least(read_through, now())`, so a
 * stale device that reports late neither moves it backwards nor marks as read
 * what it never saw. It advances the delivered mark the same way and marks the
 * chat's notifications read up to the pointer. SECURITY INVOKER on purpose: the
 * update runs under the caller's own `chat_members update` policy and the
 * restrictive ban veto, exactly like `mark_chat_read`.
 *
 * `message_read_times(message)` answers the sender of a message, and only the
 * sender, with one row per other member of the chat: whether their pointer has
 * reached the message, and when they read it, or NULL when there is no time to
 * show. It is SECURITY DEFINER because the events table is readable by no API
 * role and because the privacy rule reads other people's preferences.
 *
 * PRIVACY. A read time is when the reader was online, so it follows the one
 * presence setting the product has, `privacy_preferences.presence_visible`
 * («Показывать, когда я в сети», default on), the way Telegram ties read times
 * to «Последняя активность»: a time is shown only when the reader shows their
 * presence AND the person asking shows theirs. Hide yours and you see no one's
 * read times; hide it and no one sees yours. That the message was read is still
 * shown — the check marks are the pointer, which every member of the chat could
 * already read. The rule lives in one function, `private.read_time_visible`,
 * which is where a future subscription would change it.
 *
 * RETENTION. Seven days, as Telegram. `message_read_times` gives a time only
 * for messages sent in the last seven days, and the cleanup deletes events whose
 * `read_at` is older than seven days. The two cut on different columns on
 * purpose: the first covering event of a message sent inside the window was
 * read after the message was sent, so it is itself inside the window and cannot
 * have been deleted — a lookup can never fall through to a later event and
 * report a later time. The cleanup is batched, idempotent and safe to run at
 * any time; when pg_cron is installed it is scheduled hourly as
 * `letscube-message-read-events-cleanup`.
 *
 * REALTIME. `private.message_read_events` is not published and must not be. A
 * read already reaches the reader's other devices and the sender through the
 * UPDATE of `chat_members`, which is published (20260504_folders_shared.sql)
 * and consumed by the `chat-members:user` and `chat-members:receipts` channels.
 * The exact time is fetched when a sender opens the details, and fetched again
 * when that UPDATE moves a reader's pointer while they are open.
 *
 * DEPENDS ON: public.chat_members (primary key chat_id, user_id), public.messages,
 * public.privacy_preferences (20260903190000), public.is_banned(uuid),
 * public.notifications_mark_chat_messages_read(uuid, timestamptz).
 *
 * OWNER. Apply as the role that owns `public.privacy_preferences` (postgres on
 * this deployment), or as a superuser: `private.presence_visible` has to read
 * other people's rows past that table's own-row policy. The self-check refuses
 * to commit otherwise.
 *
 * Rollback: 20260911141000_message_read_events.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

create table if not exists private.message_read_events (
  chat_id uuid not null,
  user_id uuid not null,
  read_through timestamptz not null,
  read_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint message_read_events_pkey
    primary key (chat_id, user_id, read_through) include (read_at),
  constraint message_read_events_member_fkey
    foreign key (chat_id, user_id)
    references public.chat_members (chat_id, user_id)
    on delete cascade,
  constraint message_read_events_read_after_through
    check (read_at >= read_through)
);

-- New and empty, so a plain index inside the transaction is instant.
create index if not exists message_read_events_read_at_idx
  on private.message_read_events (read_at);

alter table private.message_read_events enable row level security;
revoke all on table private.message_read_events from public, anon, authenticated, service_role;

comment on table private.message_read_events is
  'One row per advance of a member''s read pointer. Read only through public.message_read_times; kept seven days.';

create or replace function private.message_read_time_retention()
returns interval
language sql
immutable
set search_path = ''
as $function$
  select interval '7 days'
$function$;

create or replace function private.record_message_read_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_through timestamptz;
begin
  if new.last_read_at is null
     or (old.last_read_at is not null and new.last_read_at <= old.last_read_at) then
    return null;
  end if;
  v_through := least(new.last_read_at, pg_catalog.now());
  insert into private.message_read_events (chat_id, user_id, read_through, read_at)
  values (new.chat_id, new.user_id, v_through, greatest(pg_catalog.clock_timestamp(), v_through))
  on conflict on constraint message_read_events_pkey do nothing;
  return null;
end
$function$;

drop trigger if exists trg_record_message_read_event on public.chat_members;
create trigger trg_record_message_read_event
  after update of last_read_at on public.chat_members
  for each row
  when (new.last_read_at is distinct from old.last_read_at)
  execute function private.record_message_read_event();

create or replace function private.presence_visible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select preference.presence_visible
       from public.privacy_preferences as preference
      where preference.user_id = p_user_id),
    true
  )
$function$;

create or replace function private.read_time_visible(p_viewer_id uuid, p_reader_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.presence_visible(p_viewer_id) and private.presence_visible(p_reader_id)
$function$;

create or replace function public.mark_chat_read_through(
  p_chat_id uuid,
  p_read_through timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_through timestamptz;
  v_pointer timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_chat_id is null then
    raise exception 'invalid_chat_id' using errcode = '22023';
  end if;

  v_through := least(coalesce(p_read_through, v_now), v_now);

  -- A report that moves nothing writes nothing, so a stale device does not
  -- send every member of the chat a Realtime change for a read that happened.
  update public.chat_members as membership
     set last_read_at = case
           when membership.last_read_at is null or membership.last_read_at < v_through then v_through
           else membership.last_read_at
         end,
         last_delivered_at = case
           when membership.last_delivered_at is null or membership.last_delivered_at < v_through then v_through
           else membership.last_delivered_at
         end
   where membership.chat_id = p_chat_id
     and membership.user_id = v_uid
     and (
       membership.last_read_at is null or membership.last_read_at < v_through
       or membership.last_delivered_at is null or membership.last_delivered_at < v_through
     )
  returning membership.last_read_at into v_pointer;

  if not found then
    select membership.last_read_at
      into v_pointer
      from public.chat_members as membership
     where membership.chat_id = p_chat_id
       and membership.user_id = v_uid;
    if not found then
      raise exception 'chat_member_required' using errcode = '42501';
    end if;
  end if;

  if v_pointer is not null then
    perform public.notifications_mark_chat_messages_read(p_chat_id, v_pointer);
  end if;
  return v_pointer;
end
$function$;

create or replace function public.message_read_times(p_message_id uuid)
returns table (reader_id uuid, has_read boolean, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_chat_id uuid;
  v_sender_id uuid;
  v_bot_id uuid;
  v_created_at timestamptz;
  v_deleted_at timestamptz;
  v_window_start timestamptz := pg_catalog.now() - private.message_read_time_retention();
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_message_id is null then
    raise exception 'invalid_message_id' using errcode = '22023';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'user_banned' using errcode = '42501';
  end if;

  select message.chat_id, message.user_id, message.bot_id, message.created_at, message.deleted_at
    into v_chat_id, v_sender_id, v_bot_id, v_created_at, v_deleted_at
    from public.messages as message
   where message.id = p_message_id;

  -- One answer for "no such message", "not your chat" and "deleted", so the
  -- function cannot be used to learn whether a message id exists.
  if not found
     or v_deleted_at is not null
     or not exists (
       select 1
         from public.chat_members as me
        where me.chat_id = v_chat_id
          and me.user_id = v_uid
     ) then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  if v_bot_id is not null or v_sender_id is distinct from v_uid then
    raise exception 'not_message_sender' using errcode = '42501';
  end if;

  return query
  select member.user_id,
         coalesce(member.last_read_at >= v_created_at, false),
         case
           when member.last_read_at is null or member.last_read_at < v_created_at then null
           when v_created_at < v_window_start then null
           when not private.read_time_visible(v_uid, member.user_id) then null
           else (
             select event.read_at
               from private.message_read_events as event
              where event.chat_id = v_chat_id
                and event.user_id = member.user_id
                and event.read_through >= v_created_at
              order by event.read_through
              limit 1
           )
         end
    from public.chat_members as member
   where member.chat_id = v_chat_id
     and member.user_id <> v_uid
   order by 3 desc nulls last, 1;
end
$function$;

create or replace function public.message_read_events_cleanup(
  p_batch_size integer default 5000,
  p_max_batches integer default 20
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_cutoff timestamptz := pg_catalog.now() - private.message_read_time_retention();
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 5000), 50000));
  v_rounds integer := greatest(1, least(coalesce(p_max_batches, 20), 1000));
  v_deleted integer;
  v_total bigint := 0;
begin
  for v_round in 1..v_rounds loop
    delete from private.message_read_events as event
     where event.ctid = any (array(
       select candidate.ctid
         from private.message_read_events as candidate
        where candidate.read_at < v_cutoff
        limit v_batch
     ));
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted < v_batch;
  end loop;
  return v_total;
end
$function$;

revoke all on function private.message_read_time_retention() from public, anon, authenticated, service_role;
revoke all on function private.record_message_read_event() from public, anon, authenticated, service_role;
revoke all on function private.presence_visible(uuid) from public, anon, authenticated, service_role;
revoke all on function private.read_time_visible(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.mark_chat_read_through(uuid, timestamptz) from public, anon;
grant execute on function public.mark_chat_read_through(uuid, timestamptz) to authenticated;

revoke all on function public.message_read_times(uuid) from public, anon;
grant execute on function public.message_read_times(uuid) to authenticated;

revoke all on function public.message_read_events_cleanup(integer, integer) from public, anon, authenticated;
grant execute on function public.message_read_events_cleanup(integer, integer) to service_role;

comment on function public.mark_chat_read_through(uuid, timestamptz) is
  'Advances the caller''s read and delivered marks to the newest message the client has drawn, clamped to now, never backwards. Returns the pointer.';
comment on function public.message_read_times(uuid) is
  'For the sender of a message: every other member, whether they have read it, and the exact time when it is within seven days and both people show their presence.';

-- Hourly cleanup where pg_cron exists. Elsewhere the function is there to be
-- called by whatever schedules this deployment's jobs.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'letscube-message-read-events-cleanup') then
      perform cron.unschedule('letscube-message-read-events-cleanup');
    end if;
    perform cron.schedule(
      'letscube-message-read-events-cleanup',
      '17 * * * *',
      'select public.message_read_events_cleanup(5000, 20)'
    );
  else
    raise notice 'pg_cron is not installed: schedule public.message_read_events_cleanup() elsewhere';
  end if;
end
$$;

-- Refuse to commit unless every piece is in place and closed to the API roles.
do $$
declare
  v_expected record;
  v_proc record;
  v_trigger record;
  v_columns text[];
  v_fn_owner oid;
  v_table_owner oid;
  v_forced boolean;
  v_bypass boolean;
begin
  if pg_catalog.to_regclass('private.message_read_events') is null then
    raise exception 'private.message_read_events is missing';
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'private.message_read_events'::regclass) then
    raise exception 'private.message_read_events has row-level security off';
  end if;
  if pg_catalog.has_table_privilege('anon', 'private.message_read_events', 'SELECT, INSERT, UPDATE, DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'private.message_read_events', 'SELECT, INSERT, UPDATE, DELETE')
     or pg_catalog.has_table_privilege('service_role', 'private.message_read_events', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'an API role holds a privilege on private.message_read_events';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'private.message_read_events'::regclass and contype = 'p'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'private.message_read_events'::regclass and contype = 'f'
       and confrelid = 'public.chat_members'::regclass and confdeltype = 'c'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'private.message_read_events'::regclass and contype = 'c'
  ) then
    raise exception 'private.message_read_events is missing its key, its member reference or its ordering check';
  end if;

  select t.tgenabled, t.tgtype, t.tgattr, t.tgqual is not null as has_when, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.chat_members'::regclass
     and t.tgname = 'trg_record_message_read_event'
     and not t.tgisinternal;
  if not found or v_trigger.tgenabled = 'D' then
    raise exception 'the read event trigger is missing or disabled';
  end if;
  -- tgtype bits: 1 = row, 2 = before (must be clear), 16 = update.
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) <> 0 or (v_trigger.tgtype & 16) = 0
     or not v_trigger.has_when or v_trigger.fn <> 'private.record_message_read_event()' then
    raise exception 'the read event trigger is not an AFTER UPDATE row trigger with its WHEN clause calling the recorder';
  end if;
  select pg_catalog.array_agg(a.attname::text order by a.attname)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.chat_members'::regclass
     and a.attnum = any (v_trigger.tgattr::smallint[]);
  if v_columns is distinct from array['last_read_at'] then
    raise exception 'the read event trigger fires for % instead of last_read_at', v_columns;
  end if;

  for v_expected in
    select * from (values
      ('public.mark_chat_read_through(uuid,timestamp with time zone)', false),
      ('public.message_read_times(uuid)', true),
      ('public.message_read_events_cleanup(integer,integer)', true),
      ('private.record_message_read_event()', true),
      ('private.presence_visible(uuid)', true),
      ('private.read_time_visible(uuid,uuid)', true),
      ('private.message_read_time_retention()', false)
    ) as expected(signature, definer)
  loop
    select p.prosecdef, p.proconfig
      into v_proc
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(v_expected.signature);
    if not found then
      raise exception 'function % is missing', v_expected.signature;
    end if;
    if v_proc.prosecdef is distinct from v_expected.definer then
      raise exception 'function % has SECURITY DEFINER = %, expected %', v_expected.signature, v_proc.prosecdef, v_expected.definer;
    end if;
    if not exists (select 1 from pg_catalog.unnest(v_proc.proconfig) c where c like 'search_path=%') then
      raise exception 'function % has no fixed search_path', v_expected.signature;
    end if;
    if v_expected.signature like 'private.%'
       and (pg_catalog.has_function_privilege('anon', v_expected.signature, 'EXECUTE')
            or pg_catalog.has_function_privilege('authenticated', v_expected.signature, 'EXECUTE')) then
      raise exception 'private function % is executable by an API role', v_expected.signature;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege('authenticated', 'public.mark_chat_read_through(uuid,timestamp with time zone)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.message_read_times(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute the read RPCs';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.mark_chat_read_through(uuid,timestamp with time zone)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.message_read_times(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.message_read_events_cleanup(integer,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.message_read_events_cleanup(integer,integer)', 'EXECUTE') then
    raise exception 'anon can execute a read RPC, or an API user can run the cleanup';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.message_read_events_cleanup(integer,integer)', 'EXECUTE') then
    raise exception 'service_role cannot run the cleanup';
  end if;

  if private.message_read_time_retention() <> interval '7 days' then
    raise exception 'the retention is % instead of seven days', private.message_read_time_retention();
  end if;

  -- The privacy rule reads other people's preferences. A function owner that
  -- the table's own-row policy applies to would read nobody's row, default to
  -- "visible" and show every hidden read time.
  select p.proowner into v_fn_owner
    from pg_catalog.pg_proc p
   where p.oid = 'private.presence_visible(uuid)'::regprocedure;
  select c.relowner, c.relforcerowsecurity into v_table_owner, v_forced
    from pg_catalog.pg_class c
   where c.oid = 'public.privacy_preferences'::regclass;
  select r.rolsuper or r.rolbypassrls into v_bypass
    from pg_catalog.pg_roles r
   where r.oid = v_fn_owner;
  if not v_bypass and (v_forced or not pg_catalog.pg_has_role(v_fn_owner, v_table_owner, 'USAGE')) then
    raise exception 'private.presence_visible is owned by %, which row-level security on public.privacy_preferences (owner %, forced %) would blind; apply as the table owner',
      pg_catalog.pg_get_userbyid(v_fn_owner), pg_catalog.pg_get_userbyid(v_table_owner), v_forced;
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'private' and tablename = 'message_read_events'
  ) then
    raise exception 'private.message_read_events must not be published to Realtime';
  end if;

  -- Nested, not joined with AND: PL/pgSQL plans a whole condition, and cron.job
  -- does not exist where pg_cron is not installed.
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1 from cron.job
       where jobname = 'letscube-message-read-events-cleanup'
         and command like '%message_read_events_cleanup%'
    ) then
      raise exception 'pg_cron is installed but the read events cleanup is not scheduled';
    end if;
  end if;
end
$$;

commit;
