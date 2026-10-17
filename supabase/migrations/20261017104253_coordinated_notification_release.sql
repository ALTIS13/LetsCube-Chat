-- Prepared coordinated release; registration does not authorize application.
-- Installation leaves both runtimes OFF. Keep updated consumers for compatibility rollback.
-- Exact compatibility rollback SQL (one transaction; retain data, revisions and suppression):
/*
-- Prepared item77 candidate; not a production apply.
BEGIN;
DO $candidate_context$
BEGIN
  IF current_user <> session_user OR current_setting('standard_conforming_strings') <> 'on' THEN
    RAISE EXCEPTION 'candidate_execution_context_refused';
  END IF;
  PERFORM set_config('letscube.item77_search_path', current_setting('search_path'), true);
  PERFORM set_config('letscube.item77_lock_timeout', current_setting('lock_timeout'), true);
  PERFORM set_config('letscube.item77_statement_timeout', current_setting('statement_timeout'), true);
END $candidate_context$;
SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL ROLE postgres;
UPDATE private.topic_notification_runtime SET enabled=false WHERE singleton;
DO $check$
BEGIN
  IF (SELECT enabled FROM private.topic_notification_runtime WHERE singleton) IS DISTINCT FROM false
     OR to_regprocedure('private.message_topic_alert_allowed(uuid,uuid)') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.topic_notification_preferences'::regclass) THEN
    RAISE EXCEPTION 'topic_notification_rollback_refused';
  END IF;
END $check$;

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $prestate$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:web-message-preview',0))
    OR to_regclass('private.web_message_preview_runtime') IS NULL
    OR to_regclass('private.web_message_preview_grants') IS NULL
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('private.web_message_preview_runtime'::regclass,
      'private.web_message_preview_grants'::regclass) AND (NOT relrowsecurity
      OR relowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')))
  THEN RAISE EXCEPTION 'web_preview_rollback_prestate_drift'; END IF;
END $prestate$;
SET LOCAL ROLE postgres;
UPDATE private.web_message_preview_runtime SET enabled=false WHERE singleton;
UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
  preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991);
DO $selfcheck$
BEGIN
  IF (SELECT enabled FROM private.web_message_preview_runtime WHERE singleton) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM private.web_message_preview_grants
      WHERE grant_hash IS NOT NULL OR installation_consent OR preview_level<>'none' OR expires_at IS NOT NULL)
  THEN RAISE EXCEPTION 'web_preview_rollback_selfcheck_failed'; END IF;
END $selfcheck$;
COMMIT;
*/
-- Coordinated topic policy/feed and revocable Web previews.
-- Rollback: retain topic suppression/revisions; disable topic runtime and Web grants using reviewed compatibility rollback proposals. Never restore old producers or DROP retained data.
-- Prepared item77 candidate; not a production apply.
BEGIN;
DO $candidate_context$
BEGIN
  IF current_user <> session_user OR current_setting('standard_conforming_strings') <> 'on' THEN
    RAISE EXCEPTION 'candidate_execution_context_refused';
  END IF;
  PERFORM set_config('letscube.item77_search_path', current_setting('search_path'), true);
  PERFORM set_config('letscube.item77_lock_timeout', current_setting('lock_timeout'), true);
  PERFORM set_config('letscube.item77_statement_timeout', current_setting('statement_timeout'), true);
END $candidate_context$;
SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
DO $candidate_context$
BEGIN
  IF current_user <> session_user OR current_setting('standard_conforming_strings') <> 'on' THEN
    RAISE EXCEPTION 'candidate_execution_context_refused';
  END IF;
  PERFORM set_config('letscube.item77_search_path', current_setting('search_path'), true);
  PERFORM set_config('letscube.item77_lock_timeout', current_setting('lock_timeout'), true);
  PERFORM set_config('letscube.item77_statement_timeout', current_setting('statement_timeout'), true);
END $candidate_context$;
SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:topic-notification-migration',0)) THEN
    RAISE EXCEPTION 'topic_notification_migration_busy';
  END IF;
  IF to_regclass('public.topic_notification_preferences') IS NOT NULL
     OR NOT has_schema_privilege('postgres','private','CREATE')
     OR NOT has_table_privilege('postgres','auth.sessions','SELECT')
     OR encode(sha256(convert_to(pg_get_functiondef(
       'public._notification_push_allowed(uuid,text,jsonb)'::regprocedure),'UTF8')),'hex')
       <> '9461a547800f35dc084eb64a98eb49b5e61cfccb46591b04efdd3aadaf6b38ed' THEN
    RAISE EXCEPTION 'topic_notification_prestate_drift';
  END IF;
END $prestate$;

SET LOCAL ROLE postgres;

CREATE TABLE private.topic_notification_runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE private.topic_notification_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.topic_notification_runtime FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.topic_notification_runtime(singleton,enabled) VALUES(true,false);

CREATE TABLE public.topic_notification_preferences (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  scope_key text NOT NULL CHECK(scope_key='general' OR scope_key ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  mode text NOT NULL CHECK(mode IN ('inherit','enabled','disabled')),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,chat_id,scope_key)
);
ALTER TABLE public.topic_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.topic_notification_preferences FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.topic_notification_preferences TO authenticated;
CREATE POLICY "own accessible topic preferences" ON public.topic_notification_preferences
  FOR SELECT TO authenticated
  USING(user_id=(SELECT auth.uid()) AND public.is_chat_member(chat_id)
    AND NOT public.is_banned((SELECT auth.uid()))
    AND ((scope_key='general' AND NOT EXISTS(SELECT 1 FROM public.topics t
      WHERE t.chat_id=topic_notification_preferences.chat_id AND t.is_general AND t.archived))
      OR EXISTS(SELECT 1 FROM public.topics t
      WHERE t.id::text=scope_key AND t.chat_id=topic_notification_preferences.chat_id
        AND NOT t.archived AND NOT t.is_general)));

CREATE FUNCTION private.topic_notification_scope(p_chat_id uuid,p_topic_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT CASE WHEN p_topic_id IS NULL THEN
    CASE WHEN NOT EXISTS(SELECT 1 FROM public.topics t
      WHERE t.chat_id=p_chat_id AND t.is_general AND t.archived) THEN 'general' END ELSE
    (SELECT CASE WHEN t.is_general THEN 'general' ELSE t.id::text END
     FROM public.topics t WHERE t.id=p_topic_id AND t.chat_id=p_chat_id AND NOT t.archived)
  END WHERE EXISTS(SELECT 1 FROM public.chats c WHERE c.id=p_chat_id);
$fn$;

CREATE FUNCTION private.topic_notification_lock(p_user_id uuid,p_chat_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF p_user_id IS NULL OR p_chat_id IS NULL
     OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'topic_notification_isolation_unavailable' USING ERRCODE='25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'letscube:topic-alert:'||p_user_id::text||':'||p_chat_id::text,0));
END $fn$;

CREATE FUNCTION private.topic_notification_reader(p_chat_id uuid,p_lock boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_user uuid:=auth.uid(); v_sid text:=auth.jwt()->>'session_id';
BEGIN
  IF v_user IS NULL OR coalesce(v_sid,'') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=v_sid::uuid AND s.user_id=v_user
      AND (s.not_after IS NULL OR s.not_after>pg_catalog.clock_timestamp())) THEN
    RAISE EXCEPTION 'topic_notification_session_invalid' USING ERRCODE='42501';
  END IF;
  IF public.is_banned(v_user) THEN
    RAISE EXCEPTION 'topic_notification_access_denied' USING ERRCODE='42501';
  END IF;
  IF p_lock THEN
    PERFORM 1 FROM public.chat_members cm WHERE cm.user_id=v_user AND cm.chat_id=p_chat_id FOR SHARE;
  ELSE
    PERFORM 1 FROM public.chat_members cm WHERE cm.user_id=v_user AND cm.chat_id=p_chat_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic_notification_access_denied' USING ERRCODE='42501';
  END IF;
  RETURN v_user;
END $fn$;

CREATE FUNCTION public.topic_notification_preferences_read(p_chat_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_user uuid;
BEGIN
  v_user:=private.topic_notification_reader(p_chat_id);
  IF NOT coalesce((SELECT enabled FROM private.topic_notification_runtime WHERE singleton),false) THEN
    RAISE EXCEPTION 'topic_notifications_unavailable' USING ERRCODE='55000';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('scope_key',p.scope_key,'mode',p.mode,
    'revision',p.revision) ORDER BY p.scope_key)
    FROM public.topic_notification_preferences p WHERE p.user_id=v_user AND p.chat_id=p_chat_id
      AND private.topic_notification_scope(p.chat_id,
        CASE WHEN p.scope_key='general' THEN NULL ELSE p.scope_key::uuid END)=p.scope_key),'[]'::jsonb);
END $fn$;

CREATE FUNCTION public.topic_notification_preference_set(
  p_chat_id uuid,p_topic_id uuid,p_mode text,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_user uuid; v_scope text; v_old public.topic_notification_preferences%rowtype;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('inherit','enabled','disabled') OR p_expected_revision IS NULL
     OR p_expected_revision<0 OR p_expected_revision>9007199254740991 THEN
    RAISE EXCEPTION 'invalid_topic_notification_preference' USING ERRCODE='22023';
  END IF;
  v_user:=private.topic_notification_reader(p_chat_id);
  -- Lock the chat before its membership to match parent-delete/FK lock order.
  PERFORM 1 FROM public.chats c WHERE c.id=p_chat_id AND (c.type='group' OR c.is_forum) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic_notification_scope_unavailable' USING ERRCODE='22023';
  END IF;
  PERFORM private.topic_notification_reader(p_chat_id,true);
  -- Source locks precede the account/chat barrier. Delivery consumers must take
  -- that barrier before any outbox lock, never from inside the stable policy.
  IF p_topic_id IS NOT NULL THEN
    PERFORM 1 FROM public.topics t WHERE t.id=p_topic_id AND t.chat_id=p_chat_id AND NOT t.archived FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'topic_notification_scope_unavailable' USING ERRCODE='22023';
    END IF;
  ELSE
    PERFORM 1 FROM public.topics t WHERE t.chat_id=p_chat_id AND t.is_general FOR SHARE;
  END IF;
  PERFORM private.topic_notification_lock(v_user,p_chat_id);
  -- A concurrent logout/session expiry or ban may commit while this waits.
  -- The volatile outer RPC obtains a fresh snapshot after the barrier.
  PERFORM private.topic_notification_reader(p_chat_id);
  IF NOT coalesce((SELECT enabled FROM private.topic_notification_runtime WHERE singleton),false) THEN
    RAISE EXCEPTION 'topic_notifications_unavailable' USING ERRCODE='55000';
  END IF;
  v_scope:=private.topic_notification_scope(p_chat_id,p_topic_id);
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'topic_notification_scope_unavailable' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_old FROM public.topic_notification_preferences p
    WHERE p.user_id=v_user AND p.chat_id=p_chat_id AND p.scope_key=v_scope FOR UPDATE;
  IF coalesce(v_old.revision,0)<>p_expected_revision THEN
    RETURN jsonb_build_object('status','conflict','scope_key',v_scope,
      'mode',coalesce(v_old.mode,'inherit'),'revision',coalesce(v_old.revision,0));
  END IF;
  IF coalesce(v_old.revision,0)>=9007199254740991 THEN
    RAISE EXCEPTION 'topic_notification_revision_exhausted' USING ERRCODE='54000';
  END IF;
  INSERT INTO public.topic_notification_preferences(user_id,chat_id,scope_key,mode,revision)
    VALUES(v_user,p_chat_id,v_scope,p_mode,coalesce(v_old.revision,0)+1)
    ON CONFLICT(user_id,chat_id,scope_key) DO UPDATE
      SET mode=excluded.mode,revision=excluded.revision,updated_at=pg_catalog.clock_timestamp();
  RETURN jsonb_build_object('status','applied','scope_key',v_scope,'mode',p_mode,
    'revision',coalesce(v_old.revision,0)+1);
END $fn$;

CREATE FUNCTION private.message_topic_alert_allowed(p_recipient_id uuid,p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_chat uuid; v_topic uuid; v_scope text; v_mode text;
BEGIN
  IF NOT private.message_notification_visible_to(p_message_id,p_recipient_id) THEN RETURN false; END IF;
  SELECT m.chat_id,m.topic_id INTO v_chat,v_topic FROM public.messages m WHERE m.id=p_message_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_scope:=private.topic_notification_scope(v_chat,v_topic);
  IF v_scope IS NULL THEN RETURN false; END IF;
  SELECT mode INTO v_mode FROM public.topic_notification_preferences
    WHERE user_id=p_recipient_id AND chat_id=v_chat AND scope_key=v_scope;
  IF v_mode='disabled' THEN RETURN false; END IF;
  IF v_mode='enabled' AND coalesce((SELECT enabled FROM private.topic_notification_runtime WHERE singleton),false) THEN
    RETURN true;
  END IF;
  RETURN NOT EXISTS(SELECT 1 FROM public.chat_notification_preferences p
    WHERE p.user_id=p_recipient_id AND p.chat_id=v_chat AND
      (p.push_enabled IS NOT TRUE OR (p.muted_until IS NOT NULL AND p.muted_until>now())));
END $fn$;

REVOKE ALL ON FUNCTION private.topic_notification_scope(uuid,uuid),
  private.topic_notification_lock(uuid,uuid),private.topic_notification_reader(uuid,boolean),
  private.message_topic_alert_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.topic_notification_preferences_read(uuid),
  public.topic_notification_preference_set(uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.topic_notification_preferences_read(uuid),
  public.topic_notification_preference_set(uuid,uuid,text,bigint) TO authenticated;

DO $policy$
DECLARE
  ddl text:=pg_get_functiondef('public._notification_push_allowed(uuid,text,jsonb)'::regprocedure);
  anchor text:=$anchor$  if (p_payload->>'chat_id') ~* '^[0-9a-f-]{36}$' then$anchor$;
  replacement text:=$replacement$  if p_kind = 'message' then
    return private.message_topic_alert_allowed(p_user_id,(p_payload->>'message_id')::uuid);
  end if;
  if (p_payload->>'chat_id') ~* '^[0-9a-f-]{36}$' then$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1)<>2 THEN RAISE EXCEPTION 'topic_notification_policy_anchor_drift'; END IF;
  EXECUTE replace(ddl,anchor,replacement);
END $policy$;

DO $self_check$
DECLARE v_function regprocedure; v_public boolean; v_role text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.topic_notification_preferences'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.topic_notification_runtime'::regclass)
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.topic_notification_preferences'::regclass,
      'private.topic_notification_runtime'::regclass) AND relowner<>'postgres'::regrole)
    OR has_table_privilege('authenticated','public.topic_notification_preferences','INSERT,UPDATE,DELETE')
    OR has_table_privilege('anon','public.topic_notification_preferences','SELECT')
    OR NOT has_table_privilege('authenticated','public.topic_notification_preferences','SELECT')
    OR NOT has_function_privilege('authenticated','public.topic_notification_preference_set(uuid,uuid,text,bigint)','EXECUTE')
    OR has_function_privilege('anon','public.topic_notification_preference_set(uuid,uuid,text,bigint)','EXECUTE')
    OR has_function_privilege('authenticated','private.message_topic_alert_allowed(uuid,uuid)','EXECUTE')
    OR (SELECT enabled FROM private.topic_notification_runtime WHERE singleton) IS DISTINCT FROM false
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.topic_notification_preferences'::regclass)<>1 THEN
    RAISE EXCEPTION 'topic_notification_self_check_failed';
  END IF;
  FOREACH v_function IN ARRAY ARRAY[
    'private.topic_notification_scope(uuid,uuid)'::regprocedure,
    'private.topic_notification_lock(uuid,uuid)'::regprocedure,
    'private.topic_notification_reader(uuid,boolean)'::regprocedure,
    'private.message_topic_alert_allowed(uuid,uuid)'::regprocedure,
    'public.topic_notification_preferences_read(uuid)'::regprocedure,
    'public.topic_notification_preference_set(uuid,uuid,text,bigint)'::regprocedure
  ] LOOP
    IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_function AND
      (proowner<>'postgres'::regrole OR NOT prosecdef OR
        proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])) THEN
      RAISE EXCEPTION 'topic_notification_self_check_failed';
    END IF;
    SELECT pronamespace='public'::regnamespace INTO v_public FROM pg_proc WHERE oid=v_function;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(v_role,v_function,'EXECUTE') IS DISTINCT FROM
        (v_public AND v_role='authenticated') THEN
        RAISE EXCEPTION 'topic_notification_self_check_failed';
      END IF;
    END LOOP;
  END LOOP;
END $self_check$;

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bound-push-delivery',0))
     OR to_regprocedure('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.push_subscriptions'::regclass,
       'public.notifications_push_outbox'::regclass) AND NOT relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
       WHERE p.oid=to_regprocedure('public.push_outbox_delivery_recheck(uuid,uuid)')
         AND p.prosecdef AND r.rolname='postgres' AND p.prorettype='text'::regtype
         AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=
           '7f2cce6f0dda421d386e98e4d3a51113e221ca79314515d342698a2e5f3caa9f') THEN
    RAISE EXCEPTION 'bound_push_delivery_prestate_drift';
  END IF;
END $prestate$;

CREATE FUNCTION public.push_outbox_delivery_recheck_bound(
  p_outbox_id uuid,p_claim_token uuid,p_subscription_id uuid,p_subscription_fingerprint text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_subscription public.push_subscriptions%ROWTYPE;
  v_field text;
  v_part bytea;
  v_framed bytea := ''::bytea;
BEGIN
  IF p_outbox_id IS NULL OR p_claim_token IS NULL OR p_subscription_id IS NULL
     OR p_subscription_fingerprint IS NULL
     OR p_subscription_fingerprint !~ '^v1:[0-9a-f]{64}$' THEN
    RETURN 'claim_lost';
  END IF;

  -- Descriptor writers cannot change these fields until this transaction ends.
  -- Lock subscription before outbox; the maintained recheck reuses our row lock.
  SELECT s.* INTO v_subscription FROM public.push_subscriptions s
    WHERE s.id=p_subscription_id FOR SHARE OF s;
  IF NOT FOUND THEN RETURN 'claim_lost'; END IF;

  PERFORM 1 FROM public.notifications_push_outbox o
    WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token
      AND o.subscription_id=p_subscription_id AND o.user_id=v_subscription.user_id
      AND o.sent_at IS NULL AND o.suppressed_at IS NULL
    FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN 'claim_lost'; END IF;

  FOREACH v_field IN ARRAY ARRAY[v_subscription.id::text,v_subscription.user_id::text,
    v_subscription.endpoint,v_subscription.p256dh,v_subscription.auth] LOOP
    IF v_field IS NULL THEN RETURN 'claim_lost'; END IF;
    v_part := convert_to(v_field,'UTF8');
    v_framed := v_framed || convert_to(octet_length(v_part)::text || ':','UTF8') || v_part;
  END LOOP;
  IF 'v1:' || encode(sha256(v_framed),'hex') IS DISTINCT FROM p_subscription_fingerprint THEN
    UPDATE public.notifications_push_outbox
      SET claim_token=NULL,claimed_until=NULL
      WHERE id=p_outbox_id AND claim_token=p_claim_token
        AND subscription_id=p_subscription_id AND user_id=v_subscription.user_id
        AND sent_at IS NULL AND suppressed_at IS NULL;
    RETURN 'subscription_changed';
  END IF;
  RETURN public.push_outbox_delivery_recheck(p_outbox_id,p_claim_token);
END
$fn$;
ALTER FUNCTION public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text) TO service_role;

DO $selfcheck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid='public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)'::regprocedure
        AND p.prosecdef AND p.provolatile='v' AND r.rolname='postgres'
        AND p.prorettype='text'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog']
        AND p.proargnames=ARRAY['p_outbox_id','p_claim_token','p_subscription_id','p_subscription_fingerprint'])
     OR has_function_privilege('anon','public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.push_subscriptions'::regclass,
       'public.notifications_push_outbox'::regclass) AND NOT relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
       WHERE p.oid='public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)'::regprocedure
         AND (a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))
           OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='service_role') AND a.is_grantable)))
     OR encode(sha256(convert_to(pg_get_functiondef(
       'public.push_outbox_delivery_recheck(uuid,uuid)'::regprocedure),'UTF8')),'hex') <>
       '7f2cce6f0dda421d386e98e4d3a51113e221ca79314515d342698a2e5f3caa9f' THEN
    RAISE EXCEPTION 'bound_push_delivery_selfcheck_failed';
  END IF;
END $selfcheck$;

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $prestate$
DECLARE r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:topic-notification-migration',0))
    OR to_regprocedure('private.message_topic_alert_allowed(uuid,uuid)') IS NULL
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.notifications'::regclass,
      'public.album_push_groups'::regclass,'public.notifications_album_push_outbox'::regclass) AND relowner<>'postgres'::regrole)
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.notifications'::regclass
      AND attname='alert_suppressed_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'topic_delivery_prestate_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.enqueue_message_notifications()','b8ff7002ad8cb2d80a63b8050e68c56a6aea0ed65ffcc65e737a1c3fa7b64c23'),
    ('public._enqueue_push_after_notification_insert()','c8e1a9182122e7c929f45fd3a0739d52931a3ae6f942a049242560fce53c25ff'),
    ('public.album_push_enqueue(uuid)','26962ac135958b683806d3150476e9a55317eb86b484b8af3cdc0a250fda3d8d'),
    ('public.album_push_recheck(uuid,uuid)','c0fb4560e3ed03992d399fdeebbdf348ee8e14b5381ee91769f7f64551040734'),
    ('public.push_outbox_delivery_recheck(uuid,uuid)','7f2cce6f0dda421d386e98e4d3a51113e221ca79314515d342698a2e5f3caa9f'),
    ('public.native_push_outbox_delivery_recheck(uuid,uuid)','c6bef60b0e955a05e9ec15ba7b4e1a2b270ab2108c1a340cdb77671db3475929'),
    ('public.native_message_notification_preview(uuid,uuid)','42af39458d2b3ef795f9dfa50062288ae4fba3af0c5e3a4f278da94e1395b519'),
    ('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','ffb535b9edfb3cd91cb753d46414d4720638bca9bc997f14d3c8126d6ae19625')
  ) x(signature,digest) LOOP
    IF to_regprocedure(r.signature) IS NULL OR encode(sha256(convert_to(
      pg_get_functiondef(to_regprocedure(r.signature)),'UTF8')),'hex') IS DISTINCT FROM r.digest THEN
      RAISE EXCEPTION 'topic_delivery_prestate_drift:%',r.signature;
    END IF;
  END LOOP;
  IF to_regprocedure('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'topic_delivery_bound_dependency_missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication p WHERE p.pubname='supabase_realtime'
      AND p.pubowner='postgres'::regrole AND NOT p.puballtables)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.topics'::regclass,'public.notifications'::regclass]) required(relation)
      WHERE NOT EXISTS(SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
        WHERE p.pubname='supabase_realtime' AND pr.prrelid=required.relation))
    OR EXISTS(SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
      WHERE p.pubname='supabase_realtime' AND pr.prrelid='public.topic_notification_preferences'::regclass) THEN
    RAISE EXCEPTION 'topic_delivery_publication_prestate_drift';
  END IF;
END $prestate$;
SET LOCAL ROLE postgres;

ALTER PUBLICATION supabase_realtime ADD TABLE public.topic_notification_preferences;

ALTER TABLE public.notifications ADD COLUMN alert_suppressed_at timestamptz,
  ADD COLUMN alert_origin jsonb;
ALTER TABLE public.album_push_groups ADD COLUMN topic_alert_suppressed_at timestamptz;
CREATE INDEX notification_topic_admission ON public.notifications(user_id,((alert_origin->>'chat_id')))
  WHERE kind='message' AND alert_suppressed_at IS NULL AND read_at IS NULL;
CREATE INDEX topic_alert_pending_albums ON public.notifications_album_push_outbox(group_id)
  WHERE sent_at IS NULL AND suppressed_at IS NULL;

CREATE FUNCTION private.message_alert_origin(p_message uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT jsonb_build_object('message_id',m.id,'chat_id',m.chat_id,
    'scope_key',private.topic_notification_scope(m.chat_id,m.topic_id),
    'general_id',CASE WHEN m.topic_id IS NULL OR t.is_general THEN
      (SELECT g.id FROM public.topics g WHERE g.chat_id=m.chat_id AND g.is_general) END,
    'sender_id',m.user_id,'bot_id',m.bot_id,
    'album_id',m.media_metadata->'album_id','album_count',m.media_metadata->'album_count',
    'album_index',m.media_metadata->'album_index')
  FROM public.messages m LEFT JOIN public.topics t ON t.id=m.topic_id AND t.chat_id=m.chat_id
  WHERE m.id=p_message AND private.topic_notification_scope(m.chat_id,m.topic_id) IS NOT NULL;
$fn$;

CREATE FUNCTION private.notification_topic_alert_allowed(p_notification uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT coalesce((SELECT n.kind='message' AND n.alert_suppressed_at IS NULL
    AND n.alert_origin IS NOT NULL AND n.alert_origin=private.message_alert_origin(m.id)
    AND n.payload->>'chat_id'=m.chat_id::text
    AND private.message_topic_alert_allowed(n.user_id,m.id)
    AND NOT EXISTS(SELECT 1 FROM public.album_push_groups g
      WHERE g.user_id=n.user_id AND g.chat_id=m.chat_id
        AND g.album_id=m.media_metadata->>'album_id'
        AND g.sender_kind=CASE WHEN m.bot_id IS NULL THEN 'user' ELSE 'bot' END
        AND g.sender_id=coalesce(m.bot_id,m.user_id) AND g.topic_alert_suppressed_at IS NOT NULL)
    FROM public.notifications n JOIN public.messages m ON n.payload->>'message_id'=m.id::text
    WHERE n.id=p_notification),false);
$fn$;

CREATE FUNCTION private.topic_alert_lock(p_user uuid,p_chat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF p_user IS NULL OR p_chat IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.chats WHERE id=p_chat FOR SHARE;
  PERFORM 1 FROM public.chat_members WHERE chat_id=p_chat AND user_id=p_user FOR SHARE;
  PERFORM private.topic_notification_lock(p_user,p_chat);
END $fn$;

CREATE FUNCTION private.topic_alert_lock_chat(p_chat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r record;
BEGIN
  PERFORM 1 FROM public.chats WHERE id=p_chat FOR SHARE;
  PERFORM 1 FROM public.chat_members WHERE chat_id=p_chat ORDER BY user_id FOR SHARE;
  FOR r IN SELECT user_id FROM public.chat_members WHERE chat_id=p_chat
    ORDER BY user_id LOOP
    PERFORM private.topic_notification_lock(r.user_id,p_chat);
  END LOOP;
END $fn$;

CREATE FUNCTION private.topic_alert_source_lock(p_user uuid,p_chat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF p_user IS NULL OR p_chat IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'topic_delivery_source_isolation_unavailable' USING ERRCODE='25000';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'letscube:topic-alert:'||p_user::text||':'||p_chat::text,0)) THEN
    RAISE EXCEPTION 'topic_delivery_source_busy' USING ERRCODE='40001';
  END IF;
END $fn$;

-- All *_locked helpers are private. The caller owns the account/chat barrier.
-- No blocking downstream mode or client-controlled lock-authority GUC exists.
CREATE FUNCTION private.topic_alert_mark_locked(p_notification uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification
    AND n.kind='message' AND n.alert_suppressed_at IS NULL
    AND NOT private.notification_topic_alert_allowed(n.id)) THEN RETURN; END IF;
  PERFORM 1 FROM public.notifications WHERE id=p_notification FOR UPDATE NOWAIT;
  UPDATE public.notifications n SET alert_suppressed_at=v_now
    WHERE n.id=p_notification AND n.kind='message' AND n.alert_suppressed_at IS NULL
      AND NOT private.notification_topic_alert_allowed(n.id);
END $fn$;

CREATE FUNCTION private.topic_alert_settle_locked(p_notification uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=p_notification AND alert_suppressed_at IS NOT NULL) THEN RETURN; END IF;
  PERFORM 1 FROM public.notifications_push_outbox WHERE notification_id=p_notification
    AND sent_at IS NULL AND suppressed_at IS NULL ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.notifications_native_push_outbox WHERE notification_id=p_notification
    AND sent_at IS NULL ORDER BY id FOR UPDATE NOWAIT;
  UPDATE public.notifications_push_outbox SET suppressed_at=v_now,suppression_reason=NULL,
    claim_token=NULL,claimed_until=NULL WHERE notification_id=p_notification AND sent_at IS NULL AND suppressed_at IS NULL;
  UPDATE public.notifications_native_push_outbox SET sent_at=v_now,last_error='suppressed:not_eligible',
    claim_token=NULL,claimed_until=NULL,updated_at=v_now WHERE notification_id=p_notification AND sent_at IS NULL;
END $fn$;

CREATE FUNCTION private.topic_alert_group_locked(p_group uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r record; v_now timestamptz:=clock_timestamp();
BEGIN
  -- Existing album index/uniqueness bounds membership to at most ten entries.
  FOR r IN SELECT notification_id FROM public.album_push_members WHERE group_id=p_group ORDER BY notification_id LOOP
    PERFORM private.topic_alert_mark_locked(r.notification_id);
  END LOOP;
  PERFORM 1 FROM public.album_push_groups WHERE id=p_group FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.album_push_members am
    WHERE am.group_id=p_group AND private.notification_topic_alert_allowed(am.notification_id)) THEN
    UPDATE public.album_push_groups SET topic_alert_suppressed_at=v_now
      WHERE id=p_group AND topic_alert_suppressed_at IS NULL;
  END IF;
  FOR r IN SELECT notification_id FROM public.album_push_members WHERE group_id=p_group ORDER BY notification_id LOOP
    PERFORM private.topic_alert_settle_locked(r.notification_id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.album_push_groups WHERE id=p_group AND topic_alert_suppressed_at IS NOT NULL) THEN
    PERFORM 1 FROM public.notifications_album_push_outbox WHERE group_id=p_group
      AND sent_at IS NULL AND suppressed_at IS NULL ORDER BY id FOR UPDATE NOWAIT;
    UPDATE public.notifications_album_push_outbox SET suppressed_at=v_now,suppression_reason='not_eligible',
      claim_token=NULL,claimed_until=NULL,updated_at=v_now
      WHERE group_id=p_group AND sent_at IS NULL AND suppressed_at IS NULL;
  END IF;
END $fn$;

CREATE FUNCTION private.topic_alert_notification_locked(p_notification uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE g uuid;
BEGIN
  PERFORM private.topic_alert_mark_locked(p_notification);
  FOR g IN SELECT group_id FROM public.album_push_members WHERE notification_id=p_notification
    UNION SELECT a.id FROM public.album_push_groups a JOIN public.notifications n ON n.id=p_notification
      AND a.user_id=n.user_id AND a.chat_id::text=n.alert_origin->>'chat_id'
      AND a.album_id=n.alert_origin->>'album_id'
      AND a.sender_id::text=coalesce(n.alert_origin->>'bot_id',n.alert_origin->>'sender_id')
      AND a.sender_kind=CASE WHEN n.alert_origin->>'bot_id' IS NULL THEN 'user' ELSE 'bot' END
    ORDER BY 1 LOOP
    PERFORM private.topic_alert_group_locked(g);
  END LOOP;
  PERFORM private.topic_alert_settle_locked(p_notification);
END $fn$;

CREATE FUNCTION private.topic_alert_reconcile_notification(p_notification uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid; c uuid;
BEGIN
  SELECT user_id,(alert_origin->>'chat_id')::uuid INTO u,c FROM public.notifications WHERE id=p_notification AND kind='message';
  IF c IS NULL THEN RETURN; END IF;
  PERFORM private.topic_alert_lock(u,c);
  PERFORM private.topic_alert_notification_locked(p_notification);
END $fn$;

CREATE FUNCTION private.topic_alert_reconcile_group(p_group uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid; c uuid;
BEGIN
  SELECT user_id,chat_id INTO u,c FROM public.album_push_groups WHERE id=p_group;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM private.topic_alert_lock(u,c);
  PERFORM private.topic_alert_group_locked(p_group);
END $fn$;

CREATE FUNCTION private.topic_alert_refresh_locked(p_user uuid,p_chat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r record;
BEGIN
  -- Rare preference/source changes only: scan live unread admissions/pending
  -- groups, not read history, completed groups or indelible tombstones.
  FOR r IN SELECT id FROM public.notifications WHERE user_id=p_user AND kind='message'
    AND alert_origin->>'chat_id'=p_chat::text AND alert_suppressed_at IS NULL AND read_at IS NULL ORDER BY id LOOP
    PERFORM private.topic_alert_notification_locked(r.id);
  END LOOP;
  FOR r IN SELECT DISTINCT g.id FROM public.notifications_album_push_outbox o JOIN public.album_push_groups g ON g.id=o.group_id
    WHERE g.user_id=p_user AND g.chat_id=p_chat AND g.topic_alert_suppressed_at IS NULL
      AND o.sent_at IS NULL AND o.suppressed_at IS NULL ORDER BY g.id LOOP
    PERFORM private.topic_alert_group_locked(r.id);
  END LOOP;
END $fn$;

CREATE FUNCTION private.topic_alert_refresh(p_user uuid,p_chat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF p_user IS NULL OR p_chat IS NULL THEN RETURN; END IF;
  PERFORM private.topic_alert_lock(p_user,p_chat);
  PERFORM private.topic_alert_refresh_locked(p_user,p_chat);
END $fn$;

CREATE FUNCTION private.topic_alert_preference_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT x.u,x.c FROM (VALUES
    ((CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD)->>'user_id' END)::uuid,
     (CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD)->>'chat_id' END)::uuid),
    ((CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW)->>'user_id' END)::uuid,
     (CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW)->>'chat_id' END)::uuid)) x(u,c)
    WHERE x.u IS NOT NULL AND x.c IS NOT NULL ORDER BY x.u,x.c LOOP
    -- UPDATE/DELETE already own this preference row. Never acquire a blocking
    -- parent/member lock or advisory wait from either trigger phase.
    PERFORM private.topic_alert_source_lock(r.u,r.c);
    IF TG_WHEN='AFTER' THEN PERFORM private.topic_alert_refresh_locked(r.u,r.c); END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER topic_alert_parent_before BEFORE INSERT OR UPDATE OR DELETE ON public.chat_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_preference_lock();
CREATE TRIGGER topic_alert_parent_after AFTER INSERT OR UPDATE OR DELETE ON public.chat_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_preference_lock();
CREATE TRIGGER topic_alert_child_after AFTER INSERT OR UPDATE OR DELETE ON public.topic_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_preference_lock();

CREATE FUNCTION private.topic_alert_source_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE old_row jsonb; new_row jsonb; chats text[]; users text[]; pairs jsonb; r record;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND
    (CASE WHEN TG_TABLE_NAME='topics' THEN
      (old_row->'id') IS NOT DISTINCT FROM (new_row->'id') AND (old_row->'archived') IS NOT DISTINCT FROM (new_row->'archived')
      AND (old_row->'is_general') IS NOT DISTINCT FROM (new_row->'is_general') AND (old_row->'chat_id') IS NOT DISTINCT FROM (new_row->'chat_id')
    WHEN TG_TABLE_NAME='chat_members' THEN
      (old_row->'user_id') IS NOT DISTINCT FROM (new_row->'user_id') AND (old_row->'chat_id') IS NOT DISTINCT FROM (new_row->'chat_id')
      AND (old_row->'joined_at') IS NOT DISTINCT FROM (new_row->'joined_at') AND (old_row->'hidden_at') IS NOT DISTINCT FROM (new_row->'hidden_at')
      AND (old_row->'cleared_at') IS NOT DISTINCT FROM (new_row->'cleared_at')
    ELSE (old_row->'topic_id') IS NOT DISTINCT FROM (new_row->'topic_id') AND (old_row->'chat_id') IS NOT DISTINCT FROM (new_row->'chat_id')
      AND (old_row->'user_id') IS NOT DISTINCT FROM (new_row->'user_id') AND (old_row->'bot_id') IS NOT DISTINCT FROM (new_row->'bot_id')
      AND (old_row->'media_metadata') IS NOT DISTINCT FROM (new_row->'media_metadata') AND (old_row->'deleted_at') IS NOT DISTINCT FROM (new_row->'deleted_at') END)
    THEN RETURN NEW; END IF;
  chats:=array_remove(ARRAY[old_row->>'chat_id',new_row->>'chat_id'],NULL);
  users:=array_remove(ARRAY[old_row->>'user_id',new_row->>'user_id'],NULL);
  SELECT coalesce(jsonb_agg(jsonb_build_object('u',u,'c',c) ORDER BY u,c),'[]'::jsonb) INTO pairs FROM (
    SELECT cm.user_id AS u,cm.chat_id AS c FROM public.chat_members cm WHERE cm.chat_id::text=ANY(chats)
      AND (TG_TABLE_NAME<>'chat_members' OR cm.user_id::text=ANY(users))
    UNION SELECT n.user_id,(n.alert_origin->>'chat_id')::uuid FROM public.notifications n
      WHERE n.alert_origin->>'chat_id'=ANY(chats) AND n.kind='message' AND n.alert_suppressed_at IS NULL AND n.read_at IS NULL
        AND (TG_TABLE_NAME<>'chat_members' OR n.user_id::text=ANY(users))
    UNION SELECT g.user_id,g.chat_id FROM public.notifications_album_push_outbox o JOIN public.album_push_groups g ON g.id=o.group_id
      WHERE g.chat_id::text=ANY(chats) AND g.topic_alert_suppressed_at IS NULL AND o.sent_at IS NULL AND o.suppressed_at IS NULL
        AND (TG_TABLE_NAME<>'chat_members' OR g.user_id::text=ANY(users))
    UNION SELECT (v->>'user_id')::uuid,(v->>'chat_id')::uuid FROM jsonb_array_elements(jsonb_build_array(old_row,new_row)) v
      WHERE TG_TABLE_NAME='chat_members' AND v->>'user_id' IS NOT NULL AND v->>'chat_id' IS NOT NULL
  ) affected;
  FOR r IN SELECT (v->>'u')::uuid AS u,(v->>'c')::uuid AS c FROM jsonb_array_elements(pairs) v LOOP
    PERFORM private.topic_alert_source_lock(r.u,r.c);
  END LOOP;
  FOR r IN SELECT (v->>'u')::uuid AS u,(v->>'c')::uuid AS c FROM jsonb_array_elements(pairs) v LOOP
    PERFORM private.topic_alert_refresh_locked(r.u,r.c);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER topic_alert_topic_change AFTER INSERT OR UPDATE OR DELETE ON public.topics
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_source_changed();
CREATE TRIGGER topic_alert_message_change AFTER UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_source_changed();
CREATE TRIGGER topic_alert_member_change AFTER UPDATE OR DELETE ON public.chat_members
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_source_changed();

CREATE FUNCTION private.topic_alert_columns_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
  IF NEW.alert_origin IS DISTINCT FROM OLD.alert_origin OR
    (OLD.alert_suppressed_at IS NOT NULL AND NEW.alert_suppressed_at IS DISTINCT FROM OLD.alert_suppressed_at) OR
    (NEW.alert_suppressed_at IS DISTINCT FROM OLD.alert_suppressed_at AND current_user NOT IN ('postgres','supabase_admin')) THEN
    RAISE EXCEPTION 'notification_alert_columns_are_server_owned' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER topic_alert_columns_guard BEFORE UPDATE OF alert_origin,alert_suppressed_at ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_columns_guard();

CREATE FUNCTION private.topic_alert_group_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
  IF (OLD.topic_alert_suppressed_at IS NOT NULL AND NEW.topic_alert_suppressed_at IS DISTINCT FROM OLD.topic_alert_suppressed_at)
    OR (NEW.topic_alert_suppressed_at IS DISTINCT FROM OLD.topic_alert_suppressed_at AND current_user NOT IN ('postgres','supabase_admin')) THEN
    RAISE EXCEPTION 'album_alert_marker_is_server_owned' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER topic_alert_group_guard BEFORE UPDATE OF topic_alert_suppressed_at ON public.album_push_groups
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_group_guard();

CREATE FUNCTION private.topic_alert_admit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE m uuid; c uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (OLD.read_at IS NOT NULL AND NEW.read_at IS NULL)
      OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.kind IS DISTINCT FROM OLD.kind
      OR (NEW.payload->>'message_id') IS DISTINCT FROM (OLD.payload->>'message_id')
      OR (NEW.payload->>'chat_id') IS DISTINCT FROM (OLD.payload->>'chat_id') THEN
      NEW.alert_origin:=OLD.alert_origin;
      NEW.alert_suppressed_at:=coalesce(OLD.alert_suppressed_at,clock_timestamp());
    END IF;
    RETURN NEW;
  END IF;
  NEW.alert_origin:=NULL; NEW.alert_suppressed_at:=NULL;
  IF NEW.kind<>'message' THEN RETURN NEW; END IF;
  IF coalesce(NEW.payload->>'message_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    m:=(NEW.payload->>'message_id')::uuid;
    SELECT chat_id INTO c FROM public.messages WHERE id=m;
    IF c IS NOT NULL THEN
      PERFORM private.topic_alert_lock(NEW.user_id,c);
      NEW.alert_origin:=private.message_alert_origin(m);
    END IF;
  END IF;
  IF NEW.alert_origin IS NULL OR NEW.payload->>'chat_id' IS DISTINCT FROM c::text
    OR NOT private.message_topic_alert_allowed(NEW.user_id,m)
    OR EXISTS(SELECT 1 FROM public.messages source JOIN public.album_push_groups g
      ON g.user_id=NEW.user_id AND g.chat_id=source.chat_id
        AND g.album_id=source.media_metadata->>'album_id'
        AND g.sender_id=coalesce(source.bot_id,source.user_id)
        AND g.sender_kind=CASE WHEN source.bot_id IS NULL THEN 'user' ELSE 'bot' END
      WHERE source.id=m AND g.topic_alert_suppressed_at IS NOT NULL) THEN
    NEW.alert_suppressed_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER topic_alert_admit BEFORE INSERT OR UPDATE OF user_id,kind,payload,read_at ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_admit();

CREATE FUNCTION private.topic_alert_unhandled_album(p_notification uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r record; v_count integer;
BEGIN
  SELECT n.user_id AS recipient,m.* INTO r FROM public.notifications n JOIN public.messages m
    ON n.payload->>'message_id'=m.id::text WHERE n.id=p_notification AND n.kind='message'
      AND n.alert_suppressed_at IS NOT NULL;
  IF NOT FOUND OR coalesce(r.type,'') NOT IN ('image','video') OR nullif(btrim(r.media_url),'') IS NULL
    OR jsonb_typeof(r.media_metadata->'album_id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(r.media_metadata->'album_count') IS DISTINCT FROM 'number'
    OR jsonb_typeof(r.media_metadata->'album_index') IS DISTINCT FROM 'number'
    OR coalesce(r.media_metadata->>'album_id','') !~ '^[A-Za-z0-9][A-Za-z0-9-]{6,78}[A-Za-z0-9]$'
    OR coalesce(r.media_metadata->>'album_count','') !~ '^(10|[2-9])$'
    OR coalesce(r.media_metadata->>'album_index','') !~ '^[0-9]$'
    OR (r.user_id IS NULL)=(r.bot_id IS NULL) THEN RETURN; END IF;
  v_count:=(r.media_metadata->>'album_count')::integer;
  IF (r.media_metadata->>'album_index')::integer>=v_count THEN RETURN; END IF;
  INSERT INTO public.album_push_groups(user_id,chat_id,sender_kind,sender_id,album_id,
    expected_count,first_at,last_at,ready_at,topic_alert_suppressed_at)
    VALUES(r.recipient,r.chat_id,CASE WHEN r.bot_id IS NULL THEN 'user' ELSE 'bot' END,
      coalesce(r.bot_id,r.user_id),r.media_metadata->>'album_id',v_count,clock_timestamp(),
      clock_timestamp(),clock_timestamp(),clock_timestamp()) ON CONFLICT DO NOTHING;
END $fn$;

CREATE FUNCTION private.topic_alert_client_identity() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid:=auth.uid(); j jsonb:=auth.jwt();
BEGIN
  IF u IS NULL OR j->>'role' IS DISTINCT FROM 'authenticated' OR j->>'is_anonymous' IS DISTINCT FROM 'false'
    OR coalesce(j->>'exp','') !~ '^[0-9]{1,12}$'
    OR coalesce(j->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'topic_alert_session_invalid' USING ERRCODE='42501';
  END IF;
  IF (j->>'exp')::bigint<=extract(epoch FROM clock_timestamp()) OR public.is_banned(u)
    OR NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(j->>'session_id')::uuid AND s.user_id=u
      AND s.created_at<=clock_timestamp() AND (s.not_after IS NULL OR s.not_after>clock_timestamp())) THEN
    RAISE EXCEPTION 'topic_alert_session_invalid' USING ERRCODE='42501';
  END IF;
  RETURN u;
END $fn$;

CREATE FUNCTION public.message_notification_alert_decisions(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid,allowed boolean,scope_key text,revision bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid; c uuid; own_id uuid;
BEGIN
  IF p_notification_ids IS NULL OR cardinality(p_notification_ids) NOT BETWEEN 1 AND 100
    OR array_position(p_notification_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_topic_alert_decisions' USING ERRCODE='22023';
  END IF;
  u:=private.topic_alert_client_identity();
  FOR c IN SELECT DISTINCT (n.alert_origin->>'chat_id')::uuid FROM public.notifications n
    WHERE n.user_id=u AND n.id=ANY(p_notification_ids) AND n.alert_origin IS NOT NULL ORDER BY 1 LOOP
    PERFORM private.topic_alert_lock(u,c);
  END LOOP;
  PERFORM private.topic_alert_client_identity();
  FOR own_id IN SELECT n.id FROM public.notifications n
    WHERE n.user_id=u AND n.id=ANY(p_notification_ids) AND n.kind='message' AND n.alert_origin IS NOT NULL ORDER BY n.id LOOP
    PERFORM private.topic_alert_notification_locked(own_id);
  END LOOP;
  PERFORM private.topic_alert_client_identity();
  RETURN QUERY SELECT n.id,coalesce(n.read_at IS NULL AND private.notification_topic_alert_allowed(n.id)
    AND NOT EXISTS(SELECT 1 FROM public.privacy_preferences p WHERE p.user_id=u AND p.manual_status='dnd'
      AND (p.manual_status_until IS NULL OR p.manual_status_until>clock_timestamp())),false),
    CASE WHEN n.alert_origin=private.message_alert_origin(m.id) AND n.payload->>'chat_id'=m.chat_id::text
      AND private.message_notification_visible_to(m.id,u) THEN n.alert_origin->>'scope_key' END,
    CASE WHEN n.alert_origin=private.message_alert_origin(m.id) AND n.payload->>'chat_id'=m.chat_id::text
      AND private.message_notification_visible_to(m.id,u) THEN coalesce(p.revision,0) END
    FROM public.notifications n LEFT JOIN public.messages m ON n.payload->>'message_id'=m.id::text
    LEFT JOIN public.topic_notification_preferences p ON p.user_id=u AND p.chat_id=m.chat_id
      AND p.scope_key=n.alert_origin->>'scope_key'
    WHERE n.user_id=u AND n.id=ANY(p_notification_ids) ORDER BY n.id;
END $fn$;

-- No reliable historical admission tuple exists. Retire old alerts only.
UPDATE public.notifications SET alert_origin=NULL,alert_suppressed_at=clock_timestamp() WHERE kind='message';

CREATE FUNCTION private.topic_alert_patch(p_function regprocedure,p_old text,p_new text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog
AS $fn$
DECLARE ddl text:=pg_get_functiondef(p_function);
BEGIN
  IF array_length(string_to_array(ddl,p_old),1)<>2 THEN RAISE EXCEPTION 'topic_delivery_anchor_drift:%',p_function; END IF;
  EXECUTE replace(ddl,p_old,p_new);
END $fn$;

DO $patch$
DECLARE r record; preamble text;
BEGIN
  PERFORM private.topic_alert_patch('public.enqueue_message_notifications()',
    '  v_sender_kind text;',E'  v_topic_recipients uuid[];\n  v_sender_kind text;');
  PERFORM private.topic_alert_patch('public.enqueue_message_notifications()',
    '  -- In-app notifications remain the source of truth.',
    E'  SELECT array_agg(user_id ORDER BY user_id) INTO v_topic_recipients FROM public.chat_members WHERE chat_id=new.chat_id;\n  PERFORM private.topic_alert_lock_chat(new.chat_id);\n  -- In-app notifications remain the source of truth.');
  PERFORM private.topic_alert_patch('public.enqueue_message_notifications()',
    '  where member_row.chat_id = new.chat_id',
    E'  where member_row.chat_id = new.chat_id\n    AND member_row.user_id=ANY(v_topic_recipients)');
  PERFORM private.topic_alert_patch('public.enqueue_message_notifications()',
    '  on conflict do nothing;',E'  ORDER BY member_row.user_id\n  on conflict do nothing;');
  PERFORM private.topic_alert_patch('public._enqueue_push_after_notification_insert()',E'begin\n  if not public._notification_push_allowed',
    E'begin\n  IF new.kind=''message'' THEN\n    PERFORM private.topic_alert_unhandled_album(new.id);\n    PERFORM private.topic_alert_reconcile_notification(new.id);\n    IF NOT private.notification_topic_alert_allowed(new.id) THEN RETURN NULL; END IF;\n  END IF;\n  if not public._notification_push_allowed');
  PERFORM private.topic_alert_patch('public._enqueue_push_after_notification_insert()',
    '  v_payload := public._notification_push_payload(new.kind, new.payload);',
    E'  IF new.kind=''message'' AND NOT private.notification_topic_alert_allowed(new.id) THEN RETURN NULL; END IF;\n  v_payload := public._notification_push_payload(new.kind, new.payload);');
  PERFORM private.topic_alert_patch('public._enqueue_push_after_notification_insert()',
    '    exception when others then',
    E'    exception when transaction_rollback or lock_not_available then\n      RAISE;\n    when others then');
  PERFORM private.topic_alert_patch('public.album_push_enqueue(uuid)',E'begin\n',
    E'begin\n  PERFORM private.topic_alert_reconcile_notification(p_notification_id);\n  IF EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification_id AND n.kind=''message'' AND NOT private.notification_topic_alert_allowed(n.id)) THEN RETURN true; END IF;\n');
  PERFORM private.topic_alert_patch('public.album_push_enqueue(uuid)',
    '  for update;', '  for update nowait;');
  -- Bound takes ONLY the source/account boundary before its target lock.
  -- Its maintained delegate reconciles under that lock; unbound still does so
  -- at entry. Never settle sibling outboxes before acquiring the target.
  FOR r IN SELECT * FROM (VALUES
    ('public.push_outbox_delivery_recheck(uuid,uuid)','notifications_push_outbox'),
    ('public.native_push_outbox_delivery_recheck(uuid,uuid)','notifications_native_push_outbox'),
    ('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','notifications_push_outbox')
  ) x(signature,outbox) LOOP
    IF r.signature LIKE '%_bound(%' THEN
      preamble:=format(E'  PERFORM private.topic_alert_lock(n.user_id,(n.alert_origin->>''chat_id'')::uuid) FROM public.%I o JOIN public.notifications n ON n.id=o.notification_id WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token AND o.subscription_id=p_subscription_id AND o.sent_at IS NULL AND o.suppressed_at IS NULL AND n.kind=''message'' AND n.alert_origin IS NOT NULL;\n',r.outbox);
    ELSE
      preamble:=format(E'  PERFORM private.topic_alert_reconcile_notification(n.id) FROM public.%I o JOIN public.notifications n ON n.id=o.notification_id WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token AND n.kind=''message'';\n',r.outbox);
    END IF;
    PERFORM private.topic_alert_patch(r.signature::regprocedure,
      CASE WHEN r.signature LIKE '%_bound(%' THEN E'BEGIN\n' ELSE E'begin\n' END,
      CASE WHEN r.signature LIKE '%_bound(%' THEN E'BEGIN\n' ELSE E'begin\n' END||preamble);
    PERFORM private.topic_alert_patch(r.signature::regprocedure,
      CASE WHEN r.signature LIKE '%_bound(%' THEN '    FOR UPDATE OF o;' ELSE '  for update of o;' END,
      CASE WHEN r.signature LIKE '%_bound(%' THEN '    FOR UPDATE OF o NOWAIT;' ELSE '  for update of o nowait;' END);
  END LOOP;
  PERFORM private.topic_alert_patch('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)',
    'FOR SHARE OF s;', 'FOR SHARE OF s NOWAIT;');
  PERFORM private.topic_alert_patch('public.album_push_recheck(uuid,uuid)',E'begin\n',
    E'begin\n  PERFORM private.topic_alert_reconcile_group(o.group_id) FROM public.notifications_album_push_outbox o WHERE o.id=p_outbox_id AND o.claim_token=p_claim_token;\n');
  PERFORM private.topic_alert_patch('public.album_push_recheck(uuid,uuid)',
    '  for update of o;', '  for update of o nowait;');
  PERFORM private.topic_alert_patch('public.album_push_recheck(uuid,uuid)',
    '      and private.message_notification_visible_to(m.id, v_outbox.user_id)',
    E'      and private.notification_topic_alert_allowed(n.id)\n      and private.message_notification_visible_to(m.id, v_outbox.user_id)');
  PERFORM private.topic_alert_patch('public.push_outbox_delivery_recheck(uuid,uuid)',
    '  if v_note_owner is distinct from v_user_id',
    E'  if NOT EXISTS(SELECT 1 FROM public.notifications_push_outbox o JOIN public.notifications n ON n.id=o.notification_id WHERE o.id=p_outbox_id AND n.alert_suppressed_at IS NULL AND (v_kind<>''message'' OR private.notification_topic_alert_allowed(o.notification_id)))\n      OR v_note_owner is distinct from v_user_id');
  PERFORM private.topic_alert_patch('public.native_push_outbox_delivery_recheck(uuid,uuid)',
    '  if not public._notification_push_allowed(v_user_id, v_kind, v_payload) then',
    E'  if NOT EXISTS(SELECT 1 FROM public.notifications_native_push_outbox o JOIN public.notifications n ON n.id=o.notification_id WHERE o.id=p_outbox_id AND n.alert_suppressed_at IS NULL AND (v_kind<>''message'' OR private.notification_topic_alert_allowed(o.notification_id)))\n      OR not public._notification_push_allowed(v_user_id, v_kind, v_payload) then');
  PERFORM private.topic_alert_patch('public.native_message_notification_preview(uuid,uuid)',
    '    and n.id = p_notification_id and n.kind = ''message'' and n.read_at is null',
    E'    and n.id = p_notification_id and n.kind = ''message'' and n.read_at is null\n    AND private.notification_topic_alert_allowed(n.id)');
END $patch$;
DROP FUNCTION private.topic_alert_patch(regprocedure,text,text);

REVOKE ALL ON FUNCTION public.message_notification_alert_decisions(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.message_notification_alert_decisions(uuid[]) TO authenticated;
DO $security$
DECLARE r record; f regprocedure; role_name text;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='private'::regnamespace
    AND (p.proname LIKE 'topic_alert_%' OR p.proname IN ('message_alert_origin','notification_topic_alert_allowed')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);
  END LOOP;
  -- Explicit ACLs for the composed public boundaries; table grants/read_at are untouched.
  FOR r IN SELECT * FROM (VALUES
    ('public.enqueue_message_notifications()','search_path=""',NULL),
    ('public._enqueue_push_after_notification_insert()','search_path=pg_catalog',NULL),
    ('public.album_push_enqueue(uuid)','search_path=pg_catalog',NULL),
    ('public.album_push_recheck(uuid,uuid)','search_path=pg_catalog','service_role'),
    ('public.push_outbox_delivery_recheck(uuid,uuid)','search_path=public, pg_temp','service_role'),
    ('public.native_push_outbox_delivery_recheck(uuid,uuid)','search_path=pg_catalog','service_role'),
    ('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','search_path=pg_catalog','service_role'),
    ('public.native_message_notification_preview(uuid,uuid)','search_path=pg_catalog','authenticated')
  ) x(signature,fixed_path,executor) LOOP
    f:=r.signature::regprocedure;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
    IF r.executor IS NOT NULL THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f,r.executor); END IF;
    IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND (proowner<>'postgres'::regrole
      OR NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY[r.fixed_path])) THEN
      RAISE EXCEPTION 'topic_delivery_security_failed:%',f;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(role_name,f,'EXECUTE') IS DISTINCT FROM coalesce(role_name=r.executor,false) THEN
        RAISE EXCEPTION 'topic_delivery_security_failed:%',f;
      END IF;
    END LOOP;
  END LOOP;
  FOR r IN SELECT user_id,(alert_origin->>'chat_id')::uuid AS chat_id FROM public.notifications
    WHERE kind='message' AND alert_origin IS NOT NULL GROUP BY 1,2 ORDER BY 1,2 LOOP
    PERFORM private.topic_alert_refresh(r.user_id,r.chat_id);
  END LOOP;
  -- Historical rows have NULL origin: retire their pending targets explicitly.
  UPDATE public.notifications_push_outbox o SET suppressed_at=clock_timestamp(),suppression_reason=NULL,
    claim_token=NULL,claimed_until=NULL FROM public.notifications n
    WHERE n.id=o.notification_id AND n.alert_suppressed_at IS NOT NULL AND o.sent_at IS NULL AND o.suppressed_at IS NULL;
  UPDATE public.notifications_native_push_outbox o SET sent_at=clock_timestamp(),last_error='suppressed:not_eligible',
    claim_token=NULL,claimed_until=NULL FROM public.notifications n
    WHERE n.id=o.notification_id AND n.alert_suppressed_at IS NOT NULL AND o.sent_at IS NULL;
  UPDATE public.album_push_groups g SET topic_alert_suppressed_at=clock_timestamp()
    WHERE NOT EXISTS(SELECT 1 FROM public.album_push_members am WHERE am.group_id=g.id AND private.notification_topic_alert_allowed(am.notification_id));
  UPDATE public.notifications_album_push_outbox o SET suppressed_at=clock_timestamp(),suppression_reason='not_eligible',
    claim_token=NULL,claimed_until=NULL FROM public.album_push_groups g
    WHERE g.id=o.group_id AND g.topic_alert_suppressed_at IS NOT NULL AND o.sent_at IS NULL AND o.suppressed_at IS NULL;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE
    (p.pronamespace='private'::regnamespace AND (p.proname LIKE 'topic_alert_%' OR p.proname IN ('message_alert_origin','notification_topic_alert_allowed')))
    OR p.oid='public.message_notification_alert_decisions(uuid[])'::regprocedure LOOP
    IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND (proowner<>'postgres'::regrole
      OR proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR prosecdef IS DISTINCT FROM (proname NOT IN ('topic_alert_columns_guard','topic_alert_group_guard'))))
      OR has_function_privilege('anon',f,'EXECUTE')
      OR has_function_privilege('service_role',f,'EXECUTE')
      OR has_function_privilege('authenticated',f,'EXECUTE') IS DISTINCT FROM
        (f='public.message_notification_alert_decisions(uuid[])'::regprocedure) THEN
      RAISE EXCEPTION 'topic_delivery_security_failed:%',f;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.notifications','topic_alert_columns_guard'),('public.notifications','topic_alert_admit'),
    ('public.album_push_groups','topic_alert_group_guard'),
    ('public.chat_notification_preferences','topic_alert_parent_before'),
    ('public.chat_notification_preferences','topic_alert_parent_after'),
    ('public.topic_notification_preferences','topic_alert_child_after'),
    ('public.messages','topic_alert_message_change'),('public.topics','topic_alert_topic_change'),
    ('public.chat_members','topic_alert_member_change')
  ) x(relation,trigger_name) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=r.relation::regclass
      AND tgname=r.trigger_name AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'topic_delivery_security_failed:trigger:%',r.trigger_name;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_publication p WHERE p.pubname='supabase_realtime'
      AND p.pubowner='postgres'::regrole AND NOT p.puballtables)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.topics'::regclass,'public.notifications'::regclass,
      'public.topic_notification_preferences'::regclass]) required(relation)
      WHERE NOT EXISTS(SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
        WHERE p.pubname='supabase_realtime' AND pr.prrelid=required.relation))
    OR NOT EXISTS(SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
      WHERE p.pubname='supabase_realtime' AND pr.prrelid='public.topic_notification_preferences'::regclass
        AND pr.prqual IS NULL AND pr.prattrs IS NULL)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.topic_notification_preferences'::regclass) THEN
    RAISE EXCEPTION 'topic_delivery_publication_selfcheck_failed';
  END IF;
END $security$;

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
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

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $prestate$
DECLARE r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:notification-feed-v2',0))
    OR to_regclass('public.notification_feed_events_v2') IS NOT NULL
    OR to_regclass('private.notification_feed_fences_v2') IS NOT NULL
    OR NOT has_table_privilege('postgres','auth.users','SELECT')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.chat_members'::regclass
      AND confrelid='public.chats'::regclass AND contype='f' AND confdeltype='c' AND convalidated
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.chat_members'::regclass AND attname='chat_id')]::smallint[]
      AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.chats'::regclass AND attname='id')]::smallint[])
    OR EXISTS(SELECT 1 FROM pg_proc p WHERE
      (p.pronamespace='private'::regnamespace AND p.proname LIKE 'notification_feed_%_v2')
      OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'notification_feed_%_v2'))
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.notifications'::regclass
      AND relowner='postgres'::regrole AND relrowsecurity AND NOT relforcerowsecurity AND relreplident='d')
    OR (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped)
      IS DISTINCT FROM '[ ["id","uuid",true,"gen_random_uuid()"], ["user_id","uuid",true,null],
        ["kind","text",true,null], ["payload","jsonb",true,"\u0027{}\u0027::jsonb"],
        ["read_at","timestamp with time zone",false,null], ["created_at","timestamp with time zone",true,"now()"],
        ["alert_suppressed_at","timestamp with time zone",false,null], ["alert_origin","jsonb",false,null] ]'::jsonb
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.notifications'::regclass
      AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.notifications'::regclass)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
      AND polname='Owner reads own notifications' AND polcmd='r' AND polpermissive
      AND polroles=ARRAY['authenticated'::regrole::oid] AND polwithcheck IS NULL
      AND pg_get_expr(polqual,polrelid)='(user_id = auth.uid())')
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
      AND polname='message notification source remains readable' AND polcmd='r' AND NOT polpermissive
      AND polroles=ARRAY['authenticated'::regrole::oid] AND polwithcheck IS NULL
      AND pg_get_expr(polqual,polrelid)=$expected$((kind <> 'message'::text) OR
CASE
    WHEN ((payload ->> 'message_id'::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN public.message_notification_visible(((payload ->> 'message_id'::text))::uuid)
    ELSE false
END)$expected$)
    OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.notifications'::regclass AND indisprimary
      AND indisvalid AND indnkeyatts=1 AND indkey[0]=(SELECT attnum FROM pg_attribute
        WHERE attrelid='public.notifications'::regclass AND attname='id'))
    OR NOT EXISTS(SELECT 1 FROM pg_publication p JOIN pg_publication_rel pr ON pr.prpubid=p.oid
      WHERE p.pubname='supabase_realtime' AND p.pubowner='postgres'::regrole AND NOT p.puballtables
        AND p.pubinsert AND p.pubupdate AND p.pubdelete AND pr.prrelid='public.notifications'::regclass
        AND pr.prqual IS NULL AND pr.prattrs IS NULL)
    OR (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
      WHERE tgrelid='public.notifications'::regclass AND NOT tgisinternal AND tgenabled='O')
      IS DISTINCT FROM ARRAY['topic_alert_admit','topic_alert_columns_guard','trg_enqueue_push_after_notification_insert'] THEN
    RAISE EXCEPTION 'notification_feed_v2_prestate_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('anon',ARRAY['DELETE','INSERT','SELECT','UPDATE']),
    ('authenticated',ARRAY['DELETE','INSERT','SELECT','UPDATE']),
    ('service_role',ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'])
  ) expected(role_name,privileges) LOOP
    IF (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.notifications'::regclass AND a.grantee=r.role_name::regrole AND NOT a.is_grantable)
      IS DISTINCT FROM r.privileges THEN RAISE EXCEPTION 'notification_feed_v2_acl_drift'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid='public.notifications'::regclass AND (a.grantee NOT IN (c.relowner,'anon'::regrole,
      'authenticated'::regrole,'service_role'::regrole) OR a.is_grantable)) THEN
    RAISE EXCEPTION 'notification_feed_v2_acl_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.topic_notification_preference_set(uuid,uuid,text,bigint)','e8768733330df74dd3f54f51e734553d35fbe94ee1472900de81695a9d2e8b93'),
    ('private.topic_alert_client_identity()','a629e70064fac1c8811bbe94b88e9f1a19b3be705d72ab0f016f685c2a7586d2'),
    ('public.message_notification_visible(uuid)','a18177032cf3ee5231d952657b5045b8c9f211276a3700da5874d5e14c5adb86'),
    ('private.message_notification_visible_to(uuid,uuid)','e974c6067c13c6be86e35c594b46acd773fbb54ef6e08051b396fced974a1570')
  ) pins(signature,hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(r.signature)
      AND proowner='postgres'::regrole AND prosecdef
      AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')=r.hash) THEN
      RAISE EXCEPTION 'notification_feed_v2_function_drift';
    END IF;
  END LOOP;
END $prestate$;

SET LOCAL ROLE postgres;
ALTER TABLE public.notifications ADD COLUMN feed_revision bigint NOT NULL DEFAULT '1'::bigint
  CONSTRAINT notification_feed_revision_range_v2 CHECK(feed_revision BETWEEN 1 AND 9007199254740991);
CREATE FUNCTION private.notification_feed_revision_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.feed_revision IS DISTINCT FROM 1::bigint THEN
      RAISE EXCEPTION 'notification_feed_v2_revision_owned' USING ERRCODE='42501';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.feed_revision IS DISTINCT FROM OLD.feed_revision THEN
      RAISE EXCEPTION 'notification_feed_v2_revision_owned' USING ERRCODE='42501';
    END IF;
    IF ROW(NEW.id,NEW.user_id,NEW.kind,NEW.payload,NEW.read_at,NEW.created_at,NEW.alert_suppressed_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.kind,OLD.payload,OLD.read_at,OLD.created_at,OLD.alert_suppressed_at) THEN
      IF OLD.feed_revision>=9007199254740991 THEN
        RAISE EXCEPTION 'notification_feed_v2_revision_exhausted' USING ERRCODE='22003';
      END IF;
      NEW.feed_revision:=OLD.feed_revision+1;
    END IF;
  ELSE RAISE EXCEPTION 'notification_feed_v2_revision_owned' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $fn$;
-- PostgreSQL orders same-kind BEFORE triggers by name. Observe the final Task3
-- admission/terminal fields, without another row lookup or reverse barrier.
CREATE TRIGGER zz_notification_feed_revision_v2 BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.notification_feed_revision_v2();

CREATE TABLE private.notification_feed_fences_v2(
  recipient_id uuid PRIMARY KEY,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.notification_feed_fences_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.notification_feed_fences_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.notification_feed_events_v2(
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  notification_id uuid,
  event_kind text NOT NULL CHECK(event_kind IN ('created','changed','removed','invalidate')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((event_kind='invalidate')=(notification_id IS NULL))
);
ALTER TABLE public.notification_feed_events_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_feed_events_v2 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.notification_feed_events_v2 TO authenticated;
CREATE INDEX notification_feed_events_v2_retention ON public.notification_feed_events_v2(created_at,event_id);
CREATE INDEX notification_feed_events_v2_recipient ON public.notification_feed_events_v2(recipient_id);

CREATE FUNCTION private.notification_feed_identity_v2() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  RETURN private.topic_alert_client_identity();
END $fn$;
CREATE FUNCTION private.notification_feed_legacy_allowed_v2() RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT NOT EXISTS(SELECT 1 FROM private.notification_feed_fences_v2 WHERE recipient_id=auth.uid());
$fn$;
CREATE POLICY "own live notification feed events v2" ON public.notification_feed_events_v2
  FOR SELECT TO authenticated USING(recipient_id=(SELECT private.notification_feed_identity_v2()));
CREATE POLICY "activated accounts require notification feed v2" ON public.notifications AS RESTRICTIVE
  FOR SELECT TO authenticated USING((SELECT private.notification_feed_legacy_allowed_v2()));

CREATE FUNCTION private.notification_feed_immutable_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF TG_TABLE_SCHEMA='private' AND TG_TABLE_NAME='notification_feed_fences_v2' AND TG_OP='DELETE'
    AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.recipient_id)
    AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=OLD.recipient_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'notification_feed_v2_immutable' USING ERRCODE='42501';
END $fn$;
CREATE TRIGGER notification_feed_fence_immutable BEFORE UPDATE OR DELETE ON private.notification_feed_fences_v2
  FOR EACH ROW EXECUTE FUNCTION private.notification_feed_immutable_v2();
CREATE TRIGGER notification_feed_event_immutable BEFORE UPDATE ON public.notification_feed_events_v2
  FOR EACH ROW EXECUTE FUNCTION private.notification_feed_immutable_v2();

CREATE FUNCTION private.notification_feed_activate_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  INSERT INTO public.notification_feed_events_v2(recipient_id,event_kind) VALUES(NEW.recipient_id,'invalidate');
  RETURN NULL;
END $fn$;
CREATE TRIGGER notification_feed_activation AFTER INSERT ON private.notification_feed_fences_v2
  FOR EACH ROW EXECUTE FUNCTION private.notification_feed_activate_v2();

-- Transition tables coalesce signals without shared counters/cursors or account locks.
CREATE FUNCTION private.notification_feed_emit_insert_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  INSERT INTO public.notification_feed_events_v2(recipient_id,notification_id,event_kind)
    SELECT user_id,CASE WHEN count(*)=1 THEN (array_agg(id ORDER BY id))[1] END,
      CASE WHEN count(*)=1 THEN 'created' ELSE 'invalidate' END FROM feed_new GROUP BY user_id;
  RETURN NULL;
END $fn$;
CREATE FUNCTION private.notification_feed_emit_update_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  WITH changed AS (
    SELECT o.id AS old_id,o.user_id AS old_user,n.id AS new_id,n.user_id AS new_user
    FROM feed_old o FULL JOIN feed_new n ON n.id=o.id WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n)
  ), signals AS (
    SELECT old_user AS recipient_id,old_id AS notification_id,'removed'::text AS event_kind FROM changed
      WHERE old_id IS NOT NULL AND (new_id IS NULL OR old_user IS DISTINCT FROM new_user)
    UNION ALL SELECT new_user,NULL::uuid,'invalidate' FROM changed
      WHERE new_id IS NOT NULL AND (old_id IS NULL OR old_user IS DISTINCT FROM new_user)
    UNION ALL SELECT new_user,new_id,'changed' FROM changed
      WHERE new_id IS NOT NULL AND old_id IS NOT NULL AND old_user=new_user
  ) INSERT INTO public.notification_feed_events_v2(recipient_id,notification_id,event_kind)
    SELECT recipient_id,CASE WHEN count(*)=1 THEN (array_agg(notification_id))[1] END,
      CASE WHEN count(*)=1 THEN (array_agg(event_kind))[1] ELSE 'invalidate' END
    FROM signals GROUP BY recipient_id;
  RETURN NULL;
END $fn$;
CREATE FUNCTION private.notification_feed_emit_delete_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  INSERT INTO public.notification_feed_events_v2(recipient_id,notification_id,event_kind)
    SELECT user_id,CASE WHEN count(*)=1 THEN (array_agg(id ORDER BY id))[1] END,
      CASE WHEN count(*)=1 THEN 'removed' ELSE 'invalidate' END FROM feed_old GROUP BY user_id;
  RETURN NULL;
END $fn$;
CREATE TRIGGER notification_feed_insert_v2 AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS feed_new FOR EACH STATEMENT EXECUTE FUNCTION private.notification_feed_emit_insert_v2();
CREATE TRIGGER notification_feed_update_v2 AFTER UPDATE ON public.notifications
  REFERENCING OLD TABLE AS feed_old NEW TABLE AS feed_new FOR EACH STATEMENT EXECUTE FUNCTION private.notification_feed_emit_update_v2();
CREATE TRIGGER notification_feed_delete_v2 AFTER DELETE ON public.notifications
  REFERENCING OLD TABLE AS feed_old FOR EACH STATEMENT EXECUTE FUNCTION private.notification_feed_emit_delete_v2();

-- No notification-history lookup, reconciliation, cursor or row/advisory lock.
-- The key projections below are exactly the captured visibility dependencies.
-- Existing chat_members->chats CASCADE supplies OLD recipients on chat deletion.
CREATE FUNCTION private.notification_feed_access_signal_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE fields text; recipient text; changed text; recipients text;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' THEN RAISE EXCEPTION 'notification_feed_v2_source_refused'; END IF;
  CASE TG_TABLE_NAME
    WHEN 'chat_members' THEN fields:='user_id,chat_id,joined_at,hidden_at,cleared_at';recipient:='user_id';
    WHEN 'message_hidden_for_users' THEN fields:='user_id,message_id';recipient:='user_id';
    WHEN 'user_blocks' THEN fields:='blocker_id,blocked_id';recipient:='blocker_id';
    WHEN 'bans' THEN fields:='user_id,expires_at';recipient:='user_id';
    WHEN 'messages' THEN fields:='id,chat_id,user_id,bot_id,type,created_at,topic_id,deleted_at';
    WHEN 'topics' THEN fields:='id,chat_id';
    ELSE RAISE EXCEPTION 'notification_feed_v2_source_refused';
  END CASE;
  IF TG_OP='INSERT' THEN changed:=format('SELECT %s FROM access_new',fields);
  ELSIF TG_OP='DELETE' THEN changed:=format('SELECT %s FROM access_old',fields);
  ELSIF TG_OP='UPDATE' THEN changed:=format(
    '(SELECT %1$s FROM access_old EXCEPT SELECT %1$s FROM access_new) UNION (SELECT %1$s FROM access_new EXCEPT SELECT %1$s FROM access_old)',fields);
  ELSE RAISE EXCEPTION 'notification_feed_v2_source_refused'; END IF;
  IF recipient IS NOT NULL THEN recipients:=format('SELECT DISTINCT %I AS recipient_id FROM changed',recipient);
  ELSE recipients:='SELECT DISTINCT cm.user_id AS recipient_id FROM public.chat_members cm JOIN changed c ON c.chat_id=cm.chat_id'; END IF;
  EXECUTE 'WITH changed AS ('||changed||'), recipients AS ('||recipients||')
    INSERT INTO public.notification_feed_events_v2(recipient_id,event_kind)
    SELECT recipient_id,''invalidate'' FROM recipients WHERE recipient_id IS NOT NULL';
  RETURN NULL;
END $fn$;

DO $source_triggers$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['chat_members','message_hidden_for_users','user_blocks','bans','messages','topics'] LOOP
    -- Ordinary source creation already has the exact notification-created
    -- signal. A later unscoped INSERT invalidate would cancel that admission.
    -- Explicit deny-table INSERTs still invalidate retained read/terminal rows.
    IF relation NOT IN ('messages','topics') THEN
      EXECUTE format('CREATE TRIGGER notification_feed_access_insert_v2 AFTER INSERT ON public.%I
        REFERENCING NEW TABLE AS access_new FOR EACH STATEMENT EXECUTE FUNCTION private.notification_feed_access_signal_v2()',relation);
    END IF;
    EXECUTE format('CREATE TRIGGER notification_feed_access_update_v2 AFTER UPDATE ON public.%I
      REFERENCING OLD TABLE AS access_old NEW TABLE AS access_new FOR EACH STATEMENT EXECUTE FUNCTION private.notification_feed_access_signal_v2()',relation);
    EXECUTE format('CREATE TRIGGER notification_feed_access_delete_v2 AFTER DELETE ON public.%I
      REFERENCING OLD TABLE AS access_old FOR EACH STATEMENT EXECUTE FUNCTION private.notification_feed_access_signal_v2()',relation);
  END LOOP;
END $source_triggers$;

-- Explicitly replicate the two pinned existing SELECT policies, not the new
-- legacy fence. SECURITY DEFINER must not turn owner/source checks into bypass.
CREATE FUNCTION private.notification_feed_visible_v2(n public.notifications,u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
  SELECT n.user_id=u AND (n.kind<>'message' OR CASE
    WHEN n.payload->>'message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.message_notification_visible((n.payload->>'message_id')::uuid) ELSE false END);
$fn$;

CREATE FUNCTION public.notification_feed_page_v2(p_limit integer DEFAULT 30,
  p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid; result jsonb; cursor jsonb:=NULL;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30
    OR (p_before_created_at IS NULL)<>(p_before_id IS NULL)
    OR (p_before_created_at IS NOT NULL AND NOT isfinite(p_before_created_at)) THEN
    RAISE EXCEPTION 'invalid_notification_feed_page_v2' USING ERRCODE='22023';
  END IF;
  u:=private.topic_alert_client_identity();
  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC,n.id DESC),'[]'::jsonb) INTO result FROM (
    SELECT n.id,n.user_id,n.kind,n.payload,n.read_at,n.created_at,n.alert_suppressed_at,n.feed_revision FROM public.notifications n
    WHERE private.notification_feed_visible_v2(n,u)
      AND (p_before_created_at IS NULL OR (n.created_at,n.id)<(p_before_created_at,p_before_id))
    ORDER BY n.created_at DESC,n.id DESC LIMIT p_limit+1
  ) n;
  IF jsonb_array_length(result)>p_limit THEN
    result:=result-p_limit;
    cursor:=jsonb_build_object('created_at',result->(p_limit-1)->'created_at','id',result->(p_limit-1)->'id');
  END IF;
  PERFORM private.topic_alert_client_identity();
  RETURN jsonb_build_object('v',2,'rows',result,'next',cursor);
END $fn$;

CREATE FUNCTION public.notification_feed_lookup_v2(p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid; result jsonb; unavailable jsonb;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 100 OR array_ndims(p_ids)<>1
    OR array_position(p_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_notification_feed_lookup_v2' USING ERRCODE='22023';
  END IF;
  u:=private.topic_alert_client_identity();
  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC,n.id DESC),'[]'::jsonb) INTO result FROM (
    SELECT n.id,n.user_id,n.kind,n.payload,n.read_at,n.created_at,n.alert_suppressed_at,n.feed_revision FROM public.notifications n
    WHERE n.id=ANY(p_ids) AND private.notification_feed_visible_v2(n,u)
  ) n;
  SELECT coalesce(jsonb_agg(x.id ORDER BY x.id),'[]'::jsonb) INTO unavailable
    FROM (SELECT DISTINCT unnest(p_ids) AS id) x
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) row WHERE row->>'id'=x.id::text);
  PERFORM private.topic_alert_client_identity();
  RETURN jsonb_build_object('v',2,'rows',result,'unavailable_ids',unavailable);
END $fn$;

CREATE FUNCTION public.notification_feed_open_v2(p_limit integer DEFAULT 30,p_held_ids uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE u uuid; marker uuid; page jsonb; lookup jsonb;
BEGIN
  IF p_held_ids IS NULL OR cardinality(p_held_ids)>100
    OR (cardinality(p_held_ids)>0 AND (array_ndims(p_held_ids)<>1 OR array_position(p_held_ids,NULL) IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid_notification_feed_open_v2' USING ERRCODE='22023';
  END IF;
  u:=private.topic_alert_client_identity();
  INSERT INTO public.notification_feed_events_v2(recipient_id,event_kind) VALUES(u,'invalidate') RETURNING event_id INTO marker;
  page:=public.notification_feed_page_v2(p_limit);
  lookup:=CASE WHEN cardinality(p_held_ids)=0 THEN jsonb_build_object('v',2,'rows','[]'::jsonb,'unavailable_ids','[]'::jsonb)
    ELSE public.notification_feed_lookup_v2(p_held_ids) END;
  PERFORM private.topic_alert_client_identity();
  RETURN jsonb_build_object('v',2,'barrier_event_id',marker,'page',page,'lookup',lookup);
END $fn$;

CREATE FUNCTION public.notification_feed_cleanup_v2(p_limit integer DEFAULT 1000) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE removed integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_notification_feed_cleanup_v2' USING ERRCODE='22023';
  END IF;
  WITH expired AS (SELECT event_id FROM public.notification_feed_events_v2
    WHERE created_at<clock_timestamp()-interval '24 hours' ORDER BY created_at,event_id LIMIT p_limit FOR UPDATE SKIP LOCKED)
  DELETE FROM public.notification_feed_events_v2 e USING expired x WHERE e.event_id=x.event_id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END $fn$;

CREATE FUNCTION public.notification_feed_retire_account_v2(p_recipient_id uuid,p_limit integer DEFAULT 1000) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE removed integer; remaining boolean;
BEGIN
  IF p_recipient_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_notification_feed_account_cleanup_v2' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_recipient_id)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id=p_recipient_id) THEN
    RAISE EXCEPTION 'notification_feed_v2_account_still_exists' USING ERRCODE='55000';
  END IF;
  WITH expired AS (SELECT event_id FROM public.notification_feed_events_v2 WHERE recipient_id=p_recipient_id
    ORDER BY created_at,event_id LIMIT p_limit FOR UPDATE SKIP LOCKED)
  DELETE FROM public.notification_feed_events_v2 e USING expired x WHERE e.event_id=x.event_id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  remaining:=EXISTS(SELECT 1 FROM public.notification_feed_events_v2 WHERE recipient_id=p_recipient_id);
  IF NOT remaining THEN DELETE FROM private.notification_feed_fences_v2 WHERE recipient_id=p_recipient_id; END IF;
  RETURN jsonb_build_object('removed',removed,'remaining',remaining);
END $fn$;

DO $patch_setter$
DECLARE ddl text:=pg_get_functiondef('public.topic_notification_preference_set(uuid,uuid,text,bigint)'::regprocedure);
  anchor text:=$anchor$  RETURN jsonb_build_object('status','applied','scope_key',v_scope,'mode',p_mode,$anchor$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1)<>2 THEN RAISE EXCEPTION 'notification_feed_v2_setter_anchor_drift'; END IF;
  EXECUTE replace(ddl,anchor,$replacement$  IF p_mode IN ('enabled','disabled') THEN
    INSERT INTO private.notification_feed_fences_v2(recipient_id) VALUES(v_user) ON CONFLICT DO NOTHING;
  END IF;
$replacement$||anchor);
END $patch_setter$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_feed_events_v2;

DO $security$
DECLARE f regprocedure; exposed boolean; executor text; r record; relation text; operation text;
BEGIN
  FOR r IN SELECT p.oid,p.pronamespace,p.proname FROM pg_proc p WHERE
    (p.pronamespace='private'::regnamespace AND p.proname LIKE 'notification_feed_%_v2')
    OR (p.pronamespace='public'::regnamespace AND p.proname IN ('notification_feed_page_v2',
      'notification_feed_lookup_v2','notification_feed_open_v2','notification_feed_cleanup_v2','notification_feed_retire_account_v2')) LOOP
    f:=r.oid::regprocedure;
    exposed:=r.pronamespace='public'::regnamespace OR r.proname IN ('notification_feed_identity_v2','notification_feed_legacy_allowed_v2');
    executor:=CASE WHEN r.proname IN ('notification_feed_cleanup_v2','notification_feed_retire_account_v2') THEN 'service_role' ELSE 'authenticated' END;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
    IF exposed THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f,executor); END IF;
    IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND (proowner<>'postgres'::regrole
      OR proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR prosecdef IS DISTINCT FROM (proname<>'notification_feed_visible_v2')))
      OR has_function_privilege('anon',f,'EXECUTE')
      OR has_function_privilege('authenticated',f,'EXECUTE') IS DISTINCT FROM (exposed AND executor='authenticated')
      OR has_function_privilege('service_role',f,'EXECUTE') IS DISTINCT FROM (exposed AND executor='service_role')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=f AND a.grantee<>p.proowner AND (NOT exposed OR a.grantee<>executor::regrole OR a.is_grantable)) THEN
      RAISE EXCEPTION 'notification_feed_v2_security_failed';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.notification_feed_events_v2'::regclass,
      'private.notification_feed_fences_v2'::regclass) AND (relowner<>'postgres'::regrole OR NOT relrowsecurity OR relreplident<>'d'))
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.notification_feed_events_v2'::regclass,
      'private.notification_feed_fences_v2'::regclass) AND contype='f')
    OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid='public.notification_feed_events_v2'::regclass AND indisprimary
      AND indnkeyatts=1 AND indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='public.notification_feed_events_v2'::regclass AND attname='event_id'))
    OR NOT EXISTS(SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
      WHERE p.pubname='supabase_realtime' AND pr.prrelid='public.notification_feed_events_v2'::regclass AND pr.prqual IS NULL AND pr.prattrs IS NULL)
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.notifications'::regclass
      AND polname='activated accounts require notification feed v2' AND NOT polpermissive AND polcmd='r'
      AND polroles=ARRAY['authenticated'::regrole::oid])
    OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid IN ('public.notification_feed_events_v2'::regclass,'private.notification_feed_fences_v2'::regclass)
      AND a.grantee<>c.relowner AND (c.oid='private.notification_feed_fences_v2'::regclass
        OR a.grantee<>'authenticated'::regrole OR a.privilege_type<>'SELECT' OR a.is_grantable))
    OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
      WHERE attrelid='public.notification_feed_events_v2'::regclass AND attnum>0 AND NOT attisdropped)
      IS DISTINCT FROM ARRAY['event_id','recipient_id','notification_id','event_kind','created_at']
    OR NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.notification_feed_events_v2'::regclass AND a.attname='event_id'
      AND a.atttypid='uuid'::regtype AND pg_get_expr(d.adbin,d.adrelid)='gen_random_uuid()')
    OR EXISTS(SELECT 1 FROM private.notification_feed_fences_v2) THEN
    RAISE EXCEPTION 'notification_feed_v2_security_failed';
  END IF;
  FOREACH executor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(executor,'private.notification_feed_fences_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege(executor,'public.notification_feed_events_v2','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege(executor,'public.notification_feed_events_v2','SELECT') IS DISTINCT FROM (executor='authenticated') THEN
      RAISE EXCEPTION 'notification_feed_v2_security_failed';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.notifications','notification_feed_insert_v2'),('public.notifications','notification_feed_update_v2'),
    ('public.notifications','notification_feed_delete_v2'),('private.notification_feed_fences_v2','notification_feed_activation'),
    ('private.notification_feed_fences_v2','notification_feed_fence_immutable'),
    ('public.notification_feed_events_v2','notification_feed_event_immutable')
  ) expected(relation,trigger_name) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=r.relation::regclass AND tgname=r.trigger_name
      AND tgenabled='O' AND NOT tgisinternal) THEN RAISE EXCEPTION 'notification_feed_v2_security_failed'; END IF;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['chat_members','message_hidden_for_users','user_blocks','bans','messages','topics'] LOOP
    FOREACH operation IN ARRAY ARRAY['insert','update','delete'] LOOP
      IF operation='insert' AND relation IN ('messages','topics') THEN CONTINUE; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||relation)::regclass
        AND tgname='notification_feed_access_'||operation||'_v2' AND tgenabled='O' AND NOT tgisinternal
        AND tgfoid='private.notification_feed_access_signal_v2()'::regprocedure
        AND CASE operation WHEN 'insert' THEN tgnewtable='access_new' AND tgoldtable IS NULL
          WHEN 'update' THEN tgnewtable='access_new' AND tgoldtable='access_old'
          ELSE tgoldtable='access_old' AND tgnewtable IS NULL END) THEN
        RAISE EXCEPTION 'notification_feed_v2_security_failed';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.notifications'::regclass AND a.attname='feed_revision'
        AND a.atttypid='bigint'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)='''1''::bigint')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass
      AND conname='notification_feed_revision_range_v2' AND contype='c' AND convalidated)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.notifications'::regclass
      AND tgname='zz_notification_feed_revision_v2' AND tgenabled='O' AND NOT tgisinternal AND tgtype=23
      AND tgfoid='private.notification_feed_revision_v2()'::regprocedure) THEN
    RAISE EXCEPTION 'notification_feed_v2_security_failed';
  END IF;
END $security$;

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $prestate$
DECLARE r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:notification-feed-v2-lifecycle',0))
    OR to_regprocedure('public.notification_feed_maintenance_v2(uuid,uuid,uuid[])') IS NOT NULL
    OR to_regclass('public.notification_feed_events_v2_recipient_order') IS NOT NULL THEN
    RAISE EXCEPTION 'notification_feed_lifecycle_prestate_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.notification_feed_cleanup_v2(integer)','01cfd67a301e3970f7fd6996ab2965da9b0277779ebb956c8f36e681a76703ad'),
    ('public.notification_feed_retire_account_v2(uuid,integer)','7c4040cc48fecf40254106b1939cbbe2e273c11a4db1eb10e6a81037bff641a5')
  ) pins(signature,hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
      AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=r.hash)
      OR has_function_privilege('anon',r.signature,'EXECUTE')
      OR has_function_privilege('authenticated',r.signature,'EXECUTE')
      OR NOT has_function_privilege('service_role',r.signature,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=to_regprocedure(r.signature) AND a.grantee<>p.proowner
        AND (a.grantee<>'service_role'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'notification_feed_lifecycle_prestate_drift';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.notification_feed_events_v2'::regclass,
      'private.notification_feed_fences_v2'::regclass) AND (relowner<>'postgres'::regrole OR NOT relrowsecurity OR relreplident<>'d'))
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.notification_feed_events_v2'::regclass,
      'private.notification_feed_fences_v2'::regclass) AND contype='f')
    OR NOT has_table_privilege('postgres','auth.users','SELECT')
    OR NOT has_table_privilege('postgres','public.profiles','SELECT') THEN
    RAISE EXCEPTION 'notification_feed_lifecycle_prestate_drift';
  END IF;
END $prestate$;
SET LOCAL ROLE postgres;

CREATE INDEX notification_feed_events_v2_recipient_order
  ON public.notification_feed_events_v2(recipient_id,created_at,event_id);

CREATE OR REPLACE FUNCTION public.notification_feed_cleanup_v2(p_limit integer DEFAULT 1000) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE removed integer; cutoff timestamptz:=clock_timestamp()-interval '24 hours';
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_notification_feed_cleanup_v2' USING ERRCODE='22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT event_id FROM public.notification_feed_events_v2
    WHERE created_at<cutoff ORDER BY created_at,event_id LIMIT p_limit
  ), locked AS MATERIALIZED (
    SELECT e.event_id FROM candidates c JOIN public.notification_feed_events_v2 e USING(event_id)
    ORDER BY e.created_at,e.event_id FOR UPDATE OF e SKIP LOCKED
  ) DELETE FROM public.notification_feed_events_v2 e USING locked x WHERE e.event_id=x.event_id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END $fn$;

CREATE OR REPLACE FUNCTION public.notification_feed_retire_account_v2(p_recipient_id uuid,p_limit integer DEFAULT 1000) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE removed integer; remaining boolean;
BEGIN
  IF p_recipient_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_notification_feed_account_cleanup_v2' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_recipient_id)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id=p_recipient_id) THEN
    RAISE EXCEPTION 'notification_feed_v2_account_still_exists' USING ERRCODE='55000';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT event_id FROM public.notification_feed_events_v2 WHERE recipient_id=p_recipient_id
    ORDER BY created_at,event_id LIMIT p_limit
  ), locked AS MATERIALIZED (
    SELECT e.event_id FROM candidates c JOIN public.notification_feed_events_v2 e USING(event_id)
    ORDER BY e.created_at,e.event_id FOR UPDATE OF e SKIP LOCKED
  ) DELETE FROM public.notification_feed_events_v2 e USING locked x WHERE e.event_id=x.event_id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  remaining:=EXISTS(SELECT 1 FROM public.notification_feed_events_v2 WHERE recipient_id=p_recipient_id);
  -- Event rows precede the existing final absence-guarded fence DELETE.
  IF NOT remaining THEN DELETE FROM private.notification_feed_fences_v2 WHERE recipient_id=p_recipient_id; END IF;
  RETURN jsonb_build_object('removed',removed,'remaining',remaining);
END $fn$;

CREATE FUNCTION public.notification_feed_maintenance_v2(p_after_fence uuid DEFAULT NULL,
  p_after_event uuid DEFAULT NULL,p_pending uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE expired integer; removed integer:=0; checked integer:=0; settled integer:=0;
  fence_ids uuid[]; event_ids uuid[]; candidates uuid[]; pending uuid[]:='{}';
  next_fence uuid; next_event uuid; recipient uuid; result jsonb;
  cutoff timestamptz:=clock_timestamp()-interval '24 hours';
BEGIN
  IF p_pending IS NULL OR cardinality(p_pending)>10 OR (cardinality(p_pending)>0
    AND (array_ndims(p_pending)<>1 OR array_position(p_pending,NULL) IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid_notification_feed_maintenance_v2' USING ERRCODE='22023';
  END IF;
  expired:=public.notification_feed_cleanup_v2(1000);
  -- Materialize raw windows BEFORE absence checks/deduplication, so a live
  -- prefix or repeated events for one live account cannot cause an open scan.
  WITH page AS MATERIALIZED (
    SELECT recipient_id FROM private.notification_feed_fences_v2
    WHERE p_after_fence IS NULL OR recipient_id>p_after_fence ORDER BY recipient_id LIMIT 100
  ) SELECT coalesce(array_agg(recipient_id ORDER BY recipient_id),'{}') INTO fence_ids FROM page;
  WITH page AS MATERIALIZED (
    SELECT event_id,recipient_id FROM public.notification_feed_events_v2
    WHERE p_after_event IS NULL OR event_id>p_after_event ORDER BY event_id LIMIT 100
  ) SELECT coalesce(array_agg(recipient_id ORDER BY event_id),'{}'),
      CASE WHEN count(*)=100 THEN (array_agg(event_id ORDER BY event_id DESC))[1] END
    INTO event_ids,next_event FROM page;
  next_fence:=CASE WHEN cardinality(fence_ids)=100 THEN fence_ids[100] END;
  WITH ids AS (
    SELECT unnest(fence_ids||event_ids||p_pending) AS recipient_id
  ), eligible AS (
    SELECT DISTINCT i.recipient_id FROM ids i
    WHERE NOT EXISTS(SELECT 1 FROM auth.users WHERE id=i.recipient_id)
      AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=i.recipient_id)
  ), ranked AS (
    SELECT recipient_id,recipient_id=ANY(p_pending) AS carried,
      row_number() OVER (PARTITION BY recipient_id=ANY(p_pending) ORDER BY recipient_id) AS position
    FROM eligible
  ) SELECT coalesce(array_agg(recipient_id ORDER BY priority,position,carried DESC,recipient_id),'{}') INTO candidates FROM (
    -- Reserve discovery capacity even while older accounts have >100 events.
    SELECT recipient_id,carried,position,CASE WHEN position<=5 THEN 0 ELSE 1 END AS priority
    FROM ranked ORDER BY priority,position,carried DESC,recipient_id LIMIT 10
  ) selected;
  FOREACH recipient IN ARRAY candidates LOOP
    checked:=checked+1;
    BEGIN
      result:=public.notification_feed_retire_account_v2(recipient,100);
    EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE '42501' THEN
      -- A committed same-UUID restore may have become visible since discovery.
      -- Never mask other ACL/guard errors or add Auth/profile row-lock edges.
      IF SQLERRM IN ('notification_feed_v2_account_still_exists','notification_feed_v2_immutable')
        AND (EXISTS(SELECT 1 FROM auth.users WHERE id=recipient)
          OR EXISTS(SELECT 1 FROM public.profiles WHERE id=recipient)) THEN CONTINUE; END IF;
      RAISE;
    END;
    removed:=removed+(result->>'removed')::integer;
    IF (result->>'remaining')::boolean THEN pending:=array_append(pending,recipient);
    ELSE settled:=settled+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('v',1,'retention_removed',expired,'orphan_removed',removed,
    'accounts_checked',checked,'accounts_settled',settled,'scanned_fences',cardinality(fence_ids),
    'scanned_events',cardinality(event_ids),'expired_remaining',EXISTS(
      SELECT 1 FROM public.notification_feed_events_v2 WHERE created_at<cutoff),
    'state',jsonb_build_object('after_fence',next_fence,'after_event',next_event,'pending',to_jsonb(pending)));
END $fn$;

DO $security$
DECLARE f regprocedure; r record;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.notification_feed_cleanup_v2(integer)'::regprocedure,
    'public.notification_feed_retire_account_v2(uuid,integer)'::regprocedure,
    'public.notification_feed_maintenance_v2(uuid,uuid,uuid[])'::regprocedure] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND proowner='postgres'::regrole
      AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""']::text[])
      OR has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
      OR NOT has_function_privilege('service_role',f,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=f AND a.grantee<>p.proowner AND (a.grantee<>'service_role'::regrole OR a.is_grantable)) THEN
      RAISE EXCEPTION 'notification_feed_lifecycle_security_failed';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.notification_feed_events_v2_recipient_order'::regclass
    AND indrelid='public.notification_feed_events_v2'::regclass AND indisvalid AND indisready
    AND indnkeyatts=3 AND indnatts=3 AND indpred IS NULL AND indexprs IS NULL
    AND indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=indrelid AND attname='recipient_id')
    AND indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=indrelid AND attname='created_at')
    AND indkey[2]=(SELECT attnum FROM pg_attribute WHERE attrelid=indrelid AND attname='event_id')) THEN
    RAISE EXCEPTION 'notification_feed_lifecycle_security_failed';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('private.notification_feed_fences_v2','notification_feed_fence_immutable'),
    ('public.notification_feed_events_v2','notification_feed_event_immutable')) guards(relation,name) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=r.relation::regclass AND tgname=r.name
      AND tgenabled='O' AND NOT tgisinternal AND tgfoid='private.notification_feed_immutable_v2()'::regprocedure) THEN
      RAISE EXCEPTION 'notification_feed_lifecycle_security_failed';
    END IF;
  END LOOP;
END $security$;

SET LOCAL ROLE NONE;
DO $candidate_baseline$
BEGIN
  PERFORM set_config('search_path', current_setting('letscube.item77_search_path'), true);
  PERFORM set_config('lock_timeout', current_setting('letscube.item77_lock_timeout'), true);
  PERFORM set_config('statement_timeout', current_setting('letscube.item77_statement_timeout'), true);
END $candidate_baseline$;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:web-message-preview',0))
    OR to_regclass('private.web_message_preview_grants') IS NOT NULL
    OR to_regclass('private.web_message_preview_runtime') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.proname LIKE 'web_message_preview_%')
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.push_subscriptions'::regclass,
      'public.notification_preview_preferences'::regclass,'public.notifications'::regclass,
      'public.notifications_push_outbox'::regclass) AND NOT relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid=to_regprocedure('private.topic_alert_source_lock(uuid,uuid)')
        AND p.prosecdef AND p.provolatile='v' AND o.rolname='postgres' AND p.proconfig=ARRAY['search_path=""'])
  THEN RAISE EXCEPTION 'web_preview_prestate_drift'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.native_message_preview_recipient()','b133d8a966da8f08e9e9acc87f6dec5ab32f090ea1b15ee7226ee29e3ace8304'),
    ('private.message_notification_visible_to(uuid,uuid)','7e4079917f96f31a297764c18172aa7dcb8d193856562a8d8ecf06cbc0dfbaf3'),
    ('public._notification_push_allowed(uuid,text,jsonb)','45cf2fdc00bc3cef29d1e6ca281f7a91a4202e1783da80f92b8e074a3f508a1e'),
    ('private.notification_topic_alert_allowed(uuid)','82ca6127e4b1aa030249bf97db8b286876f1721246f4ff46c6ee0c1d8e834360')
  ) v(signature,hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid=to_regprocedure(r.signature) AND p.prosecdef AND o.rolname='postgres'
        AND p.provolatile='s' AND p.proconfig=CASE WHEN r.signature='public.native_message_preview_recipient()'
          THEN ARRAY['search_path=pg_catalog'] ELSE ARRAY['search_path=""'] END
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=r.hash)
    THEN RAISE EXCEPTION 'web_preview_dependency_drift'; END IF;
  END LOOP;
END $prestate$;
SET LOCAL ROLE postgres;

CREATE TABLE private.web_message_preview_runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE private.web_message_preview_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.web_message_preview_runtime FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.web_message_preview_runtime VALUES(true,false);

CREATE TABLE private.web_message_preview_grants (
  subscription_id uuid PRIMARY KEY REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- No session FK: deletion must deny content without deleting the CAS tombstone.
  session_id uuid NOT NULL,
  subscription_fingerprint text NOT NULL CHECK(subscription_fingerprint ~ '^v1:[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  preview_level text NOT NULL CHECK(preview_level IN ('none','sender','message')),
  installation_consent boolean NOT NULL,
  grant_hash bytea UNIQUE,
  last_grant_hash bytea CHECK(last_grant_hash IS NULL OR octet_length(last_grant_hash)=32),
  issued_at timestamptz,
  expires_at timestamptz,
  CHECK((installation_consent AND preview_level IN ('sender','message')
      AND grant_hash IS NOT NULL AND octet_length(grant_hash)=32
      AND last_grant_hash IS NOT NULL AND last_grant_hash=grant_hash AND issued_at IS NOT NULL AND expires_at IS NOT NULL
      AND expires_at<=issued_at+interval '30 days')
    OR (NOT installation_consent AND preview_level='none' AND grant_hash IS NULL AND expires_at IS NULL))
);
ALTER TABLE private.web_message_preview_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.web_message_preview_grants FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX web_message_preview_grants_recipient ON private.web_message_preview_grants(recipient_id);

CREATE FUNCTION private.web_message_preview_descriptor(p_id uuid,p_user uuid,p_endpoint text,p_p256dh text,p_auth text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog
AS $fn$
DECLARE v text; b bytea; framed bytea:=''::bytea;
BEGIN
  IF octet_length(p_endpoint) NOT BETWEEN 1 AND 8192
    OR octet_length(p_p256dh) NOT BETWEEN 1 AND 1024
    OR octet_length(p_auth) NOT BETWEEN 1 AND 1024 THEN RETURN NULL; END IF;
  FOREACH v IN ARRAY ARRAY[p_id::text,p_user::text,p_endpoint,p_p256dh,p_auth] LOOP
    b:=convert_to(v,'UTF8');
    framed:=framed||convert_to(octet_length(b)::text||':','UTF8')||b;
  END LOOP;
  RETURN 'v1:'||encode(sha256(framed),'hex');
END $fn$;

CREATE FUNCTION private.web_message_preview_choice_retire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF TG_OP='DELETE' OR NEW.preview_level IS DISTINCT FROM OLD.preview_level THEN
    UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
      preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991)
      WHERE recipient_id=OLD.user_id;
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER web_message_preview_choice_retire
  AFTER UPDATE OF preview_level OR DELETE ON public.notification_preview_preferences
  FOR EACH ROW EXECUTE FUNCTION private.web_message_preview_choice_retire();

CREATE FUNCTION private.web_message_preview_subscription_retire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF ROW(NEW.user_id,NEW.endpoint,NEW.p256dh,NEW.auth,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.user_id,OLD.endpoint,OLD.p256dh,OLD.auth,OLD.is_active) THEN
    UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
      preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991)
      WHERE subscription_id=OLD.id;
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER web_message_preview_subscription_retire
  AFTER UPDATE OF user_id,endpoint,p256dh,auth,is_active ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION private.web_message_preview_subscription_retire();

CREATE FUNCTION public.web_message_preview_context(p_subscription_id uuid)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE u uuid; sid uuid; ts timestamptz:=clock_timestamp();
BEGIN
  u:=public.native_message_preview_recipient();
  IF u IS NULL OR p_subscription_id IS NULL THEN RETURN; END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  RETURN QUERY
  SELECT 1::smallint,u,sid,s.id,d.fp,coalesce(g.revision,0),
    CASE WHEN eligible.ok THEN g.preview_level ELSE 'none' END,
    coalesce(eligible.ok,false),floor(extract(epoch FROM ts)*1000)::bigint,
    CASE WHEN eligible.ok THEN floor(extract(epoch FROM least(g.expires_at,a.not_after))*1000)::bigint END
  FROM public.push_subscriptions s
  CROSS JOIN LATERAL (SELECT private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth) AS fp) d
  JOIN auth.sessions a ON a.id=sid AND a.user_id=u
  LEFT JOIN private.web_message_preview_grants g ON g.subscription_id=s.id
  LEFT JOIN public.notification_preview_preferences pref ON pref.user_id=u
  CROSS JOIN LATERAL (SELECT s.is_active AND d.fp IS NOT NULL AND g.recipient_id=u AND g.session_id=sid
    AND g.subscription_fingerprint=d.fp AND g.installation_consent AND g.grant_hash IS NOT NULL
    AND g.preview_level IN ('sender','message') AND g.preview_level=pref.preview_level
    AND g.issued_at<=ts AND g.expires_at>ts
    AND a.created_at<=ts AND (a.not_after IS NULL OR a.not_after>ts)
    AND EXISTS(SELECT 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled) AS ok) eligible
  WHERE s.id=p_subscription_id AND s.user_id=u AND d.fp IS NOT NULL;
END $fn$;

CREATE FUNCTION public.web_message_preview_enroll(p_subscription_id uuid,p_expected_revision bigint,
  p_subscription_fingerprint text,p_preview_level text,p_grant_hash text,p_ttl_seconds integer DEFAULT 2592000)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s'
AS $fn$
DECLARE u uuid; sid uuid; s public.push_subscriptions%ROWTYPE;
  g private.web_message_preview_grants%ROWTYPE; a auth.sessions%ROWTYPE;
  pref text; fp text; ts timestamptz;
BEGIN
  IF p_subscription_id IS NULL OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 0 AND 9007199254740990
    OR p_preview_level IS NULL OR p_preview_level NOT IN ('sender','message')
    OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 1 AND 2592000
    OR p_subscription_fingerprint IS NULL OR p_subscription_fingerprint !~ '^v1:[0-9a-f]{64}$'
    OR p_grant_hash IS NULL OR octet_length(p_grant_hash)<>64 OR p_grant_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  u:=public.native_message_preview_recipient();
  IF u IS NULL THEN RAISE EXCEPTION 'web_preview_session_refused' USING ERRCODE='42501'; END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  PERFORM 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_disabled'; END IF;
  SELECT p.preview_level INTO pref FROM public.notification_preview_preferences p WHERE p.user_id=u FOR SHARE;
  IF pref IS DISTINCT FROM p_preview_level THEN RAISE EXCEPTION 'web_preview_choice_refused'; END IF;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=p_subscription_id AND x.user_id=u AND x.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_subscription_refused'; END IF;
  fp:=private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth);
  IF fp IS DISTINCT FROM p_subscription_fingerprint THEN RAISE EXCEPTION 'web_preview_descriptor_refused'; END IF;
  INSERT INTO private.web_message_preview_grants(subscription_id,recipient_id,session_id,subscription_fingerprint,
    revision,preview_level,installation_consent) VALUES(s.id,u,sid,fp,0,'none',false)
    ON CONFLICT ON CONSTRAINT web_message_preview_grants_pkey DO NOTHING;
  SELECT x.* INTO g FROM private.web_message_preview_grants x WHERE x.subscription_id=s.id FOR UPDATE;
  IF g.revision<>p_expected_revision THEN RAISE EXCEPTION 'web_preview_revision_conflict' USING ERRCODE='40001'; END IF;
  IF g.last_grant_hash=decode(p_grant_hash,'hex') THEN RAISE EXCEPTION 'web_preview_rotation_refused' USING ERRCODE='22023'; END IF;
  SELECT x.* INTO a FROM auth.sessions x WHERE x.id=sid AND x.user_id=u FOR SHARE;
  ts:=clock_timestamp();
  IF NOT FOUND OR a.created_at>ts OR (a.not_after IS NOT NULL AND a.not_after<=ts)
    OR public.native_message_preview_recipient() IS DISTINCT FROM u
    OR (auth.jwt()->>'exp')::bigint<=extract(epoch FROM ts)
  THEN RAISE EXCEPTION 'web_preview_session_refused' USING ERRCODE='42501'; END IF;
  -- Authenticated enrollment accepts only the browser-generated secret's hash.
  -- Never receive, generate, return or persist a plaintext grant in this path.
  UPDATE private.web_message_preview_grants x SET recipient_id=u,session_id=sid,subscription_fingerprint=fp,
    revision=g.revision+1,preview_level=p_preview_level,installation_consent=true,
    grant_hash=decode(p_grant_hash,'hex'),last_grant_hash=decode(p_grant_hash,'hex'),issued_at=ts,
    expires_at=least(ts+make_interval(secs=>p_ttl_seconds),a.not_after) WHERE x.subscription_id=s.id;
  RETURN QUERY SELECT c.* FROM public.web_message_preview_context(s.id) c;
END $fn$;

CREATE FUNCTION public.web_message_preview_revoke(p_subscription_id uuid,p_expected_revision bigint)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,preview_level text,installation_consent boolean,
  observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s'
AS $fn$
DECLARE u uuid; sid uuid; s public.push_subscriptions%ROWTYPE; fp text; rev bigint;
BEGIN
  IF p_subscription_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
  THEN RAISE EXCEPTION 'web_preview_input_refused' USING ERRCODE='22023'; END IF;
  u:=public.native_message_preview_recipient();
  IF u IS NULL THEN RAISE EXCEPTION 'web_preview_session_refused' USING ERRCODE='42501'; END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=p_subscription_id AND x.user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'web_preview_subscription_refused'; END IF;
  fp:=private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth);
  IF fp IS NULL THEN RAISE EXCEPTION 'web_preview_descriptor_refused'; END IF;
  INSERT INTO private.web_message_preview_grants(subscription_id,recipient_id,session_id,subscription_fingerprint,
    revision,preview_level,installation_consent) VALUES(s.id,u,sid,fp,0,'none',false)
    ON CONFLICT ON CONSTRAINT web_message_preview_grants_pkey DO NOTHING;
  SELECT x.revision INTO rev FROM private.web_message_preview_grants x WHERE x.subscription_id=s.id FOR UPDATE;
  IF rev<>p_expected_revision THEN RAISE EXCEPTION 'web_preview_revision_conflict' USING ERRCODE='40001'; END IF;
  IF public.native_message_preview_recipient() IS DISTINCT FROM u THEN RAISE EXCEPTION 'web_preview_session_refused'; END IF;
  UPDATE private.web_message_preview_grants x SET grant_hash=NULL,installation_consent=false,preview_level='none',
    expires_at=NULL,revision=least(rev+1,9007199254740991) WHERE x.subscription_id=s.id;
  RETURN QUERY SELECT c.* FROM public.web_message_preview_context(s.id) c;
END $fn$;

CREATE FUNCTION public.web_message_preview_content(p_grant_secret text,p_notification_id uuid)
RETURNS TABLE(preview_v smallint,recipient_id uuid,session_id uuid,subscription_id uuid,
  subscription_fingerprint text,revision bigint,notification_id uuid,chat_id uuid,message_id uuid,
  preview_level text,sender_name text,title text,body text,observed_at_epoch_ms bigint,expires_at_epoch_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE seed private.web_message_preview_grants%ROWTYPE; g private.web_message_preview_grants%ROWTYPE;
  s public.push_subscriptions%ROWTYPE; a auth.sessions%ROWTYPE; n public.notifications%ROWTYPE;
  m public.messages%ROWTYPE; mid uuid; pref text; ts timestamptz; deadline timestamptz;
BEGIN
  IF p_grant_secret IS NULL OR octet_length(p_grant_secret)<>69 OR p_grant_secret !~ '^wpg1_[0-9a-f]{64}$'
    OR p_notification_id IS NULL OR current_setting('transaction_isolation')<>'read committed' THEN RETURN; END IF;
  PERFORM 1 FROM private.web_message_preview_runtime r WHERE r.singleton AND r.enabled FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT x.* INTO seed FROM private.web_message_preview_grants x WHERE x.grant_hash=sha256(convert_to(p_grant_secret,'UTF8'));
  IF NOT FOUND THEN RETURN; END IF;
  -- Keep the same pref -> subscription -> grant order as authenticated enrollment.
  SELECT p.preview_level INTO pref FROM public.notification_preview_preferences p WHERE p.user_id=seed.recipient_id FOR SHARE NOWAIT;
  IF pref IS DISTINCT FROM seed.preview_level OR pref NOT IN ('sender','message') THEN RETURN; END IF;
  SELECT x.* INTO s FROM public.push_subscriptions x WHERE x.id=seed.subscription_id AND x.user_id=seed.recipient_id AND x.is_active FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  IF private.web_message_preview_descriptor(s.id,s.user_id,s.endpoint,s.p256dh,s.auth)
    IS DISTINCT FROM seed.subscription_fingerprint THEN RETURN; END IF; -- DESCRIPTOR_GUARD
  SELECT x.* INTO g FROM private.web_message_preview_grants x WHERE x.subscription_id=seed.subscription_id
    AND x.grant_hash=sha256(convert_to(p_grant_secret,'UTF8')) AND x.revision=seed.revision
    AND x.recipient_id=seed.recipient_id AND x.session_id=seed.session_id
    AND x.installation_consent AND x.preview_level=pref FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT x.* INTO a FROM auth.sessions x WHERE x.id=g.session_id AND x.user_id=g.recipient_id
    AND x.created_at<=clock_timestamp() AND (x.not_after IS NULL OR x.not_after>clock_timestamp()) FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF; -- SESSION_GUARD
  ts:=clock_timestamp();
  IF g.issued_at>ts OR g.expires_at<=ts THEN RETURN; END IF;
  SELECT x.* INTO n FROM public.notifications x WHERE x.id=p_notification_id AND x.user_id=g.recipient_id
    AND x.kind='message' AND x.read_at IS NULL AND x.alert_suppressed_at IS NULL
    AND x.created_at>=a.created_at AND x.created_at<=ts FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(n.payload->>'message_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
  mid:=(n.payload->>'message_id')::uuid;
  SELECT x.* INTO m FROM public.messages x WHERE x.id=mid
    AND n.payload->>'chat_id'=x.chat_id::text FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN; END IF;
  -- The maintained topic barrier refuses busy/incompatible transactions; no
  -- caller-supplied bypass flag and no network/effect while locks are held.
  PERFORM private.topic_alert_source_lock(g.recipient_id,m.chat_id);
  ts:=clock_timestamp();
  IF g.expires_at<=ts OR (a.not_after IS NOT NULL AND a.not_after<=ts) THEN RETURN; END IF;
  deadline:=least(ts+interval '15 seconds',g.expires_at,a.not_after);
  RETURN QUERY SELECT 1::smallint,g.recipient_id,g.session_id,g.subscription_id,g.subscription_fingerprint,g.revision,
    n.id,m.chat_id,m.id,g.preview_level,label.name,label.name,
    CASE WHEN g.preview_level='sender' THEN 'Новое сообщение' ELSE coalesce(nullif(left(btrim(regexp_replace(
      CASE m.type WHEN 'text' THEN m.content WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео'
        WHEN 'audio' THEN 'Голосовое сообщение' WHEN 'voice' THEN 'Голосовое сообщение'
        WHEN 'file' THEN 'Файл' ELSE 'Новое сообщение' END,'[[:cntrl:][:space:]]+',' ','g')),240),''),'Новое сообщение') END,
    floor(extract(epoch FROM ts)*1000)::bigint,floor(extract(epoch FROM deadline)*1000)::bigint
  FROM (SELECT 1) anchor
  LEFT JOIN public.profiles profile ON profile.id=m.user_id AND m.bot_id IS NULL
  LEFT JOIN public.bots bot ON bot.id=m.bot_id AND m.user_id IS NULL
  CROSS JOIN LATERAL (SELECT left(btrim(regexp_replace(coalesce(profile.full_name,bot.display_name,''),
    '[[:cntrl:][:space:]]+',' ','g')),96) AS name) label
  WHERE label.name<>'' AND private.message_notification_visible_to(m.id,g.recipient_id)
    AND private.notification_topic_alert_allowed(n.id)
    AND public._notification_push_allowed(g.recipient_id,'message',jsonb_build_object(
      'message_id',m.id,'chat_id',m.chat_id,'sender_id',m.user_id))
    AND (EXISTS(SELECT 1 FROM public.notifications_push_outbox o WHERE o.notification_id=n.id
      AND o.subscription_id=g.subscription_id AND o.user_id=g.recipient_id AND o.suppressed_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.album_push_members member
        JOIN public.album_push_groups album ON album.id=member.group_id
        JOIN public.notifications_album_push_outbox delivery ON delivery.group_id=album.id
        WHERE member.notification_id=n.id AND member.message_id=m.id AND album.user_id=g.recipient_id
          AND album.chat_id=m.chat_id AND album.topic_alert_suppressed_at IS NULL
          AND ((album.sender_kind='user' AND album.sender_id=m.user_id AND m.bot_id IS NULL)
            OR (album.sender_kind='bot' AND album.sender_id=m.bot_id AND m.user_id IS NULL))
          AND delivery.subscription_id=g.subscription_id AND delivery.device_id IS NULL AND delivery.suppressed_at IS NULL));
EXCEPTION WHEN lock_not_available OR serialization_failure THEN RETURN;
END $fn$;

REVOKE ALL ON FUNCTION private.web_message_preview_descriptor(uuid,uuid,text,text,text),
  private.web_message_preview_choice_retire(),private.web_message_preview_subscription_retire()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.web_message_preview_context(uuid),
  public.web_message_preview_enroll(uuid,bigint,text,text,text,integer),public.web_message_preview_revoke(uuid,bigint),
  public.web_message_preview_content(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.web_message_preview_context(uuid),
  public.web_message_preview_enroll(uuid,bigint,text,text,text,integer),public.web_message_preview_revoke(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.web_message_preview_content(text,uuid) TO anon;

DO $selfcheck$
DECLARE r record; oid_ oid; role_ oid;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('private.web_message_preview_grants'::regclass,
    'private.web_message_preview_runtime'::regclass) AND (NOT relrowsecurity OR relowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')))
    OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid IN ('private.web_message_preview_grants'::regclass,'private.web_message_preview_runtime'::regclass)
        AND a.grantee<>c.relowner)
    OR (SELECT enabled FROM private.web_message_preview_runtime WHERE singleton) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM private.web_message_preview_grants)
  THEN RAISE EXCEPTION 'web_preview_selfcheck_failed'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.web_message_preview_context(uuid)','authenticated'),
    ('public.web_message_preview_enroll(uuid,bigint,text,text,text,integer)','authenticated'),
    ('public.web_message_preview_revoke(uuid,bigint)','authenticated'),
    ('public.web_message_preview_content(text,uuid)','anon')
  ) v(signature,caller) LOOP
    oid_:=to_regprocedure(r.signature); SELECT oid INTO role_ FROM pg_roles WHERE rolname=r.caller;
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=oid_ AND p.prosecdef AND p.provolatile='v'
      AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND p.proconfig[1]='search_path=pg_catalog')
      OR NOT has_function_privilege(r.caller,oid_,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=oid_
        AND (a.grantee NOT IN (p.proowner,role_) OR a.is_grantable))
    THEN RAISE EXCEPTION 'web_preview_selfcheck_failed'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('web_message_preview_choice_retire',
    'web_message_preview_subscription_retire') AND NOT tgisinternal AND tgenabled='O')<>2
  THEN RAISE EXCEPTION 'web_preview_selfcheck_failed'; END IF;
END $selfcheck$;
COMMIT;
