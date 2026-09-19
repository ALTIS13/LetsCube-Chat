/**
 * A refusal to set a bot's picture says which refusal it is — and the gateway
 * is allowed to ask in the first place.
 *
 * D-242, plus a second, older fault found while measuring it. Both are in
 * `20260904010000_bot_avatar.sql`, and neither has ever been met in use,
 * because the route that reaches this function (D-241) has never been
 * deployed.
 *
 * ── 1. Every refusal arrived as the same 500 ───────────────────────────────
 *
 * `bot_set_avatar_internal` was the only one of the bot management functions
 * raising bare `P0001`. `databaseError` in
 * `artifacts/api-server/src/bot/managementRoutes.ts` maps `22023`/`22P02` to
 * `validation_failed`, `42501` and `P0002` to `not_found` on an actor-scoped
 * route, `23505`/`55000` to `conflict`, and everything else to
 * `internal_error` — HTTP 500, for which the client has no sentence at all and
 * falls back to «Не удалось связаться с сервером».
 *
 * The five raises now carry the SQLSTATEs the other eighteen management
 * functions already use, so the gateway can tell them apart:
 *
 *   invalid_request  22023  -> validation_failed  400
 *   forbidden        42501  -> not_found          404  (see below)
 *   not_found        P0002  -> not_found          404
 *   bot_deleted      55000  -> conflict           409
 *   invalid_avatar   22023  -> validation_failed  400
 *
 * `42501` becomes `not_found` rather than `forbidden` because this route, like
 * every other `mutationRoute`, is actor-scoped: `mutationRoute` defaults to
 * `{ actorScoped: true }` and `/bots/:botId/avatar` passes no options, so
 * `databaseError` folds `42501` into `not_found` on purpose, refusing to tell
 * a stranger that a bot exists. This is not a mistake being copied: it is
 * exactly what `/bots/:botId/profile` does with the identical refusal today.
 * The alternative — a sentence saying «you are not the owner» — cannot be had
 * from the database side at all; it would need the route to opt out of actor
 * scoping, which is a gateway decision and not this migration's to make.
 *
 * Nothing else about the function changes. In particular the order of the
 * checks is left alone, although it differs from the family's (ownership
 * before existence, where `bot_update_profile_internal` does the reverse).
 * With `bot_owners_bot_id_fkey` being ON DELETE RESTRICT an owner row cannot
 * outlive its bot, so the `not_found` branch is unreachable through real data
 * — a bot that does not exist has no owner row and is refused as `forbidden`
 * one check earlier. It is given its SQLSTATE anyway, because the branch is
 * there and both answers map to the same 404.
 *
 * ── 2. The gateway could not call it at all ────────────────────────────────
 *
 * `20260904010000_bot_avatar.sql` ended with
 * `revoke all on function public.bot_set_avatar_internal(...) from public,
 * anon, authenticated` and granted EXECUTE to nobody. The function is owned by
 * `supabase_admin`, so `service_role` — the role the Bot Gateway's supabase-js
 * client resolves to through PostgREST — held EXECUTE only by inheritance from
 * PUBLIC, and the revoke took it away. Measured on production:
 *
 *   proacl                       {supabase_admin=X/supabase_admin}
 *   service_role EXECUTE         false   (true on every sibling function)
 *   postgres     EXECUTE         false
 *
 * This is the same mistake as the 2026-09-05 `_kub_bot_avatar_path_allowed`
 * repair, in the same migration, one function over. Without the grant,
 * deploying D-241 would replace one wrong sentence with another: the database
 * refuses the call with `42501 insufficient_privilege` before the function's
 * own checks run at all, and an actor-scoped route reports that as
 * «Бот не найден» to an owner looking straight at the bot.
 *
 * The grant is to `service_role` only — the minimum that makes the route work.
 * `anon`, `authenticated` and PUBLIC stay out, and the self-check refuses the
 * migration if any of them has crept back in.
 *
 * ── Rollback ───────────────────────────────────────────────────────────────
 *
 * `20260919030000_a_refusal_to_set_a_picture_says_why.rollback.sql` beside
 * this file restores the `P0001` body and revokes EXECUTE from `service_role`.
 * Run it only to return to the pre-2026-09-19 state; it puts the feature back
 * out of reach.
 */

begin;

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

commit;
