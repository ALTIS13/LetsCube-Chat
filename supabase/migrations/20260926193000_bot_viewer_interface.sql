-- Private, short-lived bot panels. Not a message or a Realtime publication.
-- Rollback: .migration-backup/supabase/migrations/20260926193000_bot_viewer_interface.rollback.sql
-- Apply only after a verified backup and transactional rehearsal.
begin;
set local lock_timeout = '5s';

do $prestate$
declare
  v_method text;
  v_poll text;
  v_prepare text;
  v_guard text;
begin
  if pg_catalog.to_regclass('private.bot_viewer_interfaces') is not null
     or pg_catalog.to_regclass('private.bot_callback_interface_grants') is not null
     or pg_catalog.to_regprocedure('public.bot_viewer_interface_press(uuid,integer,text)') is not null
     or pg_catalog.to_regprocedure('public.bot_viewer_delivery_recheck_internal(bigint,uuid)') is not null
     or pg_catalog.to_regprocedure('private.bot_update_still_visible(uuid,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.bot_update_enqueue_internal(uuid,text,uuid,jsonb)') is null then
    raise exception 'bot_viewer_interface_prestate_drift';
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid) into v_method
  from pg_catalog.pg_constraint c
  where c.conrelid = 'private.bot_operation_idempotency'::regclass
    and c.conname = 'bot_operation_idempotency_method_check';
  v_poll := pg_catalog.pg_get_functiondef('public.bot_updates_poll_internal(uuid,bigint,integer,text[],uuid)'::regprocedure);
  v_prepare := pg_catalog.pg_get_functiondef('public.bot_delivery_prepare_internal(bigint,uuid,bigint)'::regprocedure);
  v_guard := pg_catalog.pg_get_functiondef('private.bot_update_still_visible(uuid,text,jsonb)'::regprocedure);
  if v_method is null or pg_catalog.strpos(v_method, 'answerCallbackQuery') = 0
     or pg_catalog.strpos(v_method, 'setViewerInterface') <> 0
     or pg_catalog.strpos(v_poll, 'private.bot_update_still_visible(p_bot_id, queued.update_type, queued.payload)') = 0
     or pg_catalog.strpos(v_prepare, 'private.bot_update_still_visible(v_attempt.bot_id, v_update_type, v_payload)') = 0
     or pg_catalog.strpos(v_guard, 'private.bot_can_receive_message(p_bot_id, v_message_id::uuid)') = 0
     or pg_catalog.strpos(v_guard, 'viewer_interface_id') <> 0 then
    raise exception 'bot_viewer_interface_prestate_drift';
  end if;
end
$prestate$;

alter table private.bot_operation_idempotency
  drop constraint bot_operation_idempotency_method_check;
alter table private.bot_operation_idempotency
  add constraint bot_operation_idempotency_method_check check (method in (
    'sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice',
    'sendChatAction','editMessageText','deleteMessage','setMyCommands',
    'answerCallbackQuery','setWebhook','deleteWebhook',
    'setViewerInterface','editViewerInterface','closeViewerInterface'
  ));

create table private.bot_callback_interface_grants (
  callback_query_id uuid primary key,
  bot_id uuid not null references public.bots(id) on delete cascade,
  token_id uuid not null references private.bot_tokens(id) on delete cascade,
  source_message_id uuid not null,
  chat_id uuid not null,
  viewer_id uuid not null,
  viewer_joined_at timestamptz not null,
  bot_joined_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  constraint bot_callback_interface_grants_ttl_check check (
    expires_at = created_at + interval '10 minutes'
  )
);
create index bot_callback_interface_grants_expiry_idx
  on private.bot_callback_interface_grants(expires_at, callback_query_id);

create table private.bot_viewer_interfaces (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  source_callback_id uuid not null unique,
  source_message_id uuid not null,
  chat_id uuid not null,
  viewer_id uuid not null,
  viewer_joined_at timestamptz not null,
  bot_joined_at timestamptz not null,
  creator_token_id uuid not null references private.bot_tokens(id) on delete cascade,
  state jsonb not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  constraint bot_viewer_interfaces_ttl_check check (
    expires_at = created_at + interval '15 minutes'
  ),
  constraint bot_viewer_interfaces_closed_check check (
    closed_at is null or closed_at >= created_at
  )
);
create index bot_viewer_interfaces_actor_idx
  on private.bot_viewer_interfaces(chat_id, viewer_id, expires_at desc)
  where closed_at is null;
create index bot_viewer_interfaces_expiry_idx
  on private.bot_viewer_interfaces(expires_at, id);

create table private.bot_viewer_interface_actions (
  callback_query_id uuid primary key,
  interface_id uuid not null references private.bot_viewer_interfaces(id) on delete cascade,
  panel_version integer not null check (panel_version > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on table private.bot_callback_interface_grants,
  private.bot_viewer_interfaces, private.bot_viewer_interface_actions
  from public, anon, authenticated, service_role;
alter table private.bot_callback_interface_grants enable row level security;
alter table private.bot_viewer_interfaces enable row level security;
alter table private.bot_viewer_interface_actions enable row level security;

create function private.bot_viewer_state_valid(p_state jsonb)
returns boolean language plpgsql immutable security definer
set search_path = '' as $function$
declare
  v_row jsonb;
  v_button jsonb;
  v_keys text[] := '{}'::text[];
  v_count integer := 0;
begin
  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object' then
    return false;
  end if;
  if pg_catalog.octet_length(p_state::text) > 4096
     or not (p_state ? 'title')
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_state) k
                where k not in ('title','body','progress','buttons')) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_state->'title') <> 'string'
     or pg_catalog.length(p_state->>'title') not between 1 and 64
     or pg_catalog.btrim(p_state->>'title') = ''
     or (p_state ? 'body' and (
       pg_catalog.jsonb_typeof(p_state->'body') <> 'string'
       or pg_catalog.length(p_state->>'body') > 512
     )) then
    return false;
  end if;
  if p_state ? 'buttons' then
    if pg_catalog.jsonb_typeof(p_state->'buttons') <> 'array' then return false; end if;
    if pg_catalog.jsonb_array_length(p_state->'buttons') > 3 then return false; end if;
  end if;
  if p_state ? 'progress' and (
    pg_catalog.jsonb_typeof(p_state->'progress') <> 'number'
    or (p_state->>'progress') !~ '^(0|[1-9][0-9]?|100)$'
  ) then
    return false;
  end if;
  for v_row in select value from pg_catalog.jsonb_array_elements(p_state->'buttons') loop
    if pg_catalog.jsonb_typeof(v_row) <> 'array' then return false; end if;
    if pg_catalog.jsonb_array_length(v_row) not between 1 and 6 then return false; end if;
    for v_button in select value from pg_catalog.jsonb_array_elements(v_row) loop
      v_count := v_count + 1;
      if v_count > 6 or pg_catalog.jsonb_typeof(v_button) <> 'object' then return false; end if;
      if not (v_button ? 'text') or not (v_button ? 'key')
         or not (v_button ? 'callback_data')
         or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_button)) <> 3
         or pg_catalog.jsonb_typeof(v_button->'text') <> 'string'
         or pg_catalog.length(v_button->>'text') not between 1 and 64
         or pg_catalog.btrim(v_button->>'text') = ''
         or pg_catalog.jsonb_typeof(v_button->'key') <> 'string'
          or (v_button->>'key') !~ '^[A-Za-z0-9._:-]{1,32}$'
         or pg_catalog.jsonb_typeof(v_button->'callback_data') <> 'string'
         or pg_catalog.octet_length(v_button->>'callback_data') not between 1 and 128 then
        return false;
      end if;
      if (v_button->>'key') = any(v_keys) then return false; end if;
      v_keys := pg_catalog.array_append(v_keys, v_button->>'key');
    end loop;
  end loop;
  return true;
end
$function$;
revoke all on function private.bot_viewer_state_valid(jsonb)
  from public, anon, authenticated, service_role;
alter table private.bot_viewer_interfaces
  add constraint bot_viewer_interfaces_state_check
  check (private.bot_viewer_state_valid(state));

create function private.bot_viewer_source_valid(
  p_bot_id uuid, p_chat_id uuid, p_viewer_id uuid, p_message_id uuid,
  p_viewer_joined_at timestamptz, p_bot_joined_at timestamptz
) returns boolean language sql volatile security definer
set search_path = '' as $function$
  select exists (
    select 1 from public.bots b
    join public.chat_bot_members bm on bm.bot_id = b.id
    join public.chat_members hm on hm.chat_id = bm.chat_id
    join public.messages m on m.chat_id = bm.chat_id
    join public.chats c on c.id = bm.chat_id
    where b.id = p_bot_id and b.state = 'active'
      and bm.chat_id = p_chat_id and bm.bot_id = p_bot_id
      and bm.removed_at is null and bm.joined_at = p_bot_joined_at
      and hm.user_id = p_viewer_id and hm.hidden_at is null
      and hm.joined_at = p_viewer_joined_at
      and m.id = p_message_id and m.bot_id = p_bot_id
      and m.deleted_at is null and m.created_at >= bm.joined_at
      and c.type = 'group'
  );
$function$;
revoke all on function private.bot_viewer_source_valid(uuid,uuid,uuid,uuid,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

create function private.bot_viewer_interface_valid(p_id uuid)
returns boolean language sql volatile security definer
set search_path = '' as $function$
  select exists (
    select 1 from private.bot_viewer_interfaces panel
    join private.bot_tokens token on token.id = panel.creator_token_id
    where panel.id = p_id and panel.closed_at is null
      and panel.expires_at > pg_catalog.clock_timestamp()
      and token.bot_id = panel.bot_id and token.revoked_at is null
      and private.bot_viewer_source_valid(
        panel.bot_id, panel.chat_id, panel.viewer_id, panel.source_message_id,
        panel.viewer_joined_at, panel.bot_joined_at
      )
  );
$function$;
revoke all on function private.bot_viewer_interface_valid(uuid)
  from public, anon, authenticated, service_role;

-- The queued callback is validated by bot_update_enqueue_internal; capture its
-- identity here, before ACK cleanup can delete the queue row.
create function private.bot_viewer_grant_on_callback()
returns trigger language plpgsql security definer
set search_path = '' as $function$
declare
  v_callback text;
  v_actor text;
  v_message text;
  v_chat text;
  v_human_joined timestamptz;
  v_bot_joined timestamptz;
  v_token_id uuid;
  v_created timestamptz := pg_catalog.clock_timestamp();
begin
  if new.update_type <> 'callback_query' then return new; end if;
  v_callback := new.payload #>> '{callback_query,id}';
  v_actor := new.payload #>> '{callback_query,from,id}';
  v_message := new.payload #>> '{callback_query,message,id}';
  v_chat := new.payload #>> '{callback_query,message,chat_id}';
  if v_callback is null or v_actor is null or v_message is null or v_chat is null
     or v_callback !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_message !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_chat !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'bot_viewer_callback_invalid' using errcode = '22023';
  end if;
  select hm.joined_at, bm.joined_at, token.id
  into v_human_joined, v_bot_joined, v_token_id
  from public.messages m
  join public.chat_bot_members bm on bm.chat_id = m.chat_id and bm.bot_id = m.bot_id
  join public.chat_members hm on hm.chat_id = m.chat_id
  join public.bots b on b.id = m.bot_id
  join private.bot_tokens token on token.bot_id = b.id and token.revoked_at is null
  join public.chats c on c.id = m.chat_id
  where m.id = v_message::uuid and m.chat_id = v_chat::uuid
    and m.bot_id = new.bot_id and m.deleted_at is null
    and m.created_at >= bm.joined_at and bm.removed_at is null
    and hm.user_id = v_actor::uuid and hm.hidden_at is null
    and b.state = 'active' and c.type = 'group'
  for share of m, bm, hm, b, token;
  if not found then
    -- Direct/private-chat callbacks still work; they cannot create a group panel.
    return new;
  end if;
  insert into private.bot_callback_interface_grants(
    callback_query_id, bot_id, token_id, source_message_id, chat_id, viewer_id,
    viewer_joined_at, bot_joined_at, created_at, expires_at
  ) values (
    v_callback::uuid, new.bot_id, v_token_id, v_message::uuid, v_chat::uuid, v_actor::uuid,
    v_human_joined, v_bot_joined, v_created, v_created + interval '10 minutes'
  );
  return new;
end
$function$;
revoke all on function private.bot_viewer_grant_on_callback()
  from public, anon, authenticated, service_role;
create trigger trg_bot_viewer_grant_on_callback
  after insert on private.bot_updates
  for each row execute function private.bot_viewer_grant_on_callback();

create function private.bot_viewer_revoke_on_change()
returns trigger language plpgsql security definer
set search_path = '' as $function$
begin
  if tg_table_schema = 'public' and tg_table_name = 'chat_members' then
    if tg_op = 'DELETE' then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.chat_id = old.chat_id and grant_row.viewer_id = old.user_id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.chat_id = old.chat_id and panel.viewer_id = old.user_id
        and panel.closed_at is null;
    elsif new.hidden_at is not null or new.joined_at is distinct from old.joined_at then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.chat_id = old.chat_id and grant_row.viewer_id = old.user_id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.chat_id = old.chat_id and panel.viewer_id = old.user_id
        and panel.closed_at is null;
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'chat_bot_members' then
    if tg_op = 'DELETE' then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.chat_id = old.chat_id and grant_row.bot_id = old.bot_id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.chat_id = old.chat_id and panel.bot_id = old.bot_id
        and panel.closed_at is null;
    elsif new.removed_at is not null or new.joined_at is distinct from old.joined_at then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.chat_id = old.chat_id and grant_row.bot_id = old.bot_id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.chat_id = old.chat_id and panel.bot_id = old.bot_id
        and panel.closed_at is null;
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'messages' then
    if tg_op = 'DELETE' then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.source_message_id = old.id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.source_message_id = old.id and panel.closed_at is null;
    elsif new.deleted_at is not null then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.source_message_id = old.id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.source_message_id = old.id and panel.closed_at is null;
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'bots' then
    if new.state <> 'active' then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.bot_id = old.id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.bot_id = old.id and panel.closed_at is null;
    end if;
  elsif tg_table_schema = 'private' and tg_table_name = 'bot_tokens' then
    if new.revoked_at is not null then
      delete from private.bot_callback_interface_grants grant_row
      where grant_row.token_id = old.id;
      update private.bot_viewer_interfaces panel
      set closed_at = pg_catalog.clock_timestamp(), version = version + 1
      where panel.creator_token_id = old.id and panel.closed_at is null;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;
revoke all on function private.bot_viewer_revoke_on_change()
  from public, anon, authenticated, service_role;
create trigger trg_bot_viewer_human_revoke
  after update of hidden_at, joined_at or delete on public.chat_members
  for each row execute function private.bot_viewer_revoke_on_change();
create trigger trg_bot_viewer_bot_member_revoke
  after update of removed_at, joined_at or delete on public.chat_bot_members
  for each row execute function private.bot_viewer_revoke_on_change();
create trigger trg_bot_viewer_source_revoke
  after update of deleted_at or delete on public.messages
  for each row execute function private.bot_viewer_revoke_on_change();
create trigger trg_bot_viewer_bot_state_revoke
  after update of state on public.bots
  for each row execute function private.bot_viewer_revoke_on_change();
create trigger trg_bot_viewer_token_revoke
  after update of revoked_at on private.bot_tokens
  for each row execute function private.bot_viewer_revoke_on_change();

-- Gateway must pass the token ID obtained by authenticating this request.
-- These are six/seven/six arguments, rather than the plan's provisional
-- signatures, because database-side token validation is mandatory.
create function public.bot_viewer_interface_set_internal(
  p_bot_id uuid, p_token_id uuid, p_callback_query_id uuid,
  p_state jsonb, p_idempotency_key text, p_request_fingerprint text
) returns jsonb language plpgsql security definer
set search_path = '' as $function$
declare
  v_grant private.bot_callback_interface_grants%rowtype;
  v_existing jsonb;
  v_result jsonb;
  v_id uuid;
  v_created timestamptz;
  v_total integer;
  v_bot_count integer;
begin
  if p_bot_id is null or p_token_id is null or p_callback_query_id is null
     or private.bot_viewer_state_valid(p_state) is not true
     or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or p_idempotency_key is null or p_request_fingerprint is null then
    raise exception 'bot_viewer_input_invalid' using errcode = '22023';
  end if;
  perform 1 from public.bots b where b.id = p_bot_id and b.state = 'active' for share;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  perform 1 from private.bot_tokens t
  where t.id = p_token_id and t.bot_id = p_bot_id and t.revoked_at is null for share;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0));
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id, p_idempotency_key, 'setViewerInterface', p_request_fingerprint);
  if (v_existing->>'found')::boolean then
    v_result := v_existing->'result';
    if not exists (select 1 from private.bot_viewer_interfaces p
       where p.id = (v_result->>'interface_id')::uuid and p.creator_token_id = p_token_id
         and p.source_callback_id = p_callback_query_id) then
      raise exception 'bot_viewer_forbidden' using errcode = '42501';
    end if;
    return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', true);
  end if;
  select g.* into v_grant from private.bot_callback_interface_grants g
  where g.callback_query_id = p_callback_query_id and g.bot_id = p_bot_id
    and g.token_id = p_token_id
    and g.expires_at > pg_catalog.clock_timestamp() for update;
  if not found or not private.bot_viewer_source_valid(
    v_grant.bot_id, v_grant.chat_id, v_grant.viewer_id,
    v_grant.source_message_id, v_grant.viewer_joined_at, v_grant.bot_joined_at
  ) then
    raise exception 'bot_viewer_callback_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.bot_viewer_interfaces p
             where p.source_callback_id = p_callback_query_id) then
    raise exception 'bot_viewer_callback_conflict' using errcode = '23505';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_grant.chat_id::text || ':' || v_grant.viewer_id::text, 1));
  select pg_catalog.count(*), pg_catalog.count(*) filter (where p.bot_id = p_bot_id)
    into v_total, v_bot_count
  from private.bot_viewer_interfaces p
  where p.chat_id = v_grant.chat_id and p.viewer_id = v_grant.viewer_id
    and private.bot_viewer_interface_valid(p.id);
  if v_total >= 8 or v_bot_count >= 3 then
    raise exception 'bot_viewer_capacity_exceeded' using errcode = '54000';
  end if;
  if v_grant.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'bot_viewer_callback_not_found' using errcode = 'P0002';
  end if;
  v_id := pg_catalog.gen_random_uuid();
  v_created := pg_catalog.clock_timestamp();
  insert into private.bot_viewer_interfaces(
    id, bot_id, source_callback_id, source_message_id, chat_id,
    viewer_id, viewer_joined_at, bot_joined_at, creator_token_id,
    state, created_at, expires_at
  ) values (
    v_id, p_bot_id, p_callback_query_id, v_grant.source_message_id,
    v_grant.chat_id, v_grant.viewer_id, v_grant.viewer_joined_at,
    v_grant.bot_joined_at, p_token_id, p_state, v_created,
    v_created + interval '15 minutes'
  );
  v_result := pg_catalog.jsonb_build_object(
    'interface_id', v_id, 'version', 1,
    'expires_at', v_created + interval '15 minutes');
  perform private.bot_operation_idempotency_store(
    p_bot_id, p_idempotency_key, 'setViewerInterface', p_request_fingerprint, v_result);
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
end
$function$;
revoke all on function public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)
  to service_role;

create function public.bot_viewer_interface_edit_internal(
  p_bot_id uuid, p_token_id uuid, p_interface_id uuid,
  p_expected_version integer, p_state jsonb,
  p_idempotency_key text, p_request_fingerprint text
) returns jsonb language plpgsql security definer
set search_path = '' as $function$
declare
  v_panel private.bot_viewer_interfaces%rowtype;
  v_existing jsonb;
  v_result jsonb;
begin
  if p_bot_id is null or p_token_id is null or p_interface_id is null
     or p_expected_version is null or p_expected_version < 1
     or private.bot_viewer_state_valid(p_state) is not true
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_viewer_input_invalid' using errcode = '22023';
  end if;
  perform 1 from public.bots b where b.id = p_bot_id and b.state = 'active' for share;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  perform 1 from private.bot_tokens t
  where t.id = p_token_id and t.bot_id = p_bot_id and t.revoked_at is null for share;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0));
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id, p_idempotency_key, 'editViewerInterface', p_request_fingerprint);
  if (v_existing->>'found')::boolean then
    v_result := v_existing->'result';
    if (v_result->>'interface_id')::uuid <> p_interface_id
       or not exists (select 1 from private.bot_viewer_interfaces p
                      where p.id = p_interface_id and p.creator_token_id = p_token_id) then
      raise exception 'bot_viewer_forbidden' using errcode = '42501';
    end if;
    return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', true);
  end if;
  select p.* into v_panel from private.bot_viewer_interfaces p
  where p.id = p_interface_id and p.bot_id = p_bot_id
    and p.creator_token_id = p_token_id for update;
  if not found or not private.bot_viewer_interface_valid(p_interface_id) then
    raise exception 'bot_viewer_forbidden' using errcode = '42501';
  end if;
  if v_panel.version <> p_expected_version then
    raise exception 'bot_viewer_version_conflict' using errcode = '40001';
  end if;
  update private.bot_viewer_interfaces p
  set state = p_state, version = version + 1
  where p.id = p_interface_id;
  v_result := pg_catalog.jsonb_build_object(
    'interface_id', p_interface_id, 'version', v_panel.version + 1,
    'expires_at', v_panel.expires_at);
  perform private.bot_operation_idempotency_store(
    p_bot_id, p_idempotency_key, 'editViewerInterface', p_request_fingerprint, v_result);
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
end
$function$;
revoke all on function public.bot_viewer_interface_edit_internal(uuid,uuid,uuid,integer,jsonb,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interface_edit_internal(uuid,uuid,uuid,integer,jsonb,text,text)
  to service_role;

create function public.bot_viewer_interface_close_internal(
  p_bot_id uuid, p_token_id uuid, p_interface_id uuid,
  p_expected_version integer, p_idempotency_key text, p_request_fingerprint text
) returns jsonb language plpgsql security definer
set search_path = '' as $function$
declare
  v_panel private.bot_viewer_interfaces%rowtype;
  v_existing jsonb;
  v_result jsonb;
  v_closed_at timestamptz;
begin
  if p_bot_id is null or p_token_id is null or p_interface_id is null
     or p_expected_version is null or p_expected_version < 1
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'bot_viewer_input_invalid' using errcode = '22023';
  end if;
  perform 1 from public.bots b where b.id = p_bot_id and b.state = 'active' for share;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  perform 1 from private.bot_tokens t
  where t.id = p_token_id and t.bot_id = p_bot_id and t.revoked_at is null for share;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bot_id::text || ':' || p_idempotency_key, 0));
  v_existing := private.bot_operation_idempotency_lookup(
    p_bot_id, p_idempotency_key, 'closeViewerInterface', p_request_fingerprint);
  if (v_existing->>'found')::boolean then
    v_result := v_existing->'result';
    if (v_result->>'interface_id')::uuid <> p_interface_id
       or not exists (select 1 from private.bot_viewer_interfaces p
                      where p.id = p_interface_id and p.creator_token_id = p_token_id) then
      raise exception 'bot_viewer_forbidden' using errcode = '42501';
    end if;
    return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', true);
  end if;
  select p.* into v_panel from private.bot_viewer_interfaces p
  where p.id = p_interface_id and p.bot_id = p_bot_id
    and p.creator_token_id = p_token_id for update;
  if not found or not private.bot_viewer_interface_valid(p_interface_id) then
    raise exception 'bot_viewer_forbidden' using errcode = '42501';
  end if;
  if v_panel.version <> p_expected_version then
    raise exception 'bot_viewer_version_conflict' using errcode = '40001';
  end if;
  v_closed_at := pg_catalog.clock_timestamp();
  update private.bot_viewer_interfaces p
  set closed_at = v_closed_at, version = version + 1
  where p.id = p_interface_id;
  v_result := pg_catalog.jsonb_build_object('interface_id', p_interface_id,
    'version', v_panel.version + 1, 'closed_at', v_closed_at);
  perform private.bot_operation_idempotency_store(
    p_bot_id, p_idempotency_key, 'closeViewerInterface', p_request_fingerprint, v_result);
  return pg_catalog.jsonb_build_object('result', v_result, 'duplicate', false);
end
$function$;
revoke all on function public.bot_viewer_interface_close_internal(uuid,uuid,uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interface_close_internal(uuid,uuid,uuid,integer,text,text)
  to service_role;

create function public.bot_viewer_interfaces_for_actor(p_chat_id uuid)
returns jsonb language plpgsql security definer
set search_path = '' as $function$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_chat_id is null then raise exception 'bot_viewer_input_invalid' using errcode = '22023'; end if;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', p.id, 'bot_id', p.bot_id,
      'callback_query_id', p.source_callback_id,
      'source_message_id', p.source_message_id,
      'version', p.version, 'expires_at', p.expires_at,
      'state', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'title', p.state->'title',
        'body', p.state->'body',
        'progress', p.state->'progress',
        'buttons', case when p.state ? 'buttons' then coalesce((
          select pg_catalog.jsonb_agg((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'text', button->>'text', 'key', button->>'key'))
            from pg_catalog.jsonb_array_elements(row_value) button
          ))
          from pg_catalog.jsonb_array_elements(p.state->'buttons') row_value
        ), '[]'::jsonb) else null end
      ))
    ) order by p.created_at desc, p.id), '[]'::jsonb)
  into v_result
  from (
    select panel.* from private.bot_viewer_interfaces panel
    where panel.chat_id = p_chat_id and panel.viewer_id = v_actor
      and private.bot_viewer_interface_valid(panel.id)
    order by panel.created_at desc, panel.id
    limit 8
  ) p;
  return v_result;
end
$function$;
revoke all on function public.bot_viewer_interfaces_for_actor(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interfaces_for_actor(uuid)
  to authenticated;

create function public.bot_viewer_interface_dismiss(p_interface_id uuid, p_expected_version integer)
returns boolean language plpgsql security definer
set search_path = '' as $function$
declare
  v_actor uuid := auth.uid();
  v_panel private.bot_viewer_interfaces%rowtype;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_interface_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'bot_viewer_input_invalid' using errcode = '22023';
  end if;
  select p.* into v_panel from private.bot_viewer_interfaces p
  where p.id = p_interface_id and p.viewer_id = v_actor for update;
  if not found or not private.bot_viewer_interface_valid(p_interface_id) then
    return false;
  end if;
  if v_panel.version <> p_expected_version then
    raise exception 'bot_viewer_version_conflict' using errcode = '40001';
  end if;
  update private.bot_viewer_interfaces p
  set closed_at = pg_catalog.clock_timestamp(), version = version + 1
  where p.id = p_interface_id;
  return true;
end
$function$;
revoke all on function public.bot_viewer_interface_dismiss(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interface_dismiss(uuid,integer)
  to authenticated;

create function public.bot_viewer_interface_press(
  p_interface_id uuid, p_expected_version integer, p_button_key text
) returns uuid language plpgsql security definer
set search_path = '' as $function$
declare
  v_actor uuid := auth.uid();
  v_panel private.bot_viewer_interfaces%rowtype;
  v_data text;
  v_callback_id uuid;
  v_update_id bigint;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_interface_id is null or p_expected_version is null or p_expected_version < 1
     or p_button_key is null or pg_catalog.length(p_button_key) not between 1 and 32 then
    raise exception 'bot_viewer_input_invalid' using errcode = '22023';
  end if;
  select p.* into v_panel from private.bot_viewer_interfaces p
  where p.id = p_interface_id and p.viewer_id = v_actor;
  if not found then raise exception 'bot_viewer_forbidden' using errcode = '42501'; end if;
  -- Revocation triggers lock the source row before the panel. Keep the same
  -- order when an action enqueues a callback, then recheck under the panel lock.
  perform 1 from public.bots b where b.id = v_panel.bot_id for share;
  perform 1 from private.bot_tokens token
  where token.id = v_panel.creator_token_id for share;
  perform 1 from public.messages m
  where m.id = v_panel.source_message_id for share;
  perform 1 from public.chat_bot_members bm
  where bm.chat_id = v_panel.chat_id and bm.bot_id = v_panel.bot_id for share;
  perform 1 from public.chat_members hm
  where hm.chat_id = v_panel.chat_id and hm.user_id = v_actor for share;
  select p.* into v_panel from private.bot_viewer_interfaces p
  where p.id = p_interface_id and p.viewer_id = v_actor for update;
  if not found or not private.bot_viewer_interface_valid(p_interface_id) then
    raise exception 'bot_viewer_forbidden' using errcode = '42501';
  end if;
  if v_panel.version <> p_expected_version then
    raise exception 'bot_viewer_version_conflict' using errcode = '40001';
  end if;
  select button->>'callback_data' into v_data
  from pg_catalog.jsonb_array_elements(v_panel.state->'buttons') row_value,
       pg_catalog.jsonb_array_elements(row_value) button
  where button->>'key' = p_button_key;
  if not found then raise exception 'bot_viewer_button_not_found' using errcode = 'P0002'; end if;
  v_callback_id := pg_catalog.gen_random_uuid();
  v_update_id := public.bot_update_enqueue_internal(
    v_panel.bot_id, 'callback_query', v_panel.source_message_id,
    pg_catalog.jsonb_build_object('callback_id', v_callback_id,
      'actor_id', v_actor, 'data', v_data));
  -- This callback came from a private panel, not an existing public keyboard.
  delete from private.bot_callback_interface_grants g where g.callback_query_id = v_callback_id;
  insert into private.bot_viewer_interface_actions(callback_query_id, interface_id, panel_version)
  values (v_callback_id, p_interface_id, p_expected_version);
  update private.bot_updates queued
  set payload = pg_catalog.jsonb_set(queued.payload,
    '{callback_query,viewer_interface_id}', pg_catalog.to_jsonb(p_interface_id::text))
  where queued.bot_id = v_panel.bot_id and queued.update_id = v_update_id
    and queued.update_type = 'callback_query'
    and queued.payload #>> '{callback_query,id}' = v_callback_id::text;
  if not found then raise exception 'bot_viewer_enqueue_failed' using errcode = '55000'; end if;
  return v_callback_id;
end
$function$;
revoke all on function public.bot_viewer_interface_press(uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interface_press(uuid,integer,text)
  to authenticated;

-- Preserve the message/edited-message branch and all unmarked callback behavior.
create or replace function private.bot_update_still_visible(
  p_bot_id uuid, p_update_type text, p_payload jsonb
) returns boolean language plpgsql volatile security definer
set search_path = '' as $function$
declare
  v_message_id text;
  v_chat_id text;
  v_panel_id text;
  v_callback_id text;
  v_actor_id text;
begin
  if p_bot_id is null or p_update_type is null or p_payload is null then return false; end if;
  if p_update_type = 'callback_query' then
    v_panel_id := p_payload #>> '{callback_query,viewer_interface_id}';
    if not coalesce((p_payload->'callback_query') ? 'viewer_interface_id', false) then
      return true;
    end if;
    if v_panel_id is null then return false; end if;
    v_callback_id := p_payload #>> '{callback_query,id}';
    v_actor_id := p_payload #>> '{callback_query,from,id}';
    if v_panel_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_callback_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_actor_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return false;
    end if;
    return exists (
      select 1 from private.bot_viewer_interface_actions action
      join private.bot_viewer_interfaces panel on panel.id = action.interface_id
      where action.callback_query_id = v_callback_id::uuid
        and action.interface_id = v_panel_id::uuid
        and panel.bot_id = p_bot_id and panel.viewer_id = v_actor_id::uuid
        and panel.source_message_id::text = p_payload #>> '{callback_query,message,id}'
        and panel.chat_id::text = p_payload #>> '{callback_query,message,chat_id}'
        and private.bot_viewer_interface_valid(panel.id)
    );
  end if;
  if p_update_type not in ('message', 'edited_message') then return true; end if;
  v_message_id := p_payload #>> '{message,id}';
  v_chat_id := p_payload #>> '{message,chat_id}';
  if v_message_id is null
     or v_message_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_chat_id is null
     or v_chat_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not exists (
       select 1 from public.messages message_row
       where message_row.id = v_message_id::uuid and message_row.chat_id = v_chat_id::uuid
     ) then
    return false;
  end if;
  return private.bot_can_receive_message(p_bot_id, v_message_id::uuid);
end
$function$;
revoke all on function private.bot_update_still_visible(uuid,text,jsonb)
  from public, anon, authenticated, service_role;

-- The first visibility check happens during prepare. A marked callback can
-- spend time in the worker before HTTP dispatch, so recheck at that boundary.
create function public.bot_viewer_delivery_recheck_internal(
  p_attempt_id bigint, p_claim_token uuid
) returns text language plpgsql volatile security definer
set search_path = '' as $function$
declare
  v_attempt private.bot_delivery_attempts%rowtype;
  v_update_type text;
  v_payload jsonb;
begin
  if p_attempt_id is null or p_claim_token is null then return 'stale'; end if;
  select attempt.* into v_attempt from private.bot_delivery_attempts attempt
  where attempt.id = p_attempt_id and attempt.status = 'dispatching'
    and attempt.claim_token = p_claim_token
    and attempt.claimed_at > pg_catalog.now() - interval '2 minutes'
  for share;
  if not found then return 'stale'; end if;
  select queued.update_type, queued.payload into v_update_type, v_payload
  from private.bot_updates queued
  where queued.bot_id = v_attempt.bot_id and queued.update_id = v_attempt.update_id
    and queued.acknowledged_at is null and queued.expires_at > pg_catalog.now()
  for share;
  if not found or v_update_type <> 'callback_query'
     or not coalesce((v_payload->'callback_query') ? 'viewer_interface_id', false) then
    return 'stale';
  end if;
  if private.bot_update_still_visible(v_attempt.bot_id, v_update_type, v_payload) then
    return 'allowed';
  end if;
  return 'revoked';
end
$function$;
revoke all on function public.bot_viewer_delivery_recheck_internal(bigint,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_delivery_recheck_internal(bigint,uuid)
  to service_role;

create function public.bot_viewer_interface_cleanup_internal(p_now timestamptz, p_limit integer)
returns jsonb language plpgsql security definer
set search_path = '' as $function$
declare
  v_grants integer := 0;
  v_panels integer := 0;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 1000
     or p_now > pg_catalog.clock_timestamp() + interval '1 minute' then
    raise exception 'bot_viewer_cleanup_input_invalid' using errcode = '22023';
  end if;
  p_now := pg_catalog.least(p_now, pg_catalog.clock_timestamp());
  with doomed as (
    select g.callback_query_id from private.bot_callback_interface_grants g
    where g.expires_at <= p_now order by g.expires_at, g.callback_query_id
    limit p_limit for update of g skip locked
  )
  delete from private.bot_callback_interface_grants g using doomed d
  where g.callback_query_id = d.callback_query_id;
  get diagnostics v_grants = row_count;
  with doomed as (
    select p.id from private.bot_viewer_interfaces p
    where p.expires_at <= p_now order by p.expires_at, p.id
    limit p_limit for update of p skip locked
  )
  delete from private.bot_viewer_interfaces p using doomed d where p.id = d.id;
  get diagnostics v_panels = row_count;
  return pg_catalog.jsonb_build_object('grants_deleted', v_grants, 'panels_deleted', v_panels);
end
$function$;
revoke all on function public.bot_viewer_interface_cleanup_internal(timestamptz,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.bot_viewer_interface_cleanup_internal(timestamptz,integer)
  to service_role;

do $selfcheck$
begin
  if pg_catalog.has_table_privilege('authenticated','private.bot_viewer_interfaces','SELECT')
     or pg_catalog.has_table_privilege('service_role','private.bot_viewer_interfaces','SELECT')
     or pg_catalog.has_table_privilege('authenticated','private.bot_callback_interface_grants','SELECT')
     or pg_catalog.has_table_privilege('service_role','private.bot_callback_interface_grants','SELECT')
     or pg_catalog.has_table_privilege('authenticated','private.bot_viewer_interface_actions','SELECT')
     or pg_catalog.has_table_privilege('service_role','private.bot_viewer_interface_actions','SELECT')
     or not (select c.relrowsecurity from pg_catalog.pg_class c
             where c.oid = 'private.bot_viewer_interfaces'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c
             where c.oid = 'private.bot_callback_interface_grants'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c
             where c.oid = 'private.bot_viewer_interface_actions'::regclass)
     or exists (select 1 from pg_catalog.pg_publication_tables publication_row
                where publication_row.schemaname = 'private'
                  and publication_row.tablename in (
                    'bot_callback_interface_grants', 'bot_viewer_interfaces',
                    'bot_viewer_interface_actions'))
     or not pg_catalog.has_function_privilege('authenticated','public.bot_viewer_interface_press(uuid,integer,text)','EXECUTE')
     or pg_catalog.has_function_privilege('anon','public.bot_viewer_interface_press(uuid,integer,text)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.bot_viewer_interface_press(uuid,integer,text)','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated','public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)','EXECUTE')
     or not pg_catalog.has_function_privilege('service_role','public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated','private.bot_viewer_interface_valid(uuid)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','private.bot_viewer_interface_valid(uuid)','EXECUTE')
      or not pg_catalog.has_function_privilege('service_role','public.bot_viewer_interface_cleanup_internal(timestamptz,integer)','EXECUTE')
      or pg_catalog.has_function_privilege('authenticated','public.bot_viewer_interface_cleanup_internal(timestamptz,integer)','EXECUTE')
      or not pg_catalog.has_function_privilege('service_role','public.bot_viewer_delivery_recheck_internal(bigint,uuid)','EXECUTE')
      or pg_catalog.has_function_privilege('authenticated','public.bot_viewer_delivery_recheck_internal(bigint,uuid)','EXECUTE')
     or not exists (select 1 from pg_catalog.pg_trigger
                    where tgrelid = 'private.bot_updates'::regclass
                      and tgname = 'trg_bot_viewer_grant_on_callback' and tgenabled = 'O') then
    raise exception 'bot_viewer_interface_poststate_invalid';
  end if;
end
$selfcheck$;

notify pgrst, 'reload schema';
commit;
