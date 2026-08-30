-- LETSCUBE Bot Platform foundation proposal.
-- Proposal only: rehearse transactionally and apply only after a verified backup.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  username text not null unique
    check (username ~ '^[a-z][a-z0-9_]{4,31}$'),
  display_name text not null
    check (pg_catalog.length(pg_catalog.btrim(display_name)) between 2 and 64),
  description text not null default ''
    check (pg_catalog.length(description) <= 512),
  avatar_url text null
    check (avatar_url is null or pg_catalog.octet_length(avatar_url) <= 2048),
  state text not null default 'active'
    check (state in ('active','paused','suspended','pending_delete','deleted')),
  delete_after timestamptz null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint bots_delete_state_check check (
    (state = 'pending_delete' and delete_after is not null)
    or (state <> 'pending_delete')
  )
);

create table public.bot_owners (
  bot_id uuid not null references public.bots(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','developer')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (bot_id, user_id)
);

create table public.bot_commands (
  bot_id uuid not null references public.bots(id) on delete restrict,
  command text not null check (command ~ '^[a-z][a-z0-9_]{0,31}$'),
  description text not null
    check (pg_catalog.length(pg_catalog.btrim(description)) between 1 and 256),
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (bot_id, command)
);

create table public.chat_bot_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete restrict,
  privacy_mode text not null default 'restricted'
    check (privacy_mode in ('restricted','full')),
  full_visibility_requested_at timestamptz null,
  full_visibility_approved_by uuid null
    references public.profiles(id) on delete set null,
  joined_at timestamptz not null default pg_catalog.now(),
  removed_at timestamptz null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (chat_id, bot_id),
  constraint chat_bot_members_visibility_approval_check check (
    privacy_mode = 'restricted'
    or (
      full_visibility_requested_at is not null
      and full_visibility_approved_by is not null
    )
  ),
  constraint chat_bot_members_removed_after_join_check check (
    removed_at is null or removed_at >= joined_at
  )
);

create index bot_owners_user_idx on public.bot_owners(user_id, bot_id);
create index bot_commands_bot_order_idx
  on public.bot_commands(bot_id, sort_order, command);
create index chat_bot_members_bot_active_idx
  on public.chat_bot_members(bot_id, chat_id)
  where removed_at is null;

create table private.bot_tokens (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete restrict,
  token_prefix text not null
    check (token_prefix ~ '^[A-Za-z0-9_-]{8,24}$'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  constraint bot_tokens_last_used_check check (
    last_used_at is null or last_used_at >= created_at
  ),
  constraint bot_tokens_revoked_check check (
    revoked_at is null or revoked_at >= created_at
  )
);

create unique index bot_tokens_active_prefix_idx
  on private.bot_tokens(token_prefix)
  where revoked_at is null;
create index bot_tokens_bot_active_idx
  on private.bot_tokens(bot_id, created_at desc)
  where revoked_at is null;

create table private.bot_update_counters (
  bot_id uuid primary key references public.bots(id) on delete restrict,
  next_update_id bigint not null check (next_update_id > 0)
);

create table private.bot_updates (
  id bigint generated always as identity primary key,
  bot_id uuid not null references public.bots(id) on delete restrict,
  update_id bigint not null check (update_id > 0),
  update_type text not null
    check (update_type in ('message','edited_message','callback_query','membership')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  available_at timestamptz not null default pg_catalog.now(),
  acknowledged_at timestamptz null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '24 hours'),
  constraint bot_updates_payload_size_check
    check (pg_catalog.octet_length(payload::text) <= 65536),
  constraint bot_updates_expiry_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '24 hours'
  ),
  unique (bot_id, update_id)
);

create index bot_updates_due_idx
  on private.bot_updates(bot_id, available_at, update_id)
  where acknowledged_at is null;
create index bot_updates_retention_idx
  on private.bot_updates(expires_at, id);

create table private.bot_webhooks (
  bot_id uuid primary key references public.bots(id) on delete restrict,
  target_url text not null
    check (pg_catalog.octet_length(target_url) between 10 and 2048),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'enabled'
    check (state in ('enabled','paused','disabled')),
  failure_count integer not null default 0 check (failure_count between 0 and 20),
  last_error_code text null
    check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table private.bot_delivery_attempts (
  id bigint generated always as identity primary key,
  bot_id uuid not null,
  update_id bigint not null,
  payload jsonb null default null check (payload is null),
  status text not null default 'pending'
    check (status in ('pending','claimed','retry','succeeded','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 12),
  available_at timestamptz not null default pg_catalog.now(),
  claim_token uuid null,
  claimed_at timestamptz null,
  http_status integer null check (http_status between 100 and 599),
  error_code text null
    check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz null,
  unique (bot_id, update_id)
);

create index bot_delivery_attempts_due_idx
  on private.bot_delivery_attempts(available_at, id)
  where status in ('pending','retry');
create index bot_delivery_attempts_retention_idx
  on private.bot_delivery_attempts(coalesce(completed_at, updated_at), id);

create table private.bot_rate_limit_buckets (
  bot_id uuid not null references public.bots(id) on delete restrict,
  scope_kind text not null
    check (scope_kind in ('token','method','chat','recipient')),
  scope_key text not null
    check (pg_catalog.octet_length(scope_key) between 1 and 256),
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count between 0 and 100000),
  expires_at timestamptz not null,
  primary key (bot_id, scope_kind, scope_key, bucket_start),
  constraint bot_rate_limit_expiry_check check (expires_at > bucket_start)
);

create index bot_rate_limit_retention_idx
  on private.bot_rate_limit_buckets(expires_at);

create table private.bot_message_idempotency (
  bot_id uuid not null references public.bots(id) on delete restrict,
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  method text not null
    check (method in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice')),
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (bot_id, idempotency_key)
);

create index bot_message_idempotency_retention_idx
  on private.bot_message_idempotency(created_at, bot_id);

create table private.bot_delivery_leases (
  bot_id uuid primary key references public.bots(id) on delete restrict,
  delivery_mode text not null check (delivery_mode in ('polling','webhook')),
  lease_token uuid not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.now()
);

revoke all on table private.bot_tokens from public, anon, authenticated, service_role;
revoke all on table private.bot_update_counters from public, anon, authenticated, service_role;
revoke all on table private.bot_updates from public, anon, authenticated, service_role;
revoke all on table private.bot_webhooks from public, anon, authenticated, service_role;
revoke all on table private.bot_delivery_attempts from public, anon, authenticated, service_role;
revoke all on table private.bot_rate_limit_buckets from public, anon, authenticated, service_role;
revoke all on table private.bot_message_idempotency from public, anon, authenticated, service_role;
revoke all on table private.bot_delivery_leases from public, anon, authenticated, service_role;

alter table private.bot_tokens enable row level security;
alter table private.bot_update_counters enable row level security;
alter table private.bot_updates enable row level security;
alter table private.bot_webhooks enable row level security;
alter table private.bot_delivery_attempts enable row level security;
alter table private.bot_rate_limit_buckets enable row level security;
alter table private.bot_message_idempotency enable row level security;
alter table private.bot_delivery_leases enable row level security;

revoke all on table public.bots from public, anon, authenticated, service_role;
revoke all on table public.bot_owners from public, anon, authenticated, service_role;
revoke all on table public.bot_commands from public, anon, authenticated, service_role;
revoke all on table public.chat_bot_members from public, anon, authenticated, service_role;

grant select on table public.bots to authenticated;
grant select on table public.bot_owners to authenticated;
grant select on table public.bot_commands to authenticated;
grant select on table public.chat_bot_members to authenticated;

alter table public.bots enable row level security;
alter table public.bot_owners enable row level security;
alter table public.bot_commands enable row level security;
alter table public.chat_bot_members enable row level security;

create policy "authenticated users read bot identities"
  on public.bots for select
  to authenticated
  using (true);

create policy "bot owners read own ownership"
  on public.bot_owners for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "members and owners read bot commands"
  on public.bot_commands for select
  to authenticated
  using (
    exists (
      select 1
      from public.bot_owners owner_row
      where owner_row.bot_id = bot_commands.bot_id
        and owner_row.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.chat_bot_members bot_member
      join public.chat_members human_member
        on human_member.chat_id = bot_member.chat_id
      where bot_member.bot_id = bot_commands.bot_id
        and bot_member.removed_at is null
        and human_member.user_id = (select auth.uid())
        and human_member.hidden_at is null
    )
  );

create policy "chat members and owners read bot membership"
  on public.chat_bot_members for select
  to authenticated
  using (
    exists (
      select 1
      from public.chat_members human_member
      where human_member.chat_id = chat_bot_members.chat_id
        and human_member.user_id = (select auth.uid())
        and human_member.hidden_at is null
    )
    or exists (
      select 1
      from public.bot_owners owner_row
      where owner_row.bot_id = chat_bot_members.bot_id
        and owner_row.user_id = (select auth.uid())
    )
  );

alter table public.messages
  add column if not exists bot_id uuid null
    references public.bots(id) on delete restrict;

alter table public.messages
  drop constraint if exists messages_sender_shape_check;
alter table public.messages
  add constraint messages_sender_shape_check check (
    (type = 'system' and user_id is null and bot_id is null)
    or (
      coalesce(type, 'text') <> 'system'
      and not (user_id is not null and bot_id is not null)
    )
  ) not valid;
alter table public.messages validate constraint messages_sender_shape_check;

create index if not exists messages_bot_created_idx
  on public.messages(bot_id, created_at desc)
  where bot_id is not null;

comment on constraint messages_sender_shape_check on public.messages is
  'Preserves legacy tombstone rows created by profiles ON DELETE SET NULL, forbids dual senders, and requires system rows to be sender-less.';

create or replace function private.enforce_message_sender_on_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $function$
begin
  if coalesce(new.type, 'text') = 'system' then
    if new.user_id is not null or new.bot_id is not null then
      raise exception 'message_system_sender_forbidden' using errcode = '23514';
    end if;
  elsif (new.user_id is null) = (new.bot_id is null) then
    raise exception 'message_sender_required' using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function private.enforce_message_sender_on_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_messages_sender_on_insert on public.messages;
create trigger trg_messages_sender_on_insert
  before insert on public.messages
  for each row execute function private.enforce_message_sender_on_insert();

create or replace function private.enforce_message_sender_on_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $function$
begin
  if new.bot_id is distinct from old.bot_id
     or new.type is distinct from old.type then
    raise exception 'message_sender_immutable' using errcode = '23514';
  end if;

  if new.user_id is distinct from old.user_id then
    -- The profiles FK is ON DELETE SET NULL. PostgreSQL invokes this child-row
    -- update from its RI trigger, preserving the historical message as a
    -- legacy tombstone. Direct client sender rewrites remain forbidden.
    if not (
      old.user_id is not null
      and new.user_id is null
      and new.bot_id is null
      and pg_catalog.pg_trigger_depth() > 1
    ) then
      raise exception 'message_sender_immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function private.enforce_message_sender_on_update()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_messages_sender_on_update on public.messages;
create trigger trg_messages_sender_on_update
  before update of user_id, bot_id, type on public.messages
  for each row execute function private.enforce_message_sender_on_update();

drop policy if exists "Chat members can send messages" on public.messages;
create policy "Chat members can send messages"
  on public.messages for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and bot_id is null
    and public.is_chat_member(chat_id)
  );

create or replace function public.bot_create_internal(
  p_actor_id uuid,
  p_username text,
  p_display_name text,
  p_description text,
  p_token_prefix text,
  p_token_hash text
)
returns table(
  bot_id uuid,
  username text,
  display_name text,
  state text,
  token_id uuid,
  token_prefix text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_bot public.bots%rowtype;
  v_token private.bot_tokens%rowtype;
  v_username text := pg_catalog.lower(pg_catalog.btrim(p_username));
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_description text := coalesce(p_description, '');
begin
  if p_actor_id is null
     or not exists (select 1 from public.profiles p where p.id = p_actor_id) then
    raise exception 'bot_actor_invalid' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z][a-z0-9_]{4,31}$'
     or pg_catalog.length(v_display_name) not between 2 and 64
     or pg_catalog.length(v_description) > 512
     or p_token_prefix !~ '^[A-Za-z0-9_-]{8,24}$'
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_input_invalid' using errcode = '22023';
  end if;

  if not exists (
       select 1
       from auth.users u
       join public.profile_contacts contact on contact.user_id = u.id
       where u.id = p_actor_id
         and u.email_confirmed_at is not null
         and contact.phone_verified is true
         and contact.phone_verified_at is not null
         and u.created_at <= pg_catalog.now() - interval '24 hours'
     )
     or exists (
       select 1
       from public.bans ban
       where ban.user_id = p_actor_id
         and (ban.expires_at is null or ban.expires_at > pg_catalog.now())
     ) then
    raise exception 'bot_creation_not_allowed' using errcode = '42501';
  end if;

  if (
    select pg_catalog.count(*)
    from public.bot_owners owner_row
    join public.bots owned_bot on owned_bot.id = owner_row.bot_id
    where owner_row.user_id = p_actor_id
      and owner_row.role = 'owner'
      and owned_bot.state <> 'deleted'
  ) >= 3 then
    raise exception 'bot_creation_not_allowed' using errcode = '42501';
  end if;

  insert into public.bots(username, display_name, description)
  values (v_username, v_display_name, v_description)
  returning * into v_bot;

  insert into public.bot_owners(bot_id, user_id, role)
  values (v_bot.id, p_actor_id, 'owner');

  insert into private.bot_tokens(bot_id, token_prefix, token_hash)
  values (v_bot.id, p_token_prefix, p_token_hash)
  returning * into v_token;

  return query select
    v_bot.id,
    v_bot.username,
    v_bot.display_name,
    v_bot.state,
    v_token.id,
    v_token.token_prefix,
    v_bot.created_at;
exception
  when unique_violation then
    raise exception 'bot_identifier_conflict' using errcode = '23505';
end
$function$;

revoke all on function public.bot_create_internal(uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_create_internal(uuid,text,text,text,text,text)
  to service_role;

create or replace function public.bot_list_owned_internal(
  p_actor_id uuid
)
returns table(
  bot_id uuid,
  username text,
  display_name text,
  description text,
  avatar_url text,
  state text,
  delete_after timestamptz,
  owner_role text,
  active_token_prefix text,
  token_created_at timestamptz,
  token_last_used_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
  select
    bot.id,
    bot.username,
    bot.display_name,
    bot.description,
    bot.avatar_url,
    bot.state,
    bot.delete_after,
    owner_row.role,
    token.token_prefix,
    token.created_at,
    token.last_used_at,
    bot.created_at,
    bot.updated_at
  from public.bot_owners owner_row
  join public.bots bot on bot.id = owner_row.bot_id
  left join lateral (
    select stored_token.token_prefix,
      stored_token.created_at,
      stored_token.last_used_at
    from private.bot_tokens stored_token
    where stored_token.bot_id = bot.id
      and stored_token.revoked_at is null
    order by stored_token.created_at desc
    limit 1
  ) token on true
  where p_actor_id is not null
    and owner_row.user_id = p_actor_id
  order by bot.created_at desc, bot.id;
$function$;

revoke all on function public.bot_list_owned_internal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_list_owned_internal(uuid)
  to service_role;

create or replace function public.bot_rotate_token_internal(
  p_actor_id uuid,
  p_bot_id uuid,
  p_token_prefix text,
  p_token_hash text
)
returns table(token_id uuid, token_prefix text, created_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_token private.bot_tokens%rowtype;
begin
  if p_actor_id is null or p_bot_id is null
     or p_token_prefix !~ '^[A-Za-z0-9_-]{8,24}$'
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_token_input_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.bot_owners owner_row
    join public.bots bot on bot.id = owner_row.bot_id
    where owner_row.bot_id = p_bot_id
      and owner_row.user_id = p_actor_id
      and owner_row.role = 'owner'
      and bot.state not in ('pending_delete','deleted')
  ) then
    raise exception 'bot_owner_required' using errcode = '42501';
  end if;

  update private.bot_tokens stored_token
  set revoked_at = pg_catalog.now()
  where stored_token.bot_id = p_bot_id
    and stored_token.revoked_at is null;

  insert into private.bot_tokens(bot_id, token_prefix, token_hash)
  values (p_bot_id, p_token_prefix, p_token_hash)
  returning * into v_token;

  return query select v_token.id, v_token.token_prefix, v_token.created_at;
exception
  when unique_violation then
    raise exception 'bot_token_conflict' using errcode = '23505';
end
$function$;

revoke all on function public.bot_rotate_token_internal(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_rotate_token_internal(uuid,uuid,text,text)
  to service_role;

create or replace function public.bot_token_lookup_internal(
  p_token_prefix text
)
returns table(
  token_id uuid,
  bot_id uuid,
  token_hash text,
  token_created_at timestamptz,
  token_last_used_at timestamptz,
  bot_state text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
  select
    stored_token.id,
    stored_token.bot_id,
    stored_token.token_hash,
    stored_token.created_at,
    stored_token.last_used_at,
    bot.state
  from private.bot_tokens stored_token
  join public.bots bot on bot.id = stored_token.bot_id
  where p_token_prefix ~ '^[A-Za-z0-9_-]{8,24}$'
    and stored_token.token_prefix = p_token_prefix
    and stored_token.revoked_at is null
  limit 1;
$function$;

revoke all on function public.bot_token_lookup_internal(text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_token_lookup_internal(text)
  to service_role;

create or replace function public.bot_token_touch_internal(
  p_token_id uuid,
  p_used_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if p_token_id is null or p_used_at is null
     or p_used_at > pg_catalog.now() + interval '1 minute'
     or p_used_at < pg_catalog.now() - interval '10 minutes' then
    return false;
  end if;

  update private.bot_tokens stored_token
  set last_used_at = greatest(coalesce(stored_token.last_used_at, stored_token.created_at), p_used_at)
  where stored_token.id = p_token_id
    and stored_token.revoked_at is null
    and (
      stored_token.last_used_at is null
      or stored_token.last_used_at <= p_used_at - interval '5 minutes'
    );
  return found;
end
$function$;

revoke all on function public.bot_token_touch_internal(uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_token_touch_internal(uuid,timestamptz)
  to service_role;

create or replace function public.bot_membership_authorize_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_operation text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_member record;
  v_allowed boolean := false;
begin
  if p_bot_id is null or p_chat_id is null
     or p_operation not in ('send_message','receive_message','receive_all','read_file','manage') then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_request');
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
    return jsonb_build_object('allowed', false, 'reason', 'inactive_membership');
  end if;

  v_allowed := case
    when p_operation in ('send_message','read_file','manage') then true
    when v_member.chat_type = 'private' then true
    when p_operation = 'receive_all' then
      v_member.privacy_mode = 'full'
      and v_member.full_visibility_approved_by is not null
    else true
  end;

  return jsonb_build_object(
    'allowed', v_allowed,
    'privacy_mode', v_member.privacy_mode,
    'joined_at', v_member.joined_at,
    'chat_type', v_member.chat_type
  );
end
$function$;

revoke all on function public.bot_membership_authorize_internal(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_membership_authorize_internal(uuid,uuid,text)
  to service_role;

create or replace function public.bot_send_message_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_method text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_existing_message_id uuid;
  v_message_id uuid;
  v_message_type text;
  v_content text;
  v_media_bucket text;
  v_media_path text;
  v_media_metadata jsonb;
  v_topic_id uuid;
  v_reply_to_id uuid;
begin
  if p_bot_id is null or p_chat_id is null
     or p_method not in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice')
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536 then
    raise exception 'bot_message_input_invalid' using errcode = '22023';
  end if;

  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'send_message'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)
  );

  select idem.message_id
  into v_existing_message_id
  from private.bot_message_idempotency idem
  where idem.bot_id = p_bot_id
    and idem.idempotency_key = p_idempotency_key
    and idem.method = p_method;

  if found then
    return (
      select jsonb_build_object(
        'message_id', message_row.id,
        'chat_id', message_row.chat_id,
        'bot_id', message_row.bot_id,
        'type', message_row.type,
        'created_at', message_row.created_at,
        'duplicate', true
      )
      from public.messages message_row
      where message_row.id = v_existing_message_id
    );
  end if;

  if exists (
    select 1
    from private.bot_message_idempotency idem
    where idem.bot_id = p_bot_id
      and idem.idempotency_key = p_idempotency_key
  ) then
    raise exception 'bot_idempotency_conflict' using errcode = '23505';
  end if;

  v_message_type := case p_method
    when 'sendMessage' then 'text'
    when 'sendPhoto' then 'image'
    when 'sendVideo' then 'video'
    when 'sendDocument' then 'file'
    when 'sendVoice' then 'audio'
  end;
  v_content := nullif(p_payload->>'text', '');
  v_media_bucket := nullif(p_payload->>'media_bucket', '');
  v_media_path := nullif(p_payload->>'media_path', '');
  v_media_metadata := case
    when jsonb_typeof(p_payload->'media_metadata') = 'object'
      then p_payload->'media_metadata'
    else '{}'::jsonb
  end;

  if v_content is not null and pg_catalog.length(v_content) > 4096 then
    raise exception 'bot_message_too_long' using errcode = '22023';
  end if;
  if v_message_type = 'text' and v_content is null then
    raise exception 'bot_message_text_required' using errcode = '22023';
  end if;
  if v_message_type <> 'text' and (
    v_media_bucket is null
    or v_media_path is null
    or pg_catalog.octet_length(v_media_bucket) > 128
    or pg_catalog.octet_length(v_media_path) > 1024
  ) then
    raise exception 'bot_message_media_required' using errcode = '22023';
  end if;

  if nullif(p_payload->>'topic_id', '') is not null then
    if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_topic_invalid' using errcode = '22023';
    end if;
    v_topic_id := (p_payload->>'topic_id')::uuid;
  end if;
  if nullif(p_payload->>'reply_to_id', '') is not null then
    if (p_payload->>'reply_to_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_reply_invalid' using errcode = '22023';
    end if;
    v_reply_to_id := (p_payload->>'reply_to_id')::uuid;
  end if;

  insert into public.messages(
    chat_id,
    topic_id,
    user_id,
    bot_id,
    content,
    type,
    media_bucket,
    media_path,
    media_metadata,
    reply_to_id
  ) values (
    p_chat_id,
    v_topic_id,
    null,
    p_bot_id,
    v_content,
    v_message_type,
    v_media_bucket,
    v_media_path,
    v_media_metadata,
    v_reply_to_id
  )
  returning id into v_message_id;

  insert into private.bot_message_idempotency(
    bot_id,
    idempotency_key,
    method,
    message_id
  ) values (
    p_bot_id,
    p_idempotency_key,
    p_method,
    v_message_id
  );

  return (
    select jsonb_build_object(
      'message_id', message_row.id,
      'chat_id', message_row.chat_id,
      'bot_id', message_row.bot_id,
      'type', message_row.type,
      'created_at', message_row.created_at,
      'duplicate', false
    )
    from public.messages message_row
    where message_row.id = v_message_id
  );
end
$function$;

revoke all on function public.bot_send_message_internal(uuid,uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_send_message_internal(uuid,uuid,text,jsonb,text)
  to service_role;

create or replace function public.bot_update_enqueue_internal(
  p_bot_id uuid,
  p_update_type text,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_update_id bigint;
begin
  if p_bot_id is null
     or p_update_type not in ('message','edited_message','callback_query','membership')
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or not exists (
       select 1 from public.bots bot
       where bot.id = p_bot_id and bot.state = 'active'
     ) then
    raise exception 'bot_update_input_invalid' using errcode = '22023';
  end if;

  if p_update_type in ('message','edited_message') then
    if coalesce(p_payload->>'chat_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(p_payload->>'message_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not exists (
         select 1
         from public.messages message_row
         join public.chat_bot_members member_row
           on member_row.chat_id = message_row.chat_id
          and member_row.bot_id = p_bot_id
         where message_row.id = (p_payload->>'message_id')::uuid
           and message_row.chat_id = (p_payload->>'chat_id')::uuid
           and member_row.removed_at is null
           and message_row.created_at >= member_row.joined_at
       ) then
      raise exception 'bot_update_history_forbidden' using errcode = '42501';
    end if;
  end if;

  insert into private.bot_update_counters(bot_id, next_update_id)
  values (p_bot_id, 1)
  on conflict (bot_id) do update
  set next_update_id = private.bot_update_counters.next_update_id + 1
  returning next_update_id into v_update_id;

  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (p_bot_id, v_update_id, p_update_type, p_payload);

  insert into private.bot_delivery_attempts(bot_id, update_id)
  select p_bot_id, v_update_id
  from private.bot_webhooks webhook
  where webhook.bot_id = p_bot_id
    and webhook.state = 'enabled'
  on conflict (bot_id, update_id) do nothing;

  return v_update_id;
end
$function$;

revoke all on function public.bot_update_enqueue_internal(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_update_enqueue_internal(uuid,text,jsonb)
  to service_role;

create or replace function public.bot_updates_poll_internal(
  p_bot_id uuid,
  p_offset bigint,
  p_limit integer,
  p_timeout_marker uuid
)
returns table(
  update_id bigint,
  update_type text,
  payload jsonb,
  available_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
begin
  if p_bot_id is null or p_offset < 0
     or p_limit not between 1 and 100
     or p_timeout_marker is null then
    raise exception 'bot_poll_input_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.bots bot
    where bot.id = p_bot_id and bot.state = 'active'
  ) then
    raise exception 'bot_inactive' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.bot_webhooks webhook
    where webhook.bot_id = p_bot_id and webhook.state = 'enabled'
  ) then
    raise exception 'bot_webhook_active' using errcode = '55000';
  end if;

  insert into private.bot_delivery_leases(
    bot_id,
    delivery_mode,
    lease_token,
    expires_at,
    updated_at
  ) values (
    p_bot_id,
    'polling',
    p_timeout_marker,
    pg_catalog.now() + interval '35 seconds',
    pg_catalog.now()
  )
  on conflict (bot_id) do update
  set delivery_mode = 'polling',
      lease_token = excluded.lease_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  where private.bot_delivery_leases.expires_at <= pg_catalog.now()
     or private.bot_delivery_leases.delivery_mode = 'polling';

  if not found then
    raise exception 'bot_delivery_mode_conflict' using errcode = '55000';
  end if;

  update private.bot_updates queued
  set acknowledged_at = coalesce(queued.acknowledged_at, pg_catalog.now())
  where queued.bot_id = p_bot_id
    and p_offset > 0
    and queued.update_id < p_offset
    and queued.acknowledged_at is null;

  return query
  select
    queued.update_id,
    queued.update_type,
    queued.payload,
    queued.available_at,
    queued.expires_at
  from private.bot_updates queued
  where queued.bot_id = p_bot_id
    and queued.update_id >= greatest(p_offset, 0)
    and queued.available_at <= pg_catalog.now()
    and queued.acknowledged_at is null
    and queued.expires_at > pg_catalog.now()
  order by queued.update_id
  limit p_limit;
end
$function$;

revoke all on function public.bot_updates_poll_internal(uuid,bigint,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_updates_poll_internal(uuid,bigint,integer,uuid)
  to service_role;

create or replace function public.bot_updates_ack_internal(
  p_bot_id uuid,
  p_through_update_id bigint
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_count integer;
begin
  if p_bot_id is null or p_through_update_id < 0 then
    return 0;
  end if;
  update private.bot_updates queued
  set acknowledged_at = coalesce(queued.acknowledged_at, pg_catalog.now())
  where queued.bot_id = p_bot_id
    and queued.update_id <= p_through_update_id
    and queued.acknowledged_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

revoke all on function public.bot_updates_ack_internal(uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_updates_ack_internal(uuid,bigint)
  to service_role;

create or replace function public.bot_webhook_set_internal(
  p_bot_id uuid,
  p_url text,
  p_secret_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_lease_token uuid := gen_random_uuid();
begin
  -- The gateway performs DNS, address-range and redirect validation before this
  -- trusted persistence boundary. The database still enforces HTTPS, bounded
  -- input and credential-free authority syntax.
  if p_bot_id is null
     or p_url is null
     or pg_catalog.octet_length(p_url) not between 10 and 2048
     or p_url !~ '^https://[^/@[:space:]]+(?::[0-9]{1,5})?(/|$)'
     or p_url ~ '^https://[^/]*@'
     or p_secret_hash !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1 from public.bots bot
       where bot.id = p_bot_id and bot.state = 'active'
     ) then
    raise exception 'bot_webhook_input_invalid' using errcode = '22023';
  end if;

  insert into private.bot_delivery_leases(
    bot_id,
    delivery_mode,
    lease_token,
    expires_at,
    updated_at
  ) values (
    p_bot_id,
    'webhook',
    v_lease_token,
    'infinity'::timestamptz,
    pg_catalog.now()
  )
  on conflict (bot_id) do update
  set delivery_mode = 'webhook',
      lease_token = excluded.lease_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  where private.bot_delivery_leases.expires_at <= pg_catalog.now()
     or private.bot_delivery_leases.delivery_mode = 'webhook';

  if not found then
    raise exception 'bot_polling_active' using errcode = '55000';
  end if;

  insert into private.bot_webhooks(
    bot_id,
    target_url,
    secret_hash,
    state,
    failure_count,
    last_error_code,
    updated_at
  ) values (
    p_bot_id,
    p_url,
    p_secret_hash,
    'enabled',
    0,
    null,
    pg_catalog.now()
  )
  on conflict (bot_id) do update
  set target_url = excluded.target_url,
      secret_hash = excluded.secret_hash,
      state = 'enabled',
      failure_count = 0,
      last_error_code = null,
      updated_at = pg_catalog.now();

  insert into private.bot_delivery_attempts(bot_id, update_id)
  select queued.bot_id, queued.update_id
  from private.bot_updates queued
  where queued.bot_id = p_bot_id
    and queued.acknowledged_at is null
    and queued.expires_at > pg_catalog.now()
  on conflict (bot_id, update_id) do nothing;
  return true;
end
$function$;

revoke all on function public.bot_webhook_set_internal(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_webhook_set_internal(uuid,text,text)
  to service_role;

create or replace function public.bot_webhook_delete_internal(
  p_bot_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_webhook_rows integer := 0;
begin
  if p_bot_id is null then
    return false;
  end if;
  update private.bot_webhooks webhook
  set state = 'disabled',
      updated_at = pg_catalog.now()
  where webhook.bot_id = p_bot_id;
  get diagnostics v_webhook_rows = row_count;
  delete from private.bot_delivery_leases lease
  where lease.bot_id = p_bot_id
    and lease.delivery_mode = 'webhook';
  return v_webhook_rows > 0;
end
$function$;

revoke all on function public.bot_webhook_delete_internal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_webhook_delete_internal(uuid)
  to service_role;

create or replace function public.bot_delivery_claim_internal(
  p_limit integer,
  p_claim_token uuid
)
returns table(
  attempt_id bigint,
  bot_id uuid,
  update_id bigint,
  target_url text,
  secret_hash text,
  payload jsonb,
  attempt_count integer
)
language sql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
  with candidates as (
    select attempt.id
    from private.bot_delivery_attempts attempt
    join private.bot_updates queued
      on queued.bot_id = attempt.bot_id
     and queued.update_id = attempt.update_id
    join private.bot_webhooks webhook on webhook.bot_id = attempt.bot_id
    join public.bots bot on bot.id = attempt.bot_id
    where p_limit between 1 and 100
      and p_claim_token is not null
      and attempt.status in ('pending','retry')
      and attempt.available_at <= pg_catalog.now()
      and queued.acknowledged_at is null
      and queued.expires_at > pg_catalog.now()
      and webhook.state = 'enabled'
      and bot.state = 'active'
    order by attempt.available_at, attempt.id
    limit p_limit
    for update of attempt skip locked
  ), claimed as (
    update private.bot_delivery_attempts attempt
    set status = 'claimed',
        claim_token = p_claim_token,
        claimed_at = pg_catalog.now(),
        attempt_count = attempt.attempt_count + 1,
        updated_at = pg_catalog.now()
    from candidates candidate
    where attempt.id = candidate.id
    returning attempt.*
  )
  select
    claimed.id,
    claimed.bot_id,
    claimed.update_id,
    webhook.target_url,
    webhook.secret_hash,
    queued.payload,
    claimed.attempt_count
  from claimed
  join private.bot_updates queued
    on queued.bot_id = claimed.bot_id
   and queued.update_id = claimed.update_id
  join private.bot_webhooks webhook on webhook.bot_id = claimed.bot_id
  order by claimed.id;
$function$;

revoke all on function public.bot_delivery_claim_internal(integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_delivery_claim_internal(integer,uuid)
  to service_role;

create or replace function public.bot_delivery_finish_internal(
  p_attempt_id bigint,
  p_claim_token uuid,
  p_status text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_attempt private.bot_delivery_attempts%rowtype;
  v_next_status text;
begin
  if p_attempt_id is null or p_claim_token is null
     or p_status not in ('delivered','retry','dead_letter')
     or (
       p_error_code is not null
       and p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'
     ) then
    return false;
  end if;

  select * into v_attempt
  from private.bot_delivery_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.status = 'claimed'
    and attempt.claim_token = p_claim_token
    and attempt.claimed_at > pg_catalog.now() - interval '15 minutes'
  for update;
  if not found then
    return false;
  end if;

  v_next_status := case
    when p_status = 'delivered' then 'succeeded'
    when p_status = 'dead_letter' or v_attempt.attempt_count >= 12 then 'dead_letter'
    else 'retry'
  end;

  update private.bot_delivery_attempts attempt
  set status = v_next_status,
      claim_token = null,
      claimed_at = null,
      error_code = case when v_next_status = 'succeeded' then null else p_error_code end,
      available_at = case
        when v_next_status = 'retry' then pg_catalog.now() + least(
          interval '1 hour',
          interval '5 seconds' * (
            pg_catalog.power(2::numeric, least(v_attempt.attempt_count, 10))::double precision
          )
        )
        else attempt.available_at
      end,
      completed_at = case
        when v_next_status in ('succeeded','dead_letter') then pg_catalog.now()
        else null
      end,
      updated_at = pg_catalog.now()
  where attempt.id = v_attempt.id;

  if v_next_status = 'succeeded' then
    update private.bot_updates queued
    set acknowledged_at = coalesce(queued.acknowledged_at, pg_catalog.now())
    where queued.bot_id = v_attempt.bot_id
      and queued.update_id = v_attempt.update_id;
    update private.bot_webhooks webhook
    set failure_count = 0,
        last_error_code = null,
        updated_at = pg_catalog.now()
    where webhook.bot_id = v_attempt.bot_id;
  else
    update private.bot_webhooks webhook
    set failure_count = least(webhook.failure_count + 1, 20),
        last_error_code = p_error_code,
        updated_at = pg_catalog.now()
    where webhook.bot_id = v_attempt.bot_id;
  end if;
  return true;
end
$function$;

revoke all on function public.bot_delivery_finish_internal(bigint,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_delivery_finish_internal(bigint,uuid,text,text)
  to service_role;

create or replace function public.bot_delivery_cleanup_internal(
  p_now timestamptz,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, storage
as $function$
declare
  v_updates integer := 0;
  v_attempts integer := 0;
  v_limits integer := 0;
  v_idempotency integer := 0;
begin
  if p_now is null or p_limit not between 1 and 1000
     or p_now > pg_catalog.now() + interval '1 minute' then
    raise exception 'bot_cleanup_input_invalid' using errcode = '22023';
  end if;

  with doomed as (
    select queued.id
    from private.bot_updates queued
    where queued.expires_at <= p_now
       or queued.acknowledged_at is not null
    order by coalesce(queued.acknowledged_at, queued.expires_at), queued.id
    limit p_limit
    for update of queued skip locked
  )
  delete from private.bot_updates queued
  using doomed
  where queued.id = doomed.id;
  get diagnostics v_updates = row_count;

  with doomed as (
    select attempt.id
    from private.bot_delivery_attempts attempt
    where coalesce(attempt.completed_at, attempt.updated_at) < p_now - interval '14 days'
    order by coalesce(attempt.completed_at, attempt.updated_at), attempt.id
    limit p_limit
    for update of attempt skip locked
  )
  delete from private.bot_delivery_attempts attempt
  using doomed
  where attempt.id = doomed.id;
  get diagnostics v_attempts = row_count;

  with doomed as (
    select bucket.bot_id, bucket.scope_kind, bucket.scope_key, bucket.bucket_start
    from private.bot_rate_limit_buckets bucket
    where bucket.expires_at <= p_now
    order by bucket.expires_at
    limit p_limit
    for update of bucket skip locked
  )
  delete from private.bot_rate_limit_buckets bucket
  using doomed
  where bucket.bot_id = doomed.bot_id
    and bucket.scope_kind = doomed.scope_kind
    and bucket.scope_key = doomed.scope_key
    and bucket.bucket_start = doomed.bucket_start;
  get diagnostics v_limits = row_count;

  with doomed as (
    select idem.bot_id, idem.idempotency_key
    from private.bot_message_idempotency idem
    where idem.created_at < p_now - interval '24 hours'
    order by idem.created_at, idem.bot_id
    limit p_limit
    for update of idem skip locked
  )
  delete from private.bot_message_idempotency idem
  using doomed
  where idem.bot_id = doomed.bot_id
    and idem.idempotency_key = doomed.idempotency_key;
  get diagnostics v_idempotency = row_count;

  delete from private.bot_delivery_leases lease
  where lease.expires_at <= p_now;

  return jsonb_build_object(
    'updates_deleted', v_updates,
    'attempts_deleted', v_attempts,
    'rate_limits_deleted', v_limits,
    'idempotency_deleted', v_idempotency
  );
end
$function$;

revoke all on function public.bot_delivery_cleanup_internal(timestamptz,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_delivery_cleanup_internal(timestamptz,integer)
  to service_role;

create or replace function public.enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_sender_kind text;
  v_sender_name text;
  v_chat_name text;
  v_chat_type text;
  v_preview text;
  v_message_type text := coalesce(new.type, 'text');
begin
  if v_message_type = 'system'
     or (new.user_id is null and new.bot_id is null) then
    return null;
  end if;

  if new.bot_id is not null then
    v_sender_kind := 'bot';
    select coalesce(
      nullif(pg_catalog.btrim(b.display_name), ''),
      nullif('@' || b.username, '@'),
      'Бот'
    )
    into v_sender_name
    from public.bots b where b.id = new.bot_id;
  else
    v_sender_kind := 'user';
    select coalesce(
      nullif(pg_catalog.btrim(p.full_name), ''),
      nullif('@' || p.username, '@'),
      'Участник'
    )
    into v_sender_name
    from public.profiles p where p.id = new.user_id;
  end if;

  select
    coalesce(nullif(pg_catalog.btrim(chat.name), ''), v_sender_name, 'Чат'),
    coalesce(nullif(chat.type, ''), 'private')
  into v_chat_name, v_chat_type
  from public.chats chat
  where chat.id = new.chat_id;

  v_preview := case
    when v_message_type = 'text' then nullif(
      pg_catalog.left(
        regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g'),
        160
      ),
      ''
    )
    when v_message_type = 'image' then 'Фото'
    when v_message_type = 'video'
         and coalesce(new.media_metadata->>'kind', '') = 'video_message'
      then 'Видеосообщение'
    when v_message_type = 'video' then 'Видео'
    when v_message_type = 'audio' then 'Голосовое'
    when v_message_type = 'file' then 'Файл'
    when v_message_type = 'location' then 'Местоположение'
    else 'Сообщение'
  end;
  v_preview := coalesce(v_preview, 'Сообщение');

  -- In-app notifications remain the source of truth.
  -- Push mutes and notification preferences remain enforced by public._notification_push_allowed.
  -- The existing outbox trigger alone projects an OS/browser delivery.
  insert into public.notifications(user_id, kind, payload)
  select
    member_row.user_id,
    'message',
    jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'sender_kind', v_sender_kind,
      'sender_id', new.user_id,
      'bot_id', new.bot_id,
      'sender_name', coalesce(v_sender_name, 'Участник'),
      'chat_name', coalesce(v_chat_name, 'Чат'),
      'chat_type', coalesce(v_chat_type, 'private'),
      'preview', v_preview,
      'message_type', v_message_type,
      'route', '/?chat=' || new.chat_id::text || '&message=' || new.id::text
    )
  from public.chat_members member_row
  where member_row.chat_id = new.chat_id
    and (new.user_id is null or member_row.user_id <> new.user_id)
    and member_row.hidden_at is null
    and (member_row.cleared_at is null or new.created_at > member_row.cleared_at)
    and not exists (
      select 1
      from public.message_hidden_for_users hidden
      where hidden.message_id = new.id
        and hidden.user_id = member_row.user_id
    )
  on conflict do nothing;
  return null;
end
$function$;

revoke all on function public.enqueue_message_notifications()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_message_notifications_after_insert
  on public.messages;
create trigger trg_enqueue_message_notifications_after_insert
  after insert on public.messages
  for each row execute function public.enqueue_message_notifications();

commit;
