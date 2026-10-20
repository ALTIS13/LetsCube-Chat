# Reconnection, Cache and Readable Notifications

## Resume

- Owner: Codex coordinator; canonical worktree remains `android-current-20261015`,
  branch `codex/ui-motion-updates-20261019`, released product `d9991760`.
- Stage: scoped repairs/review/release complete; persistent received-text cache
  and broader physical-network acceptance are the next distinct tasks.
- Verified baseline at 2026-10-20 19:40Z: sole healthy web image `9f6c7afe`,
  build `9e82c0d67b28ed43`, public/container HTML/JS/SW parity. Android Stable
  remains 0.1.30/build31; no candidate32 publication has occurred.
- Original blocker identified: the unpublished candidate32 actually built and had its
  original signature/Firebase configuration, but the verifier's permission set
  omitted the new explicit-install permission. Original refusal is retained.
- Completed: reviewed RED/GREEN repairs, fresh candidate32, original signer/
  Firebase/native updater, data-retaining Realme upgrade, Stable publication and
  public bytes; exact shared-web image/content proof follows below.

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

## Android Stable32

Product source `d99917600da96fcb625d48d3f6f3b9114b86c079` was freshly built:
`sw.js build 26b6cb403d447cb9`, `built in 31.45s`,
`BUILD SUCCESSFUL in 44s`. APK7,816,157B SHA256
`b723b8c588b775c78720f5a6d7d2e50f1d5ae9c31b1be809c63bf26d86f8b562`;
AAB7,440,446B SHA256
`f01690ba0c460a9a0674209a3a9acff7ba83a9eeb115bf4243be8d69f947d466`.
Original sole signer/APKv2, all four exact Firebase values, false QA flags,
APK/AAB/native DEX parity and42 web files pass. The five updater classes are
defined in DEX and registered in MainActivity; manifest/provider checks pass.
The inventory helper's initial8MiB ENOBUFS refusal was diagnosed and retained;
a bounded32MiB inventory completes without dropping its class-definition gates.

Realme RMX3830 upgraded31 ->32 without clear/uninstall: UID, data directory and
first-install time retained, current guest UI opens and native fatal count0.
The first device attempt refused a locked screen before installation; ordinary
non-secure keyguard dismissal worked without PIN and the changed-input attempt
passed. Phone returned HOME. This is guest startup/data preservation, not a
physical signed-in VPN, FCM or in-app32 -> next33 proof.

Android0.1.31/build32 Stable is published at19:49:17Z, mandatory=false. Publication
held an exact old-catalog CAS and original Stable31 APK hash, retained rollback,
then verified current public metadata and the entire downloaded APK's size/hash.
Windows shell0.2.14 remains unsigned/unchanged; no Apple binary or Store submission.
Shared web production proof is recorded below.

## Shared-Web Release

Product `d9991760` is sole-healthy on app `l64kyyu1sysev2izzjjbizhe` at19:53:55Z;
build `2b74d0d5f9bac197`, entry `/assets/index-D7JePAnI.js`. Public/container
HTML, entry JS and SW SHA256 match. The four new UI-update markers are absent
from old source9f6c7afe, present in the released tree and present in the served
entry at19:54:05Z. Initial image/health and dual-replica refusals were retained
until rollover completed, not treated as successful deployment.

This updates web/PWA and the Windows remote renderer, not the native Apple
binaries. New source does not imply a physical VPN, iPhone or signed-in Android
canary. Prior accepted notification delivery/activation remains reused unchanged.
The primary D: main checkout was fast-forwarded without modifying ignored local
secrets. No owned dev server on5188 or paid rental is held.

## Next Persistence Slice

Do not relabel outbox durability or warm RAM history as disk history. The proposed
first slice is bounded text-only snapshots keyed by backend namespace/owner/chat/
topic, without tokens, trust flags, embedded profiles, media URLs or nested reply
bodies. Restore is a concurrent cache input, never a barrier to normal network
fetch, and cannot establish current access, edited/deleted state, read/unread,
hasMore or anchor by itself. Replies require current target admission.

Candidate bounds for the next design are100 confirmed text rows/scope,10 scopes,
8MiB/owner and seven days from verified write, not from read. These are proposed
cache limits, not an implemented feature or server retention change. Before
implementation determine an authoritative version/access reconciliation that is
cheaper than downloading full history again; do not add a hash RPC without the
normal measured SQL/backup/transaction protocol. Current cold-offline access is
not widened by an old saved snapshot.

Acceptance must execute actual Chromium/WebKit IndexedDB across two documents,
held network responses and owner/session retirement. Include same-chat clear,
hide/delete/edit, stale writes after logout, reply privacy, quota/abort/unavailable
IDB and literal owner/revision/admission omissions. Reuse the existing outbox
transaction helper but keep received snapshots and pending sends separate.

### Admission Investigation, Not Implementation

Source review finds no existing received-history digest/conditional-page RPC.
The separate current-production read-only catalog observation agrees: calibrated
known functions `chat_list_summaries` and `search_chat_messages` are present;
the scoped history/cache/hash/digest/page/revision name search returns no
candidate. This is not a claim that every possible function name was searched.
The exact expected database/runtime matches before/after and no data rows are
exported. Messages, chats, memberships and own-message hides retain RLS.

Current catalog has the ordered partial active-message index on
`(chat_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`, the older full
`(chat_id, created_at DESC)` index and a topic-only index. Membership and hide
primary keys support their exact composite lookups. No new index is justified
merely from this inventory; query plans/costs remain unmeasured.

The minimum candidate to measure next is one read-only conditional bounded-page
RPC, not a new chat-wide counter or trigger journal. It must positively admit
the current caller/scope, select the actual ordered message page, apply current
clear/hide/deletion rules and produce the safe payload plus its digest in one
statement snapshot. On an unchanged digest it can omit text bodies. Hashing
still reads the selected text/TOAST: this saves response bytes, not O(1) database
work or already-proven startup latency. Measure ordinary-role plans/buffers and
complete match/miss response costs before choosing/applying this contract.

The digest must cover the canonical persisted content/mentions and page selection,
not just IDs/counts/edited timestamps. Local payload bytes must match their saved
digest before an unchanged server answer can admit them. A newly downloaded head
does not validate old cached windows. Each older window needs an exclusive full
`(created_at,id)` cursor and its own admission; changed middle pages reset the
continuity chain. Unsupported/mixed-media pages initially use the normal path,
never a text-only filter scanning arbitrarily far or silently dropping media.
Reply/profile blobs and media URLs stay out of the initial stored projection.

Normal statement-snapshot consistency is not a permission lease until rendering;
account/privacy/known-revocation fences remain essential. This follows the
[PostgreSQL17 snapshot contract](https://www.postgresql.org/docs/17/transaction-iso.html),
not a claim of linearizable revocation across separate requests. No cold-offline
access is granted here. There is no new function/table/migration, client history
store or accepted performance result yet. Next measurable boundary: isolated
ordinary-role conditional-page match/miss plus revoked/hidden/clear/equal-time
controls, then real two-document IndexedDB restoration.
