-- Remove only derived observations/hooks. Preserve messages/registry/accounting/purge hold.
-- No CASCADE, Storage/provider I/O, deletion permission or refund.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL ROLE postgres;
LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER trg_bot_message_media_observations_insert ON public.messages;
DROP TRIGGER trg_bot_message_media_observations_update ON public.messages;
DROP TRIGGER trg_bot_message_media_observations_delete ON public.messages;
DROP TRIGGER trg_bot_message_media_observations_truncate ON public.messages;
DROP FUNCTION private.bot_message_media_observe_statement();
DROP TABLE private.bot_message_media_observations;
COMMIT;
