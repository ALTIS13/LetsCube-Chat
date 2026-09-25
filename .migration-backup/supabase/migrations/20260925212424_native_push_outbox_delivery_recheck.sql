-- Rollback after restoring the previous send-push-notifications Edge Function:
-- drop function if exists public.native_push_outbox_delivery_recheck(uuid, uuid);
begin;

create or replace function public.native_push_outbox_delivery_recheck(
  p_outbox_id uuid,
  p_claim_token uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz;
  v_claimed_until timestamptz;
  v_read_at timestamptz;
  v_device_active boolean;
begin
  if p_outbox_id is null or p_claim_token is null then
    raise exception 'invalid_native_push_delivery_recheck' using errcode = '22023';
  end if;

  select o.claimed_until, n.read_at,
    (n.user_id = o.user_id and d.user_id = o.user_id
      and d.enabled is true and d.revoked_at is null)
  into v_claimed_until, v_read_at, v_device_active
  from public.notifications_native_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.user_push_devices d on d.id = o.device_id
  where o.id = p_outbox_id
    and o.claim_token = p_claim_token
    and o.sent_at is null
    and o.attempt_count < 5
  for update of o;

  if not found then
    return 'claim_lost';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_read_at is not null then
    update public.notifications_native_push_outbox
    set sent_at = v_now,
        last_error = 'suppressed:read',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'read';
  end if;

  if v_device_active is not true then
    update public.notifications_native_push_outbox
    set sent_at = v_now,
        last_error = 'suppressed:device_inactive',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'device_inactive';
  end if;

  if v_claimed_until is null or v_claimed_until <= v_now then
    return 'claim_lost';
  end if;

  update public.notifications_native_push_outbox
  set claimed_until = v_now + interval '5 minutes'
  where id = p_outbox_id and claim_token = p_claim_token;
  return 'deliver';
end
$$;

revoke all on function public.native_push_outbox_delivery_recheck(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.native_push_outbox_delivery_recheck(uuid, uuid)
  to service_role;

do $$
begin
  if not pg_catalog.has_function_privilege(
      'service_role', 'public.native_push_outbox_delivery_recheck(uuid,uuid)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon', 'public.native_push_outbox_delivery_recheck(uuid,uuid)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.native_push_outbox_delivery_recheck(uuid,uuid)', 'EXECUTE'
    )
    or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = 'public.native_push_outbox_delivery_recheck(uuid,uuid)'::regprocedure
        and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog']
    )
  then
    raise exception 'native_push_delivery_recheck_self_check_failed';
  end if;
end
$$;

commit;
