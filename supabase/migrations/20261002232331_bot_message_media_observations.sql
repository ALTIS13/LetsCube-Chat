-- Stage 3 fallback: derived current message observations, NOT admission/fencing.
-- Rollback: 20261002232331_bot_message_media_observations.rollback.sql (no CASCADE).
-- Preserve whole-chat-media purge hold; empty/registered rows never permit cleanup.
-- No changes to messages, old RPCs, policies, quotas, Storage or provider I/O.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL ROLE postgres;

DO $precondition$
DECLARE r record;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR to_regclass('private.bot_message_media_observations') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='private' AND p.proname='bot_message_media_observe_statement') THEN
    RAISE EXCEPTION 'bot_message_observation_prestate_invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.messages'::regclass
    AND relkind='r' AND NOT relispartition AND relrowsecurity
    AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent='public.messages'::regclass
      OR inhrelid='public.messages'::regclass) THEN
    RAISE EXCEPTION 'bot_message_observation_relation_invalid';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('id','uuid'),('media_bucket','text'),('media_path','text'),
    ('media_url','text'),('media_metadata','jsonb')) expected(name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.messages'::regclass
      AND attname=r.name AND attnum>0 AND NOT attisdropped AND atttypid=r.type_name::regtype) THEN
      RAISE EXCEPTION 'bot_message_observation_column_invalid';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_url_pointer(text)','49a25a5482bf40a4cc4e6923d2906e879269921ec6a5283c31060db1bbb1a431'),
    ('private.bot_message_media_references(text,text,text,jsonb)','d2fab6a6a849c758e96505d0b8ae5ac54f5bc9c4a3d091c3294886de93973082')
  ) expected(signature,body_hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(r.signature)
      AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=r.body_hash) THEN
      RAISE EXCEPTION 'bot_message_observation_resolver_invalid';
    END IF;
  END LOOP;
END
$precondition$;

-- Drain earlier message writers, then backfill and install in this transaction.
-- READ COMMITTED is set before the first snapshot, even under a session RR default.
LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE bot_message_observation_prestate ON COMMIT DROP AS
SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]')::text,'UTF8')),'hex') AS digest
FROM public.messages m;

CREATE TABLE private.bot_message_media_observations (
  message_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('canonical','legacy_url','preview','metadata')),
  bucket_id text,
  object_path text,
  generation_id uuid,
  reference_state text NOT NULL CHECK (reference_state IN ('registered','unresolved','ambiguous')),
  hold_reason text,
  PRIMARY KEY (message_id,source_kind),
  CHECK ((reference_state='registered' AND generation_id IS NOT NULL AND bucket_id IS NOT NULL
      AND object_path IS NOT NULL AND hold_reason IS NULL)
    OR (reference_state='unresolved' AND hold_reason IS NOT NULL AND hold_reason IN
      ('missing_bucket','invalid_path','unsupported_url','malformed_metadata','unregistered_object'))
    OR (reference_state='ambiguous' AND hold_reason IS NOT NULL AND hold_reason='conflicting_pointers'))
);
ALTER TABLE private.bot_message_media_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.bot_message_media_observations FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX bot_message_media_observations_object_idx
  ON private.bot_message_media_observations(bucket_id,object_path,generation_id);

CREATE FUNCTION private.bot_message_media_observe_statement()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_ids uuid[];
BEGIN
  IF TG_RELID<>'public.messages'::pg_catalog.regclass OR TG_LEVEL<>'STATEMENT' OR TG_WHEN<>'AFTER' THEN
    RAISE EXCEPTION 'bot_message_observation_trigger_context_invalid';
  END IF;
  IF TG_OP='TRUNCATE' THEN
    DELETE FROM private.bot_message_media_observations;
    RETURN NULL;
  ELSIF TG_OP='INSERT' THEN
    SELECT pg_catalog.array_agg(id) INTO v_ids FROM new_messages;
  ELSIF TG_OP='UPDATE' THEN
    SELECT pg_catalog.array_agg(id) INTO v_ids FROM
      (SELECT id FROM old_messages UNION SELECT id FROM new_messages) affected;
  ELSIF TG_OP='DELETE' THEN
    SELECT pg_catalog.array_agg(id) INTO v_ids FROM old_messages;
  ELSE
    RAISE EXCEPTION 'bot_message_observation_trigger_event_invalid';
  END IF;
  IF v_ids IS NULL THEN RETURN NULL; END IF;

  -- Re-read final rows: a nested AFTER ROW write can supersede a transition image.
  -- No deletion/eligibility inference and no object/quota/operation locks here.
  DELETE FROM private.bot_message_media_observations o
  WHERE o.message_id=ANY(v_ids) AND NOT EXISTS (
    SELECT 1 FROM public.messages m CROSS JOIN LATERAL
      private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) r
    WHERE m.id=o.message_id AND r.source_kind=o.source_kind
  );
  INSERT INTO private.bot_message_media_observations AS o
    (message_id,source_kind,bucket_id,object_path,generation_id,reference_state,hold_reason)
  SELECT m.id,r.source_kind,r.bucket_id,r.object_path,r.generation_id,r.reference_state,r.hold_reason
  FROM public.messages m CROSS JOIN LATERAL
    private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) r
  WHERE m.id=ANY(v_ids)
  ORDER BY m.id,r.source_kind
  ON CONFLICT (message_id,source_kind) DO UPDATE SET
    bucket_id=EXCLUDED.bucket_id,object_path=EXCLUDED.object_path,
    generation_id=CASE WHEN (o.bucket_id,o.object_path) IS NOT DISTINCT FROM
      (EXCLUDED.bucket_id,EXCLUDED.object_path) THEN coalesce(o.generation_id,EXCLUDED.generation_id)
      ELSE EXCLUDED.generation_id END,
    reference_state=EXCLUDED.reference_state,hold_reason=EXCLUDED.hold_reason
  WHERE (o.bucket_id,o.object_path,o.generation_id,o.reference_state,o.hold_reason) IS DISTINCT FROM
    (EXCLUDED.bucket_id,EXCLUDED.object_path,EXCLUDED.generation_id,EXCLUDED.reference_state,EXCLUDED.hold_reason);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION private.bot_message_media_observe_statement() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER trg_bot_message_media_observations_insert AFTER INSERT ON public.messages
  REFERENCING NEW TABLE AS new_messages FOR EACH STATEMENT
  EXECUTE FUNCTION private.bot_message_media_observe_statement();
CREATE TRIGGER trg_bot_message_media_observations_update AFTER UPDATE ON public.messages
  REFERENCING OLD TABLE AS old_messages NEW TABLE AS new_messages FOR EACH STATEMENT
  EXECUTE FUNCTION private.bot_message_media_observe_statement();
CREATE TRIGGER trg_bot_message_media_observations_delete AFTER DELETE ON public.messages
  REFERENCING OLD TABLE AS old_messages FOR EACH STATEMENT
  EXECUTE FUNCTION private.bot_message_media_observe_statement();
CREATE TRIGGER trg_bot_message_media_observations_truncate AFTER TRUNCATE ON public.messages
  FOR EACH STATEMENT EXECUTE FUNCTION private.bot_message_media_observe_statement();

INSERT INTO private.bot_message_media_observations
  (message_id,source_kind,bucket_id,object_path,generation_id,reference_state,hold_reason)
SELECT m.id,r.source_kind,r.bucket_id,r.object_path,r.generation_id,r.reference_state,r.hold_reason
FROM public.messages m CROSS JOIN LATERAL
  private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) r;
COMMENT ON TABLE private.bot_message_media_observations IS
  'Derived current message pointers only. Unresolved/ambiguous holds retained; no physical generation, admission, close, DELETE or refund authority.';
COMMENT ON FUNCTION private.bot_message_media_observe_statement() IS
  'Observe affected final message rows including nested writes. Existing message RLS/ownership applies; no object fence or client entrypoint.';

DO $self_check$
DECLARE r record;p pg_proc;
BEGIN
  IF (SELECT digest FROM pg_temp.bot_message_observation_prestate) IS DISTINCT FROM
    (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.messages m) THEN
    RAISE EXCEPTION 'bot_message_observation_messages_changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='private.bot_message_media_observations'::regclass
    AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='private.bot_message_media_observations'::regclass)
    OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='private.bot_message_media_observations'::regclass AND (a.grantee<>c.relowner OR a.grantor<>c.relowner)) THEN
    RAISE EXCEPTION 'bot_message_observation_table_authority_invalid';
  END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid='private.bot_message_media_observe_statement()'::regprocedure;
  IF pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.prorettype<>'trigger'::regtype
    OR p.pronargs<>0 OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner) THEN
    RAISE EXCEPTION 'bot_message_observation_function_authority_invalid';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('trg_bot_message_media_observations_insert',4,NULL::text,'new_messages'),
    ('trg_bot_message_media_observations_update',16,'old_messages','new_messages'),
    ('trg_bot_message_media_observations_delete',8,'old_messages',NULL::text),
    ('trg_bot_message_media_observations_truncate',32,NULL::text,NULL::text)
  ) expected(name,kind,old_name,new_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.messages'::regclass
      AND t.tgname=r.name AND t.tgtype=r.kind AND t.tgenabled='O' AND NOT t.tgisinternal
      AND t.tgfoid=p.oid AND t.tgattr::text='' AND t.tgqual IS NULL AND t.tgnargs=0
      AND t.tgoldtable::text IS NOT DISTINCT FROM r.old_name
      AND t.tgnewtable::text IS NOT DISTINCT FROM r.new_name) THEN
      RAISE EXCEPTION 'bot_message_observation_trigger_invalid';
    END IF;
  END LOOP;
  IF EXISTS (
    (SELECT m.id,refs.* FROM public.messages m CROSS JOIN LATERAL
      private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) refs
      EXCEPT ALL SELECT message_id,source_kind,bucket_id,object_path,generation_id,reference_state,hold_reason
      FROM private.bot_message_media_observations)
    UNION ALL
    (SELECT message_id,source_kind,bucket_id,object_path,generation_id,reference_state,hold_reason
      FROM private.bot_message_media_observations EXCEPT ALL
      SELECT m.id,refs.* FROM public.messages m CROSS JOIN LATERAL
      private.bot_message_media_references(m.media_bucket,m.media_path,m.media_url,m.media_metadata) refs)
  ) THEN RAISE EXCEPTION 'bot_message_observation_bootstrap_incomplete'; END IF;
END
$self_check$;
COMMIT;
