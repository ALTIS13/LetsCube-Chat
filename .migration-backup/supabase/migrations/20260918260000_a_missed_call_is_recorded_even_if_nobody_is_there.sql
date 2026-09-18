/**
 * A missed call is written down even when nobody was there to notice.
 *
 * Slice C of `docs/proposals/2026-09-18-one-to-one-calls.md`, whose gate is one
 * sentence: **«a caller who closes their laptop mid-ring still produces exactly
 * one «missed» record».** Today the client that is present writes it at the
 * forty-fifth second, and if there is no such client the ring simply sits there:
 * expired by arithmetic, blocking nothing, recorded nowhere. The conversation
 * then says nothing about a call that was made — which is the one outcome the
 * owner named explicitly when asking for this.
 *
 * ── Why a cron job and not the reconciler ──────────────────────────────────
 *
 * The proposal offered three shapes and this is the third made concrete.
 *
 * **Not lazy resolution on read.** A missed call is precisely the thing a person
 * has not looked at yet. Resolving it when the chat is opened means it is absent
 * from the chat list until then, so the one row whose whole purpose is to be
 * noticed is the one row that waits to be noticed first.
 *
 * **Not the reconciler**, though it ticks every 30 seconds and would work. It
 * lives in `artifacts/api-server`, so this would be a second deployable to ship
 * and to keep in step, and the rule would sit a network away from the two tables
 * it reads and writes. `pg_cron` 1.6.4 is installed here and already runs
 * `letscube-message-read-events-cleanup` as a plain SQL call — the same shape,
 * with the schedule beside the data and nothing to deploy.
 *
 * ── The grace, and why it is expressed without repeating 45 ─────────────────
 *
 * The client that is present writes the record at 45 seconds; this sweep is the
 * fallback, not a competitor, so it waits for a ring that has been expired for a
 * further **30 seconds** before touching it. In the ordinary case the client
 * gets there first, the ring is already gone, and the sweep finds nothing.
 *
 * The grace is written as `voice_ring_state(started, answered, now() - grace)` —
 * «was it already expired thirty seconds ago» — rather than as
 * `started < now() - interval '75 seconds'`. Both are the same arithmetic today;
 * only the first stays correct if the 45 ever moves, because there is exactly
 * one place that knows it. The number 45 appears nowhere in this file.
 *
 * ── Exactly one record, whoever gets there first ───────────────────────────
 *
 * Same latch as `voice_call_stop`: the row is taken `for update`, the state is
 * re-read inside the lock, and a ring that somebody else has already cleared is
 * skipped. So the client and the sweep cannot both write, and two overlapping
 * sweeps cannot either.
 *
 * `skip locked` on the select, so a long sweep never blocks a person hanging up.
 *
 * ── What it deliberately does not touch ────────────────────────────────────
 *
 * **An `answered` ring.** That is a call that happened, and its record is
 * written when somebody leaves; the residue is cleared by
 * `private.voice_channel_recount` on its own two-minute grace
 * (`20260918240000`). A sweep that also cleaned those up would be a second
 * mechanism for one fact.
 *
 * **A group's voice channel.** A group room has no ring at all, so the predicate
 * excludes it by construction rather than by a chat-type test — but the test is
 * written anyway, because «by construction» is how a defect gets in later.
 */

begin;

/**
 * Resolve every ring that ran out while nobody was looking.
 *
 * Returns the number of calls it wrote down, so the cron entry's own history in
 * `cron.job_run_details` says what happened rather than only that it ran.
 */
create or replace function public.voice_rings_sweep_expired(
  p_grace_seconds integer default 30,
  p_limit integer default 200
) returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_now timestamptz := pg_catalog.now();
  -- `greatest` unqualified: it is a syntactic construct rather than a
  -- function, so `pg_catalog.greatest` does not resolve. Same trap as
  -- `extract(… from …)`, which this project met an hour earlier.
  v_grace interval := pg_catalog.make_interval(secs => greatest(p_grace_seconds, 0));
  v_room record;
  v_written integer := 0;
  v_state text;
  v_chat uuid;
  v_caller uuid;
begin
  for v_room in
    select vc.id
      from public.voice_channels as vc
      join public.chats as c on c.id = vc.chat_id
     where vc.ring_started_at is not null
       and vc.ring_answered_at is null
       and c.type = 'private'
       and public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now - v_grace) = 'expired'
     order by vc.ring_started_at
     limit greatest(p_limit, 0)
     for update of vc skip locked
  loop
    -- Re-read inside the lock. Between the select above and this line the
    -- caller's own client may have written the record and cleared the ring,
    -- which is the ordinary case rather than the exception.
    select vc.chat_id,
           vc.ring_caller,
           public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now)
      into v_chat, v_caller, v_state
      from public.voice_channels as vc
     where vc.id = v_room.id;

    if v_state <> 'expired' then
      continue;
    end if;

    insert into public.messages (chat_id, type, content, system_payload)
    values (
      v_chat,
      'system',
      public.voice_call_record_line('missed', null),
      pg_catalog.jsonb_build_object(
        'kind', 'call',
        'outcome', 'missed',
        'caller', v_caller,
        'duration_ms', null
      )
    );

    update public.voice_channels as vc
       set ring_started_at = null,
           ring_caller = null,
           ring_answered_at = null,
           updated_at = v_now
     where vc.id = v_room.id;

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

comment on function public.voice_rings_sweep_expired(integer, integer) is
  'Write down every one-to-one call that rang out unanswered with no client present, and clear its ring. Returns how many.';

/**
 * Nobody but the schedule.
 *
 * There is no interface for this and there should not be: a person pressing
 * something that resolves *other people''s* missed calls has no meaning, and the
 * function writes into conversations it was not asked about. `pg_cron` runs it
 * as the job''s owner, which needs no grant to `authenticated`.
 */
revoke all on function public.voice_rings_sweep_expired(integer, integer) from public;

-- ── The schedule ────────────────────────────────────────────────────────────

/**
 * Every minute, like `kub-send-push-notifications` beside it.
 *
 * A missed call should appear in the conversation while the person is still
 * wondering whether they missed one. With the thirty-second grace, the record
 * lands between 75 and 135 seconds after the call was made when no client was
 * there — and immediately at 45 when one was, which is the usual case.
 *
 * `schedule` is idempotent: scheduling a job whose name already exists replaces
 * it rather than adding a second.
 */
select cron.schedule(
  'letscube-voice-missed-call-sweep',
  '* * * * *',
  $cron$select public.voice_rings_sweep_expired();$cron$
);

-- ── The self-check ──────────────────────────────────────────────────────────

do $$
declare
  v_job record;
begin
  select jobname, schedule, active into v_job
    from cron.job where jobname = 'letscube-voice-missed-call-sweep';
  if v_job is null then
    raise exception 'the sweep was not scheduled';
  end if;
  if v_job.schedule <> '* * * * *' or not v_job.active then
    raise exception 'the sweep is scheduled as % (active: %)', v_job.schedule, v_job.active;
  end if;
  if (select count(*) from cron.job where jobname = 'letscube-voice-missed-call-sweep') <> 1 then
    raise exception 'the sweep is scheduled more than once';
  end if;

  -- The one number this file must not have its own copy of.
  if pg_get_functiondef('public.voice_rings_sweep_expired(integer, integer)'::regprocedure) like '%45%' then
    raise exception 'the sweep carries its own copy of the ring timeout';
  end if;

  -- And it must refuse to run for anybody but the schedule.
  if has_function_privilege('authenticated',
       'public.voice_rings_sweep_expired(integer, integer)', 'EXECUTE') then
    raise exception 'a client may run the missed-call sweep';
  end if;
end;
$$;

commit;
