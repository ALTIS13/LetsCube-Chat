/**
 * Rollback for 20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.sql.
 *
 * The two function bodies below are not a reconstruction: they are what
 * `pg_get_functiondef` returned from production immediately before the
 * migration ran, kept byte for byte. `CREATE OR REPLACE` keeps an existing
 * function's owner and ACL, so both go back to postgres-owned SECURITY DEFINER
 * with the grants they had.
 *
 * Order matters. The two readers are restored FIRST and the helper dropped
 * after, because while either body still names `private.media_metadata_bigint`
 * the drop would fail on the dependency — and a rollback that fails halfway is
 * worse than the state it was called to leave.
 *
 * Applying this returns `getFile` to answering 404 for every file that exists
 * and the update payload to reporting every size and duration as unknown. It
 * is the right thing to run if the widened lookup turns out to hand a bot
 * something it should not have; it is not a fix for the gateway being out of
 * step, which is a deploy rather than a migration.
 *
 * Run as supabase_admin, as the migration was. Proved by running it inside the
 * production rehearsal, after the forward change, where it restored the BEFORE
 * behaviour on the same fixture values.
 */

begin;

set local statement_timeout = '120s';

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

commit;
