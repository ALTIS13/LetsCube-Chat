-- DRAFT / Task2 only: not a complete delivery migration and not for production apply.
-- Rollback: 2026-10-16-topic-notification-overrides.rollback.sql retains disabled
-- enforcement and all preference data. Never restore the old message gate alone.
-- Register a canonical/mirrored migration only after Tasks3-6 are complete.
BEGIN;
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
COMMIT;
