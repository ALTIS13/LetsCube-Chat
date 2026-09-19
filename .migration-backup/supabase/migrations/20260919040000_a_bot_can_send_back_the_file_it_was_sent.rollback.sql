/**
 * Rollback for 20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql.
 *
 * Restores `public.bot_message_command_internal` and
 * `public.bot_send_message_internal` to the bodies of
 * `20260831100000_bot_platform_foundation.sql`, byte for byte — the state the
 * live database was measured to be in immediately before the migration, with
 * the live definitions compared against that file first and found identical.
 *
 * Both signatures are unchanged, so this is two `create or replace` and the
 * grants are re-asserted to the same values. The migration persisted no state
 * of its own — no table, no column, no row, no grant row — so nothing else has
 * to be undone. Any message already sent by `file_id` keeps working: it is an
 * ordinary media message whose `media_bucket`/`media_path` point at an object
 * that another message in the same chat already points at.
 *
 * The self-check refuses to commit unless both bodies really are back to the
 * old shape and `service_role` still holds EXECUTE on both.
 */

begin;

create or replace function public.bot_message_command_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_method text,
  p_payload jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing jsonb;
  v_result jsonb;
  v_send_result jsonb;
  v_target public.messages%rowtype;
  v_message_id uuid;
  v_topic_id uuid;
  v_text text;
  v_reply_markup jsonb;
  v_expected_media_kind text;
begin
  if p_bot_id is null or p_chat_id is null or p_method is null
     or p_method not in (
       'sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice',
       'sendChatAction','editMessageText','deleteMessage'
     )
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_message_command_input_invalid' using errcode = '22023';
  end if;

  if p_method = 'sendMessage' then
    if not (p_payload ? 'text')
       or pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
       or pg_catalog.length(p_payload->>'text') not between 1 and 4096
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in ('text','topic_id','reply_to_id','reply_markup')
       ) then
      raise exception 'bot_send_text_input_invalid' using errcode = '22023';
    end if;
  elsif p_method in ('sendPhoto','sendVideo','sendDocument','sendVoice') then
    v_expected_media_kind := case p_method
      when 'sendPhoto' then 'image'
      when 'sendVideo' then 'video'
      when 'sendDocument' then 'file'
      when 'sendVoice' then 'audio'
    end;
    if not (p_payload ? 'media_bucket')
       or not (p_payload ? 'media_path')
       or not (p_payload ? 'media_metadata')
       or pg_catalog.jsonb_typeof(p_payload->'media_bucket') <> 'string'
       or p_payload->>'media_bucket' <> 'chat-media'
       or pg_catalog.jsonb_typeof(p_payload->'media_path') <> 'string'
       or pg_catalog.octet_length(p_payload->>'media_path') not between 1 and 1024
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata') <> 'object'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in (
           'text','media_bucket','media_path','media_metadata',
           'topic_id','reply_to_id','reply_markup'
         )
       )
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload->'media_metadata') metadata_key
         where metadata_key not in ('mime_type','size','kind')
       )
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type') <> 'string'
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'size') <> 'number'
       or (p_payload->'media_metadata'->>'size') !~ '^[0-9]{1,9}$'
       or (p_payload->'media_metadata'->>'size')::bigint not between 1 and 104857600
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'kind') <> 'string'
       or p_payload->'media_metadata'->>'kind' <> v_expected_media_kind
       or (p_payload ? 'text' and (
         pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
         or pg_catalog.length(p_payload->>'text') not between 1 and 4096
       ))
       or (p_method = 'sendPhoto' and p_payload->'media_metadata'->>'mime_type' not in (
         'image/jpeg','image/png','image/webp','image/gif'
       ))
       or (p_method = 'sendVideo' and p_payload->'media_metadata'->>'mime_type' not in (
         'video/mp4','video/webm'
       ))
       or (p_method = 'sendDocument' and p_payload->'media_metadata'->>'mime_type' not in (
         'application/pdf'
       ))
       or (p_method = 'sendVoice' and p_payload->'media_metadata'->>'mime_type' not in (
         'audio/webm','audio/ogg','audio/mpeg'
       )) then
      raise exception 'bot_send_media_input_invalid' using errcode = '22023';
    end if;
  end if;

  if p_method = 'sendChatAction' then
    if not (p_payload ? 'action')
       or pg_catalog.jsonb_typeof(p_payload->'action') <> 'string'
       or p_payload->>'action' not in (
         'typing','upload_photo','upload_video','upload_document','record_voice'
       )
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in ('action','topic_id')
       ) then
      raise exception 'bot_chat_action_input_invalid' using errcode = '22023';
    end if;
    if nullif(p_payload->>'topic_id', '') is not null then
      if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'bot_topic_invalid' using errcode = '22023';
      end if;
      v_topic_id := (p_payload->>'topic_id')::uuid;
    end if;
  elsif p_method = 'editMessageText' then
    if not (p_payload ? 'message_id')
       or not (p_payload ? 'text')
       or pg_catalog.jsonb_typeof(p_payload->'message_id') <> 'string'
       or pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
       or (p_payload->>'message_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.length(p_payload->>'text') not between 1 and 4096
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in ('message_id','text','reply_markup')
       ) then
      raise exception 'bot_edit_input_invalid' using errcode = '22023';
    end if;
    v_message_id := (p_payload->>'message_id')::uuid;
    v_text := p_payload->>'text';
    v_reply_markup := case
      when not (p_payload ? 'reply_markup')
        or p_payload->'reply_markup' = 'null'::jsonb then null
      else p_payload->'reply_markup'
    end;
    if not private.bot_inline_keyboard_valid(v_reply_markup) then
      raise exception 'bot_reply_markup_invalid' using errcode = '22023';
    end if;
  elsif p_method = 'deleteMessage' then
    if not (p_payload ? 'message_id')
       or pg_catalog.jsonb_typeof(p_payload->'message_id') <> 'string'
       or (p_payload->>'message_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 1 then
      raise exception 'bot_delete_input_invalid' using errcode = '22023';
    end if;
    v_message_id := (p_payload->>'message_id')::uuid;
  end if;

  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'send_message'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)
  );
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,
    p_idempotency_key,
    p_method,
    p_request_fingerprint
  );
  if coalesce((v_existing->>'found')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'result', v_existing->'result',
      'duplicate', true
    );
  end if;

  if p_method in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice') then
    v_send_result := public.bot_send_message_internal(
      p_bot_id,
      p_chat_id,
      p_method,
      p_payload,
      p_idempotency_key
    );
    v_result := v_send_result - 'duplicate';
    perform private.bot_operation_idempotency_store(
      p_bot_id,
      p_idempotency_key,
      p_method,
      p_request_fingerprint,
      v_result
    );
    return pg_catalog.jsonb_build_object(
      'result', v_result,
      'duplicate', coalesce((v_send_result->>'duplicate')::boolean, false)
    );
  end if;

  if p_method = 'sendChatAction' then
    if v_topic_id is not null and not exists (
      select 1 from public.topics topic
      where topic.id = v_topic_id
        and topic.chat_id = p_chat_id
        and topic.archived is false
    ) then
      raise exception 'bot_topic_forbidden' using errcode = '42501';
    end if;
    v_result := pg_catalog.to_jsonb(true);
  else
    select message_row.*
    into v_target
    from public.messages message_row
    where message_row.id = v_message_id
      and message_row.chat_id = p_chat_id
      and message_row.bot_id = p_bot_id
      and message_row.deleted_at is null
    for update of message_row;
    if not found then
      raise exception 'bot_message_not_found' using errcode = 'P0002';
    end if;

    if p_method = 'editMessageText' then
      update public.messages message_row
      set content = v_text,
          bot_reply_markup = v_reply_markup,
          edited_at = pg_catalog.now()
      where message_row.id = v_target.id;
      v_result := pg_catalog.jsonb_build_object(
        'message_id', v_target.id,
        'chat_id', v_target.chat_id,
        'text', v_text,
        'reply_markup', v_reply_markup,
        'edited_at', pg_catalog.now()
      );
    else
      update public.messages message_row
      set deleted_at = pg_catalog.now()
      where message_row.id = v_target.id;
      v_result := pg_catalog.jsonb_build_object(
        'message_id', v_target.id,
        'chat_id', v_target.chat_id,
        'deleted', true
      );
    end if;
  end if;

  perform private.bot_operation_idempotency_store(
    p_bot_id,
    p_idempotency_key,
    p_method,
    p_request_fingerprint,
    v_result
  );
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
end
$function$;

create or replace function public.bot_send_message_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_method text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing_message_id uuid;
  v_message_id uuid;
  v_message_type text;
  v_content text;
  v_media_bucket text;
  v_media_path text;
  v_media_metadata jsonb;
  v_topic_id uuid;
  v_reply_to_id uuid;
  v_reply_markup jsonb;
  v_upload_grant_id uuid;
begin
  if p_bot_id is null or p_chat_id is null
     or p_method is null
     or p_idempotency_key is null
     or p_method not in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice')
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(p_payload) payload_key
       where payload_key not in (
         'text','media_bucket','media_path','media_metadata','topic_id','reply_to_id',
         'reply_markup'
       )
     ) then
    raise exception 'bot_message_input_invalid' using errcode = '22023';
  end if;

  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'send_message'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)
  );

  select idem.message_id
  into v_existing_message_id
  from private.bot_message_idempotency idem
  where idem.bot_id = p_bot_id
    and idem.idempotency_key = p_idempotency_key
    and idem.method = p_method;

  if found then
    return (
      select pg_catalog.jsonb_build_object(
        'message_id', message_row.id,
        'chat_id', message_row.chat_id,
        'bot_id', message_row.bot_id,
        'type', message_row.type,
        'created_at', message_row.created_at,
        'duplicate', true
      )
      from public.messages message_row
      where message_row.id = v_existing_message_id
    );
  end if;

  if exists (
    select 1
    from private.bot_message_idempotency idem
    where idem.bot_id = p_bot_id
      and idem.idempotency_key = p_idempotency_key
  ) then
    raise exception 'bot_idempotency_conflict' using errcode = '23505';
  end if;

  v_message_type := case p_method
    when 'sendMessage' then 'text'
    when 'sendPhoto' then 'image'
    when 'sendVideo' then 'video'
    when 'sendDocument' then 'file'
    when 'sendVoice' then 'audio'
  end;
  v_content := nullif(p_payload->>'text', '');
  v_media_bucket := nullif(p_payload->>'media_bucket', '');
  v_media_path := nullif(p_payload->>'media_path', '');
  v_media_metadata := case
    when pg_catalog.jsonb_typeof(p_payload->'media_metadata') = 'object'
      then p_payload->'media_metadata'
    else '{}'::jsonb
  end;
  v_reply_markup := case
    when p_payload ? 'reply_markup' then p_payload->'reply_markup'
    else null
  end;

  if v_content is not null and pg_catalog.length(v_content) > 4096 then
    raise exception 'bot_message_too_long' using errcode = '22023';
  end if;
  if v_message_type = 'text' and v_content is null then
    raise exception 'bot_message_text_required' using errcode = '22023';
  end if;
  if v_message_type <> 'text' and (
    v_media_bucket is null
    or v_media_path is null
    or pg_catalog.octet_length(v_media_bucket) > 128
    or pg_catalog.octet_length(v_media_path) > 1024
  ) then
    raise exception 'bot_message_media_required' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(v_media_metadata::text) > 4096
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(v_media_metadata) metadata_key
       where metadata_key not in (
         'mime_type','file_name','size','width','height','duration','kind'
       )
     ) then
    raise exception 'bot_message_media_metadata_invalid' using errcode = '22023';
  end if;
  if not private.bot_inline_keyboard_valid(v_reply_markup) then
    raise exception 'bot_reply_markup_invalid' using errcode = '22023';
  end if;

  if nullif(p_payload->>'topic_id', '') is not null then
    if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_topic_invalid' using errcode = '22023';
    end if;
    v_topic_id := (p_payload->>'topic_id')::uuid;
    if not exists (
      select 1
      from public.topics topic
      where topic.id = v_topic_id
        and topic.chat_id = p_chat_id
        and topic.archived is false
    ) then
      raise exception 'bot_topic_forbidden' using errcode = '42501';
    end if;
  end if;
  if nullif(p_payload->>'reply_to_id', '') is not null then
    if (p_payload->>'reply_to_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_reply_invalid' using errcode = '22023';
    end if;
    v_reply_to_id := (p_payload->>'reply_to_id')::uuid;
    if not exists (
      select 1
      from public.messages replied_message
      where replied_message.id = v_reply_to_id
        and replied_message.chat_id = p_chat_id
        and private.bot_can_receive_message(
          p_bot_id,
          replied_message.id
        )
    ) then
      raise exception 'bot_reply_forbidden' using errcode = '42501';
    end if;
  end if;

  if v_message_type <> 'text' then
    select upload_grant.id
    into v_upload_grant_id
    from private.bot_upload_grants upload_grant
    where upload_grant.bot_id = p_bot_id
      and upload_grant.chat_id = p_chat_id
      and upload_grant.bucket_id = v_media_bucket
      and upload_grant.object_path = v_media_path
      and upload_grant.expires_at > pg_catalog.now()
      and upload_grant.consumed_at is null
      and (
        nullif(v_media_metadata->>'mime_type', '') is null
        or upload_grant.content_type = v_media_metadata->>'mime_type'
      )
      and (
        nullif(v_media_metadata->>'size', '') is null
        or upload_grant.byte_size::text = v_media_metadata->>'size'
      )
      and exists (
        select 1
        from storage.objects stored_object
        where stored_object.bucket_id = upload_grant.bucket_id
          and stored_object.name = upload_grant.object_path
      )
    order by upload_grant.created_at desc
    limit 1
    for update of upload_grant;
    if not found then
      raise exception 'bot_media_grant_required' using errcode = '42501';
    end if;
  end if;

  insert into public.messages(
    chat_id,
    topic_id,
    user_id,
    bot_id,
    content,
    type,
    media_bucket,
    media_path,
    media_metadata,
    reply_to_id,
    bot_reply_markup
  ) values (
    p_chat_id,
    v_topic_id,
    null,
    p_bot_id,
    v_content,
    v_message_type,
    v_media_bucket,
    v_media_path,
    v_media_metadata,
    v_reply_to_id,
    v_reply_markup
  )
  returning id into v_message_id;

  insert into private.bot_message_idempotency(
    bot_id,
    idempotency_key,
    method,
    message_id
  ) values (
    p_bot_id,
    p_idempotency_key,
    p_method,
    v_message_id
  );

  if v_upload_grant_id is not null then
    update private.bot_upload_grants upload_grant
    set consumed_at = pg_catalog.now(),
        consumed_message_id = v_message_id
    where upload_grant.id = v_upload_grant_id
      and upload_grant.consumed_at is null;
    if not found then
      raise exception 'bot_media_grant_required' using errcode = '42501';
    end if;
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'message_id', message_row.id,
      'chat_id', message_row.chat_id,
      'bot_id', message_row.bot_id,
      'type', message_row.type,
      'created_at', message_row.created_at,
      'duplicate', false
    )
    from public.messages message_row
    where message_row.id = v_message_id
  );
end
$function$;

revoke all on function public.bot_send_message_internal(uuid,uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.bot_send_message_internal(uuid,uuid,text,jsonb,text)
  to service_role;

revoke all on function public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)
  to service_role;

do $selfcheck$
declare
  v_state text;
  v_bot uuid := pg_catalog.gen_random_uuid();
  v_chat uuid := pg_catalog.gen_random_uuid();
  v_file uuid := pg_catalog.gen_random_uuid();
  v_fingerprint constant text := pg_catalog.repeat('a', 64);
begin
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.bot_send_message_internal(uuid,uuid,text,jsonb,text)',
       'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)',
       'EXECUTE') then
    raise exception 'rollback selfcheck 1 failed: service_role lost EXECUTE';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc
    where oid in (
      'public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'::regprocedure,
      'public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)'::regprocedure)
      and pg_catalog.strpos(prosrc, 'file_id') > 0
  ) then
    raise exception 'rollback selfcheck 2 failed: file_id still present in a body';
  end if;

  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', v_file),
      'rollback-selfcheck-file-id', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '22023' then
    raise exception 'rollback selfcheck 3 failed: a file_id payload is still accepted (sqlstate %)', v_state;
  end if;
end
$selfcheck$;

commit;
