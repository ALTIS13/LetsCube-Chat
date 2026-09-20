/**
 * Remove the full-visibility request, which nothing could ever answer (D-257).
 *
 * ── What was measured, read-only, on production 2026-09-20 ───────────────
 *
 * `chat_bot_members.full_visibility_approved_by` was read in four function
 * bodies and **written by nothing**: no action in the client, no route in the
 * API server, no approver anywhere. `bot_privacy_request_internal` — the one
 * writer of `full_visibility_requested_at` — never touched it, and
 * `chat_bot_members_visibility_approval_check` refuses `privacy_mode = 'full'`
 * without it. So `full` was structurally unreachable, «Запрошен полный доступ»
 * was a permanent state that read as a pending one, and the bot's owner was
 * left believing an administrator was about to act.
 *
 * Live state at that moment: 2 membership rows, both live, both `restricted`,
 * **1 of them carrying `full_visibility_requested_at`** (a group, raised
 * 2026-09-19 08:36 UTC), 0 rows ever approved. That one request is being
 * discarded rather than answered. It is not lost: `private.bot_audit_events`
 * holds its `bot_privacy_requested` row and this migration does not touch that
 * table.
 *
 * ── The decision ─────────────────────────────────────────────────────────
 *
 * The owner chose Telegram's model: a bot's privacy mode is the **bot owner's**
 * setting and the group's consent is the act of adding the bot — «Privacy mode
 * is enabled by default for all bots», set by the developer through BotFather,
 * with nothing to approve afterwards (core.telegram.org/bots/features#privacy-mode).
 * So the request goes, and `privacy_mode` alone becomes the state.
 *
 * ── What this does, and the one thing it deliberately does not ───────────
 *
 * Five function bodies are replaced with themselves minus the approval
 * conjunct, generated as a textual delta of `pg_get_functiondef` read off this
 * database rather than transcribed. Then the CHECK, the foreign key and the two
 * columns go, and `bot_privacy_request_internal` with them.
 *
 * **No writer of `privacy_mode` is added.** `chat_bot_add` still hard-codes
 * `'restricted'` on a join and on a re-add, and nothing else in `public` or
 * `private` assigns the column, so `full` stays unreachable after this — by the
 * absence of a write path and of any INSERT/UPDATE grant to `authenticated`,
 * where before it was by a CHECK constraint. The self-check pins both, because
 * that swap is the only way this migration could widen anything. The owner's
 * own privacy switch is a separate change and needs that write path designed.
 *
 * Behaviour is otherwise unchanged by construction: every removed conjunct was
 * `… and full_visibility_approved_by is not null` beside `privacy_mode = 'full'`,
 * a combination no row has ever been in, and the trigger's `actor_id` was
 * always null and always dropped by `jsonb_strip_nulls`.
 *
 * ── Rollback ─────────────────────────────────────────────────────────────
 *
 * `20260920120000_bot_full_visibility_request_removal.rollback.sql` restores
 * the columns, the constraints, the five prior function bodies and
 * `bot_privacy_request_internal` with its grants. The one row's
 * `full_visibility_requested_at` timestamp cannot be restored from the column;
 * it is in `private.bot_audit_events` and the rollback says where.
 *
 * One transaction, and the self-check raises rather than committing a
 * half-applied state. Every assertion in it is structural — catalogue shape and
 * grants — because this deployment is invite-only and `handle_new_user` raises,
 * so a migration that seeded an account to test itself could not run here.
 */

begin;

-- ── 0. What must not change, captured before anything does ───────────────
create temporary table _kub_d276_before on commit drop as
select
  (select count(*) from public.chat_bot_members) as membership_rows,
  (select count(*) from public.chat_bot_members where removed_at is null) as live_rows,
  (select count(*) from public.chat_bot_members where privacy_mode = 'full') as full_rows,
  (select count(*) from private.bot_audit_events
     where action in ('bot_privacy_requested','bot_privacy_cancelled')) as audit_rows,
  (select array_agg(p.oid::regprocedure::text || ' => ' || coalesce(array_to_string(p.proacl, ','), '(default)') order by p.oid::regprocedure::text)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
            ('private','bot_can_receive_message'),
            ('private','enqueue_bot_membership_update'),
            ('public','bot_management_detail_internal'),
            ('public','bot_membership_authorize_internal'),
            ('public','chat_bot_add'))) as acls;

-- A `full` row today would mean an approver existed after all, and the whole
-- premise of this change would be wrong. Refuse rather than guess.
do $$
begin
  if (select full_rows from _kub_d276_before) <> 0 then
    raise exception 'd276_precondition: % membership rows are already privacy_mode=full',
      (select full_rows from _kub_d276_before);
  end if;
  if (select count(*) from public.chat_bot_members where full_visibility_approved_by is not null) <> 0 then
    raise exception 'd276_precondition: a membership carries an approver, which nothing can write';
  end if;
end
$$;

-- ── 1. The five function bodies, minus the approval conjunct ─────────────
-- `create or replace` keeps each function's owner and ACL; step 4 proves it.

-- private.bot_can_receive_message: the same function, with the approval conjunct removed.
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
        or member_row.privacy_mode = 'full'
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

-- public.bot_membership_authorize_internal: the same function, with the approval conjunct removed.
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

-- private.enqueue_bot_membership_update: the same function, with the approval conjunct removed.
CREATE OR REPLACE FUNCTION private.enqueue_bot_membership_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_action text;
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
  begin
    perform public.bot_update_enqueue_internal(
      new.bot_id,
      'membership',
      new.chat_id,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'action', v_action
      ))
    );
  exception
    when others then
      null;
  end;
  return null;
end
$function$;

-- public.bot_management_detail_internal: the same function, with the approval conjunct removed.
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
          'privacy_mode', bot_member.privacy_mode
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

-- public.chat_bot_add: the same function, with the approval conjunct removed.
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
         updated_at = pg_catalog.now();

  return true;
end;
$function$;

-- ── 2. The request itself ────────────────────────────────────────────────
-- Granted to `service_role` alone, and with the API route removed nothing
-- calls it. Left in place it would be the one remaining way to write a column
-- that no longer exists.
drop function if exists public.bot_privacy_request_internal(uuid, uuid, uuid, boolean, text);

-- ── 3. The constraints and the columns ───────────────────────────────────
-- The CHECK is named rather than left to fall with the columns, because it is
-- the guard being deliberately retired: it is what made `full` impossible, and
-- step 4 proves what replaces it.
alter table public.chat_bot_members
  drop constraint if exists chat_bot_members_visibility_approval_check;
alter table public.chat_bot_members
  drop constraint if exists chat_bot_members_full_visibility_approved_by_fkey;
alter table public.chat_bot_members
  drop column if exists full_visibility_requested_at,
  drop column if exists full_visibility_approved_by;

-- ── 4. The self-check ────────────────────────────────────────────────────
do $$
declare
  v_before record;
  v_bad text;
begin
  select * into v_before from _kub_d276_before;

  -- (a) the columns are gone, and `privacy_mode` is not
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_bot_members'
      and column_name in ('full_visibility_requested_at','full_visibility_approved_by')
  ) then
    raise exception 'd276: a full_visibility column survived';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_bot_members'
      and column_name = 'privacy_mode' and column_default = '''restricted''::text'
  ) then
    raise exception 'd276: privacy_mode is gone or no longer defaults to restricted';
  end if;

  -- (b) the retired CHECK is gone and the value CHECK is not
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_bot_members'::regclass
      and conname = 'chat_bot_members_visibility_approval_check'
  ) then
    raise exception 'd276: the approval CHECK survived';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_bot_members'::regclass
      and conname = 'chat_bot_members_privacy_mode_check'
      and pg_get_constraintdef(oid) like '%restricted%'
      and pg_get_constraintdef(oid) like '%full%'
  ) then
    raise exception 'd276: privacy_mode no longer has its value CHECK';
  end if;

  -- (c) the request function is gone
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bot_privacy_request_internal'
  ) then
    raise exception 'd276: bot_privacy_request_internal survived';
  end if;

  -- (d) nothing anywhere still reads the columns
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ilike '%full_visibility%';
  if v_bad is not null then
    raise exception 'd276: % still mention full_visibility', v_bad;
  end if;
  if exists (
    select 1 from pg_views
    where schemaname in ('public','private') and definition ilike '%full_visibility%'
  ) then
    raise exception 'd276: a view still mentions full_visibility';
  end if;

  -- (e) the rewrite removed a conjunct and nothing else: both gates still
  --     require `privacy_mode = 'full'`, and the narrow branch still exists
  if pg_get_functiondef('private.bot_can_receive_message(uuid,uuid)'::regprocedure)
       not like '%privacy_mode = ''full''%'
     or pg_get_functiondef('private.bot_can_receive_message(uuid,uuid)'::regprocedure)
       not like '%privacy_mode = ''restricted''%' then
    raise exception 'd276: bot_can_receive_message lost a privacy branch';
  end if;
  if pg_get_functiondef('public.bot_membership_authorize_internal(uuid,uuid,text)'::regprocedure)
       not like '%privacy_mode = ''full''%' then
    raise exception 'd276: receive_all no longer requires privacy_mode=full';
  end if;

  -- (f) THE GUARD THAT REPLACES THE DROPPED CHECK.
  --     `full` was unreachable because the CHECK demanded an approver nothing
  --     could write. It must now be unreachable because nothing writes the
  --     column and no client may write the table. Both halves, or this
  --     migration has widened what a bot can read.
  --     Measured by who WRITES the table, not by who mentions the value: a
  --     first draft of this check looked for `privacy_mode = 'full'` in any
  --     body and matched the two gates that only *compare* it, which is the
  --     whole reason this file was rehearsed rather than trusted.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~* '(insert[[:space:]]+into|update)[[:space:]]+public\.chat_bot_members';
  if v_bad is distinct from 'public.chat_bot_add, public.chat_bot_remove, public.open_or_create_bot_chat' then
    raise exception 'd276: the writers of chat_bot_members are now «%»', coalesce(v_bad, '(none)');
  end if;
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~* '(insert[[:space:]]+into|update)[[:space:]]+public\.chat_bot_members'
    and pg_get_functiondef(p.oid) like '%''full''%';
  if v_bad is not null then
    raise exception 'd276: % writes chat_bot_members and names the value full', v_bad;
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'chat_bot_members'
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'd276: a client role may now write chat_bot_members directly';
  end if;
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'chat_bot_members'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'd276: authenticated lost the read the member list is drawn from';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.chat_bot_members'::regclass) then
    raise exception 'd276: RLS is no longer enabled on chat_bot_members';
  end if;

  -- (g) the trigger still fires on the same two columns
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.chat_bot_members'::regclass
      and tgname = 'trg_enqueue_bot_membership_updates'
      and pg_get_triggerdef(oid) like '%UPDATE OF privacy_mode, removed_at%'
  ) then
    raise exception 'd276: the membership update trigger changed shape';
  end if;

  -- (h) no row was touched, and the audit history is intact
  if (select count(*) from public.chat_bot_members) <> v_before.membership_rows
     or (select count(*) from public.chat_bot_members where removed_at is null)
        <> v_before.live_rows then
    raise exception 'd276: the membership row count moved';
  end if;
  if (select count(*) from private.bot_audit_events
        where action in ('bot_privacy_requested','bot_privacy_cancelled'))
     <> v_before.audit_rows then
    raise exception 'd276: the privacy audit history moved';
  end if;

  -- (i) `create or replace` kept every owner and ACL
  if (select array_agg(p.oid::regprocedure::text || ' => '
                       || coalesce(array_to_string(p.proacl, ','), '(default)')
                       order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname, p.proname) in (
               ('private','bot_can_receive_message'),
               ('private','enqueue_bot_membership_update'),
               ('public','bot_management_detail_internal'),
               ('public','bot_membership_authorize_internal'),
               ('public','chat_bot_add'))) is distinct from v_before.acls then
    raise exception 'd276: a replaced function changed its grants';
  end if;

  raise notice 'd276: applied - % membership rows untouched, % audit rows kept',
    v_before.membership_rows, v_before.audit_rows;
end
$$;

commit;
