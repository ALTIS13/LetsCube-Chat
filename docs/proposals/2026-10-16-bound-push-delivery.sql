-- DRAFT: additive single-Web/legacy descriptor binding. NOT production-applied.
-- Not a standalone deploy: the new worker refuses a missing bound RPC. Review,
-- verified fresh backup/restore rehearsal and canonical byte-identical migration
-- mirror are required before apply. Album/native descriptors are NOT covered.
-- Composed item77 rollback retains this RPC and its Task3 enforcement, together
-- with all preference/suppression data. Freeze the topic runtime as described
-- by the Task3 rollback; stop opt-in legacy dispatch if necessary. Do not restore
-- unbound consumers or DROP this RPC while current Web consumers require it.
-- No recall of already provider-accepted requests is claimed.
BEGIN;
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
COMMIT;
