/**
 * Rollback of 20260930120000_chat_invite_links.sql.
 *
 * Everything that migration made is new, so this removes it and touches nothing
 * else. Memberships gained through a link stay: they are ordinary member rows,
 * and taking people out of groups they joined is not a rollback's business.
 */
begin;
set local lock_timeout = '5s';

drop function if exists public.chat_invite_link_join(text);
drop function if exists public.chat_invite_link_preview(text);
drop function if exists public.chat_invite_link_revoke(uuid);
drop function if exists public.chat_invite_link_create(uuid, integer, integer, text);
drop table if exists public.chat_invite_links;
drop function if exists public.chat_invite_allowed(uuid);

do $$
begin
  if pg_catalog.to_regclass('public.chat_invite_links') is not null
    or pg_catalog.to_regprocedure('public.chat_invite_allowed(uuid)') is not null
    or pg_catalog.to_regprocedure('public.chat_invite_link_join(text)') is not null
  then
    raise exception 'chat_invite_links survived the rollback';
  end if;
end;
$$;

commit;
