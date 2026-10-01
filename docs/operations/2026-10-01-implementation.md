# 2026-10-01 continuation

Owner: Codex coordinator. Source: `29176d72` and Claude's preserved item 74
candidate in `.worktrees/bot-platform`, branch `integration/message-actions`.
Approved by the owner on 2026-10-01. No Android build/install/publication.

## Sequence

1. [~] Item 74: phone lookup and findability. Coordinator owns the client;
   worker Bacon owns only the migration, rollback and isolated DB rehearsal.
   Fix unknown privacy writes, cross-device field overwrite and concurrent
   lookup limits. Then render the setting at 390/1440 in both themes, run
   regression gates, fresh backup/restore rehearsal, guarded production apply,
   review and web deployment verification.
2. [ ] D-331 / item 75: member mentions. Establish stable identity, scoped
   completion, activation and notification boundaries before implementation.
3. [ ] D-208: finish signed-media privacy; preserve the native release hold.
4. [ ] Continue the open presence/AFK/DND and role/bot stages from the tracker.

## Decisions And Boundaries

- Preserve Claude's candidate, including unrelated dirty/deleted documents;
  commits include only reviewed owned paths. Main's takeover docs stay intact.
- A failed initial privacy read is not an absent row: controls cannot write
  guessed defaults. A known absent row still uses the approved defaults.
- Changes patch one setting, never a stale whole row. Writes in one client are
  serialized and replies from an account left behind cannot settle a new one.
- Item 74 SQL and client share `everybody | contacts`, verified exact-number
  lookup, profile-only results and the same empty response for absent/private.
- Production SQL/deploy authority comes from the latest explicit user approval;
  backup, rehearsal, transaction, self-check and rollback gates still apply.
  The general skill's new-approval pause does not override that authority.
- Run the immediate privacy fix locally and a disjoint SQL worker alongside it.
  No recursive delegation or separate sidebar tasks; the coordinator alone
  applies production changes and integrates/pushes the reviewed patch.

## Resume

Stage: item 74 SQL applied, client integrated in main `69d3dcbe`; web rollout
pending. Mention contract and live metadata audit completed. Next: verify web
deployment, then implement D-331. Candidate `c1794f57` is preserved on the pushed
`codex/phone-findability-20261001` branch; the foreign document deletion remains
unstaged in its worktree.

## Evidence So Far

- Failed first reads, stale whole-row writes and concurrent local writes were
  reproduced red before fixing them. A reviewer found a focus refresh that
  reverted the optimistic choice during PATCH; its deterministic test was also
  red, then green after refresh was ordered behind the write queue.
- Eight privacy-store safety cases and the existing 32 preference cases pass.
  Five isolated runtime mutants are killed by literal behavior assertions.
- The changed setting was inspected at 390/1440, dark/light, with fictional
  route-blocked fixtures. Chromium desktop/mobile and WebKit phone/search
  tests: 24/24. The failed-read case records zero presence beats and has a
  successful-retry positive control.
- Public routing, search scope and invite regression specs: 44/44. Server
  tests: 357/357. Final full unit run: 4497 passed, zero failed, one existing
  skip (`jq-1.7.1` unavailable locally). Final phone/search browser run: 24/24.
  Typecheck in both candidate and integrated main passed. API build and emitted
  web build passed (`sw.js build 2760a93c63d6f699`, `built in 34.04s`).
- Fresh server backup `/srv/letscube/backups/automated/20261001-155443` has
  15/15 verified checksums and 161 table-data entries in its PostgreSQL archive.
  No restore into production, credential/config or host-network change.
- SQL review found that the old normalizer also accepts a naked ten-digit
  local number. Item 74 must reject that direct-RPC input, matching the client:
  explicit international `+E.164` or an eleven-digit Russian 7/8 number only.

## Database Apply

- Independent coordinator full-restore run: 10/10 groups, zero skips, all three
  simultaneous-connection quota cases, actual restored RLS writes and exact
  rollback/reapply. The exact owned containers were removed.
- The first real apply aborted at its raising FK self-check and rolled back
  entirely: the production role includes `auth` in its ambient search path,
  making `pg_get_constraintdef` render `users` instead of `auth.users`.
  A read-only prestate check and a rolled-back FK probe confirmed the cause
  and zero partial objects. Both migration/rollback now fix their transaction
  search path; the runner reproduces the live role configuration. Another
  independent full restore passed 10/10 before the successful guarded apply.
- Applied migration raw SHA256:
  `34871c285dcaf35426d8d3c05f200f78908c1b59f07c9c223af0757ca0f64469`.
  Rollback raw SHA256:
  `6e07b55eee3394daf06961c28a032195434eb7a3083dbe68bf7e3d822b98f7d2`.
  Both `.migration-backup/supabase/migrations/` copies are byte-identical.
- Live function UTF8 definition SHA256:
  `b407086374d55fbe72954ff8da9256e6bc838c51e35fe7bf7a3e762900fdcc11`.
  Owner `postgres`, VOLATILE, fixed `pg_catalog, pg_temp`; authenticated can
  execute, anon/service role cannot; log columns contain no requested numbers
  and have no client grants. Public RLS: 82/82, zero missing.
- Real QA authentication/PostgREST read smoke passed own-column access,
  foreign preference isolation, anon denial and malformed RPC behavior without
  profile/message/preference/log mutations. The temporary auth session was
  logged out locally only; no other device session was invalidated.
- Independent review also caught a zero-check rehearsal false green. Its
  failing `--only` control now exits 1; nonempty syntax control exits 0 (2/2).
- Final isolated SQL run: 16 groups, zero skips; 40 mutants rejected, including
  transaction search-path removal. The independent fresh full restore passed
  all 10 real-database groups with zero skips before production apply.
