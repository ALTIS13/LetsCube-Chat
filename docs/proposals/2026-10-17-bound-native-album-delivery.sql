-- DRAFT ONLY. Apply AFTER Task2 -> boundSingle -> Task3, never standalone.
-- Before canonical apply: verified fresh backup/restore rehearsal, review and a
-- byte-identical migration mirror. This file does not authorize production SQL.
-- Native v1 fields: lower id, lower user_id, platform, provider, token,
-- app_version, lower session_id. UTF8 octet-length:value framing; SQL NULL in
-- the last two fields is -1: (not the empty-string 0:). Web keeps its five-field v1.
-- RPC arguments contain only target ID + fingerprint, never provider descriptors.
-- Rollback: stop these dispatchers; retain these additive RPCs and old ABIs,
-- Task3 enforcement, child-disabled data and terminal markers. Freeze topic
-- runtime per Task3 rollback. Do not redeploy an unbound sender or erase markers.
-- Locks protect the DB check, not the subsequent network request. A replacement
-- after transaction commit/provider acceptance cannot be recalled by this patch.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bound-native-album',0))
    OR to_regprocedure('public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)') IS NOT NULL
    OR to_regprocedure('public.album_push_recheck_bound(uuid,uuid,uuid,text)') IS NOT NULL
    OR to_regprocedure('private.native_push_descriptor_fingerprint(public.user_push_devices)') IS NOT NULL
    OR to_regprocedure('private.topic_alert_lock(uuid,uuid)') IS NULL
    OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.user_push_devices'::regclass,
      'public.push_subscriptions'::regclass,'public.notifications_native_push_outbox'::regclass,
      'public.notifications_album_push_outbox'::regclass) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'bound_native_album_prestate_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.native_push_outbox_delivery_recheck(uuid,uuid)','6ebe9a9d5eff45b2f9c8b6059547272b8f63e2e4ce1ce60753adecb30a929f28'),
    ('public.album_push_recheck(uuid,uuid)','30042224019c97d630f1f9f83e9159095b83f92bb48d6b35e1a125b350d3d66e')
  ) p(signature,hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid=to_regprocedure(r.signature) AND p.prosecdef AND o.rolname='postgres'
        AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog']
        AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=r.hash
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))
            OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='service_role') AND a.is_grantable))) THEN
      RAISE EXCEPTION 'bound_native_album_prestate_drift';
    END IF;
  END LOOP;
END $prestate$;

CREATE FUNCTION private.native_push_descriptor_fingerprint(p_device public.user_push_devices) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $fn$
DECLARE v_field text; v_part bytea; v_framed bytea := ''::bytea;
BEGIN
  IF p_device.id IS NULL OR p_device.user_id IS NULL OR p_device.platform IS NULL
    OR p_device.provider IS NULL OR p_device.token IS NULL THEN RETURN NULL; END IF;
  FOREACH v_field IN ARRAY ARRAY[p_device.id::text,p_device.user_id::text,p_device.platform,
    p_device.provider,p_device.token,p_device.app_version,p_device.session_id::text] LOOP
    IF v_field IS NULL THEN v_framed := v_framed || convert_to('-1:','UTF8');
    ELSE
      v_part := convert_to(v_field,'UTF8');
      v_framed := v_framed || convert_to(octet_length(v_part)::text || ':','UTF8') || v_part;
    END IF;
  END LOOP;
  RETURN 'v1:' || encode(sha256(v_framed),'hex');
END $fn$;
ALTER FUNCTION private.native_push_descriptor_fingerprint(public.user_push_devices) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.native_push_descriptor_fingerprint(public.user_push_devices) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.native_push_outbox_delivery_recheck_bound(
  p_outbox_id uuid,p_claim_token uuid,p_device_id uuid,p_device_fingerprint text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_device public.user_push_devices%ROWTYPE;
  v_note uuid; v_user uuid; v_kind text; v_origin jsonb;
BEGIN
  IF p_outbox_id IS NULL OR p_claim_token IS NULL OR p_device_id IS NULL
    OR p_device_fingerprint IS NULL OR p_device_fingerprint !~ '^v1:[0-9a-f]{64}$'
    OR current_setting('transaction_isolation')<>'read committed' THEN RETURN 'claim_lost'; END IF;
  SELECT o.notification_id,o.user_id,n.kind,n.alert_origin INTO v_note,v_user,v_kind,v_origin
    FROM public.notifications_native_push_outbox o JOIN public.notifications n ON n.id=o.notification_id
    JOIN public.user_push_devices d ON d.id=o.device_id AND d.user_id=o.user_id
    WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token AND o.device_id=p_device_id
      AND n.user_id=o.user_id AND o.sent_at IS NULL AND o.attempt_count<5
      AND o.claimed_until>clock_timestamp();
  IF NOT FOUND THEN RETURN 'claim_lost'; END IF;

  -- Boundary FIRST, before descriptor or outbox row locks. Then freeze note
  -- identity without outbox ownership so target FK deletion cannot invert it.
  IF v_kind='message' THEN PERFORM private.topic_alert_lock(v_user,(v_origin->>'chat_id')::uuid); END IF;
  PERFORM 1 FROM public.notifications n WHERE n.id=v_note AND n.user_id=v_user
    AND n.kind=v_kind AND n.alert_origin IS NOT DISTINCT FROM v_origin FOR SHARE OF n;
  IF NOT FOUND THEN RETURN 'claim_lost'; END IF;
  SELECT d.* INTO v_device FROM public.user_push_devices d
    WHERE d.id=p_device_id AND d.user_id=v_user FOR SHARE OF d;
  IF NOT FOUND THEN RETURN 'claim_lost'; END IF;
  IF private.native_push_descriptor_fingerprint(v_device)=p_device_fingerprint THEN
    PERFORM private.topic_alert_reconcile_notification(v_note);
  END IF;
  PERFORM 1 FROM public.notifications_native_push_outbox o WHERE o.id=p_outbox_id
    AND o.claim_token=p_claim_token AND o.device_id=p_device_id AND o.user_id=v_user
    AND o.notification_id=v_note AND o.sent_at IS NULL AND o.attempt_count<5
    AND o.claimed_until>clock_timestamp() FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN 'claim_lost'; END IF;
  IF private.native_push_descriptor_fingerprint(v_device) IS DISTINCT FROM p_device_fingerprint THEN
    UPDATE public.notifications_native_push_outbox SET claim_token=NULL,claimed_until=NULL
      WHERE id=p_outbox_id AND claim_token=p_claim_token AND device_id=p_device_id AND user_id=v_user
        AND sent_at IS NULL;
    RETURN 'device_changed';
  END IF;
  RETURN public.native_push_outbox_delivery_recheck(p_outbox_id,p_claim_token);
END $fn$;

CREATE FUNCTION public.album_push_recheck_bound(
  p_outbox_id uuid,p_claim_token uuid,p_target_id uuid,p_target_fingerprint text
) RETURNS TABLE(status text,payload jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_device public.user_push_devices%ROWTYPE;
  v_subscription public.push_subscriptions%ROWTYPE;
  v_group uuid; v_user uuid; v_chat uuid; v_web boolean;
  v_field text; v_part bytea; v_framed bytea := ''::bytea; v_hash text;
BEGIN
  IF p_outbox_id IS NULL OR p_claim_token IS NULL OR p_target_id IS NULL
    OR p_target_fingerprint IS NULL OR p_target_fingerprint !~ '^v1:[0-9a-f]{64}$'
    OR current_setting('transaction_isolation')<>'read committed' THEN
    RETURN QUERY SELECT 'claim_lost'::text,NULL::jsonb; RETURN;
  END IF;
  SELECT o.group_id,g.user_id,g.chat_id,o.subscription_id IS NOT NULL INTO v_group,v_user,v_chat,v_web
    FROM public.notifications_album_push_outbox o JOIN public.album_push_groups g ON g.id=o.group_id
    WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token
      AND ((o.subscription_id=p_target_id AND o.device_id IS NULL AND EXISTS (
        SELECT 1 FROM public.push_subscriptions s WHERE s.id=p_target_id AND s.user_id=g.user_id))
        OR (o.device_id=p_target_id AND o.subscription_id IS NULL AND EXISTS (
        SELECT 1 FROM public.user_push_devices d WHERE d.id=p_target_id AND d.user_id=g.user_id)))
      AND o.sent_at IS NULL AND o.suppressed_at IS NULL AND o.attempt_count<5 AND o.claimed_until>clock_timestamp();
  IF NOT FOUND THEN RETURN QUERY SELECT 'claim_lost'::text,NULL::jsonb; RETURN; END IF;
  PERFORM private.topic_alert_lock(v_user,v_chat);
  IF v_web THEN
    SELECT s.* INTO v_subscription FROM public.push_subscriptions s
      WHERE s.id=p_target_id AND s.user_id=v_user FOR SHARE OF s;
    IF NOT FOUND THEN RETURN QUERY SELECT 'claim_lost'::text,NULL::jsonb; RETURN; END IF;
    FOREACH v_field IN ARRAY ARRAY[v_subscription.id::text,v_subscription.user_id::text,
      v_subscription.endpoint,v_subscription.p256dh,v_subscription.auth] LOOP
      IF v_field IS NULL THEN RETURN QUERY SELECT 'claim_lost'::text,NULL::jsonb; RETURN; END IF;
      v_part:=convert_to(v_field,'UTF8');
      v_framed:=v_framed || convert_to(octet_length(v_part)::text || ':','UTF8') || v_part;
    END LOOP;
    v_hash:='v1:' || encode(sha256(v_framed),'hex');
  ELSE
    SELECT d.* INTO v_device FROM public.user_push_devices d
      WHERE d.id=p_target_id AND d.user_id=v_user FOR SHARE OF d;
    IF NOT FOUND THEN RETURN QUERY SELECT 'claim_lost'::text,NULL::jsonb; RETURN; END IF;
    v_hash:=private.native_push_descriptor_fingerprint(v_device);
  END IF;
  IF v_hash=p_target_fingerprint THEN PERFORM private.topic_alert_reconcile_group(v_group); END IF;
  PERFORM 1 FROM public.notifications_album_push_outbox o JOIN public.album_push_groups g ON g.id=o.group_id
    WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token AND o.group_id=v_group
      AND g.user_id=v_user AND g.chat_id=v_chat
      AND ((v_web AND o.subscription_id=p_target_id AND o.device_id IS NULL)
        OR (NOT v_web AND o.device_id=p_target_id AND o.subscription_id IS NULL))
      AND o.sent_at IS NULL AND o.suppressed_at IS NULL AND o.attempt_count<5
      AND o.claimed_until>clock_timestamp() FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN QUERY SELECT 'claim_lost'::text,NULL::jsonb; RETURN; END IF;
  IF v_hash IS DISTINCT FROM p_target_fingerprint THEN
    UPDATE public.notifications_album_push_outbox o SET claim_token=NULL,claimed_until=NULL
      WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token AND o.group_id=v_group
        AND o.sent_at IS NULL AND o.suppressed_at IS NULL;
    RETURN QUERY SELECT 'target_changed'::text,NULL::jsonb; RETURN;
  END IF;
  RETURN QUERY SELECT r.status,r.payload FROM public.album_push_recheck(p_outbox_id,p_claim_token) r;
END $fn$;

ALTER FUNCTION public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.album_push_recheck_bound(uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text),
  public.album_push_recheck_bound(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text),
  public.album_push_recheck_bound(uuid,uuid,uuid,text) TO service_role;

DO $selfcheck$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)',true),
    ('public.album_push_recheck_bound(uuid,uuid,uuid,text)',true),
    ('private.native_push_descriptor_fingerprint(public.user_push_devices)',false)
  ) f(signature,exposed) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid=r.signature::regprocedure AND p.prosecdef=r.exposed AND o.rolname='postgres'
        AND p.proconfig=ARRAY['search_path=pg_catalog']
        AND has_function_privilege('service_role',p.oid,'EXECUTE')=r.exposed
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner AND (NOT r.exposed
            OR a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='service_role') OR a.is_grantable))) THEN
      RAISE EXCEPTION 'bound_native_album_selfcheck_failed';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.user_push_devices'::regclass,
    'public.push_subscriptions'::regclass,'public.notifications_native_push_outbox'::regclass,
    'public.notifications_album_push_outbox'::regclass) AND NOT relrowsecurity)
    OR encode(sha256(convert_to(pg_get_functiondef('public.native_push_outbox_delivery_recheck(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>
      '6ebe9a9d5eff45b2f9c8b6059547272b8f63e2e4ce1ce60753adecb30a929f28'
    OR encode(sha256(convert_to(pg_get_functiondef('public.album_push_recheck(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>
      '30042224019c97d630f1f9f83e9159095b83f92bb48d6b35e1a125b350d3d66e' THEN
    RAISE EXCEPTION 'bound_native_album_selfcheck_failed';
  END IF;
END $selfcheck$;
COMMIT;
