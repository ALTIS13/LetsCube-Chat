-- DRAFT Task6 lifecycle supplement, AFTER frozen feed-v2 50133c51...b001c89.
-- PGlite/source only; not production/PG17/wire acceptance or canonical registration.
-- Before apply: verified backup, full-schema rehearsal, reviewed byte-identical
-- migration mirror. No account deletion, Auth/profile trigger/FK or history UPDATE.
-- Rollback: disable NOTIFICATION_FEED_MAINTENANCE_ENABLED; retain these bounded
-- helpers/index and all feed/fence data. Never reopen the legacy route or drop
-- activation. Expired sidecar deletion is intentional and not reversible by DDL.
-- Cursor/pending UUIDs are service-only maintenance hints, not feed watermarks
-- or a durable queue. Every pass wraps/rechecks. No account UUID restore CAS is
-- claimed: both absence guards remain, including the existing final fence guard.
BEGIN;
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
COMMIT;
