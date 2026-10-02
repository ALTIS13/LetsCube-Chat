-- Bot upload intents: candidate/source rehearsal only, NOT a writer or generation fence.
-- Rollback: 20261002155123_bot_media_upload_intents.rollback.sql; pauses RPCs, retains ledger.
-- Before production: coordinator fresh verified backup + isolated full PG17 restore,
-- raising self-checks, behavioral/grant review and byte-identical SQL/rollback archive.
-- Pause inline ingestion before rollback. Reapply over retained attempts refuses loudly.
-- Lease UUID is attempt identity, NOT Storage object generation. No transaction spans I/O.
-- Pending/crashed or unknown outcomes are indefinite holds, never age/lease-based cleanup.
-- Acknowledged records only trusted runtime observation, not provider/other-writer fencing.
-- No Storage calls, deletion, refund, quota mutation, cascading FK or automatic pruning.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE r record; p pg_proc;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-media-upload-intents:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_upload_migration_busy';
  END IF;
  IF to_regclass('private.bot_media_upload_attempts') IS NOT NULL
    OR to_regprocedure('public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)') IS NOT NULL
    OR to_regprocedure('public.bot_media_upload_finish_internal(uuid,text,uuid,text)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='public' AND f.proname IN ('bot_media_upload_begin_internal','bot_media_upload_finish_internal')) THEN
    RAISE EXCEPTION 'bot_media_upload_prestate_exists';
  END IF;
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
  FOR r IN SELECT * FROM (VALUES ('private.bot_media_ingests'),('private.bot_tokens'),
    ('public.bots'),('public.chat_bot_members'),('public.chats')) expected(relation_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(r.relation_name)
      AND relkind='r' AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN
      RAISE EXCEPTION 'bot_media_upload_existing_relation_drift';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_ingests','bot_id','uuid'),('private.bot_media_ingests','idempotency_key','text'),
    ('private.bot_media_ingests','owner_token_id','uuid'),('private.bot_media_ingests','chat_id','uuid'),
    ('private.bot_media_ingests','request_fingerprint','text'),('private.bot_media_ingests','object_path','text'),
    ('private.bot_media_ingests','content_type','text'),('private.bot_media_ingests','byte_size','bigint'),
    ('private.bot_media_ingests','content_sha256','text'),('private.bot_media_ingests','lease_id','uuid'),
    ('private.bot_media_ingests','lease_expires_at','timestamp with time zone'),('private.bot_media_ingests','state','text'),
    ('private.bot_tokens','id','uuid'),('private.bot_tokens','bot_id','uuid'),('private.bot_tokens','revoked_at','timestamp with time zone'),
    ('public.bots','id','uuid'),('public.bots','state','text'),('public.chat_bot_members','bot_id','uuid'),
    ('public.chat_bot_members','chat_id','uuid'),('public.chat_bot_members','removed_at','timestamp with time zone')
  ) expected(relation_name,column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=r.relation_name::regclass
      AND attnum>0 AND NOT attisdropped AND attname=r.column_name AND atttypid=r.type_name::regtype) THEN
      RAISE EXCEPTION 'bot_media_upload_existing_column_drift';
    END IF;
  END LOOP;
END
$prestate$;

SET LOCAL ROLE postgres;
CREATE TABLE private.bot_media_upload_attempts (
  bot_id uuid NOT NULL,
  idempotency_key text NOT NULL CONSTRAINT bot_media_upload_attempts_key_check CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  attempt_id uuid NOT NULL UNIQUE,
  owner_token_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  request_fingerprint text NOT NULL CONSTRAINT bot_media_upload_attempts_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  object_path text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CONSTRAINT bot_media_upload_attempts_size_check CHECK (byte_size BETWEEN 1 AND 6291456),
  content_sha256 text NOT NULL CONSTRAINT bot_media_upload_attempts_sha_check CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CONSTRAINT bot_media_upload_attempts_state_check CHECK (state IN ('pending','acknowledged','unknown')),
  started_at timestamptz NOT NULL,
  observed_at timestamptz,
  PRIMARY KEY (bot_id,idempotency_key,attempt_id),
  CONSTRAINT bot_media_upload_attempts_observed_check CHECK ((state='pending' AND observed_at IS NULL)
    OR (state<>'pending' AND observed_at IS NOT NULL))
);
ALTER TABLE private.bot_media_upload_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.bot_media_upload_attempts FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.bot_media_upload_attempts IS
  'Append-preserved upload attempts. Pending/unknown are indefinite holds. Lease UUID is NOT object generation; no automatic pruning or deletion permission.';

CREATE FUNCTION public.bot_media_upload_begin_internal(
  p_bot_id uuid,p_token_id uuid,p_chat_id uuid,p_idempotency_key text,p_request_fingerprint text,
  p_lease_id uuid,p_object_path text,p_content_type text,p_byte_size bigint,p_content_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_row private.bot_media_ingests%rowtype;
  v_count bigint;
  v_now timestamptz;
BEGIN
  IF p_bot_id IS NULL OR p_token_id IS NULL OR p_chat_id IS NULL OR p_lease_id IS NULL
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_content_sha256 IS NULL OR p_content_sha256 !~ '^[0-9a-f]{64}$'
    OR p_object_path IS NULL OR pg_catalog.octet_length(p_object_path) NOT BETWEEN 80 AND 1024
    OR p_content_type IS NULL OR p_content_type NOT IN ('image/jpeg','image/png','image/webp','image/gif',
      'video/mp4','video/webm','audio/webm','audio/ogg','audio/mpeg','application/pdf')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 6291456 THEN
    RAISE EXCEPTION 'bot_media_upload_input_invalid' USING ERRCODE='22023';
  END IF;
  -- Same operation identity as reserve/commit. Never take the quota lock after this lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key,0));
  PERFORM 1 FROM private.bot_tokens t JOIN public.bots b ON b.id=t.bot_id
    WHERE t.id=p_token_id AND t.bot_id=p_bot_id AND t.revoked_at IS NULL AND b.state='active'
    FOR SHARE OF t,b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_media_ingest_token_revoked' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM private.bot_media_ingests
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR v_row.state<>'reserved' THEN
    RAISE EXCEPTION 'bot_media_upload_reservation_invalid' USING ERRCODE='42501';
  END IF;
  IF v_row.chat_id IS DISTINCT FROM p_chat_id OR v_row.request_fingerprint IS DISTINCT FROM p_request_fingerprint
    OR v_row.object_path IS DISTINCT FROM p_object_path OR v_row.content_type IS DISTINCT FROM p_content_type
    OR v_row.byte_size IS DISTINCT FROM p_byte_size OR v_row.content_sha256 IS DISTINCT FROM p_content_sha256 THEN
    RAISE EXCEPTION 'bot_media_upload_snapshot_conflict' USING ERRCODE='23505';
  END IF;
  IF v_row.owner_token_id<>p_token_id OR v_row.lease_id<>p_lease_id THEN
    RAISE EXCEPTION 'bot_media_upload_lease_invalid' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.chat_bot_members m WHERE m.bot_id=p_bot_id AND m.chat_id=p_chat_id AND m.removed_at IS NULL
    FOR SHARE OF m;
  IF NOT FOUND OR coalesce((public.bot_membership_authorize_internal(p_bot_id,p_chat_id,'send_message')->>'allowed')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'bot_chat_forbidden' USING ERRCODE='42501';
  END IF;
  -- All advisory/auth/membership/receipt waits precede this wall-clock observation.
  v_now := pg_catalog.clock_timestamp();
  IF v_row.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'bot_media_ingest_lease_expired' USING ERRCODE='55000',DETAIL='1';
  END IF;
  IF EXISTS (SELECT 1 FROM private.bot_media_upload_attempts
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key AND attempt_id=p_lease_id) THEN
    -- Even a lost begin response cannot authorize a second PUT under this lease.
    RAISE EXCEPTION 'bot_media_upload_attempt_exists' USING ERRCODE='23505';
  END IF;
  SELECT count(*) INTO v_count FROM private.bot_media_upload_attempts
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key;
  IF v_count >= 64 THEN
    RAISE EXCEPTION 'bot_media_upload_attempts_exceeded' USING ERRCODE='54000';
  END IF;
  BEGIN
    INSERT INTO private.bot_media_upload_attempts(bot_id,idempotency_key,attempt_id,owner_token_id,chat_id,
      request_fingerprint,object_path,content_type,byte_size,content_sha256,state,started_at)
      VALUES(p_bot_id,p_idempotency_key,p_lease_id,v_row.owner_token_id,v_row.chat_id,v_row.request_fingerprint,
        v_row.object_path,v_row.content_type,v_row.byte_size,v_row.content_sha256,'pending',v_now);
  EXCEPTION WHEN unique_violation THEN
    -- A reused historical UUID across receipts also fails without echoing identity details.
    RAISE EXCEPTION 'bot_media_upload_attempt_exists' USING ERRCODE='23505';
  END;
  RETURN pg_catalog.jsonb_build_object('attempt_id',p_lease_id,'state','pending');
END
$function$;

CREATE FUNCTION public.bot_media_upload_finish_internal(
  p_bot_id uuid,p_idempotency_key text,p_attempt_id uuid,p_outcome text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_attempt private.bot_media_upload_attempts%rowtype;
BEGIN
  IF p_bot_id IS NULL OR p_attempt_id IS NULL OR p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_outcome IS NULL OR p_outcome NOT IN ('acknowledged','unknown') THEN
    RAISE EXCEPTION 'bot_media_upload_input_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key,0));
  -- Authenticate this persisted identity, not a rotated lease or now-revoked token.
  SELECT * INTO v_attempt FROM private.bot_media_upload_attempts
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key AND attempt_id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_media_upload_attempt_not_found' USING ERRCODE='42501';
  END IF;
  IF v_attempt.state=p_outcome THEN
    RETURN pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'state',v_attempt.state);
  END IF;
  IF v_attempt.state <> 'pending' THEN
    RAISE EXCEPTION 'bot_media_upload_outcome_conflict' USING ERRCODE='23505';
  END IF;
  UPDATE private.bot_media_upload_attempts SET state=p_outcome,observed_at=pg_catalog.clock_timestamp()
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key AND attempt_id=p_attempt_id;
  RETURN pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'state',p_outcome);
END
$function$;

REVOKE ALL ON FUNCTION public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bot_media_upload_finish_internal(uuid,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_media_upload_finish_internal(uuid,text,uuid,text) TO service_role;

SET LOCAL ROLE supabase_admin;
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
COMMIT;
