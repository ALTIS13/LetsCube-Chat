-- Rehearsal: 20260928210000_deleted_message_keeps_nothing.sql (D-103)
--
-- Run on production inside the migration's own transaction, which ends in
-- ROLLBACK: the migration's body without its final COMMIT, then this file,
-- then `rollback;`. __ADMIN__ and __MEMBER__ are two real accounts, an
-- administrator and an ordinary one, substituted at run time and never
-- written down here. Everything it creates — a group, its members, messages, a
-- report — is rolled back with it; pushes are only ever read from committed
-- outbox rows, so none is sent.
-- Inside the rehearsal's transaction. A group of two real accounts made for the
-- rehearsal and rolled back with it: the member writes, deletes and tries to
-- bring a message back; the admin receives the notifications and reports one.
create temporary table smoke_ids (key text primary key, id uuid) on commit drop;
grant all on smoke_ids to authenticated, service_role;

do $$
declare
  v_group uuid := gen_random_uuid();
begin
  insert into public.chats (id, type, name, created_by) values (v_group, 'group', 'rehearsal: D-103', '__ADMIN__');
  insert into public.chat_members (chat_id, user_id, role)
  values (v_group, '__ADMIN__', 'owner'), (v_group, '__MEMBER__', 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;
  insert into smoke_ids values ('group', v_group);
end;
$$;

-- The member writes: words, a photo, the same photo again, a message the admin
-- will report, and one the older client deletes by a direct UPDATE.
select set_config('request.jwt.claims', json_build_object('sub', '__MEMBER__', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_group uuid := (select id from smoke_ids where key = 'group');
  v_words uuid := gen_random_uuid();
  v_photo uuid := gen_random_uuid();
  v_same uuid := gen_random_uuid();
  v_reported uuid := gen_random_uuid();
  v_direct uuid := gen_random_uuid();
  v_path text := '__MEMBER__/rehearsal-d103/photo.jpg';
begin
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_words, v_group, '__MEMBER__', 'rehearsal: secret words', 'text'),
    (v_reported, v_group, '__MEMBER__', 'rehearsal: reported words', 'text'),
    (v_direct, v_group, '__MEMBER__', 'rehearsal: direct words', 'text');
  insert into public.messages (id, chat_id, user_id, content, type, media_bucket, media_path, media_metadata) values
    (v_photo, v_group, '__MEMBER__', 'rehearsal: caption', 'image', 'media', v_path,
     jsonb_build_object('kind', 'image', 'preview', jsonb_build_object('path', '__MEMBER__/rehearsal-d103/photo.preview.webp'))),
    (v_same, v_group, '__MEMBER__', null, 'image', 'media', v_path, jsonb_build_object('kind', 'image'));
  insert into smoke_ids values ('words', v_words), ('photo', v_photo), ('same', v_same), ('reported', v_reported), ('direct', v_direct);
end;
$$;
reset role;

-- The admin reports one of them.
insert into public.content_reports (reporter_id, kind, target_user_id, message_id, chat_id, reason, status)
select '__ADMIN__', 'message', '__MEMBER__', (select id from smoke_ids where key = 'reported'), (select id from smoke_ids where key = 'group'), 'spam', 'new';

do $$
begin
  if not exists (
    select 1 from public.notifications
     where user_id = '__ADMIN__' and kind = 'message'
       and payload ->> 'message_id' = (select id::text from smoke_ids where key = 'words')
       and payload ->> 'preview' is not null
  ) then
    raise exception 'setup: the admin got no notification with a preview to scrub';
  end if;
end;
$$;

-- The member deletes for everyone, and the older client's direct UPDATE.
select set_config('request.jwt.claims', json_build_object('sub', '__MEMBER__', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform * from public.delete_messages_for_everyone(array[
    (select id from smoke_ids where key = 'words'),
    (select id from smoke_ids where key = 'photo'),
    (select id from smoke_ids where key = 'reported')
  ]);
  update public.messages set deleted_at = now() where id = (select id from smoke_ids where key = 'direct');
end;
$$;
reset role;

do $$
declare
  v_words uuid := (select id from smoke_ids where key = 'words');
  v_photo uuid := (select id from smoke_ids where key = 'photo');
  v_reported uuid := (select id from smoke_ids where key = 'reported');
  v_direct uuid := (select id from smoke_ids where key = 'direct');
begin
  if (select content from public.messages where id = v_words) is not null
     or (select deleted_at from public.messages where id = v_words) is null then
    raise exception 'the deleted words are still in the row';
  end if;
  if (select content from public.messages where id = v_direct) is not null then
    raise exception 'the direct UPDATE left the words in the row';
  end if;
  if (select media_path is not null or media_metadata is not null or content is not null from public.messages where id = v_photo) then
    raise exception 'the deleted photo still points at its file';
  end if;
  if (select count(*) from private.message_media_purge where message_id = v_photo) <> 3 then
    raise exception 'the photo, its preview and the other spelling were not queued';
  end if;
  if (select content from public.messages where id = v_reported) is distinct from 'rehearsal: reported words' then
    raise exception 'a reported message lost its words before the moderator looked';
  end if;
  if exists (
    select 1 from public.notifications
     where kind = 'message' and payload ->> 'message_id' in (v_words::text, v_direct::text)
       and (payload ->> 'preview' is not null or not coalesce((payload ->> 'deleted')::boolean, false))
  ) then
    raise exception 'a notification kept the deleted words';
  end if;
  if exists (
    select 1 from public.notifications_push_outbox o join public.notifications n on n.id = o.notification_id
     where n.payload ->> 'message_id' = v_words::text and o.sent_at is null
  ) or exists (
    select 1 from public.notifications_native_push_outbox o join public.notifications n on n.id = o.notification_id
     where n.payload ->> 'message_id' = v_words::text and o.sent_at is null
  ) then
    raise exception 'a push of the deleted words is still waiting to be sent';
  end if;
end;
$$;

-- Deletion is final: the author cannot bring a message back or write into it.
select set_config('request.jwt.claims', json_build_object('sub', '__MEMBER__', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.messages set deleted_at = null, content = 'rehearsal: back again' where id = (select id from smoke_ids where key = 'words');
reset role;
do $$
begin
  if (select deleted_at is null or content is not null from public.messages where id = (select id from smoke_ids where key = 'words')) then
    raise exception 'a deleted message came back';
  end if;
end;
$$;

-- The moderator dismisses the report: the deletion finishes.
update public.content_reports set status = 'dismissed' where message_id = (select id from smoke_ids where key = 'reported');
do $$
begin
  if (select content from public.messages where id = (select id from smoke_ids where key = 'reported')) is not null then
    raise exception 'closing the report did not finish the deletion';
  end if;
end;
$$;

-- The worker's claim, as service_role: the photo's file is kept while the
-- other message still shows it, and released once that one is deleted too.
set local role service_role;
do $$
declare
  v_photo uuid := (select id from smoke_ids where key = 'photo');
  v_claimed integer;
begin
  select count(*) into v_claimed
    from public.message_media_purge_claim(200) as claimed
   where claimed.path like '%/rehearsal-d103/%';
  if v_claimed <> 0 then
    raise exception 'a file another message still shows was handed to the worker: %', v_claimed;
  end if;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from private.message_media_purge where message_id = (select id from smoke_ids where key = 'photo') and status = 'kept') <> 3 then
    raise exception 'the shared photo was not marked kept';
  end if;
end;
$$;

select set_config('request.jwt.claims', json_build_object('sub', '__MEMBER__', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from public.delete_messages_for_everyone(array[(select id from smoke_ids where key = 'same')]);
reset role;

set local role service_role;
do $$
declare
  v_ids uuid[];
  v_one uuid;
  v_two uuid;
begin
  select array_agg(claimed.id) into v_ids
    from public.message_media_purge_claim(200) as claimed
   where claimed.path like '%/rehearsal-d103/%';
  if coalesce(array_length(v_ids, 1), 0) <> 3 then
    raise exception 'the photo was not released once nothing showed it: %', coalesce(array_length(v_ids, 1), 0);
  end if;
  v_one := v_ids[1];
  v_two := v_ids[2];
  perform public.message_media_purge_finish(v_one, null);
  perform public.message_media_purge_finish(v_two, 'rehearsal: storage said no');
  insert into smoke_ids values ('done', v_one), ('retry', v_two);
end;
$$;
reset role;
do $$
begin
  if (select status from private.message_media_purge where id = (select id from smoke_ids where key = 'done')) <> 'done' then
    raise exception 'a removed file was not marked done';
  end if;
  if (select status <> 'pending' or claimed_until <= now() or last_error is null
        from private.message_media_purge where id = (select id from smoke_ids where key = 'retry')) then
    raise exception 'a refused removal was not backed off for another try';
  end if;
end;
$$;

-- Nobody but the worker may call either function.
set local role authenticated;
do $$
begin
  begin
    perform * from public.message_media_purge_claim(1);
    raise exception 'authenticated claimed purge work';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'deleted message rehearsal passed';
end;
$$;
reset role;
