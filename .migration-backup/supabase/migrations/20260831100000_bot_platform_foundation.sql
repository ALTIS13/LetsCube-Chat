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
create unique index bot_tokens_one_active_per_bot_idx
  on private.bot_tokens(bot_id)
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
  secret_ciphertext text not null
    check (
      pg_catalog.octet_length(secret_ciphertext) between 55 and 4103
      and secret_ciphertext ~ '^enc:v1:[A-Za-z0-9_-]+$'
    ),
  secret_fingerprint text not null
    check (secret_fingerprint ~ '^[0-9a-f]{16,64}$'),
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

create table private.bot_operation_idempotency (
  bot_id uuid not null references public.bots(id) on delete restrict,
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  method text not null
    check (method in (
      'sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice',
      'sendChatAction','editMessageText','deleteMessage',
      'setMyCommands','answerCallbackQuery'
    )),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (bot_id, idempotency_key),
  constraint bot_operation_idempotency_result_size_check
    check (pg_catalog.octet_length(result::text) <= 32782)
);

create index bot_operation_idempotency_retention_idx
  on private.bot_operation_idempotency(created_at, bot_id);

create table private.bot_callback_answers (
  bot_id uuid not null references public.bots(id) on delete restrict,
  callback_query_id uuid not null,
  source_update_id bigint null
    references private.bot_updates(id) on delete set null,
  text text null check (text is null or pg_catalog.length(text) between 1 and 200),
  show_alert boolean not null default false,
  answered_at timestamptz not null default pg_catalog.now(),
  primary key (bot_id, callback_query_id)
);

create index bot_callback_answers_retention_idx
  on private.bot_callback_answers(answered_at, bot_id);

create table private.bot_upload_grants (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete restrict,
  chat_id uuid not null references public.chats(id) on delete cascade,
  bucket_id text not null check (bucket_id = 'chat-media'),
  object_path text not null
    check (pg_catalog.octet_length(object_path) between 80 and 1024),
  content_type text not null
    check (pg_catalog.octet_length(content_type) between 3 and 128),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_message_id uuid null
    references public.messages(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  constraint bot_upload_grants_expiry_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '15 minutes'
  ),
  constraint bot_upload_grants_consumption_check check (
    (consumed_at is null and consumed_message_id is null)
    or (consumed_at is not null and consumed_message_id is not null)
  )
);

create unique index bot_upload_grants_active_object_idx
  on private.bot_upload_grants(bot_id, chat_id, bucket_id, object_path)
  where consumed_at is null;
create index bot_upload_grants_expiry_idx
  on private.bot_upload_grants(expires_at, id)
  where consumed_at is null;
create index bot_upload_grants_consumed_idx
  on private.bot_upload_grants(consumed_at, id)
  where consumed_at is not null;

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
revoke all on table private.bot_operation_idempotency from public, anon, authenticated, service_role;
revoke all on table private.bot_callback_answers from public, anon, authenticated, service_role;
revoke all on table private.bot_upload_grants from public, anon, authenticated, service_role;
revoke all on table private.bot_delivery_leases from public, anon, authenticated, service_role;

alter table private.bot_tokens enable row level security;
alter table private.bot_update_counters enable row level security;
alter table private.bot_updates enable row level security;
alter table private.bot_webhooks enable row level security;
alter table private.bot_delivery_attempts enable row level security;
alter table private.bot_rate_limit_buckets enable row level security;
alter table private.bot_message_idempotency enable row level security;
alter table private.bot_operation_idempotency enable row level security;
alter table private.bot_callback_answers enable row level security;
alter table private.bot_upload_grants enable row level security;
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

create or replace function private.bot_inline_keyboard_valid(p_markup jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_row jsonb;
  v_button jsonb;
begin
  if p_markup is null then
    return true;
  end if;
  if pg_catalog.jsonb_typeof(p_markup) <> 'object'
     or pg_catalog.octet_length(p_markup::text) > 16384
     or not (p_markup ? 'inline_keyboard')
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_markup)) <> 1
     or pg_catalog.jsonb_typeof(p_markup->'inline_keyboard') <> 'array'
     or pg_catalog.jsonb_array_length(p_markup->'inline_keyboard') not between 1 and 8 then
    return false;
  end if;

  for v_row in
    select row_element.value
    from pg_catalog.jsonb_array_elements(p_markup->'inline_keyboard') row_element(value)
  loop
    if pg_catalog.jsonb_typeof(v_row) <> 'array'
       or pg_catalog.jsonb_array_length(v_row) not between 1 and 8 then
      return false;
    end if;
    for v_button in
      select button_element.value
      from pg_catalog.jsonb_array_elements(v_row) button_element(value)
    loop
      if pg_catalog.jsonb_typeof(v_button) <> 'object'
         or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_button)) <> 2
         or not (v_button ? 'text')
         or not (v_button ? 'callback_data')
         or pg_catalog.jsonb_typeof(v_button->'text') <> 'string'
         or pg_catalog.jsonb_typeof(v_button->'callback_data') <> 'string'
         or pg_catalog.length(v_button->>'text') not between 1 and 64
         or pg_catalog.length(v_button->>'callback_data') not between 1 and 128 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end
$function$;

revoke all on function private.bot_inline_keyboard_valid(jsonb)
  from public, anon, authenticated, service_role;

alter table public.messages
  add column if not exists bot_id uuid null
    references public.bots(id) on delete restrict;

alter table public.messages
  add column if not exists bot_reply_markup jsonb null;
alter table public.messages
  drop constraint if exists messages_bot_reply_markup_check;
alter table public.messages
  add constraint messages_bot_reply_markup_check
  check (
    bot_reply_markup is null
    or (
      bot_id is not null
      and pg_catalog.jsonb_typeof(bot_reply_markup) = 'object'
      and pg_catalog.octet_length(bot_reply_markup::text) <= 16384
    )
  ) not valid;
alter table public.messages validate constraint messages_bot_reply_markup_check;

create or replace function private.validate_bot_reply_markup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.bot_reply_markup is null then
    return new;
  end if;
  if new.bot_id is null
     or not private.bot_inline_keyboard_valid(new.bot_reply_markup) then
    raise exception 'bot_reply_markup_invalid' using errcode = '22023';
  end if;
  return new;
end
$function$;

revoke all on function private.validate_bot_reply_markup()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_validate_bot_reply_markup on public.messages;
create trigger trg_validate_bot_reply_markup
  before insert or update of bot_id, bot_reply_markup on public.messages
  for each row execute function private.validate_bot_reply_markup();

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
set search_path = ''
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

create or replace function private.mark_profile_delete_message_tombstones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_marker text;
begin
  v_marker := pg_catalog.current_setting(
    'letscube.profile_delete_tombstone_user_ids',
    true
  );
  if coalesce(v_marker, '') = '' then
    v_marker := old.id::text;
  elsif old.id::text <> all(pg_catalog.string_to_array(v_marker, ',')) then
    v_marker := v_marker || ',' || old.id::text;
  end if;
  perform pg_catalog.set_config(
    'letscube.profile_delete_tombstone_user_ids',
    v_marker,
    true
  );
  return old;
end
$function$;

revoke all on function private.mark_profile_delete_message_tombstones()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_mark_message_tombstones on public.profiles;
create trigger trg_profiles_mark_message_tombstones
  before delete on public.profiles
  for each row execute function private.mark_profile_delete_message_tombstones();

create or replace function private.enforce_message_sender_on_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.bot_id is distinct from old.bot_id
     or new.type is distinct from old.type then
    raise exception 'message_sender_immutable' using errcode = '23514';
  end if;

  if new.user_id is distinct from old.user_id then
    if not (
      old.user_id is not null
      and new.user_id is null
      and new.bot_id is null
      and old.user_id::text = any(
        pg_catalog.string_to_array(
          coalesce(pg_catalog.current_setting(
            'letscube.profile_delete_tombstone_user_ids',
            true
          ), ''),
          ','
        )
      )
      and not exists (
        select 1
        from public.profiles profile
        where profile.id = old.user_id
      )
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
set search_path = ''
as $function$
declare
  v_bot public.bots%rowtype;
  v_token private.bot_tokens%rowtype;
  v_username text := pg_catalog.lower(pg_catalog.btrim(p_username));
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_description text := coalesce(p_description, '');
begin
  if p_actor_id is null
     or p_username is null
     or p_display_name is null
     or p_token_prefix is null
     or p_token_hash is null then
    raise exception 'bot_actor_invalid' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z][a-z0-9_]{4,31}$'
     or pg_catalog.length(v_display_name) not between 2 and 64
     or pg_catalog.length(v_description) > 512
     or p_token_prefix !~ '^[A-Za-z0-9_-]{8,24}$'
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_input_invalid' using errcode = '22023';
  end if;

  perform 1
  from public.profiles actor_profile
  where actor_profile.id = p_actor_id
  for update of actor_profile;
  if not found then
    raise exception 'bot_actor_invalid' using errcode = '22023';
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
set search_path = ''
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
set search_path = ''
as $function$
declare
  v_token private.bot_tokens%rowtype;
begin
  if p_actor_id is null or p_bot_id is null
     or p_token_prefix is null
     or p_token_hash is null
     or p_token_prefix !~ '^[A-Za-z0-9_-]{8,24}$'
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_token_input_invalid' using errcode = '22023';
  end if;
  perform 1
    from public.bots bot
    join public.bot_owners owner_row on owner_row.bot_id = bot.id
    where bot.id = p_bot_id
      and owner_row.user_id = p_actor_id
      and owner_row.role = 'owner'
      and bot.state not in ('pending_delete','deleted')
    for update of bot;
  if not found then
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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
as $function$
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

revoke all on function public.bot_membership_authorize_internal(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_membership_authorize_internal(uuid,uuid,text)
  to service_role;

create or replace function private.bot_can_receive_message(
  p_bot_id uuid,
  p_message_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
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

revoke all on function private.bot_can_receive_message(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.bot_message_update_payload(
  p_bot_id uuid,
  p_message_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'message',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', message_row.id,
      'chat_id', message_row.chat_id,
      'topic_id', message_row.topic_id,
      'reply_to_message_id', message_row.reply_to_id,
      'date', message_row.created_at,
      'type', nullif(pg_catalog.left(message_row.type, 32), ''),
      'text', case
        when message_row.content is null then null
        else nullif(pg_catalog.left(message_row.content, 4096), '')
      end,
      'reply_markup', message_row.bot_reply_markup,
      'from', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', message_row.user_id,
        'bot_id', message_row.bot_id,
        'is_bot', message_row.bot_id is not null,
        'display_name', nullif(pg_catalog.left(
          coalesce(profile.full_name, sender_bot.display_name),
          128
        ), ''),
        'username', nullif(pg_catalog.left(
          coalesce(profile.username, sender_bot.username),
          64
        ), '')
      )),
      'chat', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', chat.id,
        'type', nullif(pg_catalog.left(chat.type, 32), ''),
        'name', nullif(pg_catalog.left(chat.name, 256), '')
      )),
      'attachment', case
        when message_row.media_bucket is null or message_row.media_path is null then null
        else pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'file_id', message_row.id,
          'kind', nullif(pg_catalog.left(message_row.type, 32), ''),
          'mime_type', nullif(pg_catalog.left(
            message_row.media_metadata->>'mime_type',
            128
          ), ''),
          'file_name', nullif(pg_catalog.left(
            message_row.media_metadata->>'file_name',
            255
          ), ''),
          'byte_size', nullif(pg_catalog.left(
            message_row.media_metadata->>'size',
            32
          ), ''),
          'width', nullif(pg_catalog.left(
            message_row.media_metadata->>'width',
            16
          ), ''),
          'height', nullif(pg_catalog.left(
            message_row.media_metadata->>'height',
            16
          ), ''),
          'duration', nullif(pg_catalog.left(
            message_row.media_metadata->>'duration',
            32
          ), '')
        ))
      end
    ))
  )
  from public.messages message_row
  join public.chats chat on chat.id = message_row.chat_id
  left join public.profiles profile on profile.id = message_row.user_id
  left join public.bots sender_bot on sender_bot.id = message_row.bot_id
  where message_row.id = p_message_id
    and p_bot_id is not null;
$function$;

revoke all on function private.bot_message_update_payload(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.bot_upload_authorize_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_content_type text,
  p_byte_size bigint,
  p_expires_in_seconds integer
)
returns table(
  grant_id uuid,
  bucket_id text,
  object_path text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grant private.bot_upload_grants%rowtype;
  v_expected_prefix text;
begin
  v_expected_prefix := p_chat_id::text || '/bots/' || p_bot_id::text || '/';
  if p_bot_id is null or p_chat_id is null
     or p_bucket_id is null
     or p_object_path is null
     or p_content_type is null
     or p_byte_size is null
     or p_expires_in_seconds is null
     or p_bucket_id <> 'chat-media'
     or p_content_type not in (
       'image/jpeg','image/png','image/webp','image/gif',
       'video/mp4','video/webm',
       'audio/webm','audio/ogg','audio/mpeg',
       'application/pdf'
     )
     or p_byte_size not between 1 and 104857600
     or p_expires_in_seconds not between 60 and 900
     or pg_catalog.octet_length(p_object_path) not between 80 and 1024
     or p_object_path not like v_expected_prefix || '%'
     or p_object_path like '%..%'
     or p_object_path like '%//%'
     or p_object_path like '%/' then
    raise exception 'bot_upload_input_invalid' using errcode = '22023';
  end if;

  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'send_message'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from storage.objects stored_object
    where stored_object.bucket_id = p_bucket_id
      and stored_object.name = p_object_path
  ) then
    raise exception 'bot_upload_object_missing' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_bot_id::text || ':' || p_chat_id::text || ':'
      || p_bucket_id || ':' || p_object_path,
      0
    )
  );

  select upload_grant.*
  into v_grant
  from private.bot_upload_grants upload_grant
  where upload_grant.bot_id = p_bot_id
    and upload_grant.chat_id = p_chat_id
    and upload_grant.bucket_id = p_bucket_id
    and upload_grant.object_path = p_object_path
    and upload_grant.consumed_at is null
    and upload_grant.expires_at > pg_catalog.now()
  order by upload_grant.created_at desc
  limit 1
  for update of upload_grant;
  if found then
    if v_grant.content_type = p_content_type
       and v_grant.byte_size = p_byte_size
       and v_grant.expires_at - v_grant.created_at
         = pg_catalog.make_interval(secs => p_expires_in_seconds) then
      return query select
        v_grant.id,
        v_grant.bucket_id,
        v_grant.object_path,
        v_grant.expires_at;
      return;
    end if;
    raise exception 'bot_upload_grant_attribute_conflict' using errcode = '23505';
  end if;

  delete from private.bot_upload_grants stale_grant
  where stale_grant.bot_id = p_bot_id
    and stale_grant.chat_id = p_chat_id
    and stale_grant.bucket_id = p_bucket_id
    and stale_grant.object_path = p_object_path
    and stale_grant.consumed_at is null
    and stale_grant.expires_at <= pg_catalog.now();

  insert into private.bot_upload_grants(
    bot_id,
    chat_id,
    bucket_id,
    object_path,
    content_type,
    byte_size,
    expires_at
  ) values (
    p_bot_id,
    p_chat_id,
    p_bucket_id,
    p_object_path,
    p_content_type,
    p_byte_size,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_expires_in_seconds)
  )
  returning * into v_grant;

  return query select
    v_grant.id,
    v_grant.bucket_id,
    v_grant.object_path,
    v_grant.expires_at;
exception
  when unique_violation then
    if sqlerrm = 'bot_upload_grant_attribute_conflict' then
      raise;
    end if;
    raise exception 'bot_upload_grant_conflict' using errcode = '23505';
end
$function$;

revoke all on function public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)
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
set search_path = ''
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
  v_reply_markup jsonb;
  v_upload_grant_id uuid;
begin
  if p_bot_id is null or p_chat_id is null
     or p_method is null
     or p_idempotency_key is null
     or p_method not in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice')
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(p_payload) payload_key
       where payload_key not in (
         'text','media_bucket','media_path','media_metadata','topic_id','reply_to_id',
         'reply_markup'
       )
     ) then
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
      select pg_catalog.jsonb_build_object(
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
    when pg_catalog.jsonb_typeof(p_payload->'media_metadata') = 'object'
      then p_payload->'media_metadata'
    else '{}'::jsonb
  end;
  v_reply_markup := case
    when p_payload ? 'reply_markup' then p_payload->'reply_markup'
    else null
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
  if pg_catalog.octet_length(v_media_metadata::text) > 4096
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(v_media_metadata) metadata_key
       where metadata_key not in (
         'mime_type','file_name','size','width','height','duration','kind'
       )
     ) then
    raise exception 'bot_message_media_metadata_invalid' using errcode = '22023';
  end if;
  if not private.bot_inline_keyboard_valid(v_reply_markup) then
    raise exception 'bot_reply_markup_invalid' using errcode = '22023';
  end if;

  if nullif(p_payload->>'topic_id', '') is not null then
    if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_topic_invalid' using errcode = '22023';
    end if;
    v_topic_id := (p_payload->>'topic_id')::uuid;
    if not exists (
      select 1
      from public.topics topic
      where topic.id = v_topic_id
        and topic.chat_id = p_chat_id
        and topic.archived is false
    ) then
      raise exception 'bot_topic_forbidden' using errcode = '42501';
    end if;
  end if;
  if nullif(p_payload->>'reply_to_id', '') is not null then
    if (p_payload->>'reply_to_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'bot_reply_invalid' using errcode = '22023';
    end if;
    v_reply_to_id := (p_payload->>'reply_to_id')::uuid;
    if not exists (
      select 1
      from public.messages replied_message
      where replied_message.id = v_reply_to_id
        and replied_message.chat_id = p_chat_id
        and private.bot_can_receive_message(
          p_bot_id,
          replied_message.id
        )
    ) then
      raise exception 'bot_reply_forbidden' using errcode = '42501';
    end if;
  end if;

  if v_message_type <> 'text' then
    select upload_grant.id
    into v_upload_grant_id
    from private.bot_upload_grants upload_grant
    where upload_grant.bot_id = p_bot_id
      and upload_grant.chat_id = p_chat_id
      and upload_grant.bucket_id = v_media_bucket
      and upload_grant.object_path = v_media_path
      and upload_grant.expires_at > pg_catalog.now()
      and upload_grant.consumed_at is null
      and (
        nullif(v_media_metadata->>'mime_type', '') is null
        or upload_grant.content_type = v_media_metadata->>'mime_type'
      )
      and (
        nullif(v_media_metadata->>'size', '') is null
        or upload_grant.byte_size::text = v_media_metadata->>'size'
      )
      and exists (
        select 1
        from storage.objects stored_object
        where stored_object.bucket_id = upload_grant.bucket_id
          and stored_object.name = upload_grant.object_path
      )
    order by upload_grant.created_at desc
    limit 1
    for update of upload_grant;
    if not found then
      raise exception 'bot_media_grant_required' using errcode = '42501';
    end if;
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
    reply_to_id,
    bot_reply_markup
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
    v_reply_to_id,
    v_reply_markup
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

  if v_upload_grant_id is not null then
    update private.bot_upload_grants upload_grant
    set consumed_at = pg_catalog.now(),
        consumed_message_id = v_message_id
    where upload_grant.id = v_upload_grant_id
      and upload_grant.consumed_at is null;
    if not found then
      raise exception 'bot_media_grant_required' using errcode = '42501';
    end if;
  end if;

  return (
    select pg_catalog.jsonb_build_object(
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

create or replace function private.bot_operation_idempotency_lookup(
  p_bot_id uuid,
  p_idempotency_key text,
  p_method text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row private.bot_operation_idempotency%rowtype;
begin
  select operation_row.*
  into v_row
  from private.bot_operation_idempotency operation_row
  where operation_row.bot_id = p_bot_id
    and operation_row.idempotency_key = p_idempotency_key;
  if not found then
    return pg_catalog.jsonb_build_object('found', false);
  end if;
  if v_row.method <> p_method
     or v_row.request_fingerprint <> p_request_fingerprint then
    raise exception 'bot_operation_idempotency_conflict' using errcode = '23505';
  end if;
  return pg_catalog.jsonb_build_object(
    'found', true,
    'result', v_row.result
  );
end
$function$;

revoke all on function private.bot_operation_idempotency_lookup(uuid,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.bot_operation_idempotency_store(
  p_bot_id uuid,
  p_idempotency_key text,
  p_method text,
  p_request_fingerprint text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_result is null or pg_catalog.octet_length(p_result::text) > 32782 then
    raise exception 'bot_operation_result_invalid' using errcode = '22023';
  end if;
  insert into private.bot_operation_idempotency(
    bot_id,
    idempotency_key,
    method,
    request_fingerprint,
    result
  ) values (
    p_bot_id,
    p_idempotency_key,
    p_method,
    p_request_fingerprint,
    p_result
  );
exception
  when unique_violation then
    raise exception 'bot_operation_idempotency_conflict' using errcode = '23505';
end
$function$;

revoke all on function private.bot_operation_idempotency_store(uuid,text,text,text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.bot_media_command_preflight_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_method text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_existing jsonb;
begin
  if p_bot_id is null or p_chat_id is null or p_method is null
     or p_method not in (
       'sendPhoto','sendVideo','sendDocument','sendVoice'
     )
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_media_preflight_input_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.bots bot
    where bot.id = p_bot_id
      and bot.state = 'active'
  ) then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;
  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'send_message'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;

  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,
    p_idempotency_key,
    p_method,
    p_request_fingerprint
  );
  if coalesce((v_existing->>'found')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'result', v_existing->'result',
      'duplicate', true
    );
  end if;
  return pg_catalog.jsonb_build_object('result', null, 'duplicate', false);
end
$function$;

revoke all on function public.bot_media_command_preflight_internal(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_media_command_preflight_internal(uuid,uuid,text,text,text)
  to service_role;

create or replace function public.bot_get_me_internal(p_bot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_bot_id is null then
    raise exception 'bot_identity_input_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'id', bot.id,
    'username', bot.username,
    'display_name', bot.display_name,
    'description', bot.description,
    'avatar_url', bot.avatar_url,
    'is_bot', true,
    'can_join_groups', true,
    'supports_inline_keyboards', true
  ))
  into v_result
  from public.bots bot
  where bot.id = p_bot_id
    and bot.state = 'active';
  if v_result is null then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end
$function$;

revoke all on function public.bot_get_me_internal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_get_me_internal(uuid)
  to service_role;

create or replace function public.bot_commands_list_internal(p_bot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_bot_id is null then
    raise exception 'bot_commands_input_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.bots bot
    where bot.id = p_bot_id and bot.state = 'active'
  ) then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'command', command_row.command,
        'description', command_row.description
      ) order by command_row.sort_order, command_row.command
    ),
    '[]'::jsonb
  )
  into v_result
  from public.bot_commands command_row
  where command_row.bot_id = p_bot_id;
  return v_result;
end
$function$;

revoke all on function public.bot_commands_list_internal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_commands_list_internal(uuid)
  to service_role;

create or replace function public.bot_commands_replace_internal(
  p_bot_id uuid,
  p_commands jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing jsonb;
  v_result jsonb;
  v_locked_bot_id uuid;
begin
  if p_bot_id is null
     or p_commands is null
     or pg_catalog.jsonb_typeof(p_commands) <> 'array'
     or pg_catalog.jsonb_array_length(p_commands) > 100
     or pg_catalog.octet_length(p_commands::text) > 32768
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_commands) command_element(value)
       where pg_catalog.jsonb_typeof(command_element.value) <> 'object'
          or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_element.value)) <> 2
          or not (command_element.value ? 'command')
          or not (command_element.value ? 'description')
          or pg_catalog.jsonb_typeof(command_element.value->'command') <> 'string'
          or pg_catalog.jsonb_typeof(command_element.value->'description') <> 'string'
          or (command_element.value->>'command') !~ '^[a-z][a-z0-9_]{0,31}$'
          or command_element.value->>'description' <> pg_catalog.btrim(command_element.value->>'description')
          or pg_catalog.length(command_element.value->>'description') not between 1 and 256
     )
     or (
       select pg_catalog.count(*) <> pg_catalog.count(distinct command_element.value->>'command')
       from pg_catalog.jsonb_array_elements(p_commands) command_element(value)
     ) then
    raise exception 'bot_commands_input_invalid' using errcode = '22023';
  end if;
  select bot.id
  into v_locked_bot_id
  from public.bots bot
  where bot.id = p_bot_id
    and bot.state = 'active'
  for update of bot;
  if not found then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)
  );
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,
    p_idempotency_key,
    'setMyCommands',
    p_request_fingerprint
  );
  if coalesce((v_existing->>'found')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'result', v_existing->'result',
      'duplicate', true
    );
  end if;

  delete from public.bot_commands command_row
  where command_row.bot_id = p_bot_id;
  insert into public.bot_commands(
    bot_id,
    command,
    description,
    sort_order
  )
  select
    p_bot_id,
    command_element.value->>'command',
    command_element.value->>'description',
    (command_element.ordinality - 1)::integer
  from pg_catalog.jsonb_array_elements(p_commands)
    with ordinality command_element(value, ordinality);

  v_result := pg_catalog.jsonb_build_object(
    'commands', public.bot_commands_list_internal(p_bot_id)
  );
  perform private.bot_operation_idempotency_store(
    p_bot_id,
    p_idempotency_key,
    'setMyCommands',
    p_request_fingerprint,
    v_result
  );
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
end
$function$;

revoke all on function public.bot_commands_replace_internal(uuid,jsonb,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_commands_replace_internal(uuid,jsonb,text,text)
  to service_role;

create or replace function public.bot_message_command_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_method text,
  p_payload jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing jsonb;
  v_result jsonb;
  v_send_result jsonb;
  v_target public.messages%rowtype;
  v_message_id uuid;
  v_topic_id uuid;
  v_text text;
  v_reply_markup jsonb;
  v_expected_media_kind text;
begin
  if p_bot_id is null or p_chat_id is null or p_method is null
     or p_method not in (
       'sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice',
       'sendChatAction','editMessageText','deleteMessage'
     )
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_message_command_input_invalid' using errcode = '22023';
  end if;

  if p_method = 'sendMessage' then
    if not (p_payload ? 'text')
       or pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
       or pg_catalog.length(p_payload->>'text') not between 1 and 4096
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in ('text','topic_id','reply_to_id','reply_markup')
       ) then
      raise exception 'bot_send_text_input_invalid' using errcode = '22023';
    end if;
  elsif p_method in ('sendPhoto','sendVideo','sendDocument','sendVoice') then
    v_expected_media_kind := case p_method
      when 'sendPhoto' then 'image'
      when 'sendVideo' then 'video'
      when 'sendDocument' then 'file'
      when 'sendVoice' then 'audio'
    end;
    if not (p_payload ? 'media_bucket')
       or not (p_payload ? 'media_path')
       or not (p_payload ? 'media_metadata')
       or pg_catalog.jsonb_typeof(p_payload->'media_bucket') <> 'string'
       or p_payload->>'media_bucket' <> 'chat-media'
       or pg_catalog.jsonb_typeof(p_payload->'media_path') <> 'string'
       or pg_catalog.octet_length(p_payload->>'media_path') not between 1 and 1024
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata') <> 'object'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in (
           'text','media_bucket','media_path','media_metadata',
           'topic_id','reply_to_id','reply_markup'
         )
       )
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload->'media_metadata') metadata_key
         where metadata_key not in ('mime_type','size','kind')
       )
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'mime_type') <> 'string'
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'size') <> 'number'
       or (p_payload->'media_metadata'->>'size') !~ '^[0-9]{1,9}$'
       or (p_payload->'media_metadata'->>'size')::bigint not between 1 and 104857600
       or pg_catalog.jsonb_typeof(p_payload->'media_metadata'->'kind') <> 'string'
       or p_payload->'media_metadata'->>'kind' <> v_expected_media_kind
       or (p_payload ? 'text' and (
         pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
         or pg_catalog.length(p_payload->>'text') not between 1 and 4096
       ))
       or (p_method = 'sendPhoto' and p_payload->'media_metadata'->>'mime_type' not in (
         'image/jpeg','image/png','image/webp','image/gif'
       ))
       or (p_method = 'sendVideo' and p_payload->'media_metadata'->>'mime_type' not in (
         'video/mp4','video/webm'
       ))
       or (p_method = 'sendDocument' and p_payload->'media_metadata'->>'mime_type' not in (
         'application/pdf'
       ))
       or (p_method = 'sendVoice' and p_payload->'media_metadata'->>'mime_type' not in (
         'audio/webm','audio/ogg','audio/mpeg'
       )) then
      raise exception 'bot_send_media_input_invalid' using errcode = '22023';
    end if;
  end if;

  if p_method = 'sendChatAction' then
    if not (p_payload ? 'action')
       or pg_catalog.jsonb_typeof(p_payload->'action') <> 'string'
       or p_payload->>'action' not in (
         'typing','upload_photo','upload_video','upload_document','record_voice'
       )
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in ('action','topic_id')
       ) then
      raise exception 'bot_chat_action_input_invalid' using errcode = '22023';
    end if;
    if nullif(p_payload->>'topic_id', '') is not null then
      if (p_payload->>'topic_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'bot_topic_invalid' using errcode = '22023';
      end if;
      v_topic_id := (p_payload->>'topic_id')::uuid;
    end if;
  elsif p_method = 'editMessageText' then
    if not (p_payload ? 'message_id')
       or not (p_payload ? 'text')
       or pg_catalog.jsonb_typeof(p_payload->'message_id') <> 'string'
       or pg_catalog.jsonb_typeof(p_payload->'text') <> 'string'
       or (p_payload->>'message_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.length(p_payload->>'text') not between 1 and 4096
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(p_payload) payload_key
         where payload_key not in ('message_id','text','reply_markup')
       ) then
      raise exception 'bot_edit_input_invalid' using errcode = '22023';
    end if;
    v_message_id := (p_payload->>'message_id')::uuid;
    v_text := p_payload->>'text';
    v_reply_markup := case
      when not (p_payload ? 'reply_markup')
        or p_payload->'reply_markup' = 'null'::jsonb then null
      else p_payload->'reply_markup'
    end;
    if not private.bot_inline_keyboard_valid(v_reply_markup) then
      raise exception 'bot_reply_markup_invalid' using errcode = '22023';
    end if;
  elsif p_method = 'deleteMessage' then
    if not (p_payload ? 'message_id')
       or pg_catalog.jsonb_typeof(p_payload->'message_id') <> 'string'
       or (p_payload->>'message_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 1 then
      raise exception 'bot_delete_input_invalid' using errcode = '22023';
    end if;
    v_message_id := (p_payload->>'message_id')::uuid;
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
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,
    p_idempotency_key,
    p_method,
    p_request_fingerprint
  );
  if coalesce((v_existing->>'found')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'result', v_existing->'result',
      'duplicate', true
    );
  end if;

  if p_method in ('sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice') then
    v_send_result := public.bot_send_message_internal(
      p_bot_id,
      p_chat_id,
      p_method,
      p_payload,
      p_idempotency_key
    );
    v_result := v_send_result - 'duplicate';
    perform private.bot_operation_idempotency_store(
      p_bot_id,
      p_idempotency_key,
      p_method,
      p_request_fingerprint,
      v_result
    );
    return pg_catalog.jsonb_build_object(
      'result', v_result,
      'duplicate', coalesce((v_send_result->>'duplicate')::boolean, false)
    );
  end if;

  if p_method = 'sendChatAction' then
    if v_topic_id is not null and not exists (
      select 1 from public.topics topic
      where topic.id = v_topic_id
        and topic.chat_id = p_chat_id
        and topic.archived is false
    ) then
      raise exception 'bot_topic_forbidden' using errcode = '42501';
    end if;
    v_result := pg_catalog.to_jsonb(true);
  else
    select message_row.*
    into v_target
    from public.messages message_row
    where message_row.id = v_message_id
      and message_row.chat_id = p_chat_id
      and message_row.bot_id = p_bot_id
      and message_row.deleted_at is null
    for update of message_row;
    if not found then
      raise exception 'bot_message_not_found' using errcode = 'P0002';
    end if;

    if p_method = 'editMessageText' then
      update public.messages message_row
      set content = v_text,
          bot_reply_markup = v_reply_markup,
          edited_at = pg_catalog.now()
      where message_row.id = v_target.id;
      v_result := pg_catalog.jsonb_build_object(
        'message_id', v_target.id,
        'chat_id', v_target.chat_id,
        'text', v_text,
        'reply_markup', v_reply_markup,
        'edited_at', pg_catalog.now()
      );
    else
      update public.messages message_row
      set deleted_at = pg_catalog.now()
      where message_row.id = v_target.id;
      v_result := pg_catalog.jsonb_build_object(
        'message_id', v_target.id,
        'chat_id', v_target.chat_id,
        'deleted', true
      );
    end if;
  end if;

  perform private.bot_operation_idempotency_store(
    p_bot_id,
    p_idempotency_key,
    p_method,
    p_request_fingerprint,
    v_result
  );
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
end
$function$;

revoke all on function public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)
  to service_role;

create or replace function public.bot_file_lookup_internal(
  p_bot_id uuid,
  p_chat_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_bot_id is null or p_chat_id is null or p_message_id is null then
    raise exception 'bot_file_input_invalid' using errcode = '22023';
  end if;
  if coalesce((public.bot_membership_authorize_internal(
       p_bot_id,
       p_chat_id,
       'read_file'
     )->>'allowed')::boolean, false) is not true then
    raise exception 'bot_chat_forbidden' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'message_id', message_row.id,
    'bucket_id', message_row.media_bucket,
    'object_path', message_row.media_path,
    'mime_type', nullif(pg_catalog.left(message_row.media_metadata->>'mime_type', 128), ''),
    'file_name', nullif(pg_catalog.left(message_row.media_metadata->>'file_name', 255), ''),
    'size_bytes', case
      when message_row.media_metadata->>'size' ~ '^[0-9]{1,12}$'
        then message_row.media_metadata->>'size'
      else null
    end
  ))
  into v_result
  from public.messages message_row
  where message_row.id = p_message_id
    and message_row.chat_id = p_chat_id
    and message_row.deleted_at is null
    and message_row.media_bucket is not null
    and message_row.media_bucket = 'chat-media'
    and message_row.media_path is not null
    and pg_catalog.octet_length(message_row.media_path) between 1 and 1024
    and private.bot_can_receive_message(p_bot_id, message_row.id);
  if v_result is null then
    raise exception 'bot_file_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end
$function$;

revoke all on function public.bot_file_lookup_internal(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_file_lookup_internal(uuid,uuid,uuid)
  to service_role;

create or replace function public.bot_callback_answer_internal(
  p_bot_id uuid,
  p_callback_query_id uuid,
  p_text text,
  p_show_alert boolean,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source_update_id bigint;
  v_existing jsonb;
  v_result jsonb := pg_catalog.to_jsonb(true);
begin
  if p_bot_id is null or p_callback_query_id is null
     or (p_text is not null and pg_catalog.length(p_text) not between 1 and 200)
     or p_show_alert is null
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_callback_answer_input_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.bots bot
    where bot.id = p_bot_id and bot.state = 'active'
  ) then
    raise exception 'bot_identity_not_found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0)
  );
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id,
    p_idempotency_key,
    'answerCallbackQuery',
    p_request_fingerprint
  );
  if coalesce((v_existing->>'found')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'result', v_existing->'result',
      'duplicate', true
    );
  end if;

  select queued.id
  into v_source_update_id
  from private.bot_updates queued
  where queued.bot_id = p_bot_id
    and queued.update_type = 'callback_query'
    and queued.payload#>>'{callback_query,id}' = p_callback_query_id::text
    and queued.expires_at > pg_catalog.now()
    and queued.created_at >= pg_catalog.now() - interval '10 minutes'
  order by queued.id desc
  limit 1;
  if v_source_update_id is null then
    raise exception 'bot_callback_not_found' using errcode = 'P0002';
  end if;

  insert into private.bot_callback_answers(
    bot_id,
    callback_query_id,
    source_update_id,
    text,
    show_alert
  ) values (
    p_bot_id,
    p_callback_query_id,
    v_source_update_id,
    p_text,
    p_show_alert
  );
  perform private.bot_operation_idempotency_store(
    p_bot_id,
    p_idempotency_key,
    'answerCallbackQuery',
    p_request_fingerprint,
    v_result
  );
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
exception
  when unique_violation then
    raise exception 'bot_callback_answer_conflict' using errcode = '23505';
end
$function$;

revoke all on function public.bot_callback_answer_internal(uuid,uuid,text,boolean,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_callback_answer_internal(uuid,uuid,text,boolean,text,text)
  to service_role;

create or replace function public.bot_update_enqueue_internal(
  p_bot_id uuid,
  p_update_type text,
  p_source_id uuid,
  p_context jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_update_id bigint;
  v_payload jsonb;
  v_message_chat_id uuid;
  v_actor_id uuid;
  v_callback_id uuid;
  v_callback_data text;
  v_membership public.chat_bot_members%rowtype;
  v_membership_action text;
begin
  if p_bot_id is null or p_source_id is null
     or p_update_type is null
     or p_update_type not in ('message','edited_message','callback_query','membership')
     or p_context is null
     or pg_catalog.jsonb_typeof(p_context) <> 'object'
     or pg_catalog.octet_length(p_context::text) > 4096
     or not exists (
       select 1 from public.bots bot
       where bot.id = p_bot_id and bot.state = 'active'
     ) then
    raise exception 'bot_update_input_invalid' using errcode = '22023';
  end if;

  if p_update_type in ('message','edited_message') then
    if p_context <> '{}'::jsonb then
      raise exception 'bot_update_context_invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.messages message_row
      join public.chat_bot_members member_row
        on member_row.chat_id = message_row.chat_id
       and member_row.bot_id = p_bot_id
      where message_row.id = p_source_id
        and member_row.removed_at is null
        and message_row.created_at >= member_row.joined_at
    ) then
      raise exception 'bot_update_history_forbidden' using errcode = '42501';
    end if;
    if private.bot_can_receive_message(p_bot_id, p_source_id) is not true then
      raise exception 'restricted_command_or_mention_required' using errcode = '42501';
    end if;
    v_payload := private.bot_message_update_payload(p_bot_id, p_source_id);
  elsif p_update_type = 'callback_query' then
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_context) context_key
      where context_key not in ('callback_id','actor_id','data')
    )
       or coalesce(p_context->>'callback_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(p_context->>'actor_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.octet_length(coalesce(p_context->>'data', '')) not between 1 and 128 then
      raise exception 'bot_update_context_invalid' using errcode = '22023';
    end if;
    v_callback_id := (p_context->>'callback_id')::uuid;
    v_actor_id := (p_context->>'actor_id')::uuid;
    v_callback_data := p_context->>'data';

    select message_row.chat_id
    into v_message_chat_id
    from public.messages message_row
    join public.chat_bot_members member_row
      on member_row.chat_id = message_row.chat_id
     and member_row.bot_id = p_bot_id
    where message_row.id = p_source_id
      and message_row.bot_id = p_bot_id
      and message_row.created_at >= member_row.joined_at
      and member_row.removed_at is null
      and exists (
        select 1
        from public.chat_members human_member
        where human_member.chat_id = message_row.chat_id
          and human_member.user_id = v_actor_id
          and human_member.hidden_at is null
      );
    if not found then
      raise exception 'bot_update_not_eligible' using errcode = '42501';
    end if;

    select pg_catalog.jsonb_build_object(
      'callback_query',
      pg_catalog.jsonb_build_object(
        'id', v_callback_id,
        'data', v_callback_data,
        'from', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'id', profile.id,
          'display_name', profile.full_name,
          'username', profile.username,
          'is_bot', false
        )),
        'message', pg_catalog.jsonb_build_object(
          'id', p_source_id,
          'chat_id', v_message_chat_id
        )
      )
    )
    into v_payload
    from public.profiles profile
    where profile.id = v_actor_id;
  else
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_context) context_key
      where context_key not in ('action','actor_id')
    )
       or p_context->>'action' not in ('added','removed','privacy_changed')
       or (
         nullif(p_context->>'actor_id', '') is not null
         and p_context->>'actor_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       ) then
      raise exception 'bot_update_context_invalid' using errcode = '22023';
    end if;
    v_membership_action := p_context->>'action';
    v_actor_id := nullif(p_context->>'actor_id', '')::uuid;

    select member_row.*
    into v_membership
    from public.chat_bot_members member_row
    where member_row.chat_id = p_source_id
      and member_row.bot_id = p_bot_id;
    if not found
       or (v_membership_action = 'removed' and v_membership.removed_at is null)
       or (v_membership_action <> 'removed' and v_membership.removed_at is not null) then
      raise exception 'bot_update_not_eligible' using errcode = '42501';
    end if;

    v_payload := pg_catalog.jsonb_build_object(
      'membership',
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'chat_id', v_membership.chat_id,
        'bot_id', v_membership.bot_id,
        'action', v_membership_action,
        'privacy_mode', v_membership.privacy_mode,
        'joined_at', v_membership.joined_at,
        'removed_at', v_membership.removed_at,
        'actor', (
          select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'id', profile.id,
            'display_name', profile.full_name,
            'username', profile.username
          ))
          from public.profiles profile
          where profile.id = v_actor_id
        )
      ))
    );
  end if;

  if v_payload is null
     or pg_catalog.jsonb_typeof(v_payload) <> 'object'
     or pg_catalog.octet_length(v_payload::text) > 65536 then
    raise exception 'bot_update_not_eligible' using errcode = '42501';
  end if;

  insert into private.bot_update_counters(bot_id, next_update_id)
  values (p_bot_id, 1)
  on conflict (bot_id) do update
  set next_update_id = private.bot_update_counters.next_update_id + 1
  returning next_update_id into v_update_id;

  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (p_bot_id, v_update_id, p_update_type, v_payload);

  insert into private.bot_delivery_attempts(bot_id, update_id)
  select p_bot_id, v_update_id
  from private.bot_webhooks webhook
  where webhook.bot_id = p_bot_id
    and webhook.state = 'enabled'
  on conflict (bot_id, update_id) do nothing;

  return v_update_id;
end
$function$;

revoke all on function public.bot_update_enqueue_internal(uuid,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_update_enqueue_internal(uuid,text,uuid,jsonb)
  to service_role;

create or replace function private.enqueue_bot_message_updates_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bot_id uuid;
begin
  for v_bot_id in
    select member_row.bot_id
    from public.chat_bot_members member_row
    where member_row.chat_id = new.chat_id
      and member_row.removed_at is null
      and member_row.bot_id is distinct from new.bot_id
  loop
    begin
      if private.bot_can_receive_message(v_bot_id, new.id) is true then
        perform public.bot_update_enqueue_internal(
          v_bot_id,
          'message',
          new.id,
          '{}'::jsonb
        );
      end if;
    exception
      when others then
        null;
    end;
  end loop;
  return null;
end
$function$;

revoke all on function private.enqueue_bot_message_updates_after_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_bot_message_updates_after_insert
  on public.messages;
create trigger trg_enqueue_bot_message_updates_after_insert
  after insert on public.messages
  for each row execute function private.enqueue_bot_message_updates_after_insert();

create or replace function private.enqueue_bot_message_updates_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bot_id uuid;
begin
  if row(
    old.content,
    old.media_bucket,
    old.media_path,
    old.media_metadata,
    old.topic_id,
    old.reply_to_id,
    old.bot_reply_markup
  ) is not distinct from row(
    new.content,
    new.media_bucket,
    new.media_path,
    new.media_metadata,
    new.topic_id,
    new.reply_to_id,
    new.bot_reply_markup
  ) then
    return null;
  end if;
  if coalesce(new.type, 'text') = 'system'
     or (new.user_id is null and new.bot_id is null) then
    return null;
  end if;

  for v_bot_id in
    select member_row.bot_id
    from public.chat_bot_members member_row
    where member_row.chat_id = new.chat_id
      and member_row.removed_at is null
      and member_row.bot_id is distinct from new.bot_id
  loop
    begin
      if private.bot_can_receive_message(v_bot_id, new.id) is true then
        perform public.bot_update_enqueue_internal(
          v_bot_id,
          'edited_message',
          new.id,
          '{}'::jsonb
        );
      end if;
    exception
      when others then
        null;
    end;
  end loop;
  return null;
end
$function$;

revoke all on function private.enqueue_bot_message_updates_after_update()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_bot_message_updates_after_update
  on public.messages;
create trigger trg_enqueue_bot_message_updates_after_update
  after update of content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup
  on public.messages
  for each row execute function private.enqueue_bot_message_updates_after_update();

create or replace function private.enqueue_bot_membership_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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

revoke all on function private.enqueue_bot_membership_update()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_bot_membership_updates
  on public.chat_bot_members;
create trigger trg_enqueue_bot_membership_updates
  after insert or update of privacy_mode, removed_at on public.chat_bot_members
  for each row execute function private.enqueue_bot_membership_update();

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
set search_path = ''
as $function$
begin
  if p_bot_id is null
     or p_offset is null
     or p_limit is null
     or p_offset < 0
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
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if p_bot_id is null
     or p_through_update_id is null
     or p_through_update_id < 0 then
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
  p_secret_ciphertext text,
  p_secret_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lease_token uuid := pg_catalog.gen_random_uuid();
begin
  -- The gateway performs DNS, address-range and redirect validation before this
  -- trusted persistence boundary. The database still enforces HTTPS, bounded
  -- input and credential-free authority syntax.
  if p_bot_id is null
     or p_url is null
     or p_secret_ciphertext is null
     or p_secret_fingerprint is null
     or pg_catalog.octet_length(p_url) not between 10 and 2048
     or p_url !~ '^https://[^/@[:space:]]+(?::[0-9]{1,5})?(/|$)'
     or p_url ~ '^https://[^/]*@'
     or pg_catalog.octet_length(p_secret_ciphertext) not between 55 and 4103
     or p_secret_ciphertext !~ '^enc:v1:[A-Za-z0-9_-]+$'
     or p_secret_fingerprint !~ '^[0-9a-f]{16,64}$'
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
    secret_ciphertext,
    secret_fingerprint,
    state,
    failure_count,
    last_error_code,
    updated_at
  ) values (
    p_bot_id,
    p_url,
    p_secret_ciphertext,
    p_secret_fingerprint,
    'enabled',
    0,
    null,
    pg_catalog.now()
  )
  on conflict (bot_id) do update
  set target_url = excluded.target_url,
      secret_ciphertext = excluded.secret_ciphertext,
      secret_fingerprint = excluded.secret_fingerprint,
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

revoke all on function public.bot_webhook_set_internal(uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_webhook_set_internal(uuid,text,text,text)
  to service_role;

create or replace function public.bot_webhook_delete_internal(
  p_bot_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
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
  secret_ciphertext text,
  secret_fingerprint text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_limit is null
     or p_limit not between 1 and 100
     or p_claim_token is null then
    raise exception 'bot_delivery_claim_input_invalid' using errcode = '22023';
  end if;

  with stale_candidates as (
    select attempt.id
    from private.bot_delivery_attempts attempt
    where attempt.status = 'claimed'
      and attempt.claimed_at <= pg_catalog.now() - interval '2 minutes'
    order by attempt.claimed_at, attempt.id
    limit least(p_limit, 100)
    for update of attempt skip locked
  )
  update private.bot_delivery_attempts attempt
  set status = case
        when attempt.attempt_count >= 12 then 'dead_letter'
        else 'retry'
      end,
      available_at = case
        when attempt.attempt_count >= 12 then attempt.available_at
        else pg_catalog.now()
      end,
      claim_token = null,
      claimed_at = null,
      error_code = 'worker_claim_timeout',
      updated_at = pg_catalog.now(),
      completed_at = case
        when attempt.attempt_count >= 12 then pg_catalog.now()
        else null
      end
  from stale_candidates stale
  where attempt.id = stale.id;

  return query
  with candidates as (
    select attempt.id
    from private.bot_delivery_attempts attempt
    join private.bot_updates queued
      on queued.bot_id = attempt.bot_id
     and queued.update_id = attempt.update_id
    join private.bot_webhooks webhook on webhook.bot_id = attempt.bot_id
    join public.bots bot on bot.id = attempt.bot_id
    where attempt.status in ('pending','retry')
      and attempt.attempt_count < 12
      and attempt.available_at <= pg_catalog.now()
      and queued.acknowledged_at is null
      and queued.expires_at > pg_catalog.now()
      and webhook.state = 'enabled'
      and bot.state = 'active'
    order by attempt.available_at, attempt.id
    limit least(p_limit, 100)
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
    webhook.secret_ciphertext,
    webhook.secret_fingerprint,
    queued.payload,
    claimed.attempt_count
  from claimed
  join private.bot_updates queued
    on queued.bot_id = claimed.bot_id
   and queued.update_id = claimed.update_id
  join private.bot_webhooks webhook on webhook.bot_id = claimed.bot_id
  order by claimed.id;
end
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
set search_path = ''
as $function$
declare
  v_attempt private.bot_delivery_attempts%rowtype;
  v_next_status text;
begin
  if p_attempt_id is null or p_claim_token is null
     or p_status is null
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
set search_path = ''
as $function$
declare
  v_updates integer := 0;
  v_attempts integer := 0;
  v_limits integer := 0;
  v_idempotency integer := 0;
  v_operation_idempotency integer := 0;
  v_callback_answers integer := 0;
  v_upload_grants integer := 0;
begin
  if p_now is null
     or p_limit is null
     or p_limit not between 1 and 1000
     or p_now > pg_catalog.now() + interval '1 minute' then
    raise exception 'bot_cleanup_input_invalid' using errcode = '22023';
  end if;

  with doomed as (
    select answer.bot_id, answer.callback_query_id
    from private.bot_callback_answers answer
    where answer.answered_at < p_now - interval '24 hours'
    order by answer.answered_at, answer.bot_id
    limit p_limit
    for update of answer skip locked
  )
  delete from private.bot_callback_answers answer
  using doomed
  where answer.bot_id = doomed.bot_id
    and answer.callback_query_id = doomed.callback_query_id;
  get diagnostics v_callback_answers = row_count;

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

  with doomed as (
    select operation_row.bot_id, operation_row.idempotency_key
    from private.bot_operation_idempotency operation_row
    where operation_row.created_at < p_now - interval '24 hours'
    order by operation_row.created_at, operation_row.bot_id
    limit p_limit
    for update of operation_row skip locked
  )
  delete from private.bot_operation_idempotency operation_row
  using doomed
  where operation_row.bot_id = doomed.bot_id
    and operation_row.idempotency_key = doomed.idempotency_key;
  get diagnostics v_operation_idempotency = row_count;

  delete from private.bot_delivery_leases lease
  where lease.expires_at <= p_now;

  with doomed as (
    select upload_grant.id
    from private.bot_upload_grants upload_grant
    where upload_grant.expires_at <= p_now
       or upload_grant.consumed_at <= p_now - interval '24 hours'
    order by coalesce(upload_grant.consumed_at, upload_grant.expires_at),
      upload_grant.id
    limit p_limit
    for update of upload_grant skip locked
  )
  delete from private.bot_upload_grants upload_grant
  using doomed
  where upload_grant.id = doomed.id;
  get diagnostics v_upload_grants = row_count;

  return pg_catalog.jsonb_build_object(
    'updates_deleted', v_updates,
    'attempts_deleted', v_attempts,
    'rate_limits_deleted', v_limits,
    'idempotency_deleted', v_idempotency,
    'operation_idempotency_deleted', v_operation_idempotency,
    'callback_answers_deleted', v_callback_answers,
    'upload_grants_deleted', v_upload_grants
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
set search_path = ''
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
        pg_catalog.regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g'),
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
    pg_catalog.jsonb_build_object(
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
