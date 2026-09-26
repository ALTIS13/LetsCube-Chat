-- Revert API/client first. Stop if any bot message still contains an input
-- prompt; never drop a populated column as an automatic recovery shortcut.

begin;

do $check$
begin
  if exists (
    select 1 from public.messages
    where bot_input_field_placeholder is not null
  ) then
    raise exception 'bot_input_prompt_storage_rollback_requires_data_review';
  end if;
end
$check$;

drop trigger if exists trg_bot_input_prompt_direct_update on public.messages;
drop trigger if exists trg_bot_input_prompt_normalize on public.messages;
drop function if exists private.reject_bot_input_prompt_direct_update();
drop function if exists private.normalize_bot_input_prompt();
alter table public.messages drop constraint if exists messages_bot_input_field_placeholder_check;
alter table public.messages drop column if exists bot_input_field_placeholder;

do $check$
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.messages'::pg_catalog.regclass
      and attname = 'bot_input_field_placeholder'
      and not attisdropped
  ) then
    raise exception 'bot_input_prompt_storage_rollback_self_check_failed';
  end if;
end
$check$;

commit;
