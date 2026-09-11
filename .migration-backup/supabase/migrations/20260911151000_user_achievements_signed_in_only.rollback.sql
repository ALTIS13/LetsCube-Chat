-- Rollback of 20260911151000_user_achievements_signed_in_only.sql.
--
-- Puts back the read for every role and anon's privileges, as production had
-- them on 2026-09-11. No row is touched.

begin;

set local lock_timeout = '5s';

drop policy if exists "Signed-in people can view earned achievements" on public.user_achievements;
drop policy if exists "user achievements readable" on public.user_achievements;
create policy "user achievements readable"
  on public.user_achievements for select using (true);

grant select, insert, update, delete on public.user_achievements to anon;

do $$
begin
  if not exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'user_achievements' and policyname = 'user achievements readable'
     )
     or exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'user_achievements'
          and policyname = 'Signed-in people can view earned achievements'
     )
     or not pg_catalog.has_table_privilege('anon', 'public.user_achievements', 'SELECT') then
    raise exception 'rollback incomplete: public.user_achievements is not readable as it was';
  end if;
end
$$;

commit;
