/**
 * Rollback of 20260930170000_a_chat_keeps_its_kind.sql.
 *
 * Reopens what that migration closed: a chat's owner can change its kind
 * again, with the block and deletion consequences its header lists.
 */
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_chats_identity_is_fixed on public.chats;
drop function if exists private.chats_identity_is_fixed();

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.chats'::regclass
       and tgname = 'trg_chats_identity_is_fixed'
  ) then
    raise exception 'chat_kind_rollback_incomplete';
  end if;
end;
$$;

commit;
