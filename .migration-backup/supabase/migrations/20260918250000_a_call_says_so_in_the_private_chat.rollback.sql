/**
 * Rollback for `20260918250000_a_call_says_so_in_the_private_chat.sql`.
 *
 * Run as `supabase_admin`: it replaces a function that role owns and alters a
 * table `postgres` owns, and this deployment's `postgres` is not a superuser.
 *
 * **It destroys data, and only one kind.** Dropping `system_payload` takes the
 * structured detail of every call already recorded — the outcome, who called,
 * how long — with it. What survives is `content`, the neutral sentence each row
 * carries anyway («Пропущенный звонок», «Звонок, 3 мин 12 с»), so the
 * conversation still reads correctly afterwards; what is lost is the renderer's
 * ability to word it from the reader's own side. Read a count first if that
 * matters:
 *
 *   select count(*) from public.messages where system_payload is not null;
 *
 * `voice_call_stop` goes back to the body it had after
 * `20260918240000`, which clears a ring and writes nothing. Calls after that
 * leave no line in the conversation — which is the state this migration was
 * written to end, and is what a rollback restores.
 *
 * Idempotent.
 */

begin;

create or replace function public.voice_call_stop(p_channel_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_chat uuid;
  v_state text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_reason is null or p_reason not in ('cancelled', 'declined', 'answered', 'missed') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;

  select vc.chat_id,
         public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now)
    into v_chat, v_state
    from public.voice_channels as vc
   where vc.id = p_channel_id
     for update;

  if v_chat is null then
    raise exception 'no_such_room' using errcode = 'P0002';
  end if;
  if not public.is_chat_member(v_chat) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if v_state = 'idle' then
    return v_state;
  end if;

  update public.voice_channels as vc
     set ring_started_at = null,
         ring_caller = null,
         ring_answered_at = null,
         updated_at = v_now
   where vc.id = p_channel_id;

  return v_state;
end;
$$;

comment on function public.voice_call_stop(uuid, text) is
  'Clear a ring, whatever ended it. Idempotent: stopping an idle room is not an error.';

alter table public.messages
  drop constraint if exists messages_system_payload_shape_check;

alter table public.messages
  drop column if exists system_payload;

revoke execute on function public.voice_call_record_line(text, integer) from authenticated;
drop function if exists public.voice_call_record_line(text, integer);

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages' and column_name = 'system_payload'
  ) then
    raise exception 'system_payload survived the rollback';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'voice_call_record_line'
  ) then
    raise exception 'voice_call_record_line survived the rollback';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'voice_call_stop') like '%system_payload%' then
    raise exception 'voice_call_stop still writes a record';
  end if;
end;
$$;

commit;
