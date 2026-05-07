-- KUB message delivery receipts proposal.
--
-- Purpose:
--   Current production schema can honestly show "sent" and private-chat "read"
--   through chat_members.last_read_at, but it has no delivered receipt state.
--   This migration adds a per-user delivered watermark and scoped RPC helpers.
--
-- Manual apply only:
--   Run this file in Supabase SQL Editor after review. Do not run it through MCP.
--   It is idempotent and does not change messages, reactions, media, or RLS scope.

alter table public.chat_members
  add column if not exists last_delivered_at timestamptz;

create index if not exists chat_members_chat_delivered_idx
  on public.chat_members (chat_id, last_delivered_at);

create or replace function public.mark_chat_delivered(p_chat_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  update public.chat_members
     set last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_now)
   where chat_id = p_chat_id
     and user_id = auth.uid();

  if not found then
    raise exception 'chat_member_required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.mark_chat_read(p_chat_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  update public.chat_members
     set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_now),
         last_delivered_at = greatest(coalesce(last_delivered_at, '-infinity'::timestamptz), v_now)
   where chat_id = p_chat_id
     and user_id = auth.uid();

  if not found then
    raise exception 'chat_member_required' using errcode = '42501';
  end if;
end;
$$;

revoke all privileges on function public.mark_chat_delivered(uuid) from PUBLIC;
revoke all privileges on function public.mark_chat_delivered(uuid) from anon;
grant execute on function public.mark_chat_delivered(uuid) to authenticated;

revoke all privileges on function public.mark_chat_read(uuid) from PUBLIC;
revoke all privileges on function public.mark_chat_read(uuid) from anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

comment on column public.chat_members.last_delivered_at is
  'Per-user watermark for the newest message that this client has received/rendered. Used for honest delivered receipts.';

comment on function public.mark_chat_delivered(uuid) is
  'Marks the current authenticated user as having received/rendered messages in a chat.';

comment on function public.mark_chat_read(uuid) is
  'Marks the current authenticated user as having read a chat and also advances delivered watermark.';

-- Verify SQL:
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'chat_members'
--   and column_name in ('last_read_at', 'last_delivered_at')
-- order by column_name;
--
-- select p.proname, pg_get_function_arguments(p.oid) as args, p.prosecdef as security_definer,
--        acl.grantee::regrole::text as grantee, acl.privilege_type
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- left join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
-- where n.nspname = 'public'
--   and p.proname in ('mark_chat_delivered', 'mark_chat_read')
-- order by p.proname, grantee;
--
-- select pubname, schemaname, tablename
-- from pg_publication_tables
-- where pubname = 'supabase_realtime'
--   and schemaname = 'public'
--   and tablename = 'chat_members';
--
-- Expected:
--   - chat_members.last_delivered_at exists.
--   - both RPC are SECURITY INVOKER.
--   - anon/PUBLIC EXECUTE is absent; authenticated EXECUTE is present.
--   - chat_members remains in supabase_realtime so receipt updates can reach open clients.
--
-- Manual QA after frontend alignment:
--   1. User A sends a private message to User B.
--   2. A sees "sent" until B's client marks delivery/read.
--   3. When B receives/renders the chat, A sees delivered if frontend calls mark_chat_delivered.
--   4. When B opens/reads the chat, A sees read.
--   5. Group chats do not show fake all-read state.
