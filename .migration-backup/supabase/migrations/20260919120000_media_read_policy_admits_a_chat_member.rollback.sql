-- Rollback for `20260919120000_media_read_policy_admits_a_chat_member.sql`.
--
-- Puts the SELECT policy back on the write predicate, which is where it was
-- before. Safe only while the bucket is still public: with a private bucket
-- this narrows reading back to "your own uploads and your own avatar", which
-- takes every other picture in the product off the screen. If the bucket has
-- already been made private, make it public again FIRST and verify a picture
-- somebody else sent still loads, then run this.
--
-- Run it as `supabase_admin`, the same role the migration needs. `storage.objects`
-- is owned by `supabase_storage_admin` and `postgres` is not a member of that
-- role (`pg_has_role` answers false here), so `postgres` cannot drop or create
-- a policy on it, and cannot drop a function owned by `postgres` either while
-- the policy still names it. Measured on production 2026-09-19.
--
-- Rehearsed: run verbatim inside the migration's own rehearsal transaction,
-- after the migration, and the pre-migration measurements were then taken
-- again and matched.

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

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_kub_media_read_allowed'
  ) then
    raise exception 'the read predicate is still there';
  end if;

  -- The write policies are not this file's business, and must be untouched.
  if (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('media authenticated scoped insert',
                         'media authenticated scoped update',
                         'media authenticated scoped delete')
      and coalesce(qual, '') || coalesce(with_check, '') like '%media_path_allowed%'
  ) <> 3 then
    raise exception 'the write policies were disturbed';
  end if;
end
$check$;

commit;
