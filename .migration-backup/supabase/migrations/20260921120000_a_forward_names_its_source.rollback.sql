/**
 * Rollback for 20260921120000_a_forward_names_its_source.sql.
 *
 * Drops the trigger, its function and the three columns, which returns the
 * origin to what it was: an embed of the source message resolved per reader
 * through `public.messages` RLS, so the forwarder sees the name and a stranger
 * in the destination does not.
 *
 * DESTRUCTIVE, and in a way the forward migration is not. Dropping
 * `messages.forward_origin_name` and `messages.forward_origin_hidden` throws
 * away every origin recorded since the apply, including every **opt-out** that
 * was honoured — re-applying afterwards does not restore them, because there is
 * no backfill and the values were only ever written at forward time. Forwards
 * made in between would silently go back to disclosing the name to whoever has
 * access. Prefer leaving the columns in place and turning the client off, and
 * take this path only when the schema itself has to go.
 *
 * Drop order: the trigger before the function it calls, and the function before
 * the columns it reads.
 *
 * Apply as the owner of public.messages and public.privacy_preferences.
 */

begin;

drop trigger if exists trg_messages_forward_origin on public.messages;
drop function if exists public.messages_forward_origin();

alter table public.messages drop column if exists forward_origin_hidden;
alter table public.messages drop column if exists forward_origin_name;
alter table public.privacy_preferences drop column if exists forward_origin_visible;

comment on function public.forward_message(uuid, uuid, uuid, timestamptz, uuid) is
  'Forwards a message the caller can see into a chat they may write to, with its media fields and its ready preview variants. Idempotent on the client message id.';

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.messages'::regclass and tgname = 'trg_messages_forward_origin' and not tgisinternal
  ) then
    raise exception 'the trigger is still on public.messages';
  end if;
  if to_regprocedure('public.messages_forward_origin()') is not null then
    raise exception 'public.messages_forward_origin() is still defined';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.messages'::regclass
       and attname in ('forward_origin_name', 'forward_origin_hidden')
       and not attisdropped
  ) then
    raise exception 'the origin columns are still on public.messages';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.privacy_preferences'::regclass
       and attname = 'forward_origin_visible' and not attisdropped
  ) then
    raise exception 'privacy_preferences.forward_origin_visible is still there';
  end if;
  -- The thing the forward migration must not have touched is still untouched.
  if not (
    select bool_and(relrowsecurity) from pg_catalog.pg_class
     where oid in ('public.messages'::regclass, 'public.privacy_preferences'::regclass)
  ) then
    raise exception 'row level security is not enabled on messages and privacy_preferences';
  end if;
end
$$;

commit;
