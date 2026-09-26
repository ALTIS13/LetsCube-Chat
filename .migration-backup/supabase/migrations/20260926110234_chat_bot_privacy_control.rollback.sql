-- Emergency rollback: revoke the new capability, then close all full modes.
-- Deliberately keep the expanded audit constraint and its historical events.
revoke all on function public.chat_bot_set_privacy(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
drop function public.chat_bot_set_privacy(uuid, uuid, boolean);

with restricted as (
  update public.chat_bot_members
  set privacy_mode = 'restricted',
      joined_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where privacy_mode = 'full' and removed_at is null
  returning bot_id, chat_id
)
insert into private.bot_audit_events(bot_id, action, metadata)
select bot_id, 'bot_privacy_changed',
  pg_catalog.jsonb_build_object('chat_id', chat_id, 'from', 'full', 'to', 'restricted', 'reason', 'rollback')
from restricted;

do $$
begin
  if exists (select 1 from public.chat_bot_members where privacy_mode = 'full' and removed_at is null) then
    raise exception 'chat_bot_privacy_rollback_incomplete';
  end if;
end;
$$;
