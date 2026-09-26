-- Use only after reverting the API and client. The additive validator may also
-- remain deployed. Never discard or rewrite bot messages just to force this
-- rollback: if new-format markup exists, stop and review it separately.

begin;

do $check$
begin
  if exists (
    select 1 from public.messages
    where bot_reply_markup ? 'input_field_placeholder'
  ) then
    raise exception 'bot_inline_input_prompt_rollback_requires_markup_review';
  end if;
end
$check$;

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

do $check$
begin
  if private.bot_inline_keyboard_valid('{"inline_keyboard":[[{"text":"OK","callback_data":"ok"}]],"input_field_placeholder":"Ответ"}'::jsonb)
     or not private.bot_inline_keyboard_valid('{"inline_keyboard":[[{"text":"OK","callback_data":"ok"}]]}'::jsonb) then
    raise exception 'bot_inline_input_prompt_rollback_self_check_failed';
  end if;
end
$check$;

commit;
