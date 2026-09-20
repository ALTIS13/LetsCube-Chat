/**
 * Rollback of `20260920120000_bot_full_visibility_request_removal.sql` (D-257).
 *
 * Restores the two columns, the CHECK, the foreign key, the five prior function
 * bodies and `bot_privacy_request_internal` with its grants — every one of them
 * the definition read off production before the forward migration ran, not a
 * transcription of the 2026-08-31 foundation file.
 *
 * **One thing does not come back and cannot.** The single live membership that
 * carried `full_visibility_requested_at` (a group, raised 2026-09-19 08:36 UTC)
 * loses that timestamp when the column is dropped. It survives as the
 * `bot_privacy_requested` row in `private.bot_audit_events`, which the forward
 * migration does not touch; if the state has to be reconstructed, that table
 * carries the `chat_id` in its `metadata` and this is the statement to run, as
 * a deliberate act and not as part of this rollback:
 *
 *   update public.chat_bot_members m
 *      set full_visibility_requested_at = e.created_at
 *     from private.bot_audit_events e
 *    where e.action = 'bot_privacy_requested'
 *      and e.bot_id = m.bot_id
 *      and m.chat_id = (e.metadata->>'chat_id')::uuid
 *      and m.removed_at is null;
 *
 * The CHECK is added back last and NOT VALID is deliberately **not** used: no
 * row can violate it, because the forward migration refused to run if any row
 * was `full` or carried an approver, and nothing since can have written either.
 * Validating it here is the proof of that.
 *
 * One transaction, with a self-check that raises rather than committing a
 * half-restored state.
 */

begin;

create temporary table _kub_d276_rollback_before on commit drop as
select (select count(*) from public.chat_bot_members) as membership_rows,
       (select count(*) from public.chat_bot_members where removed_at is null) as live_rows;

-- ── 1. The columns and the constraints ───────────────────────────────────
alter table public.chat_bot_members
  add column if not exists full_visibility_requested_at timestamptz null,
  add column if not exists full_visibility_approved_by uuid null;

alter table public.chat_bot_members
  drop constraint if exists chat_bot_members_full_visibility_approved_by_fkey;
alter table public.chat_bot_members
  add constraint chat_bot_members_full_visibility_approved_by_fkey
  foreign key (full_visibility_approved_by)
  references public.profiles(id) on delete set null;

alter table public.chat_bot_members
  drop constraint if exists chat_bot_members_visibility_approval_check;
alter table public.chat_bot_members
  add constraint chat_bot_members_visibility_approval_check check (
    privacy_mode = 'restricted'
    or (
      full_visibility_requested_at is not null
      and full_visibility_approved_by is not null
    )
  );

-- ── 2. The five function bodies as they stood before ─────────────────────
-- private.bot_can_receive_message: the definition read off production before the removal.
CREATE OR REPLACE FUNCTION private.bot_can_receive_message(p_bot_id uuid, p_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.messages message_row
    join public.chat_bot_members member_row
      on member_row.chat_id = message_row.chat_id
     and member_row.bot_id = p_bot_id
    join public.chats chat on chat.id = message_row.chat_id
    join public.bots receiver_bot on receiver_bot.id = p_bot_id
    where message_row.id = p_message_id
      and receiver_bot.state = 'active'
      and member_row.removed_at is null
      and message_row.created_at >= member_row.joined_at
      and (
        message_row.bot_id = p_bot_id
        or chat.type = 'private'
        or (
          member_row.privacy_mode = 'full'
          and member_row.full_visibility_approved_by is not null
        )
        or (
          member_row.privacy_mode = 'restricted'
          and (
            pg_catalog.lower(coalesce(message_row.content, '')) ~ (
              '^/[a-z][a-z0-9_]{0,31}@'
              || receiver_bot.username
              || '([[:space:]]|$)'
            )
            or pg_catalog.lower(coalesce(message_row.content, '')) ~ (
              '(^|[^a-z0-9_])@'
              || receiver_bot.username
              || '([^a-z0-9_]|$)'
            )
            or exists (
              select 1
              from public.messages replied_message
              where replied_message.id = message_row.reply_to_id
                and replied_message.chat_id = message_row.chat_id
                and replied_message.bot_id = p_bot_id
                and replied_message.created_at >= member_row.joined_at
            )
          )
        )
      )
  );
$function$;

-- public.bot_membership_authorize_internal: the definition read off production before the removal.
CREATE OR REPLACE FUNCTION public.bot_membership_authorize_internal(p_bot_id uuid, p_chat_id uuid, p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member record;
  v_allowed boolean := false;
begin
  if p_bot_id is null or p_chat_id is null
     or p_operation is null
     or p_operation not in ('send_message','receive_message','receive_all','read_file','manage') then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'invalid_request');
  end if;

  select member_row.*,
    chat.type as chat_type,
    bot.state as bot_state
  into v_member
  from public.chat_bot_members member_row
  join public.chats chat on chat.id = member_row.chat_id
  join public.bots bot on bot.id = member_row.bot_id
  where member_row.bot_id = p_bot_id
    and member_row.chat_id = p_chat_id
    and member_row.removed_at is null;

  if not found or v_member.bot_state <> 'active' then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'inactive_membership');
  end if;

  v_allowed := case
    when p_operation in ('send_message','read_file','manage') then true
    when v_member.chat_type = 'private' then true
    when p_operation = 'receive_all' then
      v_member.privacy_mode = 'full'
      and v_member.full_visibility_approved_by is not null
    else true
  end;

  return pg_catalog.jsonb_build_object(
    'allowed', v_allowed,
    'privacy_mode', v_member.privacy_mode,
    'joined_at', v_member.joined_at,
    'chat_type', v_member.chat_type
  );
end
$function$;

-- private.enqueue_bot_membership_update: the definition read off production before the removal.
CREATE OR REPLACE FUNCTION private.enqueue_bot_membership_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_action text;
  v_actor_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'added';
  elsif new.removed_at is not null and old.removed_at is null then
    v_action := 'removed';
  elsif old.removed_at is not null and new.removed_at is null then
    v_action := 'added';
  elsif old.removed_at is not null and new.removed_at is not null then
    return null;
  elsif new.privacy_mode is distinct from old.privacy_mode then
    v_action := 'privacy_changed';
  else
    return null;
  end if;
  if not exists (
    select 1
    from public.bots bot
    where bot.id = new.bot_id
      and bot.state = 'active'
  ) then
    return null;
  end if;
  v_actor_id := new.full_visibility_approved_by;
  begin
    perform public.bot_update_enqueue_internal(
      new.bot_id,
      'membership',
      new.chat_id,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'action', v_action,
        'actor_id', v_actor_id
      ))
    );
  exception
    when others then
      null;
  end;
  return null;
end
$function$;

-- public.bot_management_detail_internal: the definition read off production before the removal.
CREATE OR REPLACE FUNCTION public.bot_management_detail_internal(p_actor_id uuid, p_bot_id uuid)
 RETURNS TABLE(bot_id uuid, username text, display_name text, description text, avatar_url text, state text, delete_after timestamp with time zone, owner_role text, active_token_prefix text, token_created_at timestamp with time zone, token_last_used_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, commands jsonb, developers jsonb, privacy jsonb, webhook_configured boolean, webhook_url text, delivery_mode text, pending_update_count integer, failure_count integer, last_error_code text, diagnostics_refreshed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bot public.bots%rowtype;
  v_role text;
  v_token private.bot_tokens%rowtype;
  v_webhook private.bot_webhooks%rowtype;
  v_webhook_found boolean := false;
begin
  if p_actor_id is null or p_bot_id is null then
    raise exception 'bot_management_input_invalid' using errcode = '22023';
  end if;

  select bot.* into v_bot
  from public.bots bot
  where bot.id = p_bot_id;
  if not found then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;

  select owner_row.role into v_role
  from public.bot_owners owner_row
  where owner_row.bot_id = p_bot_id
    and owner_row.user_id = p_actor_id
    and owner_row.role in ('owner','developer');
  if not found then
    raise exception 'bot_management_forbidden' using errcode = '42501';
  end if;

  select stored_token.* into v_token
  from private.bot_tokens stored_token
  where stored_token.bot_id = p_bot_id
    and stored_token.revoked_at is null
  order by stored_token.created_at desc
  limit 1;

  select webhook.* into v_webhook
  from private.bot_webhooks webhook
  where webhook.bot_id = p_bot_id;
  v_webhook_found := found;

  return query select
    v_bot.id,
    v_bot.username,
    v_bot.display_name,
    v_bot.description,
    v_bot.avatar_url,
    v_bot.state,
    v_bot.delete_after,
    v_role,
    v_token.token_prefix,
    v_token.created_at,
    v_token.last_used_at,
    v_bot.created_at,
    v_bot.updated_at,
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'command', command_row.command,
          'description', command_row.description
        ) order by command_row.sort_order, command_row.command
      )
      from public.bot_commands command_row
      where command_row.bot_id = p_bot_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'user_id', owner_row.user_id,
          'display_name', coalesce(profile.full_name, 'Пользователь'),
          'username', profile.username,
          'created_at', owner_row.created_at
        ) order by owner_row.created_at, owner_row.user_id
      )
      from public.bot_owners owner_row
      join public.profiles profile on profile.id = owner_row.user_id
      where owner_row.bot_id = p_bot_id
        and owner_row.role = 'developer'
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'chat_id', bot_member.chat_id,
          'chat_name', coalesce(chat.name, 'Чат'),
          'privacy_mode', bot_member.privacy_mode,
          'full_visibility_requested_at', bot_member.full_visibility_requested_at,
          'full_visibility_approved', bot_member.full_visibility_approved_by is not null
        ) order by bot_member.joined_at, bot_member.chat_id
      )
      from public.chat_bot_members bot_member
      join public.chats chat on chat.id = bot_member.chat_id
      where bot_member.bot_id = p_bot_id
        and bot_member.removed_at is null
    ), '[]'::jsonb),
    v_webhook_found and v_webhook.state = 'enabled',
    case
      when v_webhook_found and v_webhook.state = 'enabled'
        then v_webhook.target_url
      else null
    end,
    case
      when v_webhook_found and v_webhook.state = 'enabled' then 'webhook'
      when exists (
        select 1 from private.bot_delivery_leases lease
        where lease.bot_id = p_bot_id
          and lease.delivery_mode = 'polling'
          and lease.expires_at > pg_catalog.now()
      ) then 'polling'
      else null
    end,
    (
      select least(pg_catalog.count(*), 1000000)::integer
      from (
        select 1
        from private.bot_updates queued
        where queued.bot_id = p_bot_id
          and queued.acknowledged_at is null
          and queued.expires_at > pg_catalog.now()
        limit 1000001
      ) bounded_pending
    ),
    case when v_webhook_found then v_webhook.failure_count else 0 end,
    case when v_webhook_found then v_webhook.last_error_code else null end,
    pg_catalog.now();
end
$function$;

-- public.chat_bot_add: the definition read off production before the removal.
CREATE OR REPLACE FUNCTION public.chat_bot_add(p_chat_id uuid, p_bot_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_state text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select c.type into v_type from public.chats as c where c.id = p_chat_id;
  if v_type is null then
    raise exception 'no_such_chat' using errcode = 'P0002';
  end if;
  if v_type <> 'group' then
    raise exception 'not_a_group' using errcode = '22023';
  end if;
  if not public.is_chat_admin(p_chat_id) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  select b.state into v_state from public.bots as b where b.id = p_bot_id;
  if v_state is null then
    raise exception 'no_such_bot' using errcode = 'P0002';
  end if;
  if v_state <> 'active' then
    -- `bot_membership_authorize_internal` would refuse every operation for a
    -- bot in any other state, so the row would be one that lies.
    raise exception 'bot_not_active' using errcode = '22023';
  end if;

  insert into public.chat_bot_members (chat_id, bot_id, privacy_mode, joined_at)
  values (p_chat_id, p_bot_id, 'restricted', pg_catalog.now())
  on conflict (chat_id, bot_id) do update
     set removed_at = null,
         joined_at = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.joined_at
           else excluded.joined_at
         end,
         privacy_mode = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.privacy_mode
           else 'restricted'
         end,
         full_visibility_requested_at = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.full_visibility_requested_at
           else null
         end,
         full_visibility_approved_by = case
           when public.chat_bot_members.removed_at is null
           then public.chat_bot_members.full_visibility_approved_by
           else null
         end,
         updated_at = pg_catalog.now();

  return true;
end;
$function$;

-- ── 3. The request function, with the grants it had ──────────────────────
create or replace function public.bot_privacy_request_internal(
  p_actor_id uuid,
  p_bot_id uuid,
  p_chat_id uuid,
  p_request_full_visibility boolean,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bot public.bots%rowtype;
  v_member public.chat_bot_members%rowtype;
begin
  if p_actor_id is null or p_bot_id is null or p_chat_id is null
     or p_request_full_visibility is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'bot_privacy_input_invalid' using errcode = '22023';
  end if;
  select bot.* into v_bot from public.bots bot
  where bot.id = p_bot_id for update of bot;
  if not found then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.bot_owners owner_row
    where owner_row.bot_id = p_bot_id
      and owner_row.user_id = p_actor_id
      and owner_row.role in ('owner','developer')
  ) then
    raise exception 'bot_management_forbidden' using errcode = '42501';
  end if;
  if v_bot.state not in ('active','paused') then
    raise exception 'bot_state_conflict' using errcode = '55000';
  end if;
  select bot_member.* into v_member
  from public.chat_bot_members bot_member
  where bot_member.bot_id = p_bot_id
    and bot_member.chat_id = p_chat_id
    and bot_member.removed_at is null
  for update of bot_member;
  if not found then
    raise exception 'bot_membership_not_found' using errcode = 'P0002';
  end if;
  if v_member.privacy_mode <> 'restricted' then
    raise exception 'bot_privacy_state_conflict' using errcode = '55000';
  end if;
  update public.chat_bot_members bot_member
  set full_visibility_requested_at = case
        when p_request_full_visibility then pg_catalog.now()
        else null
      end,
      updated_at = pg_catalog.now()
  where bot_member.bot_id = p_bot_id
    and bot_member.chat_id = p_chat_id;
  insert into private.bot_audit_events(bot_id, action, metadata)
  values (
    p_bot_id,
    case when p_request_full_visibility
      then 'bot_privacy_requested'
      else 'bot_privacy_cancelled'
    end,
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor_id,
      'request_id', p_request_id,
      'result', 'success',
      'chat_id', p_chat_id
    )
  );
  return pg_catalog.jsonb_build_object('success', true);
end
$function$;

revoke all on function public.bot_privacy_request_internal(uuid,uuid,uuid,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_privacy_request_internal(uuid,uuid,uuid,boolean,text)
  to service_role;

-- ── 4. The self-check ────────────────────────────────────────────────────
do $$
declare
  v_before record;
begin
  select * into v_before from _kub_d276_rollback_before;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_bot_members'
      and column_name = 'full_visibility_requested_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_bot_members'
      and column_name = 'full_visibility_approved_by'
  ) then
    raise exception 'd276 rollback: a column did not come back';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_bot_members'::regclass
      and conname = 'chat_bot_members_visibility_approval_check'
      and convalidated
  ) then
    raise exception 'd276 rollback: the approval CHECK is missing or unvalidated';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_bot_members'::regclass
      and conname = 'chat_bot_members_full_visibility_approved_by_fkey'
      and confrelid = 'public.profiles'::regclass
  ) then
    raise exception 'd276 rollback: the approver foreign key is missing';
  end if;

  -- The four readers are back, and so is the writer with service_role alone.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','private') and p.prokind = 'f'
         and pg_get_functiondef(p.oid) ilike '%full_visibility%') < 6 then
    raise exception 'd276 rollback: a function body did not come back';
  end if;
  if not has_function_privilege('service_role',
        'public.bot_privacy_request_internal(uuid,uuid,uuid,boolean,text)'::regprocedure, 'EXECUTE') then
    raise exception 'd276 rollback: service_role cannot execute the restored request';
  end if;
  if has_function_privilege('authenticated',
        'public.bot_privacy_request_internal(uuid,uuid,uuid,boolean,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon',
        'public.bot_privacy_request_internal(uuid,uuid,uuid,boolean,text)'::regprocedure, 'EXECUTE') then
    raise exception 'd276 rollback: a client role may execute the restored request';
  end if;

  if (select count(*) from public.chat_bot_members) <> v_before.membership_rows
     or (select count(*) from public.chat_bot_members where removed_at is null)
        <> v_before.live_rows then
    raise exception 'd276 rollback: the membership row count moved';
  end if;

  raise notice 'd276 rollback: restored - % membership rows untouched; the one request timestamp is in private.bot_audit_events',
    v_before.membership_rows;
end
$$;

commit;
