begin;

\echo == before ==
select public.voice_call_record_line('answered', 3600000) as one_hour_before;
/**
 * A call over an hour says hours.
 *
 * `20260918250000_a_call_says_so_in_the_private_chat.sql` wrote
 * `voice_call_record_line` with two arms — seconds, and minutes-and-seconds —
 * and no third. So an hour reads **«Звонок, 60 мин 0 с»**, and a two-hour call
 * «Звонок, 120 мин 0 с». Not wrong arithmetic; wrong units, and the one place
 * the wording reads as though nobody had tried it.
 *
 * Found by the agent building the renderer, which mirrors this function
 * character for character on purpose — the card and the `content` under it are
 * read side by side, and a bundle older than the payload shows the latter — so
 * it inherited the gap and flagged it rather than diverging. That was the right
 * call: diverging would have made one call show two different lengths.
 *
 * ── Seconds are dropped once hours appear, deliberately ────────────────────
 *
 * «1 ч 2 мин», not «1 ч 2 мин 33 с». At that scale the seconds are noise: a
 * person reading a call log wants to know it was about an hour, and the extra
 * two tokens cost width in a row that is already the widest thing in the
 * conversation. A round hour drops the minutes too — «1 ч» rather than
 * «1 ч 0 мин» — for the same reason the round-minute case keeps its «0 с»: the
 * minute form is level with a second form that exists, and there is no
 * corresponding hour form to be level with.
 *
 * The existing arms are untouched. Every call shorter than an hour reads exactly
 * as it did, which the self-check asserts case by case rather than trusting that
 * an added branch changed nothing.
 */


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
  v_hours integer := v_total / 3600;
  v_minutes integer := (v_total % 3600) / 60;
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
  if v_hours > 0 then
    if v_minutes = 0 then
      return 'Звонок, ' || v_hours::text || ' ч';
    end if;
    return 'Звонок, ' || v_hours::text || ' ч ' || v_minutes::text || ' мин';
  end if;
  if v_minutes = 0 then
    return 'Звонок, ' || v_seconds::text || ' с';
  end if;
  return 'Звонок, ' || v_minutes::text || ' мин ' || v_seconds::text || ' с';
end
$function$;

do $$
begin
  -- The new arm.
  if public.voice_call_record_line('answered', 3600000) <> 'Звонок, 1 ч'
     or public.voice_call_record_line('answered', 3660000) <> 'Звонок, 1 ч 1 мин'
     or public.voice_call_record_line('answered', 3719000) <> 'Звонок, 1 ч 1 мин'
     or public.voice_call_record_line('answered', 7392000) <> 'Звонок, 2 ч 3 мин' then
    raise exception 'the hour arm does not answer its own cases';
  end if;

  -- And every arm that existed before, unchanged. Asserted case by case rather
  -- than assumed: an added branch that quietly moved a boundary is exactly the
  -- kind of change that looks safe in a diff.
  if public.voice_call_record_line('missed', null) <> 'Пропущенный звонок'
     or public.voice_call_record_line('declined', null) <> 'Звонок отклонён'
     or public.voice_call_record_line('cancelled', null) <> 'Отменённый звонок'
     or public.voice_call_record_line('answered', 0) <> 'Звонок'
     or public.voice_call_record_line('answered', 999) <> 'Звонок'
     or public.voice_call_record_line('answered', 1000) <> 'Звонок, 1 с'
     or public.voice_call_record_line('answered', 59000) <> 'Звонок, 59 с'
     or public.voice_call_record_line('answered', 60000) <> 'Звонок, 1 мин 0 с'
     or public.voice_call_record_line('answered', 192000) <> 'Звонок, 3 мин 12 с'
     or public.voice_call_record_line('answered', 3599000) <> 'Звонок, 59 мин 59 с'
     or public.voice_call_record_line('nonsense', 1) is not null then
    raise exception 'an arm that existed before this migration changed';
  end if;
end;
$$;


\echo == after ==
select public.voice_call_record_line('answered', 3600000) as h1,
       public.voice_call_record_line('answered', 3660000) as h1m1,
       public.voice_call_record_line('answered', 7392000) as h2m3,
       public.voice_call_record_line('answered', 3599000) as just_under,
       public.voice_call_record_line('answered', 192000) as unchanged;
rollback;
