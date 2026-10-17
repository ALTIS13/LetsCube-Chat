-- DRAFT rollback. Disable this Web-only feature, destroy usable hashes and keep
-- revisions/tombstones. Never restore old rich payloads or enable native gates.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $prestate$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:web-message-preview',0))
    OR to_regclass('private.web_message_preview_runtime') IS NULL
    OR to_regclass('private.web_message_preview_grants') IS NULL
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('private.web_message_preview_runtime'::regclass,
      'private.web_message_preview_grants'::regclass) AND (NOT relrowsecurity
      OR relowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')))
  THEN RAISE EXCEPTION 'web_preview_rollback_prestate_drift'; END IF;
END $prestate$;
SET LOCAL ROLE postgres;
UPDATE private.web_message_preview_runtime SET enabled=false WHERE singleton;
UPDATE private.web_message_preview_grants SET grant_hash=NULL,installation_consent=false,
  preview_level='none',expires_at=NULL,revision=least(revision+1,9007199254740991);
UPDATE private.web_message_preview_install_admissions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
DO $selfcheck$
BEGIN
  IF (SELECT enabled FROM private.web_message_preview_runtime WHERE singleton) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM private.web_message_preview_grants
      WHERE grant_hash IS NOT NULL OR installation_consent OR preview_level<>'none' OR expires_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM private.web_message_preview_install_admissions
      WHERE revoked_at IS NULL AND expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'web_preview_rollback_selfcheck_failed'; END IF;
END $selfcheck$;
COMMIT;
