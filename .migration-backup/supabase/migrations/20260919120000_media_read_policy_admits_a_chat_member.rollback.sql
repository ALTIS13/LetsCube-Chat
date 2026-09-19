-- Rollback for `20260919120000_media_read_policy_admits_a_chat_member.sql`.
--
-- Puts the SELECT policy back on the write predicate, which is where it was
-- before. Safe only while the bucket is still public: with a private bucket
-- this narrows reading back to "your own uploads and your own avatar", which
-- takes every other picture in the product off the screen. If the bucket has
-- already been made private, make it public again FIRST and verify a picture
-- somebody else sent still loads, then run this.

begin;

drop policy if exists "media authenticated scoped read" on storage.objects;
create policy "media authenticated scoped read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and public._kub_media_path_allowed(name));

drop function if exists public._kub_media_read_allowed(text);

do $check$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'media authenticated scoped read'
      and qual like '%_kub_media_path_allowed%'
  ) then
    raise exception 'the read policy was not restored';
  end if;
end
$check$;

commit;
