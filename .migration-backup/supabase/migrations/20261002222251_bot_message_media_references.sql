-- Foundation stage 2: private observations only, not message admission or reclamation.
-- Rollback: 20261002222251_bot_message_media_references.rollback.sql (no CASCADE).
-- Requires accepted logical identities. No rows, policies, triggers or old RPCs change.
-- Registered means logical identity, never physical Storage generation or eligibility.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL ROLE postgres;

LOCK TABLE private.bot_media_object_identities IN ACCESS SHARE MODE;
DO $precondition$
DECLARE r record;
BEGIN
  IF to_regprocedure('private.bot_media_url_pointer(text)') IS NOT NULL
    OR to_regprocedure('private.bot_message_media_references(text,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'bot_message_reference_already_present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='private.bot_media_object_identities'::regclass
    AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity
    AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='private.bot_media_object_identities'::regclass)
    OR EXISTS (SELECT 1 FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='private.bot_media_object_identities'::regclass AND a.grantee<>c.relowner) THEN
    RAISE EXCEPTION 'bot_message_reference_registry_authority_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('generation_id','uuid'),('bucket_id','text'),('object_path','text'))
    expected(column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='private.bot_media_object_identities'::regclass
      AND attname=r.column_name AND attnum>0 AND NOT attisdropped AND atttypid=r.type_name::regtype AND attnotnull) THEN
      RAISE EXCEPTION 'bot_message_reference_registry_column_drift';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_index ix WHERE ix.indrelid='private.bot_media_object_identities'::regclass
    AND ix.indisunique AND ix.indisvalid AND ix.indisready AND ix.indpred IS NULL AND ix.indexprs IS NULL
    AND ix.indnkeyatts=2
    AND ix.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=ix.indrelid AND attname='bucket_id')
    AND ix.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=ix.indrelid AND attname='object_path')) THEN
    RAISE EXCEPTION 'bot_message_reference_registry_uniqueness_drift';
  END IF;
END
$precondition$;

CREATE FUNCTION private.bot_media_url_pointer(p_url text)
RETURNS TABLE(bucket_id text,object_path text)
LANGUAGE sql IMMUTABLE PARALLEL RESTRICTED SECURITY INVOKER
SET search_path = ''
AS $function$
WITH url_path AS (
  SELECT (pg_catalog.regexp_match(CASE WHEN pg_catalog.octet_length(p_url)<=8192 THEN p_url END,
    '^https://core[.]letscube[.]ru(?::443)?(/[^?#]*)(?:[?#].*)?$','i'))[1] AS value
), parts AS (
  SELECT pg_catalog.regexp_match(value,
    '^/storage/v1/(?:object/(?:public|sign|authenticated)|render/image/(?:public|sign|authenticated))/([^/]+)/(.+)$') AS value
  FROM url_path
), raw_parts AS (
  SELECT v.part,v.value FROM parts p CROSS JOIN LATERAL
    (VALUES ('bucket',p.value[1]),('path',p.value[2])) v(part,value)
), decoded_parts AS (
  SELECT p.part,d.value FROM raw_parts p CROSS JOIN LATERAL (
    SELECT CASE WHEN pg_catalog.bool_and(code BETWEEN 33 AND 126) THEN
      pg_catalog.string_agg(CASE WHEN code BETWEEN 33 AND 126 THEN pg_catalog.chr(code) END,'' ORDER BY ordinal) END AS value
    FROM (
      SELECT t.ordinal,CASE WHEN pg_catalog.left(t.token[1],1)='%' THEN
        pg_catalog.get_byte(pg_catalog.decode(pg_catalog.substr(t.token[1],2),'hex'),0)
        ELSE pg_catalog.ascii(t.token[1]) END AS code
      FROM pg_catalog.regexp_matches(CASE WHEN pg_catalog.octet_length(p.value) BETWEEN 1 AND 3072
        AND p.value COLLATE pg_catalog."C" !~ '[^!-~]' AND p.value !~ '%(?![0-7][0-9A-Fa-f])'
        THEN p.value ELSE '' END,'(%[0-7][0-9A-Fa-f]|[^%])','g')
        WITH ORDINALITY AS t(token,ordinal)
    ) tokens
  ) d
), pointer AS (
  SELECT pg_catalog.max(value) FILTER (WHERE part='bucket') AS bucket,
    pg_catalog.max(value) FILTER (WHERE part='path') AS path FROM decoded_parts
)
SELECT p.bucket,p.path FROM pointer p
WHERE p.bucket COLLATE pg_catalog."C" ~ '^[A-Za-z0-9_-]{1,128}$'
  AND pg_catalog.octet_length(p.path) BETWEEN 1 AND 1024
  AND p.path !~ '[%?#\\[:space:]]' AND p.path !~ '(^/|/$|//|(^|/)[.][.]?(/|$))'
$function$;

CREATE FUNCTION private.bot_message_media_references(
  p_media_bucket text,p_media_path text,p_media_url text,p_media_metadata jsonb
)
RETURNS TABLE(source_kind text,bucket_id text,object_path text,generation_id uuid,reference_state text,hold_reason text)
LANGUAGE sql STABLE PARALLEL RESTRICTED SECURITY INVOKER
SET search_path = ''
AS $function$
WITH observations AS (
  SELECT 'canonical'::text AS source_kind,p_media_bucket AS bucket_id,p_media_path AS object_path,
    NULL::text AS problem WHERE p_media_path IS NOT NULL
  UNION ALL
  -- LEFT JOIN retains an unsupported nonempty URL as a hold, even beside a canonical pointer.
  SELECT 'legacy_url',u.bucket_id,u.object_path,
    CASE WHEN u.bucket_id IS NULL THEN 'unsupported_url' END
  FROM (SELECT 1 WHERE p_media_url IS NOT NULL AND p_media_url<>'') present
    LEFT JOIN LATERAL private.bot_media_url_pointer(p_media_url) u ON true
  UNION ALL
  SELECT 'metadata',NULL,NULL,'malformed_metadata'
    WHERE pg_catalog.jsonb_typeof(p_media_metadata) NOT IN ('object','null')
  UNION ALL
  SELECT 'preview',p_media_bucket,
    CASE WHEN pg_catalog.jsonb_typeof(p_media_metadata->'preview'->'path')='string'
      THEN p_media_metadata->'preview'->>'path' END,
    CASE WHEN pg_catalog.jsonb_typeof(p_media_metadata->'preview')<>'object'
      OR pg_catalog.jsonb_typeof(p_media_metadata->'preview'->'path') IS DISTINCT FROM 'string'
      THEN 'malformed_metadata' END
  FROM (SELECT 1 WHERE pg_catalog.jsonb_typeof(p_media_metadata)='object'
    AND p_media_metadata ? 'preview' AND p_media_metadata->'preview'<>'null'::jsonb) present
), checked AS (
  SELECT o.*,CASE WHEN o.problem IS NOT NULL THEN o.problem
    WHEN o.bucket_id IS NULL OR o.bucket_id='' THEN 'missing_bucket'
    WHEN pg_catalog.octet_length(o.bucket_id) NOT BETWEEN 1 AND 128
      OR o.object_path IS NULL OR pg_catalog.octet_length(o.object_path) NOT BETWEEN 1 AND 1024 THEN 'invalid_path'
    ELSE NULL END AS invalid_reason FROM observations o
), conflict AS (
  SELECT EXISTS (SELECT 1 FROM checked c CROSS JOIN checked u
    WHERE c.source_kind='canonical' AND u.source_kind='legacy_url'
      AND c.invalid_reason IS NULL AND u.invalid_reason IS NULL
      AND (c.bucket_id,c.object_path) IS DISTINCT FROM (u.bucket_id,u.object_path)) AS present
)
SELECT o.source_kind,o.bucket_id,o.object_path,i.generation_id,
  CASE WHEN o.invalid_reason IS NOT NULL THEN 'unresolved'
    WHEN c.present AND o.source_kind IN ('canonical','legacy_url') THEN 'ambiguous'
    WHEN i.generation_id IS NULL THEN 'unresolved' ELSE 'registered' END,
  CASE WHEN o.invalid_reason IS NOT NULL THEN o.invalid_reason
    WHEN c.present AND o.source_kind IN ('canonical','legacy_url') THEN 'conflicting_pointers'
    WHEN i.generation_id IS NULL THEN 'unregistered_object' ELSE NULL END
FROM checked o CROSS JOIN conflict c
LEFT JOIN private.bot_media_object_identities i ON o.invalid_reason IS NULL
  AND i.bucket_id=o.bucket_id AND i.object_path=o.object_path
$function$;

REVOKE ALL ON FUNCTION private.bot_media_url_pointer(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.bot_message_media_references(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION private.bot_media_url_pointer(text) IS
  'Bounded single-pass legacy URL observation only. An empty result is unsupported, not absence proof.';
COMMENT ON FUNCTION private.bot_message_media_references(text,text,text,jsonb) IS
  'Independent literal canonical, legacy URL and parent-bucket preview observations. No writer fence, physical generation or reclamation authority.';

DO $self_check$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_url_pointer(text)','i',1),
    ('private.bot_message_media_references(text,text,text,jsonb)','s',4)
  ) expected(signature,volatility,args) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=r.signature::regprocedure
      AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND NOT proleakproof
      AND NOT proisstrict AND proretset AND prorettype='record'::regtype
      AND provolatile::text=r.volatility AND proparallel='r' AND pronargs=r.args
      AND proconfig=ARRAY['search_path=""'] AND prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=r.signature::regprocedure AND (a.grantee<>p.proowner OR a.grantor<>p.proowner))
      OR has_function_privilege('anon',r.signature,'EXECUTE')
      OR has_function_privilege('authenticated',r.signature,'EXECUTE')
      OR has_function_privilege('service_role',r.signature,'EXECUTE') THEN
      RAISE EXCEPTION 'bot_message_reference_function_authority_drift';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM private.bot_message_media_references(NULL,NULL,NULL,NULL))
    OR EXISTS (SELECT 1 FROM private.bot_media_url_pointer('https://foreign.invalid/storage/v1/object/public/chat-media/file'))
    OR NOT EXISTS (SELECT 1 FROM private.bot_message_media_references('chat-media','literal%2Fpath',
      'https://foreign.invalid/file','{"preview":{"bucket":"chat-media","path":"preview"}}')
      WHERE source_kind='legacy_url' AND reference_state='unresolved' AND hold_reason='unsupported_url')
    OR NOT EXISTS (SELECT 1 FROM private.bot_message_media_references(NULL,NULL,NULL,
      '{"preview":{"bucket":"chat-media","path":"preview"}}')
      WHERE source_kind='preview' AND bucket_id IS NULL AND reference_state='unresolved' AND hold_reason='missing_bucket')
    OR (SELECT count(*) FROM private.bot_message_media_references('media','canonical',
      'https://core.letscube.ru/storage/v1/object/public/media/legacy',NULL)
      WHERE reference_state='ambiguous' AND hold_reason='conflicting_pointers')<>2 THEN
    RAISE EXCEPTION 'bot_message_reference_semantics_failed';
  END IF;
END
$self_check$;
COMMIT;
