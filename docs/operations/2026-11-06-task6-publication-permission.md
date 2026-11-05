# Task6: Text Publication Permission

Owner: Codex, LETSCUBE stream 6 / item 80. Checkpoint: 2026-11-06 MSK.
**Broadcast composer and forwarding targets are verified in source and
fictional Chromium. Staged SQL is unchanged and not applied.** Next:
isolated real PG17/PostgREST/Auth/Realtime and bot-gateway acceptance.
Production usage was zero at the prior read-only check. No shared
documentation, Task5, or release change.

## Broadcast UX

- Only a known `chats.type='channel'` uses the publication check. The
  [composer](../../artifacts/kub/src/components/chat/ChatWindow.tsx) waits
  for the account's own membership, mounts the standard composer for
  confirmed `owner`/`admin`, and shows «Только чтение» to a reader.
  Confirmation failure shows Retry. The read-only view does not start
  composer, reply, edit, retry or drop actions. Existing typed drafts
  survive temporary loss of the composer; a held forward can be canceled.
- The [forward picker](../../artifacts/kub/src/components/chat/ForwardModal.tsx)
  checks only broadcast candidates, in one scoped query. It does not offer
  a channel while checking or if publication is unavailable, and rechecks
  the current snapshot on pick. The destination composer checks again
  before it can send. Search, ordering and ordinary Group/topic/DM behavior
  are unchanged. Forwarding **out of** a readable channel remains possible.
- The [scoped hook](../../artifacts/kub/src/hooks/useBroadcastPublication.ts)
  reuses the typed `ChatMemberRole`, existing Supabase session/store epoch
  and `subscribeByTable`; no new RPC or global role mapping. Only the
  scoped own `chat_members` GET can grant the UX affordance. Cached chat
  roles and Realtime payloads cannot grant it. A relevant role event,
  disconnect, return to foreground or offline/online transition retires
  the old answer. Request generation and account/scope identity keep a
  late or mismatched result from reopening publication. Ordinary
  read-receipt UPDATEs of the same role do not cause another read.
- A missing/failed live feed fails closed for this UX. A silent event
  delivery failure has not been ruled out; server SQL remains authoritative
  and the client does not replace its authorization. No changes to Auth,
  FileMessageRow, Storage, outbox persistence or the reviewed SQL.

Reference: [Telegram subscriber screen](https://refero.design/screens/972ecdcf-cc13-43f8-a5e3-7d8f4c6a92e2)
has no composer, while [the publisher screen](https://refero.design/screens/b123bfed-76d3-41b8-b267-aa8a0efba994)
retains one. This slice preserves the existing LETSCUBE dock and modal;
it does not add or move notification controls.

**Verification.** The [focused spec](../../tests/e2e/task6-broadcast-publication.spec.ts)
failed twice on the old UI: a composer and a forward target both appeared
before membership verification. The isolated Chromium fixture then passed
8/8 at 1440/390, light/dark: held reads, role change overtaking an old read,
draft restore, socket outage and rejoin, wrong-account answer and Retry,
picker filtering and demotion across selection. No message INSERT or
forward RPC was issued by these eight cases. Both compiled mutations
(`reader-publisher`, `keep-stale-publisher`) were rejected by the browser
assertions. The existing ordinary forward/group/topic/DM cases passed
10/10 at 1440; TypeScript and diff checks passed.

Fixture-only captures under ignored `output/task6-broadcast-ux` were
inspected in both themes and sizes. The first reader capture exposed the
dock's existing pseudo-element painting above the unpositioned status;
positioning only the new block fixed it without changing global CSS.
All fixture runs used `KUB_QA_ALLOW_MUTATIONS=0`; the focused spec blocks
external HTTP, mocks Realtime, disables automatic captures, and does not use
live accounts. These are browser/source results, not native or production
acceptance.

## Staged Implementation

Production PostgreSQL 17.6 was inspected inside `BEGIN READ ONLY`: **0**
`type='channel'` chats, memberships of any role, messages, or active channels
in the last 30 days. These are aggregates only; no IDs, names, message content
or personal attributes were returned. There is no observed active group-like
contract on this kind to preserve. The [forward SQL](../proposals/2026-11-06-task6-channel-publication.sql)
still takes a bounded table lock and refuses installation if any such chat
now exists, so the decision cannot silently outlive the inventory.

| Write path | Source and production catalog finding |
| --- | --- |
| Ordinary text and attachments | [Outbox INSERT](../../artifacts/kub/src/lib/outbox/appOutbox.ts#L74) targets the same `public.messages` table. Client fallback forward also [inserts directly](../../artifacts/kub/src/hooks/useMessages.ts#L1897). No separate human media message INSERT RPC was found. |
| Privileged forward | [`forward_message`](../../.migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql#L74) inserts under SECURITY DEFINER. It checks source visibility and target membership; a retry can return a previously committed copy without inserting. The guard checks only the actual destination write. |
| Privileged bot text/media | Production catalog: `bot_message_command_internal` reaches `bot_send_message_internal`; inline ingest commit reaches the message command. The final INSERT has `bot_id` and no human sender. Bot membership authorization alone is not human publisher authority. Bot edit/delete commands use UPDATE. |
| System records | Named/link invites, membership notices, call stop/sweep and Group-chat call opening are the other catalog INSERT writers. Sender-less `system` records retain the existing sender guard and RLS; they do not grant user publication. |
| Edits and row relocation | Production grants authenticated UPDATE of `chat_id` and content columns. Existing own-row RLS does not prevent a member from moving a row they own into a channel. The new trigger forbids moves into/out of a channel and authorizes edits against the current membership. Existing tombstone, FK detach and pin operations are not new publications. |

One early row trigger covers ordinary and definer INSERT/UPDATE. A channel
publication requires the JWT subject to be its human sender and a current
`owner` or `admin` member; a bot has no publisher authority. Reads, normal
Group/topic/DM/Group-chat message authority, and existing RLS remain intact.
Only channel publication locks its chat then membership `FOR SHARE NOWAIT`,
so contention is a retryable refusal rather than use of stale authority.
[PostgreSQL trigger ordering](https://www.postgresql.org/docs/17/sql-createtrigger.html)
and [row locking](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE)
are the underlying mechanisms. No storage, upload, media-variant, source or
destination contract was changed.

The [rollback](../proposals/2026-11-06-task6-channel-publication.rollback.sql)
removes only the guard and preserves rows. Both SQL files are single
transactions with raising checks. The candidate refuses permissive RLS
drift and checks the trigger wiring/order, definer ownership, fixed search
path and execution grants. Both files stay in `docs/proposals`, not in a
migration directory or deployment hook.

## Staged Verification And Rollout Gate

- Baseline run with `LETSCUBE_TASK6_STAGE_BASELINE=1`: five required controls
  go RED on actual writes (text, media, definer forward, bot, row relocation).
  The sender-less system control remains green.
- Staged run: **18 passed, 1 historical opt-in RED skipped** in PGlite
  PostgreSQL 18.3. The real outbox confirms owner/admin allow and member read
  with write denial. Real tracked forward SQL confirms destination-only
  authorization, media forwarding, demotion, and existing ACK replay. A
  service-role definer adapter covers the final bot INSERT, not the live
  gateway, bot upload admission, or real Storage.
- Controls include non-channel member/bot writes, author mismatch, system
  spoof, demoted edit, mixed edit/delete denial, deletion and author FK
  detach, rollback preserving an existing row, and exact fixture cleanup.
  Five refusal checks cover usage drift, a new permissive writer, and the
  invoker, INSERT-only, and leaked EXECUTE mutations.
- No production HTTP write or Auth fixture. The optional native
  two-connection lock probe was refused before process start; no probe
  directory was created. Do not infer concurrency, PostgREST/Auth or
  deployed bot-gateway acceptance from PGlite.

**Hold production rollout and channel activation.** The ordinary Group
creator still creates `type='group'`. The source UX gate above is verified
against a fictional backend; the real membership subscription and write
path remain open. No separate kind is required by the observed zero usage;
new nonzero usage requires review. Before any authorized live apply,
rehearse with real PG17/PostgREST/Auth/Realtime and the bot gateway in an
isolated environment, verify lock contention/retry, obtain a verified
before-backup, and promote the exact reviewed SQL with its mirror and
rollback. No production mutation, migration registration, or deploy here.

## Original RED Rehearsal

Scope: text publication on one broadcast `channel` object, not a Group text
topic or a Group chat. This was the pre-implementation checkpoint.

### Baseline Source

- The [Task6 plan](../superpowers/plans/2026-10-18-production-completion.md#task6-groups-publication-and-bots-1943--4880--81)
  requires publisher allow and reader deny. [D-169](../INTERFACE_DEFECT_REGISTER.md#d-169-x-a-channel-is-shown-as-a-group-with-a-участники-tab-and-a-groups-title)
  and the [Group vocabulary evidence](2026-10-04-group-vocabulary.md) cover
  naming, not publishing permission. No matching accepted allow/deny pair
  was found; those checks were not rerun.
- [Group creation](../../artifacts/kub/src/lib/chatCreation.ts#L111) creates
  `type='group'`. The [text outbox](../../artifacts/kub/src/lib/outbox/appOutbox.ts#L74)
  uses `POST /rest/v1/messages` with representation readback. No distinct
  broadcast publication command was found on this path.
- The [message INSERT policy](../../.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql#L760)
  checks sender identity, null bot sender and `is_chat_member(chat_id)`.
  The [membership helper](../../.migration-backup/supabase/migrations/20260504_chats_membership_hardening.sql#L221)
  checks existence, not the member's role or the chat type.

### Baseline Runtime And Cleanup

**Production, read-only catalog:** PostgreSQL 17.6 reported
`transaction_read_only=on`, active RLS on the three tables, and
`authenticated` without RLS bypass. Channel membership uses
`owner | admin | member`, not separate publisher and reader roles.
The four effective message INSERT policies for this API role were the
membership policy and the ban, mute and private-block vetoes. None restricts
ordinary posting by channel membership role. The catalog also confirmed that
member insertion can emit `chat_added` and ordinary text can enqueue an
in-app notification for another eligible member; a push mute would not
suppress that in-app write. No application rows, Auth sessions, credentials,
discovery or notification requests were used. No production fixture was created.

**Isolated rehearsal:** The [publication test](../../tests/rehearsal/task6-publication-permission.test.mjs)
loads the real outbox and locked Supabase JS query builder. Its in-process
fetch adapter routes only the fixture's text POST and exact ACK lookup to
PGlite, using the checked INSERT/SELECT predicates and real RLS under the same
`authenticated` DB role with distinct fictional subjects. Membership was
seeded directly in the fixture as `owner` and `member`; no mute, ban or block
was seeded. No listener, external transport, notification hook or live Auth
was used. HTTP statuses below are adapter mappings, not server responses.

| Scenario | Result |
| --- | --- |
| Owner publishes | INSERT accepted (mapped 201); exact row exists and the outbox acknowledges it. |
| Member reads the owner's publication | Exact row visible under member RLS. |
| Same member attempts publication while still a member | INSERT accepted (mapped 201), exact row exists. Expected RLS 42501 / mapped 403; acceptance gate fails. |
| Same subject after exact membership removal | Owner's row no longer visible; INSERT refused by message RLS (42501 / mapped 403), no attempted row. |

The fixture transaction rolled back, counts were verified at zero for chats,
memberships and messages, and the in-memory database closed. Normal run:
three control subtests pass, acceptance gate skipped. With
`LETSCUBE_TASK6_REQUIRE_READER_DENIAL=1`, the same controls pass and the gate
fails at 201 versus 403; Node also marks its parent test failed.

```powershell
node --test tests/rehearsal/task6-publication-permission.test.mjs
$env:LETSCUBE_TASK6_REQUIRE_READER_DENIAL='1'
node --test tests/rehearsal/task6-publication-permission.test.mjs
Remove-Item Env:LETSCUBE_TASK6_REQUIRE_READER_DENIAL
```

**Original blocker:** A reader who is still a member is not a denied
principal on the reproduced write path. Removing or muting the reader would
exercise a different contract. Live execution also lacks a verified
notification-free two-member setup on the supported path. The staged rule
above addresses the authority gap; the rollout gates remain open.
