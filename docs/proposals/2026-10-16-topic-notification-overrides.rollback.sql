-- Compatibility rollback: retain preferences/revisions and disabled enforcement.
-- Never DROP the data or restore the old message-only parent gate while a child
-- disabled choice exists. Full delivery rollback is accepted only in Task6.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL ROLE postgres;
UPDATE private.topic_notification_runtime SET enabled=false WHERE singleton;
DO $check$
BEGIN
  IF (SELECT enabled FROM private.topic_notification_runtime WHERE singleton) IS DISTINCT FROM false
     OR to_regprocedure('private.message_topic_alert_allowed(uuid,uuid)') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.topic_notification_preferences'::regclass) THEN
    RAISE EXCEPTION 'topic_notification_rollback_refused';
  END IF;
END $check$;
COMMIT;
