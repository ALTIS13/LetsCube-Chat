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
