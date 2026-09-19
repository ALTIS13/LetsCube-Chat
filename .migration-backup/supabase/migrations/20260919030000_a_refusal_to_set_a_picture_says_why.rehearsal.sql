/**
 * Rehearsal for `20260919030000_a_refusal_to_set_a_picture_says_why.sql`, run
 * on production inside one transaction that ends in ROLLBACK.
 *
 * It measures the thing that is supposed to change — the SQLSTATE that comes
 * out of each of the five refusal paths — rather than proving the DDL parses.
 * Every path is called twice: once as `supabase_admin`, which can always
 * execute the function and so sees the function's own raises, and once as
 * `service_role`, which is the role the Bot Gateway resolves to through
 * PostgREST and which is what the second half of the migration is about.
 *
 * The middle section between the two measurement phases is the migration's own
 * text, spliced in verbatim with its `begin;`/`commit;` removed, so the
 * rehearsal cannot drift from what is applied.
 *
 * Two paths need a state production does not have, both made and unmade inside
 * the transaction:
 *
 *   C  `not_found` needs an owner row whose bot does not exist, which
 *      `bot_owners_bot_id_fkey` (ON DELETE RESTRICT) forbids. The FK triggers
 *      are stood down for the single insert with a transaction-local
 *      `session_replication_role`, and the row is deleted again immediately.
 *   D  `bot_deleted` needs a bot in a deleted state; all three production bots
 *      are active. The state is flipped and restored on the same row.
 *
 * Path F is the success path: it writes an avatar_url and is the proof that
 * the grant actually makes the feature reachable, not merely that the refusals
 * are named. It is rolled back with everything else.
 *
 * No uuid, username or personal value is printed: the log carries the phase,
 * the path, the role, the SQLSTATE and the message the function raised.
 */

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create temp table rehearsal_log(
  seq serial,
  phase text,
  label text,
  role_used text,
  sqlstate text,
  message text
) on commit drop;

create function pg_temp.probe(
  p_phase text, p_label text, p_role text,
  p_actor uuid, p_bot uuid, p_url text
) returns void language plpgsql as $probe$
declare
  v_state text;
  v_msg text;
begin
  execute format('set role %I', p_role);
  begin
    perform public.bot_set_avatar_internal(p_actor, p_bot, p_url, 'rehearsal');
    v_state := 'NONE';
    v_msg := 'returned without raising';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  reset role;
  insert into rehearsal_log(phase, label, role_used, sqlstate, message)
  values (p_phase, p_label, p_role, v_state, v_msg);
end;
$probe$;

create function pg_temp.run_phase(p_phase text) returns void language plpgsql as $phase$
declare
  v_bot uuid;
  v_owner uuid;
  v_prev_state text;
  v_orphan uuid := gen_random_uuid();
  v_prefix text := 'https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/';
  v_role text;
begin
  select o.bot_id, o.user_id, b.state into v_bot, v_owner, v_prev_state
    from public.bot_owners o
    join public.bots b on b.id = o.bot_id
   where o.role = 'owner' and b.state = 'active'
   order by b.id
   limit 1;
  if v_bot is null then
    raise exception 'no active bot with an owner to rehearse on';
  end if;

  foreach v_role in array array['supabase_admin', 'service_role'] loop
    -- A  no actor and no bot at all
    perform pg_temp.probe(p_phase, 'A invalid_request', v_role, null, null, null);
    -- B  a stranger, who owns nothing
    perform pg_temp.probe(p_phase, 'B forbidden', v_role, gen_random_uuid(), v_bot, null);
    -- C  an owner row whose bot does not exist
    perform set_config('session_replication_role', 'replica', true);
    insert into public.bot_owners(bot_id, user_id, role) values (v_orphan, v_owner, 'owner');
    perform set_config('session_replication_role', 'origin', true);
    perform pg_temp.probe(p_phase, 'C not_found', v_role, v_owner, v_orphan, null);
    delete from public.bot_owners where bot_id = v_orphan;
    -- E  the owner, pointing at some other bot's file
    perform pg_temp.probe(p_phase, 'E invalid_avatar', v_role, v_owner, v_bot,
                          v_prefix || gen_random_uuid()::text || '/picture.webp');
    -- F  the owner, pointing at this bot's own file: the success path
    perform pg_temp.probe(p_phase, 'F success', v_role, v_owner, v_bot,
                          v_prefix || v_bot::text || '/picture.webp');
    -- D  the owner, on a bot that has been deleted
    update public.bots set state = 'deleted' where id = v_bot;
    perform pg_temp.probe(p_phase, 'D bot_deleted', v_role, v_owner, v_bot, null);
    update public.bots set state = v_prev_state, avatar_url = null where id = v_bot;
  end loop;
end;
$phase$;

select pg_temp.run_phase('1 before');

-- ==== the migration, spliced verbatim ====
create or replace function public.bot_set_avatar_internal(
  p_actor_id uuid,
  p_bot_id uuid,
  p_avatar_url text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_url text := nullif(pg_catalog.btrim(coalesce(p_avatar_url, '')), '');
  v_state text;
begin
  if p_actor_id is null or p_bot_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.bot_owners owner
    where owner.bot_id = p_bot_id
      and owner.user_id = p_actor_id
      and owner.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select bot.state into v_state from public.bots bot where bot.id = p_bot_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_state in ('pending_delete', 'deleted') then
    raise exception 'bot_deleted' using errcode = '55000';
  end if;

  -- A picture must be this bot's own file. Without this an owner could point
  -- one of their bots at another bot's avatar, which is a small thing that
  -- would read as impersonation in a chat.
  if v_url is not null
     and v_url not like ('https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/' || p_bot_id::text || '/%') then
    raise exception 'invalid_avatar' using errcode = '22023';
  end if;

  update public.bots
  set avatar_url = v_url, updated_at = pg_catalog.now()
  where id = p_bot_id;

  return pg_catalog.jsonb_build_object('ok', true, 'avatar_url', v_url);
end
$function$;

-- The Bot Gateway reaches this through PostgREST as `service_role`, exactly as
-- it reaches the eighteen sibling functions. Without this it cannot call it.
grant execute on function public.bot_set_avatar_internal(uuid, uuid, text, text) to service_role;

do $check$
declare
  v_def text;
  v_owner text;
  v_secdef boolean;
  v_config text;
begin
  select pg_get_functiondef(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, coalesce(p.proconfig::text, '')
    into v_def, v_owner, v_secdef, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bot_set_avatar_internal';

  if v_def is null then
    raise exception 'bot_set_avatar_internal is gone';
  end if;

  -- The five refusals, each paired with the SQLSTATE it must now carry.
  if v_def not like ('%' || $p$raise exception 'invalid_request' using errcode = '22023'$p$ || '%') then
    raise exception 'invalid_request does not carry 22023';
  end if;
  if v_def not like ('%' || $p$raise exception 'forbidden' using errcode = '42501'$p$ || '%') then
    raise exception 'forbidden does not carry 42501';
  end if;
  if v_def not like ('%' || $p$raise exception 'not_found' using errcode = 'P0002'$p$ || '%') then
    raise exception 'not_found does not carry P0002';
  end if;
  if v_def not like ('%' || $p$raise exception 'bot_deleted' using errcode = '55000'$p$ || '%') then
    raise exception 'bot_deleted does not carry 55000';
  end if;
  if v_def not like ('%' || $p$raise exception 'invalid_avatar' using errcode = '22023'$p$ || '%') then
    raise exception 'invalid_avatar does not carry 22023';
  end if;
  if v_def like '%P0001%' then
    raise exception 'a refusal still raises P0001';
  end if;

  -- The parts that must not have moved.
  if v_owner <> 'supabase_admin' then
    raise exception 'owner changed to %', v_owner;
  end if;
  if not v_secdef then
    raise exception 'the function stopped being security definer';
  end if;
  if v_config not like '%search_path=pg_catalog, public%' then
    raise exception 'search_path changed to %', v_config;
  end if;
  if v_def not like ('%' || $p$https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/$p$ || '%') then
    raise exception 'the own-file check lost its prefix';
  end if;

  -- Who may call it.
  if not has_function_privilege('service_role', 'public.bot_set_avatar_internal(uuid, uuid, text, text)', 'execute') then
    raise exception 'service_role still cannot execute it';
  end if;
  if has_function_privilege('anon', 'public.bot_set_avatar_internal(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.bot_set_avatar_internal(uuid, uuid, text, text)', 'execute') then
    raise exception 'a client role can execute it';
  end if;
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) as a
     where n.nspname = 'public'
       and p.proname = 'bot_set_avatar_internal'
       and a.grantee = 0
  ) then
    raise exception 'PUBLIC can execute it';
  end if;
end;
$check$;


select pg_temp.run_phase('2 after');

select phase, label, role_used, sqlstate, message
  from rehearsal_log
 order by seq;

-- What the state of the row must be when this is over.
select 'bots left changed' as check,
       count(*) filter (where state <> 'active') as not_active,
       count(avatar_url) as with_avatar
  from public.bots;
select 'orphan owner rows' as check, count(*) as rows
  from public.bot_owners o
  left join public.bots b on b.id = o.bot_id
 where b.id is null;

rollback;
