-- Operator review only, after the coordinator's deployment gate. No cleanup or quota refund.
-- Run as a trusted DB operator with SELECT and BYPASSRLS (or superuser), not through a bot RPC.
-- One aggregate snapshot of charged receipts, not an inventory of every Storage object.
-- Candidates use canonical message columns and Storage DB metadata only. Deleted messages and
-- references in ANY bot/chat exclude candidates. Legacy URL fields and HTTP/object bytes are
-- NOT examined; these counts never establish actual orphan status or safe deletion.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

DO $catalog_precheck$
DECLARE r record;
BEGIN
  IF current_setting('transaction_isolation') <> 'repeatable read'
    OR current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'bot_media_ingest_audit_transaction_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'bot_media_ingest_audit_bypassrls_required';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_ingests','postgres'),('public.messages','postgres'),
    ('storage.objects','supabase_storage_admin')
  ) expected(relation_name,owner_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(r.relation_name)
        AND relkind='r' AND relrowsecurity AND pg_get_userbyid(relowner)=r.owner_name)
      OR NOT has_table_privilege(to_regclass(r.relation_name),'SELECT') THEN
      RAISE EXCEPTION 'bot_media_ingest_audit_relation_drift';
    END IF;
  END LOOP;
  -- Read-only AccessShare locks keep the used table definitions stable through ROLLBACK.
  PERFORM 1 FROM private.bot_media_ingests LIMIT 0;
  PERFORM 1 FROM public.messages LIMIT 0;
  PERFORM 1 FROM storage.objects LIMIT 0;
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_ingests','bot_id','uuid'),
    ('private.bot_media_ingests','idempotency_key','text'),
    ('private.bot_media_ingests','chat_id','uuid'),
    ('private.bot_media_ingests','method','text'),
    ('private.bot_media_ingests','request_fingerprint','text'),
    ('private.bot_media_ingests','object_path','text'),
    ('private.bot_media_ingests','content_type','text'),
    ('private.bot_media_ingests','byte_size','bigint'),
    ('private.bot_media_ingests','state','text'),
    ('private.bot_media_ingests','created_at','timestamp with time zone'),
    ('private.bot_media_ingests','lease_expires_at','timestamp with time zone'),
    ('private.bot_media_ingests','completed_at','timestamp with time zone'),
    ('private.bot_media_ingests','result','jsonb'),
    ('public.messages','id','uuid'),('public.messages','bot_id','uuid'),
    ('public.messages','chat_id','uuid'),('public.messages','type','text'),
    ('public.messages','media_bucket','text'),('public.messages','media_path','text'),
    ('public.messages','deleted_at','timestamp with time zone'),
    ('storage.objects','bucket_id','text'),('storage.objects','name','text'),
    ('storage.objects','metadata','jsonb')
  ) expected(relation_name,column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=r.relation_name::regclass
      AND attnum>0 AND NOT attisdropped AND attname=r.column_name AND atttypid=r.type_name::regtype) THEN
      RAISE EXCEPTION 'bot_media_ingest_audit_column_drift';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.bot_media_ingests'::regclass
    AND contype='c' AND convalidated AND pg_get_expr(conbin,conrelid)=
      $expression$(state = ANY (ARRAY['reserved'::text, 'complete'::text]))$expression$) THEN
    RAISE EXCEPTION 'bot_media_ingest_audit_state_contract_drift';
  END IF;
  -- These unique btree keys prevent multiplication and support receipt-anchored lookups.
  FOR r IN SELECT * FROM (VALUES
    ('private.bot_media_ingests',ARRAY['bot_id','idempotency_key']::text[]),
    ('private.bot_media_ingests',ARRAY['object_path']::text[]),
    ('public.messages',ARRAY['id']::text[]),('storage.objects',ARRAY['bucket_id','name']::text[])
  ) expected(relation_name,columns) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index ix JOIN pg_class ic ON ic.oid=ix.indexrelid
      JOIN pg_am am ON am.oid=ic.relam WHERE ix.indrelid=r.relation_name::regclass
        AND am.amname='btree' AND ix.indisunique AND ix.indisvalid AND ix.indisready
        AND ix.indpred IS NULL AND ix.indexprs IS NULL AND ix.indnkeyatts=cardinality(r.columns)
        AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
          FROM unnest(ix.indkey) WITH ORDINALITY k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=k.attnum
          WHERE k.ordinality<=ix.indnkeyatts)=r.columns) THEN
      RAISE EXCEPTION 'bot_media_ingest_audit_index_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT 1 FROM private.bot_media_ingests LIMIT 20001) bounded)>20000 THEN
    RAISE EXCEPTION 'bot_media_ingest_audit_ledger_limit_exceeded';
  END IF;
  IF EXISTS (SELECT 1 FROM private.bot_media_ingests WHERE state NOT IN ('reserved','complete')
    OR state IS NULL OR byte_size IS NULL OR byte_size NOT BETWEEN 1 AND 6291456
    OR method NOT IN ('sendPhoto','sendVideo','sendDocument','sendVoice')) THEN
    RAISE EXCEPTION 'bot_media_ingest_audit_receipt_contract_drift';
  END IF;
END
$catalog_precheck$;

WITH receipt_rows AS MATERIALIZED (
  SELECT i.bot_id,i.chat_id,i.object_path,i.content_type,i.byte_size,i.state,i.created_at,
    i.lease_expires_at,i.completed_at,i.result,
    CASE i.method WHEN 'sendPhoto' THEN 'image' WHEN 'sendVideo' THEN 'video'
      WHEN 'sendDocument' THEN 'file' WHEN 'sendVoice' THEN 'audio' END AS expected_kind,
    coalesce(i.object_path=i.chat_id::text||'/bots/'||i.bot_id::text||'/'||i.request_fingerprint||'.'||
      CASE i.content_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
        WHEN 'image/webp' THEN 'webp' WHEN 'image/gif' THEN 'gif' WHEN 'application/pdf' THEN 'pdf'
        WHEN 'video/mp4' THEN 'mp4' WHEN 'video/webm' THEN 'webm' WHEN 'audio/webm' THEN 'webm'
        WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/mpeg' THEN 'mp3' END,false) AS canonical_path,
    CASE WHEN jsonb_typeof(i.result)='object' AND jsonb_typeof(i.result->'message_id')='string'
      AND i.result->>'message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (i.result->>'message_id')::uuid END AS receipt_message_id
  FROM private.bot_media_ingests i
), canonical_references AS MATERIALIZED (
  -- No bot/chat/deleted filter: any canonical reference conservatively excludes a candidate.
  SELECT i.object_path,count(*) AS reference_count,
    count(*) FILTER (WHERE m.deleted_at IS NOT NULL) AS deleted_reference_count
  FROM receipt_rows i JOIN public.messages m ON m.media_bucket='chat-media' AND m.media_path=i.object_path
  GROUP BY i.object_path
), observations AS MATERIALIZED (
  SELECT i.*,coalesce(ref.reference_count,0) AS reference_count,coalesce(ref.deleted_reference_count,0) AS deleted_reference_count,
    s.present AS storage_present,
    s.present AND (s.metadata IS NULL OR jsonb_typeof(s.metadata)<>'object'
      OR NOT s.metadata ?& ARRAY['mimetype','size']) AS metadata_missing,
    coalesce(jsonb_typeof(s.metadata->'mimetype')='string' AND length(s.metadata->>'mimetype')>0
      AND jsonb_typeof(s.metadata->'size') IN ('number','string')
      AND s.metadata->>'size' ~ '^[0-9]{1,12}$',false) AS metadata_valid,
    CASE WHEN jsonb_typeof(s.metadata->'size') IN ('number','string')
      AND s.metadata->>'size' ~ '^[0-9]{1,12}$' THEN (s.metadata->>'size')::bigint END AS metadata_size,
    s.metadata->>'mimetype' AS metadata_mime,
    coalesce(i.receipt_message_id IS NOT NULL AND i.result->>'chat_id'=i.chat_id::text
      AND i.result->>'bot_id'=i.bot_id::text AND i.result->>'type'=i.expected_kind,false) AS receipt_identity_present,
    m.id IS NOT NULL AS receipt_message_present,
    coalesce(m.chat_id=i.chat_id AND m.bot_id=i.bot_id AND m.type=i.expected_kind
      AND m.media_bucket='chat-media' AND m.media_path=i.object_path,false) AS receipt_message_matches
  FROM receipt_rows i
  LEFT JOIN canonical_references ref ON ref.object_path=i.object_path
  -- Parameterized indexed lookup; no inventory scan of unrelated Storage buckets.
  LEFT JOIN LATERAL (SELECT true AS present,o.metadata FROM storage.objects o
    WHERE o.bucket_id='chat-media' AND o.name=i.object_path OFFSET 0) s ON true
  LEFT JOIN public.messages m ON m.id=i.receipt_message_id
)
SELECT jsonb_build_object(
  'report','bot_media_ingest_candidates_v1',
  'as_of',transaction_timestamp(),
  'scope','charged_receipts_only',
  'evidence',jsonb_build_object('canonical_columns_and_db_metadata_only',true,
    'candidate_counts_are_not_orphan_proof',true,'http_or_object_bytes_checked',false,
    'legacy_url_fields_examined',false,'cleanup_authorized',false,'quota_refund_authorized',false),
  'limits',jsonb_build_object('receipt_entries_max',20000,'statement_timeout_ms',15000,'lock_timeout_ms',2000),
  'charged',jsonb_build_object('entries',count(*),'bytes',coalesce(sum(byte_size),0),
    'rolling_24h_entries',count(*) FILTER (WHERE created_at>transaction_timestamp()-interval '24 hours'),
    'rolling_24h_bytes',coalesce(sum(byte_size) FILTER (WHERE created_at>transaction_timestamp()-interval '24 hours'),0)),
  'states',jsonb_build_object(
    'reserved',jsonb_build_object('entries',count(*) FILTER (WHERE state='reserved'),
      'bytes',coalesce(sum(byte_size) FILTER (WHERE state='reserved'),0)),
    'complete',jsonb_build_object('entries',count(*) FILTER (WHERE state='complete'),
      'bytes',coalesce(sum(byte_size) FILTER (WHERE state='complete'),0))),
  'canonical_columns_and_db_metadata_candidates',jsonb_build_object(
    'noncanonical_receipt_paths',count(*) FILTER (WHERE NOT canonical_path),
    'storage_rows_present',count(*) FILTER (WHERE storage_present),
    'storage_rows_missing',count(*) FILTER (WHERE storage_present IS NOT TRUE),
    'storage_metadata_missing',count(*) FILTER (WHERE metadata_missing),
    'storage_metadata_invalid',count(*) FILTER (WHERE storage_present AND NOT metadata_missing AND NOT metadata_valid),
    'storage_metadata_matches',count(*) FILTER (WHERE storage_present AND metadata_valid AND metadata_size=byte_size AND metadata_mime=content_type),
    'storage_metadata_mismatches',count(*) FILTER (WHERE storage_present AND metadata_valid AND (metadata_size<>byte_size OR metadata_mime<>content_type)),
    'receipts_with_any_canonical_reference',count(*) FILTER (WHERE reference_count>0),
    'canonical_message_reference_rows',coalesce(sum(reference_count),0),
    'deleted_canonical_message_reference_rows',coalesce(sum(deleted_reference_count),0),
    'complete_completion_timestamp_present',count(*) FILTER (WHERE state='complete' AND completed_at IS NOT NULL),
    'complete_result_message_id_present',count(*) FILTER (WHERE state='complete' AND receipt_message_id IS NOT NULL),
    'complete_result_identity_present',count(*) FILTER (WHERE state='complete' AND receipt_identity_present),
    'complete_result_identity_missing_or_invalid',count(*) FILTER (WHERE state='complete' AND NOT receipt_identity_present),
    'complete_receipt_message_present',count(*) FILTER (WHERE state='complete' AND receipt_message_present),
    'complete_receipt_message_missing',count(*) FILTER (WHERE state='complete' AND receipt_message_id IS NOT NULL AND NOT receipt_message_present),
    'complete_receipt_message_matches',count(*) FILTER (WHERE state='complete' AND receipt_identity_present AND receipt_message_matches),
    'expired_reserved_leases',count(*) FILTER (WHERE state='reserved' AND lease_expires_at<=transaction_timestamp()),
    'potential_unreferenced_canonical_entries',count(*) FILTER (WHERE canonical_path AND storage_present AND reference_count=0),
    'expired_reserved_potential_unreferenced_entries',count(*) FILTER (WHERE canonical_path AND storage_present AND reference_count=0 AND state='reserved' AND lease_expires_at<=transaction_timestamp()),
    'live_reserved_potential_unreferenced_entries',count(*) FILTER (WHERE canonical_path AND storage_present AND reference_count=0 AND state='reserved' AND lease_expires_at>transaction_timestamp()),
    'complete_potential_unreferenced_entries',count(*) FILTER (WHERE canonical_path AND storage_present AND reference_count=0 AND state='complete'))
) AS audit FROM observations;
ROLLBACK;
