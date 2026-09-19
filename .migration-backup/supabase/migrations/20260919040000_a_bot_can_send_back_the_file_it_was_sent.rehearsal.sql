/**
 * Rehearsal for 20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql.
 *
 * Run on production inside a transaction that ends in ROLLBACK. It builds a
 * bot, two group chats, and four media messages, measures the BEFORE state on
 * those values, applies the migration's two function bodies verbatim, and then
 * measures the AFTER state on the same values. Nothing survives the rollback.
 *
 * The fixture uses a bot as the author of the source messages on purpose: it
 * needs no `auth.users` row, and it exercises the stricter branch of
 * `private.bot_can_receive_message`, where a group under
 * `privacy_mode = 'restricted'` admits a message only because the bot wrote it.
 */

begin;

set local statement_timeout = '120s';

do $fixture$
declare
  v_bot constant uuid := 'aa000000-0000-4000-8000-000000000001';
  v_chat_a constant uuid := 'aa000000-0000-4000-8000-00000000000a';
  v_chat_b constant uuid := 'aa000000-0000-4000-8000-00000000000b';
  v_joined constant timestamptz := pg_catalog.now() - interval '1 hour';
  v_image_path constant text :=
    'aa000000-0000-4000-8000-000000000001/rehearsal-source.png';
  v_audio_path constant text :=
    'aa000000-0000-4000-8000-000000000001/rehearsal-voice.ogg';
  v_image_metadata constant jsonb := pg_catalog.jsonb_build_object(
    'kind', 'image',
    'mime_type', 'image/png',
    'file_name', 'rehearsal-source.png',
    'size_bytes', 4242,
    'width', 800,
    'height', 600,
    'optimized', true,
    'media_quality', 'balanced',
    'original_mime_type', 'image/jpeg',
    'original_size_bytes', 9001,
    'preview', pg_catalog.jsonb_build_object(
      'path', 'aa000000-0000-4000-8000-000000000001/rehearsal-source.preview.webp'
    )
  );
  v_state text;
begin
  insert into public.bots (id, username, display_name, state)
  values (v_bot, 'rehearsalfileid', 'Rehearsal file id', 'active');

  insert into public.chats (id, type, name) values
    (v_chat_a, 'group', 'Rehearsal A'),
    (v_chat_b, 'group', 'Rehearsal B');

  insert into public.chat_bot_members (chat_id, bot_id, privacy_mode, joined_at) values
    (v_chat_a, v_bot, 'restricted', v_joined),
    (v_chat_b, v_bot, 'restricted', v_joined);

  -- 101: readable image in chat A, posted after the bot joined.
  insert into public.messages
    (id, chat_id, bot_id, type, content, media_bucket, media_path, media_metadata, created_at)
  values
    ('aa000000-0000-4000-8000-000000000101', v_chat_a, v_bot, 'image', null,
     'media', v_image_path, v_image_metadata, v_joined + interval '1 minute');

  -- 102: same chat, but posted BEFORE the bot joined.
  insert into public.messages
    (id, chat_id, bot_id, type, content, media_bucket, media_path, media_metadata, created_at)
  values
    ('aa000000-0000-4000-8000-000000000102', v_chat_a, v_bot, 'image', null,
     'media', v_image_path, v_image_metadata, v_joined - interval '1 minute');

  -- 103: same chat, readable, but deleted.
  insert into public.messages
    (id, chat_id, bot_id, type, content, media_bucket, media_path, media_metadata,
     created_at, deleted_at)
  values
    ('aa000000-0000-4000-8000-000000000103', v_chat_a, v_bot, 'image', null,
     'media', v_image_path, v_image_metadata, v_joined + interval '2 minutes',
     pg_catalog.now());

  -- 104: readable image, but in the OTHER chat.
  insert into public.messages
    (id, chat_id, bot_id, type, content, media_bucket, media_path, media_metadata, created_at)
  values
    ('aa000000-0000-4000-8000-000000000104', v_chat_b, v_bot, 'image', null,
     'media', v_image_path, v_image_metadata, v_joined + interval '3 minutes');

  -- 105: a voice message in chat A, to prove more than one kind.
  insert into public.messages
    (id, chat_id, bot_id, type, content, media_bucket, media_path, media_metadata, created_at)
  values
    ('aa000000-0000-4000-8000-000000000105', v_chat_a, v_bot, 'audio', null,
     'media', v_audio_path,
     pg_catalog.jsonb_build_object(
       'kind', 'audio', 'mime_type', 'audio/ogg', 'size_bytes', 777,
       'duration_ms', 4500, 'uncompressed', false),
     v_joined + interval '4 minutes');

  ------------------------------------------------------------------ BEFORE --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', 'aa000000-0000-4000-8000-000000000101'),
      'rehearsal-before-file-id', pg_catalog.repeat('b', 64));
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'BEFORE file_id send -> %', v_state;
  if v_state not like '22023%' then
    raise exception 'rehearsal: the BEFORE state was not the recorded one (%)', v_state;
  end if;

  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object(
        'media_bucket', 'chat-media',
        'media_path', pg_catalog.repeat('x', 100),
        'media_metadata', pg_catalog.jsonb_build_object(
          'mime_type', 'image/png', 'size', 1024, 'kind', 'image')),
      'rehearsal-before-reference', pg_catalog.repeat('b', 64));
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'BEFORE storage-reference send -> %', v_state;
  if v_state not like '42501 bot_media_grant_required%' then
    raise exception 'rehearsal: the BEFORE reference path was not the recorded one (%)', v_state;
  end if;

  raise notice 'BEFORE messages in chat A: %',
    (select pg_catalog.count(*) from public.messages where chat_id = v_chat_a);
end
$fixture$;

-- The migration bodies, verbatim.

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
  v_resent_file boolean := false;
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
    v_resent_file := p_payload ? 'file_id';
    if v_resent_file then
      -- The Telegram shape: re-send by the identifier of a message the bot
      -- may already read. `bot_send_message_internal` resolves it against
      -- this chat; the bucket, the path, the mime type and the byte size
      -- are not the caller's to state, so they are refused here rather
      -- than checked.
      if pg_catalog.jsonb_typeof(p_payload->'file_id') <> 'string'
         or (p_payload->>'file_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or p_payload ? 'media_bucket'
         or p_payload ? 'media_path'
         or p_payload ? 'media_metadata'
         or exists (
           select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
           where payload_key not in (
             'file_id','text','topic_id','reply_to_id','reply_markup'
           )
         )
         or (p_payload ? 'text' and (
           pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
           or pg_catalog.length(p_payload->>'text') not between 1 and 4096
         )) then
        raise exception 'bot_send_media_input_invalid' using errcode = '22023';
      end if;
    elsif not (p_payload ? 'media_bucket')
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
  v_file_id uuid;
  v_source public.messages%rowtype;
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
         'reply_markup','file_id'
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

  -- A file re-sent by `file_id`: the identifier of a message the bot is
  -- already allowed to read, in this same chat. Nothing new enters storage,
  -- so no upload grant is involved. The object reference and the metadata
  -- are copied from a row whose audience already contains everyone who will
  -- see the new message, which is what makes the re-send safe.
  if nullif(p_payload->>'file_id', '') is not null then
    if v_message_type = 'text'
       or v_media_bucket is not null
       or v_media_path is not null
       or p_payload ? 'media_metadata'
       or (p_payload->>'file_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_message_input_invalid' using errcode = '22023';
    end if;
    v_file_id := (p_payload->>'file_id')::uuid;

    select source_message.*
    into v_source
    from public.messages source_message
    where source_message.id = v_file_id
      and source_message.chat_id = p_chat_id
      and source_message.deleted_at is null
      and source_message.media_bucket is not null
      and source_message.media_path is not null
      and pg_catalog.octet_length(source_message.media_bucket) between 1 and 128
      and pg_catalog.octet_length(source_message.media_path) between 1 and 1024
      and private.bot_can_receive_message(p_bot_id, source_message.id);
    if not found then
      raise exception 'bot_file_not_found' using errcode = 'P0002';
    end if;
    if coalesce(v_source.type, '') <> v_message_type then
      raise exception 'bot_file_kind_mismatch' using errcode = '22023';
    end if;

    v_media_bucket := v_source.media_bucket;
    v_media_path := v_source.media_path;
    v_media_metadata := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'kind', pg_catalog.to_jsonb(v_message_type),
      'mime_type', pg_catalog.to_jsonb(nullif(pg_catalog.left(
        v_source.media_metadata->>'mime_type', 128), '')),
      'file_name', pg_catalog.to_jsonb(nullif(pg_catalog.left(
        v_source.media_metadata->>'file_name', 255), '')),
      'size', case
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'size') = 'number'
          then v_source.media_metadata->'size'
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'size_bytes') = 'number'
          then v_source.media_metadata->'size_bytes'
        else null
      end,
      'size_bytes', case
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'size_bytes') = 'number'
          then v_source.media_metadata->'size_bytes'
        else null
      end,
      'width', case
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'width') = 'number'
          then v_source.media_metadata->'width'
        else null
      end,
      'height', case
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'height') = 'number'
          then v_source.media_metadata->'height'
        else null
      end,
      'duration_ms', case
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'duration_ms') = 'number'
          then v_source.media_metadata->'duration_ms'
        else null
      end,
      'preview', case
        when pg_catalog.jsonb_typeof(v_source.media_metadata->'preview') = 'object'
         and (
           (v_source.media_metadata #>> '{preview,path}') is null
           or (v_source.media_metadata #>> '{preview,path}') in (
             pg_catalog.regexp_replace(v_source.media_path, '[.][^./]*$', '')
               || '.preview.webp',
             pg_catalog.regexp_replace(v_source.media_path, '[.][^./]*$', '')
               || '.preview.jpg'
           )
         )
          then v_source.media_metadata->'preview'
        else null
      end
    ));
  end if;

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
     or (v_file_id is null and exists (
       select 1
       from pg_catalog.jsonb_object_keys(v_media_metadata) metadata_key
       where metadata_key not in (
         'mime_type','file_name','size','width','height','duration','kind'
       )
     )) then
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

  if v_message_type <> 'text' and v_file_id is null then
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

do $after$
declare
  v_bot constant uuid := 'aa000000-0000-4000-8000-000000000001';
  v_chat_a constant uuid := 'aa000000-0000-4000-8000-00000000000a';
  v_source constant uuid := 'aa000000-0000-4000-8000-000000000101';
  v_before_join constant uuid := 'aa000000-0000-4000-8000-000000000102';
  v_deleted constant uuid := 'aa000000-0000-4000-8000-000000000103';
  v_other_chat constant uuid := 'aa000000-0000-4000-8000-000000000104';
  v_voice constant uuid := 'aa000000-0000-4000-8000-000000000105';
  v_fingerprint constant text := pg_catalog.repeat('c', 64);
  v_state text;
  v_result jsonb;
  v_new public.messages%rowtype;
  v_source_row public.messages%rowtype;
  v_keys text;
  v_count bigint;
begin
  select * into v_source_row from public.messages where id = v_source;

  ------------------------------------------------------------- 1. it works --
  v_result := public.bot_message_command_internal(
    v_bot, v_chat_a, 'sendPhoto',
    pg_catalog.jsonb_build_object('file_id', v_source, 'text', 'Rehearsal caption'),
    'rehearsal-after-photo', v_fingerprint);
  raise notice 'AFTER file_id send -> %', v_result;
  if coalesce((v_result->>'duplicate')::boolean, true) is not false then
    raise exception 'rehearsal 1: the first send reported duplicate';
  end if;

  select * into v_new from public.messages
  where id = (v_result->'result'->>'message_id')::uuid;
  if v_new.chat_id <> v_chat_a or v_new.bot_id <> v_bot or v_new.type <> 'image' then
    raise exception 'rehearsal 1: the new row is not a bot image in chat A';
  end if;
  if v_new.media_bucket is distinct from v_source_row.media_bucket
     or v_new.media_path is distinct from v_source_row.media_path then
    raise exception 'rehearsal 1: the object reference was not copied (% %)',
      v_new.media_bucket, v_new.media_path;
  end if;
  if v_new.content is distinct from 'Rehearsal caption' then
    raise exception 'rehearsal 1: the caption did not survive (%)', v_new.content;
  end if;

  select pg_catalog.string_agg(k, ',' order by k) into v_keys
  from pg_catalog.jsonb_object_keys(v_new.media_metadata) k;
  raise notice 'AFTER copied metadata keys -> % / %', v_keys, v_new.media_metadata;
  if v_keys <> 'file_name,height,kind,mime_type,preview,size,size_bytes,width' then
    raise exception 'rehearsal 1: the metadata whitelist let through %', v_keys;
  end if;
  if (v_new.media_metadata->>'size') <> '4242'
     or (v_new.media_metadata->>'size_bytes') <> '4242'
     or (v_new.media_metadata->>'width') <> '800'
     or (v_new.media_metadata->>'mime_type') <> 'image/png'
     or (v_new.media_metadata #>> '{preview,path}')
        <> 'aa000000-0000-4000-8000-000000000001/rehearsal-source.preview.webp' then
    raise exception 'rehearsal 1: a copied value is wrong (%)', v_new.media_metadata;
  end if;

  ----------------------------------------------------- 2. idempotency holds --
  select pg_catalog.count(*) into v_count from public.messages where chat_id = v_chat_a;
  v_result := public.bot_message_command_internal(
    v_bot, v_chat_a, 'sendPhoto',
    pg_catalog.jsonb_build_object('file_id', v_source, 'text', 'Rehearsal caption'),
    'rehearsal-after-photo', v_fingerprint);
  if coalesce((v_result->>'duplicate')::boolean, false) is not true then
    raise exception 'rehearsal 2: the replay was not reported as a duplicate';
  end if;
  if (select pg_catalog.count(*) from public.messages where chat_id = v_chat_a) <> v_count then
    raise exception 'rehearsal 2: the replay wrote a second row';
  end if;

  --------------------------------------------------------- 3. voice re-send --
  v_result := public.bot_message_command_internal(
    v_bot, v_chat_a, 'sendVoice',
    pg_catalog.jsonb_build_object('file_id', v_voice),
    'rehearsal-after-voice', v_fingerprint);
  select * into v_new from public.messages
  where id = (v_result->'result'->>'message_id')::uuid;
  if v_new.type <> 'audio'
     or (v_new.media_metadata->>'duration_ms') <> '4500'
     or (v_new.media_metadata->>'kind') <> 'audio' then
    raise exception 'rehearsal 3: the voice re-send is wrong (% %)',
      v_new.type, v_new.media_metadata;
  end if;
  raise notice 'AFTER voice re-send metadata -> %', v_new.media_metadata;

  ------------------------------------------------- 4. the cross-chat refusal --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', v_other_chat),
      'rehearsal-after-crosschat', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'AFTER cross-chat file_id -> %', v_state;
  if v_state not like 'P0002 bot_file_not_found%' then
    raise exception 'rehearsal 4: a file from another chat was not refused (%)', v_state;
  end if;

  ------------------------------------------------------ 5. before the bot joined --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', v_before_join),
      'rehearsal-after-beforejoin', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'AFTER pre-join file_id -> %', v_state;
  if v_state not like 'P0002 bot_file_not_found%' then
    raise exception 'rehearsal 5: a message older than joined_at was not refused (%)', v_state;
  end if;

  ------------------------------------------------------------- 6. deleted --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', v_deleted),
      'rehearsal-after-deleted', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'AFTER deleted file_id -> %', v_state;
  if v_state not like 'P0002 bot_file_not_found%' then
    raise exception 'rehearsal 6: a deleted message was not refused (%)', v_state;
  end if;

  --------------------------------------------------------- 7. kind mismatch --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendVideo',
      pg_catalog.jsonb_build_object('file_id', v_source),
      'rehearsal-after-kind', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'AFTER kind mismatch -> %', v_state;
  if v_state not like '22023 bot_file_kind_mismatch%' then
    raise exception 'rehearsal 7: an image sent as a video was not refused (%)', v_state;
  end if;

  ------------------------------------------- 8. the old path did not change --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object(
        'media_bucket', 'chat-media',
        'media_path', pg_catalog.repeat('x', 100),
        'media_metadata', pg_catalog.jsonb_build_object(
          'mime_type', 'image/png', 'size', 1024, 'kind', 'image')),
      'rehearsal-after-reference', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'AFTER storage-reference send -> %', v_state;
  if v_state not like '42501 bot_media_grant_required%' then
    raise exception 'rehearsal 8: the storage-reference path moved (%)', v_state;
  end if;

  -------------------------------------------- 9. a stranger cannot be named --
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat_a, 'sendPhoto',
      pg_catalog.jsonb_build_object(
        'file_id', 'aa000000-0000-4000-8000-0000000009ff'),
      'rehearsal-after-unknown', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'AFTER unknown file_id -> %', v_state;
  if v_state not like 'P0002 bot_file_not_found%' then
    raise exception 'rehearsal 9: an unknown file_id was not refused (%)', v_state;
  end if;

  ------------------------------------------- 10. no grant row was invented --
  if exists (select 1 from private.bot_upload_grants where bot_id = v_bot) then
    raise exception 'rehearsal 10: a re-send created an upload grant';
  end if;

  raise notice 'REHEARSAL PASSED: 10 rules on values';
end
$after$;

rollback;
