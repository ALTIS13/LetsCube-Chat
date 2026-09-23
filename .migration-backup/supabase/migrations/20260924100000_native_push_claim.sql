-- Rollback after restoring the previous Edge Function and minute cron schedule:
-- drop function if exists public.native_push_outbox_claim(integer, uuid);
-- alter table public.notifications_native_push_outbox
--   drop column if exists claim_token, drop column if exists claimed_until;
begin;

alter table public.notifications_native_push_outbox
  add column if not exists claim_token uuid,
  add column if not exists claimed_until timestamptz;

create or replace function public.native_push_outbox_claim(
  p_limit integer,
  p_claim_token uuid
)
returns table (
  id uuid,
  device_id uuid,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if p_claim_token is null then
    raise exception 'invalid_claim_token' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id
    from public.notifications_native_push_outbox o
    join public.notifications n on n.id = o.notification_id
    where o.sent_at is null
      and o.attempt_count < 5
      and n.read_at is null
      and (o.claimed_until is null or o.claimed_until <= v_now)
    order by o.created_at asc, o.id asc
    for update of o skip locked
    limit v_limit
  ), claimed as (
    update public.notifications_native_push_outbox o
    set claim_token = p_claim_token,
        claimed_until = v_now + interval '5 minutes'
    from candidates c
    where c.id = o.id
    returning o.id, o.device_id, o.payload, o.attempt_count
  )
  select c.id, c.device_id, c.payload, c.attempt_count
  from claimed c;
end
$$;

revoke all on function public.native_push_outbox_claim(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.native_push_outbox_claim(integer, uuid)
  to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'public.native_push_outbox_claim(integer,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.native_push_outbox_claim(integer,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.native_push_outbox_claim(integer,uuid)', 'EXECUTE')
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'notifications_native_push_outbox'
        and column_name = 'claimed_until'
    )
  then
    raise exception 'native_push_claim_self_check_failed';
  end if;
end
$$;

commit;
