-- Rollback of 20260911142000_one_reaction_per_person.sql.
--
-- Removes the limit trigger and the reaction RPCs. Reactions are not touched.
-- After this the database accepts several emoji per person again and only the
-- client holds the rule; a client that calls set_message_reaction falls back to
-- its lookup, delete and insert on the first PGRST202.

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_enforce_reaction_limit on public.reactions;
drop function if exists public.set_message_reaction(uuid, text);
drop function if exists public.reaction_limit_per_message();
drop function if exists private.enforce_reaction_limit();
drop function if exists private.reaction_limit_per_message(uuid);
drop function if exists private.reaction_lock_key(uuid, uuid);

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.reactions'::regclass
       and tgname = 'trg_enforce_reaction_limit'
  ) or pg_catalog.to_regprocedure('public.set_message_reaction(uuid,text)') is not null then
    raise exception 'rollback incomplete: the reaction limit is still present';
  end if;
end
$$;

commit;
