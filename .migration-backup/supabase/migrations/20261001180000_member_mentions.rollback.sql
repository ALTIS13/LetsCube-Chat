-- D-331 compatibility rollback: disable entity-producing clients before apply.
-- Intentionally retains the NOT NULL/defaulted column and historical metadata.
-- Reapply 20261001180000_member_mentions.sql to restore canonicalization/privacy.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DROP POLICY "message notification source remains readable" ON public.notifications;
DROP TRIGGER trg_member_mentions_note_update ON public.messages;
DROP TRIGGER trg_member_mentions_validate ON public.messages;
DO $patch$
DECLARE ddl text := pg_get_functiondef('private.scrub_deleted_message_notifications(uuid[])'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$pg_catalog.jsonb_build_object('preview', null, 'deleted', true, 'mentioned', false)$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:scrub_deleted_message_notifications:0'; END IF;
  ddl := replace(ddl,$old0$pg_catalog.jsonb_build_object('preview', null, 'deleted', true, 'mentioned', false)$old0$,$new0$pg_catalog.jsonb_build_object('preview', null, 'deleted', true)$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.deleted_message_keeps_nothing()'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$  new.pinned := false;
  new.mention_entities := '{"version":1,"revision":null,"items":[]}'::jsonb;$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:deleted_message_keeps_nothing:0'; END IF;
  ddl := replace(ddl,$old0$  new.pinned := false;
  new.mention_entities := '{"version":1,"revision":null,"items":[]}'::jsonb;$old0$,$new0$  new.pinned := false;$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.enqueue_bot_message_updates_after_update()'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$    new.bot_reply_markup,
    new.mention_entities
$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_bot_message_updates_after_update:0'; END IF;
  ddl := replace(ddl,$old0$    new.bot_reply_markup,
    new.mention_entities
$old0$,$new0$    new.bot_reply_markup
$new0$);
  IF strpos(ddl,$old1$    old.bot_reply_markup,
    old.mention_entities
$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_bot_message_updates_after_update:1'; END IF;
  ddl := replace(ddl,$old1$    old.bot_reply_markup,
    old.mention_entities
$old1$,$new1$    old.bot_reply_markup
$new1$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('private.bot_can_receive_message(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$          and (
            private.message_mentions_targeted(message_row.mention_entities, 'bot', p_bot_id)
            or pg_catalog.lower$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:bot_can_receive_message:0'; END IF;
  ddl := replace(ddl,$old0$          and (
            private.message_mentions_targeted(message_row.mention_entities, 'bot', p_bot_id)
            or pg_catalog.lower$old0$,$new0$          and (
            pg_catalog.lower$new0$);
  IF strpos(ddl,$old1$    where message_row.id = p_message_id
      and message_row.deleted_at is null$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:bot_can_receive_message:1'; END IF;
  ddl := replace(ddl,$old1$    where message_row.id = p_message_id
      and message_row.deleted_at is null$old1$,$new1$    where message_row.id = p_message_id$new1$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.album_push_recheck(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$      and private.message_notification_visible_to(m.id, v_outbox.user_id)
      and cm.hidden_at is null$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:album_push_recheck:0'; END IF;
  ddl := replace(ddl,$old0$      and private.message_notification_visible_to(m.id, v_outbox.user_id)
      and cm.hidden_at is null$old0$,$new0$      and cm.hidden_at is null$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.native_push_outbox_delivery_recheck(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$  if not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_native_push_outbox
    set sent_at = v_now, last_error = 'suppressed:not_eligible',
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  update public.notifications_native_push_outbox
  set claimed_until$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:0'; END IF;
  ddl := replace(ddl,$old0$  if not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_native_push_outbox
    set sent_at = v_now, last_error = 'suppressed:not_eligible',
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  update public.notifications_native_push_outbox
  set claimed_until$old0$,$new0$  update public.notifications_native_push_outbox
  set claimed_until$new0$);
  IF strpos(ddl,$old1$into v_claimed_until, v_read_at, v_user_id, v_kind, v_payload, v_device_active$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:1'; END IF;
  ddl := replace(ddl,$old1$into v_claimed_until, v_read_at, v_user_id, v_kind, v_payload, v_device_active$old1$,$new1$into v_claimed_until, v_read_at, v_device_active$new1$);
  IF strpos(ddl,$old2$  select o.claimed_until, n.read_at, o.user_id, n.kind, n.payload,$old2$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:2'; END IF;
  ddl := replace(ddl,$old2$  select o.claimed_until, n.read_at, o.user_id, n.kind, n.payload,$old2$,$new2$  select o.claimed_until, n.read_at,$new2$);
  IF strpos(ddl,$old3$  v_device_active boolean;
  v_user_id uuid;
  v_kind text;
  v_payload jsonb;$old3$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:native_push_outbox_delivery_recheck:3'; END IF;
  ddl := replace(ddl,$old3$  v_device_active boolean;
  v_user_id uuid;
  v_kind text;
  v_payload jsonb;$old3$,$new3$  v_device_active boolean;$new3$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.push_outbox_delivery_recheck(uuid, uuid)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$  if v_note_owner is distinct from v_user_id
      or not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_push_outbox
    set suppressed_at = v_now, suppression_reason = NULL,
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  if exists (
    select 1
    from public.push_foreground_sessions$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:push_outbox_delivery_recheck:0'; END IF;
  ddl := replace(ddl,$old0$  if v_note_owner is distinct from v_user_id
      or not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_push_outbox
    set suppressed_at = v_now, suppression_reason = NULL,
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  if exists (
    select 1
    from public.push_foreground_sessions$old0$,$new0$  if exists (
    select 1
    from public.push_foreground_sessions$new0$);
  IF strpos(ddl,$old1$select o.user_id, n.read_at, s.is_active, s.user_id, n.user_id, n.kind, n.payload
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id, v_note_owner, v_kind, v_payload$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:push_outbox_delivery_recheck:1'; END IF;
  ddl := replace(ddl,$old1$select o.user_id, n.read_at, s.is_active, s.user_id, n.user_id, n.kind, n.payload
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id, v_note_owner, v_kind, v_payload$old1$,$new1$select o.user_id, n.read_at, s.is_active, s.user_id
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id$new1$);
  IF strpos(ddl,$old2$  v_subscription_user_id uuid;
  v_note_owner uuid;
  v_kind text;
  v_payload jsonb;$old2$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:push_outbox_delivery_recheck:2'; END IF;
  ddl := replace(ddl,$old2$  v_subscription_user_id uuid;
  v_note_owner uuid;
  v_kind text;
  v_payload jsonb;$old2$,$new2$  v_subscription_user_id uuid;$new2$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public._notification_push_allowed(uuid, text, jsonb)'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$begin
  if p_kind = 'message' then
    if coalesce(p_payload->>'message_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if not private.message_notification_visible_to((p_payload->>'message_id')::uuid, p_user_id)
       or not exists (select 1 from public.messages m where m.id = (p_payload->>'message_id')::uuid
           and m.chat_id::text = p_payload->>'chat_id') then
      return false;
    end if;
  end if;
  select * into v_prefs$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:_notification_push_allowed:0'; END IF;
  ddl := replace(ddl,$old0$begin
  if p_kind = 'message' then
    if coalesce(p_payload->>'message_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if not private.message_notification_visible_to((p_payload->>'message_id')::uuid, p_user_id)
       or not exists (select 1 from public.messages m where m.id = (p_payload->>'message_id')::uuid
           and m.chat_id::text = p_payload->>'chat_id') then
      return false;
    end if;
  end if;
  select * into v_prefs$old0$,$new0$begin
  select * into v_prefs$new0$);
  EXECUTE ddl;
END
$patch$;

DO $patch$
DECLARE ddl text := pg_get_functiondef('public.enqueue_message_notifications()'::regprocedure);
BEGIN
  IF strpos(ddl,$old0$where member_row.chat_id = new.chat_id
    and private.message_notification_visible_to(new.id, member_row.user_id)
$old0$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_message_notifications:0'; END IF;
  ddl := replace(ddl,$old0$where member_row.chat_id = new.chat_id
    and private.message_notification_visible_to(new.id, member_row.user_id)
$old0$,$new0$where member_row.chat_id = new.chat_id
$new0$);
  IF strpos(ddl,$old1$'group_tag', 'message:chat:' || new.chat_id::text,
      'mentioned', private.message_mentions_targeted(new.mention_entities, 'user', member_row.user_id)$old1$)=0 THEN RAISE EXCEPTION 'mentions_patch_anchor:enqueue_message_notifications:1'; END IF;
  ddl := replace(ddl,$old1$'group_tag', 'message:chat:' || new.chat_id::text,
      'mentioned', private.message_mentions_targeted(new.mention_entities, 'user', member_row.user_id)$old1$,$new1$'group_tag', 'message:chat:' || new.chat_id::text$new1$);
  EXECUTE ddl;
END
$patch$;

ALTER FUNCTION public._notification_push_allowed(uuid,text,jsonb) SECURITY INVOKER RESET ALL;
DROP TRIGGER trg_enqueue_bot_message_updates_after_update ON public.messages;
CREATE TRIGGER trg_enqueue_bot_message_updates_after_update AFTER UPDATE OF content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.enqueue_bot_message_updates_after_update();
DROP FUNCTION public.message_notification_visible(uuid);
DROP FUNCTION private.update_message_mention_notification();
DROP FUNCTION private.message_notification_visible_to(uuid,uuid);
DROP FUNCTION private.normalize_message_mentions();
DROP FUNCTION private.mention_historical_item(text,text,jsonb,jsonb);
DROP FUNCTION private.message_mentions_targeted(jsonb,text,uuid);
DROP FUNCTION private.validate_message_mentions(text,jsonb);
DROP FUNCTION private.mention_context_masked(text,integer,integer);
DROP FUNCTION private.mention_label_valid(text);
DROP FUNCTION private.mention_unicode_class(integer,text);
DROP FUNCTION private.mention_utf16_slice(text,integer,integer);
DROP FUNCTION private.mention_utf16_length(text);
DO $rollback_check$
DECLARE p pg_proc; signature text;
BEGIN
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.enqueue_message_notifications()'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'e8e6e3d6a9e511c072b5b300502a338154336d472b2697a0d3bd61b05e82a48e' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.enqueue_message_notifications'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public._notification_push_allowed(uuid, text, jsonb)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '53019ef87d58e4a1b0318e17dc621b72f72474a1df301932f81c8076eb247229' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> false OR p.provolatile <> 's'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM NULL::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public._notification_push_allowed'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public._notification_push_payload(text, jsonb)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '607ff23b1810e422b10728f512e7d3f8a8c69ecb56e2679a03a226e469dad26e' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> false OR p.provolatile <> 'i'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public._notification_push_payload'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.push_outbox_delivery_recheck(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '0a445cad6bcf7790309ca9d6b5e62549646a875e01ce91759bb1e1fac1d65a81' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=public, pg_temp"]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.push_outbox_delivery_recheck'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.native_push_outbox_delivery_recheck(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '8432fe8214d6552b6c169e868d97085dcf33258c6a8050c5138e6501b539a017' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.native_push_outbox_delivery_recheck'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.album_push_recheck(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '75303ec9a867c71aed3b1f4d20f61e5ac8beac708affceaa7cdace4b7997b10a' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.album_push_recheck'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.bot_can_receive_message(uuid, uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '5b9783f4ac32b79bda916f00fdf36513d40de6e1e0926b71c35589b5aab6dd7b' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 's'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.bot_can_receive_message'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.enqueue_bot_message_updates_after_update()'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '157a84e5e03d81eea34db30b34f2e6cba13ab06329ecfb08ed115cd29e4f9a4b' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.enqueue_bot_message_updates_after_update'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.deleted_message_keeps_nothing()'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'e976c4264c2487355e45e514236ec490e8ce68f077e56274aadcf3854ad468a9' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.deleted_message_keeps_nothing'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.scrub_deleted_message_notifications(uuid[])'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '9f0fcc7406326f109039488cafccd0ea47d64a86a43824a1057c3ff7f09b659a' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.scrub_deleted_message_notifications'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.bot_update_still_visible(uuid, text, jsonb)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '7c36b872154bb7f219483b39e4d7fa44b51e937c2699382d7fe2d2927ed305f6' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:private.bot_update_still_visible'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.bot_delivery_prepare_internal(bigint, uuid, bigint)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> '6da69e1ac4601cea77e88d11d5c41d6dfca38bd4982f38a950f2f0e66ff646e1' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.bot_delivery_prepare_internal'; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.bot_updates_poll_internal(uuid, bigint, integer, text[], uuid)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'e8bf25e59bb8c5eaec2d4b1c9f3514a0011d86d6a98e29a27896de8cf22f5166' OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef <> true OR p.provolatile <> 'v'
     OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
     OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN RAISE EXCEPTION 'mentions_prestate_drift:public.bot_updates_poll_internal'; END IF;
  FOREACH signature IN ARRAY ARRAY['private.mention_utf16_length(text)','private.mention_utf16_slice(text,integer,integer)','private.mention_context_masked(text,integer,integer)','private.mention_unicode_class(integer,text)','private.mention_label_valid(text)','private.mention_historical_item(text,text,jsonb,jsonb)','private.validate_message_mentions(text,jsonb)','private.message_mentions_targeted(jsonb,text,uuid)','private.normalize_message_mentions()','private.message_notification_visible_to(uuid,uuid)','private.update_message_mention_notification()','public.message_notification_visible(uuid)'] LOOP
    IF to_regprocedure(signature) IS NOT NULL THEN RAISE EXCEPTION 'mentions_rollback_incomplete'; END IF;
  END LOOP;
  IF to_regprocedure('private.normalize_message_mentions()') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass AND polname='message notification source remains readable')
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgname IN ('trg_member_mentions_validate','trg_member_mentions_note_update'))
     OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.messages'::regclass AND attname='mention_entities' AND atttypid='jsonb'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid='public.messages'::regclass AND a.attname='mention_entities' AND NOT a.attisdropped
         AND pg_get_expr(d.adbin,d.adrelid)='''{"items": [], "version": 1, "revision": null}''::jsonb')
     OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass
       AND tgname='trg_enqueue_bot_message_updates_after_update' AND tgenabled='O' AND tgtype=17
       AND pg_get_triggerdef(oid) NOT LIKE '%mention_entities%') THEN
    RAISE EXCEPTION 'mentions_rollback_incomplete';
  END IF;
END
$rollback_check$;
COMMIT;
