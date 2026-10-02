import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";

// Function source/catalog only, captured read-only from LetsCube PG17 on 2026-10-02.
// Table rows below are fictional. This is not a full production restore.
export const capturedFunctions = [
  {
    "signature": "bot_membership_authorize_internal(uuid,uuid,text)",
    "ddl": "CREATE OR REPLACE FUNCTION public.bot_membership_authorize_internal(p_bot_id uuid, p_chat_id uuid, p_operation text)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_member record;\n  v_allowed boolean := false;\nbegin\n  if p_bot_id is null or p_chat_id is null\n     or p_operation is null\n     or p_operation not in ('send_message','receive_message','receive_all','read_file','manage') then\n    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'invalid_request');\n  end if;\n\n  select member_row.*,\n    chat.type as chat_type,\n    bot.state as bot_state\n  into v_member\n  from public.chat_bot_members member_row\n  join public.chats chat on chat.id = member_row.chat_id\n  join public.bots bot on bot.id = member_row.bot_id\n  where member_row.bot_id = p_bot_id\n    and member_row.chat_id = p_chat_id\n    and member_row.removed_at is null;\n\n  if not found or v_member.bot_state <> 'active' then\n    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'inactive_membership');\n  end if;\n\n  v_allowed := case\n    when p_operation in ('send_message','read_file','manage') then true\n    when v_member.chat_type = 'private' then true\n    when p_operation = 'receive_all' then\n      v_member.privacy_mode = 'full'\n    else true\n  end;\n\n  return pg_catalog.jsonb_build_object(\n    'allowed', v_allowed,\n    'privacy_mode', v_member.privacy_mode,\n    'joined_at', v_member.joined_at,\n    'chat_type', v_member.chat_type\n  );\nend\n$function$\n",
    "body_hash": "6bd4f42de254201ec32ed2b54cf47fe05003272fa5ab61bf897bd961151feeb9",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "volatility": "s",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)",
    "ddl": "CREATE OR REPLACE FUNCTION public.bot_upload_authorize_internal(p_bot_id uuid, p_chat_id uuid, p_bucket_id text, p_object_path text, p_content_type text, p_byte_size bigint, p_expires_in_seconds integer)\n RETURNS TABLE(grant_id uuid, bucket_id text, object_path text, expires_at timestamp with time zone)\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_grant private.bot_upload_grants%rowtype;\n  v_expected_prefix text;\nbegin\n  v_expected_prefix := p_chat_id::text || '/bots/' || p_bot_id::text || '/';\n  if p_bot_id is null or p_chat_id is null\n     or p_bucket_id is null\n     or p_object_path is null\n     or p_content_type is null\n     or p_byte_size is null\n     or p_expires_in_seconds is null\n     or p_bucket_id <> 'chat-media'\n     or p_content_type not in (\n       'image/jpeg','image/png','image/webp','image/gif',\n       'video/mp4','video/webm',\n       'audio/webm','audio/ogg','audio/mpeg',\n       'application/pdf'\n     )\n     or p_byte_size not between 1 and 104857600\n     or p_expires_in_seconds not between 60 and 900\n     or pg_catalog.octet_length(p_object_path) not between 80 and 1024\n     or p_object_path not like v_expected_prefix || '%'\n     or p_object_path like '%..%'\n     or p_object_path like '%//%'\n     or p_object_path like '%/' then\n    raise exception 'bot_upload_input_invalid' using errcode = '22023';\n  end if;\n\n  if coalesce((public.bot_membership_authorize_internal(\n       p_bot_id,\n       p_chat_id,\n       'send_message'\n     )->>'allowed')::boolean, false) is not true then\n    raise exception 'bot_chat_forbidden' using errcode = '42501';\n  end if;\n\n  if not exists (\n    select 1\n    from storage.objects stored_object\n    where stored_object.bucket_id = p_bucket_id\n      and stored_object.name = p_object_path\n  ) then\n    raise exception 'bot_upload_object_missing' using errcode = '22023';\n  end if;\n\n  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(\n      p_bot_id::text || ':' || p_chat_id::text || ':'\n      || p_bucket_id || ':' || p_object_path,\n      0\n    )\n  );\n\n  select upload_grant.*\n  into v_grant\n  from private.bot_upload_grants upload_grant\n  where upload_grant.bot_id = p_bot_id\n    and upload_grant.chat_id = p_chat_id\n    and upload_grant.bucket_id = p_bucket_id\n    and upload_grant.object_path = p_object_path\n    and upload_grant.consumed_at is null\n    and upload_grant.expires_at > pg_catalog.now()\n  order by upload_grant.created_at desc\n  limit 1\n  for update of upload_grant;\n  if found then\n    if v_grant.content_type = p_content_type\n       and v_grant.byte_size = p_byte_size\n       and v_grant.expires_at - v_grant.created_at\n         = pg_catalog.make_interval(secs => p_expires_in_seconds) then\n      return query select\n        v_grant.id,\n        v_grant.bucket_id,\n        v_grant.object_path,\n        v_grant.expires_at;\n      return;\n    end if;\n    raise exception 'bot_upload_grant_attribute_conflict' using errcode = '23505';\n  end if;\n\n  delete from private.bot_upload_grants stale_grant\n  where stale_grant.bot_id = p_bot_id\n    and stale_grant.chat_id = p_chat_id\n    and stale_grant.bucket_id = p_bucket_id\n    and stale_grant.object_path = p_object_path\n    and stale_grant.consumed_at is null\n    and stale_grant.expires_at <= pg_catalog.now();\n\n  insert into private.bot_upload_grants(\n    bot_id,\n    chat_id,\n    bucket_id,\n    object_path,\n    content_type,\n    byte_size,\n    expires_at\n  ) values (\n    p_bot_id,\n    p_chat_id,\n    p_bucket_id,\n    p_object_path,\n    p_content_type,\n    p_byte_size,\n    pg_catalog.now() + pg_catalog.make_interval(secs => p_expires_in_seconds)\n  )\n  returning * into v_grant;\n\n  return query select\n    v_grant.id,\n    v_grant.bucket_id,\n    v_grant.object_path,\n    v_grant.expires_at;\nexception\n  when unique_violation then\n    if sqlerrm = 'bot_upload_grant_attribute_conflict' then\n      raise;\n    end if;\n    raise exception 'bot_upload_grant_conflict' using errcode = '23505';\nend\n$function$\n",
    "body_hash": "03db4ebafc6ff37b3d8843a85b7fed956fc20d54de35dcca965fb6e0bc1b1f29",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "volatility": "v",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "bot_send_message_internal(uuid,uuid,text,jsonb,text)",
    "ddl": "CREATE OR REPLACE FUNCTION public.bot_send_message_internal(p_bot_id uuid, p_chat_id uuid, p_method text, p_payload jsonb, p_idempotency_key text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_existing_message_id uuid;\n  v_message_id uuid;\n  v_message_type text;\n  v_content text;\n  v_media_bucket text;\n  v_media_path text;\n  v_media_metadata jsonb;\n  v_topic_id uuid;\n  v_reply_to_id uuid;\n  v_reply_markup jsonb;\n  v_upload_grant_id uuid;\n  v_file_id uuid;\n  v_source public.messages%rowtype;\nbegin\n  if p_bot_id is null or p_chat_id is null\n     or p_method is null\n     or p_idempotency_key is null\n     or p_method not in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice')\n     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'\n     or p_payload is null\n     or pg_catalog.jsonb_typeof(p_payload) <> 'object'\n     or pg_catalog.octet_length(p_payload::text) > 65536\n     or exists (\n       select 1\n       from pg_catalog.jsonb_object_keys(p_payload) payload_key\n       where payload_key not in (\n         'text','media_bucket','media_path','media_metadata','topic_id','reply_to_id',\n         'reply_markup','file_id'\n       )\n     ) then\n    raise exception 'bot_message_input_invalid' using errcode = '22023';\n  end if;\n\n  if coalesce((public.bot_membership_authorize_internal(\n       p_bot_id,\n       p_chat_id,\n       'send_message'\n     )->>'allowed')::boolean, false) is not true then\n    raise exception 'bot_chat_forbidden' using errcode = '42501';\n  end if;\n\n  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)\n  );\n\n  select idem.message_id\n  into v_existing_message_id\n  from private.bot_message_idempotency idem\n  where idem.bot_id = p_bot_id\n    and idem.idempotency_key = p_idempotency_key\n    and idem.method = p_method;\n\n  if found then\n    return (\n      select pg_catalog.jsonb_build_object(\n        'message_id', message_row.id,\n        'chat_id', message_row.chat_id,\n        'bot_id', message_row.bot_id,\n        'type', message_row.type,\n        'created_at', message_row.created_at,\n        'duplicate', true\n      )\n      from public.messages message_row\n      where message_row.id = v_existing_message_id\n    );\n  end if;\n\n  if exists (\n    select 1\n    from private.bot_message_idempotency idem\n    where idem.bot_id = p_bot_id\n      and idem.idempotency_key = p_idempotency_key\n  ) then\n    raise exception 'bot_idempotency_conflict' using errcode = '23505';\n  end if;\n\n  v_message_type := case p_method\n    when 'sendMessage' then 'text'\n    when 'sendPhoto' then 'image'\n    when 'sendVideo' then 'video'\n    when 'sendDocument' then 'file'\n    when 'sendVoice' then 'audio'\n  end;\n  v_content := nullif(p_payload->>'text', '');\n  v_media_bucket := nullif(p_payload->>'media_bucket', '');\n  v_media_path := nullif(p_payload->>'media_path', '');\n  v_media_metadata := case\n    when pg_catalog.jsonb_typeof(p_payload->'media_metadata') = 'object'\n      then p_payload->'media_metadata'\n    else '{}'::jsonb\n  end;\n  v_reply_markup := case\n    when p_payload ? 'reply_markup' then p_payload->'reply_markup'\n    else null\n  end;\n\n  -- A file re-sent by `file_id`: the identifier of a message the bot is\n  -- already allowed to read, in this same chat. Nothing new enters storage,\n  -- so no upload grant is involved. The object reference and the metadata\n  -- are copied from a row whose audience already contains everyone who will\n  -- see the new message, which is what makes the re-send safe.\n  if nullif(p_payload->>'file_id', '') is not null then\n    if v_message_type = 'text'\n       or v_media_bucket is not null\n       or v_media_path is not null\n       or p_payload ? 'media_metadata'\n       or (p_payload->>'file_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then\n      raise exception 'bot_message_input_invalid' using errcode = '22023';\n    end if;\n    v_file_id := (p_payload->>'file_id')::uuid;\n\n    select source_message.*\n    into v_source\n    from public.messages source_message\n    where source_message.id = v_file_id\n      and source_message.chat_id = p_chat_id\n      and source_message.deleted_at is null\n      and source_message.media_bucket is not null\n      and source_message.media_path is not null\n      and pg_catalog.octet_length(source_message.media_bucket) between 1 and 128\n      and pg_catalog.octet_length(source_message.media_path) between 1 and 1024\n      and private.bot_can_receive_message(p_bot_id, source_message.id);\n    if not found then\n      raise exception 'bot_file_not_found' using errcode = 'P0002';\n    end if;\n    if coalesce(v_source.type, '') <> v_message_type then\n      raise exception 'bot_file_kind_mismatch' using errcode = '22023';\n    end if;\n\n    v_media_bucket := v_source.media_bucket;\n    v_media_path := v_source.media_path;\n    v_media_metadata := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(\n      'kind', pg_catalog.to_jsonb(v_message_type),\n      'mime_type', pg_catalog.to_jsonb(nullif(pg_catalog.left(\n        v_source.media_metadata->>'mime_type', 128), '')),\n      'file_name', pg_catalog.to_jsonb(nullif(pg_catalog.left(\n        v_source.media_metadata->>'file_name', 255), '')),\n      'size', case\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'size') = 'number'\n          then v_source.media_metadata->'size'\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'size_bytes') = 'number'\n          then v_source.media_metadata->'size_bytes'\n        else null\n      end,\n      'size_bytes', case\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'size_bytes') = 'number'\n          then v_source.media_metadata->'size_bytes'\n        else null\n      end,\n      'width', case\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'width') = 'number'\n          then v_source.media_metadata->'width'\n        else null\n      end,\n      'height', case\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'height') = 'number'\n          then v_source.media_metadata->'height'\n        else null\n      end,\n      'duration_ms', case\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'duration_ms') = 'number'\n          then v_source.media_metadata->'duration_ms'\n        else null\n      end,\n      'preview', case\n        when pg_catalog.jsonb_typeof(v_source.media_metadata->'preview') = 'object'\n         and (\n           (v_source.media_metadata #>> '{preview,path}') is null\n           or (v_source.media_metadata #>> '{preview,path}') in (\n             pg_catalog.regexp_replace(v_source.media_path, '[.][^./]*$', '')\n               || '.preview.webp',\n             pg_catalog.regexp_replace(v_source.media_path, '[.][^./]*$', '')\n               || '.preview.jpg'\n           )\n         )\n          then v_source.media_metadata->'preview'\n        else null\n      end\n    ));\n  end if;\n\n  if v_content is not null and pg_catalog.length(v_content) > 4096 then\n    raise exception 'bot_message_too_long' using errcode = '22023';\n  end if;\n  if v_message_type = 'text' and v_content is null then\n    raise exception 'bot_message_text_required' using errcode = '22023';\n  end if;\n  if v_message_type <> 'text' and (\n    v_media_bucket is null\n    or v_media_path is null\n    or pg_catalog.octet_length(v_media_bucket) > 128\n    or pg_catalog.octet_length(v_media_path) > 1024\n  ) then\n    raise exception 'bot_message_media_required' using errcode = '22023';\n  end if;\n  if pg_catalog.octet_length(v_media_metadata::text) > 4096\n     or (v_file_id is null and exists (\n       select 1\n       from pg_catalog.jsonb_object_keys(v_media_metadata) metadata_key\n       where metadata_key not in (\n         'mime_type','file_name','size','width','height','duration','kind'\n       )\n     )) then\n    raise exception 'bot_message_media_metadata_invalid' using errcode = '22023';\n  end if;\n  if not private.bot_inline_keyboard_valid(v_reply_markup) then\n    raise exception 'bot_reply_markup_invalid' using errcode = '22023';\n  end if;\n\n  if nullif(p_payload->>'topic_id', '') is not null then\n    if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then\n      raise exception 'bot_topic_invalid' using errcode = '22023';\n    end if;\n    v_topic_id := (p_payload->>'topic_id')::uuid;\n    if not exists (\n      select 1\n      from public.topics topic\n      where topic.id = v_topic_id\n        and topic.chat_id = p_chat_id\n        and topic.archived is false\n    ) then\n      raise exception 'bot_topic_forbidden' using errcode = '42501';\n    end if;\n  end if;\n  if nullif(p_payload->>'reply_to_id', '') is not null then\n    if (p_payload->>'reply_to_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then\n      raise exception 'bot_reply_invalid' using errcode = '22023';\n    end if;\n    v_reply_to_id := (p_payload->>'reply_to_id')::uuid;\n    if not exists (\n      select 1\n      from public.messages replied_message\n      where replied_message.id = v_reply_to_id\n        and replied_message.chat_id = p_chat_id\n        and private.bot_can_receive_message(\n          p_bot_id,\n          replied_message.id\n        )\n    ) then\n      raise exception 'bot_reply_forbidden' using errcode = '42501';\n    end if;\n  end if;\n\n  if v_message_type <> 'text' and v_file_id is null then\n    select upload_grant.id\n    into v_upload_grant_id\n    from private.bot_upload_grants upload_grant\n    where upload_grant.bot_id = p_bot_id\n      and upload_grant.chat_id = p_chat_id\n      and upload_grant.bucket_id = v_media_bucket\n      and upload_grant.object_path = v_media_path\n      and upload_grant.expires_at > pg_catalog.now()\n      and upload_grant.consumed_at is null\n      and (\n        nullif(v_media_metadata->>'mime_type', '') is null\n        or upload_grant.content_type = v_media_metadata->>'mime_type'\n      )\n      and (\n        nullif(v_media_metadata->>'size', '') is null\n        or upload_grant.byte_size::text = v_media_metadata->>'size'\n      )\n      and exists (\n        select 1\n        from storage.objects stored_object\n        where stored_object.bucket_id = upload_grant.bucket_id\n          and stored_object.name = upload_grant.object_path\n      )\n    order by upload_grant.created_at desc\n    limit 1\n    for update of upload_grant;\n    if not found then\n      raise exception 'bot_media_grant_required' using errcode = '42501';\n    end if;\n  end if;\n\n  insert into public.messages(\n    chat_id,\n    topic_id,\n    user_id,\n    bot_id,\n    content,\n    type,\n    media_bucket,\n    media_path,\n    media_metadata,\n    reply_to_id,\n    bot_reply_markup\n  ) values (\n    p_chat_id,\n    v_topic_id,\n    null,\n    p_bot_id,\n    v_content,\n    v_message_type,\n    v_media_bucket,\n    v_media_path,\n    v_media_metadata,\n    v_reply_to_id,\n    v_reply_markup\n  )\n  returning id into v_message_id;\n\n  insert into private.bot_message_idempotency(\n    bot_id,\n    idempotency_key,\n    method,\n    message_id\n  ) values (\n    p_bot_id,\n    p_idempotency_key,\n    p_method,\n    v_message_id\n  );\n\n  if v_upload_grant_id is not null then\n    update private.bot_upload_grants upload_grant\n    set consumed_at = pg_catalog.now(),\n        consumed_message_id = v_message_id\n    where upload_grant.id = v_upload_grant_id\n      and upload_grant.consumed_at is null;\n    if not found then\n      raise exception 'bot_media_grant_required' using errcode = '42501';\n    end if;\n  end if;\n\n  return (\n    select pg_catalog.jsonb_build_object(\n      'message_id', message_row.id,\n      'chat_id', message_row.chat_id,\n      'bot_id', message_row.bot_id,\n      'type', message_row.type,\n      'created_at', message_row.created_at,\n      'duplicate', false\n    )\n    from public.messages message_row\n    where message_row.id = v_message_id\n  );\nend\n$function$\n",
    "body_hash": "e38e2e51d94dcd017dc66fd4e6106907e1b51ac8e00fa1699b15f0aedcb1f928",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "volatility": "v",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "private.bot_operation_idempotency_lookup(uuid,text,text,text)",
    "ddl": "CREATE OR REPLACE FUNCTION private.bot_operation_idempotency_lookup(p_bot_id uuid, p_idempotency_key text, p_method text, p_request_fingerprint text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_row private.bot_operation_idempotency%rowtype;\nbegin\n  select operation_row.*\n  into v_row\n  from private.bot_operation_idempotency operation_row\n  where operation_row.bot_id = p_bot_id\n    and operation_row.idempotency_key = p_idempotency_key;\n  if not found then\n    return pg_catalog.jsonb_build_object('found', false);\n  end if;\n  if v_row.method <> p_method\n     or v_row.request_fingerprint <> p_request_fingerprint then\n    raise exception 'bot_operation_idempotency_conflict' using errcode = '23505';\n  end if;\n  return pg_catalog.jsonb_build_object(\n    'found', true,\n    'result', v_row.result\n  );\nend\n$function$\n",
    "body_hash": "afcd073719f593f9886607217c55f719fcff688ac5346c3cf4ef81e2ddae8a8e",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres"
    ],
    "volatility": "v",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "private.bot_operation_idempotency_store(uuid,text,text,text,jsonb)",
    "ddl": "CREATE OR REPLACE FUNCTION private.bot_operation_idempotency_store(p_bot_id uuid, p_idempotency_key text, p_method text, p_request_fingerprint text, p_result jsonb)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  if p_result is null or pg_catalog.octet_length(p_result::text) > 32782 then\n    raise exception 'bot_operation_result_invalid' using errcode = '22023';\n  end if;\n  insert into private.bot_operation_idempotency(\n    bot_id,\n    idempotency_key,\n    method,\n    request_fingerprint,\n    result\n  ) values (\n    p_bot_id,\n    p_idempotency_key,\n    p_method,\n    p_request_fingerprint,\n    p_result\n  );\nexception\n  when unique_violation then\n    raise exception 'bot_operation_idempotency_conflict' using errcode = '23505';\nend\n$function$\n",
    "body_hash": "c7aebc64e9d815d20bdb7476d95899306b145522336a41381866b30622aafaed",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres"
    ],
    "volatility": "v",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "bot_media_command_preflight_internal(uuid,uuid,text,text,text)",
    "ddl": "CREATE OR REPLACE FUNCTION public.bot_media_command_preflight_internal(p_bot_id uuid, p_chat_id uuid, p_method text, p_idempotency_key text, p_request_fingerprint text)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_existing jsonb;\nbegin\n  if p_bot_id is null or p_chat_id is null or p_method is null\n     or p_method not in (\n       'sendPhoto','sendVideo','sendDocument','sendVoice'\n     )\n     or p_idempotency_key is null\n     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'\n     or p_request_fingerprint is null\n     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then\n    raise exception 'bot_media_preflight_input_invalid' using errcode = '22023';\n  end if;\n\n  if not exists (\n    select 1 from public.bots bot\n    where bot.id = p_bot_id\n      and bot.state = 'active'\n  ) then\n    raise exception 'bot_identity_not_found' using errcode = 'P0002';\n  end if;\n  if coalesce((public.bot_membership_authorize_internal(\n       p_bot_id,\n       p_chat_id,\n       'send_message'\n     )->>'allowed')::boolean, false) is not true then\n    raise exception 'bot_chat_forbidden' using errcode = '42501';\n  end if;\n\n  v_existing := private.bot_operation_idempotency_lookup(\n    p_bot_id,\n    p_idempotency_key,\n    p_method,\n    p_request_fingerprint\n  );\n  if coalesce((v_existing->>'found')::boolean, false) then\n    return pg_catalog.jsonb_build_object(\n      'result', v_existing->'result',\n      'duplicate', true\n    );\n  end if;\n  return pg_catalog.jsonb_build_object('result', null, 'duplicate', false);\nend\n$function$\n",
    "body_hash": "59a139737de279ae7646e5355e2440e9e1cfb484107730d2eb4063471531d7c3",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "volatility": "s",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "bot_message_command_internal(uuid,uuid,text,jsonb,text,text)",
    "ddl": "CREATE OR REPLACE FUNCTION public.bot_message_command_internal(p_bot_id uuid, p_chat_id uuid, p_method text, p_payload jsonb, p_idempotency_key text, p_request_fingerprint text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n  v_existing jsonb;\n  v_result jsonb;\n  v_send_result jsonb;\n  v_target public.messages%rowtype;\n  v_message_id uuid;\n  v_topic_id uuid;\n  v_text text;\n  v_reply_markup jsonb;\n  v_expected_media_kind text;\n  v_resent_file boolean := false;\nbegin\n  if p_bot_id is null or p_chat_id is null or p_method is null\n     or p_method not in (\n       'sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice',\n       'sendChatAction','editMessageText','deleteMessage'\n     )\n     or p_payload is null\n     or pg_catalog.jsonb_typeof(p_payload) <> 'object'\n     or pg_catalog.octet_length(p_payload::text) > 65536\n     or p_idempotency_key is null\n     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'\n     or p_request_fingerprint is null\n     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then\n    raise exception 'bot_message_command_input_invalid' using errcode = '22023';\n  end if;\n\n  if p_method = 'sendMessage' then\n    if not (p_payload ? 'text')\n       or pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'\n       or pg_catalog.length(p_payload->>'text') not between 1 and 4096\n       or exists (\n         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key\n         where payload_key not in ('text','topic_id','reply_to_id','reply_markup')\n       ) then\n      raise exception 'bot_send_text_input_invalid' using errcode = '22023';\n    end if;\n  elsif p_method in ('sendPhoto','sendVideo','sendDocument','sendVoice') then\n    v_expected_media_kind := case p_method\n      when 'sendPhoto' then 'image'\n      when 'sendVideo' then 'video'\n      when 'sendDocument' then 'file'\n      when 'sendVoice' then 'audio'\n    end;\n    v_resent_file := p_payload ? 'file_id';\n    if v_resent_file then\n      -- The Telegram shape: re-send by the identifier of a message the bot\n      -- may already read. `bot_send_message_internal` resolves it against\n      -- this chat; the bucket, the path, the mime type and the byte size\n      -- are not the caller's to state, so they are refused here rather\n      -- than checked.\n      if pg_catalog.jsonb_typeof(p_payload->'file_id') <> 'string'\n         or (p_payload->>'file_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'\n         or p_payload ? 'media_bucket'\n         or p_payload ? 'media_path'\n         or p_payload ? 'media_metadata'\n         or exists (\n           select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key\n           where payload_key not in (\n             'file_id','text','topic_id','reply_to_id','reply_markup'\n           )\n         )\n         or (p_payload ? 'text' and (\n           pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'\n           or pg_catalog.length(p_payload->>'text') not between 1 and 4096\n         )) then\n        raise exception 'bot_send_media_input_invalid' using errcode = '22023';\n      end if;\n    elsif not (p_payload ? 'media_bucket')\n       or not (p_payload ? 'media_path')\n       or not (p_payload ? 'media_metadata')\n       or pg_catalog.jsonb_typeof(p_payload->'media_bucket') <> 'string'\n       or p_payload->>'media_bucket' <> 'chat-media'\n       or pg_catalog.jsonb_typeof(p_payload->'media_path') <> 'string'\n       or pg_catalog.octet_length(p_payload->>'media_path') not between 1 and 1024\n       or pg_catalog.jsonb_typeof(p_payload->'media_metadata') <> 'object'\n       or exists (\n         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key\n         where payload_key not in (\n           'text','media_bucket','media_path','media_metadata',\n           'topic_id','reply_to_id','reply_markup'\n         )\n       )\n       or exists (\n         select 1 from pg_catalog.jsonb_object_keys(p_payload->'media_metadata') metadata_key\n         where metadata_key not in ('mime_type','size','kind')\n       )\n       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type') <> 'string'\n       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'size') <> 'number'\n       or (p_payload->'media_metadata'->>'size') !~ '^[0-9]{1,9}$'\n       or (p_payload->'media_metadata'->>'size')::bigint not between 1 and 104857600\n       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'kind') <> 'string'\n       or p_payload->'media_metadata'->>'kind' <> v_expected_media_kind\n       or (p_payload ? 'text' and (\n         pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'\n         or pg_catalog.length(p_payload->>'text') not between 1 and 4096\n       ))\n       or (p_method = 'sendPhoto' and p_payload->'media_metadata'->>'mime_type' not in (\n         'image/jpeg','image/png','image/webp','image/gif'\n       ))\n       or (p_method = 'sendVideo' and p_payload->'media_metadata'->>'mime_type' not in (\n         'video/mp4','video/webm'\n       ))\n       or (p_method = 'sendDocument' and p_payload->'media_metadata'->>'mime_type' not in (\n         'application/pdf'\n       ))\n       or (p_method = 'sendVoice' and p_payload->'media_metadata'->>'mime_type' not in (\n         'audio/webm','audio/ogg','audio/mpeg'\n       )) then\n      raise exception 'bot_send_media_input_invalid' using errcode = '22023';\n    end if;\n  end if;\n\n  if p_method = 'sendChatAction' then\n    if not (p_payload ? 'action')\n       or pg_catalog.jsonb_typeof(p_payload->'action') <> 'string'\n       or p_payload->>'action' not in (\n         'typing','upload_photo','upload_video','upload_document','record_voice'\n       )\n       or exists (\n         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key\n         where payload_key not in ('action','topic_id')\n       ) then\n      raise exception 'bot_chat_action_input_invalid' using errcode = '22023';\n    end if;\n    if nullif(p_payload->>'topic_id', '') is not null then\n      if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then\n        raise exception 'bot_topic_invalid' using errcode = '22023';\n      end if;\n      v_topic_id := (p_payload->>'topic_id')::uuid;\n    end if;\n  elsif p_method = 'editMessageText' then\n    if not (p_payload ? 'message_id')\n       or not (p_payload ? 'text')\n       or pg_catalog.jsonb_typeof(p_payload->'message_id') <> 'string'\n       or pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'\n       or (p_payload->>'message_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'\n       or pg_catalog.length(p_payload->>'text') not between 1 and 4096\n       or exists (\n         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key\n         where payload_key not in ('message_id','text','reply_markup')\n       ) then\n      raise exception 'bot_edit_input_invalid' using errcode = '22023';\n    end if;\n    v_message_id := (p_payload->>'message_id')::uuid;\n    v_text := p_payload->>'text';\n    v_reply_markup := case\n      when not (p_payload ? 'reply_markup')\n        or p_payload->'reply_markup' = 'null'::jsonb then null\n      else p_payload->'reply_markup'\n    end;\n    if not private.bot_inline_keyboard_valid(v_reply_markup) then\n      raise exception 'bot_reply_markup_invalid' using errcode = '22023';\n    end if;\n  elsif p_method = 'deleteMessage' then\n    if not (p_payload ? 'message_id')\n       or pg_catalog.jsonb_typeof(p_payload->'message_id') <> 'string'\n       or (p_payload->>'message_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'\n       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 1 then\n      raise exception 'bot_delete_input_invalid' using errcode = '22023';\n    end if;\n    v_message_id := (p_payload->>'message_id')::uuid;\n  end if;\n\n  if coalesce((public.bot_membership_authorize_internal(\n       p_bot_id,\n       p_chat_id,\n       'send_message'\n     )->>'allowed')::boolean, false) is not true then\n    raise exception 'bot_chat_forbidden' using errcode = '42501';\n  end if;\n\n  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)\n  );\n  v_existing := private.bot_operation_idempotency_lookup(\n    p_bot_id,\n    p_idempotency_key,\n    p_method,\n    p_request_fingerprint\n  );\n  if coalesce((v_existing->>'found')::boolean, false) then\n    return pg_catalog.jsonb_build_object(\n      'result', v_existing->'result',\n      'duplicate', true\n    );\n  end if;\n\n  if p_method in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice') then\n    v_send_result := public.bot_send_message_internal(\n      p_bot_id,\n      p_chat_id,\n      p_method,\n      p_payload,\n      p_idempotency_key\n    );\n    v_result := v_send_result - 'duplicate';\n    perform private.bot_operation_idempotency_store(\n      p_bot_id,\n      p_idempotency_key,\n      p_method,\n      p_request_fingerprint,\n      v_result\n    );\n    return pg_catalog.jsonb_build_object(\n      'result', v_result,\n      'duplicate', coalesce((v_send_result->>'duplicate')::boolean, false)\n    );\n  end if;\n\n  if p_method = 'sendChatAction' then\n    if v_topic_id is not null and not exists (\n      select 1 from public.topics topic\n      where topic.id = v_topic_id\n        and topic.chat_id = p_chat_id\n        and topic.archived is false\n    ) then\n      raise exception 'bot_topic_forbidden' using errcode = '42501';\n    end if;\n    v_result := pg_catalog.to_jsonb(true);\n  else\n    select message_row.*\n    into v_target\n    from public.messages message_row\n    where message_row.id = v_message_id\n      and message_row.chat_id = p_chat_id\n      and message_row.bot_id = p_bot_id\n      and message_row.deleted_at is null\n    for update of message_row;\n    if not found then\n      raise exception 'bot_message_not_found' using errcode = 'P0002';\n    end if;\n\n    if p_method = 'editMessageText' then\n      update public.messages message_row\n      set content = v_text,\n          bot_reply_markup = v_reply_markup,\n          edited_at = pg_catalog.now()\n      where message_row.id = v_target.id;\n      v_result := pg_catalog.jsonb_build_object(\n        'message_id', v_target.id,\n        'chat_id', v_target.chat_id,\n        'text', v_text,\n        'reply_markup', v_reply_markup,\n        'edited_at', pg_catalog.now()\n      );\n    else\n      update public.messages message_row\n      set deleted_at = pg_catalog.now()\n      where message_row.id = v_target.id;\n      v_result := pg_catalog.jsonb_build_object(\n        'message_id', v_target.id,\n        'chat_id', v_target.chat_id,\n        'deleted', true\n      );\n    end if;\n  end if;\n\n  perform private.bot_operation_idempotency_store(\n    p_bot_id,\n    p_idempotency_key,\n    p_method,\n    p_request_fingerprint,\n    v_result\n  );\n  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);\nend\n$function$\n",
    "body_hash": "649e6d70ab393a1fd002b492e39b597aeaaa4a5a4bf23b5fbe8d410dbf38fb44",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "volatility": "v",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "private.bot_inline_keyboard_valid(jsonb)",
    "ddl": "CREATE OR REPLACE FUNCTION private.bot_inline_keyboard_valid(p_markup jsonb)\n RETURNS boolean\n LANGUAGE plpgsql\n IMMUTABLE\n SET search_path TO ''\nAS $function$\ndeclare\n  v_row jsonb;\n  v_button jsonb;\nbegin\n  if p_markup is null then\n    return true;\n  end if;\n  if pg_catalog.jsonb_typeof(p_markup) <> 'object'\n     or pg_catalog.octet_length(p_markup::text) > 16384\n     or not (p_markup ? 'inline_keyboard')\n     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_markup)) not between 1 and 2\n     or exists (\n       select 1 from pg_catalog.jsonb_object_keys(p_markup) as key_name\n       where key_name not in ('inline_keyboard', 'input_field_placeholder')\n     )\n     or (p_markup ? 'input_field_placeholder' and (\n       pg_catalog.jsonb_typeof(p_markup->'input_field_placeholder') <> 'string'\n       or pg_catalog.length(p_markup->>'input_field_placeholder') not between 1 and 64\n     ))\n     or pg_catalog.jsonb_typeof(p_markup->'inline_keyboard') <> 'array'\n     or pg_catalog.jsonb_array_length(p_markup->'inline_keyboard') not between 1 and 8 then\n    return false;\n  end if;\n\n  for v_row in\n    select row_element.value\n    from pg_catalog.jsonb_array_elements(p_markup->'inline_keyboard') row_element(value)\n  loop\n    if pg_catalog.jsonb_typeof(v_row) <> 'array'\n       or pg_catalog.jsonb_array_length(v_row) not between 1 and 8 then\n      return false;\n    end if;\n    for v_button in\n      select button_element.value\n      from pg_catalog.jsonb_array_elements(v_row) button_element(value)\n    loop\n      if pg_catalog.jsonb_typeof(v_button) <> 'object'\n         or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_button)) <> 2\n         or not (v_button ? 'text')\n         or not (v_button ? 'callback_data')\n         or pg_catalog.jsonb_typeof(v_button->'text') <> 'string'\n         or pg_catalog.jsonb_typeof(v_button->'callback_data') <> 'string'\n         or pg_catalog.length(v_button->>'text') not between 1 and 64\n         or pg_catalog.length(v_button->>'callback_data') not between 1 and 128 then\n        return false;\n      end if;\n    end loop;\n  end loop;\n  return true;\nend\n$function$\n",
    "body_hash": "371e0df6d44beebecbe1d0d7471c77b49a941ba14f9452d3fac4e3f0dc737d2e",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres"
    ],
    "volatility": "i",
    "security_definer": false,
    "settings": [
      "search_path=\"\""
    ]
  },
  {
    "signature": "private.bot_can_receive_message(uuid,uuid)",
    "ddl": "CREATE OR REPLACE FUNCTION private.bot_can_receive_message(p_bot_id uuid, p_message_id uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  select exists (\n    select 1\n    from public.messages message_row\n    join public.chat_bot_members member_row\n      on member_row.chat_id = message_row.chat_id\n     and member_row.bot_id = p_bot_id\n    join public.chats chat on chat.id = message_row.chat_id\n    join public.bots receiver_bot on receiver_bot.id = p_bot_id\n    where message_row.id = p_message_id\n      and message_row.deleted_at is null\n      and receiver_bot.state = 'active'\n      and member_row.removed_at is null\n      and message_row.created_at >= member_row.joined_at\n      and (\n        message_row.bot_id = p_bot_id\n        or chat.type = 'private'\n        or member_row.privacy_mode = 'full'\n        or (\n          member_row.privacy_mode = 'restricted'\n          and (\n            private.message_mentions_targeted(message_row.mention_entities, 'bot', p_bot_id)\n            or pg_catalog.lower(coalesce(message_row.content, '')) ~ (\n              '^/[a-z][a-z0-9_]{0,31}@'\n              || receiver_bot.username\n              || '([[:space:]]|$)'\n            )\n            or pg_catalog.lower(coalesce(message_row.content, '')) ~ (\n              '(^|[^a-z0-9_])@'\n              || receiver_bot.username\n              || '([^a-z0-9_]|$)'\n            )\n            or exists (\n              select 1\n              from public.messages replied_message\n              where replied_message.id = message_row.reply_to_id\n                and replied_message.chat_id = message_row.chat_id\n                and replied_message.bot_id = p_bot_id\n                and replied_message.created_at >= member_row.joined_at\n            )\n          )\n        )\n      )\n  );\n$function$\n",
    "body_hash": "6c4609fa5312dca57befd622fc9c3842d56a0494fbeb7cff9a2e495e61f752bb",
    "owner": "postgres",
    "acl": [
      "postgres=X/postgres"
    ],
    "volatility": "s",
    "security_definer": true,
    "settings": [
      "search_path=\"\""
    ]
  }
];

export const root = new URL("../../", import.meta.url);
capturedFunctions.unshift(
{
  "acl": [
    "postgres=X/postgres"
  ],
  "ddl": "CREATE OR REPLACE FUNCTION private.message_mentions_targeted(p_data jsonb, p_kind text, p_id uuid)\n RETURNS boolean\n LANGUAGE sql\n IMMUTABLE\n SET search_path TO ''\nAS $function$\n  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(\n    CASE WHEN jsonb_typeof(p_data->'items')='array' THEN p_data->'items' ELSE '[]'::jsonb END) item\n    WHERE item->>'kind'=p_kind\n      AND item->>(CASE p_kind WHEN 'user' THEN 'user_id' WHEN 'bot' THEN 'bot_id' END)=p_id::text);\n$function$\n",
  "owner": "postgres",
  "settings": [
    "search_path=\"\""
  ],
  "body_hash": "55a3b4ac3aa06dd257c4275550ed76d3765c0c5d27df064ffcfb2f3a08b1d27b",
  "signature": "private.message_mentions_targeted(jsonb,text,uuid)",
  "volatility": "i",
  "security_definer": false
}
);
export const read = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
export const stem = "supabase/migrations/20261002020000_bot_inline_media_ingest";
export const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export const uuid = (n) => "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const bot = uuid(1), token = uuid(2), chat = uuid(3), lease = uuid(4);
export const fingerprint = "a".repeat(64), digest = "b".repeat(64);
export const objectPath = chat + "/bots/" + bot + "/" + fingerprint + ".pdf";

function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    // pg_ctl's daemon can inherit a pipe after the launcher exits on Windows.
    child.on("exit", () => {
      if (basename(command).startsWith("pg_ctl")) {
        child.stdout.destroy(); child.stderr.destroy();
      }
    });
    child.on("close", (code) => {
      if (code===0) return resolve(stdout.trim());
      const error = new Error((stderr.match(/ERROR:[^\r\n]*/)?.[0] ?? stderr.trim()).slice(0,600));
      error.code = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
      error.detail = stderr.match(/DETAIL:\s+([^\r\n]*)/)?.[1];
      reject(error);
    });
    child.stdin.end(input);
  });
}

export async function postgres(t, migration) {
  const directory = await mkdtemp(join(tmpdir(), "letscube-bot-ingest-"));
  if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("letscube-bot-ingest-")) {
    throw new Error("fixture temporary path escaped its parent");
  }
  let started = false;
  const suffix = process.platform === "win32" ? ".exe" : "";
  const bin = process.env.BOT_INGEST_PG_BIN;
  const executable = (name) => bin ? join(bin, name + suffix) : name + suffix;
  // Only loopback, an ephemeral port and fictional trust-auth fixture identities.
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  try {
    await run(executable("initdb"), ["-D", directory, "-U", "fixture_control", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
    await run(executable("pg_ctl"), ["-D", directory, "-l", join(directory, "server.log"), "-o",
      "-h 127.0.0.1 -p " + port + " -c fsync=off -c max_connections=12", "-w", "start"]);
    started = true;
    const args = ["-X", "-qAt", "-h", "127.0.0.1", "-p", String(port), "-U", "fixture_control",
      "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
    const exec = (sql) => run(executable("psql"), args, sql);
    const query = async (sql) => JSON.parse(await exec("select coalesce(jsonb_agg(q), '[]'::jsonb) from (" + sql + ") q;"));
    const service = async (sql) => JSON.parse(await exec("set role service_role; select to_jsonb(q) from (" + sql + ") q;"));
    const session = () => {
      const child = spawn(executable("psql"), args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = "", failure = "", sequence = 0, pending;
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (pending && output.includes(pending.marker)) {
          const result = output.slice(0, output.indexOf(pending.marker)).trim();
          output = output.slice(output.indexOf(pending.marker) + pending.marker.length).trimStart();
          const done = pending; pending = undefined; done.resolve(result);
        }
      });
      child.stderr.on("data", (chunk) => { failure += chunk; });
      child.on("error", (error) => pending?.reject(error));
      const closed = new Promise((resolve) => child.on("close", () => {
        const error = new Error(failure.match(/ERROR:[^\r\n]*/)?.[0] ?? "fixture connection closed");
        error.code = failure.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
        error.detail = failure.match(/DETAIL:\s+([^\r\n]*)/)?.[1];
        pending?.reject(error); resolve();
      }));
      const send = (sql) => new Promise((resolve, reject) => {
        if (pending) return reject(new Error("fixture session already busy"));
        const marker = "__BOT_INGEST_END_" + (++sequence) + "__";
        pending = { marker, resolve, reject };
        child.stdin.write(sql + "\nselect " + quote(marker) + ";\n");
      });
      const close = async () => { child.stdin.end(); await closed; };
      t.after(close);
      return { send, close };
    };
    await exec(bootstrap());
    if (!process.env.BOT_INGEST_TEST_BASELINE) await exec(migration ?? read(stem + ".sql"));
    const version = await query("select current_setting('server_version') as version");
    return { exec, query, service, session, version: version[0].version };
  } catch (error) {
    if (started) await run(executable("pg_ctl"), ["-D", directory, "-m", "immediate", "-w", "stop"]);
    started = false;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  } finally {
    if (started) t.after(async () => {
      await run(executable("pg_ctl"), ["-D", directory, "-m", "immediate", "-w", "stop"]);
      // A fresh mkdtemp target, never a repository or computed user directory.
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
  }
}

function bootstrap() {
  return `
create role postgres nosuperuser bypassrls;
create role supabase_admin superuser;
create role supabase_storage_admin nosuperuser nobypassrls;
create role service_role nosuperuser bypassrls;
create role authenticated nosuperuser nobypassrls;
create role anon nosuperuser nobypassrls;
create schema private authorization postgres;
create schema storage authorization supabase_admin;
alter schema public owner to postgres;
revoke all on schema public from public;
grant usage on schema public, storage to postgres, service_role, authenticated, anon;
grant create on schema public to postgres;
grant usage,create on schema storage to supabase_storage_admin;
grant usage on schema private to postgres;
alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;
create function public.pgrst_fixture_ddl_watch() returns event_trigger language plpgsql as
  $$ begin perform pg_event_trigger_ddl_commands(); end $$;
create function public.pgrst_fixture_drop_watch() returns event_trigger language plpgsql as
  $$ begin perform pg_event_trigger_dropped_objects(); end $$;
create event trigger pgrst_fixture_ddl_watch on ddl_command_end execute function public.pgrst_fixture_ddl_watch();
create event trigger pgrst_fixture_drop_watch on sql_drop execute function public.pgrst_fixture_drop_watch();
create table public.bots(id uuid primary key, state text not null default 'active', username text default 'fixturebot');
create table public.chats(id uuid primary key, type text default 'group');
create table public.chat_bot_members(bot_id uuid, chat_id uuid, removed_at timestamptz,
  privacy_mode text default 'full', joined_at timestamptz default now()-interval '1 hour',
  full_visibility_approved_by uuid, primary key(bot_id, chat_id));
create table public.topics(id uuid primary key, chat_id uuid, archived boolean default false);
create table public.messages(id uuid primary key default gen_random_uuid(), chat_id uuid, bot_id uuid, user_id uuid,
  topic_id uuid, reply_to_id uuid, content text, type text, media_bucket text, media_path text, media_metadata jsonb,
  bot_reply_markup jsonb, mention_entities jsonb default '[]', created_at timestamptz default now(), edited_at timestamptz, deleted_at timestamptz);
create table private.bot_tokens(id uuid primary key, bot_id uuid, revoked_at timestamptz);
create table private.bot_message_idempotency(bot_id uuid, idempotency_key text, method text, message_id uuid,
  created_at timestamptz default now(), primary key(bot_id,idempotency_key));
create table private.bot_operation_idempotency(bot_id uuid, idempotency_key text, method text,
  request_fingerprint text, result jsonb, created_at timestamptz default now(), primary key(bot_id,idempotency_key));
create table private.bot_upload_grants(id uuid primary key default gen_random_uuid(), bot_id uuid, chat_id uuid,
  bucket_id text, object_path text, content_type text, byte_size bigint, created_at timestamptz default now(),
  expires_at timestamptz, consumed_at timestamptz, consumed_message_id uuid);
create unique index bot_upload_grants_active_object_idx on private.bot_upload_grants(bot_id,chat_id,bucket_id,object_path)
  where consumed_at is null;
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  metadata jsonb, owner uuid, owner_id text, unique(bucket_id,name));
alter table storage.objects owner to supabase_storage_admin;
alter table storage.objects enable row level security;
grant all on storage.objects to postgres, service_role, authenticated, anon;
create policy fixture_ordinary_objects on storage.objects for all to authenticated using(true) with check(true);
` + ["public.bots", "public.chats", "public.chat_bot_members", "public.topics", "public.messages",
      "private.bot_tokens", "private.bot_message_idempotency", "private.bot_operation_idempotency", "private.bot_upload_grants"]
    .map((name) => "alter table " + name + " owner to postgres; alter table " + name + " enable row level security;").join("\n") +
    capturedFunctions.map((fn) => "\nset role postgres;\n" + fn.ddl + ";\nrevoke all on function " + fn.signature +
      " from public,anon,authenticated,service_role;\n" +
      (fn.acl.some((acl) => acl.startsWith("service_role=")) ? "grant execute on function " + fn.signature + " to service_role;\n" : "") +
      "reset role;\n").join("") + `
insert into public.bots(id) values ('${bot}'), ('${uuid(10)}');
insert into public.chats(id) values ('${chat}'), ('${uuid(11)}');
insert into public.chat_bot_members(bot_id,chat_id) values ('${bot}','${chat}'), ('${uuid(10)}','${chat}'), ('${bot}','${uuid(11)}');
insert into private.bot_tokens(id,bot_id) values ('${token}','${bot}'), ('${uuid(12)}','${uuid(10)}');
set role supabase_admin;
`;
}

export function reservation(overrides = {}) {
  return { bot, token, chat, method: "sendDocument", key: "ingest-fixture-0001", fingerprint,
    path: objectPath, mime: "application/pdf", size: 68, digest, lease, ...overrides };
}
export function reserveSql(r) {
  const values = [r.bot,r.token,r.chat,r.method,r.key,r.fingerprint,r.path,r.mime,r.size,r.digest,r.lease];
  return "select public.bot_media_ingest_reserve_internal(" + values.map(quote).join(",") + ") as value";
}
export function payload(r, metadata = {}) {
  const kind = {sendPhoto:"image",sendVideo:"video",sendDocument:"file",sendVoice:"audio"}[r.method];
  return { media_bucket:"chat-media",media_path:r.path,
    media_metadata:{mime_type:r.mime,size:r.size,size_bytes:r.size,kind,...metadata} };
}
export function commitSql(r, data = payload(r)) {
  return "select public.bot_media_ingest_commit_internal(" +
    [r.bot,r.token,r.key,r.fingerprint,r.lease,JSON.stringify(data)].map(quote).join(",") + "::jsonb) as value";
}
export async function object(db, r, attributes = {}) {
  await db.exec("insert into storage.objects(bucket_id,name,metadata) values ('chat-media'," +
    quote(r.path) + "," + quote(JSON.stringify({mimetype:r.mime,size:r.size,...attributes})) + "::jsonb);");
}
