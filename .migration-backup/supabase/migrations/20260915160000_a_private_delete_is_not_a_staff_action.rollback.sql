/**
 * PROPOSED — NOT APPLIED. Rollback for
 * 20260915160000_a_private_delete_is_not_a_staff_action.sql.
 *
 * Restores `public._audit_messages_admin_delete` byte for byte as it was read
 * off production with `pg_get_functiondef` on 2026-09-15, before the D-105
 * change: no chat lookup, no private-chat branch, and a payload without
 * `chat_type`.
 *
 * Safe to run at any time. The trigger itself is never dropped or recreated by
 * either file, so nothing detaches; only the function body changes. Any
 * `message_deleted_by_staff` rows written while the new body was live are
 * group-chat rows and stay valid — this rollback simply lets private-chat
 * deletes start being recorded again.
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
  caller uuid := auth.uid();
begin
  if old.deleted_at is null
     and new.deleted_at is not null
     and caller is not null
     and caller is distinct from new.user_id
     and public.is_manager_or_admin(caller)
  then
    perform public._audit(
      'message_deleted_by_staff',
      'message',
      new.id,
      jsonb_build_object(
        'chat_id', new.chat_id,
        'author',  new.user_id,
        'type',    new.type
      )
    );
  end if;
  return null;
end $function$;

do $check$
declare
  v_triggers bigint;
begin
  select count(*) into v_triggers
    from pg_catalog.pg_trigger t
   where not t.tgisinternal
     and t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'trg_audit_messages_admin_delete';
  if v_triggers <> 1 then
    raise exception 'expected one audit trigger on public.messages, found %', v_triggers;
  end if;
  raise notice 'the pre-D-105 audit body is back';
end
$check$;

commit;
