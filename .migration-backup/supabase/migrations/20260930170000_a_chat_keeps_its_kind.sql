/**
 * A conversation keeps the kind it was made as (2026-09-30).
 *
 * FOUND, measured rather than supposed. `authenticated` holds UPDATE on the
 * whole of `public.chats`, `type` included, and «Chat admins update chat» lets
 * an owner or administrator update their chat's row. Whoever opens a private
 * chat is its owner. Inside a rolled-back transaction, impersonating a private
 * chat's opener, `update public.chats set type = 'group'` changed one row, the
 * same as a control that changed only the description.
 *
 * WHAT IT OPENED, none of it reachable from the interface, all of it through
 * the API:
 *
 *   - A block, undone. `blocked_from_chat` stops messages and rings in a
 *     private chat only. Somebody who has been blocked, and who opened the
 *     private chat, could make it a `group` and go on writing to the person who
 *     blocked them.
 *   - The other person's history, deleted. «Chat owners delete chat» refuses a
 *     private chat since `20260911120000`; after a change of type the refusal no
 *     longer applies, so the opener could delete the conversation, messages and
 *     media included, for both sides.
 *   - A group chat, made a server by its crown, and a server made a private
 *     chat or a group chat by its owner, outside every rule each kind has.
 *
 * THE FIX. Nothing legitimate changes a chat's kind: no function does, and the
 * client writes only the name, the description, the picture, the invitation
 * policy and `updated_at`. So `type`, and with it `created_by` and
 * `created_at`, are fixed at insert for every role, the database owner
 * included. A trigger rather than column grants: a column REVOKE cannot cut
 * the table-level grant (docs/operations/working-lessons.md §5), and a trigger
 * holds whoever the caller is.
 *
 * Lock: CREATE TRIGGER on public.chats takes SHARE ROW EXCLUSIVE briefly;
 * `lock_timeout` keeps it from queueing behind a long transaction.
 *
 * Rollback: 20260930170000_a_chat_keeps_its_kind.rollback.sql
 */
begin;
set local lock_timeout = '5s';

create or replace function private.chats_identity_is_fixed()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.type is distinct from old.type then
    raise exception 'chat_type_is_fixed' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'chat_identity_is_fixed' using errcode = '42501';
  end if;
  return new;
end
$function$;

revoke all on function private.chats_identity_is_fixed() from public;

drop trigger if exists trg_chats_identity_is_fixed on public.chats;
create trigger trg_chats_identity_is_fixed
  before update on public.chats
  for each row
  execute function private.chats_identity_is_fixed();

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.chats'::regclass
       and tgname = 'trg_chats_identity_is_fixed'
       and tgenabled = 'O'
       and not tgisinternal
  ) then
    raise exception 'chat_kind_migration_incomplete';
  end if;
end;
$$;

commit;
