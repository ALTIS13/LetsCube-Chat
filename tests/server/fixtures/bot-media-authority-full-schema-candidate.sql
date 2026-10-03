-- Full-schema extension of the disposable authority candidate, never runtime SQL.
create function fixture_authority.forward_insert_guard()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
  if new.forwarded_from_id is not null and new.bot_id is null and auth.uid() is not null then
    perform fixture_authority.forward_current(auth.uid(),new.forwarded_from_id,new.chat_id,new.topic_id);
  end if;
  return new;
end $$;
alter function fixture_authority.forward_insert_guard() owner to postgres;
revoke all on function fixture_authority.forward_insert_guard() from public,anon,authenticated,service_role;
create trigger fixture_forward_insert_guard before insert on public.messages
  for each row execute function fixture_authority.forward_insert_guard();
