begin;
update storage.buckets set file_size_limit = null where id = 'media';
do $$
declare v_limit bigint;
begin
  select file_size_limit into v_limit from storage.buckets where id = 'media';
  if v_limit is not null then
    raise exception 'rollback incomplete: the media bucket still carries a limit of %', v_limit;
  end if;
end $$;
commit;
