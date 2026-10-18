-- Native preview point lookup only; preserve every current authorization predicate.
-- Old body MD5: b5661f9e78a29ed856f91c702bd118e4.
-- New body MD5: 52e6ea87dedfafe9fbe99f5cc14ee6c6.
-- Coordinator owns fresh verified backup, actual PG17 rehearsal and production apply.
-- Exact narrow rollback (also safe before apply); no ACL, RLS or runtime changes:
-- BEGIN;
-- SET LOCAL lock_timeout='5s';
-- SET LOCAL statement_timeout='60s';
-- SET LOCAL ROLE postgres;
-- DO $rollback$
-- DECLARE before_metadata jsonb; after_metadata jsonb; body_hash text;
-- BEGIN
--   SELECT to_jsonb(p)-'prosrc',md5(p.prosrc) INTO before_metadata,body_hash
--     FROM pg_proc p WHERE p.oid='public.native_message_notification_preview(uuid,uuid)'::regprocedure;
--   IF current_user<>'postgres' OR body_hash NOT IN
--     ('b5661f9e78a29ed856f91c702bd118e4','52e6ea87dedfafe9fbe99f5cc14ee6c6')
--   THEN RAISE EXCEPTION 'native_preview_point_rollback_drift'; END IF;
--   EXECUTE $prior$
-- CREATE OR REPLACE FUNCTION public.native_message_notification_preview(p_device_id uuid, p_notification_id uuid)
--  RETURNS TABLE(preview_v smallint, recipient_id uuid, session_id uuid, device_id uuid, notification_id uuid, chat_id uuid, message_id uuid, preview_level text, sender_name text, title text, body text, expires_at timestamp with time zone)
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'pg_catalog'
-- AS $function$
-- declare
--   v_claims jsonb := auth.jwt();
--   v_recipient uuid;
--   v_session uuid;
--   v_now timestamptz := statement_timestamp();
-- begin
--   if p_device_id is null or p_notification_id is null then return; end if;
--   v_recipient := public.native_message_preview_recipient();
--   if v_recipient is null then return; end if;
--   v_session := (v_claims->>'session_id')::uuid;
--
--   return query
--   select 1::smallint, v_recipient, v_session, d.id, n.id, m.chat_id, m.id,
--     pref.preview_level, label.name, label.name,
--     case when pref.preview_level = 'sender' then 'Новое сообщение'
--       else coalesce(nullif(left(btrim(regexp_replace(
--         case m.type
--           when 'text' then m.content
--           when 'image' then 'Фото'
--           when 'video' then 'Видео'
--           when 'audio' then 'Голосовое сообщение'
--           when 'voice' then 'Голосовое сообщение'
--           when 'file' then 'Файл'
--           else 'Новое сообщение'
--         end, '[[:cntrl:][:space:]]+', ' ', 'g')),240),''),'Новое сообщение')
--     end,
--     v_now + interval '15 seconds'
--   from auth.sessions s
--   join public.user_push_devices d on d.session_id = s.id and d.user_id = s.user_id
--   join public.notification_preview_preferences pref on pref.user_id = s.user_id
--   join public.notifications n on n.user_id = s.user_id
--   join public.messages m on n.payload->>'message_id' = m.id::text
--     and n.payload->>'chat_id' = m.chat_id::text
--   left join public.profiles profile on profile.id = m.user_id and m.bot_id is null
--   left join public.bots bot on bot.id = m.bot_id and m.user_id is null
--   cross join lateral (select left(btrim(regexp_replace(
--     coalesce(profile.full_name,bot.display_name,''),'[[:cntrl:][:space:]]+',' ','g')),96) as name) label
--   where s.id = v_session and s.user_id = v_recipient
--     and s.created_at <= v_now and (s.not_after is null or s.not_after > v_now)
--     and d.id = p_device_id and d.enabled is true and d.revoked_at is null
--     and d.platform = 'android' and d.provider = 'fcm'
--     and pref.preview_level in ('sender','message')
--     and n.id = p_notification_id and n.kind = 'message' and n.read_at is null
--     AND private.notification_topic_alert_allowed(n.id)
--     and n.created_at >= s.created_at and n.created_at <= v_now
--     and label.name <> ''
--     and (
--       exists (select 1 from public.notifications_native_push_outbox o
--         where o.notification_id = n.id and o.device_id = d.id and o.user_id = v_recipient)
--       or exists (select 1 from public.album_push_members member
--         join public.album_push_groups album on album.id = member.group_id
--         join public.notifications_album_push_outbox delivery on delivery.group_id = album.id
--         where member.notification_id = n.id and member.message_id = m.id
--           and album.user_id = v_recipient and album.chat_id = m.chat_id
--           and ((album.sender_kind = 'user' and album.sender_id = m.user_id and m.bot_id is null)
--             or (album.sender_kind = 'bot' and album.sender_id = m.bot_id and m.user_id is null))
--           and delivery.device_id = d.id and delivery.subscription_id is null
--           and delivery.suppressed_at is null)
--     )
--     and private.message_notification_visible_to(m.id,v_recipient)
--     -- Never reuse the outbox's old title/body/sender/mention flags for consent.
--     and public._notification_push_allowed(v_recipient,'message',jsonb_build_object(
--       'message_id',m.id,'chat_id',m.chat_id,'sender_id',m.user_id));
-- end
-- $function$
-- $prior$;
--   SELECT to_jsonb(p)-'prosrc',md5(p.prosrc) INTO after_metadata,body_hash
--     FROM pg_proc p WHERE p.oid='public.native_message_notification_preview(uuid,uuid)'::regprocedure;
--   IF after_metadata IS DISTINCT FROM before_metadata OR body_hash<>'b5661f9e78a29ed856f91c702bd118e4'
--   THEN RAISE EXCEPTION 'native_preview_point_rollback_failed'; END IF;
-- END $rollback$;
-- COMMIT;
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL ROLE postgres;

DO $point_lookup$
DECLARE
  target oid:=to_regprocedure('public.native_message_notification_preview(uuid,uuid)');
  old_body text;
  ddl text;
  before_metadata jsonb;
  after_metadata jsonb;
  old_join text:=$old$join public.messages m on n.payload->>'message_id' = m.id::text$old$;
  new_join text:=$new$join public.messages m on m.id = CASE
      WHEN n.payload->>'message_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (n.payload->>'message_id')::uuid
      ELSE NULL::uuid END$new$;
  metadata_sql text:=$snapshot$
    SELECT jsonb_build_object(
      'function',to_jsonb(p)-'prosrc',
      'roles',(SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolbypassrls,rolinherit) ORDER BY oid)
        FROM pg_roles WHERE rolname IN ('postgres','authenticated','anon','service_role')),
      'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
        FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')),
      'policies',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_policy k
        JOIN pg_class c ON c.oid=k.polrelid WHERE c.relnamespace='public'::regnamespace),
      'topic',(SELECT enabled FROM private.topic_notification_runtime WHERE singleton),
      'web',(SELECT enabled FROM private.web_message_preview_runtime WHERE singleton))
    FROM pg_proc p WHERE p.oid='public.native_message_notification_preview(uuid,uuid)'::regprocedure
  $snapshot$;
BEGIN
  IF current_user<>'postgres' OR target IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=target
      AND md5(p.prosrc)='b5661f9e78a29ed856f91c702bd118e4'
      AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s' AND l.lanname='plpgsql'
      AND p.proconfig=ARRAY['search_path=pg_catalog']
      AND p.proacl=ARRAY['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
      AND pg_get_function_result(p.oid)='TABLE(preview_v smallint, recipient_id uuid, session_id uuid, device_id uuid, notification_id uuid, chat_id uuid, message_id uuid, preview_level text, sender_name text, title text, body text, expires_at timestamp with time zone)')
    OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND NOT relrowsecurity)
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('authenticated','anon') AND (rolsuper OR rolbypassrls))
  THEN RAISE EXCEPTION 'native_preview_point_prestate_drift'; END IF;
  IF NOT has_function_privilege('authenticated',target,'EXECUTE')
    OR has_function_privilege('anon',target,'EXECUTE')
    OR has_function_privilege('service_role',target,'EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=target AND a.grantee=0 AND a.privilege_type='EXECUTE')
  THEN RAISE EXCEPTION 'native_preview_point_acl_drift'; END IF;
  EXECUTE metadata_sql INTO before_metadata;
  IF jsonb_array_length(before_metadata->'roles')<>4
    OR before_metadata->>'topic' IS NULL OR before_metadata->>'web' IS NULL
  THEN RAISE EXCEPTION 'native_preview_point_prestate_drift'; END IF;
  SELECT prosrc,pg_get_functiondef(oid) INTO old_body,ddl FROM pg_proc WHERE oid=target;
  IF array_length(string_to_array(old_body,old_join),1)<>2
  THEN RAISE EXCEPTION 'native_preview_point_anchor_drift'; END IF;

  EXECUTE replace(ddl,old_join,new_join);

  EXECUTE metadata_sql INTO after_metadata;
  IF after_metadata IS DISTINCT FROM before_metadata
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target
      AND prosrc=replace(old_body,old_join,new_join) AND md5(prosrc)='52e6ea87dedfafe9fbe99f5cc14ee6c6')
  THEN RAISE EXCEPTION 'native_preview_point_selfcheck_failed' USING DETAIL=format('metadata_preserved=%s, body_md5=%s, expected_md5=%s',
    after_metadata IS NOT DISTINCT FROM before_metadata,(SELECT md5(prosrc) FROM pg_proc WHERE oid=target),
    md5(replace(old_body,old_join,new_join))); END IF;
END $point_lookup$;
COMMIT;
