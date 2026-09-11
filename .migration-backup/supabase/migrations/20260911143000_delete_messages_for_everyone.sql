/**
 * Delete for both in private chats, as Telegram does, for one message or many.
 *
 * WHAT EXISTS. «Удалить у всех» sets `messages.deleted_at` on the reader's own
 * messages, one PATCH per message, through the author-only UPDATE policy. A
 * private chat's other person's message can only be hidden for yourself
 * (`hide_message_for_me`). The owner approved on 2026-09-11 that either
 * participant of a private chat may delete any message in it for both sides —
 * the approval 20260911120000 said would arrive "as a function either
 * participant may call".
 *
 * WHAT THIS ADDS. `public.delete_messages_for_everyone(uuid[])`:
 *
 *   - up to 100 message ids at once, all from one chat, all or nothing;
 *   - the caller must be a member of that chat and not banned;
 *   - a private chat: any message in it except a system notice;
 *   - a group or channel: only the caller's own messages — today's rule;
 *   - a soft delete: `deleted_at` is set, nothing else changes, so it is
 *     reversible; a message already deleted stays as it was and is reported
 *     as deleted;
 *   - each deletion is recorded in `private.message_deletions` (who, whose, when,
 *     in what kind of chat), which no API role can read. That record is what
 *     makes reversing a particular deletion exact instead of guessed:
 *
 *       update public.messages as m
 *          set deleted_at = null
 *         from private.message_deletions as d
 *        where d.message_id = m.id
 *          and d.deleted_at = m.deleted_at
 *          and d.deleted_by = '<user id>'
 *          and d.deleted_at = '<timestamp>';
 *
 * HOW "WITHOUT A TRACE" IS SHOWN. The row stays; the client does the rest. In a
 * private chat a deleted message is not drawn at all — no «Сообщение удалено»
 * — on both sides, for new deletions and for the ones made before this, because
 * a placeholder is exactly the trace Telegram does not leave. In a group the
 * placeholder stays. The chat list's preview, the pinned bar, search and the
 * unread count already skip deleted rows.
 *
 * WHAT A DELETION DOES NOT REMOVE, stated so nobody assumes it does:
 *
 *   - the content stays in the row. A member of the chat who calls the API
 *     directly can still select it, as they can for today's group soft delete;
 *   - media stay in storage, since the deletion must be reversible;
 *   - a notification already written about the message keeps its 160-character
 *     preview in `public.notifications` (20260529_message_notifications_for_push),
 *     and a push already delivered stays on the device.
 *
 * `trg_audit_messages_admin_delete` still fires on the UPDATE of `deleted_at`.
 * It records `message_deleted_by_staff` when the caller is a global
 * administrator or manager and not the author — which now includes an
 * administrator deleting the other person's message in their own private chat.
 *
 * OWNER. The function updates other people's messages in private chats, which
 * the author-only UPDATE policy on `public.messages` would refuse. It must be
 * owned by the owner of `public.messages` (postgres on this deployment) or a
 * superuser, and `public.messages` must not FORCE row-level security. The
 * self-check refuses to commit otherwise, and also refuses if any policy on
 * `public.messages` changed during the transaction.
 *
 * REALTIME. Nothing new: the UPDATE of `messages` is already published and each
 * client in the chat refetches the row it names.
 *
 * Rollback: 20260911143000_delete_messages_for_everyone.rollback.sql.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

create temp table _messages_policies_before on commit drop as
select polname::text,
       polcmd::text,
       polpermissive,
       pg_catalog.pg_get_expr(polqual, polrelid) as qual,
       pg_catalog.pg_get_expr(polwithcheck, polrelid) as with_check
  from pg_catalog.pg_policy
 where polrelid = 'public.messages'::regclass;

create table if not exists private.message_deletions (
  message_id uuid not null,
  chat_id uuid not null,
  deleted_by uuid not null,
  author_id uuid,
  chat_type text not null,
  deleted_at timestamptz not null,
  constraint message_deletions_pkey primary key (message_id, deleted_at)
);

create index if not exists message_deletions_deleted_by_idx
  on private.message_deletions (deleted_by, deleted_at desc);

alter table private.message_deletions enable row level security;
revoke all on table private.message_deletions from public, anon, authenticated, service_role;

comment on table private.message_deletions is
  'Who deleted which message for everyone, and when. Read by operators to reverse a deletion; no API role can read it.';

create or replace function public.delete_messages_for_everyone(p_message_ids uuid[])
returns setof uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
  v_found integer;
  v_chat_count integer;
  v_chat_id uuid;
  v_chat_type text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select coalesce(pg_catalog.array_agg(distinct requested.id), '{}'::uuid[])
    into v_ids
    from pg_catalog.unnest(coalesce(p_message_ids, '{}'::uuid[])) as requested(id)
   where requested.id is not null;
  v_count := pg_catalog.cardinality(v_ids);
  if v_count = 0 then
    return;
  end if;
  if v_count > 100 then
    raise exception 'too_many_messages' using errcode = '22023';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'user_banned' using errcode = '42501';
  end if;

  -- Lock first, so two overlapping deletions serialise instead of both
  -- logging the same message.
  perform 1
     from public.messages as message
    where message.id = any (v_ids)
    order by message.id
      for update;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct message.chat_id)::integer,
         (pg_catalog.array_agg(message.chat_id))[1]
    into v_found, v_chat_count, v_chat_id
    from public.messages as message
   where message.id = any (v_ids);

  -- An id that does not exist and an id in a chat the caller is not in get the
  -- same answer, so this cannot be used to learn which ids exist.
  if v_found <> v_count
     or exists (
       select 1
         from public.messages as message
        where message.id = any (v_ids)
          and not exists (
            select 1 from public.chat_members as me
             where me.chat_id = message.chat_id and me.user_id = v_uid
          )
     ) then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  if v_chat_count <> 1 then
    raise exception 'messages_span_chats' using errcode = '22023';
  end if;

  select chat.type into v_chat_type
    from public.chats as chat
   where chat.id = v_chat_id;

  if v_chat_type = 'private' then
    if exists (
      select 1 from public.messages as message
       where message.id = any (v_ids)
         and coalesce(message.type, 'text') = 'system'
    ) then
      raise exception 'message_not_deletable' using errcode = '42501';
    end if;
  elsif exists (
    select 1 from public.messages as message
     where message.id = any (v_ids)
       and (message.user_id is distinct from v_uid or message.bot_id is not null)
  ) then
    raise exception 'message_not_deletable' using errcode = '42501';
  end if;

  with deleted as (
    update public.messages as message
       set deleted_at = v_now
     where message.id = any (v_ids)
       and message.deleted_at is null
    returning message.id, message.chat_id, message.user_id
  )
  insert into private.message_deletions (message_id, chat_id, deleted_by, author_id, chat_type, deleted_at)
  select deleted.id, deleted.chat_id, v_uid, deleted.user_id, coalesce(v_chat_type, 'unknown'), v_now
    from deleted;

  return query
    select requested.id from pg_catalog.unnest(v_ids) as requested(id);
end
$function$;

revoke all on function public.delete_messages_for_everyone(uuid[]) from public, anon;
grant execute on function public.delete_messages_for_everyone(uuid[]) to authenticated;

comment on function public.delete_messages_for_everyone(uuid[]) is
  'Soft-deletes up to 100 messages of one chat for every member: any message except a system notice in a private chat, only the caller''s own in a group. All or nothing; returns the ids.';

do $$
declare
  v_proc record;
  v_messages record;
  v_changed integer;
begin
  select p.prosecdef, p.proconfig, p.proowner
    into v_proc
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.delete_messages_for_everyone(uuid[])');
  if not found then
    raise exception 'public.delete_messages_for_everyone(uuid[]) is missing';
  end if;
  if not v_proc.prosecdef then
    raise exception 'delete_messages_for_everyone must be SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_catalog.unnest(v_proc.proconfig) c where c like 'search_path=%') then
    raise exception 'delete_messages_for_everyone has no fixed search_path';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.delete_messages_for_everyone(uuid[])', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.delete_messages_for_everyone(uuid[])', 'EXECUTE') then
    raise exception 'delete_messages_for_everyone has the wrong execute grants';
  end if;

  select c.relowner, c.relforcerowsecurity, c.relrowsecurity
    into v_messages
    from pg_catalog.pg_class c
   where c.oid = 'public.messages'::regclass;
  if not v_messages.relrowsecurity then
    raise exception 'public.messages has row-level security off';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles r
     where r.oid = v_proc.proowner and (r.rolsuper or r.rolbypassrls)
  ) and (v_messages.relforcerowsecurity or not pg_catalog.pg_has_role(v_proc.proowner, v_messages.relowner, 'USAGE')) then
    raise exception 'delete_messages_for_everyone is owned by %, which the author-only policy on public.messages (owner %, forced %) would stop; apply as the table owner',
      pg_catalog.pg_get_userbyid(v_proc.proowner), pg_catalog.pg_get_userbyid(v_messages.relowner), v_messages.relforcerowsecurity;
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'private.message_deletions'::regclass) then
    raise exception 'private.message_deletions has row-level security off';
  end if;
  if pg_catalog.has_table_privilege('anon', 'private.message_deletions', 'SELECT, INSERT, UPDATE, DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'private.message_deletions', 'SELECT, INSERT, UPDATE, DELETE')
     or pg_catalog.has_table_privilege('service_role', 'private.message_deletions', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'an API role holds a privilege on private.message_deletions';
  end if;

  -- No policy on messages was added, dropped or rewritten: the function is the
  -- only new way to delete someone else's message.
  select pg_catalog.count(*)::integer into v_changed
    from (
      (select * from _messages_policies_before
       except
       select polname::text, polcmd::text, polpermissive,
              pg_catalog.pg_get_expr(polqual, polrelid), pg_catalog.pg_get_expr(polwithcheck, polrelid)
         from pg_catalog.pg_policy where polrelid = 'public.messages'::regclass)
      union all
      (select polname::text, polcmd::text, polpermissive,
              pg_catalog.pg_get_expr(polqual, polrelid), pg_catalog.pg_get_expr(polwithcheck, polrelid)
         from pg_catalog.pg_policy where polrelid = 'public.messages'::regclass
       except
       select * from _messages_policies_before)
    ) as difference;
  if v_changed <> 0 then
    raise exception 'the policies on public.messages changed during this migration (% differences)', v_changed;
  end if;
  if (select pg_catalog.count(*) from _messages_policies_before) = 0 then
    raise exception 'captured no policies on public.messages; refusing to trust an empty comparison';
  end if;
end
$$;

commit;
