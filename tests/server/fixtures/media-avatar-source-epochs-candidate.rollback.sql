-- DISPOSABLE D-338 observation rollback only, not production SQL authorization.
-- Original owner/queue/setter functions, policies, ACLs and hooks were never
-- replaced. Drop only these owned additive objects, never use CASCADE.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
DO $owned$
BEGIN
  IF obj_description('private.media_avatar_source_current'::regclass,'pg_class') IS DISTINCT FROM
    'D-338 disposable logical epoch observation v1; current/tombstone; not physical/I-O authority'
    OR obj_description('private.media_avatar_source_history'::regclass,'pg_class') IS DISTINCT FROM
    'D-338 disposable logical epoch observation v1; retained, unmanaged; not physical/I-O authority'
  THEN RAISE EXCEPTION 'avatar_epoch_rollback_not_owned'; END IF;
END
$owned$;
DO $hooks$
DECLARE v_table text; v_trigger text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['profiles','chats','bots'] LOOP
    FOREACH v_trigger IN ARRAY ARRAY['a00_avatar_epoch_explicit','a01_avatar_epoch_update_fallback','a00_avatar_epoch_delete',
      'z99_avatar_epoch_insert_final','z99_avatar_epoch_update_final','z99_avatar_epoch_delete_final','z99_avatar_epoch_truncate'] LOOP
      EXECUTE format('drop trigger %I on public.%I',v_trigger,v_table);
    END LOOP;
  END LOOP;
END
$hooks$;
DROP FUNCTION private.media_avatar_source_truncate();
DROP FUNCTION private.media_avatar_source_reconcile();
DROP FUNCTION private.media_avatar_source_event();
DROP FUNCTION private.media_avatar_source_observe(text,uuid,boolean,text);
DROP TABLE private.media_avatar_source_current;
DROP TABLE private.media_avatar_source_history;
DO $selfcheck$
BEGIN
  IF to_regclass('private.media_avatar_source_current') IS NOT NULL
    OR to_regclass('private.media_avatar_source_history') IS NOT NULL
    OR to_regprocedure('private.media_avatar_source_observe(text,uuid,boolean,text)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN
      ('a00_avatar_epoch_explicit','a01_avatar_epoch_update_fallback','a00_avatar_epoch_delete',
        'z99_avatar_epoch_insert_final','z99_avatar_epoch_update_final','z99_avatar_epoch_delete_final','z99_avatar_epoch_truncate'))
  THEN RAISE EXCEPTION 'avatar_epoch_rollback_incomplete'; END IF;
END
$selfcheck$;
COMMIT;
