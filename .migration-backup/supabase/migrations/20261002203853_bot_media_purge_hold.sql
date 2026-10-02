-- D-258 lifecycle prerequisite: D-103 must not delete chat-media before its
-- reference writers, object generations and external I/O share one authority.
-- Whole-bucket forward hold, including encoded/malformed/unregistered paths.
-- No object removal, quota release, receipt update, new RPC or RLS change.
-- Existing settled queue history stays intact; unknown attempted/leased work
-- refuses rollout. This cannot cancel an already-issued provider DELETE.
-- Rollback: 20261002203853_bot_media_purge_hold.rollback.sql. Reopens the unsafe
-- old route; rehearsal only unless a separate recovery decision requires it.
-- Production requires fresh verified backup/full same-image restore, exact
-- reviewed source and byte-identical archive, then independent post-checks.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $prestate$
DECLARE p pg_proc; r record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('letscube:bot-media-purge-hold:migration',0)) THEN
    RAISE EXCEPTION 'bot_media_purge_hold_migration_busy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('private.message_media_purge')
    AND relkind='r' AND NOT relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN
    RAISE EXCEPTION 'bot_media_purge_hold_queue_drift';
  END IF;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.message_media_purge_claim(integer)');
  IF NOT FOUND OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM
    '22ae6a8dadb994f1803bbf5b030827fa6fb1c86d350adbf898f64b7a43c3b097'
    OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
    OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
    OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb THEN
    RAISE EXCEPTION 'bot_media_purge_hold_claim_drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('bucket','text'),('path','text'),('status','text'),
    ('attempts','integer'),('claimed_until','timestamp with time zone'),
    ('finished_at','timestamp with time zone')) expected(column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='private.message_media_purge'::regclass
      AND attnum>0 AND NOT attisdropped AND attname=r.column_name AND atttypid=r.type_name::regtype) THEN
      RAISE EXCEPTION 'bot_media_purge_hold_column_drift';
    END IF;
  END LOOP;
END
$prestate$;

-- Drain SQL users first. A completed claim is then visible to the guard; an
-- invocation waiting before its UPDATE must obey the new table constraint.
LOCK TABLE private.message_media_purge IN ACCESS EXCLUSIVE MODE;
DO $queue_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.message_media_purge'::regclass
    AND conname='message_media_purge_chat_media_unleased') THEN
    RAISE EXCEPTION 'bot_media_purge_hold_prestate_exists';
  END IF;
  IF EXISTS (SELECT 1 FROM private.message_media_purge WHERE bucket='chat-media'
    AND (claimed_until IS NOT NULL OR (attempts>0 AND status NOT IN ('done','kept'))
      OR (status IN ('done','kept') AND finished_at IS NULL))) THEN
    RAISE EXCEPTION 'bot_media_purge_hold_unsettled_delete';
  END IF;
END
$queue_guard$;

SET LOCAL ROLE postgres;
ALTER TABLE private.message_media_purge ADD CONSTRAINT message_media_purge_chat_media_unleased
  CHECK (bucket <> 'chat-media' OR claimed_until IS NULL);

DO $replace_claim$
DECLARE v_oid oid := 'public.message_media_purge_claim(integer)'::regprocedure;
  v_body text; v_new text; v_definition text;
  v_anchor text := E'     where queued.status = ''pending''\n       and (queued.claimed_until';
  v_replacement text := E'     where queued.status = ''pending''\n       and queued.bucket <> ''chat-media''\n       and (queued.claimed_until';
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc WHERE oid=v_oid;
  IF encode(sha256(convert_to(v_body,'UTF8')),'hex') IS DISTINCT FROM
    '22ae6a8dadb994f1803bbf5b030827fa6fb1c86d350adbf898f64b7a43c3b097'
    OR (length(v_body)-length(replace(v_body,v_anchor,''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'bot_media_purge_hold_body_drift';
  END IF;
  v_new := replace(v_body,v_anchor,v_replacement);
  IF encode(sha256(convert_to(v_new,'UTF8')),'hex') IS DISTINCT FROM
    'ae7c20e755a7631e531c211167896cf6b62536923189392cbbb83db35ae4084c' THEN
    RAISE EXCEPTION 'bot_media_purge_hold_patch_invalid';
  END IF;
  v_definition := pg_get_functiondef(v_oid);
  EXECUTE replace(v_definition,v_body,v_new);
END
$replace_claim$;

DO $self_check$
DECLARE p pg_proc;
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid='public.message_media_purge_claim(integer)'::regprocedure;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM
    'ae7c20e755a7631e531c211167896cf6b62536923189392cbbb83db35ae4084c'
    OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
    OR to_jsonb(p.proconfig) IS DISTINCT FROM '["search_path=\"\""]'::jsonb
    OR to_jsonb(p.proacl) IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.message_media_purge'::regclass
      AND conname='message_media_purge_chat_media_unleased' AND contype='c' AND convalidated
      AND pg_get_expr(conbin,conrelid)='((bucket <> ''chat-media''::text) OR (claimed_until IS NULL))')
    OR has_function_privilege('anon','public.message_media_purge_claim(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.message_media_purge_claim(integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.message_media_purge_claim(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'bot_media_purge_hold_incomplete';
  END IF;
END
$self_check$;
COMMIT;
