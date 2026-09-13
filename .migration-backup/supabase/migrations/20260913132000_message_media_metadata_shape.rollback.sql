begin;
set local lock_timeout = '5s';
alter table public.messages drop constraint if exists messages_media_metadata_shape;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_media_metadata_shape'
  ) then
    raise exception 'rollback incomplete: the media_metadata shape constraint is still present';
  end if;
end $$;
commit;
