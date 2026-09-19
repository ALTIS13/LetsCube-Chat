/**
 * Rollback for `20260919020000_removing_a_bot_is_a_group_act.sql`.
 *
 * Run as `supabase_admin`. It restores `chat_bot_remove` without the group
 * check — that is, it reopens the asymmetry described in that file's header: a
 * direct call can soft-remove a bot from a **private** bot chat, whose opener is
 * its owner, after which `open_or_create_bot_chat` creates a second private chat
 * with the same bot.
 *
 * Nothing in the interface offers that, and no such pair exists today, so this
 * is safe to run — but it is a rollback of a guard, not of a behaviour anybody
 * wanted.
 */

begin;

create or replace function public.chat_bot_remove(p_chat_id uuid, p_bot_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_chat_admin(p_chat_id) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  update public.chat_bot_members
     set removed_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where chat_id = p_chat_id
     and bot_id = p_bot_id
     and removed_at is null;

  return true;
end;
$$;

commit;
