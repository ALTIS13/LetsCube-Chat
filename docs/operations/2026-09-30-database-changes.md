# Database changes of 2026-09-30: the rollout record

The owner, 2026-09-30: «Разрешения выдаю на все нужные действия», with the
open questions of the day's proposals delegated to the reference clients.
CLAUDE.md §10 still governs every change: a fresh verified backup, a
rollback-only rehearsal with a smoke that raises, one apply, a post-apply smoke,
and byte-identical copies in `.migration-backup/supabase/migrations/`.

## 1. Links into a group — D-170

- **Migration** `supabase/migrations/20260930120000_chat_invite_links.sql`
  (SHA-256 `231c490d3beb65a7f4e0dbe5d5ee2322269356322ae04213408135211256d892`),
  rollback `…_chat_invite_links.rollback.sql`
  (`2395e292623573a84c22b9f0e91c97e671435c1249be025d017526e7f54df110`); both
  copied byte-identical into `.migration-backup/`.
- **What it does:** `public.chat_invite_links`, readable only by whoever may
  invite into that chat and written only through its functions;
  `chat_invite_allowed`, exactly `group_invite_create`'s gate;
  `chat_invite_link_create`, `chat_invite_link_revoke`,
  `chat_invite_link_preview`, `chat_invite_link_join`. All refuse an anonymous
  caller; `anon` holds no EXECUTE on any of them. Nothing existing is altered.
- **Backup:** `/srv/letscube/backups/automated/20260930-032513`, `SHA256SUMS`
  15 of 15 OK, `pg_restore --list` on `db/supabase-postgres.custom` reads 160
  table-data entries, and the dump is itself in `SHA256SUMS`.
- **Rehearsal:** the migration without its commit, then two real accounts —
  an administrator and an ordinary one: a group; three links (unlimited, one
  use and named, one hour); a link under a minute refused; the ordinary
  account reading no links and refused a link of its own; the preview as name,
  picture and count, and as `invalid` for an unknown and a malformed token; the
  hour link, moved into the past, `expired` in the preview and refused at the
  join; a join that makes a member and that the group hears; a second join that
  counts no use; the preview for a member; a plain member reading no links and
  refused a revoke; the one-use link used, left, and `used_up`; the
  administrator reading exactly one use on each link and revoking; the revoked
  link naming nothing and refusing; an anonymous caller refused — then
  `ROLLBACK`. The first attempt stopped at its own first step: the smoke made its
  group with `insert … returning` as the administrator, which the `chats` SELECT
  policy refuses until the AFTER trigger has made the creator a member — the
  reason the client inserts without `returning`. Nothing had been committed
  (read back: no table, no functions); the group is made as the database owner
  now and the trigger still makes its owner. The second run passed.
- **Applied** as `postgres`: the table, four link functions and two policies
  read back; `anon` has no EXECUTE on `chat_invite_link_join`, `authenticated`
  has.
- **Post-apply smoke:** the same smoke in a rolled-back transaction, passed;
  afterwards 0 links and 0 rehearsal chats.
- **Client:** `lib/chatInviteLinks.ts`, `lib/pendingJoin.ts`,
  `components/chat/ChatInviteLinksPanel.tsx`, `pages/JoinPage.tsx`, the
  «Пригласить по ссылке» row in `GroupInviteModal`, and the route in `App.tsx`.

## 2. The group chat (micro-group) — tracker item 45, first phase

- **Migrations.** `supabase/migrations/20260930150000_micro_groups.sql`
  (SHA-256 `d1dca5ccb88010bce99628d548501fd34d159187825898786b30b67ddea238fd`),
  rollback `…_micro_groups.rollback.sql`
  (`54755918d27a9dad9cc5afe52fd41b75ea98c0cb07a9e020220abd22d8a50275`);
  `20260930150100_micro_group_avatar_variants.sql`
  (`94a2b7d5f020d23d4eaae36b8e1681026ab4fac408d2de65083db73b16890a42`),
  rollback `…_micro_group_avatar_variants.rollback.sql`
  (`989b550c2a0663022b6474e1e76100db2de8d0b44c34356f6d14c6157994b48b`). All four
  copied byte-identical into `.migration-backup/`. The second is separate because
  `private.enqueue_media_variant_job_for_chat` belongs to `supabase_admin`, and it
  was applied as that role.
- **What it does.** A fourth `chats.type`, `dm_group` — not `group_chat`, which
  would sit one suffix away from the heavy `group`. The CHECK admits it; the
  `chats` INSERT policy refuses it (and `private`) to a direct insert; two
  restrictive policies keep a member from being inserted except through its
  functions and keep anybody from being made an administrator under the crown.
  `users_blocked_either`; `micro_group_drawn_name(chat, viewer)`, which is not
  callable by `authenticated`; `micro_group_create(p_private_chat_id,
  p_user_ids)`, `micro_group_add`, `micro_group_rename`, `micro_group_leave`
  (the crown passes to whoever joined earliest; the last one out takes the chat
  with them). Existing functions changed in one place each:
  `private.enforce_chat_role_scope` refuses roles in the new kind,
  `write_membership_service_message` announces arrivals and departures in it,
  `enqueue_message_notifications` titles a push with the name that recipient
  sees, and the avatar trigger makes small versions of its picture.
  `voice_private_room` still refuses it: the call is the second phase.
- **What the references decided**, read the same night and recorded in
  `reference-clients.md` §27: nobody is brought in across a block in either
  direction, the private chat's other person included (Telegram's
  `messages.addChatUser` documents both refusals); ten people at most
  (Discord's group-DM limit in its shipped bundle); a new group chat is made
  from a private one, which stays as it was (Discord's `_promoteDMToGroupDM`).
  Any member adds and only the crown removes is ours, the proposal's
  recommendation. Several comments in that migration say more than was read:
  that Discord adds only friends to a group DM (an inference from the bundle's
  names, `inviteLinkOnlyUserIds` and `friend_recipient_count`, whose predicate
  was not traced), that in Discord any member adds, any member renames and the
  owner removes, and that Discord draws a group DM's default name from its
  members — none of which was read. The file is left as applied, so that it
  stays byte-identical to what ran; `reference-clients.md` §27 is the record,
  and the client's comments were corrected to it.
- **Backup:** `/srv/letscube/backups/automated/20260930-035715`, `SHA256SUMS`
  15 of 15 OK, `pg_restore --list` reads 161 table-data entries, one more than
  §1's because `chat_invite_links` now exists.
- **Rehearsal**, as `postgres` inside one transaction that rolls back: two QA
  accounts and eight throwaway people made in the transaction, with a throwaway
  registration invitation because registration is by invitation. A private chat
  whose other person blocked its maker cannot become a group; the gesture makes
  a nameless group of the maker with the crown, the other person and the one
  added, leaves the private chat as it was, and announces both arrivals; a
  direct member insert, a direct `dm_group` insert and an administrator under
  the crown are all refused; no call room can be made; a block in either
  direction between the one adding and the one added refuses the add; a member
  without the crown adds, renames, and an empty name gives the drawn one back;
  ten fill it and an eleventh is refused; ten are drawn as three names and «и ещё
  6», and nobody is shown their own name; a notification is titled with what its
  reader sees; the crown leaves and passes to exactly one person; the last one
  out takes the group. The avatar migration's rehearsal ran as `supabase_admin`.
  Three runs failed on the way. The first stopped at `must be owner of function
  enqueue_media_variant_job_for_chat` (hence the second migration), the second
  at its own self-check, and the third at `invite_required` for the throwaway
  people (hence their invitation). The first two, and a debug run between them
  and the third, carried the stray `ROLLBACK` of §3, and each of those left the
  notification function behind.
- **Applied** at 00:57:49Z: the main migration as `postgres`, the small one as
  `supabase_admin`, each one transaction with its self-check.
- **Post-apply smoke:** the same smoke in a rolled-back transaction, passed.
  Afterwards 0 group chats, 0 rehearsal accounts, 0 rehearsal invitations; the
  notification function names the helper and the helper exists.
- **Client:** `lib/microGroup.ts`, `components/chat/MicroGroupPeopleModal.tsx`,
  `components/chat/MicroGroupSection.tsx`, the add-people gesture in
  `ChatHeader.tsx`, the card in `ChatInfoPanel.tsx`, the row and its menu in
  `ChatListItem.tsx` and `ChatList.tsx`, and the new kind in `chatDisplay.ts`,
  `chatKind.ts`, `groupReadReceipts.ts`, `profileMutualChats.ts`,
  `profileChatContext.ts`. The media worker's backfill takes the new kind
  (`mediaVariantsWorker.ts`). With it, the heavy group is called «сервер»
  everywhere in the interface, which the owner asked for on 2026-09-20 so that
  one word would not name two things.

## 3. Incident: the notification trigger replaced outside the rehearsal

- **What happened.** For 2 minutes 16 seconds, 00:52:24Z–00:54:40Z
  (03:52–03:54 Moscow time), production's `public.enqueue_message_notifications`
  was the migration's new version, which calls `public.micro_group_drawn_name` —
  a function that did not exist yet. Any message written in that window would
  have failed.
- **Why.** The live definitions were dumped with `begin read only; select
  pg_get_functiondef(…); rollback;`. psql prints the command tag `ROLLBACK` at the
  end of its output, and it stayed at the end of one definition's file. Assembled
  into the migration, it became a real `ROLLBACK;` between two `CREATE
  FUNCTION`s: the rehearsal's transaction ended there and the next statement
  committed on its own. `ON_ERROR_STOP` does not help — the statement succeeds.
  Three runs re-created the function (00:52:24Z, 00:53:26Z and a debug run at
  00:53:39Z); each stopped at a later error.
- **How it was found:** a `ROLLBACK` tag in the middle of the debug run's output,
  not an alert.
- **Restored** at 00:54:40Z from the definition read off production before the
  work, in its own transaction with a check that raises. The md5 of
  `pg_get_functiondef` afterwards equals that of the pre-work read,
  `00060a1b7beb90e9dc0df2b726ad1c59`.
- **Effect: none measured.** Kong's access log for 00:51:30–00:55:30Z holds 523
  requests, none with a status of 400 or above, and none writing a message;
  `cron.job_run_details` has 24 runs in 00:52–00:55, all succeeded; no message
  was created in the window (the last before it was at 18:41:57Z the evening
  before). A first check of `docker logs supabase-db` for the helper's name
  returned 0 and was **not** evidence: that log did not show even the debug
  run's own three errors naming it.
- **What prevents it now.** Every assembled migration and rehearsal file goes
  through a guard that requires exactly one top-level `begin` first and one
  `commit` last, outside dollar-quotes and comments; given a reproduction of the
  stray line, it refuses it. Dumps are stripped of psql's command tags, and each
  definition has to end with its own dollar-quote. The lesson is in
  `working-lessons.md` §5.

## 4. A conversation keeps its kind — a hole found while reading the group chat's powers

- **Found.** Reading which «admins manage» policies a group chat's crown falls
  under, `chats` turned out to be updatable as a whole: `authenticated` holds
  UPDATE on the table, `type` included, and «Chat admins update chat» admits an
  owner. Whoever opens a private chat is its owner. **Measured**, in a
  rolled-back transaction impersonating a private chat's opener: a control that
  changed the description wrote one row, and `update public.chats set type =
  'group'` wrote one row too.
- **What it opened**, through the API only: a person who has been blocked, and
  who opened the private chat, could make it a group and go on writing, because
  `blocked_from_chat` looks at private chats only; the opener could then delete
  the conversation for both sides, which `20260911120000` had closed for private
  chats; and a group chat's crown could make it a server.
- **Migration** `supabase/migrations/20260930170000_a_chat_keeps_its_kind.sql`
  (SHA-256 `e1bf4a2e8e84f0509ea54c7f61479e0f323db86603b24d6f0db14c628aa80315`),
  rollback `…_a_chat_keeps_its_kind.rollback.sql`
  (`7119bc869cde29ec15341c0df2f1dc25498a07a899760b439e7e5b0f87b3bde3`), both
  copied byte-identical into `.migration-backup/`. A `BEFORE UPDATE` trigger on
  `chats` refuses any change of `type`, `created_by` or `created_at`, for every
  role. Nothing legitimate changes them: no function does, and the client writes
  only the name, the description, the picture, the invitation policy and
  `updated_at`. A trigger rather than column grants, because a column REVOKE
  cannot cut a table-level grant.
- **Backup:** `/srv/letscube/backups/automated/20260930-050124`, `SHA256SUMS` 15
  of 15 OK, 161 table-data entries.
- **Rehearsal**, rolled back, as the owner of a throwaway private chat, server
  and group chat: the controls still write (a description; a server's name and
  invitation policy; its unchanged type; a group chat's rename through its
  function); every change of kind is refused — a private chat to a server, a
  group chat or a channel, a group chat to a server, a server to a private chat
  — and so is rewriting the creator; the opener's delete of the private chat
  still removes nothing; the database owner is held too. **The same smoke run
  without the migration fails on «a private chat became group»**, so it tests
  the defect it is named after.
- **Applied** at 02:01:49Z as `postgres`; the post-apply smoke passed in a
  rolled-back transaction; the trigger is enabled; the kinds on production are
  as they were, 17 servers and 32 private chats.
- **Still open**, for the group chat's second phase: its crown is
  `is_chat_admin`, so the «admins manage» policies on `voice_channels`, `topics`
  and `chat_channel_categories` let it make a server's furniture in a group chat
  directly. That is the specification being bypassed rather than anybody's data,
  and it closes with the calls.

## 5. The group chat's call — tracker item 45, second phase

- **Migration** `supabase/migrations/20260930190000_group_chat_calls.sql`
  (SHA-256 `44689d120ca5b9a2300b857be8db4baab924485918bef3af427b2d39abff7e22`),
  rollback `…_group_chat_calls.rollback.sql`
  (`90c04024b3b0f2d8f957e1ef1c2db17d0210d38242121f8f8c2b5b8f5cde26d7`), both
  copied byte-identical into `.migration-backup/`. Applied as `supabase_admin`,
  because its triggers go on `voice_channels` and `voice_participants`.
- **What it does.** A group chat has one room of ten seats (`voice_group_room`),
  and its call lives on that row: `call_started_at`, `call_started_by`,
  `call_message_id`, and `call_ringing`, `{person: when their ring began}` —
  Discord's `ongoingRings`. `voice_group_call_start` writes the call's one
  message and rings everybody else except across a block; taking a seat stops
  that person's ring and adds them to the message's participants
  (`trg_voice_group_call_joined`); the last one out writes the end and the length
  (`trg_voice_group_call_count_changed`); `voice_group_call_decline` stops one's
  own ring. `micro_group_create`, when the two were talking in the private chat,
  writes that call down there, starts the group's call ringing only the people
  added, and points the private room at the group's (`call_moved_to`);
  `micro_group_add` rings the people added during a call. Restrictive policies
  keep a group chat's crown from making rooms, topics or channel categories
  directly — §4's open point. `voice_group_calls_sweep` runs every minute
  (`letscube-voice-group-call-sweep`): rings older than 45 seconds, a call nobody
  ever sat in, and moves older than two minutes.
- **Backup:** `/srv/letscube/backups/automated/20260930-054131`, `SHA256SUMS` 15
  of 15 OK, 161 table-data entries.
- **Rehearsal**, as `supabase_admin`, rolled back, with the two QA accounts and
  four throwaway people: a start rings the others and not the caller nor somebody
  who blocked the caller, and a second start finds the running call; a decline
  stops one ring and a second finds none; two seats make two participants, a
  repeated seat counts once, one leaving keeps the call and the last leaving ends
  it with «Звонок» and a length; a seat taken with no call opens a quiet one that
  ends «Звонок без ответа»; the crown's direct room, widening, deletion, topic
  and category are refused while the same owner still furnishes a server; a
  private chat cannot start a group call; somebody added during a call is rung;
  the sweep ends a call nobody sat in; and a group chat born from a call writes
  the private call down as answered, rings the person added and not the two
  talking, points the private room at the group's, and forgets that pointer when
  a new call starts there. **Four mutants of the migration each failed the smoke
  on the check named after them**: an add that rings nobody, a ring set that
  ignores blocks, an open insert policy for the crown's rooms, and a move that is
  never forgotten.
- **Applied** at 02:41:56Z; the post-apply smoke passed in a rolled-back
  transaction. Afterwards: the six columns, the two triggers enabled, the sweep's
  job active, no call and no move on any room, and no group chat yet.
- **Client:** `lib/groupCall.ts`, `hooks/useGroupCalls.ts`, the band in
  `VoiceCallRing.tsx`, the control in `ChatHeader.tsx`, the record in
  `MessageList.tsx`, the list line in `messagePreview.ts`, and the reader in
  `useVoicePresence.ts`, which hands group rows over before the private rings.
