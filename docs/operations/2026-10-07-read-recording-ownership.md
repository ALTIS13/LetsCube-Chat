# Recording And Read Ownership - 2026-10-07

Owner: coordinator; follow-up to accepted web runtime `ca0c633d`.
Source repairs use fictional providers/accounts; no production conversation
contents, microphone recording, notification send or database mutation.

## Reproduced Causes

- D-350 / item 88: an expired microphone acquisition can request a fallback
  after cancellation. A late acquisition, recorder event, stop or send completion
  can also interfere with a replacement hold in the same composer. A distinct
  recording intent and guards before every late consumer transition are required.
- D-351 / item 89: receipt timers and confirmed watermarks were shared across
  accounts. Retired ACK/error/fallback paths could still publish effects. The
  notification hook additionally marked beyond the requested message horizon and
  restored optimistic snapshots over newer confirmed realtime reads.
- D-352 / item 90: profile identity was used as session ownership. A real new
  session for the same person did not change the epoch; switching users retained
  the previous profile while loading. Independent actual-auth review reproduced
  inherited watermarks, retired ACK/fallback and old timers under the new auth.

The two tester reports D-348/D-349 remain reported_UNVERIFIED: client/build,
permission-dialog owner and OS history versus in-app centre are unidentified.
These independent source repairs do not certify those particular symptoms fixed.
[Bounded intake and additional preliminary observations](2026-10-07-tester-feedback.md).

## Verification

Recording baseline: 9 positive controls / 8 failing cases, plus 3 later recorder
event failures. The first actual-source hook/consumer 28/28 included 8 compiled
omission mutants; adjacent gesture 23/23 passed. Independent review then found
a delayed normal-stop/replacement-hold P2: both clips could be dropped. A
synchronous pending-stop lease repaired three failures plus one control; 40/40
includes 16 compiled mutants. A second review reproduced overlapping locked
Pause/Send republishing the same clip and permitting duplicate sends. Its narrow
repair passes 43/43 including 17 compiled mutants. Final independent focused
review passes 7/7, with no open P1/P2 in the recording delta. A stopping recorder
owns a synchronous lease; stop/send retires the previous pause intent before
cleanup, without dropping the first normal clip or accepting a duplicate send.
No stream cache or permanent microphone capture.

Actual MessageInput consumer: Chromium 5/5 and WebKit 5/5, widths 1440/390,
dark/light and cancelled-constraint fallback. Coordinator viewed exact fictional
recording pixels in both sizes/themes. WebKit's missing mediaDevices needed a
fixture-only shim; the first failed run is not a product regression or device
proof. Browser media/backend are synthetic and external requests blocked.

Receipt baseline: 13 failing cases / 3 positive controls. Candidate source 28/28
includes 10 compiled mutants; adjacent scheduler 8/8. Independent review then
found the actual auth-session P2 above and a retired useChats realtime producer
creating a new owner's scheduler. Producer baseline 1 control / 14 failures plus
one late table-callback failure is repaired: 27/27 includes 9 compiled mutants;
50 adjacent checks and one separately updated source-wiring matcher pass. A
read-only useMessages review also reproduced a held initial fetch producing a
read receipt after unmount. Its layout-lifetime fence repairs 8 initial failures
and 2 later calibrated cases: 27/27 including 8 compiled mutants, adjacent 12/12.
Final independent review accepts the frozen source, no open P1/P2. The producer
review also accepts useChats without replaying its unchanged accepted suites.

Read-hook baseline 14 failures plus one captured-null-refresh failure. Final
51/51 includes 31 behavioral cases, 11 compiled mutants and 9 adjacent checks.
Read state is committed only after ACK; chat/all reconcile captured server-read
IDs, bounded fallback queries actual message timestamps, and failure never
rolls back confirmed realtime. Coordinator source review finds no additional
P1/P2 in the frozen read-hook delta. Actual NotificationBell mounted horizon/
read-all control 3/3 (Chromium 1440/390, WebKit 390), no captures or external
backend calls. An initial locator used an unobserved button label; its timeout
is a fixture correction, not a product RED. The actual auth/producer prerequisites
are now repaired and independently reviewed; publication still requires the
final adjacent Settings repair and exact-source validation below.

Auth/store source baseline 16 failures / 9 controls plus retiring SDK-channel
reuse is repaired: 52/52 includes 19 compiled mutants, adjacent 20/20 and
typecheck pass. Same-session refresh retains UI/epoch; a new known session or
account retires the previous owner synchronously before profile I/O. Missing
legacy session claims retain user-scoped fallback, not proof of a distinct
same-user session. Independent review found an adjacent Settings profile ACK
could restore the old profile after logout; save/avatar completion guards are
now fenced without weakening the new store contract. Independent Settings review
then reproduced a separate same-owner race: a held profile-save ACK could restore
an avatar removed while that save was pending. Save-owned fields must merge into
the current profile rather than overwrite its newer avatar. That narrow repair
repairs two actual-source failures with the reverse-order control intact:
61/61 = 37 behavioral cases and 24 compiled mutants. The final read-only review
accepts the frozen Settings source without an open P1/P2. Save ACK merges only
full_name/username/bio; avatar upload/removal keeps the other current fields.

The added browser checks first exposed fixture setup issues: an invalid fictional
JWT signature encoding, a sub-minimum voice hold (800 ms, below the actual
1000 ms rule), and Vite HMR versioned store imports creating a second store for
unversioned test imports. The corrected delayed-stop consumer passes 3/3.
On a fresh owned fixture, auth plus NotificationBell pass 6/6; normal delayed-stop
plus Pause/Send pass 6/6; Settings logout plus push-preference ownership pass 6/6.
The matrix uses Chromium at 1440/390 and WebKit at 390. All use fictional providers,
blocked external requests and no screenshots/traces/video. These 18 accepted
cases do not prove the later avatar/save order; the narrow actual-source RED
above covers that order. Fixture failures are not production RED or native proof.

The added mounted Settings save/removal order passes 3/3 on the same matrix,
bringing this fresh browser slice to 21/21. Final affected typecheck exits 0.
The production-config web build is `dc439f44f62b3b1c`, `built in 15.39s`;
entry `/assets/index-BHK2UQU2.js`, SHA256
`f7e57cc8e6557abcea51f5f91c6fe0f622013738b7c447348b1e4e049280d03f`.
It contains the production backend and neither fictional anon configuration nor
the fixture backend nor service-role configuration. Existing sourcemap and chunk
warnings remain; the build's own completion lines and exit 0 confirm execution.
Unchanged accepted auth/read/recording suites were not replayed for this merge.

## Preserved Limits

The canonical notification read horizon uses the actual message timestamp,
not notification creation time. A confirmed bounded read must not erase a newer
unread replacement. Already dispatched server requests cannot be cancelled by
retiring a client callback; RLS remains server authority.

The native SDK snapshot/cancel API is not compare-and-swap for a replaced card
with the same tag/id. A reproduced source-helper race is not real OS delivery
proof; native replacement-aware cancellation remains a separate open stage.
Do not claim it repaired by account guards or another getDelivered call.

SQL preview consent/capability remains an uninstalled proposal. No APK sync,
assemble, signing, installation/publication, native card or rented-device test
is part of this slice. Current physical inventory alone is not acceptance.

## Publication Gate

Use the current healthy `ca0c633d` image as rollback. Reuse its recent verified
backup/checksum/archive evidence; recheck current runtime, rollback image and
free space. A calibrated public AST control identifies one receipt scheduler:
before = no dispose, candidate/after = dispose present. The helper also requires
the unchanged read RPC control, new entry, retained preceding entry, healthy
exact revision and public/container JS/service-worker parity. Fresh-main range
and clean own-commit alias/syntax guard are mandatory before an atomic main push.
Anonymous home/login must mount without page errors after deployment.

## Accepted Web Rollout

2026-10-07 13:28 Moscow: source revision
`a9c84de36de24f9c31c8331985ca124165430c4f` is on main and the candidate remote.
The fresh-main range was read separately; the clean own-tree guard exited 0 for
one commit, 26 JS/TS files and 178 resolved aliases. No versioned migration or
worker delta. The atomic push completed before deployment acceptance.

The sole running healthy container uses image
`l64kyyu1sysev2izzjjbizhe:a9c84de36de24f9c31c8331985ca124165430c4f`, image ID
`sha256:444461f2eabc0002f2f4475ecfa8c0c877d9e70ce728a08c99c8ec781c09b325`.
The actual public entry is `/assets/index-DwddQARP.js`, SHA256
`b7bd771d6082140b1b4ff626c4abf53f056da002511abfa15ac0f0563c35fe4f`;
service worker SHA256
`beae055b8879352fe4e06d95f2617d2abefbfa9b51cdb8c258c5bcbba35384cd`.
Scheduler/dispose/read-RPC markers are 1/1/1 against before 1/0/1. The preceding
ca0 entry is byte-identical and retained. Public JS/SW hashes match the actual
container, not the differently emitted local entry. Anonymous home/login mount
with zero page errors and no personal session/captures. Rollout and smoke jobs
completed 0; owned fixture servers were stopped by verified exact Vite PIDs.

Preflight verified the sole ca0 runtime, rollback image and available space,
reusing the recent 15-checksum/readable-archive backup `20261007-034854` without
another unchanged backup test. It is not a PG17 restore acceptance. Source
workers are closed; no unrelated services, networking or toolchain changed.

Web D-350/D-352 are accepted; D-351's shared-web repair is accepted, with native
same-card cancellation still open. These reach browser/Windows shared web, not
the independently bundled installed APK. Next: D-335 recipient-preview gates
and native replacement-aware cleanup; preserve recovery/real-JWT/device limits
and unresolved tester surfaces. Do not replay these accepted suites.
