-- DRAFT Task3 supplement. NOT a production migration or activation.
-- Assembly: Task2 -> bound-push-delivery -> this supplement. Task6 registers
-- the final canonical/mirrored migration after full-schema/PG17 review.
-- Retained-data rollback: keep this enforcement, origins, markers, group
-- tombstones and triggers; UPDATE private.topic_notification_runtime SET
-- enabled=false WHERE singleton in a reviewed transaction. This freezes CAS
-- and enabled-child bypass, NOT disabled enforcement. Never restore old gates.
-- Existing message notifications have no provable admission origin: retire
-- their alerts once, without deleting feed rows or changing read_at.
-- Claims/ACKs only lock/update outboxes; they do not call these rechecks. No
-- outbox trigger takes a barrier. Normal admission: chat/member -> account/chat.
-- Bound takes its target lock before any reconcile (which may touch siblings).
-- Only pre-admission chat/member -> advisory waits may block. All subsequent
-- explicit row acquisitions are NOWAIT; read-only allowed notes are not locked.
-- Source/preference hooks may already own a child row: private TRY barriers and
-- NOWAIT downstream rows ONLY, never chat/member locks. Contention aborts the
-- entire source mutation (40001/55P03); it never skips suppression or catches a
-- deadlock. This also prevents indirect cycles during multi-child FK cascades.
-- Realtime membership below is explicit and retains own-row RLS/PK filtering.
-- Catalog membership alone does not prove logical replication or WS delivery.
BEGIN;
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
COMMIT;
