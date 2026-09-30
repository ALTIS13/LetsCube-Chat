# The micro-group — what it asks of the database, and what only the owner can answer — 2026-09-29

> **Decided and applied 2026-09-30, first phase.** The owner: «Микро-группы
> должны входить в общую систему блока пользователя (проверь реализацию
> Discord/Telegram)», and the other questions went to the references
> (`reference-clients.md` §27). Question 1: a block in either direction refuses
> an add, the private chat's other person included. 2: ten, Discord's number.
> 3: any member adds, the crown removes. 4: own messages only, as proposed. 5: the
> ring comes with the calls, in the second phase. 6: no stored name, drawn for
> each reader, and a push titled for each recipient. The value is `dm_group`, not
> `group_chat` as written below: one suffix away from `group` is the hazard item
> 45 warns of. The rollout is `2026-09-30-database-changes.md` §2, and §3 is the
> incident during its rehearsal.

Tracker item 45. The owner has decided that the micro-group is a separate kind of
conversation, a separate `chats.type`, and specified how it is born and what it
looks like. This document is the step before any SQL: everything the database
does today with a chat's type, what a new kind would get from each of those
places if nothing changed, and the answers the kind needs. **Nothing here is
applied, and nothing is written as a migration yet.** Six product questions come
first, because the SQL depends on them. Only one of them is a safety question;
the rest have a recommendation and can be answered «по рекомендации».

## What was measured, read-only on production, 2026-09-29

- `public.chats.type` is `text` with `CHECK (type in ('private','group','channel'))`.
  Rows: 17 `group`, 32 `private`, 0 `channel`.
- `chat_members` has the key `(chat_id, user_id)` and the default replica identity,
  and it is in `supabase_realtime`; so is `chats`.
- **29 functions and 2 policies name a type literal.** Every one was read from its
  live definition (`pg_get_functiondef`) and classified below. Three more take
  the type second-hand (`voice_call_ring`, `voice_call_answer`, `voice_call_stop`),
  and so does one client rule (`lib/voiceRing.ts`, `not_private`).

The name used below for the new value is `group_chat`, after the owner's own
word for the light object, «групповой чат». The heavy object keeps the database
value `group` and becomes «сервер» in the interface. The tracker's sequencing
note stands: the light object should not ship before that rename, or two
different things answer to one word for a while.

## Six questions

**1. Personal blocks inside a micro-group. This is the safety question, and it
is the owner's.** `blocked_from_chat` considers private chats only. It stops a
message and a ring from somebody the recipient has blocked, and `voice_private_room`
and both ring-push functions call it. Left unchanged, a person who has been
blocked could pull their blocker into a micro-group with one tap, then message
them and ring them there. Heavy groups have the same gap today, through a direct
member insert by an administrator; the micro-group turns it into a single gesture
with ringing. **Recommendation:** nobody can add a person to a micro-group if
either of them has blocked the other. The one who presses sees «Нельзя добавить
этого человека» and no reason. Inside a micro-group, a block is honoured the way
it is in a private chat: no ring and no direct message from the blocked person.
Nothing is hidden from the rest of the conversation.

**2. How many people.** Discord caps a group DM. Its bundle checks
`recipients.length + 1 >= cap` in `isPartyFull`, with the cap coming from a
function under a Nitro experiment; that number was not read. **Recommendation:
ten**, ours to choose. A micro-group is small by definition, a cap keeps it from
turning into a server by growth, and the call room's seat count can be that same
number instead of 2.

**3. Who may add after it exists.** **Recommendation:** any member may add, and
only the crown may remove. That keeps the birth gesture available to whoever is
talking, and it keeps removal a deliberate act of the one with full rights.
Discord's rule for this was not read.

**4. Deleting others' messages.** Today only a private chat lets you delete
somebody else's message for everyone. **Recommendation:** the group rule — your
own messages only, the crown included — until somebody asks for more. It is the
stricter of the two, and widening it later costs nothing.

**5. The ring at birth.** The owner's words: the two already talking are brought
into the new group's call, and the added person is rung. **Recommendation:** ring
only the people added, never the ones already in the room; one person answering
stops nobody else's ring; a ring that nobody answers leaves «Пропущенный звонок»
for that person alone, because for the conversation the call went on.

**6. The name.** **Recommendation:** store none. Draw the participants' first
names, as a private chat draws the other person's name, until the crown gives it
a name. One consequence has to be handled: the push title falls back to the
sender's name when `chats.name` is empty, and for a group message it should be
the drawn name instead.

## What each place in the database does with the new kind

«Today» is what `group_chat` would get if the CHECK were widened and nothing else
changed. The last column is the answer, given the recommendations above.

| place | today | answer |
| --- | --- | --- |
| `blocked_from_chat` | ignores blocks | honour them (question 1) |
| `voice_private_room` | refuses: no call and no ring | one call room made on demand, like a private chat's, with seats = the cap (2) instead of 2 |
| `enforce_private_chat_voice_seats` | not held to 2 | hold it at the cap |
| `voice_ring_push_capture` | captures nothing | capture for the people rung, not for everybody but the caller (5) |
| `voice_push_eligible` | nothing eligible | eligible, as a private chat's |
| `voice_rings_sweep_expired` | never swept | swept, with the missed line per person (5) |
| `write_membership_service_message` | no lines | «добавил(а)», «вышел(а)» lines, as in a group |
| `_notify_chat_members_after_insert` | «Вас добавили» to everybody added | the same for a later add; at birth the ring is the notice |
| `enqueue_message_notifications` | right | unchanged |
| `_notification_push_payload` | group style | unchanged, plus the drawn name (6) |
| `delete_messages_for_everyone` | own messages only | unchanged (4) |
| `_audit_messages_admin_delete` | cannot fire | unchanged |
| `enforce_chat_role_scope` | allows roles | refuse, as in a private chat: the crown is the only hierarchy |
| `chat_bot_add`, `chat_bots_available` | refused / empty | unchanged: no bots in a micro-group |
| the other five bot functions | group rules | moot while no bot can be added |
| `global_search`, `global_search_v2` | labelled «Чат», and «Личный чат» when unnamed | «Групповой чат», with the drawn name |
| `group_invite_create`, `group_invite_accept` | refused | unchanged: a micro-group is joined by being added |
| `hide_private_chat` | refused | unchanged: a member leaves, the crown deletes |
| `open_or_create_private_chat`, `open_or_create_bot_chat` | never return one | unchanged, and correct |
| `enqueue_media_variant_job_for_chat` (and the worker's filter) | no avatar thumbnails | as a group |
| policy «Users create chats with self as creator» | a direct insert is allowed | refuse it: a micro-group is born only through the gesture's function |
| policy «Chat owners delete chat» | the crown may delete | unchanged, and say so in the policy by name |

Nothing in the 29 lets a non-member in. Every type shortcut that loosens a check
belongs to private chats, so the new kind gets the stricter branch, and no
membership check depends on the type.

## The change, in outline

One migration, in one transaction with a self-check that raises:

1. Widen the CHECK to four values.
2. Add `micro_group_create(p_private_chat_id uuid, p_user_ids uuid[])`,
   `SECURITY DEFINER`. The caller must be in that private chat, every person
   added must pass the block rule (1), and the total must stay under the cap (2).
   It creates the chat with the caller as owner and the other person from the
   private chat as a member, adds the new people, and returns the id. The client
   then moves the call and rings.
3. Add `micro_group_add(p_chat_id uuid, p_user_ids uuid[])`, callable by any
   member (3), under the same block and cap rules.
4. Re-create the functions in the table's answer column with their current
   signatures, each changed only where the new kind needs it, and narrow the
   INSERT policy.

**Rollback:** re-create the previous definitions from the verified backup and
narrow the CHECK again. The CHECK can only be narrowed while no micro-group
exists; after that, rollback means the interface stops offering the gesture.

**Before it is applied:** a verified backup, a rolled-back rehearsal on
production that creates a micro-group from a private chat of two QA accounts,
adds a third, rings and sweeps, and then an apply followed by the same smoke
check. The same procedure as `2026-09-28-owner-approved-database-changes.md`.

## Around the database

- The rename of the heavy object to «сервер» in the interface. The tracker
  counts 83 user-facing strings in 26 files that say «групп…», with two
  spellings for one object.
- The gesture in a private chat's header, the member list down the right with
  the crown, and the chat-list row marked both «новый» and «звонок идёт» for the
  person added. That row is a state the list does not have today.
- `lib/voiceRing.ts` offers a ring only in a private chat (`not_private`), and
  it needs the new kind.
