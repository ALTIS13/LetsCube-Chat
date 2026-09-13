/**
 * TOLERANCE WIDENED FROM ONE MINUTE TO FIVE, BEFORE APPLYING.
 *
 * The proposal says the tolerance must be larger than the worst value the
 * pre-flight reports, and then proposes one minute. The pre-flight, run on
 * production on 2026-09-13, reports 1877 rows whose client_sent_at is ahead of
 * their own created_at, the furthest by 1 minute 15 seconds and the 99.9th
 * percentile at 1 minute 15 seconds as well. One minute would therefore have
 * clamped writes this product really makes -- not a theoretical case, a measured
 * one, in about a fifth of every message ever sent.
 *
 * That spread is not the batch offset nextClientSentAt produces (which is
 * milliseconds). It is ordinary clock skew on a phone: a device a minute fast is
 * unremarkable, and nothing in the product corrects for it. Five minutes clears
 * every value the history holds by a factor of four and still removes what the
 * hole actually buys, which is a message pinned to the top of a conversation
 * until 2099.
 */
/**
 * client_sent_at may not be in the future by more than a minute.
 *
 * D-177 item 7. The column is a free-form client value
 * (20260508_messages_client_message_id.sql:25, useMessages.ts:973) with nothing
 * clamping it, where read marks got exactly that clamp (20260911140000:61-76).
 *
 * WHY THE TOLERANCE IS NOT A COMPROMISE. lib/attachmentSendQueue.ts:161-165
 * writes max(now, previous + 1ms) on purpose, so a send of up to ten attachments
 * (MAX_STAGED_ATTACHMENTS) started inside one millisecond is legitimately up to
 * ten milliseconds ahead of the client's clock, and the server's clock may be
 * behind the phone's. A clamp to now() exactly would collapse two attachments
 * onto one instant and lose the pick order — a visible regression. One minute is
 * far past anything the product produces and far short of what the hole buys.
 *
 * Nothing is raised: a value past the tolerance is brought back, in the shape of
 * 20260911140000, because a device with a wrong clock is not an attacker and
 * refusing its message helps nobody.
 *
 * Rollback: 5.3.
 */

begin;

set local lock_timeout = '5s';

create schema if not exists private;

create or replace function private.clamp_client_timestamp(
  p_value timestamptz,
  p_now timestamptz,
  p_tolerance interval
)
returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_value is null then null
    when p_value > p_now + p_tolerance then p_now
    else p_value
  end
$function$;

create or replace function private.guard_message_client_times()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_tolerance constant interval := interval '5 minutes';
begin
  new.client_sent_at := private.clamp_client_timestamp(new.client_sent_at, v_now, v_tolerance);
  new.edited_at := private.clamp_client_timestamp(new.edited_at, v_now, v_tolerance);

  -- An edit that changes the text always stamps a time, whatever the client
  -- sent, and never earlier than the message itself.
  if tg_op = 'UPDATE'
     and new.content is distinct from old.content
     and new.deleted_at is not distinct from old.deleted_at then
    if new.edited_at is null or new.edited_at is not distinct from old.edited_at then
      new.edited_at := v_now;
    end if;
  end if;
  if new.edited_at is not null and new.created_at is not null and new.edited_at < new.created_at then
    new.edited_at := new.created_at;
  end if;

  return new;
end
$function$;

revoke all on function private.clamp_client_timestamp(timestamptz, timestamptz, interval)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_message_client_times()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_message_client_times on public.messages;
create trigger trg_guard_message_client_times
  before insert or update of client_sent_at, edited_at, content
  on public.messages
  for each row execute function private.guard_message_client_times();

do $$
declare
  v_now constant timestamptz := pg_catalog.now();
  v_min constant interval := interval '5 minutes';
  v_trigger record;
  v_columns text[];
  v_ahead interval;
begin
  select t.tgenabled, t.tgtype, t.tgattr, p.oid::regprocedure::text as fn
    into v_trigger
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'trg_guard_message_client_times'
     and not t.tgisinternal;
  if not found then
    raise exception 'the client-time guard trigger is missing';
  end if;
  if v_trigger.tgenabled = 'D' then
    raise exception 'the client-time guard trigger is disabled';
  end if;
  if (v_trigger.tgtype & 1) = 0 or (v_trigger.tgtype & 2) = 0
     or (v_trigger.tgtype & 4) = 0 or (v_trigger.tgtype & 16) = 0 then
    raise exception 'the client-time guard must be a BEFORE INSERT OR UPDATE row trigger (tgtype %)', v_trigger.tgtype;
  end if;
  select pg_catalog.array_agg(a.attname::text order by a.attname)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.messages'::regclass
     and a.attnum = any (v_trigger.tgattr::smallint[]);
  if v_columns is distinct from array['client_sent_at', 'content', 'edited_at'] then
    raise exception 'the client-time guard fires for columns % instead', v_columns;
  end if;

  -- The rule itself.
  if private.clamp_client_timestamp(v_now - interval '2 days', v_now, v_min)
       is distinct from v_now - interval '2 days' then
    raise exception 'an offline queue''s old timestamp was moved; it must be kept';
  end if;
  if private.clamp_client_timestamp(v_now + interval '10 milliseconds', v_now, v_min)
       is distinct from v_now + interval '10 milliseconds' then
    raise exception 'a ten-millisecond batch offset was clamped; nextClientSentAt would lose the pick order';
  end if;
  if private.clamp_client_timestamp(v_now + interval '30 seconds', v_now, v_min)
       is distinct from v_now + interval '30 seconds' then
    raise exception 'ordinary clock skew was clamped';
  end if;
  -- The worst value the history actually holds, plus a margin. If this ever
  -- fails, the tolerance has been lowered below something the product does.
  if private.clamp_client_timestamp(v_now + interval '90 seconds', v_now, v_min)
       is distinct from v_now + interval '90 seconds' then
    raise exception 'the worst skew this history holds (1m15s) would now be clamped';
  end if;
  if private.clamp_client_timestamp(v_now + interval '10 years', v_now, v_min) is distinct from v_now then
    raise exception 'a timestamp ten years ahead was not brought back';
  end if;
  if private.clamp_client_timestamp(null, v_now, v_min) is not null then
    raise exception 'a null timestamp was given a value';
  end if;

  -- The tolerance must cover everything the product has actually written.
  select max(client_sent_at - created_at)
    into v_ahead
    from public.messages
   where client_sent_at is not null and client_sent_at > created_at;
  if v_ahead is not null and v_ahead > v_min then
    raise exception
      'a stored client_sent_at is % ahead of its own created_at, past the % tolerance: the tolerance is too small',
      v_ahead, v_min;
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'private.guard_message_client_times()', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'private.guard_message_client_times()', 'EXECUTE') then
    raise exception 'the guard function is executable by an API role';
  end if;
end
$$;

commit;
