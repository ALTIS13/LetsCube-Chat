/**
 * Rollback for 20260913120000_media_variant_job_queue.sql (D-176).
 *
 * Safe to run at any time: the worker keeps its scan as a safety net, so a
 * deployment with no queue behaves exactly as it did before the queue existed --
 * it finds its work by scanning, a minute later than it would have.
 *
 * Order matters. The triggers go first, so nothing can insert into a table that
 * is about to be dropped; then the functions the worker calls, which is the only
 * way anything outside `private` reaches the queue; then the table.
 */

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_enqueue_media_variant_job_on_insert on public.messages;
drop trigger if exists trg_enqueue_media_variant_job_on_update on public.messages;
drop trigger if exists trg_enqueue_media_variant_job_for_profile on public.profiles;
drop trigger if exists trg_enqueue_media_variant_job_for_chat on public.chats;

drop function if exists private.enqueue_media_variant_job_for_message();
drop function if exists private.enqueue_media_variant_job_for_profile();
drop function if exists private.enqueue_media_variant_job_for_chat();

drop function if exists public.media_variant_jobs_claim(integer, uuid, timestamptz);
drop function if exists public.media_variant_job_finish(text, uuid);
drop function if exists public.media_variant_job_retry(text, uuid, text, timestamptz);

drop table if exists private.media_variant_jobs;

do $check$
begin
  if pg_catalog.to_regclass('private.media_variant_jobs') is not null then
    raise exception 'the media variant job queue is still present after rollback';
  end if;
  if (
    select pg_catalog.count(*)
      from pg_catalog.pg_trigger
     where not tgisinternal
       and tgname like 'trg_enqueue_media_variant_job%'
  ) <> 0 then
    raise exception 'a media variant job trigger survived the rollback';
  end if;
end
$check$;

commit;
