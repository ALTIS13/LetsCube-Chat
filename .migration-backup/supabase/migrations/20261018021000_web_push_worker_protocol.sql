-- Additive Web Push worker protocol marker; compatibility only, never content authority.
-- Requires a fresh verified backup and coordinator-owned PG17 rehearsal before apply.
-- Existing subscriptions stay protocol 0 until an explicit descriptor-bound worker ACK.
-- No RLS/grant/public identity changes; both global runtime flags are preserved.
-- Narrow rollback after exact metadata verification (no CASCADE):
-- BEGIN;
-- SET LOCAL lock_timeout='5s';
-- DROP TRIGGER web_push_worker_protocol_reset ON public.push_subscriptions;
-- DROP FUNCTION private.web_push_worker_protocol_reset();
-- ALTER TABLE public.push_subscriptions DROP COLUMN web_push_protocol;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $prestate$
DECLARE target oid:=to_regclass('public.push_subscriptions'); snapshot jsonb; flags jsonb;
BEGIN
  IF target IS NULL
    OR to_regclass('private.topic_notification_runtime') IS NULL
    OR to_regclass('private.web_message_preview_runtime') IS NULL
    OR to_regprocedure('private.web_push_worker_protocol_reset()') IS NOT NULL
  THEN RAISE EXCEPTION 'web_push_worker_protocol_prestate_drift'; END IF;
  LOCK TABLE public.push_subscriptions IN ACCESS EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=target AND relkind='r' AND relrowsecurity)
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=target AND attname='web_push_protocol' AND NOT attisdropped)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=target AND tgname='web_push_worker_protocol_reset')
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=target AND conname='push_subscriptions_web_push_protocol_check')
    OR (SELECT count(*) FROM pg_attribute WHERE attrelid=target AND NOT attisdropped
      AND (attname,atttypid) IN (('id','uuid'::regtype),('user_id','uuid'::regtype),
        ('endpoint','text'::regtype),('p256dh','text'::regtype),('auth','text'::regtype),('is_active','bool'::regtype)))<>6
  THEN RAISE EXCEPTION 'web_push_worker_protocol_prestate_drift'; END IF;
  SELECT jsonb_build_object(
    'oid',c.oid::text,'owner',c.relowner::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid=c.oid),
    'pk',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary),
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text)
      ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'web_push_protocol')
  ) INTO snapshot FROM pg_class c WHERE c.oid='public.push_subscriptions'::regclass;
  SELECT jsonb_build_object(
    'topic',(SELECT enabled FROM private.topic_notification_runtime WHERE singleton),
    'web',(SELECT enabled FROM private.web_message_preview_runtime WHERE singleton)
  ) INTO flags;
  IF flags->>'topic' IS NULL OR flags->>'web' IS NULL
  THEN RAISE EXCEPTION 'web_push_worker_protocol_prestate_drift'; END IF;
  PERFORM set_config('letscube.web_push_worker_protocol_prior',snapshot::text,true);
  PERFORM set_config('letscube.web_push_worker_protocol_flags',flags::text,true);
END $prestate$;

SET LOCAL ROLE postgres;
ALTER TABLE public.push_subscriptions
  ADD COLUMN web_push_protocol smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT push_subscriptions_web_push_protocol_check CHECK(web_push_protocol IN (0,1));

CREATE FUNCTION private.web_push_worker_protocol_reset()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.web_push_protocol:=0;
  ELSIF ROW(NEW.user_id,NEW.endpoint,NEW.p256dh,NEW.auth,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.user_id,OLD.endpoint,OLD.p256dh,OLD.auth,OLD.is_active) THEN
    NEW.web_push_protocol:=0;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.web_push_worker_protocol_reset() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER web_push_worker_protocol_reset
  BEFORE INSERT OR UPDATE OF user_id,endpoint,p256dh,auth,is_active ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION private.web_push_worker_protocol_reset();

DO $selfcheck$
DECLARE snapshot jsonb; flags jsonb; protocol_attnum smallint;
BEGIN
  SELECT jsonb_build_object(
    'oid',c.oid::text,'owner',c.relowner::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid=c.oid),
    'pk',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary),
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text)
      ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'web_push_protocol')
  ) INTO snapshot FROM pg_class c WHERE c.oid='public.push_subscriptions'::regclass;
  SELECT jsonb_build_object(
    'topic',(SELECT enabled FROM private.topic_notification_runtime WHERE singleton),
    'web',(SELECT enabled FROM private.web_message_preview_runtime WHERE singleton)
  ) INTO flags;
  SELECT attnum INTO protocol_attnum FROM pg_attribute
    WHERE attrelid='public.push_subscriptions'::regclass AND attname='web_push_protocol' AND NOT attisdropped;
  IF snapshot IS DISTINCT FROM current_setting('letscube.web_push_worker_protocol_prior')::jsonb
    OR flags IS DISTINCT FROM current_setting('letscube.web_push_worker_protocol_flags')::jsonb
    OR NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.push_subscriptions'::regclass AND a.attnum=protocol_attnum
        AND a.atttypid='int2'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)='0')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.push_subscriptions'::regclass
      AND conname='push_subscriptions_web_push_protocol_check' AND contype='c' AND convalidated
      AND conkey=ARRAY[protocol_attnum])
    OR EXISTS(SELECT 1 FROM public.push_subscriptions WHERE web_push_protocol IS NULL OR web_push_protocol<>0)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.push_subscriptions'::regclass
      AND t.tgname='web_push_worker_protocol_reset' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=23
      AND t.tgqual IS NULL AND t.tgfoid='private.web_push_worker_protocol_reset()'::regprocedure
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(t.tgattr::smallint[]) k(num)
        JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num)=ARRAY['auth','endpoint','is_active','p256dh','user_id'])
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.web_push_worker_protocol_reset()'::regprocedure
      AND NOT prosecdef AND provolatile='v' AND proowner='postgres'::regrole AND proconfig=ARRAY['search_path=pg_catalog'])
    OR has_function_privilege('anon','private.web_push_worker_protocol_reset()','EXECUTE')
    OR has_function_privilege('authenticated','private.web_push_worker_protocol_reset()','EXECUTE')
    OR has_function_privilege('service_role','private.web_push_worker_protocol_reset()','EXECUTE')
  THEN RAISE EXCEPTION 'web_push_worker_protocol_selfcheck_failed'; END IF;
END $selfcheck$;

NOTIFY pgrst, 'reload schema';
COMMIT;
