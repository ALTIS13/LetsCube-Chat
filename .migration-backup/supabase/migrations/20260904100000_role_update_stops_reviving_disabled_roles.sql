-- Changing a role's colour must not switch it back on.
--
-- Found by probing production after `20260904080000` added `priority` and
-- `colour` to `role_update`. The bug is older than that change — it was carried
-- across verbatim — but the new parameters are what made it reachable, because
-- they give a caller a reason to touch a role without meaning anything by
-- `p_is_active`.
--
-- Measured, in a rolled-back transaction, as an authenticated administrator:
--
--   before: chat_owner is_active = false
--   select role_update(<chat_owner>, 'Владелец чата', null, null, null, '#123456');
--   after:  chat_owner is_active = true
--
-- A colour change revived a role that had been deliberately retired eight hours
-- earlier by `20260904060000`. The cause:
--
--   is_active = case when is_system then true else coalesce(p_is_active, true) end
--
-- For a system role that is unconditionally `true` — the branch never looks at
-- what the caller asked for — and the three retired chat roles are all
-- `is_system`. For a non-system role, a null `p_is_active` also means `true`,
-- so "I did not mention it" and "switch it on" were the same request.
--
-- The intent behind that line was to stop a system role being switched OFF, and
-- that is already enforced above it by the `system_role_protected` guard, which
-- raises before the update runs. So the case expression was not protecting
-- anything; it was only overwriting.
--
-- Now: null means leave it as it is, which matches how `p_priority` and
-- `p_colour` already behave, and an explicit value is honoured. Switching a
-- system role off is still refused by the guard — verified, it raises
-- `system_role_protected` — so nothing that was protected has been opened.
--
-- The panel was already sending each row's own `is_active` on a reorder to
-- work around this. That defence stays, but it belongs here: a client should
-- not have to know that omitting a field means overwriting it.

create or replace function public.role_update(
  p_role_id uuid,
  p_name text,
  p_description text default null::text,
  p_is_active boolean default true,
  p_priority integer default null::integer,
  p_colour text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.roles%rowtype;
begin
  perform public._require_permission('roles.manage');
  select * into v_role from public.roles where id = p_role_id for update;
  if not found then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;
  if v_role.is_system and p_is_active = false then
    raise exception 'system_role_protected' using errcode = '42501';
  end if;
  if v_role.key in ('owner', 'tech_admin')
     and p_is_active = false
     and public._critical_role_count(v_role.key) <= 1 then
    raise exception 'last_%', v_role.key using errcode = '42501';
  end if;
  if p_colour is not null and p_colour !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'colour_must_be_hex' using errcode = '22023';
  end if;

  update public.roles
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         -- Null means "not mentioned", not "switch on". The guard above is what
         -- keeps a system role from being switched off.
         is_active = coalesce(p_is_active, is_active),
         priority = coalesce(p_priority, priority),
         colour = coalesce(p_colour, colour)
   where id = p_role_id;

  insert into public.audit_logs (actor_id, action, target_kind, target_id, diff)
  values (auth.uid(), 'role_updated', 'role', p_role_id,
          jsonb_build_object('name', p_name, 'is_active', p_is_active,
                             'priority', p_priority, 'colour', p_colour));
end $function$;

revoke all on function public.role_update(uuid, text, text, boolean, integer, text) from public, anon;
grant execute on function public.role_update(uuid, text, text, boolean, integer, text) to authenticated;
