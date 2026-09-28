-- Rollback of 20260928220000_hides_heard_live.sql. Run as supabase_admin.
-- A client already deployed keeps working: its ping never comes back, so it
-- never trusts the channel and goes on reading the hidden ids as before.
begin;

drop trigger if exists trg_message_hidden_for_users_broadcast on public.message_hidden_for_users;
drop function if exists private.broadcast_hide();
drop function if exists public.hides_live_ping();
drop policy if exists "hides: each account hears its own" on realtime.messages;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_message_hidden_for_users_broadcast')
     or to_regprocedure('public.hides_live_ping()') is not null
     or exists (select 1 from pg_policies where schemaname = 'realtime' and policyname = 'hides: each account hears its own') then
    raise exception 'hides_heard_live_rollback_incomplete';
  end if;
end;
$$;

commit;
