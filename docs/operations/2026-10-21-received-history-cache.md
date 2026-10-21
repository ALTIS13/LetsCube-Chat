# Received History Cache Foundation

Owner: Codex coordinator. Approved continuation of completion-plan Task2,
baseline `5773aab6`, canonical `codex/ui-motion-updates-20261019`.
This is an implemented/tested foundation, **not an enabled application feature**.
Production SQL and received-history **disk-cache** behavior remain unchanged until
the remaining integration/migration gates below. The separate ordinary pagination
repair is released on web and Android Stable0.1.34/build35; it does not enable
this foundation.

## Implemented Boundaries

- `historyCache/codec.ts` accepts only the versioned supported text projection,
  exact owner-selected chat/topic/window, at most100 rows and1MiB UTF8 payload.
  It verifies raw serialized bytes against SHA256; reserializing JSON is not
  the digest protocol. Local snapshot data alone never admits a page.
- `historyCache/storage.ts` provides a separate IndexedDB database, independent
  backend/owner/window keys, at most10 pages and8MiB charged bytes per owner.
  Expiry is seven days from verified write, not a disk read. This is an
  eligibility TTL; expired physical rows are pruned by later writes/invalidation,
  not an assertion of timed background erasure by a closed browser.
- `historyCache/load.ts` composes storage, a fresh conditional request and
  current account/privacy plus durable-generation fences. Refused, unsupported,
  corrupted or unavailable cache data returns null for ordinary history.
  It is not mounted in `useMessages` yet.
- The SQL proposal is a read-only/STABLE/security-invoker conditional-page
  reader, with current positive chat/membership admission and unchanged RLS.
  Actual page selection precedes hide filtering; private deletion, clear,
  root/general-topic membership and the exclusive full tuple are explicit.
  Miss returns canonical payload plus digest; match omits the payload.
  Replies, forwards, bots, media and group tombstones fall back to normal history,
  rather than silently dropping supported-looking parts of a mixed page.

The candidate uses built-in PostgreSQL SHA256; no extension, index, counter,
trigger, mutation journal or new database table was added. Source is in
`docs/proposals`, not `supabase/migrations`, and is not installed in production.

## Measured Query Defect And Repair

An initial ordinary-role PostgreSQL17.6 fixture exposed a real bad plan: optional
filters expressed as OR branches in a cached generic plan hid the active partial
index. A fixed100-row private head grew from4235 shared buffer hits at1000 rows
to401836 at100000. The CPU-capped warm sample grew20.5ms to2658.7ms. This rejected
the candidate despite the tiny113-byte unchanged reply.

The repaired selector plans fixed server-chosen SQL fragments with **all eight
caller/derived values bound through USING**. No caller text becomes executable
SQL. The indexed page remains constant-size work in the measured uniform private
fixture:427--428 shared hits over1000/10000/100000 rows. The100000-row sample was
5.3ms fresh and6.9ms unchanged before the final continuation-field addition.
These are warm synthetic single samples on a capped fixture, not production
latency, p50/p95, cold-cache or phone startup claims. Original bad results remain.

Match omits text bodies, but still reads/hashes selected content. The response
byte improvement is not an O(1) database revision check. Sparse-topic selection,
group/tied-time distributions, long text, full schema and actual PostgREST costs
still require their own measurements before choosing any additional index.

## Review Findings

The SQL support fold initially treated a nullable discriminator as supported
because SQL bool_and ignores NULL. A real RED case now returns unsupported;
the candidate does not manufacture a text row from an unknown discriminator.

Independent review found that100 own-hidden rows could leave an empty page with
has_more=true but no usable continuation. SQL and codec RED cases preceded the
repair: the payload now carries next_before_created_at/id from the original
selected page, before hide filtering. The decoder enforces strict progress and
the page's lower bound. Real Chromium/WebKit controller+SQL+IDB cases traverse
that hidden page to the next visible text. This is not yet a repair of the
existing application's ordinary pagination path; its distinct scoped repair is
[D389](2026-10-21-hidden-history-pagination.md).

Storage review also exposed two genuine candidate defects. A numeric generation
could repeat after deleting/recreating the database, admitting an old held writer.
UUID incarnations now fence this ABA case, and leases snapshot their scalars
before asynchronous hashing. Secondly, corrupt or missing ownerKey metadata hid
an owned payload from index-only invalidation and budget accounting. Cleanup and
the budget now use the canonical primary-key owner range, prune malformed own
rows and preserve foreign primary keys even when their ownerKey is forged.
Real browser RED cases preceded both repairs; no production cache existed to
repair or erase.

## Verification

- Initial missing RPC/codec/controller cases failed by behavioral assertions,
  not imports. Current source SQL/codec/controller/browser cohort passes30/30.
- Actual PostgreSQL17.6 final minimal-RLS cohort passes16/16, including SQL/client
  wire, five loaded SQL omission controls and measured match/miss response costs.
  Exact SQL/source fingerprints are retained. Each temporary cluster had no
  network or production volumes, a read-only rootfs and bounded tmpfs/CPU/RAM;
  exact owner/image cleanup and unchanged production identity pass.
- Actual Chromium and WebKit two-document cases persist the real SQL payload,
  close the first document, hold a genuine conditional response and prove disk
  text cannot publish early. A held old unchanged answer after another document
  invalidates the owner cannot publish; a new read obeys the current server clear.
- Durable storage passes80/80 in actual Chromium/WebKit, including database
  recreation, held writers, failed transactions and14 RED corruption cases.
  Positive-calibrated loaded omissions reject the index-only cleanup regression.
- Fresh production catalog reads (no personal rows/bodies) confirm RLS and
  authenticated SELECT for the six relevant tables, current helper/topic policy
  definitions and that the candidate RPC is not installed. This is a catalog
  control, not production endpoint or full-schema acceptance.

The minimal native fixture models current relevant columns/predicates. It is not
a full production-schema restore or an HTTP/SDK/Auth proof. PGlite0.5.8 uses
PostgreSQL18.3/WASM and supplies intermediate logic tests only; no WASM latency
is reported as native performance.

## Next Integration

1. Retain the accepted storage ABA/corruption behavior above. Independent final
   delta review passes16 targeted checks, including the omissions; no new P1/P2.
   The foundation is still not an enabled feature.
2. Complete same-response **fresh rendering metadata** before mounting: current
   actors/reactions, client-message identity and delivery/ack reconciliation must
   not disappear or be inferred from disk. Profiles/reply bodies/media URLs must
   not be persisted merely to avoid designing this boundary. Validate metadata
   against the same current selected IDs, not a second inconsistent body read.
3. Full current-schema/ordinary Auth/PostgREST acceptance and the remaining plan
   distributions; then verified backup, raising transactional migration,
   byte-identical mirror/rollback. No production DDL was applied here.
4. Actual hook/store restore, clear/logout/hide/access retirement and network
   fallback without blocking normal loading on a slow disk. Reuse accepted
   outbox/anchor/reconnect evidence rather than replaying unrelated suites.
5. Only then shared/native release and physical QA. A063 was briefly withdrawn
   and explicitly returned by the owner; it is available, not used for this
   source-only foundation. No rental minutes, personal capture, Java/PATH or PC
   Happ/routing changes occurred.

References: [PostgreSQL function snapshots](https://www.postgresql.org/docs/17/xfunc-volatility.html),
[built-in binary SHA256](https://www.postgresql.org/docs/17/functions-binarystring.html),
[Supabase function permissions](https://supabase.com/docs/guides/database/functions).
