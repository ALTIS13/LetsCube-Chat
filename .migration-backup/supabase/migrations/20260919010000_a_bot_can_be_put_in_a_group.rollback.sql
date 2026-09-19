/**
 * Rollback for `20260919010000_a_bot_can_be_put_in_a_group.sql`.
 *
 * Run as `supabase_admin`.
 *
 * It drops the three functions and nothing else. **Memberships already created
 * are left in place**: they are ordinary `chat_bot_members` rows that
 * `bot_membership_authorize_internal` reads exactly as it reads the private-chat
 * ones, and deleting them would be a data deletion this file has no mandate for
 * — it would also silently take bots out of groups people had put them in.
 *
 * What the rollback restores is the state D-235 describes: the model is built,
 * enforced, and **unreachable**. Nothing can add a bot to a group, and nothing
 * can take one out either, so a membership created before the rollback becomes
 * permanent until somebody writes it by hand:
 *
 *   update public.chat_bot_members set removed_at = now()
 *    where chat_id = '…' and bot_id = '…' and removed_at is null;
 *
 * Roll the client back with it: a bundle calling `chat_bots_available` against a
 * database without it gets an error rather than an empty list, and «no bots to
 * offer» must not be how a missing function looks.
 *
 * Idempotent.
 */

begin;

revoke execute on function public.chat_bots_available(uuid, text) from authenticated;
revoke execute on function public.chat_bot_add(uuid, uuid) from authenticated;
revoke execute on function public.chat_bot_remove(uuid, uuid) from authenticated;

drop function if exists public.chat_bots_available(uuid, text);
drop function if exists public.chat_bot_add(uuid, uuid);
drop function if exists public.chat_bot_remove(uuid, uuid);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('chat_bots_available', 'chat_bot_add', 'chat_bot_remove')
  ) then
    raise exception 'a bot membership function survived the rollback';
  end if;
  -- The thing that must be unchanged either way.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.chat_bot_members'::regclass
       and conname = 'chat_bot_members_visibility_approval_check'
  ) then
    raise exception 'the visibility approval constraint is gone';
  end if;
end;
$$;

commit;
