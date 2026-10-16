-- DRAFT Task6 SERVER ONLY: after Task2/bound/Task3. Not wire/PG17 acceptance,
-- not production apply or canonical registration. Actual feed catalog input:
-- 908cd49ce4c08368925e1b03e3bc2921db7fa4628fa0fd26ba7b504f5dd9eda3.
-- Rows expose the six original feed columns plus alert_suppressed_at and
-- feed_revision, never alert_origin; mute never filters this feed.
-- Revision is an independent server-owned safe bigint per notification, not a
-- cursor. Constant default 1 adds no historical payload/read UPDATE. Exhaustion
-- refuses before mutation; keep this column/guard during retained-data rollback.
-- Display cursors are NOT commit watermarks. Open's random stream marker must
-- be observed by the already-buffering connection before live INSERT admission.
-- Rollback: retain v2 RPCs/events, activation fence and restrictive legacy policy;
-- freeze topic writes/enabled bypass per Task2/Task3. Never drop activation or
-- reopen the old route. Stop only enforcement-incompatible consumers. Retain
-- original notifications/read state. Backup/rehearsal/mirror required for apply.
-- Account privacy cleanup: after ordinary account deletion, service calls
-- notification_feed_retire_account_v2 until remaining=false. It refuses while
-- auth.users OR profiles still contains the account. No new FK/cascade/Auth
-- lock participates in CAS. Wiring that service lifecycle is a Task6 gate.
-- Visibility dependency capture: private.message_notification_visible_to
-- e974c606...a1570; public.is_banned reads bans(user_id,expires_at). Access/source
-- mutation signals include read/terminal history without scanning that history.
-- Automatic clock-only ban expiry is not a mutation event or an alert grant.
BEGIN;
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
COMMIT;
