-- LETSCUBE admin / ops security report.
--
-- Proposal only. Do not apply automatically from Codex.
--
-- Goal:
-- - Give owner/tech_admin/admin operators an aggregate view of auth,
--   registration invite, and invite audit activity from the admin panel.
-- - Do not expose emails, phone numbers, passwords, recovery tokens,
--   CAPTCHA tokens, raw IP addresses, push tokens, actor IDs, or target IDs.
-- - Keep in-app UI read-only; this RPC only returns JSON aggregates.
--
-- Manual apply target: Supabase SQL editor or psql against the LETSCUBE DB.

begin;

create or replace function public.admin_ops_security_report()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  v_invite_only boolean := null;
  v_auth jsonb := '{}'::jsonb;
  v_profiles jsonb := '{}'::jsonb;
  v_invites jsonb := jsonb_build_object(
    'invite_only_enabled', null,
    'active', 0,
    'revoked', 0,
    'expired', 0,
    'exhausted', 0,
    'created_24h', 0,
    'created_7d', 0,
    'uses_24h', 0,
    'uses_7d', 0
  );
  v_audit jsonb := jsonb_build_object(
    'invite_events_24h', 0,
    'invite_events_7d', 0,
    'recent_events', '[]'::jsonb
  );
  v_controls jsonb;
  v_invite_mode_available boolean := to_regprocedure('public.registration_invites_required()') is not null;
  v_invites_available boolean := to_regclass('public.registration_invites') is not null;
  v_invite_uses_available boolean := to_regclass('public.registration_invite_uses') is not null;
  v_audit_available boolean := to_regclass('public.audit_logs') is not null;
begin
  if v_actor is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if not (
    public.has_permission(v_actor, 'system.manage')
    or public.has_permission(v_actor, 'audit.view')
    or public.has_global_role(v_actor, 'owner')
    or public.has_global_role(v_actor, 'tech_admin')
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_users', count(*)::integer,
    'confirmed_users', count(*) filter (
      where coalesce(email_confirmed_at, phone_confirmed_at, confirmed_at) is not null
    )::integer,
    'unconfirmed_users', count(*) filter (
      where coalesce(email_confirmed_at, phone_confirmed_at, confirmed_at) is null
    )::integer,
    'created_24h', count(*) filter (where created_at >= v_now - interval '24 hours')::integer,
    'created_7d', count(*) filter (where created_at >= v_now - interval '7 days')::integer,
    'last_sign_in_24h', count(*) filter (where last_sign_in_at >= v_now - interval '24 hours')::integer
  )
    into v_auth
    from auth.users;

  select jsonb_build_object(
    'total_profiles', count(*)::integer,
    'created_24h', count(*) filter (where created_at >= v_now - interval '24 hours')::integer,
    'created_7d', count(*) filter (where created_at >= v_now - interval '7 days')::integer
  )
    into v_profiles
    from public.profiles;

  if v_invite_mode_available then
    execute 'select public.registration_invites_required()' into v_invite_only;
    v_invites := jsonb_set(v_invites, '{invite_only_enabled}', coalesce(to_jsonb(v_invite_only), 'null'::jsonb), true);
  end if;

  if v_invites_available then
    execute $q$
      select jsonb_build_object(
        'active', count(*) filter (
          where revoked_at is null
            and (expires_at is null or expires_at > now())
            and uses_count < max_uses
        )::integer,
        'revoked', count(*) filter (where revoked_at is not null)::integer,
        'expired', count(*) filter (
          where revoked_at is null
            and expires_at is not null
            and expires_at <= now()
        )::integer,
        'exhausted', count(*) filter (
          where revoked_at is null
            and uses_count >= max_uses
        )::integer,
        'created_24h', count(*) filter (where created_at >= now() - interval '24 hours')::integer,
        'created_7d', count(*) filter (where created_at >= now() - interval '7 days')::integer
      )
        from public.registration_invites
    $q$ into v_controls;

    v_invites := v_invites || v_controls;
    v_invites := jsonb_set(v_invites, '{invite_only_enabled}', coalesce(to_jsonb(v_invite_only), 'null'::jsonb), true);
  end if;

  if v_invite_uses_available then
    execute $q$
      select jsonb_build_object(
        'uses_24h', count(*) filter (where used_at >= now() - interval '24 hours')::integer,
        'uses_7d', count(*) filter (where used_at >= now() - interval '7 days')::integer
      )
        from public.registration_invite_uses
    $q$ into v_controls;

    v_invites := v_invites || v_controls;
  end if;

  if v_audit_available then
    execute $q$
      with recent as (
        select action, target_kind, created_at
          from public.audit_logs
         where action in (
           'registration_invite_created',
           'registration_invite_revoked',
           'registration_invite_consumed',
           'registration_invite_mode_updated'
         )
         order by created_at desc
         limit 12
      )
      select jsonb_build_object(
        'invite_events_24h',
          (select count(*)::integer
             from public.audit_logs
            where action in (
              'registration_invite_created',
              'registration_invite_revoked',
              'registration_invite_consumed',
              'registration_invite_mode_updated'
            )
              and created_at >= now() - interval '24 hours'),
        'invite_events_7d',
          (select count(*)::integer
             from public.audit_logs
            where action in (
              'registration_invite_created',
              'registration_invite_revoked',
              'registration_invite_consumed',
              'registration_invite_mode_updated'
            )
              and created_at >= now() - interval '7 days'),
        'recent_events',
          coalesce(
            (select jsonb_agg(
               jsonb_build_object(
                 'action', action,
                 'target_kind', target_kind,
                 'created_at', created_at
               )
               order by created_at desc
             ) from recent),
            '[]'::jsonb
          )
      )
    $q$ into v_audit;
  end if;

  v_controls := jsonb_build_object(
    'invite_mode_available', v_invite_mode_available,
    'invite_table_available', v_invites_available,
    'invite_uses_table_available', v_invite_uses_available,
    'audit_log_available', v_audit_available
  );

  return jsonb_build_object(
    'generated_at', v_now,
    'auth', v_auth,
    'profiles', v_profiles,
    'invites', v_invites,
    'audit', v_audit,
    'controls', v_controls
  );
end;
$$;

revoke all on function public.admin_ops_security_report() from public, anon, authenticated;
grant execute on function public.admin_ops_security_report() to authenticated;

commit;

-- Manual verification after apply:
-- 1. As owner/tech_admin/admin with system.manage or audit.view:
--      select public.admin_ops_security_report();
-- 2. Confirm the JSON contains only aggregate counts and sanitized action labels.
-- 3. Confirm anon cannot execute the RPC.
-- 4. Confirm a normal authenticated non-staff user receives 42501 / permission denied.
-- 5. Open /admin/ops and confirm the SQL warning disappears.
