/**
 * PROPOSED REHEARSAL — measures the defect first, then the fix, then rolls back.
 * Intended path: .migration-backup/supabase/rehearsal/
 *                    20260915160000_a_private_delete_is_not_a_staff_action.test.sql
 *
 * Two phases in one transaction. Phase 1 runs against the body that is live
 * today and must show the defect; phase 2 replaces the body and must show it
 * gone. A rehearsal that only measured phase 2 would pass just as well against
 * a trigger that never fires for any reason, so phase 1 is the part that makes
 * the result mean something — and the group control in phase 2 is what proves
 * the fix narrowed the trigger rather than disabling it.
 *
 * Registration on this deployment is invite-only and no fixture can create an
 * account, so every person and chat below is a real row, chosen by its shape
 * and never by whose it is. Nothing is printed but counts, an action name and a
 * chat type. No message content, no names, no ids, no media. Nothing is written
 * outside the transaction, and the final ROLLBACK undoes the function body too,
 * because `create or replace function` is transactional in PostgreSQL.
 *
 * Run:
 *   ssh -i <key> root@ms.letscube.ru \
 *     "docker exec -i supabase-db psql -U postgres -d postgres -X -q" < this file
 */

\set ON_ERROR_STOP on

begin;

create temporary table rehearsal_result (
  step     text,
  measured text
) on commit drop;

create temporary table rehearsal_pick (
  label text primary key,
  id    uuid
) on commit drop;

/**
 * A private chat in which one member is staff and another member wrote a
 * message that is still alive. That is the exact shape the trigger can fire on.
 */
do $pick$
declare
  v_chat    uuid;
  v_staff   uuid;
  v_message uuid;
begin
  select chat.id, staff_member.user_id, message.id
    into v_chat, v_staff, v_message
    from public.chats chat
    join public.chat_members staff_member on staff_member.chat_id = chat.id
    join public.messages message          on message.chat_id = chat.id
   where chat.type = 'private'
     and public.is_manager_or_admin(staff_member.user_id)
     and message.user_id is distinct from staff_member.user_id
     and message.user_id is not null
     and message.deleted_at is null
     and coalesce(message.type, 'text') <> 'system'
   limit 1;

  if v_chat is null then
    raise exception 'no private chat with a staff member and another person''s live message; the rehearsal cannot measure anything';
  end if;

  insert into rehearsal_pick values ('chat', v_chat), ('staff', v_staff), ('message', v_message);
end
$pick$;

-- ---------------------------------------------------------------------------
-- Phase 1: the body that is live today. The defect must appear.
-- ---------------------------------------------------------------------------

do $before$
declare
  v_before bigint;
  v_after  bigint;
begin
  select count(*) into v_before from public.audit_logs where action = 'message_deleted_by_staff';

  perform set_config('request.jwt.claims',
                     json_build_object('sub', (select id::text from rehearsal_pick where label = 'staff'),
                                       'role', 'authenticated')::text,
                     true);

  perform public.delete_messages_for_everyone(
    array[(select id from rehearsal_pick where label = 'message')]);

  select count(*) into v_after from public.audit_logs where action = 'message_deleted_by_staff';

  insert into rehearsal_result values
    ('BEFORE: private delete by staff wrote audit rows', (v_after - v_before)::text);

  perform set_config('request.jwt.claims', null, true);
end
$before$;

/**
 * Put the message and both records back, so phase 2 starts where phase 1 did
 * rather than on phase 1's leftovers.
 *
 * `private.message_deletions` has to be cleared too, and finding that out is
 * itself worth recording: `delete_messages_for_everyone` writes a row there for
 * every delete — `(message_id, chat_id, deleted_by, author_id, chat_type,
 * deleted_at)`, keyed on `(message_id, deleted_at)`. `now()` is stable inside a
 * transaction, so phase 2 produces the identical key and the first run of this
 * rehearsal died on `message_deletions_pkey` instead of measuring anything.
 *
 * That table is the reason the D-105 fix loses nothing. It already records
 * every delete-for-everyone with the chat's type and who did it, and it lives
 * in the `private` schema, which `authenticated` cannot even USAGE — so the
 * closed, complete record already exists, and the `audit_logs` row is a second
 * copy that is both mislabelled and readable by five accounts.
 */
delete from public.audit_logs
 where action = 'message_deleted_by_staff'
   and target_id = (select id from rehearsal_pick where label = 'message');
delete from private.message_deletions
 where message_id = (select id from rehearsal_pick where label = 'message');
update public.messages
   set deleted_at = null
 where id = (select id from rehearsal_pick where label = 'message');

-- ---------------------------------------------------------------------------
-- Phase 2: the proposed body.
-- ---------------------------------------------------------------------------

create or replace function public._audit_messages_admin_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller    uuid := auth.uid();
  chat_kind text;
begin
  if old.deleted_at is null
     and new.deleted_at is not null
     and caller is not null
     and caller is distinct from new.user_id
     and public.is_manager_or_admin(caller)
  then
    select chat.type into chat_kind
      from public.chats chat
     where chat.id = new.chat_id;

    if chat_kind = 'private' then
      return null;
    end if;

    perform public._audit(
      'message_deleted_by_staff',
      'message',
      new.id,
      jsonb_build_object(
        'chat_id',   new.chat_id,
        'chat_type', chat_kind,
        'author',    new.user_id,
        'type',      new.type
      )
    );
  end if;
  return null;
end $function$;

do $after$
declare
  v_before bigint;
  v_after  bigint;
begin
  select count(*) into v_before from public.audit_logs where action = 'message_deleted_by_staff';

  perform set_config('request.jwt.claims',
                     json_build_object('sub', (select id::text from rehearsal_pick where label = 'staff'),
                                       'role', 'authenticated')::text,
                     true);

  perform public.delete_messages_for_everyone(
    array[(select id from rehearsal_pick where label = 'message')]);

  select count(*) into v_after from public.audit_logs where action = 'message_deleted_by_staff';

  insert into rehearsal_result values
    ('AFTER: private delete by staff wrote audit rows', (v_after - v_before)::text);

  perform set_config('request.jwt.claims', null, true);
end
$after$;

/**
 * The control, and the reason this rehearsal is not just proving the trigger is
 * dead. A group delete of somebody else's message must STILL be recorded, and
 * must now carry `chat_type`.
 *
 * No product path can produce this today — `delete_messages_for_everyone`
 * refuses another person's message outside a private chat — so it is written
 * here as a direct UPDATE with the staff member's claims set and RLS bypassed
 * as the table owner. That is exactly the shape a future staff-moderation RPC
 * would present to the trigger.
 */
do $control$
declare
  v_group   uuid;
  v_staff   uuid;
  v_message uuid;
  v_rows    bigint;
  v_kind    text;
begin
  select chat.id, staff_member.user_id, message.id
    into v_group, v_staff, v_message
    from public.chats chat
    join public.chat_members staff_member on staff_member.chat_id = chat.id
    join public.messages message          on message.chat_id = chat.id
   where chat.type <> 'private'
     and public.is_manager_or_admin(staff_member.user_id)
     and message.user_id is distinct from staff_member.user_id
     and message.user_id is not null
     and message.deleted_at is null
     and coalesce(message.type, 'text') <> 'system'
   limit 1;

  if v_group is null then
    insert into rehearsal_result values
      ('CONTROL: group delete still audited', 'NOT MEASURED - no such group message exists');
    return;
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);

  update public.messages set deleted_at = now() where id = v_message;

  select count(*), max(diff ->> 'chat_type')
    into v_rows, v_kind
    from public.audit_logs
   where action = 'message_deleted_by_staff' and target_id = v_message;

  insert into rehearsal_result values
    ('CONTROL: group delete still audited', v_rows::text),
    ('CONTROL: the row now names the chat kind', coalesce(v_kind, '(absent)'));

  perform set_config('request.jwt.claims', null, true);
end
$control$;

select step, measured from rehearsal_result order by step;

/**
 * Expected:
 *
 *   AFTER: private delete by staff wrote audit rows    | 0
 *   BEFORE: private delete by staff wrote audit rows   | 1
 *   CONTROL: group delete still audited                | 1
 *   CONTROL: the row now names the chat kind           | group   (or whatever
 *                                                                 `chats.type`
 *                                                                 that row has)
 *
 * A BEFORE of 0 means the rehearsal measured nothing and the fix is unproven —
 * stop and find out why rather than reading the AFTER as success.
 */

rollback;
