begin;
set local lock_timeout = '5s';
drop trigger if exists trg_guard_message_media_path on public.messages;
drop function if exists private.guard_message_media_path();
drop function if exists private.message_media_path_allowed(uuid, uuid, uuid, text, boolean);
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.messages'::regclass
       and tgname = 'trg_guard_message_media_path'
  ) or pg_catalog.to_regprocedure('private.guard_message_media_path()') is not null then
    raise exception 'rollback incomplete: the media-path guard is still present';
  end if;
end $$;
commit;
