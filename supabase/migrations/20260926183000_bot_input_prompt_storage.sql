-- Keep the existing bot_reply_markup shape visible to older embedded clients.
-- The API accepts an optional input_field_placeholder in reply_markup; this
-- trigger extracts it before storage, so old clients still render the buttons.
-- Rollback: revert API/client first. Leave this additive column and trigger
-- inert, or use the reviewed rollback script after checking stored prompts.

begin;

alter table public.messages
  add column if not exists bot_input_field_placeholder text null;

alter table public.messages
  drop constraint if exists messages_bot_input_field_placeholder_check;
alter table public.messages
  add constraint messages_bot_input_field_placeholder_check
  check (
    bot_input_field_placeholder is null
    or (
      bot_id is not null
      and pg_catalog.length(bot_input_field_placeholder) between 1 and 64
    )
  ) not valid;
alter table public.messages
  validate constraint messages_bot_input_field_placeholder_check;

create or replace function private.normalize_bot_input_prompt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.bot_reply_markup is null then
    new.bot_input_field_placeholder := null;
    return new;
  end if;

  if new.bot_reply_markup ? 'input_field_placeholder' then
    if not private.bot_inline_keyboard_valid(new.bot_reply_markup) then
      raise exception 'bot_reply_markup_invalid' using errcode = '22023';
    end if;
    new.bot_input_field_placeholder := new.bot_reply_markup->>'input_field_placeholder';
    new.bot_reply_markup := new.bot_reply_markup - 'input_field_placeholder';
  else
    new.bot_input_field_placeholder := null;
  end if;
  return new;
end
$function$;

revoke all on function private.normalize_bot_input_prompt()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_bot_input_prompt_normalize on public.messages;
create trigger trg_bot_input_prompt_normalize
  before insert or update of bot_reply_markup on public.messages
  for each row execute function private.normalize_bot_input_prompt();

create or replace function private.reject_bot_input_prompt_direct_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'bot_input_prompt_is_derived' using errcode = '42501';
end
$function$;

revoke all on function private.reject_bot_input_prompt_direct_update()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_bot_input_prompt_direct_update on public.messages;
create trigger trg_bot_input_prompt_direct_update
  before update of bot_input_field_placeholder on public.messages
  for each row execute function private.reject_bot_input_prompt_direct_update();

do $check$
declare
  v_normalize_trigger boolean;
  v_guard_trigger boolean;
begin
  select exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.messages'::pg_catalog.regclass
      and tgname = 'trg_bot_input_prompt_normalize'
      and not tgisinternal
  ) into v_normalize_trigger;
  select exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.messages'::pg_catalog.regclass
      and tgname = 'trg_bot_input_prompt_direct_update'
      and not tgisinternal
  ) into v_guard_trigger;

  if not v_normalize_trigger or not v_guard_trigger
     or not exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.messages'::pg_catalog.regclass
         and attname = 'bot_input_field_placeholder'
         and not attisdropped
     )
     or pg_catalog.has_function_privilege('authenticated', 'private.normalize_bot_input_prompt()', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'private.reject_bot_input_prompt_direct_update()', 'EXECUTE') then
    raise exception 'bot_input_prompt_storage_self_check_failed';
  end if;
end
$check$;

commit;
