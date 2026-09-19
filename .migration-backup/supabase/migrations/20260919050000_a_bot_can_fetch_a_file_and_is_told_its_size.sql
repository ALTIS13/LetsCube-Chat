/**
 * A bot can fetch the file it was sent, and is told how big it is.
 *
 * D-249 and D-250 of `docs/INTERFACE_DEFECT_REGISTER.md`. Both were found on
 * 2026-09-19 while D-248 was being measured, and both were left out of that
 * migration on purpose: each turns an externally visible method from «always
 * wrong» into «right», which deserves its own review.
 *
 * Every number below was read off production read-only before a line of this
 * file was written, and the two function bodies this replaces were compared
 * against `20260831100000_bot_platform_foundation.sql` first: both, and
 * `private.bot_can_receive_message` beside them, are byte-identical to the
 * recorded file once whitespace is normalised, so the live database is the one
 * the repository describes.
 *
 * -- D-249: getFile looked in a bucket the product does not use --------------
 *
 * `bot_file_lookup_internal` required `media_bucket = 'chat-media'`. Measured:
 * the `chat-media` bucket holds 0 objects, all 774 objects are in `media`, and
 * all 294 message-media rows carry `media_bucket = 'media'`. So the method
 * raised `bot_file_not_found` (P0002, HTTP 404) for every file that exists,
 * and has done since the platform shipped.
 *
 * The fix is NOT another bucket name. A literal was the wrong shape of rule:
 * nothing constrains `messages.media_bucket` at write time — the
 * `guard_message_media_path` trigger checks the PATH
 * (`private.message_media_path_allowed`: the first segment must be the
 * author's own id) and never the bucket — so the old predicate's safety was
 * accidental rather than designed. It was also accidentally unsafe in one
 * direction: a forwarded message carries the source's bucket and path, so a
 * `chat-media` path belonging to chat A, forwarded into chat B, satisfied
 * `media_bucket = 'chat-media'` and would have handed a bot in B a signed URL
 * to A's private object.
 *
 * What `getFile` actually needs is that the bytes it mints a capability for
 * are bytes the message's own audience can already reach. That is now the
 * rule, and it is derived rather than named:
 *
 *   1. the bot may read the message — `private.bot_can_receive_message`,
 *      unchanged, which folds in `bots.state = 'active'`, `removed_at is null`,
 *      the `privacy_mode` gate and the `created_at >= joined_at` restriction
 *      that is the one that matters; and the message is in the chat asked
 *      about, is not deleted, and has media;
 *   2. the object exists — `storage.objects` has a row at
 *      `(media_bucket, media_path)`. Measured: 289 of the 294 rows match, and
 *      all 5 that do not belong to deleted messages, so this refuses nothing
 *      that works today, and refuses a signed URL for bytes that are gone;
 *   3. the bytes are already reachable by that chat, which is true exactly when
 *      the bucket is PUBLIC (`storage.buckets.public` — a signed URL over a
 *      public bucket grants nothing a public URL does not already grant), or
 *      the path is scoped to THIS chat by the platform's own chat-media rule
 *      (`public._kub_chat_media_chat_id`, the derivation
 *      `_kub_can_access_chat_media_path` uses to admit a human member).
 *
 * No bucket name appears anywhere in the new body. Today that admits `media`
 * (public) and would admit `chat-media` the day the product starts using it —
 * with the extra correctness the literal lacked, because a `chat-media` path
 * belonging to a different chat is now refused. For a bucket nobody has
 * created yet it fails closed: a private bucket would need an object whose
 * first path segment is this chat's id, and `guard_message_media_path` forces
 * a person's path to start with their own user id instead.
 *
 * `artifacts/api-server/src/bot/repository.ts` re-asserted the same literal in
 * `fileMetadata`, so this migration alone would turn the 404 into a 500. That
 * half ships with it, and is a SHAPE check (a bounded bucket id with no path
 * separator) rather than a second copy of the policy: the database decides
 * which object a bot may reach, and the gateway decides nothing.
 *
 * -- D-250: every file's size and duration were reported as unknown ---------
 *
 * The application writes `media_metadata.size_bytes` and
 * `media_metadata.duration_ms`; the two bot-facing readers asked for `size`
 * and `duration`. Measured over the 294 media messages: `size_bytes` present
 * 69 times, `size` 0 times; `duration_ms` present 6 times, `duration` 0 times.
 * So `attachment.byte_size` and `attachment.duration` were null in every
 * update, and `bot_file_lookup_internal`'s `size_bytes` likewise.
 *
 * The translation is in the readers, not a rename in the application: 294 rows
 * and every client writer use the app's vocabulary, which the
 * `messages_media_metadata_shape` CHECK already pins (`size_bytes`,
 * `duration_ms`, `width` and `height` must be a JSON number or null). The
 * `size` spelling is not dead either — `bot_send_message_internal` writes it,
 * and since D-248 writes both — so the reader takes `size_bytes` first and
 * `size` second. `private.media_metadata_bigint` is that decision, in one
 * place, used by both readers.
 *
 * `duration` is deliberately NOT read as a fallback. Nothing writes it, and
 * `bot_send_message_internal`'s metadata whitelist lets a bot's own upload
 * carry a key of that name with no unit stated; reading it as milliseconds
 * would invent a number rather than find one.
 *
 * The 225 rows that carry neither spelling are answered by the storage layer,
 * which knows: `storage.objects.metadata` carries `size` and `mimetype` for
 * all 774 objects. Where both are known the two sizes agree in 65 of 65 cases,
 * so it is the same fact, not a second one. Reading it lifts `byte_size` from
 * 69 of 294 to 289, and `mime_type` — which the register raises under D-250 as
 * the same problem from the other side, 220 of 294 rows carrying none — from
 * 73 to 289. Duration has no such fallback and stays at 6: honest, not filled
 * in.
 *
 * -- Numbers reach the bot as numbers ---------------------------------------
 *
 * The attachment block stringified everything (`left(metadata->>'width', 16)`),
 * so `width` arrived as "1280". It is now a JSON number, along with
 * `byte_size`, `height` and the duration. This is safe to change today and
 * will not be tomorrow: measured on production, no attachment has ever been
 * delivered to any bot — 2 updates in total, 0 of them carrying one, 0 enabled
 * webhooks, 0 delivery attempts — so there is no consumer to break. The first
 * consumer being written, `artifacts/pocketflow`, reads
 * `asNumber(attachment.byte_size)`, `asNumber(attachment.width)` and
 * `asNumber(attachment.height)`.
 *
 * That same consumer reads `durationSeconds: asNumber(attachment.duration)`
 * and prints it as seconds. Filling a unitless `duration` with the stored
 * milliseconds would therefore have been wrong by 1000x on its first use — the
 * silent mis-read the name invites, and the one a Telegram-shaped bot will
 * make, since Telegram's `duration` is an integer number of seconds. So the
 * attachment now carries both units, each named: `duration` in seconds
 * (rounded, as Telegram does) and `duration_ms` as the stored fact.
 *
 * -- One migration, not two -------------------------------------------------
 *
 * The two defects share a function body and a join: `bot_file_lookup_internal`
 * needs `storage.objects` for D-249's existence rule and for D-250's size and
 * mime fallback. Splitting them would mean replacing that function twice, with
 * the second replacement depending on the shape of the first, and a rollback
 * that has to be undone in order. They are applied together.
 *
 * -- Ownership, which was measured rather than assumed ----------------------
 *
 * `public.bot_file_lookup_internal` and `private.bot_message_update_payload`
 * are owned by postgres and are SECURITY DEFINER, so they run as postgres:
 * which has SELECT on `storage.objects` and `storage.buckets`, holds BYPASSRLS,
 * and may execute `public._kub_chat_media_chat_id` and
 * `private.bot_can_receive_message`. All four were checked rather than assumed
 * — postgres notably may NOT execute `private.message_media_path_allowed`,
 * whose caller `private.guard_message_media_path` is owned by supabase_admin
 * instead, which is why that pair works. `CREATE OR REPLACE` keeps an existing
 * function's owner and ACL; the self-check proves it did.
 *
 * The new helper is created in schema `private`, which only postgres may use
 * (`private` is `postgres=UC/postgres`; `service_role` has no USAGE), then
 * handed to postgres and closed to PUBLIC so its ACL matches its neighbours.
 * Apply as supabase_admin: it owns neither function but may replace both and
 * may hand the new helper over, and postgres cannot grant itself CREATE where
 * it already has it but cannot alter what supabase_admin owns.
 *
 * -- Rollback ---------------------------------------------------------------
 *
 * `20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.rollback.sql`
 * restores the two bodies exactly as production held them before this ran and
 * drops the helper, in that order. It was executed inside the production
 * rehearsal, after the forward change, and the BEFORE behaviour came back.
 */

begin;

set local statement_timeout = '120s';

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

commit;
