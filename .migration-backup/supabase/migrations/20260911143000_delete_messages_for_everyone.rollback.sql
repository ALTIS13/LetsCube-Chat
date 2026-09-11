-- Rollback of 20260911143000_delete_messages_for_everyone.sql.
--
-- Removes the function. Messages it deleted stay deleted: reverse a particular
-- deletion first, from private.message_deletions, with the query in the
-- migration's header. The log itself is dropped only when it is empty, because
-- once it is gone nobody can tell which deletions were made through this
-- function; to drop a non-empty log, restore what should be restored, then
-- drop it by hand.

begin;

drop function if exists public.delete_messages_for_everyone(uuid[]);

do $$
begin
  if pg_catalog.to_regclass('private.message_deletions') is not null then
    if exists (select 1 from private.message_deletions) then
      raise notice 'private.message_deletions holds rows and is kept; drop it by hand once the deletions it records have been reviewed';
    else
      execute 'drop table private.message_deletions';
    end if;
  end if;
  if pg_catalog.to_regprocedure('public.delete_messages_for_everyone(uuid[])') is not null then
    raise exception 'rollback incomplete: delete_messages_for_everyone is still present';
  end if;
end
$$;

commit;
