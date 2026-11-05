-- STAGED ONLY. No automatic migration. Recheck the Task6 rollout blockers
-- and the zero-channel usage prestate; obtain a verified before-backup and
-- separate approval before promotion to the registered migration and mirror.
-- Rollback: 2026-11-06-task6-channel-publication.rollback.sql.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

-- Fence concurrent channel creation during this prestate check and install.
LOCK TABLE public.chats IN SHARE MODE;
DO $prestate$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chats WHERE type = 'channel') THEN
    RAISE EXCEPTION 'task6_channel_usage_requires_review';
  END IF;

  IF (SELECT count(*) FROM pg_class
      WHERE oid IN ('public.chats'::regclass, 'public.chat_members'::regclass, 'public.messages'::regclass)
        AND relrowsecurity AND relkind = 'r') <> 3
     OR (SELECT count(*) FROM pg_attribute WHERE attnotnull AND NOT attisdropped
         AND ((attrelid = 'public.chats'::regclass AND attname = 'type')
           OR (attrelid = 'public.messages'::regclass AND attname = 'chat_id'))) <> 2
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.messages'::regclass
         AND polpermissive AND polcmd IN ('a', 'w', '*')) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy WHERE polrelid = 'public.messages'::regclass
         AND polpermissive AND polcmd = 'a' AND polroles = ARRAY['authenticated'::regrole::oid]
         AND pg_get_expr(polwithcheck, polrelid) =
             '((( SELECT auth.uid() AS uid) = user_id) AND (bot_id IS NULL) AND public.is_chat_member(chat_id))'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy WHERE polrelid = 'public.messages'::regclass
         AND polpermissive AND polcmd = 'w' AND polroles = ARRAY[0::oid] AND polwithcheck IS NULL
         AND pg_get_expr(polqual, polrelid) = '(user_id = auth.uid())'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chats'::regclass
         AND tgname = 'trg_chats_identity_is_fixed' AND tgenabled IN ('O', 'A')
         AND tgfoid = 'private.chats_identity_is_fixed()'::regprocedure
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass
         AND tgname = 'trg_messages_sender_on_insert' AND tgenabled IN ('O', 'A')
         AND tgfoid = 'private.enforce_message_sender_on_insert()'::regprocedure
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass
         AND tgname = 'trg_messages_sender_on_update' AND tgenabled IN ('O', 'A')
         AND tgfoid = 'private.enforce_message_sender_on_update()'::regprocedure
     )
     OR has_parameter_privilege('authenticated', 'session_replication_role', 'SET')
     OR has_parameter_privilege('service_role', 'session_replication_role', 'SET')
  THEN
    RAISE EXCEPTION 'task6_channel_publication_prestate_drift';
  END IF;
END
$prestate$;

CREATE FUNCTION private.guard_task6_channel_publication() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $guard$
DECLARE
  chat_kind text;
  actor uuid;
  housekeeping_columns text[] := ARRAY['pinned', 'deleted_at', 'user_id', 'reply_to_id', 'forwarded_from_id'];
BEGIN
  IF NEW.chat_id IS NULL THEN
    RETURN NEW; -- The existing NOT NULL constraint reports this.
  END IF;
  SELECT c.type INTO chat_kind FROM public.chats c WHERE c.id = NEW.chat_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_chat_not_found' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.chat_id IS DISTINCT FROM OLD.chat_id THEN
    IF chat_kind = 'channel' OR EXISTS (
      SELECT 1 FROM public.chats c WHERE c.id = OLD.chat_id AND c.type = 'channel'
    ) THEN
      RAISE EXCEPTION 'channel_publication_forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF chat_kind <> 'channel' THEN
    RETURN NEW;
  END IF;

  -- System events keep their existing sender-shape trigger and RLS boundary.
  IF NEW.type = 'system' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'channel_publication_forbidden' USING ERRCODE = '42501';
    END IF;
    -- Allow moderation, tombstoning and FK detaches, but no piggyback edit.
    IF (pg_catalog.to_jsonb(NEW) - housekeeping_columns) =
       (pg_catalog.to_jsonb(OLD) - housekeeping_columns)
       AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
       AND (NEW.reply_to_id IS NOT DISTINCT FROM OLD.reply_to_id OR (
         NEW.reply_to_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.messages WHERE id = OLD.reply_to_id)
       ))
       AND (NEW.forwarded_from_id IS NOT DISTINCT FROM OLD.forwarded_from_id OR (
         NEW.forwarded_from_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.messages WHERE id = OLD.forwarded_from_id)
       ))
    THEN
      RETURN NEW;
    END IF;
  END IF;

  actor := auth.uid();
  IF actor IS NULL OR NEW.user_id IS DISTINCT FROM actor OR NEW.bot_id IS NOT NULL THEN
    RAISE EXCEPTION 'channel_publication_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Lock in the existing notification order. Do not wait behind a chat or
  -- membership change while an UPDATE may already hold a message row lock.
  PERFORM 1 FROM public.chats c WHERE c.id = NEW.chat_id AND c.type = 'channel' FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_publication_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.chat_members cm
    WHERE cm.chat_id = NEW.chat_id AND cm.user_id = actor AND cm.role IN ('owner', 'admin')
    FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_publication_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$guard$;

ALTER FUNCTION private.guard_task6_channel_publication() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_task6_channel_publication() FROM PUBLIC, anon, authenticated, service_role;

-- Before the existing normalizers, sender guards, and any INSERT effects.
CREATE TRIGGER trg_00_task6_channel_publication
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.guard_task6_channel_publication();

DO $selfcheck$
DECLARE guard oid := 'private.guard_task6_channel_publication()'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = guard AND p.prosecdef AND p.provolatile = 'v'
      AND r.rolname = 'postgres' AND r.rolbypassrls AND p.proconfig = ARRAY['search_path=""']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass
      AND tgname = 'trg_00_task6_channel_publication' AND tgfoid = guard
      AND tgtype = 23 AND tgenabled = 'O' AND tgqual IS NULL AND tgattr::text = ''
  ) OR EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass AND NOT tgisinternal
      AND (tgtype & 3) = 3 AND (tgtype & 20) <> 0 AND tgenabled IN ('O', 'A')
      AND tgname::text COLLATE "C" < 'trg_00_task6_channel_publication'
  ) OR has_function_privilege('anon', guard, 'EXECUTE')
    OR has_function_privilege('authenticated', guard, 'EXECUTE')
    OR has_function_privilege('service_role', guard, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'task6_channel_publication_selfcheck_failed';
  END IF;
END
$selfcheck$;
COMMIT;
