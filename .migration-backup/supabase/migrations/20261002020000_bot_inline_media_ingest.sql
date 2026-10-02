-- D-258: bounded, durable inline media admission. Candidate only; no production apply.
-- Rollback: 20261002020000_bot_inline_media_ingest.rollback.sql.
-- Coordinator gate: verified fresh prestate backup + isolated full PG17 restore,
-- behavioral/ACL rehearsal + byte-identical migration AND rollback archive before apply.
-- Runtime: reserve(bot, token, chat, method, key, fingerprint, path, mime, size, sha256, lease)
-- -> {duplicate,result,lease_id}; commit(bot, token, key, fingerprint, lease, payload)
-- -> {duplicate,result}. SHA256 of actual Storage bytes is verified by trusted runtime;
-- SQL verifies the immutable receipt and Storage MIME/size, never fetches an external URL.
-- All attempts charge admission once, even failed uploads/commits. No eager object deletion.
-- Failed reserved rows/orphans remain charged; exact retry with a fresh lease recovers after 120s.
-- Operator follow-up: implement bounded reconciliation/cleanup, prove no message references and
-- resolve unknown commit outcomes before removing only receipt-owned objects. Cleanup is NOT done.
-- Ledger intentionally has no cascading bot/token FKs: deleting a bot must not reset global quota.
-- Rollback retains the private ledger and object/message rows. Pause byte ingestion before rollback.
-- This first-install candidate deliberately refuses reapply over the retained rollback ledger.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prestate$
DECLARE r record; p pg_proc;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-inline-media-ingest:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_ingest_migration_busy';
  END IF;
  IF to_regclass('private.bot_media_ingests') IS NOT NULL
    OR to_regprocedure('public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)') IS NOT NULL
    OR to_regprocedure('public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'bot_media_ingest_prestate_exists';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)','03db4ebafc6ff37b3d8843a85b7fed956fc20d54de35dcca965fb6e0bc1b1f29'),
    ('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)','e38e2e51d94dcd017dc66fd4e6106907e1b51ac8e00fa1699b15f0aedcb1f928'),
    ('public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)','649e6d70ab393a1fd002b492e39b597aeaaa4a5a4bf23b5fbe8d410dbf38fb44')
  ) expected(signature,body_hash) LOOP
    SELECT * INTO STRICT p FROM pg_proc WHERE oid=r.signature::regprocedure;
    IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> r.body_hash
      OR pg_get_userbyid(p.proowner) <> 'postgres' OR NOT p.prosecdef OR p.provolatile <> 'v'
      OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
      OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN
      RAISE EXCEPTION 'bot_media_ingest_prestate_drift:%',r.signature;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass
    AND relrowsecurity AND pg_get_userbyid(relowner)='supabase_storage_admin')
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname IN ('bot media ingest insert guard','bot media ingest update guard','bot media ingest delete guard')) THEN
    RAISE EXCEPTION 'bot_media_ingest_storage_prestate_drift';
  END IF;
END
$prestate$;

SET LOCAL ROLE postgres;
DO $authorize_patch$
DECLARE
  ddl text := pg_get_functiondef('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)'::regprocedure);
  anchor text := $anchor$      and stored_object.name = p_object_path
  ) then
    raise exception 'bot_upload_object_missing'$anchor$;
  replacement text := $replacement$      and stored_object.name = p_object_path
      and stored_object.metadata->>'mimetype' = p_content_type
      and case
        when pg_catalog.jsonb_typeof(stored_object.metadata->'size') in ('number','string')
          and stored_object.metadata->>'size' ~ '^[0-9]{1,12}$'
        then (stored_object.metadata->>'size')::bigint = p_byte_size
        else false
      end
  ) then
    raise exception 'bot_upload_object_attributes_invalid'$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_authorize_anchor_drift';
  END IF;
  EXECUTE replace(ddl,anchor,replacement);
END
$authorize_patch$;

DO $send_patch$
DECLARE
  ddl text := pg_get_functiondef('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'::regprocedure);
  anchor text := $anchor$'mime_type','file_name','size','width','height','duration','kind'$anchor$;
  replacement text := $replacement$'mime_type','file_name','size','size_bytes','width','height','duration','duration_ms','kind'$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_send_anchor_drift';
  END IF;
  EXECUTE replace(ddl,anchor,replacement);
END
$send_patch$;

DO $command_patch$
DECLARE
  ddl text := pg_get_functiondef('public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)'::regprocedure);
  lock_anchor text := $lock_anchor$  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,$lock_anchor$;
  lock_replacement text := $lock_replacement$  -- The legacy path shares the operation lock, but never takes the global quota lock.
  -- Only the checked commit transaction may send an incomplete reservation, even with equal fingerprint.
  if exists (
    select 1 from private.bot_media_ingests i
    where i.bot_id=p_bot_id and i.idempotency_key=p_idempotency_key
      and (i.request_fingerprint<>p_request_fingerprint or i.method<>p_method or i.chat_id<>p_chat_id
        or (i.state='reserved' and i.commit_xid is distinct from pg_catalog.pg_current_xact_id()))
  ) then
    raise exception 'bot_ingest_conflict' using errcode='23505';
  end if;
  select pg_catalog.jsonb_build_object('result',i.result,'duplicate',true) into v_existing
    from private.bot_media_ingests i
    where i.bot_id=p_bot_id and i.idempotency_key=p_idempotency_key and i.state='complete';
  if found then return v_existing; end if;
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,$lock_replacement$;
  anchor text := $anchor$         where metadata_key not in ('mime_type','size','kind')
       )
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type')$anchor$;
  replacement text := $replacement$         where metadata_key not in ('mime_type','size','size_bytes','kind','duration_ms','width','height','file_name')
       )
       or (p_payload->'media_metadata' ? 'size_bytes' and
         p_payload->'media_metadata'->'size_bytes' is distinct from p_payload->'media_metadata'->'size')
       or exists (
         select 1 from pg_catalog.jsonb_each(p_payload->'media_metadata') m
         where m.key in ('duration_ms','width','height') and not (
           case when pg_catalog.jsonb_typeof(m.value) = 'number' and m.value::text ~ '^[0-9]{1,10}$'
             then m.value::text::bigint between (case when m.key='duration_ms' then 0 else 1 end) and 2147483647
             else false end
         )
       )
       or (p_payload->'media_metadata' ? 'file_name' and (
         pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'file_name') <> 'string'
         or pg_catalog.length(p_payload->'media_metadata'->>'file_name') not between 1 and 255
         or p_payload->'media_metadata'->>'file_name' ~ '[[:cntrl:]]'
       ))
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type')$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 OR array_length(string_to_array(ddl,lock_anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_command_anchor_drift';
  END IF;
  EXECUTE replace(replace(ddl,anchor,replacement),lock_anchor,lock_replacement);
END
$command_patch$;

CREATE TABLE private.bot_media_ingests (
  bot_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  owner_token_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('sendPhoto','sendVideo','sendDocument','sendVoice')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  object_path text NOT NULL UNIQUE,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 6291456),
  lease_id uuid NOT NULL UNIQUE,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','complete')),
  commit_xid xid8,
  result jsonb,
  completed_at timestamptz,
  PRIMARY KEY (bot_id,idempotency_key),
  CHECK ((state='reserved' AND result IS NULL AND completed_at IS NULL)
      OR (state='complete' AND result IS NOT NULL AND completed_at IS NOT NULL AND commit_xid IS NULL))
);
CREATE INDEX bot_media_ingests_bot_created_idx ON private.bot_media_ingests(bot_id,created_at);
CREATE INDEX bot_media_ingests_created_idx ON private.bot_media_ingests(created_at);
ALTER TABLE private.bot_media_ingests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.bot_media_ingests FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.bot_media_ingests IS
  'Durable charged admissions, including failures. No automatic cleanup; never delete receipts to reset quota.';

CREATE FUNCTION public.bot_media_ingest_reserve_internal(
  p_bot_id uuid, p_token_id uuid, p_chat_id uuid, p_method text, p_idempotency_key text,
  p_request_fingerprint text, p_object_path text, p_content_type text, p_byte_size bigint,
  p_content_sha256 text, p_lease_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_row private.bot_media_ingests%rowtype;
  v_existing jsonb;
  v_extension text;
  v_now timestamptz;
  v_bot_day bigint; v_bot_total bigint; v_bot_count bigint;
  v_global_day bigint; v_global_total bigint; v_global_count bigint;
BEGIN
  v_extension := CASE
    WHEN p_method='sendPhoto' THEN CASE p_content_type
      WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' WHEN 'image/gif' THEN 'gif' END
    WHEN p_method='sendVideo' THEN CASE p_content_type WHEN 'video/mp4' THEN 'mp4' WHEN 'video/webm' THEN 'webm' END
    WHEN p_method='sendDocument' AND p_content_type='application/pdf' THEN 'pdf'
    WHEN p_method='sendVoice' THEN CASE p_content_type WHEN 'audio/webm' THEN 'webm' WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/mpeg' THEN 'mp3' END
  END;
  IF p_bot_id IS NULL OR p_token_id IS NULL OR p_chat_id IS NULL OR v_extension IS NULL
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_content_sha256 IS NULL OR p_content_sha256 !~ '^[0-9a-f]{64}$'
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 6291456
    OR p_lease_id IS NULL OR p_object_path IS NULL
    OR p_object_path <> p_chat_id::text || '/bots/' || p_bot_id::text || '/' || p_request_fingerprint || '.' || v_extension THEN
    RAISE EXCEPTION 'bot_ingest_input_invalid' USING ERRCODE='22023';
  END IF;

  -- Always global quota, then the SAME operation lock as the existing command.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('letscube:bot-media-ingest:quota',0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key,0));
  PERFORM 1 FROM private.bot_tokens t JOIN public.bots b ON b.id=t.bot_id
    WHERE t.id=p_token_id AND t.bot_id=p_bot_id AND t.revoked_at IS NULL AND b.state='active'
    FOR SHARE OF t,b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_media_ingest_token_revoked' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.chat_bot_members m WHERE m.bot_id=p_bot_id AND m.chat_id=p_chat_id AND m.removed_at IS NULL
    FOR SHARE OF m;
  IF NOT FOUND OR coalesce((public.bot_membership_authorize_internal(p_bot_id,p_chat_id,'send_message')->>'allowed')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'bot_chat_forbidden' USING ERRCODE='42501';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  SELECT * INTO v_row FROM private.bot_media_ingests WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.chat_id <> p_chat_id OR v_row.method <> p_method OR v_row.request_fingerprint <> p_request_fingerprint
      OR v_row.object_path <> p_object_path OR v_row.content_sha256 <> p_content_sha256
      OR v_row.content_type <> p_content_type OR v_row.byte_size <> p_byte_size THEN
      RAISE EXCEPTION 'bot_ingest_conflict' USING ERRCODE='23505';
    END IF;
    IF v_row.state='complete' THEN
      RETURN pg_catalog.jsonb_build_object('duplicate',true,'result',v_row.result,'lease_id',NULL);
    END IF;
    IF v_row.lease_expires_at > v_now THEN
      RAISE EXCEPTION 'bot_media_ingest_busy' USING ERRCODE='55000',
        DETAIL=least(120,greatest(1,ceil(extract(epoch FROM v_row.lease_expires_at-v_now))::integer))::text;
    END IF;
    IF v_row.lease_id=p_lease_id THEN
      RAISE EXCEPTION 'bot_ingest_lease_invalid' USING ERRCODE='22023';
    END IF;
  END IF;
  v_existing := private.bot_operation_idempotency_lookup(p_bot_id,p_idempotency_key,p_method,p_request_fingerprint);
  IF coalesce((v_existing->>'found')::boolean,false) THEN
    RETURN pg_catalog.jsonb_build_object('duplicate',true,'result',v_existing->'result','lease_id',NULL);
  END IF;
  IF v_row.bot_id IS NOT NULL THEN
    UPDATE private.bot_media_ingests SET owner_token_id=p_token_id,lease_id=p_lease_id,lease_expires_at=v_now+interval '120 seconds'
      WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key;
    RETURN pg_catalog.jsonb_build_object('duplicate',false,'result',NULL,'lease_id',p_lease_id);
  END IF;

  -- The immutable initial charge time, never state/lease time, defines rolling usage.
  SELECT coalesce(sum(byte_size) FILTER (WHERE created_at > v_now-interval '24 hours'),0),
    coalesce(sum(byte_size),0),count(*) INTO v_bot_day,v_bot_total,v_bot_count
    FROM private.bot_media_ingests WHERE bot_id=p_bot_id;
  SELECT coalesce(sum(byte_size) FILTER (WHERE created_at > v_now-interval '24 hours'),0),
    coalesce(sum(byte_size),0),count(*) INTO v_global_day,v_global_total,v_global_count FROM private.bot_media_ingests;
  IF v_bot_day+p_byte_size > 62914560 OR v_bot_total+p_byte_size > 268435456 OR v_bot_count+1 > 1000
    OR v_global_day+p_byte_size > 629145600 OR v_global_total+p_byte_size > 2147483648 OR v_global_count+1 > 20000 THEN
    RAISE EXCEPTION 'bot_media_ingest_quota_exceeded' USING ERRCODE='54000';
  END IF;
  INSERT INTO private.bot_media_ingests(bot_id,idempotency_key,owner_token_id,chat_id,method,request_fingerprint,
    object_path,content_sha256,content_type,byte_size,lease_id,lease_expires_at,created_at)
    VALUES(p_bot_id,p_idempotency_key,p_token_id,p_chat_id,p_method,p_request_fingerprint,p_object_path,p_content_sha256,
      p_content_type,p_byte_size,p_lease_id,v_now+interval '120 seconds',v_now);
  RETURN pg_catalog.jsonb_build_object('duplicate',false,'result',NULL,'lease_id',p_lease_id);
END
$function$;

CREATE FUNCTION public.bot_media_ingest_commit_internal(
  p_bot_id uuid, p_token_id uuid, p_idempotency_key text, p_request_fingerprint text,
  p_lease_id uuid, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_row private.bot_media_ingests%rowtype;
  v_kind text;
  v_result jsonb;
BEGIN
  IF p_bot_id IS NULL OR p_token_id IS NULL OR p_lease_id IS NULL
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
    OR pg_catalog.octet_length(p_payload::text)>65536 THEN
    RAISE EXCEPTION 'bot_ingest_input_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('letscube:bot-media-ingest:quota',0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key,0));
  PERFORM 1 FROM private.bot_tokens t JOIN public.bots b ON b.id=t.bot_id
    WHERE t.id=p_token_id AND t.bot_id=p_bot_id AND t.revoked_at IS NULL AND b.state='active'
    FOR SHARE OF t,b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_media_ingest_token_revoked' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM private.bot_media_ingests WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR v_row.request_fingerprint <> p_request_fingerprint THEN
    RAISE EXCEPTION 'bot_ingest_conflict' USING ERRCODE='23505';
  END IF;
  IF v_row.owner_token_id <> p_token_id OR v_row.lease_id <> p_lease_id THEN
    RAISE EXCEPTION 'bot_ingest_lease_invalid' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.chat_bot_members m WHERE m.bot_id=p_bot_id AND m.chat_id=v_row.chat_id AND m.removed_at IS NULL
    FOR SHARE OF m;
  IF NOT FOUND OR coalesce((public.bot_membership_authorize_internal(p_bot_id,v_row.chat_id,'send_message')->>'allowed')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'bot_chat_forbidden' USING ERRCODE='42501';
  END IF;
  -- A committed receipt is authoritative even after the 24h legacy idempotency prune.
  IF v_row.state='complete' THEN
    RETURN pg_catalog.jsonb_build_object('duplicate',true,'result',v_row.result);
  END IF;
  IF v_row.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'bot_media_ingest_lease_expired' USING ERRCODE='55000', DETAIL='1';
  END IF;
  v_kind := CASE v_row.method WHEN 'sendPhoto' THEN 'image' WHEN 'sendVideo' THEN 'video'
    WHEN 'sendDocument' THEN 'file' WHEN 'sendVoice' THEN 'audio' END;
  IF p_payload->>'media_bucket' IS DISTINCT FROM 'chat-media'
    OR p_payload->>'media_path' IS DISTINCT FROM v_row.object_path
    OR pg_catalog.jsonb_typeof(p_payload->'media_metadata') IS DISTINCT FROM 'object'
    OR p_payload->'media_metadata'->>'mime_type' IS DISTINCT FROM v_row.content_type
    OR p_payload->'media_metadata'->'size' IS DISTINCT FROM pg_catalog.to_jsonb(v_row.byte_size)
    OR p_payload->'media_metadata'->'size_bytes' IS DISTINCT FROM pg_catalog.to_jsonb(v_row.byte_size)
    OR p_payload->'media_metadata'->>'kind' IS DISTINCT FROM v_kind THEN
    RAISE EXCEPTION 'bot_ingest_payload_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM storage.objects o WHERE o.bucket_id='chat-media' AND o.name=v_row.object_path
    AND o.metadata->>'mimetype'=v_row.content_type
    AND CASE WHEN pg_catalog.jsonb_typeof(o.metadata->'size') IN ('number','string')
      AND o.metadata->>'size' ~ '^[0-9]{1,12}$' THEN (o.metadata->>'size')::bigint=v_row.byte_size ELSE false END
    FOR SHARE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bot_ingest_object_attributes_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM public.bot_upload_authorize_internal(p_bot_id,v_row.chat_id,'chat-media',v_row.object_path,v_row.content_type,v_row.byte_size,120);
  -- Storage/grant locks can wait; use server wall time again after acquiring them.
  IF v_row.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'bot_media_ingest_lease_expired' USING ERRCODE='55000', DETAIL='1';
  END IF;
  -- Not a caller-settable GUC: the private row marks only this validated transaction.
  UPDATE private.bot_media_ingests SET commit_xid=pg_catalog.pg_current_xact_id()
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key;
  v_result := public.bot_message_command_internal(p_bot_id,v_row.chat_id,v_row.method,p_payload,p_idempotency_key,p_request_fingerprint);
  UPDATE private.bot_media_ingests SET state='complete',commit_xid=NULL,result=v_result->'result',completed_at=pg_catalog.clock_timestamp()
    WHERE bot_id=p_bot_id AND idempotency_key=p_idempotency_key;
  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb) TO service_role;

SET LOCAL ROLE supabase_storage_admin;
-- Restrictive policies constrain any permissive policy, including later additions.
-- service_role/Storage owner bypass RLS; SELECT and ordinary paths are unchanged.
CREATE POLICY "bot media ingest insert guard" ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
  WITH CHECK (bucket_id <> 'chat-media' OR lower(split_part(name,'/',2)) <> 'bots');
CREATE POLICY "bot media ingest update guard" ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (bucket_id <> 'chat-media' OR lower(split_part(name,'/',2)) <> 'bots')
  WITH CHECK (bucket_id <> 'chat-media' OR lower(split_part(name,'/',2)) <> 'bots');
CREATE POLICY "bot media ingest delete guard" ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
  USING (bucket_id <> 'chat-media' OR lower(split_part(name,'/',2)) <> 'bots');

SET LOCAL ROLE supabase_admin;
DO $selfcheck$
DECLARE r record; p pg_proc;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)','d63775d1cd35ba368a345476903a81af6f0fbdac7000c4ff46667ba9be310393'),
    ('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)','7786e30e6ad6e9184fc88cf46dba8868d3bafbc7821dc088103c2c2ca3b022c8'),
    ('public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)','44da5bb4fa49322ac1ff6c89a31830c4bcd46e6537b7cbe9dfe064d13ea992a2'),
    ('public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)','5fc63a11be9b4e37ff6a062ed6f488c3b7f514f2b6e84a686b192e9681b1ba8f'),
    ('public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)','2457425516395f7e2f31c27dc5dd9e8fac102c2bc3819f5d3f836d73bfc2ef97')
  ) expected(signature,body_hash) LOOP
    SELECT * INTO STRICT p FROM pg_proc WHERE oid=r.signature::regprocedure;
    IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> r.body_hash
      OR pg_get_userbyid(p.proowner) <> 'postgres' OR NOT p.prosecdef OR p.provolatile <> 'v'
      OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
      OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN
      RAISE EXCEPTION 'bot_media_ingest_function_self_check:%',r.signature;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='private.bot_media_ingests'::regclass
    AND pg_get_userbyid(relowner)='postgres' AND relrowsecurity)
    OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
      WHERE c.oid='private.bot_media_ingests'::regclass AND a.grantee <> 'postgres'::regrole)
    OR EXISTS (SELECT 1 FROM pg_attribute a, LATERAL aclexplode(a.attacl) x
      WHERE a.attrelid='private.bot_media_ingests'::regclass AND x.grantee <> 'postgres'::regrole)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname IN ('bot media ingest insert guard','bot media ingest update guard','bot media ingest delete guard')
      AND NOT polpermissive AND polroles=ARRAY[0::oid]) <> 3 THEN
    RAISE EXCEPTION 'bot_media_ingest_table_policy_self_check';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('bot media ingest insert guard','a'),('bot media ingest update guard','w'),('bot media ingest delete guard','d')
  ) expected(policy_name,command) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy policy_row WHERE policy_row.polrelid='storage.objects'::regclass
      AND policy_row.polname=r.policy_name AND policy_row.polcmd::text=r.command
      AND pg_get_expr(policy_row.polqual,policy_row.polrelid) IS NOT DISTINCT FROM
        (CASE WHEN r.command IN ('w','d') THEN $expression$((bucket_id <> 'chat-media'::text) OR (lower(split_part(name, '/'::text, 2)) <> 'bots'::text))$expression$ END)
      AND pg_get_expr(policy_row.polwithcheck,policy_row.polrelid) IS NOT DISTINCT FROM
        (CASE WHEN r.command IN ('a','w') THEN $expression$((bucket_id <> 'chat-media'::text) OR (lower(split_part(name, '/'::text, 2)) <> 'bots'::text))$expression$ END)) THEN
      RAISE EXCEPTION 'bot_media_ingest_policy_expression_self_check:%',r.policy_name;
    END IF;
  END LOOP;
END
$selfcheck$;
COMMIT;
