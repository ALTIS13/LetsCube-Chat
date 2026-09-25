# LETSCUBE — handover

Written 2026-09-21 by the Claude agent that ran this project from 2026-09-01, for
the agent taking it over. **This file is the current state.** Where it disagrees
with an older document, this file is right and the older one is stale — say so in
the older one when you notice.

Read in this order:

1. **this file** — where things stand and what to do next;
2. **`AGENTS.md`** — the rules, short;
3. **`docs/operations/working-lessons.md`** — what this project learned by getting
   it wrong. Read it before your first command. Most of it is about instruments
   that report success while doing nothing, and every entry was paid for;
4. **`CLAUDE.md`** — the long operational handbook. §5 (running servers and
   suites), §7 (reference clients and deciding without asking), §9–§10 (secrets,
   database safety) and §15 (deploying) apply to you exactly as written. Its §1
   «Current Stop Point» and §2 «Deployment baseline» are **stale** — this file
   replaces them;
5. **`docs/PRODUCTION_PRIORITY_TRACKER.md`** — the queue (items 1–51) and the
   decisions log;
6. **`docs/INTERFACE_DEFECT_REGISTER.md`** — every defect, through D-298, with its
   measurement. Search it before filing anything.

---

## 1. What LETSCUBE is

A production messenger. **Not** a computer-club tool — that positioning was
removed, and the old wording in some documents is stale; do not reintroduce
«KUB», «КУБ», «компьютерный клуб» or «кибер-арена» in anything a user sees.
Internal `kub` identifiers stay where renaming would break contracts; the Android
package id stays `com.kub.messenger`.

Three shells over one web application:

| shell | how | current release |
| --- | --- | --- |
| web | `artifacts/kub`, React/Vite, served at **https://app.letscube.ru** | deploys on every push to `main` |
| Windows | Tauri EXE; loads `app.letscube.ru` at runtime, bundles only its splash | `0.2.14` build 18, 2026-09-06 |
| Android | Capacitor APK; **embeds** its web bundle | `0.1.11` build 12, 2026-09-25; verify the live catalog before a new cut |

So the Windows shell always shows the current web; **the Android APK shows the web
as of its cut**, and will lag subsequent web deploys. A tester on Android is describing that
build — check the platform and version before treating a report as a current
defect, and read the live catalog rather than any number written down:
`https://api.letscube.ru/releases/v1/{android,windows}/stable.json`. Cutting and
signing a native release needs the owner's explicit word each time.

Backend: self-hosted Supabase (Auth, Postgres with RLS on every table, Realtime,
Storage) at `core.letscube.ru`; a worker (`artifacts/api-server`); an isolated Bot
Gateway; LiveKit for voice; a support-mail bridge. Everything runs on one host,
`ms.letscube.ru`, under Coolify. The infrastructure map is `CLAUDE.md` §8.

---

## 2. Handover baseline, 2026-09-21

The following is Claude's snapshot before the continuation. For work since that
snapshot, use the active checkpoint in section 4 and its linked report.

- `main` and the working branch `integration/message-actions` are level. The web
  container runs the tip of `main` — read it off the container, never from this
  line: `docker ps --format '{{.Image}}' | grep l64kyyu1sysev2izzjjbizhe`.
- Gates at the last deploy: typecheck clean across all packages; unit **3850/3850**;
  `tests/server` **145/145**; production build proved by its own
  `sw.js build <id>` and `built in Ns` lines.
- Working tree clean, nothing unpushed, nothing uncommitted.
- **Production database changes applied in the last three days**, each with a
  verified backup, a raising self-check and a byte-identical copy in
  `.migration-backup/supabase/migrations/`:
  - `20260920130000_a_group_voice_channel_has_no_seat_limit.sql` — group voice
    channels unlimited (`0`), private stay at two; **closed a hole** where a
    participant could PATCH a one-to-one call to 20 seats and admit a third
    person. `livekit.yaml` `room.max_participants` moved `10 → 0` alongside it,
    because a stored `0` is a proto3 zero the SFU would otherwise replace with its
    own default.
  - `20260921120000_a_forward_names_its_source.sql` — a forward records its
    original author permanently at the moment it is made; the author's own
    privacy setting decides whether the name or a hidden form is written. A
    trigger, not the RPC, because the insert policy checks no column but the
    author and would otherwise let a client forge a source.

---

## 3. What happened in the last three days

The work since 2026-09-18 has followed the owner's messenger priorities, not the
public-home plan `CLAUDE.md` §1 names — that plan is **parked, not abandoned**
(tracker item 17, `[~]`).

**Voice and audio.** Voice had never actually carried audio to a listener; fixed,
then TURN over TLS on 443, then a reconnect storm, then presence. The microphone
level instrument read the 8-bit analyser and could not represent silence — so the
no-input warning never fired and voice activation at its default could never
close; moved to the float API. The group seat cap lifted and the private-chat hole
closed (above). **Coming back after a drop**: the product rejoins you
automatically within five minutes when *it* caused the interruption (a transport
drop, an update it applied) and offers one button when *you* did (a reload) —
because rejoining silently turns a microphone on.

**Where you were.** A conversation now has an address — `/chat/<id>` and
`/chat/<id>/m/<messageId>` — so a reload lands where a click lands, including the
unread divider. An idle tab takes a new build by itself; the update notice is
throttled to the deploy cadence (242 deploys in 30 days, median gap 28 minutes)
rather than Discord's stable channel.

**Settings and surfaces.** Settings left the chat-list column for an overlay of
their own (at the column's 260px minimum a person could not read their own name).
The bots page, admin and tasks were measured; the real defects were a page title
91% hidden at 390px, a 1460px text field and a selected admin tab 679px off
screen.

**Profiles.** A profile opens without entering the conversation — the old route
had been sending a **read receipt** just by looking. Two tiers over one store, as
Discord builds it; the compact tier anchored beside the face and **beside the
message row**, not on it.

**Messages.** Body text 14→16px with a 13–22 size setting, the composer bound to
it with a six-line ceiling; Inter self-hosted rather than fetched from Google;
reply by swiping left (right is Telegram's back gesture — do not use it); the
photo viewer moves between a chat's images; HD is a remembered SD/HD state; a
caption no longer disappears when a send is retried.

**Bots.** A registered `/command` in a message is pressable; a hand-typed `/cmd` in
a group is addressed so it reaches the bot; a bot has a profile card. Langame, the
live bot in test: 56 messages, 0 edits, and `bot_commands` has **0 rows on the
whole deployment** — no bot has registered a command yet.

---

## 4. Where to start

**Current backend checkpoint, 2026-09-26 (Codex):** native FCM/WNS OS push
payloads no longer carry sender, preview, avatar or task content across a
rebindable device token. Exact-message routing and chat tags remain. Reviewed
modules are mounted on the healthy Edge runtime; native packages were not cut
and no live provider card was generated. Browser Web Push/PWA is a separate
account-switch risk being coordinated with its owner. Album-level external push
aggregation remains the next backend stage; preserve individual notification
rows and their exact read/navigation semantics. See the
[rollout and limits](operations/2026-09-26-native-push-account-privacy.md).

**Current shared-web checkpoint, 2026-09-25 (Codex):** photo HD is the default
on a new device; an explicit SD choice remains. A 2-10 visual selection now
carries album metadata and renders as a grouped mosaic with independent message
actions. The hidden-message gate in shared media/links now fails closed. Focused
fixture and build checks passed, and the live web image matched `d86eea8f`
with its public bundle markers. Authenticated device acceptance is separate.
The iPhone PWA viewport bugs were passed to its owner. Next: address
album-level notifications/pre-send preview, private media cache and physical
Android QA. Do not cut an Android APK without separate owner instruction.
[QA and remaining limits](operations/2026-09-25-media-album-hd-qa.md).

**Current checkpoint, 2026-09-25 (Codex):** Android 0.1.11/build 12 is signed
and published in Stable with gallery save, deferred large-photo originals and
mobile Profile navigation. The public APK matches the local signed artifact and
the previous Stable manifest has a byte-identical server backup. Web source
from `4947680e` reached a healthy Coolify image and the public JavaScript
contains the new media/profile controls. Physical authenticated Android gallery behavior
and a managed private media cache remain open. See the
[0.1.11 release record](operations/2026-09-25-android-0.1.11-release.md) and
[media/navigation audit](operations/2026-09-25-media-navigation-audit.md).

**Prior checkpoint, 2026-09-25 (Codex):** iPhone PWA is owned by the
separate `iOS/MacOs` task and was published from `48cdf716`. Web push-permission
recovery was published from `0df228eb`, and Android native media export from
`4fc1b02c`. The existing protected signing inputs were found and verified;
Android 0.1.10/build 11 is signed and published in Stable. Local/public APK
verification, signer continuity, a signed upgrade on Realme and an isolated
AVD guest launch passed. Next: physical authenticated Android media-save and
FCM checks, particularly on official Google services; do not infer them from
the AVD or the Realme guest launch. See the
[release record](operations/2026-09-25-android-0.1.10-release.md) and
[media-export QA record](operations/2026-09-25-android-media-export-qa.md).

**Android/web Stable, 2026-09-24 (Codex):** `fdbb6d72` is deployed as the
healthy web container and Android 0.1.9/build 10 is signed and published in
Stable. Local and public APK verifier, signer continuity, Android 14 AVD guest
launch and focused browser matrix passed. Realme was subsequently unlocked
without a PIN and signed 0.1.9 showed its guest login; authenticated signed
push and physical official-GMS latency remain unproved. Windows 0.2.14 uses
the live updated web. The owner chose to continue first-party Windows EXE
distribution with the separate Tauri updater signature while Authenticode is
unavailable; only Authenticode/Store readiness is blocked by the missing
publicly trusted code-signing certificate/provider. The Windows post-build
gate now verifies both app and installer signatures and selects the current
installer version even when older builds remain in the directory. The iPhone
PWA continuation was sent to its separate owner in the `iOS/MacOs` task.
[Release evidence and rollback](operations/2026-09-24-android-0.1.9-release.md).

**Android Stable release, 2026-09-23 (Codex):** owner-authorized signed
`0.1.8/9` APK was published from `02441b29`. Local and public release verifiers,
signer continuity with `0.1.7`, Android 14/API 34 signed guest launch, and
16 production-bundle layout checks passed. The prior Stable manifest has a
server-side backup. Signed authenticated FCM, physical official-GMS delivery,
long-session and wider matrix QA remain open; debug AVD/Realme push evidence
must not be promoted to signed/physical-GMS proof.
[Release evidence and rollback](operations/2026-09-23-android-0.1.8-release.md).

**Interface visual pass, 2026-09-23 (Codex):** D-272 and the device-title
follow-up under D-222 are closed; D-299 to D-303 close five newly measured
public/support layout defects. Local synthetic 1440/390 light/dark pixels were
inspected. The combined public/support browser suite passed 24/24; targeted
call, session-device and desktop-shell guards passed. Typecheck and a real
production-mode web build passed. No production deploy, native signing or
physical-device QA in this pass. An initial desktop-shell run used an ignored
local Vite env setting that enabled an unmocked access-snapshot RPC and hid
synthetic permissions; the affected cases passed after explicitly setting
`VITE_ACCESS_SNAPSHOT_RPC_ENABLED=0` for the fixture server. A follow-up closed
D-157's translucent-arrow text collision and missing focus outline; the full
desktop-shell spec passed 29 cases (25 platform skips), the shared unit suite
passed 21 cases, and WebKit mobile folder checks passed in both themes.
Next: broader screen-by-screen visual inventory and the separately authorized native
candidate/device matrix; do not infer that production or installed clients
carry this local UI patch.
[Visual pass and exact validation](operations/2026-09-23-interface-visual-pass.md).

**Android list follow-up, 2026-09-23 (Codex):** D-304 locally adjusts only
native Android's floating navigation: a 24px gesture inset is now below its
56px capsule, and row text no longer competes with the tab labels. Synthetic
390px dark/light and web regression checks passed. D-305 shortens the clipped
chat-list search hint at 390/1440 while retaining its full accessible label.
No signed APK or deploy.
The connected Realme reports installed 0.1.3 build 4, so its appearance is
not evidence of the current checkout. Further visual inventory remains open.

**Android 13 WebView follow-up, 2026-09-23 (Codex):** D-306 found an opaque
`color-mix()` build fallback on the guest auth grid, panel and offline banner.
The shared color repair is local; debug APK and isolated Android 13 light/dark
and Android 14 screenshots/lifecycle were checked. One first-focus wait failed
in an initial Android 14 run and passed on rerun; it remains a QA limit. The
connected Realme was untouched; no signed release or FCM delivery proof.
[Exact matrix and images](operations/2026-09-23-android-webview-color.md).

**Android 13 common-state follow-up, 2026-09-23 (Codex):** D-307 removes
opaque `color-mix()` fallbacks from frequent chat, reaction, notification and
settings backgrounds. The production-configured debug APK was rebuilt; isolated
Android 13 guest lifecycle, desktop selected-row alpha and mobile emoji tests
passed. Authenticated physical Android appearance is still open.
[Evidence](operations/2026-09-23-android-webview-color.md).

**Android auth offline banner, 2026-09-23 (Codex):** D-308 is fixed locally.
Native Android auth shows a compact status at the top, leaving registration and
privacy controls visible; browser/PWA retain their bottom banner. A focused
overlap regression and owned Android 13 debug APK lifecycle/screenshot passed.
Physical signed-release and authenticated UI validation remain open.
[Evidence](operations/2026-09-23-android-auth-offline-banner.md).

**Realme Android 15/microG push QA, 2026-09-23 (Codex):** the old installed
0.1.3/build 4 had no Firebase initialization resources. A current
production-configured 0.1.7/build 8 debug APK with all six resources was
installed on the owner-authorized test Realme. A fresh Android notification
permission was incorrectly shown as blocked because noninteractive push restore
mapped `prompt` to `denied`; the source fix is validated by a red/green test and
the physical settings flow now shows Enable and obtains OS permission. FCM token
registration still fails with `IOException`: microG Cloud Messaging is enabled,
but device registration reports Not registered. No delivery or tap is proved.
ADB wake/swipe unlocked it without a PIN. microG self-check passed, its official
0.3.16.252432 update was verified by signer and installed, an old Nexus 5X
profile was changed to Automatic: Device, and a dialer check-in was attempted.
The official Companion was also updated with signer verification. Clearing
only GmsCore app data, re-enabling registration/Cloud Messaging and rebooting
did not fix check-in. The device is still unregistered and the token test fails;
the app itself cold-launches with notification permission retained.
[Evidence](operations/2026-09-23-realme-microg-push.md).

**Realme microG check-in recovery, later 2026-09-23 (Codex):** a targeted,
sanitized `GmsCheckinSvc` trace isolated failure to the retained Google account
authorization path, before device check-in. On the owner-designated test phone,
the stale device-local Google account binding was removed; forced check-in then
succeeded. Physical instrumentation now passes both Play Services availability
and token acquisition (2/2, token not printed). microG reports a registered
device, connected Cloud Messaging and LETSCUBE in its app list. No replacement
of microG was required. Subsequent QA found that reserved FCM data key
`message_type` caused HTTP 400 and wrongly revoked the valid device. The
payload key and revocation classifier were corrected, and only `fcm.ts` was
deployed with an exact server-side backup. On the Realme, background and
normally killed-process OS cards delivered, both card taps reached their exact
messages, and foreground chat sync worked. A rebuilt production-configured
debug APK passed FCM instrumentation 2/2 and the final card/tap check. Signed
release and official-GMS device-matrix proof remain pending.
[Updated evidence](operations/2026-09-23-realme-microg-push.md).

**Android FCM idle/matrix follow-up, 2026-09-23 (Codex):** a fresh Google Play
Android 13 AVD passed FCM availability and token registration 2/2 without
touching the pre-existing AVD. Message/task FCM priority was changed to `HIGH`
while system events remain `NORMAL`; the mounted Edge Function is healthy.
Physical Realme forced-Doze notifications arrived before and after the change.
An offline QA message was accepted by FCM but yielded no new card within 150
seconds of Wi-Fi reconnect; a subsequent online QA message did produce a card.
MicroG offline-queue reliability and signed-release proof remain open. Do not
infer Android Stable readiness from registration or debug APK tests alone.
[Measured results](operations/2026-09-23-realme-microg-push.md).

**Android versioned chat push follow-up, later 2026-09-23 (Codex):** the old
offline observation was not reproducible as permanent loss: a new card appeared
41 seconds after FCM acceptance following Wi-Fi reconnect. Firebase documents
that notification messages ignore `collapse_key`, so Android `0.1.8/9` debug
now uses a non-collapsible data-only chat path with native per-chat OS display;
older APKs and task/system notifications retain their payload. The isolated
Edge files were backed up and deployed, and two distinct QA chats sent while
the Realme was offline both produced separate cards after reconnect. Synthetic
card display and FCM token tests pass. A simulated intent reached the exact
QA chat/message in the WebView; a true unlocked OS-card tap and signed-release
matrix remain open. Android Stable stays `0.1.7/8`.
[QA detail](operations/2026-09-23-realme-microg-push.md).

**Official-GMS AVD delivery continuation, later 2026-09-23:** a Google Play
Android 13 AVD installed the same `0.1.8/9` production-configured debug APK,
registered an FCM device, and received a live data-only QA chat card while in
the background. After `am kill` stopped the app without force-stopping it, a
second QA chat card arrived; Android restarted the process for delivery while
the launcher stayed foreground. The system grouped the two chat cards, and an
actual tap on the expanded second card opened its exact chat/message with the
target row visible, leaving the first card intact. This closes the official-GMS
emulator delivery and tap check, not physical official-GMS, signed APK,
long-session or wider device-matrix QA. Android Stable remains `0.1.7/8`.
[Detailed evidence](operations/2026-09-23-realme-microg-push.md).

**Native OS-card read-sync follow-up, 2026-09-23:** a physical Realme probe
showed an OS chat card persisted after its server notification was marked read.
The client now closes only that chat's delivered Android card after successful
read-sync, including remote read transitions. Red/green tests, Kub typecheck,
production-configured debug APK build and physical two-chat QA passed: the read
chat's card disappeared, the other remained. No backend/schema change or
signed release; Stable remains `0.1.7/8`.
[Evidence](operations/2026-09-23-realme-microg-push.md).

**Remote-read QA continuation, 2026-09-23:** an awake Realme `0.1.8/9` debug
WebView received a read update from a separate authenticated QA session: the
server unread row, OS chat card and in-app badge all cleared. An earlier
`Resumed`-but-`Dozing` probe had been a false negative; a sleeping process only
reconciled on wake. Android 14 API 34 coverage is still unproved: the existing
AVD had a different debug signer, and a fresh isolated AVD stayed `adb offline`
before APK installation. It was removed without touching the old AVD.
[Evidence](operations/2026-09-23-realme-microg-push.md).

**Android 14 matrix continuation, 2026-09-23:** after the fresh AVD's
`adb offline` failure, the existing Google Play API 34 AVD ran in a disposable
`-read-only` overlay. Current `0.1.8/9` debug FCM registration passed 2/2,
synthetic native chat card passed 1/1, and full guest cold/resume passed 1/1.
The original AVD image size/timestamp baselines remained unchanged after exit.
No live FCM send, physical official-GMS validation or signed release was
performed; Stable remains `0.1.7/8`.
[Detail](operations/2026-09-23-realme-microg-push.md).

**Android 14 live FCM continuation, 2026-09-23:** the read-only Google Play
API 34 AVD then authenticated a QA client and registered a native device.
Separate live QA messages produced a background card and an `am kill` card;
an actual System UI tap on the latter opened the exact message row in view.
Test messages, notification rows and temporary device registration were
cleaned. The original AVD image baselines still matched after shutdown.
This is debug/emulator proof, not physical official-GMS or signed-release QA.
Stable remains `0.1.7/8`.
[Detail](operations/2026-09-23-realme-microg-push.md).

**Native proof continuation, 2026-09-23:** owner resumed after restoring the browser
extension. The QA batch began at `d649db3f`. Windows actual WebView2 passed 6/6;
an isolated Android 14 WebView passed seven positive cases and detected three
mutations. Runner/source/APK hashes match the accepted Android report; the owned
emulator was removed. Independent review and focused gates closed the QA harness
findings. No product-source change or new native release in this continuation.
Subsequent full Capacitor debug APK smoke on an owned Android 14 AVD reached
React-ready and a visible guest login form on cold launch, after
background/foreground and after force-stop; all packaged web assets matched the
current built bundle, both offline instrumentation runs
passed, and the AVD was removed. This does not prove full-shell fault injection,
FCM, signed-release parity or physical-device behavior. Next: native candidate
and device matrix only with separate release authority.
[Native proof and limits](operations/2026-09-22-native-boot-proof.md).
[Full-shell debug smoke](operations/2026-09-23-android-full-shell-smoke.md).

**Active checkpoint, 2026-09-22 (Codex):** owner Codex, main checkout
`D:\CodexProjects\LetsCube-Chat`, D-298 recovery batch on `0813bd05`.
Pre-React failures now expose an explicit same-URL retry without clearing sessions
or drafts. Current-document Windows readiness no longer treats document load as
React readiness; native failure/deadline cannot cover web recovery indefinitely.
Liquid-glass material is unchanged. Web matrix 14/14 in both development and built
artifacts; settings/chat/Escape regression 42/42; full unit 4068 pass, one existing
jq skip; Windows JS 50/50 and offline Rust 82 pass, four existing ignored tests.
Typecheck and production-mode build pass. Runtime source `f1bbd60b` was published:
one healthy exact image, old replica retired, before/after asset markers confirmed,
live guest recovery 4/4 at 1440/390 in both themes. Consult the actual image when
resuming; subsequent documentation-only commits may advance its tag.
Next: separately authorized native candidate/release. No signed EXE/APK issued by
this source batch;
Android still embeds its older bundle. Physical all-platform stability is not proved.
[Current evidence and remaining platform gaps](operations/2026-09-22-boot-recovery.md).

D-296 settings resize/draft/modal-order and D-297 async profile placement were
published in `0813bd05`; their valid evidence remains in the
[preceding report](operations/2026-09-21-interface-stability.md).

**Previous checkpoint, complete:** Task 5 Step 1 from `0e2e0535`.
Fresh full SQL backup restored offline; four owner-specific migrations applied,
reviewed Edge separately deployed. Production catalog and disabled HTTP checks
pass. Both dispatch gates remain off and both new jobs inactive. No signed
candidate, phone installation or real call send. Next: separately authorized
signed candidate and physical matrix.
[Current rollout evidence](operations/2026-09-21-android-call-rollout.md).
Task 4 source/debug is complete and deployed in `9d059c4a`; its browser, native
receipt and process-death OS-expiry evidence remains valid and separate from
real FCM delivery. [Task 4 report](operations/2026-09-21-android-call-native.md).
Tracker 49, D-284 and the
D-088 address-subscription regression are verified and deployed in `804101f5`
(runtime commit `dc59ea28`). This includes outgoing ring updates after public
navigation, Windows caption, auth-bound transport/resume and late-RPC guards.
Tracker 32-D1 Task 1's pure Android call payload is deployed behind disabled dispatch.
Task 2 session-binding/outbox proposals passed independent review, 235 server
tests, real-owner PG17 full-schema rehearsals, PostgREST compatibility, forced
concurrent RPCs and exact rollback. The controlled rollout above supersedes that
proposal-only production status. Task 3 passed independent spec/quality review,
291 server and 89 focused push tests, actual PG17/PostgREST/Edge integration and
exact rollback. Nothing is unavailable by the owner's instruction; authorized
Realme has Android 15/microG, LETSCUBE 0.1.3/build 4, notification permission denied
and no Firebase init resources in its installed APK (prior read-only inventory;
not remeasured in Task 4). Native handler and binding source are now complete;
next is the separately gated signed candidate and physical rollout.
Task 5's operational proposal now covers five-second recovery, aggregate capacity,
health and bounded retention, with real isolated runtime proof. Minute polling
alone is not a deadline guarantee. No production SQL/Edge activation or
native installation in this batch. Evidence and remaining gates:
[`2026-09-21-voice-continuation.md`](operations/2026-09-21-voice-continuation.md).
Completed Task 2 evidence: [Android session/outbox rehearsal](operations/2026-09-21-android-call-delivery.md).
Completed Task 3 evidence: [Disabled call dispatcher](operations/2026-09-21-android-call-dispatch.md).
Completed Task 4 evidence: [Native receipt and session binding](operations/2026-09-21-android-call-native.md).
Completed Task 5 operational evidence: [Recovery, capacity and retention](operations/2026-09-21-android-call-operations.md).

In this order, and the order is not arbitrary — several of these are a chain.

**Completed repair batch; do not repeat it.**

1. **Tracker item 49 — public-route call controls.** Closed: current-source
   browser matrix, independent review and production image/content proof passed.
2. **D-284 — private-call refusal wording.** Deployed: the private start and
   answer paths now say «Разговор уже идёт.»; shared group wording is unchanged.

**Then the chain the owner specified in detail.** Read the tracker entries in
full; each carries his own words and the measurements behind the decisions.

3. **Item 32 — finish delivery, do not rebuild the call.** Foreground ringing,
   accept/decline/cancel, call history, missed sweep and session call preferences
   already exist in source and production. Remaining: measured multi-client
   delivery, background OS notification and closed Android call delivery. Start
   with Task 5 of the Android plan: payload, schema, disabled-dispatcher rehearsals
   and native source/debug checks, operational recovery/capacity/retention are
   complete. Production schema/Edge are now installed with gates and new jobs off.
   Next is the separately authorized signed candidate; source tests and disabled
   HTTP checks are not physical delivery proof.
4. **Item 45 — the group chat.** A separate `chats.type`, born from a live private
   call by one «add to conversation» press; the two already talking are rejoined
   and the third person is **rung** (so it needs item 32). Its whole settings
   surface is a name and an avatar; it has no channels, roles, folders, invite
   links or categories — **that absence is the specification**. Rename first: the
   heavy object is currently called both «группа» and «групповой чат» (83 strings
   in 26 files) and becomes «сервер».
5. **Item 47 — separating the kinds of conversation.** Decided: servers get
   Discord's rail; what remains (people, group chats, bots) gets a ready-made type
   filter, because Telegram *has* type separation but makes you build it by hand,
   six steps a folder. Sequenced after 45, whose shapes are its categories.

**Then, in any order, each fully written up in the tracker:** item 48 (bots should
offer an interface, not demand a command — two of the four capabilities already
exist), 37 (presence, idleness and AFK — activity is the signal, not input), 40
(the bottom bar splits into three), 36 b/c (row menu depth, the two searches), 33
(documents in chat), 38 (badges), 41, 42, 43/44 (channel settings, three-state
permissions — needs item 19's roles model), 50, 51.

**Standing, always:** item 34 (the interface's response and its bugs, found along
the way) and item 27 (tasks and location staff are not forgotten — their specs run
in every wave).

---

## 5. Waiting on the owner

These are decisions about other people's data or irreversible steps, which the
delegation below does not cover. Do the reversible half and state the question.

- **Item 50 — whether a call record can be deleted.** He said «как у Discord»; the
  question back was whether that means non-deletable, with the private-chat
  asymmetry flagged. Unanswered. Discord's behaviour has not been measured —
  measure it before re-asking.
- **Photo retention.** He floated deleting photos older than eight months.
  **Deleting by age breaks forwards as they are built** — `forward_message` copies
  variant rows pointing at the same files. And nothing measures bucket growth, so
  there is no number to justify any policy. Measure first.
- **D-208 steps four and five** — media readable by anyone holding the address.
- **PocketFlow live proving** — needs a bot token from him.
- **Any native release** — signing and publishing need his word each time.

---

## 6. The owner's standing instructions

Quoted where it matters, because the wording is the instruction.

- **Report to him in Russian.** He judges visuals **literally**: render the exact
  element at 1440 and 390, both themes, and look at the pixels before you report
  anything visual. Several changes were rejected on sight; one shipped with the
  wrong element changed because his words were read loosely.
- **Adopt the reference clients, or better them — never relabel our own
  structure.** «Требуется перенять даже подобные механики либо придумать им более
  красивую реализацию.» **Discord is the default**; **Telegram** is the reference
  for chat with media viewing, folders and (contested) bots. Measured behaviour
  goes in `docs/operations/reference-clients.md`, dated and confidence-labelled; a
  recollection of the product is not a reference.
- **Decide without asking.** «Принимай решения на основе подхода telegram/discord
  без моего вмешательства.» The authority is the **derivation** — a choice traced
  to a measured behaviour of the right client, or to a written reason for
  differing. It stops at production migrations (`CLAUDE.md` §10 still governs),
  anything that loses or exposes somebody's data, and anything irreversible he has
  not asked for. Full text: `CLAUDE.md` §7.
- **«Where you were» is product state** — the open conversation and the voice
  channel survive a drop, a reload and an update the product applied itself.
- **Deploying.** This project has operated with his standing permission to deploy
  a validated batch without asking, since 2026-09-12. **Whether that permission
  extends to you is his to say** — the handover prompt he gives you states it
  either way. If it does: read `origin/main..HEAD` as its own step, verify by the
  running image tag and a content marker in both directions, never by the webhook.

---

## 7. Environment and access

What this project used, and what you will need to check you actually have:

- **The repository** — `D:\CodexProjects\LetsCube-Chat`, worktree
  `.worktrees\bot-platform`, branch `integration/message-actions`, remote
  `https://github.com/ALTIS13/LetsCube-Chat.git`. `main` deploys the web app.
- **Windows 11 workstation** — Node 24, pnpm 10, Git Bash and PowerShell 7,
  Playwright with Chromium. Use `pnpm.cmd`, never `pnpm.ps1`. Read
  `working-lessons.md` §3 before running anything: several tools here report
  success having done nothing.
- **The production host** — `ssh -i C:\Users\maksi\.ssh\letscube_ed25519
  root@ms.letscube.ru`. Needed to verify a deploy, read the database read-only, and
  apply a migration. If your sandbox has no network or no access to that key,
  say so — do not claim a deploy landed that you could not check.
- **Android devices over ADB** — two phones (`P212C6000159`, Nothing A063, and
  `0C73A18I22105AB1`, Realme), both on gesture navigation, carrying Telegram,
  Discord and `com.kub.messenger`, attached to the workstation with debugging on.
  They are the owner's personal accounts, authorised for measuring reference
  clients. **Access is authorised; exposure is not**: measure structure, spacing,
  type and gesture, keep nothing that carries content, and never `uiautomator`
  inside a conversation. Installing a debug build over the release one wipes his
  app data — adb read-only unless he agrees.
- **QA credentials** live in `~/.kub-messenger-qa.env`, outside the repository.
  Never print them. Every Playwright run takes `KUB_QA_ALLOW_MUTATIONS=0` — a dev
  server that signs in carries the production configuration, so a spec that sends
  a message writes into production.

**Where to work, and where not to.** Two checkouts are current, both at the tip
of `main` as of the handover:

- `D:\CodexProjects\LetsCube-Chat` — the primary checkout, branch `main`. **It had
  been 786 commits behind, frozen at 2026-08-30 with the old computer-club
  `AGENTS.md`**, and was fast-forwarded on 2026-09-21 as part of this handover.
  If you ever find it behind again, `git merge --ff-only origin/main` there,
  after checking it is clean.
- `D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform` — branch
  `integration/message-actions`, where this project's recent work happened.

**Everything under `.claude\worktrees\` is left over from earlier agent runs and
is not current work** — do not start in one of them. Measured at handover: 35
worktree branches besides the two above; **15 are fully contained in `main`**
and can be removed; **20 carry commits that `main` does not**, most notably
`feat/attach-sheet` (21 commits ahead) and `design/attach-sheet-2` (13). Many of
the `design/*` and `measure/*` branches are renders made for the owner to choose
between, and a rejected option is expected to stay unmerged — but that has not
been checked branch by branch, so **none of the 20 has been judged dead.** Their
removal is the owner's call; if you are asked to tidy them, read each branch's
commits against `main` first and report what, if anything, would be lost.

Three older worktrees under `.worktrees\` are named for work that shipped
(`android-release-*`, `preview-backfill`, `registration-lifecycle-cleanup`); the
same rule applies.

**Secrets never appear in output, commits, screenshots or reports.** Private
material is under `D:\CodexProjects\LetsCube-Chat\.ops-private\` — read only the
one file a task needs. `service_role` never reaches a client bundle. RLS is never
disabled. Full rules: `CLAUDE.md` §9.

---

## 8. What was in private memory and is now here

Until today the most expensive lessons lived in one agent's memory outside the
repository. They are in `docs/operations/working-lessons.md` now. Three of them
are worth repeating here because they would cost the most to relearn:

- **A number is not evidence that the right question was asked.** Empty or
  plausible probe results were wrong six times in one day. Prove a probe matches
  something known to be there before believing it.
- **An exit code of 0 is not a run.** The build, a mutation harness, a publish
  script and a pipeline all reported success here having done nothing. Read what
  the program printed.
- **In a shared worktree, `git add` takes a file whole.** A neighbour's half-change
  rode into a commit that could not build and reached `main`. Resolve the commit's
  own imports against its own tree before pushing.
