-- Disposable fixture candidate only; not a production migration.
create schema fixture_authority authorization postgres;
revoke all on schema fixture_authority from public,anon,authenticated,service_role;

create function fixture_authority.bot_target_current(p_bot uuid,p_chat uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'fixture_authority_requires_read_committed' using errcode='0A000';
  end if;
  -- These try-only row locks add no inverse waiting edge to the existing prefix.
  perform b.id from public.bots b where b.id=p_bot for share nowait;
  if not found then raise exception 'bot_chat_forbidden' using errcode='42501'; end if;
  perform c.id from public.chats c where c.id=p_chat for share nowait;
  if not found then raise exception 'bot_chat_forbidden' using errcode='42501'; end if;
  perform m.bot_id from public.chat_bot_members m
    where m.bot_id=p_bot and m.chat_id=p_chat for share nowait;
  if not found then raise exception 'bot_chat_forbidden' using errcode='42501'; end if;
  if coalesce((public.bot_membership_authorize_internal(p_bot,p_chat,'send_message')->>'allowed')::boolean,false) is not true then
    raise exception 'bot_chat_forbidden' using errcode='42501';
  end if;
end $$;

create function fixture_authority.file_id_current(p_bot uuid,p_chat uuid,p_source uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare
  v_source public.messages%rowtype;
begin
  perform fixture_authority.bot_target_current(p_bot,p_chat);
  select m.* into v_source from public.messages m where m.id=p_source for share nowait;
  if not found then
    raise exception 'bot_file_not_found' using errcode='P0002';
  end if;
  if v_source.reply_to_id is not null then
    perform r.id from public.messages r where r.id=v_source.reply_to_id for share nowait;
  end if;
  -- A new VOLATILE command snapshot follows lock acquisition, never a cached check.
  if not exists(select 1 from public.messages m where m.id=p_source and m.chat_id=p_chat
    and m.deleted_at is null and m.media_bucket is not null and m.media_path is not null
    and private.bot_can_receive_message(p_bot,m.id)) then
    raise exception 'bot_file_not_found' using errcode='P0002';
  end if;
end $$;

create function fixture_authority.file_payload_current(p_bot uuid,p_chat uuid,p_source uuid,p_kind text,p_reply uuid,p_topic uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare
  v_reply public.messages%rowtype;
begin
  if not exists(select 1 from public.messages m where m.id=p_source and coalesce(m.type,'')=p_kind) then
    raise exception 'bot_file_kind_mismatch' using errcode='22023';
  end if;
  if p_reply is not null then
    select r.* into v_reply from public.messages r where r.id=p_reply for share nowait;
    if not found then raise exception 'bot_reply_forbidden' using errcode='42501'; end if;
    if v_reply.reply_to_id is not null then
      perform r.id from public.messages r where r.id=v_reply.reply_to_id for share nowait;
    end if;
    if not exists(select 1 from public.messages r where r.id=p_reply and r.chat_id=p_chat
      and private.bot_can_receive_message(p_bot,r.id)) then
      raise exception 'bot_reply_forbidden' using errcode='42501';
    end if;
  end if;
  if p_topic is not null then
    perform t.id from public.topics t where t.id=p_topic for share nowait;
    if not found then raise exception 'bot_topic_forbidden' using errcode='42501'; end if;
    if not exists(select 1 from public.topics t where t.id=p_topic and t.chat_id=p_chat and not t.archived) then
      raise exception 'bot_topic_forbidden' using errcode='42501';
    end if;
  end if;
end $$;

create function fixture_authority.forward_current(p_user uuid,p_source uuid,p_chat uuid,p_topic uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare
  v_source public.messages%rowtype;
  v_member record;
  v_source_held boolean := false;
  v_target_held boolean := false;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'fixture_authority_requires_read_committed' using errcode='0A000';
  end if;
  select m.* into v_source from public.messages m where m.id=p_source for share nowait;
  if not found then
    raise exception 'message_not_found' using errcode='P0002';
  end if;
  for v_member in select m.chat_id from public.chat_members m where m.user_id=p_user
    and m.chat_id in (v_source.chat_id,p_chat) order by m.chat_id for share nowait loop
    v_source_held := v_source_held or v_member.chat_id=v_source.chat_id;
    v_target_held := v_target_held or v_member.chat_id=p_chat;
  end loop;
  if not v_source_held then raise exception 'message_not_found' using errcode='P0002'; end if;
  if not v_target_held then raise exception 'not_chat_member' using errcode='42501'; end if;
  if p_topic is not null then
    perform t.id from public.topics t where t.id=p_topic for share nowait;
    if not found then raise exception 'invalid_topic' using errcode='22023'; end if;
  end if;
  if public.is_banned(p_user) then
    raise exception 'user_banned' using errcode='42501';
  end if;
  if coalesce(v_source.type,'text')='system' then
    raise exception 'message_not_forwardable' using errcode='22023';
  end if;
  if not exists(select 1 from public.messages m join public.chat_members c on c.chat_id=m.chat_id
    and c.user_id=p_user where m.id=p_source and m.deleted_at is null
    and (c.cleared_at is null or m.created_at>c.cleared_at)
    and not exists(select 1 from public.message_hidden_for_users h where h.message_id=m.id and h.user_id=p_user)) then
    raise exception 'message_not_found' using errcode='P0002';
  end if;
  if not exists(select 1 from public.chat_members m where m.chat_id=p_chat and m.user_id=p_user) then
    raise exception 'not_chat_member' using errcode='42501';
  end if;
  if public.is_muted(p_user,p_chat) then
    raise exception 'user_muted' using errcode='42501';
  end if;
  if p_topic is not null and not exists(select 1 from public.topics t where t.id=p_topic and t.chat_id=p_chat) then
    raise exception 'invalid_topic' using errcode='22023';
  end if;
end $$;

create function fixture_authority.hidden_entry_guard()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare
  v_chat uuid;
begin
  select m.chat_id into v_chat from public.messages m where m.id=new.message_id for share nowait;
  if found then
    -- Protect the absent hidden entry through the reader's retained member row.
    -- Another actor's hide uses a different member row and is not blocked.
    perform m.chat_id from public.chat_members m where m.chat_id=v_chat and m.user_id=new.user_id
      for update nowait;
    if not found then raise exception 'not_chat_member' using errcode='42501'; end if;
  end if;
  return new;
end $$;

alter function fixture_authority.file_id_current(uuid,uuid,uuid) owner to postgres;
alter function fixture_authority.bot_target_current(uuid,uuid) owner to postgres;
alter function fixture_authority.file_payload_current(uuid,uuid,uuid,text,uuid,uuid) owner to postgres;
alter function fixture_authority.forward_current(uuid,uuid,uuid,uuid) owner to postgres;
alter function fixture_authority.hidden_entry_guard() owner to postgres;
revoke all on function fixture_authority.file_id_current(uuid,uuid,uuid),
  fixture_authority.bot_target_current(uuid,uuid),fixture_authority.file_payload_current(uuid,uuid,uuid,text,uuid,uuid),
  fixture_authority.forward_current(uuid,uuid,uuid,uuid),fixture_authority.hidden_entry_guard()
  from public,anon,authenticated,service_role;
