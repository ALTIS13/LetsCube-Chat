/**
 * Repair for 20260904010000_bot_avatar.sql, which stopped every upload.
 *
 * WHAT BROKE. That migration added four `storage.objects` policies whose
 * predicate calls `public._kub_bot_avatar_path_allowed(text)`, and in the same
 * breath revoked EXECUTE on that function from `public` and `anon` without
 * granting it to anyone. A function's EXECUTE is granted to PUBLIC by default
 * and `authenticated` holds it by inheritance, so revoking from PUBLIC took it
 * away from `authenticated` too. The resulting ACL was empty.
 *
 * The policies were also written without a `TO` clause, which means PUBLIC —
 * every role. So every INSERT into `storage.objects` had to evaluate a
 * predicate calling a function nobody was allowed to execute, and a permission
 * error is not something an OR-ed policy set can short-circuit past. Ordinary
 * message media, profile avatars, chat avatars, admin avatar changes and TUS
 * uploads all failed, none of which has anything to do with bots.
 *
 * Production logs over 24 hours: 49 x HTTP 400 on storage.object.upload and
 * 5 x HTTP 403 on storage.tus.upload.create, all reading
 * "permission denied for function _kub_bot_avatar_path_allowed", from
 * 2026-09-04T14:54:14Z to 2026-09-05T13:26:14Z.
 *
 * WHY THE FUNCTION IS REPLACED RATHER THAN LEFT ALONE. The applied definition
 * was reported as carrying a UUID pattern with six groups instead of five,
 * which would keep rejecting every legitimate `bot-avatars/{bot_id}/...` path
 * even after the grant. The checked-in file has the correct five. Rather than
 * branch on which one is live, the definition below is written out in full so
 * the outcome is the same either way.
 *
 * This migration is additive and idempotent: it can be applied twice with no
 * further effect, and it grants nothing beyond the one EXECUTE that the
 * policies already require.
 */

-- ── The predicate ────────────────────────────────────────────────────────────
-- Byte-for-byte the intended definition. Only the regex could differ from what
-- is live, and stating the whole body removes the question.
create or replace function public._kub_bot_avatar_path_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'storage'
as $function$
declare
  v_parts text[] := storage.foldername(p_name);
  v_bot text := v_parts[2];
  -- Five groups: 8-4-4-4-12. A sixth group here rejects every real bot id.
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null then
    return false;
  end if;
  if v_parts[1] is distinct from 'bot-avatars' then
    return false;
  end if;
  if coalesce(v_bot, '') !~* v_uuid_re then
    return false;
  end if;
  return exists (
    select 1
    from public.bot_owners owner
    where owner.bot_id = v_bot::uuid
      and owner.user_id = auth.uid()
      and owner.role = 'owner'
  );
end
$function$;

-- ── The grant that ends the outage ───────────────────────────────────────────
-- Explicit rather than inherited from PUBLIC, so a later revoke from PUBLIC
-- cannot silently take it away again — which is exactly how this happened.
grant execute on function public._kub_bot_avatar_path_allowed(text) to authenticated;
-- Unchanged, and restated so this file describes the whole intended ACL rather
-- than a delta against a state a reader would have to go and look up.
revoke all on function public._kub_bot_avatar_path_allowed(text) from public, anon;

-- ── The policies, now addressed to a role ────────────────────────────────────
-- `TO authenticated` is not what fixes the outage — the grant above is — but
-- without it these apply to every role, so an anonymous request also pays to
-- evaluate a bot-ownership check that can only ever return false for it.
drop policy if exists "media bot avatars owner read" on storage.objects;
create policy "media bot avatars owner read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

drop policy if exists "media bot avatars owner insert" on storage.objects;
create policy "media bot avatars owner insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

drop policy if exists "media bot avatars owner update" on storage.objects;
create policy "media bot avatars owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name))
  with check (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

drop policy if exists "media bot avatars owner delete" on storage.objects;
create policy "media bot avatars owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media' and public._kub_bot_avatar_path_allowed(name));

-- ── Refuse to succeed unless the repair actually took ────────────────────────
-- The failure this fixes was invisible in the migration that caused it: every
-- statement succeeded and the damage was in the resulting permissions. This
-- one checks its own outcome and raises rather than reporting success on a
-- half-applied state.
do $$
declare
  v_missing text;
begin
  if not has_function_privilege('authenticated', 'public._kub_bot_avatar_path_allowed(text)', 'execute') then
    raise exception 'repair failed: authenticated still cannot execute _kub_bot_avatar_path_allowed';
  end if;
  if has_function_privilege('anon', 'public._kub_bot_avatar_path_allowed(text)', 'execute') then
    raise exception 'repair failed: anon must not be able to execute _kub_bot_avatar_path_allowed';
  end if;

  select string_agg(name, ', ')
  into v_missing
  from (values
    ('media bot avatars owner read'),
    ('media bot avatars owner insert'),
    ('media bot avatars owner update'),
    ('media bot avatars owner delete')
  ) as expected(name)
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = expected.name
      and p.roles = '{authenticated}'
  );
  if v_missing is not null then
    raise exception 'repair failed: policies not addressed to authenticated: %', v_missing;
  end if;
end
$$;
