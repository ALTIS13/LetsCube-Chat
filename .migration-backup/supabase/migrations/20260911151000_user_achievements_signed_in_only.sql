/**
 * The achievements people have earned are read by people who are signed in, and
 * not by anyone without an account (D-107).
 *
 * WHAT EXISTS. `public.user_achievements` — whose achievement each row is —
 * carries the permissive read policy «user achievements readable», `using (true)`
 * for every role, and `anon` holds SELECT, INSERT, UPDATE and DELETE on it; no
 * write policy exists, so it is the read that is open. Read on production on
 * 2026-09-11, read-only: with the public key the application ships and no
 * account, all 58 rows are readable. Two views read the table as their caller
 * (`security_invoker`): `achievement_recipients`, which lists who holds what, and
 * `achievement_stats`, which counts the holders; `anon` holds SELECT on both.
 * The client reads `achievement_stats` only on signed-in screens and never the
 * table or `achievement_recipients` directly, and everything that writes or
 * checks an entitlement — `achievements_sync`, `achievement_grant`,
 * `profiles_validate_cosmetics` — is SECURITY DEFINER.
 *
 * The migration that opened the table (20260903210000) said why: a badge is
 * there to be seen. That still holds inside the product, so a signed-in person
 * keeps reading everyone's badges; only the reader without an account goes.
 *
 * WHAT THIS CHANGES.
 *
 *   - «Signed-in people can view earned achievements» replaces the open read,
 *     for `authenticated` only.
 *   - `anon` loses SELECT, INSERT, UPDATE and DELETE on the table. The two views
 *     read it as their caller, so without an account they now answer with a
 *     permission error; nothing without an account reads them. Their own grants
 *     are left alone: they belong to supabase_admin, and the table is the one
 *     place that decides.
 *
 * Unchanged: the catalogues — `achievements`, `cosmetics`, `product_milestones`
 * — stay readable by anyone, since what exists and what it takes is meant to be
 * public; and every SECURITY DEFINER path.
 *
 * COMPATIBILITY. Nothing the client does without an account reads either, so
 * this may land before the new client or with it.
 *
 * OWNER. Apply as the owner of `public.user_achievements` (postgres on this
 * deployment).
 *
 * Lock: DROP and CREATE POLICY take ACCESS EXCLUSIVE on
 * `public.user_achievements` for the length of this transaction; `lock_timeout`
 * gives up after five seconds.
 *
 * Rollback: 20260911151000_user_achievements_signed_in_only.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

drop policy if exists "user achievements readable" on public.user_achievements;
drop policy if exists "Signed-in people can view earned achievements" on public.user_achievements;
create policy "Signed-in people can view earned achievements"
  on public.user_achievements
  for select
  to authenticated
  using (true);

revoke select, insert, update, delete on public.user_achievements from anon;

comment on policy "Signed-in people can view earned achievements" on public.user_achievements is
  'A badge is there to be seen by the people in the product, not by a reader without an account (D-107).';

do $$
declare
  v_policy record;
  v_privilege text;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.user_achievements'::regclass) then
    raise exception 'public.user_achievements has row-level security off';
  end if;

  -- Every permissive read is for signed-in people only.
  for v_policy in
    select p.policyname, p.roles
      from pg_catalog.pg_policies p
     where p.schemaname = 'public' and p.tablename = 'user_achievements'
       and p.permissive = 'PERMISSIVE' and p.cmd in ('SELECT', 'ALL')
  loop
    if v_policy.roles <> array['authenticated']::name[] then
      raise exception 'public.user_achievements has a read policy for %: %', v_policy.roles, v_policy.policyname;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_policies p
     where p.schemaname = 'public' and p.tablename = 'user_achievements'
       and p.policyname = 'Signed-in people can view earned achievements'
       and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[]
  ) then
    raise exception 'the signed-in read policy on public.user_achievements is missing or changed';
  end if;

  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if pg_catalog.has_table_privilege('anon', 'public.user_achievements', v_privilege) then
      raise exception 'anon still holds % on public.user_achievements', v_privilege;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege('authenticated', 'public.user_achievements', 'SELECT') then
    raise exception 'authenticated lost SELECT on public.user_achievements';
  end if;
end
$$;

commit;
