# Authorised Tester Feedback, 2026-10-04

Owner: bounded intake implementer; direct owner request alongside the independent
D-338 SQL review. This records product requests, not an application repair,
device reproduction, SQL deployment or release acceptance.

## Selection And Privacy

The exact privately authorised chat/tester pair was reused from the October 3
intake script. Watermark is the latest tester row in that intake's
`messages.json`, dated October 3, NOT the older October 1 intake or its cutoff.
The prior export contains three rows selected solely for this tester; its latest
timestamp is computed from those rows, not hard-coded as a new selection date.

Actual PostgreSQL 17.6 read used `BEGIN READ ONLY`, transaction-read-only check,
ten-second statement timeout and `ROLLBACK`. Both chat and author predicates,
non-deleted rows, strictly-after-watermark and a maximum three-day window apply.
Selection is ascending by timestamp/ID, limited to 100 rows. **15 new rows** were
returned: **9 text, 6 image, 0 voice**; limit not reached. No other participant or
conversation was exported. Equal-timestamp/newly edited older rows are outside
this timestamp-based incremental intake; this is not an edit-history audit.

Raw bodies, exact pair/message IDs, media addresses, watermark and supporting
results stay in ignored `.ops-private/2026-10-04-tester-intake/`. Local inspection
emitted only bounded product-concept classifications, not raw bodies or personal
identifiers. Six image rows include two captions; no attached image bytes were
downloaded or rendered. No new voice exists, so no decoding, model download or
third-party ASR was needed. No credentials were sent to an ASR service.

## Product Requirements

| Request | Disposition | Remaining detail |
| --- | --- | --- |
| Use ordinary compact emoji in a message bubble instead of oversized standalone emoji treatment. | New item 79 / D-340. | Exact desired size, attachment pixels and affected client/build are not established. One/multiple emoji and mixed text need their own controls. |
| Add another person to contacts from their profile, without detouring through the contacts screen. | Existing item 36 / D-316 follow-up, not a duplicate backend task. | The reported entry/tier/build is unknown. This is not evidence requesting mutual friend approvals or a new social graph. |
| Telegram-style publication channels where readers cannot post ordinary messages and authorized publishers can. | New feature item 80. | Define publisher delegation, invitations/subscriptions and any discussion surface before choosing APIs or policies. |
| Owner direction: heavy Server UI becomes Group; ad-hoc multiuser conversations created during joint calls are Group chats. | New item 81 / D-341; supersedes the old item-45 noun choice only. | Labels, Russian inflection and entry points must agree without renaming internal identifiers or changing permissions. |

The small replies and image captions are context for these clusters, not separate
defects. This is a privacy-preserving product paraphrase, not a verbatim transcript
or independent visual confirmation. Unspecified details remain open rather than
being inferred as implemented behavior.

## Deduplication And Source Boundaries

D-316 already delivered the full-card contact action. Current
[UserProfileOverlay](../../artifacts/kub/src/components/profile/UserProfileOverlay.tsx#L137)
loads contacts only for the full tier;
[MemberCard](../../artifacts/kub/src/components/chat/MemberCard.tsx#L329)
draws the add action when contact props exist. Reconcile the actual entry/build
with that accepted fix before reopening it; compact-to-full reachability and
older installed bundles are different boundaries. Item 36 owns the follow-up.

Item 15 / D-082 concern emoji picker capacity/touch targets, and item 24 concerns
later paid visual extras. Neither is the requested ordinary message-emoji sizing.
The current [text renderer](../../artifacts/kub/src/components/chat/MessageBubble.tsx#L1743)
is a starting surface, not a measured jumbo-emoji cause or the tester's artifact.

D-169 repaired vocabulary for a pre-existing `channel` type; it did not supply
a complete broadcast creation/author-eligibility contract. The current
[group creation UI](../../artifacts/kub/src/components/sidebar/NewGroupModal.tsx#L85)
creates the group workflow. Do not infer publisher-only authorization from a
channel label, hide the composer as the only enforcement, or reuse the old
historical policy description as a fresh production SQL measurement.

The current [shared vocabulary](../../artifacts/kub/src/lib/chatVocabulary.ts#L109)
still calls the heavy object Server. The
[micro-group surface](../../artifacts/kub/src/components/chat/MicroGroupSection.tsx#L115)
already uses Group chat. The new owner direction intentionally supersedes the
September 20/30 heavy Server decision in item 45; it is not a new entity type.
Keep `group`, `dm_group`, `channel`, RPC names, tables, routes, storage paths and
other internal contracts intact. Infrastructure servers, channel categories and
notification grouping are not this rename's targets.

## Handoff And Validation

Three new queue items **79-81**, two new register entries **D-340/D-341**; existing
**36/D-316** receives the deduplicated follow-up. Existing 76/D-335, 77 and 53 are
not duplicated or closed by this new intake. All requests remain open.

Reader syntax, strict timestamp/bounds/read-only assertions, document relative
links, unique queue/defect IDs and focused whitespace/diff checks are verified.
No application suite or device check is claimed for documentation-only intake.
No message, SQL mutation, provider upload/send, app edit, device action, commit,
push or deployment. D-338 work and lifecycle/native HOLDs remain unchanged.

See [tracker](../PRODUCTION_PRIORITY_TRACKER.md) and
[defect register](../INTERFACE_DEFECT_REGISTER.md).
