-- Disposable full-schema retention only; no production identity or migration.
create function fixture_authority.human_target_current(p_user uuid,p_chat uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_chat_type text; v_peer record;
begin
  select c.type into v_chat_type from public.chats c where c.id=p_chat for share nowait;
  if not found then raise exception 'not_chat_member' using errcode='42501'; end if;
  perform p.id from public.profiles p where p.id=p_user for share nowait;
  if not found then raise exception 'not_chat_member' using errcode='42501'; end if;
  if v_chat_type='private' then
    for v_peer in select m.user_id from public.chat_members m where m.chat_id=p_chat
      order by m.user_id for share nowait loop
      perform p.id from public.profiles p where p.id=v_peer.user_id for share nowait;
      if not found then raise exception 'not_chat_member' using errcode='42501'; end if;
    end loop;
  end if;
end $$;

create function fixture_authority.sanction_mutation_guard()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare v_ids uuid[]:='{}'; v_user uuid;
begin
  if tg_op<>'INSERT' then
    if tg_table_name='user_blocks' then v_ids:=v_ids||array[old.blocker_id,old.blocked_id];
    else v_ids:=v_ids||old.user_id; end if;
  end if;
  if tg_op<>'DELETE' then
    if tg_table_name='user_blocks' then v_ids:=v_ids||array[new.blocker_id,new.blocked_id];
    else v_ids:=v_ids||new.user_id; end if;
  end if;
  for v_user in select distinct u from unnest(v_ids) u order by u loop
    perform p.id from public.profiles p where p.id=v_user for no key update nowait;
    if not found and not (tg_op='DELETE' and pg_trigger_depth()>1) then
      raise exception 'sanction_subject_missing' using errcode='42501';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create function fixture_authority.member_topology_guard()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare v_ids uuid[]:='{}'; v_chat uuid;
begin
  if tg_op<>'INSERT' then v_ids:=v_ids||old.chat_id; end if;
  if tg_op<>'DELETE' then v_ids:=v_ids||new.chat_id; end if;
  for v_chat in select distinct c from unnest(v_ids) c order by c loop
    perform c.id from public.chats c where c.id=v_chat for no key update nowait;
    if not found and not (tg_op='DELETE' and pg_trigger_depth()>1) then
      raise exception 'authority_chat_missing' using errcode='42501';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

alter function fixture_authority.human_target_current(uuid,uuid) owner to postgres;
alter function fixture_authority.sanction_mutation_guard() owner to postgres;
alter function fixture_authority.member_topology_guard() owner to postgres;
revoke all on function fixture_authority.human_target_current(uuid,uuid),
  fixture_authority.sanction_mutation_guard(),fixture_authority.member_topology_guard()
  from public,anon,authenticated,service_role;
create trigger fixture_sanction_guard before insert or update or delete on public.bans
  for each row execute function fixture_authority.sanction_mutation_guard();
create trigger fixture_sanction_guard before insert or update or delete on public.mutes
  for each row execute function fixture_authority.sanction_mutation_guard();
create trigger fixture_block_guard before insert or update or delete on public.user_blocks
  for each row execute function fixture_authority.sanction_mutation_guard();
create trigger fixture_member_topology_guard before insert or delete or update of chat_id,user_id on public.chat_members
  for each row execute function fixture_authority.member_topology_guard();
