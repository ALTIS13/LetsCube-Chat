# 2026-10-01 continuation

Owner: Codex coordinator. Source: `29176d72` and Claude's preserved item 74
candidate in `.worktrees/bot-platform`, branch `integration/message-actions`.
Approved by the owner on 2026-10-01. No Android build/install/publication.

## Sequence

1. [x] Item 74: phone lookup and findability. Coordinator owns the client;
   worker Bacon owns only the migration, rollback and isolated DB rehearsal.
   Fix unknown privacy writes, cross-device field overwrite and concurrent
   lookup limits. Then render the setting at 390/1440 in both themes, run
   regression gates, fresh backup/restore rehearsal, guarded production apply,
   review and web deployment verification.
2. [~] D-331 / item 75: member mentions. Establish stable identity, scoped
   completion, activation and notification boundaries before implementation.
   First web slice and D-332 account isolation are released and accepted;
   installed-client/OS receipt acceptance remains separate and Android is held.
3. [~] D-208: signed-media consumers fixed and in final acceptance; preserve
   the public bucket and native release hold. Follow the current
   [consumer record](2026-10-01-signed-media-consumers.md), not the older
   unimplemented-consumer checkpoint below.
4. [~] Continue the open presence/AFK/DND and role/bot stages from the tracker.
   Item 37 / D-333 private alert gates are in restored SQL and mounted client
   acceptance; follow [current record](2026-10-02-presence-push-quiet.md).

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

Owner: Codex coordinator. Stage: item 37 / D-333 private DND alert acceptance.
Current checkpoint is the linked 2026-10-02 record. D-208 source gates and web
rollout are complete; the following paragraph preserves their acceptance limits.
First D-331/D-332 web slice `56ae3cc0` is published and independently verified:
exact sole healthy image, markers and public/container JS/SW parity. Final
4787/4787 unit tests, 93 mounted cases, 12 pixel/activation cases and deployed
read-only 3/3 smoke passed. SQL/Edge apply and fresh restore/live rolled-back
acceptance are complete; do not repeat them. Source workers are closed.
Blocker: live non-author QA FILE unavailable; private-bucket activation is
blocked on compatible installed-Android upgrade proof. Source `ebb93d6f` passed
full gates and independent web-rollout verification through `c31ed22f`.
Next: remaining real-consumer/long-session acceptance in the linked record,
and the independent presence/AFK/DND and role/bot stages while Android is held.
Item 74 and voice intake are closed; the foreign document deletion is preserved.
No native build/install/publication; Android hold is unchanged.

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

## Web Rollout

- Reviewed `origin/main..HEAD` as its own step: only `69d3dcbe` and the owned
  evidence commit `bde5b8ed`. All 113 changed alias imports resolve against
  their own commit tree. Candidate branch pushed first, main push succeeded.
- Sole healthy web image:
  `l64kyyu1sysev2izzjjbizhe:bde5b8ed0052959267336f19309d00ee5a556ad9`.
  Worker/Bot Gateway unchanged; no Android/Windows package publication.
- `phone_findable_by` absent in the old `29176d72` image, present in the new
  image and public `/assets/index-CH7gbNHe.js`. Public bytes match the healthy
  container SHA256 exactly. Public SW build: `bca693026785a81d`.
- Authenticated deployed read-only settings smoke: 3/3, zero skips (Chromium
  1440, Chromium 390, WebKit 390). Real own preference reads return 200,
  exactly one selected choice, controls ready, zero attempted preference
  writes. REST mutations including incidental heartbeat were intercepted.
  Only the smoke's temporary auth sessions were logged out, with local scope.
- The first mobile smoke used a desktop-only dialog locator and failed at
  navigation, not preference loading. Corrected for the existing mobile menu.
  Its two automatically generated failure-context files were deleted without
  opening them; the final run explicitly disables that capture along with
  screenshots, trace and video. No production visual/content artifact retained.

## D-331 Integration Checkpoint

Coordinator owns main's mention patch; three bounded workers own pure/render,
transport/caption and picker follow-ups. No mention migration or client rollout
has happened yet. The restored fresh backup is
`/srv/letscube/backups/automated/20261001-175542`: 15/15 checksums verified;
independent full restore found 164 tables and the exact already-released phone
function. Current SQL behavior: 12 groups, zero skips, real concurrent sessions,
rollback/catalog parity and reapply. The earlier independent mutation run killed
30/30 mutants in 271 SQL calls; the fresh-backup behavior run made 159 SQL calls.

Client RED-to-GREEN covered lost restored-outbox metadata, failed placeholders,
first INSERT refusal repeating a caption on the second attachment, and explicit
plain-text replacement retaining a selected identity (even when the text is
identical). The latest mounted composer/caption paste checks pass 4/4, including
changed text. A mounted account-change check passes after restoring the shared
chat fixture: the picker closes, B's field is blank, B sends no A identities,
and A's owned draft remains saved under A's key. Remaining review follow-ups:
caption ownership before ACK/background retry and a refused voice-prefix row.

Two full unit failures are emitted-build gates, not waived: the previous local
build contains the synthetic capture route and predates voice sources. Rebuild
without the fixture flag, then repeat the full suite. Final mounted mention
matrix and exact composer/caption pixels at 390/1440 in both themes remain to
be recorded. SQL production acceptance uses rolled-back synthetic chat/message
rows with actual QA authenticated roles; HTTP smoke is read-only. Android and
other native packaging/install/publication remain untouched.

Associated mounted regression run: 89/90 passed. The lone WebKit restart failure
also reproduces before mentions, and even with no message send. Independent
diagnosis found a controlling service worker bypassed both page/context mocks
after reload; `getSession()` was already settled while three profile requests
missed the mock. Blocking the SW or removing its registration restores the
fixture; a minimal empty-SW case reproduces it without application/outbox code.
This is the [documented Playwright route boundary](https://playwright.dev/docs/api/class-page#page-route).
Only the offline-outbox spec now blocks service workers; production PWA/Auth was
not changed for this fixture failure. The exact 12-case outbox matrix is rerunning.

Independent SQL/Edge review caught a terminal status compatibility gap:
`not_eligible` was not accepted by ordinary Web/native Edge parsers. It cannot
send a prohibited push, but would miscount terminal suppression as failure.
Parser compatibility must deploy before SQL. The unrelated generic SQL payload
replacement is being removed: preserve the existing sender/preview whitelist,
and keep unchanged external privacy builders. The mentions contract now names
that layer boundary correctly. These inputs require a new SQL rehearsal/hash;
the earlier frozen hash is historical and not the apply candidate.

The exact offline-outbox matrix is now green: 12/12 across Chromium desktop,
Chromium mobile and WebKit. No product change was made for the SW/mock failure.
Final integration review also found D-332 (A's unsent local rows survive in the
shared message map after logout/login) and mention-slice P2 boundaries: an old
edit ACK closing a newer edit, explicit identical keyboard replacement retaining
an entity, and caption-picker Escape bubbling to the outer sheet. Bounded RED /
GREEN fixes are assigned before rollout; no failed boundary is waived.

## D-331 Compatibility Gate

The final SQL inputs retain the original 18-key sender/preview whitelist. Edge
source compatibility passed 55 scoped tests and Deno check. Worker full restore
of `20261001-175542`: 164 tables, 12 groups, 32 mutation kills, 281 SQL calls,
exact rollback/catalog parity and reapply, zero skips, owned container removed.
Independent coordinator rerun of these final hashes passed 12 groups/161 SQL
calls, actual two-session lock barrier, rollback/reapply and exact cleanup.
Current migration SHA256: `fb08b5750f66f6103941d2d051f31f281fd864694fe45963b3240684f3ce7147`;
rollback: `1453fadb225a6ef149a84a0e02615f8438e5e0624ee8c732ce3d2ca626dc9b96`.

The Edge entrypoint was independently deployed first by exact old-hash and bind
guards, root-only prestate backup and atomic one-file replacement. Only
`supabase-edge-functions` restarted: healthy, unauthorized HTTP 401, 12 recent
push-cron successes and 12 recent HTTP 200 dispatcher responses. Before hash
`cdd7c4f310550a3812d946a3386f66a0d77c42a78bdd2d6aeabb729223797494`;
after `0c8215f49c12bb1afc56b6e740d00caa10ce529f7673acd96fb1c0dcfd2f9cf8`.
Root-only rollback copy:
`/srv/letscube/backups/d331-edge-6c0bc3e7-08fe-44fd-a42f-346f8c1a9b0d/index-before.ts`.
The legacy worker dispatcher is disabled (targeted read of its one runtime flag).
No provider test send, SQL apply, client rollout or native release occurred at
this checkpoint. Mounted input follow-ups pass 15/15 across three engine/view
projects; account isolation and settled caption-surface pixels remain final gates.

## D-331 Server Applied; Final Client Gate

The reviewed SQL/Edge/rehearsal source is committed locally as `26a274cb`.
Immediately before apply, a new full backup completed at
`/srv/letscube/backups/automated/20261001-192920`: 15/15 checksums,
root-only permissions and valid custom-dump catalog. Dump SHA256:
`adc8d5353444c8d672a3fb42077263e008c44cde3132ec6ac7bf51bb7e5926c5`.
Its independent network-isolated full restore passed 164 tables, 12 groups,
162 SQL calls, the real concurrent removal/admission barrier, exact rollback
parity, reapply and owned-container cleanup, with zero skipped groups. The
unchanged SQL already has 32 killed mutants from the prior fresh restore.

The exact guarded migration above was applied in its single transaction.
Independent live acceptance passed: actual QA Auth sessions and PostgREST
projection/anonymous denial, authenticated sender/recipient roles, exactly one
ordinary notification with the recipient-local marker, block-sensitive RLS,
legacy-edit clearing without a second notification, and rollback leaving zero
synthetic chat/message/notification fixtures. All 82 public tables retain RLS;
the eligibility helper has its postgres owner and empty definer search path.
Post-change checks found 12/12 recent cron successes and 12/12 HTTP 200 dispatch
responses. This proves database/HTTP boundaries, not OS push receipt. The root-only
SQL rollback remains at
`/srv/letscube/backups/d331-sql-1db9e6f0-45c1-4474-b971-a77845137e2d/20261001180000_member_mentions.rollback.sql`.

Operational trap observed and corrected: when a remote script is piped through
SSH, the backup helper can consume the script's remaining stdin and exit zero
without later checks. Invoke it with `</dev/null`, and independently require the
completion stamp, all checksums and dump catalog. The completed backup was
recovered from its exact owned rollout directory, not assumed from exit status.

Client review closed selected-identity keyboard/paste replacement, caption
Escape priority, bot insertion as `@username`, and late edit ACK after cancel
and reopen of the same message. Mounted delayed-edit checks pass 6/6 across
Chromium desktop/mobile and WebKit. Refused voice-prefix restore and same-account
outbox restart are covered by actual runtime tests; the generic background
runner's late catch/forget epoch boundary and history/realtime restart are the
last assigned fixes. No entity-producing client has been published yet. No
native build, install or release occurred.

## Next D-208 Slice (Read-Only Preparation)

The next canary acceptance gaps were checked against current source, not inferred
from the older report. Keep the bucket public and native releases on hold while
finishing a synthetic web-consumer harness:

- FILE: extend `tests/e2e/file-message.spec.ts` with an isolated signed-storage
  fixture, preview/download filename assertions, no public fallback request, and
  a path-only media row. `MessageBubble.tsx` still gates the file renderer on
  `media_url`; existing `/__fixture-media` coverage does not prove this case.
- Group-chat avatar: mount the actual `ChatAvatar` consumer and prove signed
  variant `src/srcSet`, original fallback, and monogram on signing refusal.
  The existing variant test checks wiring; the old live avatar check did not
  identify a group-chat avatar.
- Long session: drive the actual `useMediaObjectUrl` consumer at literal
  48/55/60-minute boundaries, idle/download/seek and offline/resume, preserving
  playback position. Explicitly calling the store's `get()` is not evidence
  that an already-mounted consumer renews itself.

These tests are not implemented or accepted yet. A synthetic harness does not
replace subsequent authenticated signing/renewal acceptance. Private-bucket
activation remains blocked until a compatible installed-Android upgrade is
authorised and proved; no A063 or cloud-device minutes are needed for this
source-only slice.

## Final Client Follow-Ups

Independent account/caption/outbox runtime rerun passed 96/96, zero skips.
The history loader now separates its busy ownership token from result generation;
a background refresh cannot strand the loader or let an old finally clear a new
request. Disposed reconciliation callbacks cannot schedule another read.

The WebKit warning was not suppressed. Native observer instrumentation showed
the dock callback's synchronous commit changing the sibling chrome at the same
DOM depth from 56px to 89.328125px. Baseline: four native loop errors and four
blocking dev overlays in 16 transitions. Controlled detachment: zero in 16.
The hook now pauses only its own observations while committing and remeasures
both siblings in layout effects in that same frame; only re-observation waits.
An unchanged-height guard prevents an idle reobserve loop, and cleanup removes
nodes/cancels the final pending frame. Three runtime lifecycle tests pass and
reject five isolated omission/rounding mutants. Painted-frame gates are part of
the final full run, not replaced by this source evidence.

A frozen 78-case browser run passed 77 and exposed the attachment panel's first
focus gap, not an observer overlay: Escape arrived before the RAF moved focus
inside it. A MutationObserver sampling the first DOM commit deterministically
found focus outside the panel. Layout-effect focus changes that literal result
to an inside tab before the first frame; 9/9 keyboard/caption cases passed across
Chromium desktop/mobile and WebKit without a test sleep or retry.

Review of the next file-media boundary found a D-331 omission: `FileMessageRow`
rendered its caption as plain text. The received-caption test failed because the
UUID button was absent, then passed 12/12 across those three projects after
passing the trimmed entities through the shared formatter. Same-name targets,
leading/trailing whitespace, zero extra reads/sends, no document activation and
unchanged chat URL are asserted. Exact document-caption pixels at 390/1440 in
both themes were inspected. The next signed-path FILE canary is still separate.

Subagent API access failed during final integration; the coordinator retained
the scoped changes and took over verification. A resource-contended worker run
had timed-out child probes and is not acceptance evidence. The final full suite
uses two test workers, the verified pinned jq binary and both opt-in mounted
surface/observer gates; no test is silently waived to compensate.

The final frozen-source unit run completed: **4786/4786, zero failures,
cancellations or skips**, including four WebKit painted-frame gates, literal
same-depth sibling heights and 16 mounted composer transitions with zero native
observer errors, blocking overlays or failed actions. Typecheck passed. The
production build emitted `sw.js build 6beba7efae8723be` and `built in 37.92s`;
the fixture build flag was absent, not the string `"0"`. API build and 357
server tests are reused because their inputs have not changed. The 93-case
final browser matrix is still running; publication is not yet claimed.

## Final Caption And Composer Corrections

The 93-case mounted matrix finished with 93 passed and zero skips. Album-caption
review found that its pass-through overlay also intercepted a mention's actual
tap. The test failed on the photo intercepting the UUID button, then passed
12/12 across Chromium desktop/mobile and WebKit after the formatter's button
became pointer-active; removing that rule reproduces the same interception.
Inspected pixels then found light-theme accent text unreadable on the dark photo
caption. A local overlay accent fixes it without changing ordinary bubbles.
Computed worst-backdrop contrast is at least 4.5:1 (5.71:1 on a white photo);
the original and omission-control measurements fail at 1.175:1. The full album
hit-testing/contrast set passed 12/12, including profile identity, zero incidental
read/write/command actions and the photo's own viewer positive control.

A later full unit gate returned 4785 passed and one painted-frame failure;
an isolated rerun passed, but a serial full run reproduced stale narrow-screen
padding and was stopped as superseded, not accepted. The cause was not waived
as contention or HMR: dock height had already changed by 26px while the list
kept its old inset. Known child commits now call the existing measured-height
callback in a layout effect, wired in both ChatWindow and the actual-component
preview. Native observation remains for external size changes. All seven
observer/runtime/mounted checks passed, including normal and deliberately
disabled native delivery at 390/1440 in both themes, same-depth siblings and
16 actual composer/picker transitions. Removing the child callback makes all
four forced-delivery cases fail. The earlier full-suite success above remains
historical. The final frozen-source rerun passed **4787/4787**, with zero
failures, cancellations or skips, including both normal and deliberately
observer-disabled painted frames and 16 native-observer transitions. Final
typecheck passed; production build emitted `sw.js build b2e67dbde156af9d` and
`built in 41.03s`. Source aggregate (32 owned source paths) stayed unchanged at
`8dbb3c8dee187a4f9faa408395ae03b62a01bff255935c2f15eef9399492cc68`.
The fixture flag was absent from the production build. Final pixel refresh
passed 12/12; all 16 composer/caption/document/album images at 390/1440 in both
themes were inspected on that unchanged source. Independent deployment
verification remains before first-slice publication.

## First Web Slice Released

Server commit `26a274cb` and client commit
`56ae3cc0c9a049a4c36363e7743fc2fe5be757cf` were reviewed as a separate
`origin/main..HEAD` step; 284 own-tree alias imports resolved. The reviewed
candidate was pushed to `codex/member-mentions-20261001` before `main`.
Coolify reached the exact client commit with one healthy replica. Public entry
`/assets/index-BCrQq7Yo.js`, SHA256
`729c585a1eb83f2d9f8bec64cbd3cf9aff07c4cb71ac56ed97c8aec5ba6cad28`,
contains member picker, V2 draft, account epoch and refused caption markers.
The prior `/assets/index-CH7gbNHe.js` remains byte-identical and lacks the new
picker marker. Both new entry and service worker match container bytes.

Post-deploy read-only QA passed 3/3 in Chromium desktop/mobile and WebKit
mobile: actual QA Auth and own-preference HTTP 200, exactly one selected option,
zero preference writes. Screenshots, trace, video and error-context snapshots
were disabled; each QA session was locally logged out. This is browser
acceptance, not an installed PWA/native device test or OS push receipt.
The owned synthetic dev server was stopped after verification. D-208's
unimplemented consumer cases above are the next checkpoint; its public bucket
and the Android/native release hold are unchanged.

## D-208 Consumer Slice, 2026-10-02

The unimplemented-consumer checkpoint immediately above is superseded by the
[current consumer record](2026-10-01-signed-media-consumers.md). Actual group
avatars, path-only/refused FILEs, WebKit focus, background history privacy and
mounted signature renewal/playback are implemented and tested. Same-message
attachment replacement has its own actual MessageBubble regression. The final
FILE matrix passed 69/69, final units passed 4832/4832 without skips, and
reviewed `c31ed22f` reached the verified healthy image. Read-only deployed QA
passed 4/4. The linked record holds content hashes, rollback and remaining gates.
No private-bucket switch, Android work or production message write is implied.
