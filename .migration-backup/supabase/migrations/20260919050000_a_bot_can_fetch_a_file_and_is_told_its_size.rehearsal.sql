/**
 * Rehearsal for 20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.sql.
 *
 * Run on production inside a transaction that ends in ROLLBACK. It builds two
 * bots, two group chats, five storage objects across both buckets and ten
 * media messages; measures the BEFORE state on those values; applies the
 * migration's three bodies verbatim; measures the AFTER state on the same
 * values; then applies the rollback file's statements verbatim and measures
 * that the BEFORE state came back. Nothing survives the rollback.
 *
 * The fixture uses a bot as the author of every message on purpose: it needs
 * no `auth.users` row, it exercises the stricter branch of
 * `private.bot_can_receive_message` (a group under `privacy_mode =
 * 'restricted'` admits a message only because the bot wrote it), and it is the
 * branch of `private.message_media_path_allowed` that lets a path be written
 * that is not the author's own id — which is what a `chat-media` path is.
 *
 * The BEFORE state records the dormant hole D-249 describes: under the old
 * literal a `chat-media` object belonging to ANOTHER chat was handed over,
 * because the rule named a bucket and never asked whose chat the path was in.
 */

begin;

set local statement_timeout = '120s';

do $fixture$
declare
  v_bot constant uuid := 'cc000000-0000-4000-8000-000000000001';
  v_stranger constant uuid := 'cc000000-0000-4000-8000-000000000002';
  v_chat_a constant uuid := 'cc000000-0000-4000-8000-00000000000a';
  v_chat_b constant uuid := 'cc000000-0000-4000-8000-00000000000b';
  v_joined constant timestamptz := pg_catalog.now() - interval '1 hour';
  v_image_path constant text :=
    'cc000000-0000-4000-8000-000000000001/rehearsal-image.png';
  v_voice_path constant text :=
    'cc000000-0000-4000-8000-000000000001/rehearsal-voice.ogg';
  v_bare_path constant text :=
    'cc000000-0000-4000-8000-000000000001/rehearsal-bare.png';
  v_missing_path constant text :=
    'cc000000-0000-4000-8000-000000000001/rehearsal-missing.png';
  v_here_path constant text :=
    'cc000000-0000-4000-8000-00000000000a/rehearsal-here.png';
  v_there_path constant text :=
    'cc000000-0000-4000-8000-00000000000b/rehearsal-there.png';
  v_image_metadata constant jsonb := pg_catalog.jsonb_build_object(
    'kind', 'image',
    'mime_type', 'image/png',
    'file_name', 'rehearsal-image.png',
    'size_bytes', 4242,
    'width', 800,
    'height', 600
  );
  v_state text;
  v_result jsonb;
begin
  insert into public.bots (id, username, display_name, state) values
    (v_bot, 'rehearsalgetfile', 'Rehearsal getFile', 'active'),
    (v_stranger, 'rehearsalstranger', 'Rehearsal stranger', 'active');

  insert into public.chats (id, type, name) values
    (v_chat_a, 'group', 'Rehearsal A'),
    (v_chat_b, 'group', 'Rehearsal B');

  insert into public.chat_bot_members (chat_id, bot_id, privacy_mode, joined_at) values
    (v_chat_a, v_bot, 'restricted', v_joined),
    (v_chat_b, v_bot, 'restricted', v_joined);

  -- The storage side. `rehearsal-missing.png` is deliberately absent, and the
  -- two `chat-media` objects are the private bucket the product does not yet
  -- use: one scoped to chat A, one to chat B.
  insert into storage.objects (bucket_id, name, metadata) values
    ('media', v_image_path,
     pg_catalog.jsonb_build_object('size', 4242, 'mimetype', 'image/png')),
    ('media', v_voice_path,
     pg_catalog.jsonb_build_object('size', 777, 'mimetype', 'audio/ogg')),
    ('media', v_bare_path,
     pg_catalog.jsonb_build_object('size', 5150, 'mimetype', 'image/png')),
    ('chat-media', v_here_path,
     pg_catalog.jsonb_build_object('size', 313, 'mimetype', 'image/png')),
    ('chat-media', v_there_path,
     pg_catalog.jsonb_build_object('size', 414, 'mimetype', 'image/png'));

  -- 201: the ordinary case. Readable image in chat A, posted after the bot
  -- joined, in the public bucket the product actually writes.
  insert into public.messages
    (id, chat_id, bot_id, type, media_bucket, media_path, media_metadata, created_at)
  values
    ('cc000000-0000-4000-8000-000000000201', v_chat_a, v_bot, 'image',
     'media', v_image_path, v_image_metadata, v_joined + interval '1 minute'),
  -- 202: same chat and object, but posted BEFORE the bot joined.
    ('cc000000-0000-4000-8000-000000000202', v_chat_a, v_bot, 'image',
     'media', v_image_path, v_image_metadata, v_joined - interval '1 minute'),
  -- 204: readable, but in the OTHER chat.
    ('cc000000-0000-4000-8000-000000000204', v_chat_b, v_bot, 'image',
     'media', v_image_path, v_image_metadata, v_joined + interval '3 minutes'),
  -- 205: a voice message, the only kind that carries a duration.
    ('cc000000-0000-4000-8000-000000000205', v_chat_a, v_bot, 'audio',
     'media', v_voice_path,
     pg_catalog.jsonb_build_object(
       'kind', 'audio', 'mime_type', 'audio/ogg',
       'size_bytes', 777, 'duration_ms', 4200),
     v_joined + interval '4 minutes'),
  -- 206: the 225-row case — media_metadata knows nothing. Size and mime must
  -- come from the storage layer.
    ('cc000000-0000-4000-8000-000000000206', v_chat_a, v_bot, 'image',
     'media', v_bare_path, '{}'::jsonb, v_joined + interval '5 minutes'),
  -- 207: a message pointing at an object that is not in storage.
    ('cc000000-0000-4000-8000-000000000207', v_chat_a, v_bot, 'image',
     'media', v_missing_path,
     pg_catalog.jsonb_build_object('size_bytes', 111), v_joined + interval '6 minutes'),
  -- 208: the private bucket, with a path scoped to THIS chat.
    ('cc000000-0000-4000-8000-000000000208', v_chat_a, v_bot, 'image',
     'chat-media', v_here_path, '{}'::jsonb, v_joined + interval '7 minutes'),
  -- 209: the private bucket, with a path scoped to the OTHER chat. This is the
  -- shape a forward produces, and the one the old literal let through.
    ('cc000000-0000-4000-8000-000000000209', v_chat_a, v_bot, 'image',
     'chat-media', v_there_path, '{}'::jsonb, v_joined + interval '8 minutes'),
  -- 210: the second spelling, as a string, over an object storage sizes
  -- differently. The message must win.
    ('cc000000-0000-4000-8000-000000000210', v_chat_a, v_bot, 'image',
     'media', v_bare_path,
     pg_catalog.jsonb_build_object('size', '8888', 'mime_type', 'image/png'),
     v_joined + interval '9 minutes');

  -- 203 is 201 deleted, and is inserted on its own because `deleted_at` is set.
  insert into public.messages
    (id, chat_id, bot_id, type, media_bucket, media_path, media_metadata,
     created_at, deleted_at)
  values
    ('cc000000-0000-4000-8000-000000000203', v_chat_a, v_bot, 'image',
     'media', v_image_path, v_image_metadata,
     v_joined + interval '2 minutes', pg_catalog.now());

  ------------------------------------------------------------------ BEFORE --
  begin
    v_result := public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000201');
    v_state := '00000 ' || v_result::text;
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'BEFORE getFile on the ordinary image -> %', v_state;
  if v_state not like 'P0002 bot_file_not_found%' then
    raise exception 'rehearsal: the BEFORE state was not the recorded one (%)', v_state;
  end if;

  begin
    v_result := public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000209');
    v_state := '00000 bucket=' || coalesce(v_result->>'bucket_id', 'null');
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  raise notice 'BEFORE getFile on another chat private object -> %', v_state;
  if v_state <> '00000 bucket=chat-media' then
    raise exception
      'rehearsal: the dormant cross-chat hole was not in the BEFORE state (%)', v_state;
  end if;

  v_result := private.bot_message_update_payload(
    v_bot, 'cc000000-0000-4000-8000-000000000201');
  raise notice 'BEFORE attachment byte_size -> %, width -> % (%)',
    coalesce((v_result #> '{message,attachment,byte_size}')::text, 'absent'),
    coalesce((v_result #> '{message,attachment,width}')::text, 'absent'),
    coalesce(pg_catalog.jsonb_typeof(v_result #> '{message,attachment,width}'), 'absent');
  if v_result #> '{message,attachment,byte_size}' is not null then
    raise exception 'rehearsal: byte_size was already present in the BEFORE state';
  end if;
  if pg_catalog.jsonb_typeof(v_result #> '{message,attachment,width}') <> 'string' then
    raise exception 'rehearsal: width was not a string in the BEFORE state';
  end if;

  v_result := private.bot_message_update_payload(
    v_bot, 'cc000000-0000-4000-8000-000000000205');
  raise notice 'BEFORE voice duration -> %',
    coalesce((v_result #> '{message,attachment,duration}')::text, 'absent');
  if v_result #> '{message,attachment,duration}' is not null then
    raise exception 'rehearsal: duration was already present in the BEFORE state';
  end if;
end
$fixture$;

-- ------------------------------------------------------------------------
-- The migration, verbatim.
-- ------------------------------------------------------------------------

create or replace function private.media_metadata_bigint(
  p_metadata jsonb,
  variadic p_keys text[]
)
returns bigint
language sql
immutable
set search_path to ''
as $function$
  select candidate.value
  from pg_catalog.unnest(p_keys) with ordinality as wanted(key, ord)
  cross join lateral (
    select case
      when pg_catalog.jsonb_typeof(p_metadata -> wanted.key) in ('number', 'string')
       and (p_metadata ->> wanted.key) ~ '^[0-9]{1,15}$'
      then (p_metadata ->> wanted.key)::bigint
    end as value
  ) candidate
  where candidate.value is not null
  order by wanted.ord
  limit 1;
$function$;

alter function private.media_metadata_bigint(jsonb, text[]) owner to postgres;
revoke all on function private.media_metadata_bigint(jsonb, text[]) from public;

create or replace function public.bot_file_lookup_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if p_bot_id is null or p_chat_id is null or p_message_id is null then
    raise exception 'bot_file_input_invalid' using errcode = '22023';
  end if;
  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'read_file'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'message_id', message_row.id,
    'bucket_id', message_row.media_bucket,
    'object_path', message_row.media_path,
    'mime_type', coalesce(
      nullif(pg_catalog.left(message_row.media_metadata->>'mime_type', 128), ''),
      nullif(pg_catalog.left(media_object.metadata->>'mimetype', 128), '')
    ),
    'file_name', nullif(pg_catalog.left(message_row.media_metadata->>'file_name', 255), ''),
    'size_bytes', coalesce(
      private.media_metadata_bigint(message_row.media_metadata, 'size_bytes', 'size'),
      private.media_metadata_bigint(media_object.metadata, 'size')
    )
  ))
  into v_result
  from public.messages message_row
  join storage.objects media_object
    on media_object.bucket_id = message_row.media_bucket
   and media_object.name = message_row.media_path
  join storage.buckets bucket_row
    on bucket_row.id = message_row.media_bucket
  where message_row.id = p_message_id
    and message_row.chat_id = p_chat_id
    and message_row.deleted_at is null
    and message_row.media_bucket is not null
    and message_row.media_path is not null
    and pg_catalog.octet_length(message_row.media_path) between 1 and 1024
    and (
      bucket_row.public
      or public._kub_chat_media_chat_id(message_row.media_path) = message_row.chat_id
    )
    and private.bot_can_receive_message(p_bot_id, message_row.id);
  if v_result is null then
    raise exception 'bot_file_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end
$function$;

create or replace function private.bot_message_update_payload(
  p_bot_id uuid,
  p_message_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'message',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', message_row.id,
      'chat_id', message_row.chat_id,
      'topic_id', message_row.topic_id,
      'reply_to_message_id', message_row.reply_to_id,
      'date', message_row.created_at,
      'type', nullif(pg_catalog.left(message_row.type, 32), ''),
      'text', case
        when message_row.content is null then null
        else nullif(pg_catalog.left(message_row.content, 4096), '')
      end,
      'reply_markup', message_row.bot_reply_markup,
      'from', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', message_row.user_id,
        'bot_id', message_row.bot_id,
        'is_bot', message_row.bot_id is not null,
        'display_name', nullif(pg_catalog.left(
          coalesce(profile.full_name, sender_bot.display_name),
          128
        ), ''),
        'username', nullif(pg_catalog.left(
          coalesce(profile.username, sender_bot.username),
          64
        ), '')
      )),
      'chat', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', chat.id,
        'type', nullif(pg_catalog.left(chat.type, 32), ''),
        'name', nullif(pg_catalog.left(chat.name, 256), '')
      )),
      'attachment', case
        when message_row.media_bucket is null or message_row.media_path is null then null
        else pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'file_id', message_row.id,
          'kind', nullif(pg_catalog.left(message_row.type, 32), ''),
          'mime_type', coalesce(
            nullif(pg_catalog.left(message_row.media_metadata->>'mime_type', 128), ''),
            nullif(pg_catalog.left(media_object.metadata->>'mimetype', 128), '')
          ),
          'file_name', nullif(pg_catalog.left(
            message_row.media_metadata->>'file_name',
            255
          ), ''),
          'byte_size', coalesce(
            private.media_metadata_bigint(message_row.media_metadata, 'size_bytes', 'size'),
            private.media_metadata_bigint(media_object.metadata, 'size')
          ),
          'width', private.media_metadata_bigint(message_row.media_metadata, 'width'),
          'height', private.media_metadata_bigint(message_row.media_metadata, 'height'),
          'duration_ms', private.media_metadata_bigint(message_row.media_metadata, 'duration_ms'),
          'duration', (
            pg_catalog.round(
              private.media_metadata_bigint(message_row.media_metadata, 'duration_ms')::numeric
              / 1000
            )
          )::bigint
        ))
      end
    ))
  )
  from public.messages message_row
  join public.chats chat on chat.id = message_row.chat_id
  left join public.profiles profile on profile.id = message_row.user_id
  left join public.bots sender_bot on sender_bot.id = message_row.bot_id
  left join storage.objects media_object
    on media_object.bucket_id = message_row.media_bucket
   and media_object.name = message_row.media_path
  where message_row.id = p_message_id
    and p_bot_id is not null;
$function$;

-- The self-check raises rather than committing a half-applied state. It
-- asserts on values wherever it can: the helper's rules are proved by calling
-- it, the new bucket rule is proved by counting the production rows it admits
-- against the rows the old literal admitted, and the payload change is proved
-- by building a real message's payload and reading the type back.
do $selfcheck$
declare
  v_helper oid;
  v_owner text;
  v_acl text;
  v_body text;
  v_old_rule bigint;
  v_admitted bigint;
  v_message uuid;
  v_payload jsonb;
begin
  ---------------------------------------------------------------- 1. helper --
  select p.oid into v_helper
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'media_metadata_bigint';
  if v_helper is null then
    raise exception 'selfcheck 1 failed: private.media_metadata_bigint is absent';
  end if;
  select pg_catalog.pg_get_userbyid(proowner),
         coalesce(pg_catalog.array_to_string(proacl, ' '), '(null acl)')
    into v_owner, v_acl
  from pg_catalog.pg_proc where oid = v_helper;
  if v_owner <> 'postgres' or v_acl <> 'postgres=X/postgres' then
    raise exception 'selfcheck 1 failed: helper owner is % and acl is %', v_owner, v_acl;
  end if;

  ------------------------------------------------- 2. the helper, on values --
  if private.media_metadata_bigint('{"size_bytes": 42}'::jsonb, 'size_bytes', 'size')
     is distinct from 42 then
    raise exception 'selfcheck 2a failed: a number under the first key was not read';
  end if;
  if private.media_metadata_bigint('{"size": "42"}'::jsonb, 'size_bytes', 'size')
     is distinct from 42 then
    raise exception 'selfcheck 2b failed: a digit string under the second key was not read';
  end if;
  if private.media_metadata_bigint('{"size_bytes": 42, "size": 7}'::jsonb, 'size_bytes', 'size')
     is distinct from 42 then
    raise exception 'selfcheck 2c failed: the second key won over the first';
  end if;
  if private.media_metadata_bigint('{"size_bytes": null, "size": 7}'::jsonb, 'size_bytes', 'size')
     is distinct from 7 then
    raise exception 'selfcheck 2d failed: a JSON null did not fall through to the next key';
  end if;
  if private.media_metadata_bigint('{"size_bytes": -1}'::jsonb, 'size_bytes') is not null then
    raise exception 'selfcheck 2e failed: a negative size was accepted';
  end if;
  if private.media_metadata_bigint('{"size_bytes": 1.5}'::jsonb, 'size_bytes') is not null then
    raise exception 'selfcheck 2f failed: a fractional size was accepted';
  end if;
  if private.media_metadata_bigint('{"size_bytes": "4 2"}'::jsonb, 'size_bytes') is not null then
    raise exception 'selfcheck 2g failed: a non-numeric string was accepted';
  end if;
  if private.media_metadata_bigint('{"size_bytes": 1234567890123456}'::jsonb, 'size_bytes')
     is not null then
    raise exception 'selfcheck 2h failed: a 16-digit value was accepted';
  end if;
  if private.media_metadata_bigint('{}'::jsonb, 'size_bytes', 'size') is not null
     or private.media_metadata_bigint(null::jsonb, 'size_bytes', 'size') is not null then
    raise exception 'selfcheck 2i failed: an absent key or a null metadata did not answer null';
  end if;

  -------------------------------------------- 3. the replaced functions keep --
  --------------------------------------------    their owner, definer and acl --
  select pg_catalog.pg_get_userbyid(proowner) into v_owner
  from pg_catalog.pg_proc
  where oid = 'public.bot_file_lookup_internal(uuid,uuid,uuid)'::regprocedure;
  if v_owner <> 'postgres' then
    raise exception 'selfcheck 3 failed: bot_file_lookup_internal is owned by %', v_owner;
  end if;
  if not (select prosecdef from pg_catalog.pg_proc
          where oid = 'public.bot_file_lookup_internal(uuid,uuid,uuid)'::regprocedure) then
    raise exception 'selfcheck 3 failed: bot_file_lookup_internal lost SECURITY DEFINER';
  end if;
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.bot_file_lookup_internal(uuid,uuid,uuid)'::regprocedure,
       'EXECUTE') then
    raise exception 'selfcheck 3 failed: service_role can no longer execute the lookup';
  end if;
  select pg_catalog.pg_get_userbyid(proowner),
         coalesce(pg_catalog.array_to_string(proacl, ' '), '(null acl)')
    into v_owner, v_acl
  from pg_catalog.pg_proc
  where oid = 'private.bot_message_update_payload(uuid,uuid)'::regprocedure;
  if v_owner <> 'postgres' or v_acl <> 'postgres=X/postgres' then
    raise exception 'selfcheck 3 failed: the payload builder is % / %', v_owner, v_acl;
  end if;

  ----------------------------------------- 4. the bucket name is really gone --
  v_body := pg_catalog.pg_get_functiondef(
    'public.bot_file_lookup_internal(uuid,uuid,uuid)'::regprocedure);
  if pg_catalog.strpos(v_body, 'chat-media') <> 0 then
    raise exception 'selfcheck 4 failed: a bucket name is still written into the lookup';
  end if;
  if pg_catalog.strpos(v_body, 'bucket_row.public') = 0
     or pg_catalog.strpos(v_body, '_kub_chat_media_chat_id') = 0
     or pg_catalog.strpos(v_body, 'storage.objects') = 0
     or pg_catalog.strpos(v_body, 'bot_can_receive_message') = 0 then
    raise exception 'selfcheck 4 failed: the derived rule is not the one in the lookup';
  end if;

  ------------------------------------- 5. the new rule reaches the real rows --
  select pg_catalog.count(*) into v_old_rule
  from public.messages message_row
  where message_row.media_path is not null
    and message_row.deleted_at is null
    and message_row.media_bucket = 'chat-media';
  select pg_catalog.count(*) into v_admitted
  from public.messages message_row
  join storage.objects media_object
    on media_object.bucket_id = message_row.media_bucket
   and media_object.name = message_row.media_path
  join storage.buckets bucket_row on bucket_row.id = message_row.media_bucket
  where message_row.media_path is not null
    and message_row.deleted_at is null
    and (
      bucket_row.public
      or public._kub_chat_media_chat_id(message_row.media_path) = message_row.chat_id
    );
  if v_admitted = 0 then
    raise exception 'selfcheck 5 failed: the new rule admits no message at all';
  end if;
  if v_admitted <= v_old_rule then
    raise exception
      'selfcheck 5 failed: the new rule admits % rows and the old literal admitted %, so nothing was widened',
      v_admitted, v_old_rule;
  end if;
  raise notice 'selfcheck: the bucket rule admits % live media messages; the old literal admitted % (0 on production when this was written)',
    v_admitted, v_old_rule;

  ---------------------------------- 6. a real message now carries its size ----
  select message_row.id into v_message
  from public.messages message_row
  join storage.objects media_object
    on media_object.bucket_id = message_row.media_bucket
   and media_object.name = message_row.media_path
  where message_row.media_path is not null
    and message_row.deleted_at is null
  order by message_row.created_at desc
  limit 1;
  if v_message is null then
    raise exception 'selfcheck 6 failed: there is no media message to measure';
  end if;
  v_payload := private.bot_message_update_payload(pg_catalog.gen_random_uuid(), v_message);
  if pg_catalog.jsonb_typeof(v_payload #> '{message,attachment,byte_size}') is distinct from 'number' then
    raise exception 'selfcheck 6 failed: byte_size on a real message is %',
      coalesce(pg_catalog.jsonb_typeof(v_payload #> '{message,attachment,byte_size}'), 'absent');
  end if;
  if pg_catalog.jsonb_typeof(v_payload #> '{message,attachment,mime_type}') is distinct from 'string' then
    raise exception 'selfcheck 6 failed: mime_type on a real message is %',
      coalesce(pg_catalog.jsonb_typeof(v_payload #> '{message,attachment,mime_type}'), 'absent');
  end if;
  if v_payload #> '{message,attachment,width}' is not null
     and pg_catalog.jsonb_typeof(v_payload #> '{message,attachment,width}') <> 'number' then
    raise exception 'selfcheck 6 failed: width is still not a number';
  end if;
end
$selfcheck$;

do $after$
declare
  v_bot constant uuid := 'cc000000-0000-4000-8000-000000000001';
  v_stranger constant uuid := 'cc000000-0000-4000-8000-000000000002';
  v_chat_a constant uuid := 'cc000000-0000-4000-8000-00000000000a';
  v_image_path constant text :=
    'cc000000-0000-4000-8000-000000000001/rehearsal-image.png';
  v_here_path constant text :=
    'cc000000-0000-4000-8000-00000000000a/rehearsal-here.png';
  v_state text;
  v_result jsonb;
begin
  ---- 1. the ordinary case now answers, with the bucket the product uses -----
  v_result := public.bot_file_lookup_internal(
    v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000201');
  raise notice 'AFTER ordinary image -> bucket=% size=%(%) mime=%',
    v_result->>'bucket_id',
    v_result->>'size_bytes',
    pg_catalog.jsonb_typeof(v_result->'size_bytes'),
    v_result->>'mime_type';
  if v_result->>'bucket_id' is distinct from 'media'
     or v_result->>'object_path' is distinct from v_image_path
     or pg_catalog.jsonb_typeof(v_result->'size_bytes') is distinct from 'number'
     or (v_result->>'size_bytes')::bigint is distinct from 4242
     or v_result->>'mime_type' is distinct from 'image/png'
     or v_result->>'file_name' is distinct from 'rehearsal-image.png'
     or v_result->>'message_id' is distinct from 'cc000000-0000-4000-8000-000000000201' then
    raise exception 'rule 1 failed: the ordinary lookup answered %', v_result::text;
  end if;

  ---- 2. the read rule still decides: a message older than joined_at ---------
  begin
    perform public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000202');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'rule 2 failed: a pre-join message was handed over (%)', v_state;
  end if;

  ---- 3. a deleted message ---------------------------------------------------
  begin
    perform public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000203');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'rule 3 failed: a deleted message was handed over (%)', v_state;
  end if;

  ---- 4. a message that is not in the chat asked about ----------------------
  begin
    perform public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000204');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'rule 4 failed: a message from another chat was handed over (%)', v_state;
  end if;

  ---- 5. media_metadata knows nothing: storage answers instead ---------------
  v_result := public.bot_file_lookup_internal(
    v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000206');
  raise notice 'AFTER bare metadata -> size=% mime=%',
    v_result->>'size_bytes', v_result->>'mime_type';
  if (v_result->>'size_bytes')::bigint is distinct from 5150
     or v_result->>'mime_type' is distinct from 'image/png' then
    raise exception 'rule 5 failed: the storage fallback answered %', v_result::text;
  end if;

  ---- 6. an object that is not in storage is not signed for ------------------
  begin
    perform public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000207');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'rule 6 failed: a missing object was signed for (%)', v_state;
  end if;

  ---- 7. the private bucket still works, when the path is this chat's --------
  v_result := public.bot_file_lookup_internal(
    v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000208');
  raise notice 'AFTER private bucket, this chat -> bucket=% size=%',
    v_result->>'bucket_id', v_result->>'size_bytes';
  if v_result->>'bucket_id' is distinct from 'chat-media'
     or v_result->>'object_path' is distinct from v_here_path
     or (v_result->>'size_bytes')::bigint is distinct from 313 then
    raise exception 'rule 7 failed: a chat-scoped private object was refused (%)', v_result::text;
  end if;

  ---- 8. and refuses the same bucket when the path is another chat's ---------
  begin
    perform public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000209');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception
      'rule 8 failed: the cross-chat private object is still handed over (%)', v_state;
  end if;

  ---- 9. the second spelling is read, and the message beats storage ----------
  v_result := public.bot_file_lookup_internal(
    v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000210');
  raise notice 'AFTER size spelling -> %', v_result->>'size_bytes';
  if (v_result->>'size_bytes')::bigint is distinct from 8888 then
    raise exception 'rule 9 failed: the size spelling answered %', v_result::text;
  end if;

  ---- 10. the membership gate is untouched -----------------------------------
  begin
    perform public.bot_file_lookup_internal(
      v_stranger, v_chat_a, 'cc000000-0000-4000-8000-000000000201');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'rule 10 failed: a bot that is not a member got in (%)', v_state;
  end if;

  ---- 11. the update payload carries the size, the shape and the units -------
  v_result := private.bot_message_update_payload(
    v_bot, 'cc000000-0000-4000-8000-000000000201');
  raise notice 'AFTER attachment -> byte_size=%(%) width=%(%) height=%(%)',
    v_result #>> '{message,attachment,byte_size}',
    pg_catalog.jsonb_typeof(v_result #> '{message,attachment,byte_size}'),
    v_result #>> '{message,attachment,width}',
    pg_catalog.jsonb_typeof(v_result #> '{message,attachment,width}'),
    v_result #>> '{message,attachment,height}',
    pg_catalog.jsonb_typeof(v_result #> '{message,attachment,height}');
  if pg_catalog.jsonb_typeof(v_result #> '{message,attachment,byte_size}') is distinct from 'number'
     or (v_result #>> '{message,attachment,byte_size}')::bigint is distinct from 4242
     or pg_catalog.jsonb_typeof(v_result #> '{message,attachment,width}') is distinct from 'number'
     or (v_result #>> '{message,attachment,width}')::bigint is distinct from 800
     or pg_catalog.jsonb_typeof(v_result #> '{message,attachment,height}') is distinct from 'number'
     or (v_result #>> '{message,attachment,height}')::bigint is distinct from 600 then
    raise exception 'rule 11 failed: the attachment answered %',
      (v_result #> '{message,attachment}')::text;
  end if;

  ---- 12. the duration arrives in both units, each named ---------------------
  v_result := private.bot_message_update_payload(
    v_bot, 'cc000000-0000-4000-8000-000000000205');
  raise notice 'AFTER voice -> byte_size=% duration_ms=% duration=%',
    v_result #>> '{message,attachment,byte_size}',
    v_result #>> '{message,attachment,duration_ms}',
    v_result #>> '{message,attachment,duration}';
  if (v_result #>> '{message,attachment,byte_size}')::bigint is distinct from 777
     or pg_catalog.jsonb_typeof(v_result #> '{message,attachment,duration_ms}') is distinct from 'number'
     or (v_result #>> '{message,attachment,duration_ms}')::bigint is distinct from 4200
     or pg_catalog.jsonb_typeof(v_result #> '{message,attachment,duration}') is distinct from 'number'
     or (v_result #>> '{message,attachment,duration}')::bigint is distinct from 4 then
    raise exception 'rule 12 failed: the voice attachment answered %',
      (v_result #> '{message,attachment}')::text;
  end if;

  ---- 13. the payload uses the storage fallback too --------------------------
  v_result := private.bot_message_update_payload(
    v_bot, 'cc000000-0000-4000-8000-000000000206');
  raise notice 'AFTER bare attachment -> byte_size=% mime=%',
    v_result #>> '{message,attachment,byte_size}',
    v_result #>> '{message,attachment,mime_type}';
  if (v_result #>> '{message,attachment,byte_size}')::bigint is distinct from 5150
     or v_result #>> '{message,attachment,mime_type}' is distinct from 'image/png' then
    raise exception 'rule 13 failed: the payload storage fallback answered %',
      (v_result #> '{message,attachment}')::text;
  end if;

  raise notice 'REHEARSAL: 13 rules on values passed after the change';
end
$after$;

-- ------------------------------------------------------------------------
-- The rollback file, verbatim, inside the same transaction.
-- ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bot_file_lookup_internal(p_bot_id uuid, p_chat_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if p_bot_id is null or p_chat_id is null or p_message_id is null then
    raise exception 'bot_file_input_invalid' using errcode = '22023';
  end if;
  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'read_file'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'message_id', message_row.id,
    'bucket_id', message_row.media_bucket,
    'object_path', message_row.media_path,
    'mime_type', nullif(pg_catalog.left(message_row.media_metadata->>'mime_type', 128), ''),
    'file_name', nullif(pg_catalog.left(message_row.media_metadata->>'file_name', 255), ''),
    'size_bytes', case
      when message_row.media_metadata->>'size' ~ '^[0-9]{1,12}$'
        then message_row.media_metadata->>'size'
      else null
    end
  ))
  into v_result
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.chat_id = p_chat_id
    and message_row.deleted_at is null
    and message_row.media_bucket is not null
    and message_row.media_bucket = 'chat-media'
    and message_row.media_path is not null
    and pg_catalog.octet_length(message_row.media_path) between 1 and 1024
    and private.bot_can_receive_message(p_bot_id, message_row.id);
  if v_result is null then
    raise exception 'bot_file_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end
$function$;

CREATE OR REPLACE FUNCTION private.bot_message_update_payload(p_bot_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pg_catalog.jsonb_build_object(
    'message',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', message_row.id,
      'chat_id', message_row.chat_id,
      'topic_id', message_row.topic_id,
      'reply_to_message_id', message_row.reply_to_id,
      'date', message_row.created_at,
      'type', nullif(pg_catalog.left(message_row.type, 32), ''),
      'text', case
        when message_row.content is null then null
        else nullif(pg_catalog.left(message_row.content, 4096), '')
      end,
      'reply_markup', message_row.bot_reply_markup,
      'from', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', message_row.user_id,
        'bot_id', message_row.bot_id,
        'is_bot', message_row.bot_id is not null,
        'display_name', nullif(pg_catalog.left(
          coalesce(profile.full_name, sender_bot.display_name),
          128
        ), ''),
        'username', nullif(pg_catalog.left(
          coalesce(profile.username, sender_bot.username),
          64
        ), '')
      )),
      'chat', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', chat.id,
        'type', nullif(pg_catalog.left(chat.type, 32), ''),
        'name', nullif(pg_catalog.left(chat.name, 256), '')
      )),
      'attachment', case
        when message_row.media_bucket is null or message_row.media_path is null then null
        else pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'file_id', message_row.id,
          'kind', nullif(pg_catalog.left(message_row.type, 32), ''),
          'mime_type', nullif(pg_catalog.left(
            message_row.media_metadata->>'mime_type',
            128
          ), ''),
          'file_name', nullif(pg_catalog.left(
            message_row.media_metadata->>'file_name',
            255
          ), ''),
          'byte_size', nullif(pg_catalog.left(
            message_row.media_metadata->>'size',
            32
          ), ''),
          'width', nullif(pg_catalog.left(
            message_row.media_metadata->>'width',
            16
          ), ''),
          'height', nullif(pg_catalog.left(
            message_row.media_metadata->>'height',
            16
          ), ''),
          'duration', nullif(pg_catalog.left(
            message_row.media_metadata->>'duration',
            32
          ), '')
        ))
      end
    ))
  )
  from public.messages message_row
  join public.chats chat on chat.id = message_row.chat_id
  left join public.profiles profile on profile.id = message_row.user_id
  left join public.bots sender_bot on sender_bot.id = message_row.bot_id
  where message_row.id = p_message_id
    and p_bot_id is not null;
$function$;

drop function if exists private.media_metadata_bigint(jsonb, text[]);

-- The rollback's own self-check, which raises rather than committing a
-- half-undone state. It asserts on values too: the bucket literal is back, the
-- helper is gone, and a real message's payload has lost the size again.
do $selfcheck$
declare
  v_owner text;
  v_body text;
  v_message uuid;
  v_payload jsonb;
begin
  v_body := pg_catalog.pg_get_functiondef(
    'public.bot_file_lookup_internal(uuid,uuid,uuid)'::regprocedure);
  if pg_catalog.strpos(v_body, 'media_bucket = ''chat-media''') = 0 then
    raise exception 'rollback selfcheck failed: the original bucket predicate is not back';
  end if;
  if pg_catalog.strpos(v_body, 'storage.objects') <> 0
     or pg_catalog.strpos(v_body, 'media_metadata_bigint') <> 0 then
    raise exception 'rollback selfcheck failed: the lookup still carries the new rule';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'media_metadata_bigint'
  ) then
    raise exception 'rollback selfcheck failed: the helper is still there';
  end if;

  select pg_catalog.pg_get_userbyid(proowner) into v_owner
  from pg_catalog.pg_proc
  where oid = 'private.bot_message_update_payload(uuid,uuid)'::regprocedure;
  if v_owner <> 'postgres' then
    raise exception 'rollback selfcheck failed: the payload builder is owned by %', v_owner;
  end if;

  select message_row.id into v_message
  from public.messages message_row
  where message_row.media_path is not null
    and message_row.deleted_at is null
    and message_row.media_metadata ? 'size_bytes'
  order by message_row.created_at desc
  limit 1;
  if v_message is not null then
    v_payload := private.bot_message_update_payload(pg_catalog.gen_random_uuid(), v_message);
    if v_payload #> '{message,attachment,byte_size}' is not null then
      raise exception 'rollback selfcheck failed: byte_size survived the rollback';
    end if;
  end if;
end
$selfcheck$;

do $undone$
declare
  v_bot constant uuid := 'cc000000-0000-4000-8000-000000000001';
  v_chat_a constant uuid := 'cc000000-0000-4000-8000-00000000000a';
  v_state text;
  v_result jsonb;
begin
  begin
    perform public.bot_file_lookup_internal(
      v_bot, v_chat_a, 'cc000000-0000-4000-8000-000000000201');
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
  end;
  raise notice 'ROLLED BACK getFile on the ordinary image -> %', v_state;
  if v_state <> 'P0002' then
    raise exception 'the rollback did not restore the BEFORE state (%)', v_state;
  end if;

  v_result := private.bot_message_update_payload(
    v_bot, 'cc000000-0000-4000-8000-000000000201');
  if v_result #> '{message,attachment,byte_size}' is not null
     or pg_catalog.jsonb_typeof(v_result #> '{message,attachment,width}') <> 'string' then
    raise exception 'the rollback did not restore the payload shape (%)',
      (v_result #> '{message,attachment}')::text;
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'media_metadata_bigint'
  ) then
    raise exception 'the rollback left the helper behind';
  end if;

  raise notice 'REHEARSAL: the rollback restored the BEFORE state';
end
$undone$;

rollback;
