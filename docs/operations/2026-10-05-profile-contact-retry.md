# Profile contact lookup recovery

Owner: Codex coordinator. Stage: independently reviewed candidate; web rollout
awaits exact revision gates. Scope: item36/D-316 follow-up.

## Cause and change

The renewed tester request does not identify the installed artifact or entry
tier. The accepted full-profile action already exists. A separate, reproducible
failure boundary was found: a failed contact-list read hides that action without
showing why or offering recovery. A failed profile lookup in the contact list
must not be treated as an empty list either.

`UserProfileOverlay.tsx` now shows explicit loading/error state and a retry
using the existing `KubButton`. Retry cannot be pressed while fetching. Fetching
takes precedence over an old error, including after a cached query fails.
Unknown/refetching contact state never offers Add/Saved; only a settled successful read exposes
the appropriate action. The callback also refuses self/unknown-state additions.
The existing owner-scoped hook, RLS and membership/role authority are unchanged.

## Focused evidence

- The initial browser case was RED against the shipped source: no recovery
  alert/action. Final isolated Chromium fixture:14/14 pass at1440/390,0 skipped,
 0 flaky. Four adjacent profile/contact cases pass. Frontend typecheck passes.
- Four initial compiled browser mutations fail as intended: expose unknown Add,
  no-op retry, unlock an in-flight retry, show stale error copy during retry.
  Receipts are in `output/playwright/contact-retry-{final,adjacent,mutant-*}`.
- Independent review found an existing cached-success/refetch window. New held
  background reads are RED2/2 against the first candidate: stale Add/Saved
  remains visible. Props and callback now also refuse `isFetching`; the loading
  state includes successful stale caches. Final affected run10/10 (four new
  held cases plus six affected known/cached cases), typecheck exit0. Reuse the
  unchanged remainder rather than claiming a fresh18-case run. The new compiled
  dropped-refetch-guard mutation also fails its literal zero-Add assertion.
- Covers saved/new contact, both themes, repeated failure, failed dependent
  profile lookup, cached stale state and held retry; no contacts/block/member
  writes before a successful read. Only the explicit known-state Add writes.
- Synthetic pixels at1440/390, both themes, were inspected. Error/retry states
  remain aligned with the existing full card. Screenshots contain fictional
  fixture data only; external hosts abort, `KUB_QA_ALLOW_MUTATIONS=0`, default
  screenshot/trace/video are off. Capture is an explicit synthetic-only option.
- Final held-refresh frames at1440/390, both themes, were also inspected;
  actions/loading remain in the same aligned column.
- Final independent read-only review finds no high/medium issues in the changed
  boundary. Paused/offline refresh and owner change during a held contact read
  are not newly tested; this is an active-fetch guard, not a general freshness
  guarantee for all cached data. The fifth mutation completed with the expected
  zero-Add assertion failure after that review's status snapshot.
- Initial production-config build completed, then was superseded after the
  review correction. Final build: `sw.js build 923f41c3bd1585f5`,
  `built in27.54s`, exit0. Existing source-map/chunk warnings remain.

This is browser/source evidence, not installed iPhone/Android, authenticated
production RLS or a reproduction of the tester's unspecified build. No APK,
Capacitor sync, signature, SQL, worker/Gateway or data cleanup change.

A single bounded Mobbin lookup returned a Discord blocked-profile frame,
not the positive contact flow or a network-error state. It does not establish
our retry behavior; no asset/code copied and no further searches/rental minutes
spent for this small existing-component change.

## Rollout gate

Reuse the already verified `automated/20261005-035146` backup (15 checksums and
readable archive, under48h); no database mutation. Refresh runtime/rollback
identity before publishing. Current rollback is the healthy web image at
`5dfc4dcb70a2268a0419c16821e0a1c683dfa0c4`.
Read pending history separately, resolve imports against each commit's own tree,
and wait for the guard's successful completion before the atomic candidate/main
push. Accept only one healthy exact-revision container, calibrated old/new
public entry markers, public routes and a fresh anonymous mounted login.
The old bundle already contains the generic contacts error from another panel;
the added loading text is absent before/present after. Do not claim both texts
were absent in the baseline. Retain the preceding entry asset for open clients.

Outcome pending. Next product intake remains D-335 notification delivery;
no full/Gradle/PG17 suite replay in this UI-only slice.
