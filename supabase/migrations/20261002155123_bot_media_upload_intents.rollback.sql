-- Rollback: disable upload-intent RPCs ONLY; retain all attempt rows, owner, RLS and ACL.
-- Pause inline runtime first. Pending/unknown remain indefinite holds; never clear by lease/age.
-- No Storage removal, charge release or reserve/commit replacement. Reapply refuses retained table.
-- Coordinator fresh-backup/restore gate still applies; this is not production apply authority.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $rollback_lock$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-media-upload-intents:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_upload_migration_busy';
  END IF;
END
$rollback_lock$;
LOCK TABLE private.bot_media_upload_attempts IN SHARE ROW EXCLUSIVE MODE;
DO $existingcheck$
DECLARE r record; p pg_proc;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)','5fc63a11be9b4e37ff6a062ed6f488c3b7f514f2b6e84a686b192e9681b1ba8f','v'),
    ('public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)','2457425516395f7e2f31c27dc5dd9e8fac102c2bc3819f5d3f836d73bfc2ef97','v'),
    ('public.bot_membership_authorize_internal(uuid,uuid,text)','6bd4f42de254201ec32ed2b54cf47fe05003272fa5ab61bf897bd961151feeb9','s')
  ) expected(signature,body_hash,volatility) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
    IF NOT FOUND OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM r.body_hash
      OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile::text<>r.volatility
      OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
      OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN
      RAISE EXCEPTION 'bot_media_upload_existing_function_drift:%',r.signature;
    END IF;
  END LOOP;
END
$existingcheck$;

DO $selfcheck$
DECLARE r record; p pg_proc;
BEGIN
  IF (SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
    WHERE n.nspname='public' AND f.proname IN ('bot_media_upload_begin_internal','bot_media_upload_finish_internal'))<>2 THEN
    RAISE EXCEPTION 'bot_media_upload_function_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)','48c0f4f80afc285c20d8817d4b97d41e3eb2be1ee59d5e61a34f5f5d72939814',
      '["p_bot_id","p_token_id","p_chat_id","p_idempotency_key","p_request_fingerprint","p_lease_id","p_object_path","p_content_type","p_byte_size","p_content_sha256"]'),
    ('public.bot_media_upload_finish_internal(uuid,text,uuid,text)','0d4631dcc436ff6bbd4d145470ab456cceb9dac8c2cb0af6ba57bf6b3e023286',
      '["p_bot_id","p_idempotency_key","p_attempt_id","p_outcome"]')
  ) expected(signature,body_hash,arg_names) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
    IF NOT FOUND OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM r.body_hash
      OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
      OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
      OR p.pronargdefaults<>0 OR p.provariadic<>0 OR p.proisstrict OR p.proleakproof
      OR to_jsonb(p.proargnames) IS DISTINCT FROM r.arg_names::jsonb
      OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
      OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN
      RAISE EXCEPTION 'bot_media_upload_function_drift:%',r.signature;
    END IF;
  END LOOP;
END
$selfcheck$;

DO $tablecheck$
DECLARE v_table oid := 'private.bot_media_upload_attempts'::regclass; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=v_table AND relkind='r' AND relpersistence='p'
    AND relrowsecurity AND NOT relforcerowsecurity AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=v_table)
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=v_table AND NOT tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=v_table AND (a.grantee<>c.relowner OR a.grantor<>c.relowner))
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=v_table AND attnum>0 AND (attisdropped OR coalesce(cardinality(attacl),0)>0))
    OR (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) ORDER BY attnum)
      FROM pg_attribute WHERE attrelid=v_table AND attnum>0) IS DISTINCT FROM
      '[["bot_id","uuid",true],["idempotency_key","text",true],["attempt_id","uuid",true],
        ["owner_token_id","uuid",true],["chat_id","uuid",true],["request_fingerprint","text",true],
        ["object_path","text",true],["content_type","text",true],["byte_size","bigint",true],
        ["content_sha256","text",true],["state","text",true],["started_at","timestamp with time zone",true],
        ["observed_at","timestamp with time zone",false]]'::jsonb
    OR (SELECT count(*) FROM pg_attrdef WHERE adrelid=v_table)<>1
    OR NOT EXISTS (SELECT 1 FROM pg_attrdef WHERE adrelid=v_table AND adnum=11 AND pg_get_expr(adbin,adrelid)=$expr$'pending'::text$expr$)
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid=v_table AND contype<>'n')<>8
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=v_table AND (NOT convalidated OR condeferrable OR condeferred))
    OR (SELECT count(*) FROM pg_index WHERE indrelid=v_table)<>2
    OR EXISTS (SELECT 1 FROM pg_index WHERE indrelid=v_table AND (NOT indisunique OR NOT indisvalid OR NOT indisready OR indpred IS NOT NULL OR indexprs IS NOT NULL)) THEN
    RAISE EXCEPTION 'bot_media_upload_table_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('bot_media_upload_attempts_pkey','PRIMARY KEY (bot_id, idempotency_key, attempt_id)'),
    ('bot_media_upload_attempts_attempt_id_key','UNIQUE (attempt_id)'),
    ('bot_media_upload_attempts_key_check',$expr$CHECK ((idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'::text))$expr$),
    ('bot_media_upload_attempts_fingerprint_check',$expr$CHECK ((request_fingerprint ~ '^[0-9a-f]{64}$'::text))$expr$),
    ('bot_media_upload_attempts_sha_check',$expr$CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text))$expr$),
    ('bot_media_upload_attempts_size_check','CHECK (((byte_size >= 1) AND (byte_size <= 6291456)))'),
    ('bot_media_upload_attempts_state_check',$expr$CHECK ((state = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'unknown'::text])))$expr$),
    ('bot_media_upload_attempts_observed_check',$expr$CHECK ((((state = 'pending'::text) AND (observed_at IS NULL)) OR ((state <> 'pending'::text) AND (observed_at IS NOT NULL))))$expr$)
  ) expected(name,definition) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=v_table AND conname=r.name AND pg_get_constraintdef(oid)=r.definition) THEN
      RAISE EXCEPTION 'bot_media_upload_table_constraint_drift';
    END IF;
  END LOOP;
END
$tablecheck$;
SET LOCAL ROLE postgres;
DROP FUNCTION public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text);
DROP FUNCTION public.bot_media_upload_finish_internal(uuid,text,uuid,text);
SET LOCAL ROLE supabase_admin;
DO $rollback_check$
BEGIN
  IF to_regprocedure('public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)') IS NOT NULL
    OR to_regprocedure('public.bot_media_upload_finish_internal(uuid,text,uuid,text)') IS NOT NULL
    OR to_regclass('private.bot_media_upload_attempts') IS NULL THEN
    RAISE EXCEPTION 'bot_media_upload_rollback_incomplete';
  END IF;
END
$rollback_check$;
COMMIT;
