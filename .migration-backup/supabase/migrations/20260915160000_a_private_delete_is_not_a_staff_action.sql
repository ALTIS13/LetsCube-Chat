/**
 * Applied to production on 2026-09-15, after a verified schema backup
 * (1,338,630 bytes, sha256
 * 23c08ecbb3946fcfdb834a3cd650188df8e4a255fc71901dea25e3fe35ebd288, with the
 * completion marker present) and after its own rehearsal was run there and
 * rolled back:
 *
 *     BEFORE: private delete by staff wrote audit rows   1
 *     AFTER:  private delete by staff wrote audit rows   0
 *     CONTROL: group delete still audited                1
 *     CONTROL: the row now names the chat kind           group
 *
 * `audit_logs` held 392 rows before and 392 after, and the trigger is still
 * enabled on the same event.
 *
 * D-105. `trg_audit_messages_admin_delete` records `message_deleted_by_staff`
 * whenever somebody `is_manager_or_admin` soft-deletes a message that is not
 * theirs. The register called this «audited as staff» and rated it low, leaving
 * open whether the row is wrong or merely terse. Measured on production on
 * 2026-09-15 it is **wrong in every case it can fire**, and the reason is that
 * the trigger is the only layer that never asks *why* the delete was allowed.
 *
 * Exactly two functions assign `public.messages.deleted_at`:
 *
 *   - `public.bot_message_command_internal` — `service_role` only, never
 *     `authenticated`, so `auth.uid()` is null and the trigger's own
 *     `caller is not null` guard already skips it.
 *   - `public.delete_messages_for_everyone` — granted to `authenticated`, and
 *     the only path a person can take.
 *
 * A direct `UPDATE public.messages` cannot be a third, because the one
 * permissive UPDATE policy is `Users can edit own messages` — `user_id =
 * auth.uid()` — so the caller is always the author and the trigger's
 * `caller is distinct from new.user_id` guard skips it.
 *
 * And `delete_messages_for_everyone` splits on the chat:
 *
 *     if v_chat_type = 'private' then
 *       ... refuse only 'system' rows ...          -- anybody's message goes
 *     elsif exists (select 1 from public.messages message
 *                    where message.id = any (v_ids)
 *                      and (message.user_id is distinct from v_uid
 *                           or message.bot_id is not null)) then
 *       raise exception 'message_not_deletable'    -- a group: your own only
 *     end if;
 *
 * So in a group nobody — staff included — can delete another person's message
 * through this path, and in a private chat **every** member can. The trigger's
 * two guards therefore admit one situation and one only: a private chat, where
 * the caller acted as an ordinary participant. The capacity that permitted the
 * delete was membership, not rank.
 *
 * That makes the row wrong three times over. It names an action
 * (`message_deleted_by_staff`) that was not taken in a staff capacity; the
 * identical act by a non-staff participant is not recorded at all, so the table
 * audits the person rather than the act; and the payload carries `chat_id` and
 * the other party's id from a **private** conversation into a table that
 * `audit_logs select by permission` opens to anyone holding `audit.view` — five
 * of the eighteen accounts today, while 27 private chats exist.
 *
 * Nothing is being widened here and no permission changes. The trigger stops
 * recording a delete the caller was entitled to make as a participant, and the
 * rows it can still produce say which kind of chat they came from, so a reader
 * is not left inferring it. There is no staff message-moderation path on this
 * deployment for the trigger to record today; it is kept, rather than dropped,
 * for the day a moderator can remove a message from a group.
 *
 * Nothing to backfill: `select count(*) from public.audit_logs where action =
 * 'message_deleted_by_staff'` returned **0** on 2026-09-15, against 392 audit
 * rows in total, so the label has never actually been written.
 *
 * Rollback: 20260915160000_a_private_delete_is_not_a_staff_action.rollback.sql
 */

begin;

set local lock_timeout = '5s';

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

    -- A private chat lets every member delete anybody's message, so this was
    -- participation and not moderation. Recording it would audit the person for
    -- being staff rather than the act for being staff work, and would copy a
    -- private chat's id and the other party's id into a table five accounts
    -- can read.
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

do $check$
declare
  v_secdef   boolean;
  v_triggers bigint;
  v_private  bigint;
begin
  -- 1. Still a definer trigger function; a plain one could not write the audit.
  select p.prosecdef into v_secdef
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_audit_messages_admin_delete';
  if not coalesce(v_secdef, false) then
    raise exception '_audit_messages_admin_delete is not security definer';
  end if;

  -- 2. The trigger is still attached, and only once.
  select count(*) into v_triggers
    from pg_catalog.pg_trigger t
   where not t.tgisinternal
     and t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'trg_audit_messages_admin_delete';
  if v_triggers <> 1 then
    raise exception 'expected one audit trigger on public.messages, found %', v_triggers;
  end if;

  -- 3. Nothing already written is being silently left behind. This migration
  --    does not touch history, so it must be empty for that to be true.
  select count(*) into v_private
    from public.audit_logs
   where action = 'message_deleted_by_staff';
  if v_private <> 0 then
    raise exception
      '% message_deleted_by_staff rows predate this change; decide what to do with them before committing',
      v_private;
  end if;

  raise notice 'a delete anybody in the chat could have made is no longer recorded as staff work';
end
$check$;

commit;
