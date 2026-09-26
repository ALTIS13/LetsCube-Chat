# Bot inline input: rollout, 2026-09-26

Owner: shared web/backend. Scope: an optional text field beneath a bot's
existing inline callback buttons. No per-viewer message or callback text
transport was added.

## Contract

- A bot can send `reply_markup.input_field_placeholder` (1-64 characters)
  with its existing `inline_keyboard`. Existing callback buttons are unchanged.
- The field submits a normal user text message with `reply_to_id` set to the
  bot message. In a group that message is visible to participants; the field
  says so. This is not a private callback or an ephemeral response.
- The database extracts the prompt into
  `messages.bot_input_field_placeholder` and leaves the stored
  `bot_reply_markup` in its original one-key form. Installed Android clients
  that do not know the new field therefore keep their buttons.
- The next stage is a private, temporary interface for one viewer. It remains
  open and must use a separate, explicit privacy and lifecycle contract.

## Verification

- Before each production migration, a fresh full backup passed `SHA256SUMS`
  and `pg_restore --list`: `/srv/letscube/backups/automated/20260926-205221`
  and `/srv/letscube/backups/automated/20260926-210649`.
- Both migrations have byte-identical copies and reviewed rollback scripts in
  `.migration-backup/supabase/migrations/`. Their SHA-256 values are
  `36867648B2445B1401D5814BFAFB5378E37D48AB2CFFAC917ABA5E7E46B89A2A`
  and `1C822FC4A2FAF4255D0A579EC11F79ABA70CCBBB00033D311557F85A7B572FE3`.
  They passed rollback-only rehearsal before apply and post-apply SQL smoke.
  The latter verified prompt extraction, legacy keyboard shape, bounds and
  direct-update denial. No existing message rows were rewritten.
- API schema and client parser unit tests passed (56/56); schema-contract and
  migration-inventory tests passed (51/51). Workspace typecheck and production
  build passed. Existing Vite sourcemap and chunk-size warnings remain.
- The fixture browser suite passed on desktop Chromium, mobile Chromium and
  mobile WebKit. It checks private and group input, actual `messages` POST
  payloads, callback preservation and layout placement. The WebKit suite's
  final run passed 27/27; the focused new cases passed 6/6 after the last edit.
- Commit `7d33fabb` is on `main`. The production web and Bot Gateway each run
  a single healthy image tagged with that commit. The public web asset returns
  HTTP 200 and contains the group-visibility copy. The running gateway bundle
  contains `input_field_placeholder`. The worker and support-mail deployments
  also finished healthy after their API-server watch path changed.

## Remaining proof and rollback

- There has not yet been a live bot-send/user-reply canary with the new prompt.
  A fixture POST and a rolled-back production database test are not that proof.
  Do a controlled bot canary without using a user's existing conversation
  before claiming end-to-end acceptance.
- Revert the API/client first if necessary. The additive validator, storage
  column and normalization trigger can stay inert. To remove them, first check
  for stored prompts, then use the reviewed rollback scripts in reverse order.
