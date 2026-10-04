# Group Vocabulary - 2026-10-04

Owner: Codex coordinator. D-341 / tracker item 81. Candidate branch
`codex/bot-inline-media-20261002`, based on checkpoint `e07af4f1`.
Source and fictional browser validation only; not deployed or native-device QA.

## Decision And Scope

The owner's latest direction overrides item 45's earlier heavy-object noun:
heavy `group` objects are **Группа**, ad-hoc `dm_group` conversations remain
**Групповой чат**, and `channel` objects retain **Канал**. This is terminology,
not a claim that broadcast-channel authorization is implemented (item 80).

The shared vocabulary, create/menu/header/profile/settings/member/role/invite
surfaces, bot privacy and moderation/refusal copy now use the group noun and its
Russian cases. Infrastructure/network servers retain their name. Internal
types, identifiers, routes, RPCs, permissions, storage paths and styling are
unchanged. No database change or migration is needed for this patch.

One supporting accessibility fix gives bot sections stable `useId` heading IDs.
The former title-derived IDs contained spaces, so `aria-labelledby` did not
resolve the intended heading. This changes no authority or styling.

## Failure Controls And Verification

- Literal assertions failed against the old application words before the patch;
  the seven affected unit files passed 114/114 after it.
- A further compiled literal test exposed a real gender mismatch in the role
  description. It and the bot privacy sentence were corrected. The final
  focused run passes 122/122, no skips: the original 114 plus eight new controls.
  Five actual compiled mutations are rejected by independent literal oracles.
- `pnpm.cmd --filter @workspace/kub run typecheck`: exit 0.
- Final fixture-only build: exit 0, `sw.js build 1adf8ae9c29c0cef`, `built in 9.14s`.
  Sourcemap and large-chunk warnings remain; this is not a release artifact.
- Fictional loopback backend, external hosts blocked, `KUB_QA_ALLOW_MUTATIONS=0`:
  64/64 creation/card/settings/row-menu checks at 1440 and 390; six additional
  pill/Escape checks pass. The group can still be created without invitees.
- Both steps of creation were rendered and inspected at 1440 and 390, light
  and dark (eight screenshots under ignored `output/new-group/`). Labels fit,
  controls remain reachable, and both themes are actually different.
- The creation spec now passes `theme` directly to `openFixture`; its older
  init script could be overwritten by the fixture's default dark selection.
- An extra desktop-shell check failed after its new group/menu assertions:
  its permission fixture answered a successful empty access snapshot, bypassing
  the legacy permission replies it intended to test. Only this spec now returns
  the existing missing-function reply for that RPC. Positive staff and negative
  ordinary-user checks pass 2/2. Application authority was not changed.
- Independent review found two omitted strings: the public invitation action
  and the bot's empty privacy list. A new fictional spec failed against those
  actual old literals. Both were corrected. An initially broad test selector
  was corrected separately; its strict-mode error was not an application bug.
  Exact region-name checks then exposed the bot heading-ID defect above and
  passed after that fix. The final invitation/bot-empty run passes 8/8 at
  1440/390, light/dark. All eight additional captures were visually inspected;
  labels fit and the narrow bot hint wraps within its container.
- A follow-up review found two consumers of the former title-derived section
  IDs. Both now select exact named regions; the privacy capture also asserts
  exactly one region. The actual old selectors failed to find the elements.
  Four dependent management checks and eight privacy captures pass 12/12;
  loopback/external-host guards and auto-capture disabling were added to those
  specs. This is test compatibility, not a new application authority change.
- Full unit run: 4,948 pass / one fail / 13 existing optional skips, 88.85s.
  The failure is the unchanged Android aggregate-signing guard's 25s Gradle
  subprocess timeout, not a literal mismatch. It remains unresolved; the full
  suite is **not green**. No native release/signing/device publication is claimed.
- `git diff --check`: exit 0. Fresh independent review approves the exact
  46-path source/test scope with no remaining P1/P2. All selected and referenced
  hashes match before/after; the earlier refused receipts are preserved.
  Browser/pixel outcomes are coordinator evidence, not an independent rerun.

## Limits And Next Action

The 92 passing browser cases are synthetic web checks, not installed Windows,
Android, Safari or iPhone PWA acceptance. No paid device minutes were consumed.
The full unit failure must not be hidden by calling focused tests a full pass.

Persist the reviewed exact-byte checkpoint and update D-341's status.
Production publication still needs readiness/backup/rollback and
real runtime evidence. Full restore/R5, D-338/D-342, Android/native release and
whole-chat-media reclamation HOLDs remain unchanged. No production writes,
DDL/restore, media deletion, provider mutation or main-branch push occurred here.
