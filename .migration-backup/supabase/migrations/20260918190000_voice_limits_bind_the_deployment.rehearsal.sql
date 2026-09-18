/**
 * Rehearses 20260918190000_voice_limits_bind_the_deployment.sql on an empty
 * throwaway Postgres, so that the SQL is proved to parse and its behavioural
 * self-check is proved to pass **before** the file goes near production.
 *
 * WHY A THROWAWAY AND NOT PRODUCTION. The migration's own `do $check$` block is
 * the real proof and it runs wherever the file runs — but it runs *after* the
 * DDL, so a typo in a function body would be discovered on production, inside a
 * transaction that then rolls back. There is nothing dangerous about that and
 * it is still the wrong place to find out. This is the cheap place.
 *
 * WHAT IT PROVES, and the boundary matters: the syntax, the plpgsql, the
 * counting window, the «a refusal records nothing» rule, the separate
 * allowances per action, the check constraint, the in-flight half of the
 * concurrency cap, and the sweep. It also exercises the sibling-owner guard
 * with a sibling present.
 *
 * WHAT IT CANNOT PROVE: production's ownership and grants. `supabase_admin`,
 * the real owner of `public.voice_participants`, does not exist here, so the
 * definer-can-read assertion passes for a reason production must confirm on its
 * own — which is exactly why that assertion is in the migration rather than
 * only here.
 *
 * HOW IT WAS RUN (2026-09-18, from this worktree, on **PostgreSQL 18.4**). The
 * cluster is created in a temporary directory, listens on 127.0.0.1:55433 only,
 * and is deleted afterwards; Docker was not running on this workstation, which
 * is why it is `initdb` rather than a container:
 *
 *   initdb -D "$SCRATCH/pgdata" -U postgres -A trust -E UTF8 --locale=C
 *   pg_ctl -D "$SCRATCH/pgdata" -o "-p 55433 -c listen_addresses=127.0.0.1" start
 *   createdb -p 55433 -U postgres voice_rehearsal
 *   psql -p 55433 -U postgres -d voice_rehearsal -v ON_ERROR_STOP=1 \
 *     -f <this file> \
 *     -f .migration-backup/supabase/migrations/20260918190000_voice_limits_bind_the_deployment.sql
 *
 * This file is the fixture only; the migration is run unmodified after it.
 *
 * WHAT IT MEASURED, 2026-09-18:
 *
 *   apply on a fresh database        commit, with the migration's own notice
 *   apply a second time              commit, two «already exists, skipping»
 *   rollback                         commit, with its notice
 *   rollback a second time           commit, every drop skipped
 *   apply again after the rollback   commit, both objects back
 *
 * And ten mutations of the migration, each applied to a fresh database. **Eight
 * raised and rolled back; two exposed a self-check that was proving nothing and
 * are the reason the check now measures the cap in two halves:**
 *
 *   the limiter never refuses                        raised
 *   a refusal records a row                          raised
 *   the counting window excludes every row           raised
 *   any action string accepted by the table          raised
 *   service_role never granted execute               raised
 *   `authenticated` granted execute                  raised
 *   the sweep deletes nothing it was asked to        raised
 *   in-flight counts attempts, not people            raised
 *   the in-flight half of the cap removed            GREEN, then raised
 *   the connected half replaced by a literal zero    GREEN, then raised
 *   the in-flight half counts the wrong action       GREEN, then raised
 *
 * The three that started green all had one cause: a single
 * `v_active >= 1` assertion over a sum of two terms is satisfied by either
 * term. Isolating them by window — `(0)` can see no in-flight signal at all, so
 * it is the connected count and nothing else — turned all three red.
 *
 * THE ADVISORY LOCK, which no single-session check can see. Proved with two
 * psql sessions instead, and it is deterministic rather than a race: session A
 * holds its transaction open after one `voice_rate_limit_consume`, and session B
 * calls it with `lock_timeout = '2s'`.
 *
 *   B, same caller       cancelled by lock_timeout, naming line 19, the PERFORM
 *   C, a different caller  {"ok": true} immediately — callers do not queue
 *   B again with the lock removed (control)  {"ok": true} immediately
 *
 * WITHOUT that lock the limit widens under concurrency — two isolates can both
 * read `used = limit - 1` and both insert — which is precisely the per-isolate
 * failure this whole migration exists to fix, reached by a different door.
 */

-- The three roles PostgREST establishes on a Supabase deployment. The
-- migration's grant loop and its privilege assertions name all three.
do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$roles$;

create schema if not exists private;

/**
 * The two objects the migration reads or compares itself against, reduced to
 * what it actually touches.
 *
 * `voice_participants` keeps only the columns the concurrency cap counts.
 * Nothing here is the production schema and nothing here should grow: a fixture
 * that drifted into a copy of the real table would start proving things about
 * itself.
 */
create table if not exists public.voice_participants (
  channel_id uuid not null,
  user_id    uuid not null,
  primary key (channel_id, user_id)
);

grant select on public.voice_participants to authenticated;
grant all on public.voice_participants to service_role;

-- The sibling in `private` whose owner the migration compares its new table
-- against. Present so that the comparison is exercised rather than skipped.
create table if not exists private.voice_webhook_events (
  event_id    uuid primary key,
  received_at timestamptz not null default pg_catalog.now()
);

/**
 * The three further objects only the **rollback** looks at.
 *
 * Its last guard asserts that it did not take a neighbour with it — a
 * `drop … cascade` typed in a hurry, or a dependency nobody expected. Without
 * these present the guard fires on their absence, which is a fixture gap that
 * reads exactly like a broken rollback; it did, on the first run, and that is
 * why they are here rather than left out as unused.
 */
create table if not exists public.voice_channels (
  id uuid primary key
);

create or replace function public.voice_webhook_event_seen(p_event_id uuid)
returns boolean language sql as $$ select true $$;

create or replace function private.voice_channel_recount(p_channel_id uuid)
returns void language sql as $$ select null::void $$;

-- Two people in a call, so the cap's connected half is not measuring zero.
insert into public.voice_participants (channel_id, user_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222')
on conflict do nothing;
