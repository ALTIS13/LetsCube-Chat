# Network body completion and playback retirement, 2026-10-15

## Execution Ledger

Owner: coordinator. Baseline main/runtime `dc5a7c70`; root source checkpoint
`d7ce0170`. The previous four cache/history repairs are accepted evidence, not
work to repeat. Unowned sidebar/search files and the private Android version
overlay remain outside this change.

| Task | Status | Evidence / next action |
| --- | --- | --- |
| D-362 finite PostgREST body ownership | Source accepted | Six original transport REDs; final affected transport/SDK selection48/48, five compiled omissions. Chromium/WebKit real-loopback13/13. Independent final source review found no P1/P2 issue; compatibility limits below remain explicit. |
| D-360 authoritative playback retirement | Source accepted | The two P2 omissions have mounted REDs and repairs. Parent final63/63 includes14 compiled omissions; unchanged producer/hook26/28 evidence is reused. Independent final delta review accepted, no remaining P1/P2. Not published. |
| Main integration and production acceptance | In progress | Only owned files entered the main-based candidate; typecheck and real Vite build pass. Own-tree imports and actual after-state checks remain. Live before-state was verified13:22:40UTC. |

No DB/schema, package identity, native signing, APK release or privacy-setting
change is included. Source/browser evidence is not installed-device acceptance.

## Reuse And Upstream Research

The owner requested proven open-source solutions before inventing infrastructure.
The following primary implementations were inspected on2026-10-15:

- Installed Supabase/PostgREST2.105.1 and its pinned
  [PostgrestClient](https://github.com/supabase/supabase-js/blob/v2.105.1/packages/core/postgrest-js/src/PostgrestClient.ts)
  already support a timeout, but that wrapper clears it when fetch returns
  headers. Enabling the option does not fix the observed body gap. The actual
  installed parser reads `response.text()` before JSON parsing; its retry and
  error handling were exercised rather than inferred from current master.
- [Ky](https://github.com/sindresorhus/ky) separates response acquisition from
  bounded body consumption, and uses native streams for response adaptation.
  Its shortcut body methods are not invoked when the Supabase SDK receives a
  raw Response. Replacing global fetch with Ky would not, by itself, supply that
  missing boundary and would introduce another retry/error-policy owner.
- [Undici](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md)
  distinguishes header/body timeouts, but is a Node transport, not a browser
  replacement for Capacitor/WebKit.
- The [Fetch Body interface](https://fetch.spec.whatwg.org/#body-mixin) and native
  ReadableStream cancellation/EOF provide the necessary browser primitives.

Supabase and Ky licenses were checked as MIT in their primary repositories.
No package upgrade, new transport dependency, copied library implementation or
vendor fork was introduced. Existing Supabase remains the sole SDK, with a
small application-owned completion adapter over the standard stream mechanism.
The changelog endpoint was unavailable in the documentation tool; no assumption
about a newer SDK release was used in place of inspecting installed2.105.1.

## D-362 Scope And Cause

The original `createDeadlineFetch` clears its timer, caller abort forwarding and
waiting registration at headers. An SDK body can then remain pending forever.
Only finite `/rest/v1/` Responses now retain that ownership until EOF, error,
cancel or the ORIGINAL30,000ms deadline. A3,000ms-old read remains eligible for
the existing network-change cut. POST/PATCH/DELETE are not network-cut or retried.
A timed-out write is not treated as proof that the server did not commit it.

The adapter resolves fetch at headers, streams on consumer demand with no eager
drain or additional full-body buffer, and preserves SDK parsing, response
status/header values, URL, type, redirect metadata and cloned-body ownership.
Explicit caller reasons stay caller-owned; internal cuts remain network errors.
Empty/HEAD responses finish immediately; abandoned bodies still expire.

Ruling: Auth and Storage keep their original Response identity and behavior.
Auth's error-body classification/session behavior is a separate contract, and
Storage transfers may legitimately run for minutes. Cost: the pre-existing Auth
body-stall gap is NOT repaired by this scoped change; do not claim universal
fetch/body deadlines. No arbitrary body-size limit or blanket buffering was added.

## Browser Boundary Found During Verification

Real native Chromium over a deliberately incomplete local HTTP response converts
custom-stream errors to a generic TypeError in its Response body loader, losing
even an explicit caller AbortError while the managed signal keeps the exact
reason. This was an actual browser RED, not guessed from Node.

A narrow error mapping at tracked Response body methods restores the request's
reason, including clones, without patching global prototypes or changing ordinary
parser errors. The subsequent Chromium/WebKit matrix passes13/13: retained old
code calibration, deadline, network cut, caller identity, EOF/clones, redirect
metadata and explicit cancellation. No production request, account, captured
screen, PWA installation or paid device minute was used.

The regression is retained in `tests/browser/postgrest-body-deadline.mjs`:

```text
KUB_QA_ALLOW_MUTATIONS=0 node tests/browser/postgrest-body-deadline.mjs
```

It creates and closes its own ephemeral127.0.0.1 HTTP server and fresh browser
contexts; it reads no app config or credentials. The checked-in baseline uses a
compiled header-retirement omission rather than requiring an old Git object.
That new baseline was separately calibrated1/1; the original13 current/old-code
browser checks are reused for unchanged production source, not relabelled14 fresh.

## Focused Source Evidence

Initial standalone transport regression:13 tests,6 behavioral RED/7 controls.
An earlier unbounded assertion was interrupted and replaced with an observed
promise-state assertion; synthetic Response-clone metadata was calibrated in
the fixture. These test-setup corrections are not product failures.

Final current-source command:

```text
node --test tests/unit/postgrest-body-deadline-20261015.test.mjs tests/unit/postgrest-body-sdk-20261015.test.mjs tests/unit/connection-revival.test.mts
```

48/48 pass with zero failures/skips/cancellations. Actual installed SDK select,
HTTP400/503 body failures, POST/PATCH/DELETE, caller abort, throwOnError, metadata
and unchanged Auth/Storage controls run against the real parser. No live DB,
Auth or Storage operation is performed. The old private observation-only audit
was not replayed as a passing product test.

## Compatibility Limits To Retain

- The scoped adapter serves the SDK's ordinary body readers, not a universal
  byte-stream/BYOB replacement. No affected application BYOB consumer was found.
- An artificial throwing metadata getter on a custom Response can fail adapter
  construction after locking its source reader. No native fetch path to that
  condition was established. This compatibility cleanup case is deferred, not
  called successfully handled or a production incident.

These two review boundaries must not be hidden behind a generic drop-in claim.

## D-360 Confirmed Retirement

The original projected playlist can lose a deleted row while the retained playing
item and its transport remain alive. Retirement now consumes positive tombstones,
exact confirmed hide signals, successful partial bulk-hide IDs, clear ACKs,
verified gone-window IDs, and own-membership DELETE. One typed batch uses the
existing chat-refresh event, with captured UID/accountEpoch; no per-ID refetch
storm or new event bus was introduced.

The player closes the exact chat/item, prunes retained entries and rejects stale
play/activate calls. Closing retires refs before detach can transfer playback,
pauses transports and clears their buffered source. Late play rejections cannot
reopen the retired player. Ordinary chat switching and incomplete/paginated lists
are not deletion evidence and preserve across-chat playback.

Access retirement, reversible hide and permanent deletion/clear/gone remain
distinct. Confirmed own-membership INSERT restores only access admission; a hide,
clear or tombstone arriving during exclusion survives rejoin. Clear affects old
retained IDs, never future messages. Retirement tracks only retained/current or
already-known items, not every historical tombstone. This is not a claim of
instant revocation detection when Realtime is missed or of real audio decoding.

Focused command on final source:

```text
node --test tests/unit/deleted-media-playback-20261015.test.mjs tests/unit/chat-cache-reentry-20261015.test.mjs tests/unit/chat-warm-reopen-20261015.test.mjs
```

105/105 pass, zero failures/skips/cancellations, including51 player/actual producer
cases and8 adverse compiled variants. Earlier22 checks are historical, not added
to this total. Repeated hook checks are justified by the new useMessages changes;
unchanged accepted media/native suites were not replayed. Topic-window and
clear-during-access cases first failed behaviorally, then passed the repair.

## Main Candidate

The main-based tree contains exactly five product files, three new unit regression
files and the portable browser regression. Root source bytes and candidate product
bytes match; the unrelated SidebarHeader/search files and Android version overlay
are excluded. Actual final kub typecheck exits0. The first build `b03e7b47343e19c7`
in9.26s belongs to the rejected first player candidate. After the P2 delta, the
final Vite build emits `sw.js build c11f8727e162a634`, `built in21.15s` and entry
`index-CF2sDfql.js`; existing sourcemap/chunk-size warnings remain. A build is not
production acceptance.

Actual before-state readback13:22:40UTC confirms the accepted healthy dc5a7c70
image, previous JS/SW digests and public/container parity, with old/new body fetch
consumer1/0 and body-adapter/consumer0/0. The after-state is still required.

## Independent Review Refusal

The first D-360 candidate passed its existing51 cases but missed two branches:
an inadmissible native-play transport A was left running when a DIFFERENT B was
current, and a newly registered ID in an explicitly revoked chat bypassed the
per-item access retirement. Independent probes used actual callbacks with
positive controls and established both failures. That candidate was NOT
published. The repair must distinguish transport identity and preserve an
explicit chat-access fence until confirmed grant, without treating clear as a
permanent chat denial. The earlier build105 evidence is retained as chronology,
not acceptance of the changed final player.

Both omissions now have real mounted regressions:5 behavioral RED/1 control
against the rejected player, then6/6 GREEN. The final parent run explicitly sets
`KUB_QA_ALLOW_MUTATIONS=0` and passes63/63 with14 adverse compiled variants.
The earlier105 invocation had no explicit QA0 environment, but every browser
request was aborted in a fictional, config-free fixture; no production contact
occurred. It was not replayed solely for that environment correction.

Refusal now preserves only the exact transport currently used by a DIFFERENT
item, while stopping the rejected separate element. An explicit owner-scoped
revoked-chat marker blocks registration/admission of even unseen IDs until
confirmed grant/reset. It is one ID per outstanding explicit revocation, not a
fixed numeric cap or global history scan. A clear never creates that chat denial.
Independent final delta review accepted the pinned player/test and unchanged
producers with no remaining P1/P2. The reviewer did not replay suites; parent63
and final main typecheck/build are independent actual receipts.

## Next Measured Stage

Item87 remains open: no timing or tester-specific VPN cause is established.
Existing counters count hook invocations, not per-open HTTP/body/render phases;
the public preview bypasses actual privacy admission. Reuse the existing full-app
fictional backend, local Realtime fixture and layout sampler for one test-only
warm A-to-B-to-A trace, four viewport/theme strata. Calibrate actual hide-ping
trust and an unverified-ID read, then hold background history/media while sampling
retained text. Export only phase/count enums and relative timings, never active
channel maps, query/body/URLs or personal data. This probe is being prepared
separately, not included in the product candidate or called a new cache defect.
