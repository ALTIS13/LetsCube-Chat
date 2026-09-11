-- Rollback of 20260911150000_reactions_visible_to_chat_members.sql.
--
-- Puts back the open read, the insert that checks only the caller's id, and
-- anon's privileges, as production had them on 2026-09-11. Reactions are not
-- touched.

begin;

set local lock_timeout = '5s';

drop policy if exists "Chat members can view reactions" on public.reactions;
drop policy if exists "Chat members can add reactions" on public.reactions;
drop policy if exists "Anyone in chat can view reactions" on public.reactions;
drop policy if exists "Users can add reactions" on public.reactions;

create policy "Anyone in chat can view reactions"
  on public.reactions for select using (true);
create policy "Users can add reactions"
  on public.reactions for insert with check (auth.uid() = user_id);

grant select, insert, update, delete on public.reactions to anon;

do $$
begin
  if not exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'reactions' and policyname = 'Anyone in chat can view reactions'
     )
     or not exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'reactions' and policyname = 'Users can add reactions'
     )
     or exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'reactions'
          and policyname in ('Chat members can view reactions', 'Chat members can add reactions')
     ) then
    raise exception 'rollback incomplete: the reaction policies are not as they were';
  end if;
end
$$;

commit;
