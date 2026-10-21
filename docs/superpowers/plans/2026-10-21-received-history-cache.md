# Received History Cache

Continuation of Task2 of the [approved completion plan](2026-10-18-production-completion.md),
not a replacement of its accepted release/device evidence. Owner: coordinator.
Baseline: `5773aab6`, canonical `codex/ui-motion-updates-20261019`.

## Contract

- Received history and the durable outgoing outbox remain separate.
- Persist only a bounded, versioned text projection. No credentials, profiles,
  media URLs, nested replies or forward-origin bodies. Mixed/unsupported pages
  use normal history; no unbounded text-only filtering or silent media omission.
- Derive current access, topic/root selection, clear/hide/deletion and the
  selected page in one read-only invoker statement snapshot. Return the exact
  serialized payload and SHA256 together on miss, no body on an exact match.
  Refused access returns neither. A digest is not an offline access right.
- Recompute local UTF8 payload digest before asking/accepting unchanged; retain
  account/session/privacy fences through publication. Older windows have their
  own complete `(created_at,id)` cursor and admission.
- Storage has independent backend/owner/scope keys, at most100 rows/page,
  ten pages/owner,8MiB/owner, seven days from verified write, not from read.
  Atomic durable generations reject writes held across clear/logout.
- This saves unchanged payload bytes, not O(1) database work. Measure real
  ordinary-role plans/costs before a production SQL migration; do not add triggers,
  counters or indexes speculatively.

## Steps

- [x] 1. Conditional-page SQL candidate and safe wire decoder: RED/GREEN for
  current access, exact content, full tuple selection, hides/clear/deletion,
  topics, unsupported pages and malformed/corrupt wire data. Proposal only until
  isolated PostgreSQL17/schema/ordinary-role and performance proof.
- [x] 2. Durable storage foundation: actual Chromium/WebKit two-document reads,
  owner/backend separation, clear/logout held writers, expiry/eviction, digest
  corruption and failed transactions. Coordinator integrates disjoint worker.
- [ ] 3. Verify the combined candidate in the actual isolated service stack,
  measure match/miss bytes/plans, then fresh backup/raising transactional migration
  and identical migration mirror. No source test substitutes for this gate.
- [ ] 4. Connect latest supported pages to actual message loading and retirement;
  prove cold restore with current admission, changed-page reconciliation and
  logout/clear/privacy. Older cache windows are not implicitly validated.
- [ ] 5. Review changed boundaries, shared/native build acceptance and ready
  rollout with current catalog CAS, exact image/artifact parity and cleanup.

## Review Focus

False positive access from empty queries; missing head/middle-page mutations;
local content altered beside an intact digest; text/mention/time coverage;
unsupported media or reply slots; stale validation/persistence after retirement;
cross-document generation ownership; bounded storage/TTL; mixed-page fallback;
same-statement semantics versus an invented permission lease; query work hidden
by small response sizes. Native updater34->next acceptance remains separate.

## Current Evidence

The installed PGlite0.5.8 is PostgreSQL18.3/WASM. It supports the built-in SHA256
positive control, but is not PostgreSQL17/native query-plan or production proof.
Local Docker is unavailable; do not silently substitute it for the required
isolated-service acceptance. Actual remote isolated PostgreSQL17.6 minimal-RLS
proof passes16/16 with the measured query-cost repair; full current-schema/HTTP
acceptance remains step3. Source cohort30 and storage80 pass. No feature mount
or production SQL. [Evidence and remaining boundaries](../../operations/2026-10-21-received-history-cache.md).
A063 was first withdrawn and then explicitly made available again by the owner
on2026-10-21; coordinator owns any later device use.
