-- Rehearsal/recovery only: restores the unfenced D-103 chat-media deletion route.
-- Never use automatically to resolve a hold or a provider's uncertain outcome.
-- No history is removed, no object restored and no quota changed.
-- Requires exact installed hold, fresh backup and a separate recovery decision.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE p pg_proc;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-media-purge-hold:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_purge_hold_migration_busy';
  END IF;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.message_media_purge_claim(integer)');
  IF NOT FOUND OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM
    'ae7c20e755a7631e531c211167896cf6b62536923189392cbbb83db35ae4084c'
    OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
    OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
    OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.message_media_purge'::regclass
      AND conname='message_media_purge_chat_media_unleased' AND contype='c' AND convalidated
      AND pg_get_expr(conbin,conrelid)='((bucket <> ''chat-media''::text) OR (claimed_until IS NULL))') THEN
    RAISE EXCEPTION 'bot_media_purge_hold_rollback_drift';
  END IF;
END
$guard$;
LOCK TABLE private.message_media_purge IN ACCESS EXCLUSIVE MODE;
SET LOCAL ROLE postgres;
DO $restore$
DECLARE v_oid oid := 'public.message_media_purge_claim(integer)'::regprocedure;
  v_body text; v_new text;
  v_anchor text := E'     where queued.status = ''pending''\n       and queued.bucket <> ''chat-media''\n       and (queued.claimed_until';
  v_replacement text := E'     where queued.status = ''pending''\n       and (queued.claimed_until';
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc WHERE oid=v_oid;
  IF encode(sha256(convert_to(v_body,'UTF8')),'hex') IS DISTINCT FROM
    'ae7c20e755a7631e531c211167896cf6b62536923189392cbbb83db35ae4084c'
    OR (length(v_body)-length(replace(v_body,v_anchor,''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'bot_media_purge_hold_rollback_body_drift';
  END IF;
  v_new := replace(v_body,v_anchor,v_replacement);
  IF encode(sha256(convert_to(v_new,'UTF8')),'hex') IS DISTINCT FROM
    '22ae6a8dadb994f1803bbf5b030827fa6fb1c86d350adbf898f64b7a43c3b097' THEN
    RAISE EXCEPTION 'bot_media_purge_hold_rollback_patch_invalid';
  END IF;
  EXECUTE replace(pg_get_functiondef(v_oid),v_body,v_new);
END
$restore$;
ALTER TABLE private.message_media_purge DROP CONSTRAINT message_media_purge_chat_media_unleased;
DO $self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.message_media_purge_claim(integer)'::regprocedure
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='22ae6a8dadb994f1803bbf5b030827fa6fb1c86d350adbf898f64b7a43c3b097')
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.message_media_purge'::regclass
      AND conname='message_media_purge_chat_media_unleased') THEN
    RAISE EXCEPTION 'bot_media_purge_hold_rollback_incomplete';
  END IF;
END
$self_check$;
COMMIT;
