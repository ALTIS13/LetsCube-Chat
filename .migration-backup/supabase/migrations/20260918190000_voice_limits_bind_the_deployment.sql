/**
 * The voice gateway's rate limit bounded one isolate, not the deployment.
 *
 * `supabase/functions/voice-gateway/moderationRateLimit.mjs` says so in its own
 * header, and says what the real thing would take: «A deployment-wide limit
 * needs a table and an RPC, which is the `support_rate_limit_signals` pattern
 * and a migration; it is not this.» This is that migration, for the token route
 * that had no limit at all and for the two moderation routes that had the
 * per-isolate one.
 *
 * ── Why per-isolate is not a limit ──────────────────────────────────────────
 *
 * The Supabase Edge Runtime runs a function in a short-lived isolate and starts
 * more of them under load. A `Map` in module scope is therefore one counter per
 * isolate, and the deployment's real limit is (isolates × 20) with no upper
 * bound on the first factor. Worse, it resets: a caller refused by one isolate
 * is a caller with a fresh allowance on the next request, because the isolate
 * that remembered them may already be gone. That is still worth having as a
 * pre-filter — it costs a map lookup and no round trip, so a held-down button
 * never reaches the database at all — and it stays in front of this. It is not
 * the limit.
 *
 * ── What this adds ──────────────────────────────────────────────────────────
 *
 *   private.voice_rate_limit_signals   one row per allowed action
 *   public.voice_rate_limit_consume    count the window and record, atomically
 *   public.voice_rate_limit_prune      the retention sweep the worker calls
 *   public.voice_active_participants   how many people this deployment carries
 *
 * The table is in `private` for the reason `private.voice_webhook_events` is:
 * PostgREST here exposes `public`, `storage` and `graphql_public`, and a
 * counter nobody outside the gateway may read belongs behind that. Only the
 * SECURITY DEFINER functions in `public` reach it, and only `service_role` may
 * execute those — the same shape as `voice_webhook_event_seen` and its table.
 *
 * ── A refusal records nothing, and that is what bounds the table ────────────
 *
 * `voice_rate_limit_consume` inserts only when it is about to answer yes.
 * Recording refusals would do two bad things at once: it would push the window
 * forward on every rejected attempt, locking a caller out for longer than the
 * window — `moderationRateLimit.mjs` has a test for exactly that, written after
 * a mutation stayed green — and it would make the row cost proportional to the
 * attack rate. As written, the cost per caller per window is the *limit*, 20
 * rows, however hard the caller hammers. The table therefore holds roughly one
 * window of legitimate traffic and cannot be grown by a loop.
 *
 * ── The concurrency cap, and the honest part of it ──────────────────────────
 *
 * `voice_active_participants` counts `public.voice_participants` — the SFU's
 * mirror — plus the mints that have not yet become a row in it. The second half
 * is not decoration. The mirror lags: a token is minted, LiveKit accepts the
 * connection, `participant_joined` arrives, and only then does the row exist.
 * Counting the mirror alone would let a rush of simultaneous joins all read the
 * same pre-rush number and all pass, which is exactly the situation a
 * concurrency cap exists for. Counting recent mints that have no participant
 * row closes that, at the cost of a conservative error: somebody who asks for a
 * token and never connects occupies a notional seat for thirty seconds.
 *
 * **What it still is not.** LiveKit enforces `max_participants` per room and
 * has no server-wide equivalent, so this cap is advisory at the gateway: it
 * refuses to *mint* past the number, it cannot evict anybody already connected,
 * and a client holding a token minted before the cap was reached still joins.
 * The per-room cap remains the hard one.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * It is not a policy change, a grant change to any existing object, or a change
 * to anything the interface reads. It does not touch `public.voice_channels`,
 * `public.voice_participants`, `private.voice_webhook_events`,
 * `private.voice_channel_recount`, `public.chats`, `public.chat_members` or any
 * policy on any of them. `public.voice_participants` is read by one of the new
 * functions and altered by none of them.
 *
 * It is also not the kill switch. `VOICE_ENABLED` is an environment value the
 * running function reads (`supabase/functions/voice-gateway/admission.mjs`), on
 * the `BOT_CREATION_ENABLED` pattern, and deliberately not a row here: a switch
 * that needed a working database would be unusable in the outage it exists for.
 *
 * ── Applying ────────────────────────────────────────────────────────────────
 *
 * **As `supabase_admin`**, and the reasoning matters more than the name because
 * two migrations in this directory guessed it wrong in opposite directions.
 *
 * Ownership here does not follow the schema. `20260918180000`'s header records
 * the measurement: `public.voice_channels` and `public.voice_participants` are
 * owned by `supabase_admin`, while `public.chat_channel_categories`, `topics`
 * and `chats` are owned by `postgres` — and `20260913150000`, which created the
 * voice objects, *documents itself* as «apply as the owner of public.chats
 * (postgres on this deployment)» while the objects it produced are
 * `supabase_admin`'s. So the file's own sentence is not evidence either.
 *
 * Three things follow, and each one independently picks `supabase_admin`:
 *
 *   1. `private.voice_rate_limit_signals` joins siblings in `private` created by
 *      that same migration, so its owner should match theirs rather than
 *      introduce a second owner in a schema with two objects in it.
 *   2. `public.voice_active_participants` is SECURITY DEFINER and reads
 *      `public.voice_participants`, whose grants are `select` to
 *      `authenticated` and `all` to `service_role` — `postgres` is not
 *      superuser on a Supabase deployment and holds no explicit grant there, so
 *      a function owned by `postgres` could raise «permission denied for table
 *      voice_participants» at call time rather than at apply time. The
 *      behavioural check at the bottom calls the function, so this failure
 *      cannot reach production silently either way.
 *   3. `supabase_admin` is a member of `postgres`; `postgres` is not a member of
 *      `supabase_admin` (`pg_has_role('postgres','supabase_admin','MEMBER')` is
 *      false). The asymmetry means `supabase_admin` can do everything `postgres`
 *      could do here and not the reverse.
 *
 * The first block below refuses to proceed if `current_user` cannot create in
 * `private`, and the last one refuses to commit if the new table's owner is not
 * the owner of `private.voice_webhook_events` — so a wrong role fails with a
 * sentence naming the right one instead of leaving a half-owned schema.
 *
 * **Locks, statement by statement. Nothing existing is locked and nothing is
 * rewritten.**
 *
 *   * `create table if not exists private.voice_rate_limit_signals` — ACCESS
 *     EXCLUSIVE on a relation that does not exist yet and that no other session
 *     can name until commit. Row locks on `pg_class`, `pg_type`, `pg_attribute`
 *     and `pg_depend` for the new rows. No lock on any existing table.
 *   * `create index if not exists … on private.voice_rate_limit_signals` — SHARE
 *     on that same brand-new, empty table. Instant, and contends with nobody.
 *   * `create or replace function` ×3 — all three names are new, so each is an
 *     insert into `pg_proc` and takes no table-level lock anywhere. (Had a
 *     function of the same signature existed, the form takes a brief
 *     ExclusiveLock on that function object alone.)
 *   * `revoke` / `grant execute` — object locks on the three new functions.
 *   * `comment on` — the same object locks again.
 *   * the `do $check$` block — ACCESS SHARE on `public.voice_participants`
 *     (an ordinary read) and ordinary row writes on the new private table,
 *     which it deletes again before commit.
 *
 * There is no `alter table` on an existing relation anywhere in this file, so
 * no ACCESS EXCLUSIVE is taken on anything a reader or a writer might hold, and
 * no heap or index is rebuilt. `lock_timeout = '5s'` bounds the wait anyway, so
 * a blocked acquisition rolls the whole transaction back rather than queueing
 * production traffic behind it.
 *
 * **Additive and idempotent.** Every statement is `if not exists` or `or
 * replace`, so a second application performs no new DDL and takes no lock
 * beyond the reads. Applying it twice is a no-op that still runs the check.
 *
 * **Deploy order does not matter, in either direction.** The gateway treats a
 * missing function, an error, or an answer it does not recognise as «allow, and
 * warn once» (`readVoiceRateLimitAnswer`), so the function may ship before this
 * file or after it, and this file may be rolled back under a running gateway.
 * The failure mode is «the limit degrades to per-isolate», never «voice is
 * down». That is the whole reason the limiter fails open: it is an abuse
 * control, and every check that decides whether somebody may be in a call at
 * all — `is_banned`, the membership row, the per-channel cap — still fails
 * closed in the gateway.
 *
 * One thing to watch at apply time rather than assume: PostgREST reaches these
 * functions only after its schema cache reloads, which this deployment's DDL
 * event trigger does on its own (no migration in this directory sends
 * `notify pgrst`). If `voice_rate_limit_consume` answers 404 immediately after
 * commit, that is a stale cache and not a missing function — and by the
 * paragraph above it is a degradation, not an outage.
 *
 * Rollback: 20260918190000_voice_limits_bind_the_deployment.rollback.sql.
 * Run that as `supabase_admin` too.
 */

begin;

set local lock_timeout = '5s';

/**
 * The preconditions, checked before any DDL so that a wrong role fails with a
 * sentence naming the right one rather than with «permission denied for schema
 * private» halfway through.
 */
do $precondition$
begin
  if pg_catalog.to_regnamespace('private') is null then
    raise exception
      'schema private does not exist, so 20260913150000_voice_channels.sql has not been applied here';
  end if;
  if pg_catalog.to_regclass('public.voice_participants') is null then
    raise exception
      'public.voice_participants does not exist, so there is nothing for a concurrency cap to count';
  end if;
  if not pg_catalog.has_schema_privilege(current_user, 'private', 'CREATE') then
    raise exception
      '% cannot create in schema private; apply this as supabase_admin, which owns the objects already in it',
      current_user;
  end if;
end
$precondition$;

/**
 * One row per allowed action, and nothing else.
 *
 * **No surrogate key on purpose.** There is no natural one — two mints in the
 * same microsecond are two genuine signals, not a conflict — and a primary key
 * would add a second index to maintain on the one table in this change that is
 * written on the hot path, in exchange for an identity nothing needs. Nothing
 * ever selects a single row: the counter aggregates and the sweep deletes by
 * time.
 *
 * **No foreign key to `public.profiles` either.** A signal outlives nothing and
 * means nothing after its window; a reference would add a lock on `profiles`
 * here, a check on every insert, and a cascade that is pure cost for rows the
 * sweep is about to delete anyway.
 *
 * `action` is constrained rather than free text, so a typo in the gateway
 * cannot quietly create a third bucket that counts nobody. It raises, the
 * gateway reads that as «I could not ask», and the warn-once line says so.
 */
create table if not exists private.voice_rate_limit_signals (
  user_id    uuid not null,
  action     text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint voice_rate_limit_signals_action_check
    check (action in ('token_mint', 'moderate'))
);

comment on table private.voice_rate_limit_signals is
  'One row per allowed voice action, for a rate limit that binds the deployment '
  'rather than one Edge Function isolate. A refusal records nothing, so the row '
  'cost per caller per window is the limit itself. Swept by voice_rate_limit_prune.';

/**
 * One index, leading with `action`, and it serves all three readers:
 *
 *   * the counter filters `action = ? and user_id = ? and created_at > ?` — the
 *     whole key, a prefix scan then a range;
 *   * the in-flight half of the concurrency cap filters `action = 'token_mint'
 *     and created_at > ?` — the leading column, then a filter;
 *   * the sweep filters `created_at < ?` — no usable prefix, but the table holds
 *     roughly one window of traffic, so that is a scan of a few hundred rows.
 *
 * A second index for the sweep would be paid for on every insert to save a scan
 * of a table that is already small by construction.
 */
create index if not exists voice_rate_limit_signals_scope_idx
  on private.voice_rate_limit_signals (action, user_id, created_at desc);

/**
 * Count the caller's window and record this attempt, in one transaction.
 *
 * The advisory lock is what makes «count then insert» safe across isolates:
 * without it two requests arriving together both read `used = limit - 1` and
 * both insert, and the limit is off by the number of isolates. It is taken per
 * (action, caller) rather than globally, so two different callers never wait on
 * each other, and it is an `xact` lock, so it is released by the commit that
 * records the row. `support_email_ingest_inbound` serializes its own counters
 * exactly this way.
 *
 * `clock_timestamp()` rather than `now()`: `now()` is the transaction's start
 * time, which is the same value for every statement in it, and a window
 * measured from a transaction that waited on the advisory lock would be
 * measured from before the wait.
 */
create or replace function public.voice_rate_limit_consume(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_now timestamptz;
  v_window interval;
  v_used integer;
  v_oldest timestamptz;
begin
  if p_user_id is null
     or p_action is null
     or p_limit is null or p_limit < 1 or p_limit > 10000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400
  then
    raise exception 'invalid_voice_rate_limit_request';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('voice_rate_limit:' || p_action || ':' || p_user_id::text, 0)
  );

  select pg_catalog.count(*)::integer, pg_catalog.min(signal.created_at)
    into v_used, v_oldest
    from private.voice_rate_limit_signals as signal
   where signal.action = p_action
     and signal.user_id = p_user_id
     and signal.created_at > v_now - v_window;

  if v_used >= p_limit then
    -- Nothing is written here. See the header: recording a refusal would push
    -- the window forward on every rejected attempt and make the row cost
    -- proportional to the attack rate instead of to the limit.
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'retry_after_seconds',
      greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from (coalesce(v_oldest, v_now) + v_window - v_now))
        )::integer
      )
    );
  end if;

  insert into private.voice_rate_limit_signals (user_id, action, created_at)
  values (p_user_id, p_action, v_now);

  return pg_catalog.jsonb_build_object('ok', true);
end;
$function$;

comment on function public.voice_rate_limit_consume(uuid, text, integer, integer) is
  'Spend one of a caller''s allowance for one action, counted across the whole '
  'deployment. Returns {"ok":true} or {"ok":false,"retry_after_seconds":N}. A '
  'refusal writes nothing.';

/**
 * How many people this deployment is carrying right now.
 *
 * Connected, as the SFU's mirror reports them, plus the callers who have been
 * given a token in the last `p_in_flight_seconds` and do not yet appear in it.
 * See the header for why the second half is not optional and what it costs.
 *
 * `count(distinct user_id)` rather than `count(*)`: a caller who retried a join
 * twice in the window is one person, not two, and counting attempts would let
 * one flaky client eat the cap.
 */
create or replace function public.voice_active_participants(
  p_in_flight_seconds integer default 30
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_now timestamptz;
  v_connected integer;
  v_in_flight integer;
begin
  if p_in_flight_seconds is null or p_in_flight_seconds < 0 or p_in_flight_seconds > 600 then
    raise exception 'invalid_voice_in_flight_window';
  end if;

  v_now := pg_catalog.clock_timestamp();

  select pg_catalog.count(*)::integer
    into v_connected
    from public.voice_participants;

  select pg_catalog.count(distinct signal.user_id)::integer
    into v_in_flight
    from private.voice_rate_limit_signals as signal
   where signal.action = 'token_mint'
     and signal.created_at > v_now - pg_catalog.make_interval(secs => p_in_flight_seconds)
     and not exists (
       select 1
         from public.voice_participants as seated
        where seated.user_id = signal.user_id
     );

  return coalesce(v_connected, 0) + coalesce(v_in_flight, 0);
end;
$function$;

comment on function public.voice_active_participants(integer) is
  'Participants the SFU mirror holds, plus callers issued a token within the '
  'window who are not in it yet. Advisory: it bounds minting, not anyone '
  'already connected.';

/** Signals older than the longest window are worthless. `voice_webhook_events_purge` exactly. */
create or replace function public.voice_rate_limit_prune(p_older_than timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_deleted integer;
begin
  if p_older_than is null then
    return 0;
  end if;
  delete from private.voice_rate_limit_signals where created_at < p_older_than;
  get diagnostics v_deleted = row_count;
  return coalesce(v_deleted, 0);
end;
$function$;

comment on function public.voice_rate_limit_prune(timestamptz) is
  'Retention sweep for private.voice_rate_limit_signals, called by the voice '
  'reconciler beside voice_webhook_events_purge.';

/**
 * Only the gateway and the worker may ask any of this, on the same loop
 * `20260913150000` used for its own six functions. `service_role` is revoked
 * before it is granted so the file states the end state rather than relying on
 * what a previous application left.
 */
do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.voice_rate_limit_consume(uuid,text,integer,integer)',
    'public.voice_active_participants(integer)',
    'public.voice_rate_limit_prune(timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$grants$;

/**
 * The self-check, which raises rather than committing half of this.
 *
 * Two of the three assertions below are behavioural: they *call* the functions
 * and read what they answered. A structural check — the names are in `pg_proc`,
 * the table is in `pg_class` — would have passed on a limiter that counted the
 * wrong window, on one that recorded its refusals, and on a definer that cannot
 * read `public.voice_participants` at all, which is the failure mode the
 * ownership note in the header spends three paragraphs on.
 *
 * The synthetic caller is the nil uuid, which no account can hold, and every
 * row it produces is deleted before the block ends.
 */
do $check$
declare
  v_probe uuid = '00000000-0000-0000-0000-000000000000';
  v_first jsonb;
  v_second jsonb;
  v_retry integer;
  v_active integer;
  v_connected_only integer;
  v_seated integer;
  v_pruned integer;
  v_rows integer;
  v_owner name;
  v_sibling_owner name;
  v_signature text;
  v_role text;
begin
  -- Ownership, compared against the sibling rather than against a hard-coded
  -- name, so this cannot drift from whatever `private` actually belongs to.
  select tableowner into v_owner
    from pg_catalog.pg_tables
   where schemaname = 'private' and tablename = 'voice_rate_limit_signals';
  select tableowner into v_sibling_owner
    from pg_catalog.pg_tables
   where schemaname = 'private' and tablename = 'voice_webhook_events';
  if v_owner is null then
    raise exception 'private.voice_rate_limit_signals was not created';
  end if;
  if v_sibling_owner is not null and v_owner <> v_sibling_owner then
    raise exception
      'private.voice_rate_limit_signals is owned by % while its sibling private.voice_webhook_events is owned by %; re-run this as %',
      v_owner, v_sibling_owner, v_sibling_owner;
  end if;

  -- Nobody but service_role may reach any of the three.
  foreach v_signature in array array[
    'public.voice_rate_limit_consume(uuid,text,integer,integer)',
    'public.voice_active_participants(integer)',
    'public.voice_rate_limit_prune(timestamptz)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception '% does not exist', v_signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'service_role cannot execute %, so the gateway could never call it', v_signature;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(v_role, v_signature, 'execute') then
        raise exception '% can execute %, which no client may', v_role, v_signature;
      end if;
    end loop;
  end loop;

  -- BEHAVIOURAL 1. A limit of one means the second attempt in the window is
  -- refused, with a retry-after inside that window. A source scan cannot see
  -- either half of that sentence.
  v_first := public.voice_rate_limit_consume(v_probe, 'token_mint', 1, 60);
  if v_first is distinct from pg_catalog.jsonb_build_object('ok', true) then
    raise exception 'the first attempt within an empty window was refused: %', v_first;
  end if;

  v_second := public.voice_rate_limit_consume(v_probe, 'token_mint', 1, 60);
  if (v_second->>'ok')::boolean is not false then
    raise exception 'a second attempt past a limit of one was allowed: %', v_second;
  end if;
  v_retry := (v_second->>'retry_after_seconds')::integer;
  if v_retry is null or v_retry < 1 or v_retry > 60 then
    raise exception 'the refusal reported retry_after_seconds = %, which is not inside the window', v_retry;
  end if;

  -- And the refusal recorded nothing, which is what keeps a hammering caller
  -- from extending their own lockout and the table from growing with the
  -- attack rate. One row, not two.
  select pg_catalog.count(*)::integer into v_rows
    from private.voice_rate_limit_signals
   where user_id = v_probe and action = 'token_mint';
  if v_rows <> 1 then
    raise exception
      'two attempts against a limit of one left % rows; a refusal must record nothing', v_rows;
  end if;

  -- BEHAVIOURAL 2. The cap, in two halves, measured separately.
  --
  -- **The first draft asserted `v_active >= 1` and proved neither half**, which
  -- two mutations demonstrated rather than argued: deleting the in-flight
  -- subquery left the check green, because the connected count alone satisfied
  -- it, and replacing the connected count with a literal zero left it green
  -- too, because the probe's own in-flight signal satisfied it. One assertion
  -- covering two summands is covered by either of them.
  --
  -- So the two are isolated by the window. `voice_active_participants(0)`
  -- cannot see any in-flight signal — `created_at > now() - 0s` matches nothing
  -- already written — so it is the connected count and nothing else, and it has
  -- the table itself to be compared against. The same call with a 30-second
  -- window must then be strictly larger, and the only thing that can have
  -- widened it is the probe's own `token_mint` row, since the nil uuid holds no
  -- participant row anywhere.
  --
  -- It also proves the definer can read `public.voice_participants` at all,
  -- which is the ownership failure the header spends three paragraphs on: a
  -- function created by a role holding no grant on a table owned by another one
  -- would otherwise surface as a runtime «permission denied» long after this
  -- file was declared applied.
  --
  -- The three measurements below are adjacent, and somebody joining or leaving
  -- a call in the microseconds between them is the one thing that could make
  -- this raise on a migration that is perfectly correct. The remedy is to run
  -- the file again, which by the header's guarantee is a no-op that repeats
  -- only the check.
  select pg_catalog.count(*)::integer into v_seated from public.voice_participants;
  v_connected_only := public.voice_active_participants(0);
  v_active := public.voice_active_participants(30);

  if v_connected_only is null or v_active is null then
    raise exception 'voice_active_participants answered null, so the cap has nothing to compare against';
  end if;
  if v_connected_only <> v_seated then
    raise exception
      'voice_active_participants(0) answered % where public.voice_participants holds % rows, so the connected half is not counting the mirror',
      v_connected_only, v_seated;
  end if;
  if v_active < v_connected_only + 1 then
    raise exception
      'a token_mint signal for a caller with no participant row did not count towards capacity (% with a 30s window against % with none), so the in-flight half is not wired in',
      v_active, v_connected_only;
  end if;

  -- One person retrying is one person. A second mint for the same caller must
  -- not widen the cap, or a client whose join keeps failing would eat capacity
  -- it never used. Written directly into the table rather than through the
  -- limiter, because the limiter would refuse a second attempt against the
  -- limit of one used above -- and that is the point: `count(distinct)` has to
  -- be proved against two rows, which only a direct insert can produce here.
  insert into private.voice_rate_limit_signals (user_id, action, created_at)
  values (v_probe, 'token_mint', pg_catalog.clock_timestamp());
  if public.voice_active_participants(30) <> v_active then
    raise exception
      'a second token_mint signal for the same caller moved the capacity count, so one flaky client can eat the cap';
  end if;

  -- A different action has its own allowance, so moderating does not spend the
  -- allowance needed to rejoin the call.
  if (public.voice_rate_limit_consume(v_probe, 'moderate', 1, 60)->>'ok')::boolean is not true then
    raise exception 'the token_mint window closed the moderate window; the allowances are not separate';
  end if;

  -- An action the constraint does not know must raise rather than open a third
  -- bucket that counts nobody.
  begin
    perform public.voice_rate_limit_consume(v_probe, 'not_an_action', 1, 60);
    raise exception 'an unknown action was accepted, so a typo in the gateway would silently stop limiting';
  exception
    when check_violation then null;
  end;

  -- The sweep, on a row planted two days in the past.
  --
  -- Deliberately *not* called with a threshold in the future: on a second
  -- application this table may hold live signals, and a check that wiped them
  -- would reset real callers' allowances to prove a point. A day is far past
  -- any window and past every sweep the reconciler has run since, so the only
  -- row this can reach is the one planted here. It is also outside both the
  -- 60-second counting window and the 30-second in-flight window, so it cannot
  -- disturb the assertions above.
  insert into private.voice_rate_limit_signals (user_id, action, created_at)
  values (v_probe, 'token_mint', pg_catalog.clock_timestamp() - interval '2 days');

  v_pruned := public.voice_rate_limit_prune(pg_catalog.clock_timestamp() - interval '1 day');
  if v_pruned < 1 then
    raise exception 'the sweep deleted nothing, with a two-day-old row in front of it';
  end if;
  if exists (
    select 1 from private.voice_rate_limit_signals
     where user_id = v_probe and created_at < pg_catalog.clock_timestamp() - interval '1 day'
  ) then
    raise exception 'the sweep reported a deletion and the stale row is still there';
  end if;

  delete from private.voice_rate_limit_signals where user_id = v_probe;

  raise notice
    'the voice rate limit now binds the deployment, and the concurrency cap can count what it is capping';
end
$check$;

commit;
