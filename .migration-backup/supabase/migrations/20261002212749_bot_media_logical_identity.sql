-- Logical identity only: NOT a physical Storage generation or message admission fence.
-- Rollback: 20261002212749_bot_media_logical_identity.rollback.sql pauses ingestion,
-- retaining all identities, bindings, immutability guards and original charged rows.
-- Production requires fresh verified backup, same-image PG17 restore and independent review.
-- No Storage I/O, DELETE/refund, path reuse, cleanup, client authority or message hooks.
-- Bootstrap locks drain legacy writers and install hooks/backfill in one transaction.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE r record; p pg_proc;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'bot_media_identity_isolation_invalid';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-media-logical-identity:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_identity_migration_busy';
  END IF;
  FOR r IN SELECT unnest(ARRAY['bot_media_path_claims','bot_media_object_identities',
    'bot_media_attempt_bindings','bot_media_grant_bindings','bot_media_grant_claims']) AS name LOOP
    IF to_regclass('private.' || r.name) IS NOT NULL THEN
      RAISE EXCEPTION 'bot_media_identity_prestate_exists';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc fn JOIN pg_namespace n ON n.oid=fn.pronamespace
    WHERE n.nspname='private' AND starts_with(fn.proname,'bot_media_identity_')) THEN
    RAISE EXCEPTION 'bot_media_identity_prestate_exists';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)','5fc63a11be9b4e37ff6a062ed6f488c3b7f514f2b6e84a686b192e9681b1ba8f'),
    ('public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)','2457425516395f7e2f31c27dc5dd9e8fac102c2bc3819f5d3f836d73bfc2ef97'),
    ('public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)','48c0f4f80afc285c20d8817d4b97d41e3eb2be1ee59d5e61a34f5f5d72939814'),
    ('public.bot_media_upload_finish_internal(uuid,text,uuid,text)','0d4631dcc436ff6bbd4d145470ab456cceb9dac8c2cb0af6ba57bf6b3e023286'),
    ('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)','d63775d1cd35ba368a345476903a81af6f0fbdac7000c4ff46667ba9be310393')
  ) expected(signature,hash) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
    IF NOT FOUND OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM r.hash
      OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
      OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
      OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN
      RAISE EXCEPTION 'bot_media_identity_function_drift:%',r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['private.bot_media_ingests','private.bot_media_upload_attempts',
    'private.bot_upload_grants']) AS name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(r.name) AND relkind='r'
      AND relrowsecurity AND pg_get_userbyid(relowner)='postgres')
      OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(r.name) AND NOT tgisinternal)
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=to_regclass(r.name) AND (a.grantee<>c.relowner OR a.grantor<>c.relowner))
      OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(r.name) AND attnum>0
        AND coalesce(cardinality(attacl),0)>0) THEN
      RAISE EXCEPTION 'bot_media_identity_relation_drift';
    END IF;
  END LOOP;
END
$prestate$;

-- The established runtime lock order is receipt before attempt/grant. No auth,
-- quota or operation lock is acquired after this drain.
LOCK TABLE private.bot_media_ingests, private.bot_media_upload_attempts,
  private.bot_upload_grants IN ACCESS EXCLUSIVE MODE;
SET LOCAL ROLE postgres;

CREATE TEMP TABLE bot_media_identity_prestate ON COMMIT DROP AS
SELECT 'receipts'::text AS name, coalesce(jsonb_agg(to_jsonb(r) ORDER BY bot_id,idempotency_key),'[]'::jsonb) AS value
  FROM private.bot_media_ingests r
UNION ALL SELECT 'attempts',coalesce(jsonb_agg(to_jsonb(r) ORDER BY attempt_id),'[]'::jsonb)
  FROM private.bot_media_upload_attempts r
UNION ALL SELECT 'grants',coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb)
  FROM private.bot_upload_grants r;

-- A shared unique path slot closes grant-before-receipt races without adding an
-- advisory lock after the runtime's grant lock. Unmanaged slots are tombstones:
-- ordinary grants may expire/reissue, but ingestion cannot adopt their old path.
CREATE TABLE private.bot_media_path_claims (
  bucket_id text NOT NULL CHECK (bucket_id='chat-media'),
  object_path text NOT NULL CHECK (octet_length(object_path) BETWEEN 1 AND 1024),
  claim_kind text NOT NULL CHECK (claim_kind IN ('ingest','unmanaged')),
  PRIMARY KEY (bucket_id,object_path),
  UNIQUE (bucket_id,object_path,claim_kind)
);
CREATE TABLE private.bot_media_object_identities (
  generation_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  bucket_id text NOT NULL CHECK (bucket_id='chat-media'),
  object_path text NOT NULL,
  claim_kind text NOT NULL DEFAULT 'ingest' CHECK (claim_kind='ingest'),
  bot_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  chat_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('sendPhoto','sendVideo','sendDocument','sendVoice')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 6291456),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_created_at timestamptz NOT NULL,
  UNIQUE (bucket_id,object_path),
  UNIQUE (bot_id,idempotency_key),
  FOREIGN KEY (bucket_id,object_path,claim_kind)
    REFERENCES private.bot_media_path_claims(bucket_id,object_path,claim_kind)
);
CREATE TABLE private.bot_media_attempt_bindings (
  attempt_id uuid PRIMARY KEY,
  generation_id uuid NOT NULL REFERENCES private.bot_media_object_identities(generation_id)
);
CREATE TABLE private.bot_media_grant_claims (
  grant_id uuid PRIMARY KEY
);
CREATE TABLE private.bot_media_grant_bindings (
  grant_id uuid PRIMARY KEY REFERENCES private.bot_media_grant_claims(grant_id),
  generation_id uuid NOT NULL REFERENCES private.bot_media_object_identities(generation_id),
  issued_at timestamptz NOT NULL
);
COMMENT ON TABLE private.bot_media_object_identities IS
  'Immutable logical admission identity, NOT a verified physical Storage incarnation. No path reuse or reclamation authority.';
COMMENT ON TABLE private.bot_media_grant_bindings IS
  'Issuance binding retained after the existing grant expires/is pruned; intentionally no FK to the prunable grant.';
COMMENT ON TABLE private.bot_media_grant_claims IS
  'Retained issuance UUIDs, including ordinary grants, arbitrate reuse under old snapshots; grants may still expire/prune normally.';

ALTER TABLE private.bot_media_path_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.bot_media_object_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.bot_media_attempt_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.bot_media_grant_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.bot_media_grant_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.bot_media_path_claims,private.bot_media_object_identities,
  private.bot_media_attempt_bindings,private.bot_media_grant_bindings,private.bot_media_grant_claims FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO private.bot_media_path_claims SELECT 'chat-media',object_path,'ingest' FROM private.bot_media_ingests;
INSERT INTO private.bot_media_path_claims SELECT DISTINCT bucket_id,object_path,'unmanaged'
  FROM private.bot_upload_grants WHERE bucket_id='chat-media' ON CONFLICT DO NOTHING;
INSERT INTO private.bot_media_object_identities(bucket_id,object_path,bot_id,idempotency_key,chat_id,method,
  request_fingerprint,content_type,byte_size,content_sha256,receipt_created_at)
SELECT 'chat-media',object_path,bot_id,idempotency_key,chat_id,method,request_fingerprint,
  content_type,byte_size,content_sha256,created_at FROM private.bot_media_ingests;

DO $snapshots$
BEGIN
  IF EXISTS (SELECT 1 FROM private.bot_media_upload_attempts a
    LEFT JOIN private.bot_media_object_identities i USING(bot_id,idempotency_key)
    WHERE i.generation_id IS NULL OR (a.chat_id,a.request_fingerprint,a.object_path,a.content_type,a.byte_size,a.content_sha256)
      IS DISTINCT FROM (i.chat_id,i.request_fingerprint,i.object_path,i.content_type,i.byte_size,i.content_sha256))
    OR EXISTS (SELECT 1 FROM private.bot_upload_grants g JOIN private.bot_media_object_identities i
      ON g.bucket_id=i.bucket_id AND g.object_path=i.object_path
      WHERE (g.bot_id,g.chat_id,g.content_type,g.byte_size)
        IS DISTINCT FROM (i.bot_id,i.chat_id,i.content_type,i.byte_size)) THEN
    RAISE EXCEPTION 'bot_media_identity_snapshot_conflict' USING ERRCODE='23514';
  END IF;
END
$snapshots$;
INSERT INTO private.bot_media_attempt_bindings SELECT a.attempt_id,i.generation_id
  FROM private.bot_media_upload_attempts a JOIN private.bot_media_object_identities i USING(bot_id,idempotency_key);
INSERT INTO private.bot_media_grant_claims SELECT id FROM private.bot_upload_grants;
INSERT INTO private.bot_media_grant_bindings SELECT g.id,i.generation_id,g.created_at
  FROM private.bot_upload_grants g JOIN private.bot_media_object_identities i
  ON g.bucket_id=i.bucket_id AND g.object_path=i.object_path;

CREATE FUNCTION private.bot_media_identity_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  RAISE EXCEPTION 'bot_media_identity_immutable' USING ERRCODE='55000';
END
$function$;

CREATE FUNCTION private.bot_media_identity_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['owner_token_id','lease_id','lease_expires_at','state','commit_xid','result','completed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['owner_token_id','lease_id','lease_expires_at','state','commit_xid','result','completed_at'])
    OR (OLD.state='complete' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'bot_media_identity_receipt_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION private.bot_media_identity_receipt_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE kind text;
BEGIN
  INSERT INTO private.bot_media_path_claims VALUES ('chat-media',NEW.object_path,'ingest') ON CONFLICT DO NOTHING;
  SELECT claim_kind INTO kind FROM private.bot_media_path_claims
    WHERE bucket_id='chat-media' AND object_path=NEW.object_path;
  IF NOT FOUND THEN
    -- A conflicting concurrent INSERT is visible to uniqueness but not an old
    -- REPEATABLE READ snapshot. Fail, never admit an unbound object.
    RAISE EXCEPTION 'bot_media_identity_snapshot_retry' USING ERRCODE='40001';
  END IF;
  IF kind<>'ingest' THEN
    RAISE EXCEPTION 'bot_media_identity_path_reuse' USING ERRCODE='23505';
  END IF;
  INSERT INTO private.bot_media_object_identities(bucket_id,object_path,bot_id,idempotency_key,chat_id,method,
    request_fingerprint,content_type,byte_size,content_sha256,receipt_created_at)
  VALUES ('chat-media',NEW.object_path,NEW.bot_id,NEW.idempotency_key,NEW.chat_id,NEW.method,
    NEW.request_fingerprint,NEW.content_type,NEW.byte_size,NEW.content_sha256,NEW.created_at);
  RETURN NEW;
END
$function$;

CREATE FUNCTION private.bot_media_identity_attempt_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','observed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','observed_at'])
    OR (OLD.state<>'pending' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'bot_media_identity_attempt_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION private.bot_media_identity_attempt_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE i private.bot_media_object_identities%rowtype;
BEGIN
  SELECT * INTO i FROM private.bot_media_object_identities WHERE bot_id=NEW.bot_id AND idempotency_key=NEW.idempotency_key;
  IF NOT FOUND OR (NEW.chat_id,NEW.request_fingerprint,NEW.object_path,NEW.content_type,NEW.byte_size,NEW.content_sha256)
    IS DISTINCT FROM (i.chat_id,i.request_fingerprint,i.object_path,i.content_type,i.byte_size,i.content_sha256) THEN
    RAISE EXCEPTION 'bot_media_identity_attempt_conflict' USING ERRCODE='23514';
  END IF;
  INSERT INTO private.bot_media_attempt_bindings VALUES (NEW.attempt_id,i.generation_id);
  RETURN NEW;
END
$function$;

CREATE FUNCTION private.bot_media_identity_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE i private.bot_media_object_identities%rowtype; kind text; bound boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    PERFORM 1 FROM private.bot_media_grant_claims WHERE grant_id=OLD.id;
    IF NOT FOUND THEN
      -- A snapshot older than bootstrap may see the legacy grant but neither
      -- its atomic claim nor binding. Absence is not an unmanaged grant.
      RAISE EXCEPTION 'bot_media_identity_snapshot_retry' USING ERRCODE='40001';
    END IF;
  END IF;
  -- Uniqueness arbitrates retained UUIDs even when an old RR snapshot cannot
  -- see a committed binding and the original expiring grant has been pruned.
  IF TG_OP='INSERT' OR NEW.id IS DISTINCT FROM OLD.id THEN
    INSERT INTO private.bot_media_grant_claims VALUES (NEW.id);
  END IF;
  SELECT EXISTS(SELECT 1 FROM private.bot_media_grant_bindings WHERE grant_id=NEW.id) INTO bound;
  IF TG_OP='UPDATE' THEN
    IF EXISTS(SELECT 1 FROM private.bot_media_grant_bindings WHERE grant_id=OLD.id) THEN
      IF (NEW.id,NEW.bot_id,NEW.chat_id,NEW.bucket_id,NEW.object_path,NEW.content_type,NEW.byte_size,NEW.created_at)
        IS DISTINCT FROM (OLD.id,OLD.bot_id,OLD.chat_id,OLD.bucket_id,OLD.object_path,OLD.content_type,OLD.byte_size,OLD.created_at) THEN
        RAISE EXCEPTION 'bot_media_identity_grant_immutable' USING ERRCODE='55000';
      END IF;
      RETURN NEW;
    END IF;
    IF bound THEN
      RAISE EXCEPTION 'bot_media_identity_grant_reuse' USING ERRCODE='23505';
    END IF;
  ELSIF bound THEN
    RAISE EXCEPTION 'bot_media_identity_grant_reuse' USING ERRCODE='23505';
  END IF;
  IF NEW.bucket_id<>'chat-media' THEN RETURN NEW; END IF;
  INSERT INTO private.bot_media_path_claims VALUES (NEW.bucket_id,NEW.object_path,'unmanaged') ON CONFLICT DO NOTHING;
  SELECT claim_kind INTO kind FROM private.bot_media_path_claims
    WHERE bucket_id=NEW.bucket_id AND object_path=NEW.object_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_media_identity_snapshot_retry' USING ERRCODE='40001';
  END IF;
  IF kind='unmanaged' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'bot_media_identity_grant_promotion' USING ERRCODE='55000';
  END IF;
  SELECT * INTO i FROM private.bot_media_object_identities
    WHERE bucket_id=NEW.bucket_id AND object_path=NEW.object_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_media_identity_snapshot_retry' USING ERRCODE='40001';
  END IF;
  IF (NEW.bot_id,NEW.chat_id,NEW.content_type,NEW.byte_size) IS DISTINCT FROM
    (i.bot_id,i.chat_id,i.content_type,i.byte_size) THEN
    RAISE EXCEPTION 'bot_media_identity_grant_conflict' USING ERRCODE='23514';
  END IF;
  INSERT INTO private.bot_media_grant_bindings VALUES (NEW.id,i.generation_id,NEW.created_at);
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.bot_media_identity_immutable(),private.bot_media_identity_receipt_guard(),
  private.bot_media_identity_receipt_insert(),private.bot_media_identity_attempt_guard(),
  private.bot_media_identity_attempt_insert(),private.bot_media_identity_grant() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER bot_media_identity_receipt_guard BEFORE UPDATE OR DELETE ON private.bot_media_ingests
  FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_receipt_guard();
CREATE TRIGGER bot_media_identity_receipt_truncate BEFORE TRUNCATE ON private.bot_media_ingests
  FOR EACH STATEMENT EXECUTE FUNCTION private.bot_media_identity_immutable();
CREATE TRIGGER bot_media_identity_receipt_insert AFTER INSERT ON private.bot_media_ingests
  FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_receipt_insert();
CREATE TRIGGER bot_media_identity_attempt_guard BEFORE UPDATE OR DELETE ON private.bot_media_upload_attempts
  FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_attempt_guard();
CREATE TRIGGER bot_media_identity_attempt_truncate BEFORE TRUNCATE ON private.bot_media_upload_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION private.bot_media_identity_immutable();
CREATE TRIGGER bot_media_identity_attempt_insert AFTER INSERT ON private.bot_media_upload_attempts
  FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_attempt_insert();
CREATE TRIGGER bot_media_identity_grant_insert AFTER INSERT ON private.bot_upload_grants
  FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_grant();
CREATE TRIGGER bot_media_identity_grant_update BEFORE UPDATE ON private.bot_upload_grants
  FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_grant();

DO $guards$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['bot_media_path_claims','bot_media_object_identities',
    'bot_media_attempt_bindings','bot_media_grant_bindings','bot_media_grant_claims'] LOOP
    EXECUTE format('CREATE TRIGGER bot_media_identity_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.bot_media_identity_immutable()',name);
    EXECUTE format('CREATE TRIGGER bot_media_identity_truncate BEFORE TRUNCATE ON private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.bot_media_identity_immutable()',name);
  END LOOP;
END
$guards$;

DO $selfcheck$
DECLARE r record; actual jsonb;
BEGIN
  FOR r IN SELECT * FROM bot_media_identity_prestate LOOP
    CASE r.name
      WHEN 'receipts' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY bot_id,idempotency_key),'[]'::jsonb) INTO actual FROM private.bot_media_ingests t;
      WHEN 'attempts' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY attempt_id),'[]'::jsonb) INTO actual FROM private.bot_media_upload_attempts t;
      WHEN 'grants' THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) INTO actual FROM private.bot_upload_grants t;
    END CASE;
    IF actual IS DISTINCT FROM r.value THEN RAISE EXCEPTION 'bot_media_identity_original_rows_changed'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM private.bot_media_object_identities)<>(SELECT count(*) FROM private.bot_media_ingests)
    OR (SELECT count(*) FROM private.bot_media_attempt_bindings)<>(SELECT count(*) FROM private.bot_media_upload_attempts)
    OR (SELECT count(*) FROM private.bot_media_grant_bindings)<>(SELECT count(*) FROM private.bot_upload_grants g
      JOIN private.bot_media_object_identities i ON g.bucket_id=i.bucket_id AND g.object_path=i.object_path) THEN
    RAISE EXCEPTION 'bot_media_identity_binding_coverage';
  END IF;
  FOR r IN SELECT unnest(ARRAY['bot_media_path_claims','bot_media_object_identities',
    'bot_media_attempt_bindings','bot_media_grant_bindings','bot_media_grant_claims']) AS name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('private.'||r.name)
      AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres')
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=to_regclass('private.'||r.name) AND (a.grantee<>c.relowner OR a.grantor<>c.relowner))
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=to_regclass('private.'||r.name))
      OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=to_regclass('private.'||r.name) AND NOT tgisinternal AND tgenabled='O')<>2 THEN
      RAISE EXCEPTION 'bot_media_identity_private_table_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('private.bot_media_ingests'::regclass,
    'private.bot_media_upload_attempts'::regclass,'private.bot_upload_grants'::regclass)
    AND NOT tgisinternal AND tgenabled='O')<>8
    OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='private' AND starts_with(p.proname,'bot_media_identity_'))<>6
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE n.nspname='private' AND starts_with(p.proname,'bot_media_identity_')
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION 'bot_media_identity_hook_drift';
  END IF;
END
$selfcheck$;
COMMIT;
