-- STAGED ONLY. Restore the prior publication contract; no data changes.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DROP TRIGGER trg_00_task6_channel_publication ON public.messages;
DROP FUNCTION private.guard_task6_channel_publication();

DO $selfcheck$
BEGIN
  IF to_regprocedure('private.guard_task6_channel_publication()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass
                AND tgname = 'trg_00_task6_channel_publication')
  THEN
    RAISE EXCEPTION 'task6_channel_publication_rollback_failed';
  END IF;
END
$selfcheck$;
COMMIT;
