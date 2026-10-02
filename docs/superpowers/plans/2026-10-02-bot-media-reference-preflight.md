# Bot Media Reference Preflight Implementation Plan

Historical v1 plan, completed. The read-only source is extended to v2 by the
[reference resolver follow-up](../../operations/2026-10-02-bot-media-reference-resolver.md).
Do not repeat this plan or interpret its literal-only coverage as current.

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded SQL task and independent review. The coordinator owns the lifecycle contract and handoff.

**Goal:** Extend read-only evidence beyond canonical message columns without authorising deletion or quota release.

**Architecture:** Keep the accepted ingest audit unchanged. Add a separate guarded aggregate SQL report for other reference sources; document the writer fences a future destructive reconciler must implement.

**Tech Stack:** PostgreSQL, Node test runner, existing disposable PostgreSQL fixture.

**Spec:** [Accepted reconciliation safety contract](../../operations/2026-10-02-bot-media-reconciliation.md).

## Global Constraints

- No production writes, schema change, Storage remove, quota release or automatic scheduling.
- READ ONLY REPEATABLE READ; final ROLLBACK; statement timeout 15s, lock timeout 2s, charged ledger cap 20000.
- Emit counts/bytes and coverage limitations only, never identifiers, paths, URLs or content.
- All authors/chats and soft-deleted rows count as references. Unknown coverage never implies safe deletion.
- Android build/install/publication remains held; Realme may be used for installed-app QA; A063 is excluded.

## Review Focus

Cross-author references, preview bucket semantics, encoded/legacy URLs, an already claimed purge, and unknown-result storage operations must not turn absence of one reference into deletion permission.

## Task 1: Guarded Reference Report

**Files:** Create `scripts/bot-media-reference-preflight.sql` and `tests/server/bot-media-reference-preflight.test.mjs`. Do not change the accepted audit or shared fixture.

**Interface:** Standalone reviewed SQL on trusted operator stdin; exactly one aggregate JSON row named `bot_media_reference_preflight_v1`.

- [x] Demonstrate the canonical-only gap with known synthetic preview, variant and legacy URL references and literal expected counts.
- [x] Implement catalog/role/column guards and bounded read-only report: canonical message columns, `media_metadata.preview`, `media_variants` source/target, legacy message/avatar URL literal references, open content-report holds and purge queue overlap.
- [x] Report unresolved URL coverage explicitly; do not invent an exhaustive URL decoder or deletion-eligible count. Nonliteral/encoded references remain a future reconciliation gate.
- [x] Test empty positive control, cross-author/soft-deleted reference inclusion, distinct receipts versus reference-row multiplicity, preview bucket mismatch, purge state/claim boundary, schema drift, no identifier exposure, read-only refusal, and semantic mutants.
- [x] Run `node --test tests/server/bot-media-reference-preflight.test.mjs` against the disposable PostgreSQL fixture and record actual counts, red/green and mutants.

## Task 2: Lifecycle Contract and Acceptance

**Files:** Create `docs/operations/2026-10-02-bot-media-lifecycle.md`; update the one active resume in `docs/HANDOVER.md` and link the accepted reconciliation record.

- [x] Map current message, forward, variant, avatar and purge writers from source and live catalog; distinguish current code from proposed fences.
- [x] Define immutable receipt retention, expired-lease fencing, unknown Storage outcomes, object-reference fencing, exactly-once retained-only quota release and separate rolling budget.
- [x] Independently review SQL/tests and contract, then execute only the reviewed read-only SQL against production with aggregate-only evidence and exact input hash.
- [x] Verify focused diff/syntax/links; commit only owned files and preserve foreign changes. Before an authorised push read outgoing commits separately and verify the deployed revision/content independently.

Acceptance: SQL `10262625`, contract/evidence `df343b6f` shared in main; exact healthy
web revision and unchanged public/container JS/SW plus retained entries verified.
See the [durable acceptance record](../../operations/2026-10-02-bot-media-lifecycle.md).
