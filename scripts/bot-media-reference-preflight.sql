-- Task 1: advisory reference observations for charged bot receipts, NOT orphan eligibility.
-- Trusted operator stdin only. Never removes objects/messages, releases quota or schedules work.
-- All authors/chats/deleted messages and all variant statuses count. No Storage/HTTP/bytes probe.
-- Preview path observations use messages.media_bucket, as resolveOriginalPreviewUrl does;
-- preview.bucket is ignored. Renderer shape/derivation validation is NOT reproduced here.
-- Purge preview handling instead uses coalesce(messages.media_bucket,'media'). That fallback
-- is NOT applied to invent chat-media references; null/blank parent buckets remain unknown.
-- Purge overlap below observes queue rows only, not live claim function eligibility.
-- Bounded single-pass ASCII URL/path decoding observes an explicit subset, not all URLs.
-- Only the exact HTTPS core authority (optional default port) is recognised. Query/fragment
-- text is discarded, never emitted. Foreign, relative, nested-encoded, non-ASCII or malformed
-- forms remain unresolved for ALL receipts. Zero unresolved rows never authorises deletion.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

DO $preflight_catalog$
DECLARE r record;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read'
    OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION 'bot_media_reference_preflight_transaction_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'bot_media_reference_preflight_bypassrls_required';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_ingests','postgres',true),('public.messages','postgres',true),
    ('public.profiles','postgres',true),('public.chats','postgres',true),('public.bots','postgres',true),
    ('public.media_variants','supabase_admin',true),('public.content_reports','postgres',true),
    ('private.message_media_purge','postgres',false)
  ) expected(relation_name,owner_name,rls) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(r.relation_name)
      AND relkind='r' AND relrowsecurity=r.rls AND pg_get_userbyid(relowner)=r.owner_name)
      OR NOT has_table_privilege(to_regclass(r.relation_name),'SELECT') THEN
      RAISE EXCEPTION 'bot_media_reference_preflight_relation_drift';
    END IF;
    -- Read-only AccessShare keeps each checked table definition stable until ROLLBACK.
    EXECUTE format('SELECT 1 FROM %s LIMIT 0',r.relation_name::regclass);
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_ingests','object_path','text'),('private.bot_media_ingests','byte_size','bigint'),
    ('private.bot_media_ingests','state','text'),('private.bot_media_ingests','result','jsonb'),
    ('private.bot_media_ingests','completed_at','timestamp with time zone'),
    ('public.messages','id','uuid'),('public.messages','media_bucket','text'),
    ('public.messages','media_path','text'),('public.messages','media_metadata','jsonb'),
    ('public.messages','media_url','text'),('public.messages','deleted_at','timestamp with time zone'),
    ('public.profiles','avatar_url','text'),('public.chats','avatar_url','text'),('public.bots','avatar_url','text'),
    ('public.media_variants','source_bucket','text'),('public.media_variants','source_path','text'),
    ('public.media_variants','variant_bucket','text'),('public.media_variants','variant_path','text'),
    ('public.media_variants','message_id','uuid'),('public.media_variants','status','text'),
    ('public.content_reports','message_id','uuid'),('public.content_reports','status','text'),
    ('private.message_media_purge','bucket','text'),('private.message_media_purge','path','text'),
    ('private.message_media_purge','status','text'),('private.message_media_purge','message_id','uuid'),
    ('private.message_media_purge','claimed_until','timestamp with time zone')
  ) expected(relation_name,column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=r.relation_name::regclass
      AND attnum>0 AND NOT attisdropped AND attname=r.column_name AND atttypid=r.type_name::regtype) THEN
      RAISE EXCEPTION 'bot_media_reference_preflight_column_drift';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.bot_media_ingests'::regclass
    AND contype='c' AND convalidated AND pg_get_expr(conbin,conrelid)=
      $expression$(state = ANY (ARRAY['reserved'::text, 'complete'::text]))$expression$)
    OR NOT EXISTS (SELECT 1 FROM pg_index ix WHERE ix.indrelid='private.bot_media_ingests'::regclass
      AND ix.indisunique AND ix.indisvalid AND ix.indisready AND ix.indpred IS NULL AND ix.indexprs IS NULL
      AND ix.indnkeyatts=1 AND ix.indkey[0]=(SELECT attnum FROM pg_attribute
        WHERE attrelid=ix.indrelid AND attname='object_path' AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'bot_media_reference_preflight_receipt_schema_drift';
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM private.bot_media_ingests LIMIT 20001) bounded)>20000 THEN
    RAISE EXCEPTION 'bot_media_reference_preflight_ledger_limit_exceeded';
  END IF;
  IF EXISTS (SELECT 1 FROM private.bot_media_ingests WHERE state IS NULL OR state NOT IN ('reserved','complete')
    OR byte_size IS NULL OR byte_size NOT BETWEEN 1 AND 6291456) THEN
    RAISE EXCEPTION 'bot_media_reference_preflight_receipt_data_drift';
  END IF;
END
$preflight_catalog$;

WITH receipts AS MATERIALIZED (
  SELECT object_path,byte_size,state,completed_at,
    CASE WHEN jsonb_typeof(result->'message_id')='string'
      AND result->>'message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (result->>'message_id')::uuid END AS receipt_message_id
  FROM private.bot_media_ingests
), message_rows AS MATERIALIZED (
  SELECT m.id,m.media_bucket,m.media_path,m.media_metadata,m.media_url FROM public.messages m
), preview_rows AS MATERIALIZED (
  SELECT id,media_bucket,media_metadata->'preview'->>'path' AS preview_path
  FROM message_rows WHERE jsonb_typeof(media_metadata->'preview')='object'
    AND jsonb_typeof(media_metadata->'preview'->'path')='string'
), url_rows AS MATERIALIZED (
  SELECT 'legacy_message_urls'::text AS kind,id AS message_id,media_url AS url FROM message_rows WHERE media_url<>''
  UNION ALL SELECT 'profile_avatar_urls',NULL::uuid,avatar_url FROM public.profiles WHERE avatar_url<>''
  UNION ALL SELECT 'chat_avatar_urls',NULL::uuid,avatar_url FROM public.chats WHERE avatar_url<>''
  UNION ALL SELECT 'bot_avatar_urls',NULL::uuid,avatar_url FROM public.bots WHERE avatar_url<>''
), url_paths AS MATERIALIZED (
  SELECT u.*,(regexp_match(CASE WHEN octet_length(u.url)<=8192 THEN u.url END,
    '^https://core[.]letscube[.]ru(?::443)?(/[^?#]*)(?:[?#].*)?$','i'))[1] AS url_path
  FROM url_rows u
), url_parts AS MATERIALIZED (
  SELECT u.*,regexp_match(u.url_path,
    '^/storage/v1/(?:object/(?:public|sign|authenticated)|render/image/(?:public|sign|authenticated))/([^/]+)/(.+)$') AS parts
  FROM url_paths u
), pointer_inputs AS MATERIALIZED (
  SELECT DISTINCT parts[1] AS raw_bucket,parts[2] AS raw_path FROM url_parts WHERE parts IS NOT NULL
  UNION SELECT bucket,path FROM private.message_media_purge WHERE bucket='chat-media'
), pointer_parts AS MATERIALIZED (
  SELECT p.raw_bucket,p.raw_path,v.part,v.value FROM pointer_inputs p
    CROSS JOIN LATERAL (VALUES ('bucket',p.raw_bucket),('path',p.raw_path)) v(part,value)
), decoded_parts AS MATERIALIZED (
  SELECT p.raw_bucket,p.raw_path,p.part,d.value FROM pointer_parts p
  CROSS JOIN LATERAL (
    -- Reject malformed/non-ASCII escapes before decode(). chr(0) is never evaluated.
    SELECT CASE WHEN bool_and(code BETWEEN 33 AND 126) THEN
      string_agg(CASE WHEN code BETWEEN 33 AND 126 THEN chr(code) END,'' ORDER BY ordinal) END AS value
    FROM (
      SELECT t.ordinal,CASE WHEN left(t.token[1],1)='%' THEN
        get_byte(decode(substr(t.token[1],2),'hex'),0) ELSE ascii(t.token[1]) END AS code
      FROM regexp_matches(CASE WHEN octet_length(p.value) BETWEEN 1 AND 3072
        AND p.value COLLATE "C" !~ '[^!-~]' AND p.value !~ '%(?![0-7][0-9A-Fa-f])'
        THEN p.value ELSE '' END,'(%[0-7][0-9A-Fa-f]|[^%])','g')
        WITH ORDINALITY AS t(token,ordinal)
    ) tokens
  ) d
), decoded_pointers AS MATERIALIZED (
  SELECT raw_bucket,raw_path,max(value) FILTER (WHERE part='bucket') AS bucket,
    max(value) FILTER (WHERE part='path') AS path
  FROM decoded_parts GROUP BY raw_bucket,raw_path
), pointer_observations AS MATERIALIZED (
  SELECT p.*,coalesce(p.bucket COLLATE "C" ~ '^[A-Za-z0-9_-]{1,128}$'
    AND octet_length(p.path) BETWEEN 1 AND 1024
    AND p.path !~ '[%?#\\[:space:]]' AND p.path !~ '(^/|/$|//|(^|/)[.][.]?(/|$))',false) AS resolved
  FROM decoded_pointers p
), url_observations AS MATERIALIZED (
  SELECT u.*,p.bucket,p.path,coalesce(p.resolved,false) AS resolved,
    CASE WHEN NOT coalesce(p.resolved,false) THEN 'unresolved'
      WHEN p.bucket<>'chat-media' THEN 'known_other_bucket'
      WHEN u.parts[1] LIKE '%\%%' ESCAPE '\' OR u.parts[2] LIKE '%\%%' ESCAPE '\' THEN 'encoded_chat_media'
      ELSE 'literal_chat_media' END AS url_class
  FROM url_parts u LEFT JOIN pointer_observations p ON p.raw_bucket=u.parts[1] AND p.raw_path=u.parts[2]
), hits AS MATERIALIZED (
  SELECT r.object_path,m.id AS message_id,'canonical_messages'::text AS kind
    FROM receipts r JOIN message_rows m ON m.media_bucket='chat-media' AND m.media_path=r.object_path
  UNION ALL
  SELECT r.object_path,p.id,CASE WHEN p.media_bucket='chat-media' THEN 'preview_paths_in_message_bucket'
      WHEN p.media_bucket IS NULL OR p.media_bucket='' THEN 'preview_bucket_unknown' ELSE 'preview_bucket_mismatch' END
    FROM receipts r JOIN preview_rows p ON p.preview_path=r.object_path
  UNION ALL SELECT r.object_path,v.message_id,'variant_sources'
    FROM receipts r JOIN public.media_variants v ON v.source_bucket='chat-media' AND v.source_path=r.object_path
  UNION ALL SELECT r.object_path,v.message_id,'variant_targets'
    FROM receipts r JOIN public.media_variants v ON v.variant_bucket='chat-media' AND v.variant_path=r.object_path
  UNION ALL SELECT r.object_path,u.message_id,u.kind FROM receipts r
    JOIN url_observations u ON u.resolved AND u.bucket='chat-media' AND u.path=r.object_path
), kinds(kind) AS (
  VALUES ('canonical_messages'),('preview_paths_in_message_bucket'),('preview_bucket_unknown'),
    ('preview_bucket_mismatch'),('variant_sources'),('variant_targets'),('legacy_message_urls'),
    ('profile_avatar_urls'),('chat_avatar_urls'),('bot_avatar_urls')
), surface_counts AS (
  SELECT k.kind,count(h.object_path) AS rows,count(DISTINCT h.object_path) AS receipt_entries
    FROM kinds k LEFT JOIN hits h ON h.kind=k.kind GROUP BY k.kind
), surface_bytes AS (
  SELECT d.kind,sum(r.byte_size) AS bytes FROM (SELECT DISTINCT kind,object_path FROM hits) d
    JOIN receipts r ON r.object_path=d.object_path GROUP BY d.kind
), observed AS MATERIALIZED (
  SELECT DISTINCT object_path FROM hits WHERE kind NOT IN ('preview_bucket_unknown','preview_bucket_mismatch')
), associated_messages AS MATERIALIZED (
  SELECT DISTINCT object_path,message_id FROM hits WHERE message_id IS NOT NULL
    AND kind NOT IN ('preview_bucket_unknown','preview_bucket_mismatch')
  UNION SELECT object_path,receipt_message_id FROM receipts WHERE receipt_message_id IS NOT NULL
), associated_reports AS MATERIALIZED (
  SELECT a.object_path,c.status FROM associated_messages a JOIN public.content_reports c ON c.message_id=a.message_id
), purge_overlap AS MATERIALIZED (
  SELECT r.object_path,p.status,p.claimed_until FROM receipts r JOIN private.message_media_purge p
    ON p.bucket='chat-media'
    JOIN pointer_observations o ON o.raw_bucket=p.bucket AND o.raw_path=p.path AND o.resolved
      AND o.bucket='chat-media' AND o.path=r.object_path
), unresolved_purge AS MATERIALIZED (
  SELECT p.path FROM private.message_media_purge p LEFT JOIN pointer_observations o
    ON o.raw_bucket=p.bucket AND o.raw_path=p.path
  WHERE p.bucket='chat-media' AND NOT coalesce(o.resolved,false)
)
SELECT jsonb_build_object(
  'report','bot_media_reference_preflight_v2','as_of',transaction_timestamp(),'scope','charged_receipts_only',
  'assessment','advisory_reference_observations_not_orphan_eligibility',
  'limits',jsonb_build_object('receipt_entries_max',20000,'statement_timeout_ms',15000,'lock_timeout_ms',2000),
  'coverage',jsonb_build_object('all_authors_chats_and_deleted_rows_count',true,
    'all_variant_statuses_count',true,'preview_ui_bucket_is_parent_message_bucket',true,
    'preview_purge_null_bucket_fallback_is_media',true,'purge_claim_eligibility_proven',false,
    'preview_renderer_validity_proven',false,'exhaustive_url_decoder',false,
    'single_pass_ascii_subset',true,'url_bytes_max',8192,'decoded_path_bytes_max',1024,
    'encoded_or_unrecognized_urls_unresolved_for_all_receipts',true,
    'http_or_actual_bytes_checked',false,'deletion_authorized',false,'quota_release_authorized',false,
    'nonempty_url_rows',(SELECT count(*) FROM url_observations),
    'known_literal_chat_media_endpoint_rows',(SELECT count(*) FROM url_observations WHERE url_class='literal_chat_media'),
    'encoded_or_unrecognized_url_rows',(SELECT count(*) FROM url_observations WHERE url_class<>'literal_chat_media'),
    'url_classes',jsonb_build_object(
      'literal_chat_media',(SELECT count(*) FROM url_observations WHERE url_class='literal_chat_media'),
      'encoded_chat_media',(SELECT count(*) FROM url_observations WHERE url_class='encoded_chat_media'),
      'known_other_bucket',(SELECT count(*) FROM url_observations WHERE url_class='known_other_bucket'),
      'unresolved',(SELECT count(*) FROM url_observations WHERE url_class='unresolved'))),
  'charged',jsonb_build_object('entries',(SELECT count(*) FROM receipts),'bytes',(SELECT coalesce(sum(byte_size),0) FROM receipts),
    'reserved_entries',(SELECT count(*) FROM receipts WHERE state='reserved'),
    'complete_entries',(SELECT count(*) FROM receipts WHERE state='complete'),
    'complete_result_message_id_present',(SELECT count(*) FROM receipts WHERE state='complete' AND receipt_message_id IS NOT NULL),
    'complete_completed_at_present',(SELECT count(*) FROM receipts WHERE state='complete' AND completed_at IS NOT NULL)),
  'reference_surfaces',(SELECT jsonb_object_agg(c.kind,jsonb_build_object('rows',c.rows,
    'receipt_entries',c.receipt_entries,'charged_bytes',coalesce(b.bytes,0)) ORDER BY c.kind)
    FROM surface_counts c LEFT JOIN surface_bytes b ON b.kind=c.kind),
  'receipts_with_observed_reference',(SELECT count(*) FROM observed),
  'receipts_with_observed_noncanonical_but_no_canonical_message',(SELECT count(*) FROM observed o
    WHERE NOT EXISTS (SELECT 1 FROM hits h WHERE h.kind='canonical_messages' AND h.object_path=o.object_path)),
  'content_report_holds',jsonb_build_object('associated_rows',(SELECT count(*) FROM associated_reports),
    'open_rows',(SELECT count(*) FROM associated_reports WHERE status IN ('new','reviewing')),
    'open_receipt_entries',(SELECT count(DISTINCT object_path) FROM associated_reports WHERE status IN ('new','reviewing'))),
  'purge_overlap',jsonb_build_object('rows',count(*),'receipt_entries',count(DISTINCT object_path),
    'unresolved_chat_media_path_rows',(SELECT count(*) FROM unresolved_purge),
    'pending_rows',count(*) FILTER (WHERE status='pending'),'done_rows',count(*) FILTER (WHERE status='done'),
    'kept_rows',count(*) FILTER (WHERE status='kept'),'failed_rows',count(*) FILTER (WHERE status='failed'),
    'unknown_status_rows',count(*) FILTER (WHERE status IS NULL OR status NOT IN ('pending','done','kept','failed')),
    'pending_unclaimed_rows',count(*) FILTER (WHERE status='pending' AND claimed_until IS NULL),
    'pending_claim_strictly_expired_rows',count(*) FILTER (WHERE status='pending' AND claimed_until<transaction_timestamp()),
    'pending_claim_active_or_boundary_rows',count(*) FILTER (WHERE status='pending' AND claimed_until>=transaction_timestamp()),
    'receipt_entries_with_observed_reference',count(DISTINCT object_path) FILTER (WHERE object_path IN (SELECT object_path FROM observed)))
) AS bot_media_reference_preflight_v2 FROM purge_overlap;
ROLLBACK;
