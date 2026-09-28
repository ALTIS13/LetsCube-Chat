-- Rollback of 20260929090000_channel_reads.sql. The client treats a missing
-- function as «no counts» and draws the channel list without them, so it may
-- go first or after. The chat's own read mark was never touched.
begin;

drop function if exists public.channel_unread_counts(uuid);
drop function if exists public.mark_channel_read(uuid, text, timestamptz);
drop table if exists public.channel_reads;

do $$
begin
  if to_regclass('public.channel_reads') is not null
     or to_regprocedure('public.channel_unread_counts(uuid)') is not null then
    raise exception 'channel_reads_rollback_incomplete';
  end if;
end;
$$;

commit;
