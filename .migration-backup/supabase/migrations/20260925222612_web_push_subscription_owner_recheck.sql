-- Rollback: after restoring the prior Edge dispatcher, reapply the function
-- body from 20260924095548_web_push_delivery_recheck.sql. Do not drop the RPC
-- while any dispatcher still calls it.
begin;

create or replace function public.push_outbox_delivery_recheck(
  p_outbox_id uuid,
  p_claim_token uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_user_id uuid;
  v_read_at timestamptz;
  v_subscription_active boolean;
  v_subscription_user_id uuid;
begin
  if p_outbox_id is null or p_claim_token is null then
    raise exception 'invalid_web_push_delivery_recheck' using errcode = '22023';
  end if;

  select o.user_id, n.read_at, s.is_active, s.user_id
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id
  from public.notifications_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.push_subscriptions s on s.id = o.subscription_id
  where o.id = p_outbox_id
    and o.claim_token = p_claim_token
    and o.sent_at is null
    and o.suppressed_at is null
  for update of o;

  if not found then
    return 'claim_lost';
  end if;

  if v_read_at is not null then
    update public.notifications_push_outbox
    set suppressed_at = v_now,
        suppression_reason = 'read',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id
      and claim_token = p_claim_token;
    return 'read';
  end if;

  if v_subscription_active is not true
      or v_subscription_user_id is distinct from v_user_id then
    update public.notifications_push_outbox
    set suppressed_at = v_now,
        suppression_reason = 'subscription_inactive',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id
      and claim_token = p_claim_token;
    return 'subscription_inactive';
  end if;

  if exists (
    select 1
    from public.push_foreground_sessions s
    where s.user_id = v_user_id
      and s.expires_at > v_now
  ) then
    update public.notifications_push_outbox
    set claim_token = null,
        claimed_until = null
    where id = p_outbox_id
      and claim_token = p_claim_token;
    return 'foreground';
  end if;

  update public.notifications_push_outbox
  set claimed_until = v_now + interval '60 seconds'
  where id = p_outbox_id
    and claim_token = p_claim_token;
  return 'deliver';
end
$$;

revoke all on function public.push_outbox_delivery_recheck(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.push_outbox_delivery_recheck(uuid, uuid)
  to service_role;

do $$
begin
  if not has_function_privilege(
      'service_role', 'public.push_outbox_delivery_recheck(uuid,uuid)', 'EXECUTE'
    )
    or has_function_privilege(
      'anon', 'public.push_outbox_delivery_recheck(uuid,uuid)', 'EXECUTE'
    )
    or has_function_privilege(
      'authenticated', 'public.push_outbox_delivery_recheck(uuid,uuid)', 'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid = 'public.push_outbox_delivery_recheck(uuid,uuid)'::regprocedure
        and p.prosecdef
        and p.proconfig @> array['search_path=public, pg_temp']
        and pg_get_functiondef(p.oid) like '%v_subscription_user_id is distinct from v_user_id%'
    )
  then
    raise exception 'web_push_subscription_owner_recheck_self_check_failed';
  end if;
end
$$;

commit;
