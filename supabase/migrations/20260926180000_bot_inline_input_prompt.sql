-- Extend the existing bot keyboard with one optional text prompt. The input is
-- submitted as an ordinary reply_to_id message, never as a private callback.
-- Rollback: revert the API/client first. This validator can safely remain as
-- a backward-compatible extension; restore the prior function only after
-- confirming no stored markup uses input_field_placeholder.
-- No table rewrite, RLS change, data update, or new grant.

begin;

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
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_markup)) not between 1 and 2
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_markup) as key_name
       where key_name not in ('inline_keyboard', 'input_field_placeholder')
     )
     or (p_markup ? 'input_field_placeholder' and (
       pg_catalog.jsonb_typeof(p_markup->'input_field_placeholder') <> 'string'
       or pg_catalog.length(p_markup->>'input_field_placeholder') not between 1 and 64
     ))
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

do $check$
declare
  v_keyboard jsonb := '{"inline_keyboard":[[{"text":"OK","callback_data":"ok"}]]}'::jsonb;
begin
  if not private.bot_inline_keyboard_valid(v_keyboard)
     or not private.bot_inline_keyboard_valid(v_keyboard || '{"input_field_placeholder":"Вставьте ссылку"}'::jsonb)
     or private.bot_inline_keyboard_valid(v_keyboard || '{"input_field_placeholder":""}'::jsonb)
     or private.bot_inline_keyboard_valid(v_keyboard || pg_catalog.jsonb_build_object('input_field_placeholder', pg_catalog.repeat('x', 65)))
     or private.bot_inline_keyboard_valid(v_keyboard || '{"input_field_placeholder":42}'::jsonb)
     or private.bot_inline_keyboard_valid(v_keyboard || '{"unknown":"x"}'::jsonb)
     or pg_catalog.has_function_privilege('authenticated', 'private.bot_inline_keyboard_valid(jsonb)', 'EXECUTE') then
    raise exception 'bot_inline_input_prompt_self_check_failed';
  end if;
end
$check$;

commit;
