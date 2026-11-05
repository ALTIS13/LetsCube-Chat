# Task 12 Optional Scope, 2026-11-05

Owner: Task 12 implementer. Stage: 12 of 12, scope reconciled; no product patch
or release. Source: `D:/CodexProjects/LetsCube-Chat`, `main` at `32ab32fc`
(matching the local `origin/main` ref). Parallel task, auth, sidebar and status
changes in the worktree were left alone.

## Decision And Evidence

[Task 12](../superpowers/plans/2026-10-18-production-completion.md#task12-remaining-optional-product-scope-24)
owns [tracker item 24](../PRODUCTION_PRIORITY_TRACKER.md#next-execution-queue).
The owner's [D-071 decision](../INTERFACE_DEFECT_REGISTER.md#d-071---where-the-action-lane-binds-the-spacer-still-wraps)
keeps one reaction per person per message as the ordinary rule. Item 24 defers
several reactions on one message, animated reactions and animated emoji to a
paid subscription. No free animation pack, higher free limit or additional
profile decoration is specified there. The ordinary emoji picker and compact
message sizing are separate requirements, as confirmed in the
[tester intake](2026-10-04-tester-feedback.md#deduplication-and-source-boundaries).

| Piece | Evidence and disposition |
| --- | --- |
| One ordinary reaction, replaced on a different choice and removed on a repeated choice | Existing. The [server rule](../../.migration-backup/supabase/migrations/20260911142000_one_reaction_per_person.sql) returns `1`; the [client](../../artifacts/kub/src/lib/messageReactions.ts) defaults to `1` and reads the server limit. [Historical production evidence](../PRODUCTION_PRIORITY_TRACKER.md#six-migrations-unapplied-for-three-days) records the reaction RPC rollout. |
| Several reactions from the same person | Existing client/server mechanics can consume a higher server limit; the local tests use synthetic limits. The tracked server rule still returns `1`. No product grant or subscriber acceptance is established. |
| Animated reactions and emoji | No approved independent free slice. The [reaction UI](../../artifacts/kub/src/components/chat/MessageReactions.tsx) renders text emoji and can animate the chip itself; this is not an animated emoji asset or the requested paid feature. |
| Non-commercial profile decorations and badges | Already implemented: [achievement-based frames and backgrounds](../../artifacts/kub/src/lib/profileCosmetics.ts), the [settings section](../../artifacts/kub/src/components/settings/ProfileDecorationSection.tsx) and profile/member badges. Prior [decoration QA](../QA_RESULTS.md#2-profile-decorationspects-was-broken-deterministically-and-nobody-saw) and [badge date rollout](2026-09-28-owner-approved-database-changes.md#4-a-badge-says-since-when--tracker-item-38) are separate evidence. |
| Subscription or premium medal | The [roles and badges proposal](../proposals/2026-09-13-roles-and-badges.md#6-the-slices) expressly defers it until #24. The [badge RPC](../../supabase/migrations/20260928200000_profile_badges_since.sql) returns only public global roles and earned achievements, not subscriber status. A reserved design slot is not a real badge. |

## Verification And Next Action

Local `node --test` on `message-reactions.test.mts`, `profile-badges.test.mts`,
`profile-achievements.test.mts` and `badge-vocabulary.test.mts`: **86 passed,
0 failed, 0 skipped**. These tests cover the existing behavior, not a new
feature or a fresh production/native acceptance run. No application or test
files changed. No payment, entitlement, provider, migration, deploy or native
operation was performed.

**Blocker:** #24 needs an owner decision on whether to proceed commercially,
the exact paid/free boundaries (including reaction cap and animated catalog),
and the terms for grant, expiry and revocation. Any provider choice and proof
are separate and not established here. **Next:** retain #24 as open; use those
decisions to define acceptance before commercial implementation. No separately
specified, missing non-commercial piece was found in the tracked scope.
