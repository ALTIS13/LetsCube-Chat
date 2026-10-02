-- D-258 rollback: pause byte-ingest runtime first; verified backup and exact archive required.
-- This does NOT delete objects/messages or the charged private.bot_media_ingests ledger.
-- Failed/unknown uploads remain auditable and charged. Operator cleanup is a separate follow-up.
-- Stop on function, ledger ACL/RLS/owner or exact Storage policy drift; never remove a changed policy.
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
  PERFORM pg_advisory_xact_lock(hashtextextended('letscube:bot-media-ingest:quota',0));
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
      RAISE EXCEPTION 'bot_media_ingest_rollback_drift:%',r.signature;
    END IF;
  END LOOP;
END
$prestate$;

-- Keep the checked policy/table state stable until the transactional drops finish.
LOCK TABLE private.bot_media_ingests, storage.objects IN SHARE ROW EXCLUSIVE MODE;
DO $table_policy_prestate$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass
      AND relkind='r' AND relrowsecurity AND pg_get_userbyid(relowner)='supabase_storage_admin')
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='private.bot_media_ingests'::regclass
      AND relkind='r' AND relrowsecurity AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
      WHERE c.oid='private.bot_media_ingests'::regclass AND a.grantee <> 'postgres'::regrole)
    OR EXISTS (SELECT 1 FROM pg_attribute a, LATERAL aclexplode(a.attacl) x
      WHERE a.attrelid='private.bot_media_ingests'::regclass AND x.grantee <> 'postgres'::regrole) THEN
    RAISE EXCEPTION 'bot_media_ingest_rollback_table_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('bot media ingest insert guard','a'),('bot media ingest update guard','w'),('bot media ingest delete guard','d')
  ) expected(policy_name,command) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy policy_row WHERE policy_row.polrelid='storage.objects'::regclass
      AND policy_row.polname=r.policy_name AND policy_row.polcmd::text=r.command
      AND NOT policy_row.polpermissive AND policy_row.polroles=ARRAY[0::oid]
      AND pg_get_expr(policy_row.polqual,policy_row.polrelid) IS NOT DISTINCT FROM
        (CASE WHEN r.command IN ('w','d') THEN $expression$((bucket_id <> 'chat-media'::text) OR (lower(split_part(name, '/'::text, 2)) <> 'bots'::text))$expression$ END)
      AND pg_get_expr(policy_row.polwithcheck,policy_row.polrelid) IS NOT DISTINCT FROM
        (CASE WHEN r.command IN ('a','w') THEN $expression$((bucket_id <> 'chat-media'::text) OR (lower(split_part(name, '/'::text, 2)) <> 'bots'::text))$expression$ END)) THEN
      RAISE EXCEPTION 'bot_media_ingest_rollback_policy_drift:%',r.policy_name;
    END IF;
  END LOOP;
END
$table_policy_prestate$;
SET LOCAL ROLE postgres;

DO $authorize_restore$
DECLARE
  ddl text := pg_get_functiondef('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)'::regprocedure);
  anchor text := $anchor$      and stored_object.name = p_object_path
      and stored_object.metadata->>'mimetype' = p_content_type
      and case
        when pg_catalog.jsonb_typeof(stored_object.metadata->'size') in ('number','string')
          and stored_object.metadata->>'size' ~ '^[0-9]{1,12}$'
        then (stored_object.metadata->>'size')::bigint = p_byte_size
        else false
      end
  ) then
    raise exception 'bot_upload_object_attributes_invalid'$anchor$;
  replacement text := $replacement$      and stored_object.name = p_object_path
  ) then
    raise exception 'bot_upload_object_missing'$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_authorize_rollback_anchor_drift';
  END IF;
  EXECUTE replace(ddl,anchor,replacement);
END
$authorize_restore$;

DO $send_restore$
DECLARE
  ddl text := pg_get_functiondef('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'::regprocedure);
  anchor text := $anchor$'mime_type','file_name','size','size_bytes','width','height','duration','duration_ms','kind'$anchor$;
  replacement text := $replacement$'mime_type','file_name','size','width','height','duration','kind'$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_send_rollback_anchor_drift';
  END IF;
  EXECUTE replace(ddl,anchor,replacement);
END
$send_restore$;

DO $command_restore$
DECLARE
  ddl text := pg_get_functiondef('public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)'::regprocedure);
  anchor text := $anchor$         where metadata_key not in ('mime_type','size','size_bytes','kind','duration_ms','width','height','file_name')
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
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type')$anchor$;
  replacement text := $replacement$         where metadata_key not in ('mime_type','size','kind')
       )
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type')$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_command_rollback_anchor_drift';
  END IF;
  EXECUTE replace(ddl,anchor,replacement);
END
$command_restore$;

DO $command_lock_restore$
DECLARE
  ddl text := pg_get_functiondef('public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)'::regprocedure);
  anchor text := $anchor$  -- The legacy path shares the operation lock, but never takes the global quota lock.
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
    p_bot_id,$anchor$;
  replacement text := $replacement$  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,$replacement$;
BEGIN
  IF array_length(string_to_array(ddl,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'bot_media_ingest_command_lock_rollback_anchor_drift';
  END IF;
  EXECUTE replace(ddl,anchor,replacement);
END
$command_lock_restore$;

DROP FUNCTION public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb);
DROP FUNCTION public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid);
SET LOCAL ROLE supabase_storage_admin;
DROP POLICY "bot media ingest insert guard" ON storage.objects;
DROP POLICY "bot media ingest update guard" ON storage.objects;
DROP POLICY "bot media ingest delete guard" ON storage.objects;
SET LOCAL ROLE supabase_admin;
DO $selfcheck$
DECLARE r record; p pg_proc;
BEGIN
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
      RAISE EXCEPTION 'bot_media_ingest_rollback_self_check:%',r.signature;
    END IF;
  END LOOP;
  IF to_regprocedure('public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)') IS NOT NULL
    OR to_regprocedure('public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname IN ('bot media ingest insert guard','bot media ingest update guard','bot media ingest delete guard'))
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='private.bot_media_ingests'::regclass AND relrowsecurity
      AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
      WHERE c.oid='private.bot_media_ingests'::regclass AND a.grantee <> 'postgres'::regrole)
    OR EXISTS (SELECT 1 FROM pg_attribute a, LATERAL aclexplode(a.attacl) x
      WHERE a.attrelid='private.bot_media_ingests'::regclass AND x.grantee <> 'postgres'::regrole) THEN
    RAISE EXCEPTION 'bot_media_ingest_rollback_retention_self_check';
  END IF;
END
$selfcheck$;
COMMIT;
