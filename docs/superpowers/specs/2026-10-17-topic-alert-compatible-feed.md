# Compatible Notification Feed, Task6 Addendum

Status: execution design, not installed SQL, an enabled feature or release
acceptance. Extends the approved [item77 plan](../plans/2026-10-16-topic-notification-overrides.md),
not its mute/privacy semantics. Current evidence is in the
[execution record](../../operations/2026-10-16-topic-notification-overrides.md).

## Observed Cause

Stable22's embedded notification hook neither requests the decision RPC nor
checks the terminal marker. Retaining a legitimate notification INSERT therefore
still gives that old foreground consumer permission to sound. Windows update
overlays do not unmount its hook, and a PWA SW takeover does not replace running
JavaScript. One old/new PWA document can share the same JWT. Neither a release
catalog nor a session-level capability ACK excludes the old document.

This is an absent protocol boundary, not another boolean to add to a UI cache.
Do not delete feed rows, mark them read, relabel message kinds or require a new
generic cache framework to emulate suppression.

## Coordinator-Selected Boundary

Use a versioned own-feed RPC and a thin v2 invalidation stream on the existing
Supabase Realtime stack. New code never needs to reopen legacy direct SELECT or
postgres_changes access to the original notification table. The route itself
distinguishes the consumer protocol; UID/session upgrade flags must not authorize
the old route again.

1. Retain original notifications as the source of truth, including every feed
   row, payload, ID and read timestamp. Preserve current legitimate-own-row,
   current-session, ban and other applicable access restrictions in the v2 RPC;
   SECURITY DEFINER is not permission to bypass those predicates.
2. Add server-only per-account protocol activation, separate from current
   presence and push-device content capability. The first successful explicit
   override activates it atomically; failed/conflicting CAS must not activate
   anything. Returning to inherit does not reopen the unsafe legacy route.
3. A restrictive legacy SELECT policy denies the original feed route for an
   activated account. The v2 authenticated RPC returns the complete legitimate
   own feed independently of mute state. Other accounts and backend service
   callers retain their previous behavior. Test the actual combined policies,
   not a guessed replacement for existing RLS.
4. Use a dedicated server-owned event sidecar for v2 invalidations, with no
   message bodies, sender data, URLs or provider material. A signal identifies
   the changed notification; it never grants alert permission. Prefer the
   existing postgres_changes mechanics over deploying a new broker. Pin actual
   publication membership, RLS, replica identity and privileges. Do not expose
   foreign ownership through deletion/retention events; validate those semantics
   before choosing the final event identity and cleanup rule.
5. New consumers read the v2 feed and reconcile exact own changes. Keep the
   bounded page, read monotonicity, account/session ownership, INSERT admission
   versus unknown UPDATE distinction and native read-pair/card cleanup. Every
   alert still obtains the fresh decision at the actual audio/Windows boundary.
6. Do not silently fall back to the original route on transport/schema errors.
   New client errors remain unavailable/retryable, not alert permission.

Before coding the sidecar, inspect the actual Realtime/auth/policy contracts and
reuse local patterns. Its final row/deletion shape needs explicit privacy-safe
tests; this document does not assume DELETE RLS/filter behavior. Server-written
ownership is never derived from a client channel/payload.

## Selected Event Contract

Coordinator-selected implementation detail after source review, not an installed
schema or owner-confirmed design artifact. Use append-only
`notification_feed_events_v2`: independent random `event_id uuid` primary key,
server-owned `recipient_id uuid`, nullable `notification_id uuid`,
`event_kind` (`created|changed|removed|invalidate`) and server `created_at`.
No message payload, sender/chat identifiers, URL, provider material or alert
permission. No FK back to notifications/accounts: source/account deletion must
not destroy a necessary invalidation or add another parent/cascade lock edge.

Authenticated SELECT requires the current own session and applicable ban/access
restrictions; client writes are forbidden. Single source creation emits created;
meaningful changes/deletion emit changed/removed. Identity reassignment removes
from the old owner and only invalidates the new owner, never creates a second
alert admission. Statement-level bulk read/update/delete coalesces to one
invalidate per affected recipient. No-op updates emit nothing. The emitter
never acquires an account cursor or re-enters reconciliation: a shared cursor
would serialize ordinary writes and introduce a reverse lock edge.

Signal retention is24 hours, with bounded cleanup batches; it is not retention
of the original feed. Prefer INSERT-only consumption. Require default replica
identity and the independent event-only PK, never FULL or a recipient/notification
identifying PK. Realtime DELETE does not apply RLS, so subscription filters are
not a privacy boundary. Actual cleanup wire frames, including a foreign `*`
subscriber, must show at most an unrelated event ID, not recipient/notification
identity. This does not hide global timing/count metadata. These are testable
requirements derived from the
[Supabase DELETE contract](https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records),
not proof of this deployment's wire behavior.

The current consumer refresh merges latest30 and does not remove absent rows;
absence from that page is not deletion. V2 needs bounded page plus own-ID lookup
(up to100) for retained rows, including read-confirmation. An authoritative
unavailable result retires a held row; a transport error does not. Subscribe and
buffer before the initial snapshot; coalesce invalidations and fence held reads
by UID/session/account epoch/channel generation and dirty generation. A late
snapshot must not restore scrubbed payload or older read/terminal state.

Only a live created signal can enter INSERT admission. Changed/removed/invalidate,
bootstrap and reconnect never sound; every actual alert still asks the fresh
decision RPC. A timestamp, sequence allocation or UUID is not a commit-order
watermark. After a gap/TTL expiry, resync the authoritative feed without replaying
old alert signals. Current deleted-message cleanup scrubs notification payload
through UPDATE, so checking only DELETE is insufficient.

### Row Revision

Independent page/lookup requests can legitimately read different versions of X.
Last-response-wins is not an ordering rule: an older lookup can otherwise replace
a newer page payload and leave an old alert permit usable. V2 therefore adds a
server-owned `feed_revision` per notification, integer1..9007199254740991. Existing
rows start at1 without rewriting their payload/read history; meaningful changes
increment under the existing row lock, no-op updates do not. Clients cannot set,
reset or overflow it. This is not a global cursor or a commit-order watermark.

Rows contain the original six fields, explicit `alert_suppressed_at` and
`feed_revision`, never internal alert_origin. Merge overlapping responses by the
greater revision. Equal revisions with different row data refuse the frame;
older revisions cannot restore payload or an old permit. A newer row revision
retires the earlier admission token even if its payload happens to match again.
Keep read/terminal/scrub monotonicity as additional safeguards, not substitutes
for versioned authority. Test both page-new/lookup-old and the inverse, ABA,
same-revision contradiction and held callbacks.

Source/access invalidations must not trail ordinary message creation merely
because a source INSERT happened: created followed by an unrelated broad
invalidate would discard legitimate live admission. Exercise the actual message
producer -> emitted signals -> client composition, not only each module alone.

### RPC and Stream Handshake

- `notification_feed_page_v2(p_limit=30,p_before_created_at=NULL,p_before_id=NULL)`
  returns `{v:2,rows,next}`. Limit1..30, paired display cursor, descending
  created_at/id tie order. This cursor is not a delivery/commit watermark.
- `notification_feed_lookup_v2(p_ids uuid[])` returns
  `{v:2,rows,unavailable_ids}`, at most100 input IDs before deduplication.
- `notification_feed_open_v2(p_limit=30,p_held_ids='{}')` returns
  `{v:2,barrier_event_id,page,lookup}` and inserts its own random-ID invalidate
  signal in the same transaction. It is a per-connection handshake marker,
  not a persistent account cursor or an alert grant.

Install/buffer the callback before subscribing. After SUBSCRIBED, call open and
enter live mode only after both its response and its exact stream marker. Preserve
stream order if either arrives first. Earlier created events still reconcile the
feed but cannot sound; only post-marker live created events can attempt fresh
alert authority. Delayed commits use stream order, not created_at. Other tabs'
markers are invalidations, not permission to change this connection's baseline.
Gap, bounded-buffer overflow or owner/session/generation change abandons the
handshake and resyncs without backlog alerts. Actual stream ordering remains a
wire acceptance gate, not something a synthetic client fixture proves.

Only successful enabled/disabled CAS first activates the account fence. A first
inherit choice has no override to enforce; it does not activate. Once activated,
inherit retains the fence permanently, including retained-data rollback.

## Required Acceptance

- Real PG17/full-schema/PostgREST: successful own v2 reads equal the legitimate
  pre-activation feed byte-for-byte for payload/read identity; foreign, retired,
  banned or anonymous callers refuse. Own authenticated callers cannot forge
  activation/events or disable the legacy fence.
- Same JWT, two actual consumer documents: old direct REST, an already connected
  legacy Realtime listener, reconnect and catch-up all remain excluded after
  activation. A new v2 consumer still receives the retained feed and new events.
- Actual new hook sound/Windows ports: disabled keeps feed/unread and gives zero
  alert calls; enabled under a muted parent works; owner/read/marker changes
  during waits remain inert. A received signal or capability ACK alone never
  authorizes an alert.
- Activation/CAS and signal failures roll back as one transaction, not partially
  exposing an enabled choice. Unknown consumers do not reopen a legacy route.
- Actual supported-client/canary checks remain required. An already delivered
  legacy event or provider-accepted/in-flight push cannot be recalled and is not
  reclassified as pending merely to claim a stronger guarantee.

## Rollout and Rollback

Keep override writes unavailable until the versioned transport, remaining target
binding and intended platform matrix pass. Migrate additive default-off server
support first, with fresh verified backup, full restore rehearsal, raising
selfchecks and one canonical/mirrored transaction. Do not activate ordinary
accounts as a migration side effect.

Ship v2-capable web/native candidates and an enforcement-compatible rollback
candidate. Use only exact-owned canaries for production read-routing/Realtime
proof after server installation. Do not grant all users temporary write access
merely to test a canary. A stale native binary or PWA document is not made
compatible by a catalog label; the legacy fence is the enforceable boundary.

Rollback freezes override writes and enabled-child bypass but preserves protocol
activation/fencing, v2 feed access, disabled data and terminal suppression. Never
restore an older unguarded client/table route as the rollback mechanism. Existing
accounts that never activated v2 must not lose their current notification feed.

This addendum does not close item77 or authorize skipping any existing migration,
provider, privacy, visual or real-platform gate.
