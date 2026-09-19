/**
 * Rollback for `20260919030000_a_refusal_to_set_a_picture_says_why.sql`.
 *
 * It restores the state of 2026-09-04: the five refusals raise bare `P0001`
 * again and `service_role` loses EXECUTE, which together put the bot-avatar
 * feature back out of reach — every refusal a 500, and every call, refusal or
 * not, denied before the function's own checks run.
 *
 * Only run this to undo the migration deliberately. Run it as `supabase_admin`:
 * `postgres` does not own this function and cannot replace it.
 *
 *   ssh -i ~/.ssh/letscube_ed25519 root@ms.letscube.ru
 *     'docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres'
 *     < 20260919030000_a_refusal_to_set_a_picture_says_why.rollback.sql
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
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.bot_owners owner
    where owner.bot_id = p_bot_id
      and owner.user_id = p_actor_id
      and owner.role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select bot.state into v_state from public.bots bot where bot.id = p_bot_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_state in ('pending_delete', 'deleted') then
    raise exception 'bot_deleted' using errcode = 'P0001';
  end if;

  -- A picture must be this bot's own file. Without this an owner could point
  -- one of their bots at another bot's avatar, which is a small thing that
  -- would read as impersonation in a chat.
  if v_url is not null
     and v_url not like ('https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/' || p_bot_id::text || '/%') then
    raise exception 'invalid_avatar' using errcode = 'P0001';
  end if;

  update public.bots
  set avatar_url = v_url, updated_at = pg_catalog.now()
  where id = p_bot_id;

  return pg_catalog.jsonb_build_object('ok', true, 'avatar_url', v_url);
end
$function$;

revoke execute on function public.bot_set_avatar_internal(uuid, uuid, text, text) from service_role;

do $check$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bot_set_avatar_internal';
  if v_def is null then
    raise exception 'bot_set_avatar_internal is gone';
  end if;
  if (select count(*) from regexp_matches(v_def, 'P0001', 'g')) <> 5 then
    raise exception 'the five refusals do not all raise P0001 again';
  end if;
  if has_function_privilege('service_role', 'public.bot_set_avatar_internal(uuid, uuid, text, text)', 'execute') then
    raise exception 'service_role can still execute it';
  end if;
  if pg_get_userbyid((select proowner from pg_proc p
                        join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'bot_set_avatar_internal')) <> 'supabase_admin' then
    raise exception 'owner changed';
  end if;
end;
$check$;

commit;
