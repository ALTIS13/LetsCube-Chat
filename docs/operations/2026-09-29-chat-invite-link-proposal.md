# A link into a group — D-170's last half — 2026-09-29

> **Decided and applied 2026-09-30.** The owner answered question 3 (± Telegram);
> the rest follow Telegram's link editor, read in its source. What was built, and
> the rollout, are in `2026-09-30-database-changes.md` §1 and register D-170.

D-170 in the register has one sentence left open: there is no shareable link or
join code for a conversation anywhere in the product. Reaching somebody whose
name you cannot spell, or a colleague who shares no chat with you yet, needs
that. This document is the step before any SQL. **Nothing here is applied, and
no migration is written.** A link lets people you have not named into a group,
so what it admits, and what a stranger holding it may see, are the owner's
decisions. They come first.

## What exists, read-only on production, 2026-09-29

- `group_invites` is one row per **named** invitee: `inviter_id`, `invitee_id`,
  `status`, `expires_at`. 20 rows in all: 13 accepted, 3 pending, 3 cancelled,
  1 declined.
- `chats.invite_policy` is `owner_admin_only` or `members_can_invite`. All 17
  groups carry the first.
- `registration_invites` already has the shape a link needs — `code`,
  `max_uses`, `uses_count`, `expires_at`, `revoked_at` — but it lets somebody
  **sign up to the product**, and it must not be confused with this. A link into
  a group admits people who already have an account. It does not open
  registration.
- There is no per-group ban. Removing somebody from a group is not a ban.

## The reference

Discord's invite, read in its shipped bundle (the chunks saved under
`output/_discord`, 2026-09-20): an invite carries a `code`, its channel, its
`inviter`, `uses`, `max_uses`, `max_age`, `created_at`, a `temporary` flag
(membership that ends with the session) and `roles` granted on joining.
SHIPPED, as a data model. **The choices its dialog offers for `max_age` and
`max_uses` were not in the saved chunks and were not read.** Telegram's invite
links were not read either. Where a recommendation below names a default, it is
ours, with its reason.

## Five questions, each with a recommendation

**1. Who may make a link.** **Recommendation:** whoever may invite by name, so
the group's own `invite_policy` decides — today the owner and administrators in
all 17 groups. A link is an invitation to anybody who holds it, and it should
never be easier to make than an invitation to one named person.

**2. How long it lives and how often it works.** **Recommendation:** seven days
and no limit on uses by default. The maker can choose one hour, one day, seven
days or no expiry, and one, five, ten or unlimited uses. Any link can be revoked
at once. A link that never expires can be forwarded for ever, so it is a choice
the maker makes on purpose, never the default.

**3. What a person holding the link sees before joining.** This is the
exposure question. **Recommendation:** the group's name, its picture and how
many members it has — nothing else. No member list and no messages before
joining. A link forwarded beyond its intended readers then reveals only that the
group exists.

**4. Who can never use it.** **Recommendation:** an account the product has
banned; anyone once the group is full; nobody without an account (they register
first, through the product's own invitations). A person removed from the group
may come back through a valid link. There is no per-group ban to stop that
today, and adding one is its own decision.

**5. What the group hears.** **Recommendation:** the existing «присоединился(ась)»
line, which the membership trigger already writes for a join. Join requests
that the owner approves one by one are a larger mechanic; if wanted, they come
later.

## The change, in outline

- A table `chat_invite_links`: `id`, `chat_id`, `token_hash`, `created_by`,
  `created_at`, `expires_at`, `max_uses`, `uses`, `revoked_at`. Only the hash of
  the token is stored, and the token is shown once, when the link is made.
  Row-level security lets a group's inviters see and revoke the group's links.
- `SECURITY DEFINER` functions: `chat_invite_link_create`,
  `chat_invite_link_revoke`, `chat_invite_link_preview(token)`, which answers
  only what question 3 allows, and `chat_invite_link_join(token)`, which checks
  expiry, uses, revocation, the product ban and the group's capacity in one
  transaction, adds the member and counts the use.
- The client: «Пригласить по ссылке» in the invitation dialog with the choices
  from question 2, the list of the group's live links with «Отозвать», and a
  route `/join/<token>` that asks for sign-in first, then shows the preview and
  one button.

**Before it is applied:** a verified backup, a rehearsal on production rolled
back — make a link, join through it as a second QA account, run out of uses,
expire, revoke — then the apply and the same smoke. The same procedure as
`2026-09-28-owner-approved-database-changes.md`.
