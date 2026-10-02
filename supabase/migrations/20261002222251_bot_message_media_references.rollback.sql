-- Roll back only the two stage-2 observation functions. No rows or stage-1 objects change.
-- DROP RESTRICT refuses if a later admission consumer depends on this resolver.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE postgres;
DROP FUNCTION private.bot_message_media_references(text,text,text,jsonb) RESTRICT;
DROP FUNCTION private.bot_media_url_pointer(text) RESTRICT;
COMMIT;
