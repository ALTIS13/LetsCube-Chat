/**
 * A bot can send back the file it was sent.
 *
 * G-1 of `docs/proposals/2026-09-19-pocketflow-reference-bot.md`, the half of
 * it that is closable without a new upload route. Recorded there, measured
 * again here against production before a line was written.
 *
 * ── What the four media methods actually required ─────────────────────────
 *
 * `sendPhoto`/`sendVideo`/`sendDocument`/`sendVoice` take
 * `media: {bucket, object_path, mime_type, size_bytes}`, and the chain behind
 * them is closed at both ends:
 *
 *   `bot_upload_authorize_internal` refuses unless the object is ALREADY in
 *   `storage.objects` (`bot_upload_object_missing`, 22023), and additionally
 *   unless the path is 80..1024 bytes and begins `<chat_id>/bots/<bot_id>/`;
 *
 *   `bot_send_message_internal` then refuses unless an unconsumed
 *   `private.bot_upload_grants` row exists for exactly that object
 *   (`bot_media_grant_required`, 42501).
 *
 * So the methods re-send an object the bot already put in storage — and the
 * public API has no route that puts one there. Measured on production: the
 * `chat-media` bucket holds **0 objects**, `private.bot_upload_grants` holds
 * **0 rows**, and no bot has ever sent a message carrying media (0 of 294
 * media messages). The feature has never run.
 *
 * ── The fix: `file_id`, which is Telegram's own model ─────────────────────
 *
 * The four methods now accept `file_id` in place of `media`. On LETSCUBE a
 * `file_id` is the source message's id — exactly what `getFile` returns and
 * what already arrives in an update's `attachment.file_id`
 * (`private.bot_message_update_payload` builds it as `message_row.id`). Telegram
 * re-sends files by `file_id` too, so this raises wire compatibility rather
 * than lowering it, and no storage path is ever shown to the bot.
 *
 * Uploading genuinely new bytes — a rendered QR code, a converted file — is a
 * different and larger gap. It needs a real upload route and is deliberately
 * NOT closed here.
 *
 * ── The authorization rule, which is the whole of the design ──────────────
 *
 * Three conditions, all of which must hold:
 *
 *   1. the bot may READ the source message — `private.bot_can_receive_message`,
 *      unchanged, which already folds in `bots.state = 'active'`,
 *      `chat_bot_members.removed_at is null`, the `privacy_mode` gate and the
 *      `messages.created_at >= chat_bot_members.joined_at` restriction;
 *   2. the bot may SEND into the destination chat —
 *      `bot_membership_authorize_internal(..., 'send_message')`, unchanged,
 *      already checked at the top of both functions;
 *   3. **the source message is in the destination chat.**
 *
 * (3) is the decision, and it is a deliberate narrowing of Telegram, where a
 * `file_id` crosses chats. Four reasons, in the order of how much they matter:
 *
 *   - It is what makes the re-send safe at all. A same-chat re-send creates a
 *     message pointing at the exact object an already-visible message in that
 *     chat points at, so the audience of the new message is by construction a
 *     subset of the audience that could already read those bytes. Nobody gains
 *     a byte. A cross-chat re-send has no such property: it hands chat B an
 *     object that was only ever offered to chat A.
 *   - It would otherwise export content past the boundary the read rule exists
 *     to draw. `bot_can_receive_message` restricts a bot to messages posted
 *     after it joined, and in a group under `privacy_mode = 'restricted'` to
 *     messages addressed to it. A bot that may send wherever it is a member
 *     would turn «may see in A» into «may publish in B», which is the exact
 *     escalation `joined_at` was written to prevent — and the bot, not a
 *     person, would choose when.
 *   - Measured, it is also incoherent with storage. `chat-media` is private and
 *     its read policy is `_kub_can_access_chat_media_path(name)`, which takes
 *     the chat id from the first path segment and requires membership of THAT
 *     chat; a message in B carrying an A-scoped path is an attachment B's
 *     members cannot open. Today all 294 media messages in fact sit in the
 *     public `media` bucket, so cross-chat bytes WOULD arrive — which makes the
 *     refusal more necessary, not less.
 *   - Narrowing is reversible; a leak is not. Widening later costs one
 *     predicate and a decision; it costs a bot nothing today, because a bot has
 *     no cross-chat file path at all.
 *
 * ── What is deliberately not changed ──────────────────────────────────────
 *
 *   - The per-method mime allowlist is NOT applied to a re-send. It guards what
 *     a bot may introduce; the bytes here are already in the chat. Measured, it
 *     would also make the feature useless: of the mime types real messages
 *     carry, `video/webm;codecs=vp8,opus`, `video/quicktime`,
 *     `application/x-msdownload` and `application/vnd.android.package-archive`
 *     are all outside it, and 220 of 294 media messages carry no mime type at
 *     all. What IS enforced is coherence: the source message's `type` must equal
 *     the type the method produces, else `bot_file_kind_mismatch` — the same
 *     refusal Telegram gives for a photo `file_id` passed to `sendVideo`.
 *   - `private.bot_upload_grants` is untouched. A re-send introduces no object,
 *     so it takes no grant, and the grant branch is skipped rather than fed.
 *     Its `bucket_id = 'chat-media'` and `octet_length(object_path) >= 80`
 *     constraints would have refused every real path anyway (measured: 54..129
 *     bytes, 152 of 294 under 80, all in bucket `media`).
 *   - `private.guard_message_media_path` is untouched and does not need to be:
 *     `private.message_media_path_allowed` returns true when `p_bot_id is not
 *     null`, so a bot's message may carry a path it does not own. Verified on
 *     the live definition, not assumed.
 *   - The metadata of the new message is copied from the source through a
 *     type-guarded whitelist — `mime_type`, `file_name`, `size`, `size_bytes`,
 *     `width`, `height`, `duration_ms`, `preview` — so the re-send renders as
 *     the original did. The whitelist is by construction, because one existing
 *     row would fail `messages_media_metadata_shape` if copied verbatim (that
 *     constraint is NOT VALID, so old rows were never checked but a new row is),
 *     and `preview` is dropped unless its `path` still matches `media_path`.
 *     The caller-supplied path keeps its narrower key allowlist unchanged.
 *   - Both signatures are unchanged, so this is two `create or replace` with no
 *     drop, no window in which the gateway sees a missing function, and no ACL
 *     to rebuild. The grants are re-asserted identically anyway and the
 *     self-check refuses to commit unless `service_role` still holds EXECUTE —
 *     `20260919030000` is the recent reminder that a function the gateway
 *     cannot execute fails before its own checks run.
 *
 * ── Rollback ──────────────────────────────────────────────────────────────
 *
 * `20260919040000_a_bot_can_send_back_the_file_it_was_sent.rollback.sql`
 * restores both bodies verbatim from `20260831100000_bot_platform_foundation`.
 * Nothing else in this migration persists state, so the rollback is complete.
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
  v_reference constant jsonb := pg_catalog.jsonb_build_object(
    'media_bucket', 'chat-media',
    'media_path', pg_catalog.repeat('x', 100),
    'media_metadata', pg_catalog.jsonb_build_object(
      'mime_type', 'image/png',
      'size', 1024,
      'kind', 'image'
    )
  );
begin
  -- The gateway resolves to service_role. A function it cannot execute fails
  -- before its own checks run, so this is asserted rather than assumed.
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.bot_send_message_internal(uuid,uuid,text,jsonb,text)',
       'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)',
       'EXECUTE') then
    raise exception 'selfcheck 1 failed: service_role lost EXECUTE on a bot send function';
  end if;

  -- A `file_id` payload must pass validation and be refused only by the
  -- membership gate (42501). Before this migration it died at 22023 for having
  -- no `media_bucket`, which is what makes this assertion a mutation detector.
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', v_file),
      'selfcheck-file-id-accept', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '42501' then
    raise exception 'selfcheck 2 failed: a file_id payload was not accepted (sqlstate %)', v_state;
  end if;

  -- `file_id` and a storage reference together are a contradiction, not a
  -- precedence question.
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat, 'sendPhoto',
      v_reference || pg_catalog.jsonb_build_object('file_id', v_file),
      'selfcheck-file-id-both', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '22023' then
    raise exception 'selfcheck 3 failed: file_id plus media reference was not refused (sqlstate %)', v_state;
  end if;

  -- Neither shape is still a refusal.
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat, 'sendPhoto', '{}'::jsonb,
      'selfcheck-file-id-neither', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '22023' then
    raise exception 'selfcheck 4 failed: an empty media payload was not refused (sqlstate %)', v_state;
  end if;

  -- The existing storage-reference shape still validates and still reaches the
  -- membership gate, so nothing about the old path moved.
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat, 'sendPhoto', v_reference,
      'selfcheck-file-id-reference', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '42501' then
    raise exception 'selfcheck 5 failed: the storage-reference path regressed (sqlstate %)', v_state;
  end if;

  -- `bot_send_message_internal` accepts the key directly too, so the gateway is
  -- not the only thing standing between a payload and the resolver.
  begin
    perform public.bot_send_message_internal(
      v_bot, v_chat, 'sendPhoto',
      pg_catalog.jsonb_build_object('file_id', v_file),
      'selfcheck-file-id-direct');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '42501' then
    raise exception 'selfcheck 6 failed: bot_send_message_internal rejected file_id (sqlstate %)', v_state;
  end if;

  -- `sendMessage` has no media to re-send, and must not have acquired the key.
  begin
    perform public.bot_message_command_internal(
      v_bot, v_chat, 'sendMessage',
      pg_catalog.jsonb_build_object('text', 'hello', 'file_id', v_file),
      'selfcheck-file-id-text', v_fingerprint);
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> '22023' then
    raise exception 'selfcheck 7 failed: sendMessage accepted a file_id (sqlstate %)', v_state;
  end if;
end
$selfcheck$;

commit;
