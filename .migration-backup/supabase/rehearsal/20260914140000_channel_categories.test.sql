-- Rehearsal: 20260914140000_channel_categories.sql
--
-- Run it against a database that already has a group with an administrator and
-- an ordinary member -- production qualifies, and that is where it was run on
-- 2026-09-14, seven rules green and rolled back:
--   psql -X -f .migration-backup/supabase/rehearsal/20260914140000_channel_categories.test.sql
--
-- It picks its people and its chats out of what is there rather than making
-- them, because creating an account on this deployment requires an invitation
-- (`registration_invites_required()` is true and the trigger raises
-- `invite_required`), so a fixture that inserts into `auth.users` cannot run
-- here at all. That was measured, not assumed.
--
begin;

do $proof$
declare
  v_owner text := current_user;
  v_chat uuid; v_other uuid;
  v_admin uuid; v_member uuid; v_outsider uuid;
  v_category uuid; v_topic uuid; v_other_topic uuid;
  v_seen bigint; v_refused boolean; v_err text;
begin
  -- A real group with a real administrator and a real ordinary member.
  select c.id into v_chat
    from public.chats c
   where c.type = 'group'
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.role in ('owner','admin'))
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.role = 'member')
   order by c.created_at limit 1;
  if v_chat is null then
    raise exception 'no group with both an administrator and an ordinary member';
  end if;
  select user_id into v_admin from public.chat_members
   where chat_id = v_chat and role in ('owner','admin') limit 1;
  select user_id into v_member from public.chat_members
   where chat_id = v_chat and role = 'member' limit 1;
  select p.id into v_outsider from public.profiles p
   where not exists (select 1 from public.chat_members m where m.chat_id = v_chat and m.user_id = p.id)
     and not public.is_banned(p.id)
   limit 1;
  select c.id into v_other from public.chats c where c.id <> v_chat and c.type = 'group' limit 1;
  if v_member is null or v_outsider is null or v_other is null then
    raise exception 'the fixture is incomplete: member=% outsider=% other_chat=%', v_member, v_outsider, v_other;
  end if;

  -- 1. An administrator of the chat makes a heading.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.chat_channel_categories (chat_id, name, position, created_by)
    values (v_chat, 'Проверка', 0, v_admin) returning id into v_category;
  perform set_config('role', v_owner, true);
  raise notice '1. an administrator makes a heading, and reads it back';

  -- 2. An ordinary member of the same chat reads it and cannot write one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_seen from public.chat_channel_categories where chat_id = v_chat;
  begin
    insert into public.chat_channel_categories (chat_id, name) values (v_chat, 'Не моё');
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if v_seen < 1 then
    raise exception '2. an ordinary member cannot see the heading of their own group';
  end if;
  if not v_refused then
    raise exception '2. an ordinary member made a heading';
  end if;
  raise notice '2. a member reads the heading and may not make one';

  -- 3. Somebody outside the chat sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_seen from public.chat_channel_categories where chat_id = v_chat;
  perform set_config('role', v_owner, true);
  if v_seen <> 0 then
    raise exception '3. somebody outside the group can read its headings: % rows', v_seen;
  end if;
  raise notice '3. somebody outside the group reads nothing';

  -- 4. A channel of this chat may be put under the heading.
  perform set_config('role', v_owner, true);
  insert into public.topics (chat_id, name, position, category_id)
    values (v_chat, 'проверочный', 900, v_category) returning id into v_topic;
  raise notice '4. a channel of this chat goes under the heading';

  -- 5. A channel of ANOTHER chat may not, and that is the schema saying so
  --    rather than a trigger or the client.
  begin
    insert into public.topics (chat_id, name, position, category_id)
      values (v_other, 'чужой', 901, v_category) returning id into v_other_topic;
    v_refused := false;
  exception when foreign_key_violation then
    v_refused := true;
  end;
  if not v_refused then
    raise exception '5. a channel of another chat was filed under this chat''s heading';
  end if;
  raise notice '5. another chat''s channel cannot reach this heading';

  -- 6. Removing the heading keeps the channel and nulls only the heading.
  --    This is the D-189 shape: a bare `set null` would try to null chat_id too
  --    and the delete would fail.
  begin
    delete from public.chat_channel_categories where id = v_category;
  exception when others then
    get stacked diagnostics v_err = message_text;
    raise exception '6. deleting a heading was refused -> %', v_err;
  end;
  select count(*) into v_seen from public.topics where id = v_topic and category_id is null and chat_id = v_chat;
  if v_seen <> 1 then
    raise exception '6. the channel did not survive its heading (% rows)', v_seen;
  end if;
  raise notice '6. the heading goes, the channel stays and is uncategorised';

  -- 7. anon holds nothing, measured rather than assumed.
  if has_table_privilege('anon', 'public.chat_channel_categories', 'select')
     or has_table_privilege('anon', 'public.chat_channel_categories', 'insert')
     or has_table_privilege('anon', 'public.chat_channel_categories', 'update')
     or has_table_privilege('anon', 'public.chat_channel_categories', 'delete') then
    raise exception '7. anon can reach chat_channel_categories';
  end if;
  raise notice '7. anon holds nothing on the new table';

  raise notice 'ALL SEVEN PASSED (and this transaction is about to roll back)';
end
$proof$;

rollback;
