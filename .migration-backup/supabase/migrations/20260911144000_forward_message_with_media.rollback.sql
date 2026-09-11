-- Rollback of 20260911144000_forward_message_with_media.sql.
--
-- Removes the function. Copies it made stay: they are ordinary messages with
-- their media fields and copied variant rows, which keep working. A client
-- that calls forward_message falls back to inserting the copy itself on the
-- first PGRST202 — with the media fields, so the variant worker renders the
-- copy's previews on its next pass.

begin;

drop function if exists public.forward_message(uuid, uuid, uuid, timestamptz, uuid);

do $$
begin
  if pg_catalog.to_regprocedure('public.forward_message(uuid,uuid,uuid,timestamp with time zone,uuid)') is not null then
    raise exception 'rollback incomplete: forward_message is still present';
  end if;
end
$$;

commit;
