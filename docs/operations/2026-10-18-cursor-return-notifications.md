# Cursor Return: Notification Release

Owner: Codex coordinator. Date: 2026-10-18. Stage: Web preview and Android Stable23
released after physical acceptance; distinct Topic acceptance next. This record
supersedes the October 17 resource hold, not its historical evidence.

## Verified Baseline

- Canonical worktree: `C:/Users/maksi/.codex/worktrees/android-current-20261015/LetsCube-Chat`,
  branch `codex/topic-alerts-20261016`. The main checkout on D: was clean but
  stale at `c0b79cb0`; it was fast-forwarded to current main, without reset,
  stash, source copying or changing ignored secrets.
- Cursor deployed the coordinated migration and the chat reopen/handshake fixes.
  Live web was `d61efd3a`, API `aed60557`; both notification runtimes were OFF.
  Cursor's fresh "wire" proves a SQL transaction/CAS, not a browser/Realtime
  transport or physical notification acceptance.
- At the audit baseline the old Android 0.1.22/build 23 candidate was unpublished;
  it was not promoted. The fresh candidate's release is recorded below. Windows
  0.2.14 uses the remote renderer; its native package/signature is unchanged.

## Repairs And Evidence

- `7142e52f`: hidden joined reply previews and a changed clear boundary cannot
  use the warm first-frame shortcut. A held disconnect cannot reconnect after
  disposal; overlapping recovery is single-flight and rejections are handled.
  Five new failures and the clear-mark failure were reproduced before repair;
  coordinator's focused run passed 53 tests. Typecheck/build passed.
- `94d0ee8b`: subscription/admission/grant lock order, final admission expiry
  checks and safe rollback before/after the additive sidecar. DB suite 69/69;
  the actual upgrade is covered, not only the final proposal.
- Production PG17.6: fresh 6,631,321-byte custom backup, readable TOC and retained
  exact function metadata/rollback. New schema-only isolated PG17 container,
  network `none`, no production rows copied: migration COMMIT and exact narrow
  rollback both pass. Migration SHA-256
  `c64e4896379db891395a3a7c5c34f47f48276972af563bd425df2311c40bd745`
  was applied once; mirror matches, zero public tables without RLS, topic/Web
  flags remain false. Private operator records live under
  `.ops-private/web-preview-install-20261018/`; backup stays on the server.
- Physical rented iPhone 14 Pro Max/iOS 26.5: installed Home Screen PWA, owned QA
  account, system permission, one subscription admitted for 45 minutes. Initial
  preview confirmation fails despite a valid server grant. A true cold PWA
  restart makes confirmation succeed: the first SPA document has no controller.
  The fix uses only the exact registration's activated `/sw.js` fallback;
  Chromium/WebKit first-document regressions pass 22/22, adjacent checks 4/4.
- Background canary still showed the generic fallback and no new content-RPC
  call. The live Edge mounted sources match canonical and its start is after
  their write; stale runtime was not assumed or restarted speculatively.
- Current [Push API specification](https://www.w3.org/TR/push-api/#declarative-push-message)
  requires top-level `mutable: true` to dispatch a declarative push event, whose
  `data` is null and whose `notification.data` carries metadata. The old sender
  omitted mutable and the worker read only event.data. Both sides now preserve
  identifier-only routing/selection, never sender/body authority. The provider
  regression was RED, then GREEN; 63 worker/click/provider tests pass.
- Click handler now awaits focus, rechecks the exact live same-origin window,
  handles rejection/closure and serializes concurrent clicks without duplicate
  cold windows. These tests are not physical tap acceptance.

## Protocol Compatibility And Deployment

Compatibility follow-up: mutable delivery is gated on literal protocol `1`,
not on the existence of a preview grant. Only the new successful worker ACK
advertises this version; the page rechecks the exact browser descriptor and
persists it under owner/key filters. Old workers retain the original declarative
navigation/tag rather than swallowing a null-data event. New migration
`20261018021000_web_push_worker_protocol.sql` defaults all old subscriptions to
0 and resets on descriptor/owner/active changes. Its 20 DB tests pass; a fresh
6,637,546-byte backup and actual isolated PG17 apply/exact rollback precede its
production apply. Both general flags remain OFF. Client/worker/provider 111/111,
single/album dispatch 140/140 and first-document Chromium/WebKit 36/36 pass.
Final source typecheck passes; web build `a6232b5b92cc6b36`, built in 19.48s.

The first production protocol canary enrolled on a fresh iPhone without restart
and reached content HTTP 200 (647 response bytes), but still displayed generic.
WebKit's actual `ServiceWorkerRegistration::showNotification` rejects a mutable
replacement without a valid top-level `navigate`; `data.url` is not that option.
The narrow follow-up supplies the exact same-origin route while retaining legacy
data.url. The rejecting contract was RED; worker/click/lifecycle 65/65 now pass.
Build `ab8230e0484b44cb` completed in 23.63s. The physical follow-up passed below.
The first rental expired automatically and its exact QA subscription was
deactivated; a second owned QA-only iPhone session is active. One inactive-grant
old QA subscription was also retired to isolate delivery; this did not resolve
the fallback and was not called the cause. No real user's subscriptions changed.
The retained local fixture also passes 2/2 in Chromium/WebKit using a real
registered worker, native IndexedDB, MessagePorts and streamed HTTP response;
only notification publication is an OS-leaf stub. It is not physical acceptance.

The exact Edge pair was backed up, atomically installed and restarted. Web
`746592cb` first passed exact image/healthy/public JS+SW parity; the final cold
restore fix `dc381840e9a634057906dabe684955514fcd289c` is deployed with build
`00df21e65e13fa57` and the same bidirectional public/container checks.

## Actual iPhone Acceptance And General Web Enablement

On 2026-10-18, a rented physical iPhone 14 Pro Max/iOS 26.5 used the installed
Home Screen PWA and only owned QA accounts/synthetic text. No personal screen,
trace, message, sender identifier, subscription or credential is retained here.

- First-document enrollment succeeded without restarting the installed PWA.
- The background OS card showed the expected sender and exact synthetic body.
- Sender-only showed the expected name and generic message body, not the text.
- None showed generic notification text and neither sender nor synthetic body.
- System-card activation opened the intended QA conversation and target text;
  an independent database observation confirmed that exact notification read.
  Immediate MobileNext snapshots could still show SpringBoard; its delayed
  state was not misclassified as a routing defect.
- After actual UI logout the public guest screen returned and the grant's auth
  session no longer existed. No sender/text appeared in the subsequent device
  observation; this does not claim an OS card was delivered after logout.
- The exact QA installation was then deactivated: subscriptions/admissions/
  active grants all zero. The rental was released and a fresh device inventory
  contained only the local Realme.

A cold same-session document restore exposed a second client defect: a persisted
grant's transient document epoch was compared to the new document's epoch.
`dc381840` compares its stable UID/session while retaining live-operation epoch
guards. Real Chromium/WebKit reloads preserve the grant/deadline without renewed
consent; a delayed old-epoch ACK is still refused. RED/GREEN and coordinator
40/40 tests plus typecheck pass. This last repair has browser reload evidence,
not a second physical cold-restart claim.

After these checks, a fresh 6,639,018-byte custom PG17 backup was SHA-verified,
TOC-checked and fully decoded. The guarded transaction changed only
`private.web_message_preview_runtime.enabled` false to true. Separate readback
confirmed Web=true, Topic=false, unchanged schema/ACL catalog fingerprint and
zero public tables without RLS. The guarded true-to-false rollback is retained.
No user's preview preference or installation consent was silently changed.

Users update/reopen the PWA, allow notifications and choose their desired
**Settings -> Notification text** mode. If the device still reports generic
text, use **Enable on this installation** there; consent is per installation.
Older workers keep safe generic delivery until the protocol handshake completes.

Private operator evidence: `.ops-private/web-preview-install-20261018/`,
including phone-event booleans, exact runtime receipts, activation backup and
guarded `activate-web.mjs`. Server backup remains under the matching dated
`/srv/letscube/backups/` directory. Never replay a spent apply or expired rental.

## Android Stable23 And Native Lookup Repair

Final Android source `4d394ecf`, build23, APK SHA-256
`147a06405a827a026fa8cb6d0453c1bc1ce2891667f31d6bf83ae9998f562c71`,
7,755,291 bytes. Real build markers: `8f4c9d7d37fdbce4`, built in21.61s,
Gradle34s. Original signer, four Firebase values, release flags and APK/AAB/web
parity pass. Realme primary20 ->23 in-place retains UID/data directory/first
install and its already-authenticated owned QA session; a fresh device row
reports23 under the same session. No clear/uninstall; other protected apps were
not updated.
Codex Process Jobs refused this Windows host (`win32` unsupported); no detached
job was started, and the foreground release builder completed normally.

The actual current primary's FCM card was generic despite account choice message.
Kong observed native preview POST499 while capability POST200 succeeded. The
actual SQL inner plan evaluated privacy on thousands of unrelated messages
before a text-cast join; it took4.4s, beyond the unchanged native2s read timeout.
JIT-off did not improve it. A read-only guarded UUID PK join returned the same
authorized row in20ms using `messages_pkey`, not a scan. That diagnostic alone
was not called authenticated HTTP/device acceptance.

`5b2dd526` / migration `20261018031000_native_preview_point_lookup.sql` changes
only that join. Case-sensitive canonical UUID validation preserves rejection of
malformed, missing, uppercase and noncanonical payload IDs without cast errors.
All existing session/recipient/device, unread, hidden/blocked/deleted, topic,
push-choice and ordinary/album delivery predicates remain. SQL mirror SHA-256:
`612bb2b9b75f38bac44ce6deb830245436f4f5899bfe3d7a382607141e5daa24`.
Focused PGlite37/37 passes in both agent and coordinator runs; executed old join
causes9003 visibility/4501 push checks, new join3/1, with the correct row intact.

A fresh 6,648,997-byte backup was SHA/TOC/full-decode verified. A new network-none
PG17 schema-only clone received no production users/messages/sessions. Its first
metadata comparison refused four differently parenthesized CHECK definitions;
the function/ACL and all other components matched. These four differences were
calibrated by exact raw prod/clone hashes, not removed from verification. Every
raw protected component stayed unchanged within its environment through actual
migration COMMIT and exact old-function rollback. Production guards/rollback
remained byte-identical to the original prepared operator. The raising migration
was applied once; separate readback confirms unchanged protected catalog,
Web=true, Topic=false, RLS missing=0. The owned clone is stopped, backup retained.

Post-apply actual RPC diagnostic is39.6ms; an ordinary Realme background FCM then
performed content HTTP200 and showed the expected sender and unique synthetic
body in the real shade. Actual SystemUI tap opened the target message, marked
its notification read and removed that chat card. None produced a new generic
card without sender/body. Actual UI logout revoked the same phone session and
registration. Tapping the retained generic card after logout opened only login,
did not mark the target read and cleared the stale card. This does not claim all
cards disappear automatically at logout. An unrelated old QA device was left
unchanged; no bulk account/device retirement was performed.

Stable23 was published through the existing immutable publisher with a catalog
CAS and byte-checked previous manifest backup under its publish lock. Separate
HTTPS verification confirms version0.1.22/build23, mandatory=false, exact public
APK length7,755,291 and SHA above. Previous Stable22 manifest/artifact remain.
Only server SQL/tests/docs changed after APK source4d; no mobile source or build
tool delta requires another binary. Private proofs include `realme-acceptance`,
`realme-tap`, `realme-logout`, `native-apply`, `native-rehearsal` and
`publish23-public` JSON in the current operator directory. Do not replay them.
Both extra API-only QA sessions were locally signed out and their cached tokens
removed after acceptance; the unrelated older QA device was not revoked. The
published0.1.22/23 path is immutable; a future binary change needs a new version
and build, not another overwrite of23.

## Next

Topic overrides' distinct real transport/consumer acceptance is still unfinished
and its runtime remains OFF. Resume that bounded current stage, then the
Nikita/cache/reconnect intake and broader tracker. Reuse the physical iPhone,
Realme and recovery evidence instead of replaying accepted harnesses. Windows
remote renderer uses the released web repair; no new native signature, WNS
killed-process or full device matrix is claimed. Native Apple release ownership
is unchanged. The original Cursor binary remains unpublished.

No A063 access, personal captures, secret output, global Java/PATH changes or
legacy sender activation. Figma/Mobbin/Rive are available for visual work;
MobileNext and its existing cached CLI are available for paid physical iPhone
checks. Both rentals from this turn are released/expired and their subscriptions
retired; no paid device remains held.
