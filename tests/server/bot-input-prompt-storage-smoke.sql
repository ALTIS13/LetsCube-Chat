-- Run with psql -v ON_ERROR_STOP=1 after the storage migration. All writes
-- target a temporary table and the transaction is rolled back.
begin;

create temporary table bot_input_prompt_probe (
  id integer generated always as identity primary key,
  bot_id uuid,
  bot_reply_markup jsonb,
  bot_input_field_placeholder text
);

create trigger trg_bot_input_prompt_normalize
  before insert or update of bot_reply_markup on bot_input_prompt_probe
  for each row execute function private.normalize_bot_input_prompt();
create trigger trg_bot_input_prompt_direct_update
  before update of bot_input_field_placeholder on bot_input_prompt_probe
  for each row execute function private.reject_bot_input_prompt_direct_update();

insert into bot_input_prompt_probe(bot_id, bot_reply_markup)
values (
  '33333333-3333-4333-8333-333333333333',
  '{"inline_keyboard":[[{"text":"Открыть","callback_data":"open"}]],"input_field_placeholder":"Вставьте ссылку"}'::jsonb
);

do $check$
begin
  if not exists (
    select 1 from bot_input_prompt_probe
    where bot_input_field_placeholder = 'Вставьте ссылку'
      and bot_reply_markup = '{"inline_keyboard":[[{"text":"Открыть","callback_data":"open"}]]}'::jsonb
  ) then
    raise exception 'bot_input_prompt_normalization_failed';
  end if;
end
$check$;

do $check$
begin
  begin
    update bot_input_prompt_probe
    set bot_input_field_placeholder = 'Подменено';
    raise exception 'direct_prompt_update_was_accepted';
  exception when sqlstate '42501' then
    null;
  end;
end
$check$;

update bot_input_prompt_probe
set bot_reply_markup = '{"inline_keyboard":[[{"text":"Открыть","callback_data":"open"}]]}'::jsonb;

do $check$
begin
  if exists (
    select 1 from bot_input_prompt_probe
    where bot_input_field_placeholder is not null
  ) then
    raise exception 'bot_input_prompt_clear_failed';
  end if;
end
$check$;

rollback;
