-- Tracker item 58: coming back to a conversation without waiting. The last
-- round trip on the way back is the read of the reader's hidden message ids,
-- which exists because a message hidden «for me» on another device could not
-- be heard. Approved by the owner on 2026-09-28 with the rest of
-- docs/operations/2026-09-28-database-proposals.md (entry 1), rebuilt as
-- described in the rollout record's «Order».
--
-- Not by publishing `message_hidden_for_users`: Realtime sends a DELETE to
-- every subscriber whose filter matches without asking RLS, so anybody could
-- have subscribed to another account's unhides. Instead each account has a
-- private broadcast topic, `hides:<its id>`:
--
-- * `private.broadcast_hide`, AFTER INSERT OR DELETE on the hides table, sends
--   `{message_id, chat_id, hidden}` to the owner's topic through
--   `realtime.send`, which never raises — a broadcast that fails does not
--   undo the hide.
-- * The policy on `realtime.messages` lets a signed-in account read — and so
--   join — only its own topic. No INSERT policy: a client cannot send on it.
-- * `public.hides_live_ping` sends a ping on the caller's own topic. The client
--   trusts the channel only once its own ping has come back through it, so a
--   channel that says SUBSCRIBED while the database's broadcasts do not reach
--   it can never make a hidden message flash: the client keeps reading.
--
-- Run as supabase_admin: the policy is on a table `supabase_realtime_admin`
-- owns. What `postgres` should own is created under SET LOCAL ROLE postgres.
--
-- Rollback: 20260928220000_hides_heard_live.rollback.sql.
begin;

create policy "hides: each account hears its own" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'hides:' || (select auth.uid())::text
  );

set local role postgres;

create function private.broadcast_hide()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.message_hidden_for_users%rowtype;
  v_chat uuid;
begin
  if tg_op = 'INSERT' then v_row := new; else v_row := old; end if;
  select message.chat_id into v_chat from public.messages as message where message.id = v_row.message_id;
  -- A hide removed because its message was removed has nothing to bring back.
  if v_chat is null then
    return null;
  end if;
  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'message_id', v_row.message_id,
      'chat_id', v_chat,
      'hidden', tg_op = 'INSERT'
    ),
    'hide',
    'hides:' || v_row.user_id::text,
    true
  );
  return null;
end $$;

create trigger trg_message_hidden_for_users_broadcast
  after insert or delete on public.message_hidden_for_users
  for each row
  execute function private.broadcast_hide();

create function public.hides_live_ping()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform realtime.send(pg_catalog.jsonb_build_object('ping', true), 'ping', 'hides:' || v_caller::text, true);
end $$;

revoke all on function private.broadcast_hide() from public, anon, authenticated, service_role;
revoke all on function public.hides_live_ping() from public, anon;
grant execute on function public.hides_live_ping() to authenticated;

reset role;

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
        and policyname = 'hides: each account hears its own' and cmd = 'SELECT') <> 1
     or exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL'))
     or not exists (select 1 from pg_trigger where tgname = 'trg_message_hidden_for_users_broadcast' and tgenabled = 'O')
     or (select pg_get_userbyid(proowner) from pg_proc where oid = 'private.broadcast_hide()'::regprocedure) <> 'postgres'
     or (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.hides_live_ping()'::regprocedure) <> 'postgres'
     or not pg_catalog.has_function_privilege('authenticated', 'public.hides_live_ping()', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.hides_live_ping()', 'EXECUTE')
     or exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_hidden_for_users'
     )
  then
    raise exception 'hides_heard_live_incomplete';
  end if;
end;
$$;

commit;
