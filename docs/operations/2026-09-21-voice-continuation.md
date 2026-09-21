# Voice Continuation, 2026-09-21

Owner: Codex. Base: `6cc44205995f0c50609980a68ccd0db798213153`, main checkout
`D:\CodexProjects\LetsCube-Chat`. Scope: tracker 49, D-284, then tracker 32-D1.
No iOS-specific work, release signing, production SQL or dispatcher activation.

## Repairs

- Tracker 49: one stable call shell around public and authenticated routes. Public
  documents keep mute, leave and return-to-chat controls; their own scroll root
  uses only the remaining height. Loading a chat keeps the shell controls until
  the messenger actually mounts, not just until the URL changes.
- Saved-call persistence follows a live call on every route. Mute is persisted;
  a deliberate hang-up removes the record. Opening a public page alone never
  starts a saved microphone. Returning from it with a live call is not a reboot.
- Outgoing calling is not reported as an answered conversation. It keeps mute
  and cancellation on public pages; cancellation uses the `cancelled` reason.
  Final verification also covers the subscription surviving the route change.
- Windows caption: measured microphone control at y=8.9 under the 32px drag
  region. The caption is now global, including public pages; a rendered call bar
  reserves its height once, with no residual gap when the call ends.
- D-284: keep the gateway refusal code; private calls translate `channel_full`
  into their own wording. The group error and other failures are unchanged.
- D-088 follow-up: `useChatAddress` subscribed to the whole chat array from
  `MainLayout`, making a message in B rerender the open conversation A. The
  subscription now returns only idle/known/missing/waiting for the unresolved
  address. No chat data, unread anchoring or message-jump rule was changed.

## Verification

All route/call screenshots are fictional fixtures. No personal device screens,
message contents, credentials, tokens or media were captured. Every Playwright
run used `KUB_QA_ALLOW_MUTATIONS=0`.

- Reproduced RED: missing public call bar; stale saved mute/hang-up record;
  return action staying on `/privacy`; disappearing controls during chat load;
  loading bottom at 951px in a 900px viewport; Windows caption overlap;
  private start/answer leaking the group capacity sentence.
- Combined voice shell/resume/ring matrix: 124 passed, desktop 1440 and mobile
  390. Historical intermediate run; superseded by the final matrix below.
- Final units with concurrency bounded to four: 3862 passed, one skip (legacy
  release test requires jq 1.7.1). An unbounded run lost the bot-management-auth
  test process without an assertion; its isolated rerun passed 29 tests, and the
  subsequent complete bounded run passed. No bot production code changed.
- Earlier gate corrections: the old public-root selector expected `h-dvh`;
  caption CSS had to remain in the existing components layer; bundle assertions
  require a fresh production build. These were corrected, not waived.
- Final typecheck passed. Production build ran after the auth and address
  changes: `sw.js build cc5ad7397bebc83c`, `built in 8.94s`.
- API-server build and 145 server tests passed; this batch changes no server
  runtime yet. Fixture staff/admin checks: eight passed.
- Signed-in task filters: four passed (1440/390). Role visibility initially
  failed on the obsolete desktop dropdown selector, not an authorization denial.
  Updated it for the shipped side-menu dialog and «Управление» label; also made
  the creation-permission assertion cover the current «Новая» button. All eight
  role cases passed afterward. Screenshots/traces/video disabled; additionally
  `PLAYWRIGHT_NO_COPY_PROMPT=1` disables Playwright's error-page DOM snapshot.
- Installed Chrome, isolated headless fixture profile: five public-call and
  Windows-caption checks passed. This is browser proof, not a packaged Tauri run.
- D-088 baseline: detached `6cc44205`, separate local Vite/cache, no secrets,
  same RPC-enabled fixture. Both 1440/390 reproduce the unexpected conversation
  renders (four before; three in the call batch before the address repair).
  After narrowing the selector, both have zero ChatWindow/MessageList/row
  renders; only B renders twice and no chat-data fetch occurs. Full address and
  event-cost matrix: 27 passed, one intentional skip (a phone has one pane;
  desktop direct-switch coverage is replaced by its leave/reopen case). One
  initial reconnect case was unstable; three
  repeated current-source runs and both baseline runs passed, so its cause is
  not asserted from that initial failure.
- Reader matrix before the subsequent auth repairs: 135 passed, one
  failure at mobile call-preference refresh (expected a second gate read, got
  one). Its isolated mobile rerun passed three times without weakening the
  assertion and passed again in the complete final matrix.
- Final voice matrix: 182 passed, four loading cases failed because they
  expected route navigation to remount the old auth observer. Revised only those
  fixtures: navigation must retain the loaded profile; an independently induced
  same-user auth/profile refresh blocks the real GET response and proves the
  microphone controls remain usable in the remaining viewport. Filter GET with
  `select=*`, not the unrelated PATCH heartbeat. All four reran green (10.8s).
  Thus all 186 cases have current-source passing evidence, not a claimed single
  all-green run. No production code changed between these two final runs.
- Configured/unconfigured public-routing checks: 21 passed, 21 intentional
  project skips. Final installed-Chrome isolated fixtures: five passed. Final
  signed-in roles/tasks: 12 passed, with all captures and mutations disabled.
- Pre-push committed-tree check resolved 127 `@/` imports. Its first invocation
  failed to locate TypeScript through an app-local dependency path; it was
  corrected to the installed root dependency and actually rerun successfully.

## Auth Review Follow-up

Independent review found three auth/lifetime boundaries to close before deploy:
an unauthenticated `/login` could consume an old interrupted resume record;
group transport needs an explicit identity-loss shutdown; retry timers must
survive public navigation without enabling microphone restore on a fresh public
visit. All three are repaired, with one root `useUser` observer rather than
duplicated auth subscriptions. The configured root publishes only identity and
loading; unconfigured public pages remain outside that observer.

- Resume records require their owner. Legacy/unbound records are ignored rather
  than silently enabling a microphone. Guest/auth/public boot cannot consume a
  saved call. An account change remounts the offer and stale callbacks refuse.
- Runtime retry requires a call observed alive in this authenticated runtime,
  not merely a storage entry. Failed retries preserve the original deadline and
  finite attempt schedule; no extension by rewriting the saved timestamp.
- Auth loss/change closes transport and microphone locally and clears resume.
  Capture/token/SDK continuations release their own acquired resources after
  invalidation, never those of a newer call. Pending ring/answer/stop replies
  are fenced by auth generation, including when transport was still idle.
- An already-issued old RPC is not reversed under the new account's identity.
  Its local continuation is ignored; server-authoritative expiry/reconciliation
  remains responsible for the old call.

RED: guest/foreign-owner restore, public retry, first retry failure, identity
change while capture/token/transport/leave or ring/answer/cancel is pending.
GREEN: resume units 12, resume browser 21; transport/auth browser 16, related
ring/browser 12; mobile call preference rerun 3. Independent cross-review found
no remaining concrete regression. All were fixtures without real calls.

## Android Contract Foundation

Task 1 of [the staged plan](../superpowers/plans/2026-09-21-android-call-delivery.md)
is implemented: pure `buildVoiceFcmMessage`, ten tests, strict short-lived
ring/cancel data, recipient user/session binding, no notification text or token
in data. UUID fixtures contain letters so the canonicalization assertion is
meaningful. Existing `fcm.ts` and `index.ts` are unchanged; this builder is not
imported into the deployed dispatcher. No FCM call delivery is enabled.

Local detailed logs and fixture images are under ignored `output/voice-*`.

## Publication

Validated commits pushed to `main`: `dc59ea28` (client/auth/route repairs) and
`804101f5` (unused Android contract and staged plan).

Production verified after replacement completed, 2026-09-21 07:26 UTC:

- Exact running image:
  `l64kyyu1sysev2izzjjbizhe:804101f584248c04a23c5412cd55da10549391a1`, healthy.
  The previous replica is absent. Coolify reports the matching deployment finished.
- Public entry `/assets/index-Chr49y24.js`, CSS `/assets/index-DAhJjc5Q.css`.
  The CSS contains both new shell/caption selectors. The old
  `/assets/index-Ctn3PWFQ.js` is absent from the entry document.
- `/privacy`, `/support`, `/download`, `/bots/docs` and `/login` all return 200
  with the same new entry; no authenticated production capture or call was used.
- During rolling overlap two probes saw the old entry naming a CSS file that
  returned 404. Once the old replica was retired, the same probe passed. This
  matches the previously recorded rolling-asset risk in the defect register;
  not a claim that asset continuity across deployment has been fixed.

Only the web application was published. No Edge dispatcher, database or native
binary was deployed. The known prior web image is `6cc44205995f0c50609980a68ccd0db798213153`
if a rollback is required; this batch needs no database rollback. The final
documentation-only commit retains this runtime and must have its own image tag
checked after its auto-deploy; do not treat this code-image proof as that check.

## Tracker 32: Measured Baseline

Read-only production inspection, not inference from old tracker text:

- `voice_channels` has ring start/caller/answer columns and is published to
  Realtime. Ring/answer/stop, missed sweep, session-device preferences and their
  RPCs exist. `user_session_settings` references `auth.sessions`, with RLS and
  no direct client policies. Missed sweep: 1440/1440 successful runs in 24h.
- General native outbox and FCM delivery exist. Its scheduled worker also had
  1440/1440 successful runs in 24h. No active unread delivery backlog. Deployed
  push function files match repository hashes. These are not call delivery proof.
- No transient voice push outbox; voice terminal paths do not enqueue or cancel
  OS delivery. The existing native outbox requires a persistent notification FK,
  so it cannot represent ephemeral ringing without changing product semantics.
- Push devices have no session binding. A closed-client push therefore cannot
  yet enforce the per-session call switch. Unbound devices must remain excluded
  from future call delivery, while ordinary message/task push remains unchanged.
- Current Android has messages/tasks/system channels, not a native ring/cancel
  handler. The plugin's messaging service is present, but there is no custom
  call handler. Do not describe the entire Firebase service as missing.
- Voice schema/RPC owner is `supabase_admin`; push-device owner is `postgres`.
  Rehearse role ownership explicitly instead of broadening privileges.

ADB is authorized for Nothing A063. The installed APK is 0.1.5/build 6; the
public Stable catalog and repository are 0.1.7/build 8. Nothing was not upgraded
or overwritten: preserve this old installation for a later upgrade-path test.
No claim of physical call delivery is made by this report.

## Next Gates

1. Complete: bounded data-only ring/cancel payload and tests, unused by the live
   dispatcher. Existing notification builders remain unchanged.
2. Session binding derived from verified JWT server-side; separate transient
   outbox and idempotent terminal paths. Backup and rehearsal before any apply.
3. Immediate trusted dispatch, rechecking membership, session, call preference,
   native capability and current ring generation before sending. Keep disabled.
4. Native handler/channel with absolute expiry, duplicate/late-event handling,
   explicit user acceptance before microphone and safe cancellation. A signed
   native candidate/publication is a separate owner-authorized step.
5. Physical foreground/background/locked/killed/cancel matrix and session
   re-registration, then activation. WNS closed-process messages and iOS work
   remain separate. Do not mark tracker 32 complete on source tests alone.
