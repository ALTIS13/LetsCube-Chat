-- When the alpha actually began, and what the people before it earned.
--
-- The owner's definition, given 2026-09-04: the alpha began when the first
-- native applications started being built, and the stretch before that counts
-- as testing done ahead of the alpha. `alpha_end` already records the other
-- edge — the move onto our own server, 2026-06-18 — so this is the opening
-- bracket, not a correction of the closing one.
--
-- The date. `aa3e78e`, 2026-05-23 04:50:13 +03, "Add Android Capacitor MVP
-- groundwork": 60 files, 1680 insertions, 21 of them under `android/`, the
-- commit that first makes a native application exist. Two earlier candidates
-- were checked and rejected: `2aaa3de` (2026-05-05, "Add Windows local build
-- support") only adds `@rollup/rollup-win32-x64-msvc` and
-- `lightningcss-win32-x64-msvc` — build tooling for a Windows workstation, not
-- a Windows application — and the several May commits mentioning "mobile" are
-- responsive-layout polish in the web client. The Windows shell itself came
-- later, `206d1c0` on 2026-07-12, so Android is the earlier of the pair and
-- therefore the boundary.
--
-- Version `0.0.0`: both `package.json` and `artifacts/kub/package.json` read
-- `0.0.0` at that commit, checked with `git show aa3e78e:package.json`.
--
-- What it changes in practice. Nobody registered between this date and
-- `alpha_end`: all twelve early accounts are 2026-05-04 to 2026-05-17, and the
-- next two are 2026-08-29 and 2026-08-31. So the same people who hold
-- `alpha_tester` earn `tester` as well, and the two badges will only ever name
-- different cohorts for someone who joins in a window that, historically, has
-- nobody in it. That is the honest outcome rather than a reason to skip it:
-- `alpha_tester` says "was here during the alpha", `tester` says "was here
-- before the native apps existed", and those are different claims.
--
-- ORDERING IS LOAD-BEARING. `achievements_sync` treats a criterion whose
-- milestone has a null `reached_at` as qualifying *everyone* — that is how
-- `beta_tester` currently works against the unrecorded `v1_0`. So the
-- milestone must carry its date before `tester` starts pointing at it.
-- Otherwise any user who opened the app in the gap would be granted the badge
-- permanently, since `achievements_sync` inserts into `user_achievements` and
-- those rows are the record. The two steps are therefore separated below and
-- must not be reordered or merged into one statement.

-- Step 1: the milestone exists, still undated. `tester` is untouched and stays
-- manual, so nothing can be earned from it yet.
insert into public.product_milestones (key, title)
values ('alpha_start', 'Начало альфа-тестирования')
on conflict (key) do nothing;

-- Step 2 happens outside this file, as an audited call made by the owner:
--
--   select public.product_milestone_set(
--     'alpha_start', timestamptz '2026-05-23 04:50:13+03', '0.0.0');
--
-- `product_milestone_set` is write-once and records `updated_by` from the
-- caller's JWT along with a `product_milestone_set` audit entry. Writing the
-- date straight into the table here would skip both, and the whole point of
-- this machinery is that a testing badge cannot be conjured without a trace.

-- Step 3: only once the date is recorded, `tester` becomes earnable, and
-- earnable only by the rule — `grant_kind` moves off 'manual' so that
-- `achievements_sync` will act on it at all.
update public.achievements
set grant_kind = 'auto',
    criteria = '{"kind":"registered_before_milestone","milestone":"alpha_start"}'::jsonb,
    description = 'Был с LETSCUBE ещё до первых приложений для Android и Windows'
where key = 'tester'
  and exists (
    -- Refuses to run ahead of step 2. Without a date the criterion would admit
    -- every account that has ever registered.
    select 1 from public.product_milestones
     where key = 'alpha_start' and reached_at is not null
  );
