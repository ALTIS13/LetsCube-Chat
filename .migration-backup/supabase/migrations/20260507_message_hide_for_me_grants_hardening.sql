-- KUB message hide-for-me grants hardening.
--
-- Purpose:
--   The user manually applied 20260507_message_hide_for_me.sql. Read-only MCP
--   verification confirmed the table/RLS/RPC exist, but default PUBLIC/anon
--   grants are still visible on the table/functions. RLS and auth.uid() checks
--   still protect data, but this migration narrows exposed API privileges to
--   authenticated users only.
--
-- Manual apply only:
--   Run this file in Supabase SQL Editor. Do not run it through MCP.
--   It is idempotent and does not delete messages or media.

revoke all privileges on table public.message_hidden_for_users from PUBLIC;
revoke all privileges on table public.message_hidden_for_users from anon;
revoke all privileges on table public.message_hidden_for_users from authenticated;
grant select, insert, delete on table public.message_hidden_for_users to authenticated;

revoke all privileges on function public.hide_message_for_me(uuid) from PUBLIC;
revoke all privileges on function public.hide_message_for_me(uuid) from anon;
grant execute on function public.hide_message_for_me(uuid) to authenticated;

revoke all privileges on function public.unhide_message_for_me(uuid) from PUBLIC;
revoke all privileges on function public.unhide_message_for_me(uuid) from anon;
grant execute on function public.unhide_message_for_me(uuid) to authenticated;

comment on table public.message_hidden_for_users is
  'Per-user local message hide state. Grants hardened on 2026-05-07: authenticated can select/insert/delete own rows via RLS; anon/PUBLIC revoked.';

-- Verify SQL:
--
-- select c.relname, c.relrowsecurity
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname = 'message_hidden_for_users';
--
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'message_hidden_for_users'
-- order by policyname;
--
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'message_hidden_for_users'
-- order by grantee, privilege_type;
--
-- select p.proname, acl.grantee::regrole::text as grantee, acl.privilege_type
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- left join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
-- where n.nspname = 'public'
--   and p.proname in ('hide_message_for_me', 'unhide_message_for_me')
-- order by p.proname, grantee;
--
-- Expected:
--   - RLS enabled.
--   - policies remain authenticated-only.
--   - table grants for anon/PUBLIC are absent.
--   - RPC EXECUTE for anon/PUBLIC is absent; authenticated remains.
