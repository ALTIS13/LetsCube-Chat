-- Rollback of 20260928210000_deleted_message_keeps_nothing.sql. It removes the
-- mechanism: after it, a deletion keeps the content in the row again, nothing
-- is queued for removal, and notifications keep their previews. What was
-- cleared stays cleared — the content of the messages deleted before the
-- migration, and of those deleted since, survives only in the automated
-- backups, pruned after 14 days. Files already removed from storage are gone.
--
-- Stop the worker first (MEDIA_PURGE_WORKER_ENABLED=0), or it logs a failed
-- claim every minute until it is redeployed without the purge. Files still
-- queued are listed by:
--   select bucket, path, status from private.message_media_purge where status = 'pending';
begin;

drop trigger if exists trg_content_report_closed_finishes_deletion on public.content_reports;
drop trigger if exists trg_zz_deleted_message_leaves_no_preview on public.messages;
drop trigger if exists trg_zz_deleted_message_keeps_nothing on public.messages;
drop function if exists public.message_media_purge_finish(uuid, text);
drop function if exists public.message_media_purge_claim(integer);
drop function if exists private.closed_report_finishes_deletion();
drop function if exists private.deleted_message_leaves_no_preview();
drop function if exists private.scrub_deleted_message_notifications(uuid[]);
drop function if exists private.deleted_message_keeps_nothing();
drop index if exists public.notifications_message_id_idx;
drop table if exists private.message_media_purge;

do $$
begin
  if exists (select 1 from pg_trigger where tgname in (
       'trg_zz_deleted_message_keeps_nothing',
       'trg_zz_deleted_message_leaves_no_preview',
       'trg_content_report_closed_finishes_deletion'))
     or to_regclass('private.message_media_purge') is not null
     or to_regprocedure('public.message_media_purge_claim(integer)') is not null then
    raise exception 'deleted_message_keeps_nothing_rollback_incomplete';
  end if;
end;
$$;

commit;
