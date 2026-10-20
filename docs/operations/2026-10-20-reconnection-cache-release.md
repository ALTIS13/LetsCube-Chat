# Reconnection, Cache and Readable Notifications

## Resume

- Owner: Codex coordinator; canonical worktree remains `android-current-20261015`,
  branch `codex/ui-motion-updates-20261019`, product candidate `39793e0a`.
- Stage: three bounded workers trace network revival, message-cache restoration
  and notification delivery; coordinator owns Android release verification.
- Verified baseline at 2026-10-20 19:40Z: sole healthy web image `9f6c7afe`,
  build `9e82c0d67b28ed43`, public/container HTML/JS/SW parity. Android Stable
  remains 0.1.30/build31; no candidate32 publication has occurred.
- Blocker identified: the unpublished candidate32 actually built and has its
  original signature/Firebase configuration, but the verifier's permission set
  omitted the new explicit-install permission. Original refusal is retained.
- Next: complete scoped RED/GREEN repairs, review the integrated source, then
  build a fresh candidate32, verify original signer/Firebase/native updater,
  upgrade Realme without clearing data, publish and verify live bytes/image.

## Approved Continuation

1. Preserve the previous motion/update/changelog implementation and its evidence:
   [source acceptance and limits](2026-10-19-ui-motion-and-updates.md).
2. Trace VPN/network loss from visible state through requests, Auth and Realtime;
   force the suspected failure locally without changing the host VPN or routing.
3. Trace persistent message history from account-owned IndexedDB through trust
   verification and rendering. Do not delete messages or relax privacy fences.
   The owner's cache wording is treated as a request for working message history,
   not authority to delete test conversations or change retention.
4. Reconcile sender/text notification production, privacy choices, platform
   consumers and actual published artifacts against accepted physical evidence.
5. Release independently verified fixes. Native Apple binaries and a positive
   native in-app32-to-next33 upgrade remain separate from shared-web acceptance.

## Reference Analysis Method

Reviewed [REA-Prompts](https://github.com/JoasASantos/REA-Prompts), especially
feature tracing, behavioral reconstruction and validation. No standalone REA
engine is exposed among this session's callable tools; the repository is prompts,
not an installed engine. The README explicitly labels its prompts MIT; REA's
own terms are separate. No prompt/source text is copied or executable installed.

Apply the method through existing source search, SDK inspection, controlled
browser/network fixtures and Android manifest/DEX verification. Each analysis
records entry point, state owner, data flow, persistence/transport effects,
failure behavior and evidence. Separate confirmed behavior, inference and UNKNOWN;
source references and a passing example do not establish physical equivalence.
Use public primary documentation/open-source references, not proprietary code,
assets, credentials, private traffic or another person's account.

The official [Telegram updates contract](https://core.telegram.org/api/updates)
uses local sequence state and explicit gap recovery; the official
[Discord Gateway contract](https://docs.discord.com/developers/events/gateway)
describes heartbeat acknowledgement, reconnect and session resume. These are
protocol references, not measurements of Telegram/Discord mobile UI or a reason
to implement either wire protocol in LETSCUBE. The corresponding LETSCUBE goal
is session-owned recovery without missed/duplicate effects, not an extra spinner
or unconditional reload.

## Release Verifier Repair

Actual previous APK verification failed specifically at the exact permission
contract. Adding the required permission to the literal test fixture first made
12 of19 checks fail; adding only `REQUEST_INSTALL_PACKAGES` to the allowlist makes
all19 pass. The test also refuses its absence and an extra `QUERY_ALL_PACKAGES`.
The actual previously refused APK then passes original package/version,
non-debuggable, exported-component, Firebase-resource, signature and DAL checks.
This diagnoses the old refusal; it does not make that expired build publishable.
The private build wrapper's verifier fingerprint is explicitly advanced to the
reviewed new bytes; every other source/custody/artifact gate remains unchanged.

## Scoped Source Findings

### D-386: Replacement Handshake Ownership

Confirmed with the installed Supabase2.105.1 SDK: the first dead transport is
replaced, but that new transport can itself stay CONNECTING. Its heartbeat only
runs after OPEN; calling connect again does not replace an existing handshake.
Restoring the controlled route alone therefore left the channel unjoined until
another UI/network signal. The original failing output is retained privately.

`realtimeRevival.ts` now owns one ten-second follow-up for recovery handshakes,
including the SDK's own heartbeat failure path. It waits for disconnect to finish,
leaves a healthy socket alone and retires stale timeout callbacks by identity.
Disposal, account ownership and the existing SDK reconnect machinery remain.
The final network cohort passes32/32 with four loaded omission controls; current
typecheck passes. This is real SDK/helper/state execution with controlled transport,
not physical VPN/ISP, mounted React or production acceptance. No host network
configuration changed. A genuinely unreachable endpoint still cannot connect.

### D-387: Independent Cache Keys

An eviction of chat B advanced a global generation and replayed chat A's pending
membership read. Four unrelated invalidations produced five serial reads for one
caller. Actual useMessages execution also delayed a held warm page behind an
unnecessary second answer. Pending identity now belongs to the exact user/chat;
same-chat clear, connection gap, hidden/reply checks and owner retirement remain.
Three original RED cases, then37/37 affected plus6 selected adjacent checks pass,
including loaded literal mutations. No message, retention or SQL change.

**Important remaining boundary:** received history on this path is RAM only.
IndexedDB outbox persists pending outgoing messages, not received history. This
repair does not implement fresh-document text-history restore or close Task2's
cold/offline scope. The next persistence slice must define bounded text snapshots,
restore them as untrusted data through existing privacy gates, and test logout,
account switch, clear/hide/reply, stale restore and quota/IDB failure. No offline
access right is inferred from an old saved snapshot.

### Readable Notification Audit

The producer, SW, preview hooks, native binding/lookup/consumer and runtime mounts
are unchanged from the accepted sender/text baseline. Existing actual iPhone PWA
and Android FCM display/tap/logout evidence remains valid. The current production
baseline and pending build include that implementation; no blind toggle or repeat
send was needed. Message content still requires the account setting and this
installation's consent/current binding; denial/deadline and private lock-screen
redaction intentionally remain neutral.

Windows ordinary running-client toasts already format sender/text through
`desktopNotifications.ts` and native toast XML. The distinct background/killed
WNS provider path remains generic; Android/iPhone acceptance does not close it.
No notification privacy gate or provider payload was weakened in this slice.

## Review and Release

Independent cache/verifier/final-frozen-network review finds no P1/P2. Coordinator's
integrated affected cohort passes88/88 with zero skips; actual typecheck and diff
check pass. Fresh signed release/device/publication checks remain the next
actions. Existing visual evidence for the unchanged motion/update/
changelog components is retained, including the explicitly inconclusive older
WebKit growth case; it is not relabelled as a fully clean matrix.
