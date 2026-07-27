-- LETSCUBE support operator delivery hardening.
-- Additive and idempotent: no support or notification records are removed.

set search_path = public;

-- Transfer targets must be eligible support operators, not arbitrary profiles.
create or replace function public.support_operator_directory()
returns table (
  id uuid,
  full_name text,
  username text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or not (
       public.has_permission(v_actor, 'support.transfer')
       or public.has_permission(v_actor, 'support.manage')
     ) then
    raise exception 'support_permission_denied';
  end if;

  return query
  select
    profile.id,
    profile.full_name,
    profile.username
  from public.profiles profile
  where public.has_permission(profile.id, 'support.view')
    and public.has_permission(profile.id, 'support.reply')
  order by profile.full_name nulls last, profile.username nulls last, profile.id
  limit 200;
end
$function$;

revoke all on function public.support_operator_directory()
  from public, anon, authenticated;
grant execute on function public.support_operator_directory()
  to authenticated;

comment on function public.support_operator_directory() is
  'Returns bounded transfer targets that have support.view and support.reply; caller needs support.transfer or support.manage.';

-- Keep all public support intake limits editable through one validated,
-- permission-scoped operation.
create or replace function public.support_settings_update_v2(
  p_intake_enabled boolean,
  p_guest_intake_enabled boolean,
  p_closed_message text,
  p_ticket_limit_15m integer,
  p_ticket_limit_day integer,
  p_message_limit_5m integer,
  p_message_limit_day integer
)
returns public.support_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_result public.support_settings%rowtype;
  v_closed_message text := btrim(coalesce(p_closed_message, ''));
begin
  v_actor := public._support_require_permission('support.settings');

  if length(v_closed_message) not between 3 and 500
     or p_ticket_limit_15m not between 1 and 50
     or p_ticket_limit_day not between 1 and 500
     or p_ticket_limit_day < p_ticket_limit_15m
     or p_message_limit_5m not between 1 and 200
     or p_message_limit_day not between 1 and 5000
     or p_message_limit_day < p_message_limit_5m then
    raise exception 'invalid_support_settings';
  end if;

  insert into public.support_settings (
    id,
    intake_enabled,
    guest_intake_enabled,
    closed_message,
    ticket_limit_15m,
    ticket_limit_day,
    message_limit_5m,
    message_limit_day,
    updated_by,
    updated_at
  )
  values (
    true,
    coalesce(p_intake_enabled, false),
    coalesce(p_guest_intake_enabled, false),
    v_closed_message,
    p_ticket_limit_15m,
    p_ticket_limit_day,
    p_message_limit_5m,
    p_message_limit_day,
    v_actor,
    clock_timestamp()
  )
  on conflict (id) do update
  set intake_enabled = excluded.intake_enabled,
      guest_intake_enabled = excluded.guest_intake_enabled,
      closed_message = excluded.closed_message,
      ticket_limit_15m = excluded.ticket_limit_15m,
      ticket_limit_day = excluded.ticket_limit_day,
      message_limit_5m = excluded.message_limit_5m,
      message_limit_day = excluded.message_limit_day,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into v_result;

  perform public._audit(
    'support_settings_updated',
    'support_settings',
    null,
    jsonb_build_object(
      'intake_enabled', v_result.intake_enabled,
      'guest_intake_enabled', v_result.guest_intake_enabled,
      'ticket_limit_15m', v_result.ticket_limit_15m,
      'ticket_limit_day', v_result.ticket_limit_day,
      'message_limit_5m', v_result.message_limit_5m,
      'message_limit_day', v_result.message_limit_day
    )
  );

  return v_result;
end
$function$;

revoke all on function public.support_settings_update_v2(
  boolean,
  boolean,
  text,
  integer,
  integer,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.support_settings_update_v2(
  boolean,
  boolean,
  text,
  integer,
  integer,
  integer,
  integer
) to authenticated;

comment on function public.support_settings_update_v2(
  boolean,
  boolean,
  text,
  integer,
  integer,
  integer,
  integer
) is
  'Updates support intake and ticket/message limits for callers with support.settings.';

-- Respect the recipient's transfer preference before creating an in-app
-- transfer notification. Other support events retain their existing behavior.
create or replace function public._support_notify(
  p_user_id uuid,
  p_ticket_id uuid,
  p_support_event text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_user_id is null or p_ticket_id is null then
    return;
  end if;

  if p_support_event = 'transferred'
     and not coalesce((
       select preference.notify_transfers
       from public.support_operator_preferences preference
       where preference.operator_user_id = p_user_id
     ), true) then
    return;
  end if;

  perform public._notify(
    p_user_id,
    'support_' || p_support_event,
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'route', '/admin/support?ticket=' || p_ticket_id::text,
      'support_event', p_support_event
    )
  );
end
$function$;

revoke all on function public._support_notify(uuid, uuid, text)
  from public, anon, authenticated;

-- push_enabled controls only OS delivery. The in-app notification remains the
-- source of truth and is still created and synchronized across clients.
create or replace function public.support_push_outbox_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    select 1
    from public.notifications notification
    join public.support_operator_preferences preference
      on preference.operator_user_id = new.user_id
    where notification.id = new.notification_id
      and notification.user_id = new.user_id
      and left(notification.kind, 8) = 'support_'
      and preference.push_enabled is false
  ) then
    return null;
  end if;

  return new;
end
$function$;

revoke all on function public.support_push_outbox_guard()
  from public, anon, authenticated;

do $block$
begin
  if to_regclass('public.notifications_push_outbox') is not null then
    execute 'drop trigger if exists trg_support_push_outbox_guard on public.notifications_push_outbox';
    execute 'create trigger trg_support_push_outbox_guard
      before insert on public.notifications_push_outbox
      for each row execute function public.support_push_outbox_guard()';
  end if;

  if to_regclass('public.notifications_native_push_outbox') is not null then
    execute 'drop trigger if exists trg_support_native_push_outbox_guard on public.notifications_native_push_outbox';
    execute 'create trigger trg_support_native_push_outbox_guard
      before insert on public.notifications_native_push_outbox
      for each row execute function public.support_push_outbox_guard()';
  end if;
end
$block$;

comment on function public.support_push_outbox_guard() is
  'Suppresses web/native support push outbox rows when the recipient disabled support OS push; in-app notifications are preserved.';
