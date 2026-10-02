-- Safe operational rollback: PAUSE new ingestion, do not destroy identities or
-- binding/charge history and do not remove the D-103 whole-chat-media purge hold.
-- Hooks remain installed so trusted writes cannot lose bindings while paused.
-- Upload outcomes may still be recorded; ordinary grants and file_id remain usable.
-- Restoring RPC access requires separately reviewed exact-state checks, not reapply.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $prestate$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-media-logical-identity:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_identity_migration_busy';
  END IF;
  IF to_regclass('private.bot_media_object_identities') IS NULL
    OR to_regclass('private.bot_media_path_claims') IS NULL
    OR to_regclass('private.bot_media_grant_claims') IS NULL
    OR to_regclass('private.bot_media_attempt_bindings') IS NULL
    OR to_regclass('private.bot_media_grant_bindings') IS NULL
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('private.bot_media_ingests'::regclass,
      'private.bot_media_upload_attempts'::regclass,'private.bot_upload_grants'::regclass)
      AND NOT tgisinternal AND tgenabled='O')<>8 THEN
    RAISE EXCEPTION 'bot_media_identity_rollback_prestate_invalid';
  END IF;
END
$prestate$;
SET LOCAL ROLE postgres;
REVOKE EXECUTE ON FUNCTION public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid),
  public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb),
  public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text) FROM service_role;
DO $selfcheck$
BEGIN
  IF has_function_privilege('service_role','public.bot_media_ingest_reserve_internal(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('service_role','public.bot_media_upload_begin_internal(uuid,uuid,uuid,text,text,uuid,text,text,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'bot_media_identity_rollback_pause_failed';
  END IF;
END
$selfcheck$;
COMMIT;
