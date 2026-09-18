/**
 * Rollback for `20260918270000_a_call_over_an_hour_says_hours.sql`.
 *
 * Run as `supabase_admin`. It puts `voice_call_record_line` back to the two-arm
 * body it had after `20260918250000`, where an hour reads **«Звонок, 60 мин
 * 0 с»** and two hours «Звонок, 120 мин 0 с».
 *
 * **Roll the client back with it or not at all.** `lib/callRecord.ts` mirrors
 * this function character for character on purpose — the card and the `content`
 * under it are read side by side — so a database on the two-arm body under a
 * bundle with the three-arm one shows two different lengths for one call, which
 * is worse than either wording on its own.
 *
 * Records already written are unaffected either way: `content` is a string
 * decided when the row was inserted, and nothing rewrites it.
 */

begin;

create or replace function public.voice_call_record_line(
  p_outcome text,
  p_duration_ms integer
) returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_total integer := greatest(coalesce(p_duration_ms, 0), 0) / 1000;
  v_minutes integer := v_total / 60;
  v_seconds integer := v_total % 60;
begin
  if p_outcome = 'missed' then
    return 'Пропущенный звонок';
  end if;
  if p_outcome = 'declined' then
    return 'Звонок отклонён';
  end if;
  if p_outcome = 'cancelled' then
    return 'Отменённый звонок';
  end if;
  if p_outcome <> 'answered' then
    return null;
  end if;
  -- A call answered and hung up inside a second is still a call that happened,
  -- so it says so rather than «0 с»: the duration is the detail, the fact is
  -- the line.
  if v_total < 1 then
    return 'Звонок';
  end if;
  if v_minutes = 0 then
    return 'Звонок, ' || v_seconds::text || ' с';
  end if;
  return 'Звонок, ' || v_minutes::text || ' мин ' || v_seconds::text || ' с';
end
$function$;
comment on function public.voice_call_record_line(text, integer) is
  'The neutral sentence a call record carries in `content`, for readers without the payload.';

do $$
begin
  if public.voice_call_record_line('answered', 3600000) <> 'Звонок, 60 мин 0 с' then
    raise exception 'the hour arm survived the rollback';
  end if;
  if public.voice_call_record_line('answered', 192000) <> 'Звонок, 3 мин 12 с' then
    raise exception 'the rollback changed an arm it should not have';
  end if;
end;
$$;

commit;
