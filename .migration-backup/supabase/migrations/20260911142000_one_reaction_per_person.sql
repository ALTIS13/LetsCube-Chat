/**
 * One reaction per person per message, set in one call, with the limit in one
 * server-side place.
 *
 * WHAT EXISTS. The client toggles a reaction in three requests: it looks up the
 * person's reactions on the message, deletes them, and inserts the new one
 * (`useMessages.ts`, `toggleReaction`). The owner decided on 2026-09-11 that a
 * person has one reaction per message, as in Telegram, and the client enforces
 * it — but only the client. `public.reactions` is unique on
 * (message_id, user_id, emoji), so the database takes a second emoji from the
 * same person, and two devices choosing at the same moment can leave two.
 *
 * WHAT THIS ADDS.
 *
 *   - `private.reaction_limit_per_message(user)` is the rule: 1 today. A paid
 *     subscription that allows several reactions (tracker queue 24) changes this
 *     one function and nothing else. `public.reaction_limit_per_message()` asks
 *     it for the caller only, so no one can probe another account's limit.
 *   - A BEFORE INSERT trigger on `public.reactions` refuses a row that would give
 *     the person more distinct emoji on the message than the limit. Every path
 *     is held to it — the new RPC, an unupdated client's direct insert, the API
 *     called by hand. It takes a transaction-scoped advisory lock on
 *     (message, person), so two concurrent inserts are serialised rather than
 *     both counting zero.
 *   - `public.set_message_reaction(message, emoji)` does the whole toggle
 *     atomically under that lock: the same emoji again removes it; another emoji
 *     removes the person's oldest reactions until there is room and inserts it.
 *     It returns every reaction on the message afterwards, so the client needs
 *     no refetch.
 *
 * The table's uniqueness on (message_id, user_id, emoji) is kept and the
 * self-check proves it: several different emoji per person is exactly what the
 * subscription will allow.
 *
 * Existing duplicates are left alone (no data is touched). The next choice a
 * person makes on such a message clears them, because the RPC removes every
 * other reaction of theirs before inserting.
 *
 * The trigger function is SECURITY DEFINER so its count sees every row whatever
 * the table's select policy becomes; the RPC is SECURITY DEFINER because it
 * deletes and inserts on the caller's behalf, and checks membership, the ban
 * and the message itself before doing so.
 *
 * OWNER. Apply as the owner of `public.reactions` and `public.messages`
 * (postgres on this deployment) or a superuser; the self-check refuses an owner
 * that row-level security would apply to.
 *
 * REALTIME. Nothing new. `public.reactions` is already published, and the RPC's
 * delete and insert produce the same changes the three client requests did.
 *
 * Lock: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on `public.reactions`.
 *
 * Rollback: 20260911142000_one_reaction_per_person.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

create or replace function private.reaction_limit_per_message(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  -- Every account: one reaction per message. The subscription reads its
  -- entitlement for p_user_id here.
  select 1
$function$;

create or replace function public.reaction_limit_per_message()
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select private.reaction_limit_per_message(auth.uid())
$function$;

create or replace function private.reaction_lock_key(p_message_id uuid, p_user_id uuid)
returns bigint
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.hashtextextended('reaction:' || p_message_id::text || ':' || p_user_id::text, 0)
$function$;

create or replace function private.enforce_reaction_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
  v_others integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(private.reaction_lock_key(new.message_id, new.user_id));
  v_limit := private.reaction_limit_per_message(new.user_id);
  select pg_catalog.count(*)::integer
    into v_others
    from public.reactions as reaction
   where reaction.message_id = new.message_id
     and reaction.user_id = new.user_id
     and reaction.emoji is distinct from new.emoji;
  if v_others >= v_limit then
    raise exception 'reaction_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_enforce_reaction_limit on public.reactions;
create trigger trg_enforce_reaction_limit
  before insert on public.reactions
  for each row execute function private.enforce_reaction_limit();

create or replace function public.set_message_reaction(p_message_id uuid, p_emoji text)
returns setof public.reactions
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_emoji text := pg_catalog.btrim(coalesce(p_emoji, ''));
  v_chat_id uuid;
  v_deleted_at timestamptz;
  v_type text;
  v_limit integer;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_message_id is null then
    raise exception 'invalid_message_id' using errcode = '22023';
  end if;
  -- An emoji is short: the longest joined sequences in the picker are a few
  -- code points. Anything longer is a sentence in a chip.
  if v_emoji = '' or pg_catalog.char_length(v_emoji) > 16 then
    raise exception 'invalid_emoji' using errcode = '22023';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'user_banned' using errcode = '42501';
  end if;

  select message.chat_id, message.deleted_at, message.type
    into v_chat_id, v_deleted_at, v_type
    from public.messages as message
   where message.id = p_message_id;
  if not found
     or not exists (
       select 1 from public.chat_members as me
        where me.chat_id = v_chat_id and me.user_id = v_uid
     ) then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  if v_deleted_at is not null or coalesce(v_type, 'text') = 'system' then
    raise exception 'message_not_reactable' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(private.reaction_lock_key(p_message_id, v_uid));

  if exists (
    select 1 from public.reactions as reaction
     where reaction.message_id = p_message_id
       and reaction.user_id = v_uid
       and reaction.emoji = v_emoji
  ) then
    delete from public.reactions as reaction
     where reaction.message_id = p_message_id
       and reaction.user_id = v_uid
       and reaction.emoji = v_emoji;
  else
    v_limit := greatest(private.reaction_limit_per_message(v_uid), 1);
    -- Keep the newest (limit - 1) of the person's reactions, so the new one
    -- fits. With the limit at 1 that removes all of them.
    delete from public.reactions as reaction
     where reaction.message_id = p_message_id
       and reaction.user_id = v_uid
       and reaction.id not in (
         select kept.id
           from public.reactions as kept
          where kept.message_id = p_message_id
            and kept.user_id = v_uid
          order by kept.created_at desc, kept.id desc
          limit v_limit - 1
       );
    insert into public.reactions (message_id, user_id, emoji)
    values (p_message_id, v_uid, v_emoji);
  end if;

  return query
    select reaction.*
      from public.reactions as reaction
     where reaction.message_id = p_message_id
     order by reaction.created_at, reaction.id;
end
$function$;

revoke all on function private.reaction_limit_per_message(uuid) from public, anon, authenticated, service_role;
revoke all on function private.reaction_lock_key(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.enforce_reaction_limit() from public, anon, authenticated, service_role;

revoke all on function public.reaction_limit_per_message() from public, anon;
grant execute on function public.reaction_limit_per_message() to authenticated;
revoke all on function public.set_message_reaction(uuid, text) from public, anon;
grant execute on function public.set_message_reaction(uuid, text) to authenticated;

comment on function public.set_message_reaction(uuid, text) is
  'Sets the caller''s reaction on a message: the same emoji again removes it, another replaces the oldest beyond the per-message limit. Returns every reaction on the message.';
comment on function public.reaction_limit_per_message() is
  'How many different reactions the caller may put on one message. 1 for every account today.';

do $$
declare
  v_expected record;
  v_proc record;
  v_trigger record;
  v_columns text[];
  v_owner oid;
  v_table record;
begin
  if private.reaction_limit_per_message(gen_random_uuid()) <> 1 then
    raise exception 'the per-message reaction limit is not 1';
  end if;

  for v_expected in
    select * from (values
      ('public.set_message_reaction(uuid,text)', true),
      ('public.reaction_limit_per_message()', true),
      ('private.reaction_limit_per_message(uuid)', true),
      ('private.reaction_lock_key(uuid,uuid)', false),
      ('private.enforce_reaction_limit()', true)
    ) as expected(signature, definer)
  loop
    select p.prosecdef, p.proconfig, p.proowner
      into v_proc
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(v_expected.signature);
    if not found then
      raise exception 'function % is missing', v_expected.signature;
    end if;
    if v_proc.prosecdef is distinct from v_expected.definer then
      raise exception 'function % has SECURITY DEFINER = %, expected %', v_expected.signature, v_proc.prosecdef, v_expected.definer;
    end if;
    if not exists (select 1 from pg_catalog.unnest(v_proc.proconfig) c where c like 'search_path=%') then
      raise exception 'function % has no fixed search_path', v_expected.signature;
    end if;
    if pg_catalog.has_function_privilege('anon', v_expected.signature, 'EXECUTE') then
      raise exception 'anon can execute %', v_expected.signature;
    end if;
    if v_expected.signature like 'private.%'
       and pg_catalog.has_function_privilege('authenticated', v_expected.signature, 'EXECUTE') then
      raise exception 'authenticated can execute %', v_expected.signature;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('authenticated', 'public.set_message_reaction(uuid,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.reaction_limit_per_message()', 'EXECUTE') then
    raise exception 'authenticated cannot execute the reaction RPCs';
  end if;

  select t.tgenabled, t.tgtype, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.reactions'::regclass
     and t.tgname = 'trg_enforce_reaction_limit'
     and not t.tgisinternal;
  -- tgtype bits: 1 = row, 2 = before, 4 = insert.
  if not found or v_trigger.tgenabled = 'D'
     or (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) = 0 or (v_trigger.tgtype & 4) = 0
     or v_trigger.fn <> 'private.enforce_reaction_limit()' then
    raise exception 'the reaction limit trigger is missing, disabled or not BEFORE INSERT FOR EACH ROW';
  end if;

  -- The uniqueness a subscription with several reactions relies on.
  if not exists (
    select 1
      from pg_catalog.pg_index i
     where i.indrelid = 'public.reactions'::regclass
       and i.indisunique
       and i.indpred is null
       and (
         select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(i.indkey::smallint[]) with ordinality as k(attnum, ordinality)
           join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
       ) = array['message_id', 'user_id', 'emoji']
  ) then
    raise exception 'public.reactions lost its uniqueness on (message_id, user_id, emoji)';
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.reactions'::regclass) then
    raise exception 'public.reactions has row-level security off';
  end if;

  -- The RPC deletes and inserts for the caller: its owner must not be subject
  -- to the table's policies, or it would do nothing and report success.
  select p.proowner into v_owner
    from pg_catalog.pg_proc p
   where p.oid = 'public.set_message_reaction(uuid,text)'::regprocedure;
  for v_table in
    select c.oid, c.relname, c.relowner, c.relforcerowsecurity
      from pg_catalog.pg_class c
     where c.oid in ('public.reactions'::regclass, 'public.messages'::regclass, 'public.chat_members'::regclass)
  loop
    if not exists (
      select 1 from pg_catalog.pg_roles r
       where r.oid = v_owner and (r.rolsuper or r.rolbypassrls)
    ) and (v_table.relforcerowsecurity or not pg_catalog.pg_has_role(v_owner, v_table.relowner, 'USAGE')) then
      raise exception 'set_message_reaction is owned by %, which row-level security on public.% (owner %) applies to; apply as the table owner',
        pg_catalog.pg_get_userbyid(v_owner), v_table.relname, pg_catalog.pg_get_userbyid(v_table.relowner);
    end if;
  end loop;
end
$$;

commit;
