# Bot callback answers: rollout, 2026-09-26

Owner: shared web/backend. Scope: callback answers only; no new private chat
messages, no change to a bot's group privacy mode.

## State

- `bot_callback_press` returns a UUID. Previously the client interpreted that
  UUID as a successful bot answer and displayed «Готово» even when the bot had
  not answered. The regression test reproduced this before the client edit.
- Migration `20260926150000_bot_callback_answer_for_actor.sql` is applied.
  It reads `private.bot_callback_answers` only through the exact source update,
  verifies the callback UUID, bot, update type and `auth.uid()`, and returns
  `{text, show_alert}` only to the pressing account. Direct `SELECT` stays
  revoked; `anon` cannot execute the RPC. A detached answer returns `null`.
- The client polls that RPC for at most 3.2 seconds. No answer or an older
  server says «Запрос передан боту», not «Готово». The press itself has a
  seven-second deadline and is never automatically retried. Private feedback
  is cleared on account change; separate buttons keep separate feedback.

## Evidence

- Fresh pre-change backup:
  `/srv/letscube/backups/automated/20260926-165147`. `SHA256SUMS` and
  `pg_restore --list` passed. The database and function were checked before
  apply; the function and index were absent.
- Migration source and `.migration-backup` copy have identical SHA-256:
  `b516450df8833ebfbfcee97df0e8617c564469201bd237903beeb5c8830814b0`.
  The server-side file matched that hash before the one-time apply.
- Migration plus focused DB smoke passed in one transaction ending in
  `ROLLBACK`; neither function nor index remained afterward. A mutation
  replacing `SECURITY DEFINER` with `SECURITY INVOKER` made the migration's
  self-check fail as intended. After apply, the DB smoke passed again in a
  rollback, including wrong actor, unknown UUID, duplicate UUID across two
  bots, and source deletion. The live catalog reports definer, empty
  `search_path`, authenticated EXECUTE, anon denied and no direct table read.
- PostgREST returned HTTP 401 for anon and HTTP 200/`null` for an authenticated
  unknown UUID. No user message body or callback token was logged.
- A production canary reused only `qa_photo_*`: cancellation of pending deletion
  left it paused as designed, then a fresh token and resume made it active. The
  QA recipient opened its private chat, received an inline button, pressed it,
  and saw `null` before the bot answered. `getUpdates` delivered that exact
  callback to the bot; `answerCallbackQuery` wrote a unique text and
  `show_alert=true`. The pressing account read both exact values, while the
  separate owner account read `null`. The test message was deleted, the QA
  chat hidden, and the bot returned to `pending_delete` without an active
  token. Langame and other live bot conversations were not touched.
- Commit `ef4aeea1` was pushed to `main`. The web rollover ended with only
  image `l64kyyu1sysev2izzjjbizhe:ef4aeea17b2c75b13fdb3e59c90a9563f24f42b0`
  running. The public entry script returned HTTP 200 and contained
  `bot_callback_answer_for_actor` and the uncertain-press wording; the reader
  name was absent from the preceding commit's source.
- Browser regressions covered delayed answers, alert, older-server fallback,
  account change during both success and failure, two simultaneous buttons
  and a stalled press on desktop and mobile. The full bot surface suite passed
  49 cases (one desktop-only case skipped by design) after the final change.
  Focused unit tests passed 57 cases, workspace typecheck passed, and the
  production web build completed with the project's existing bundle-size and
  source-map warnings.
- The repository-wide unit run had 4160 passing, one skipped, and eight failing
  checks in unchanged notification, push and CSS contract areas. None read the
  callback or feedback files changed here; they remain a separate baseline
  cleanup task, not a green whole-repository gate.

## Remaining limits

- Delivery of a callback answer is best-effort: queue cleanup can delete its
  source update, which makes the private answer deliberately unreadable. The
  client then acknowledges only that the press was sent. There is no private
  message row, persistent answer history, or text field in the bot interface.
- The production canary proves the live API and database path, but not the
  answer's visual presentation on a physical device. Fixture-based desktop
  and mobile browser checks cover that presentation.
- To roll back the new DB reader, use the reviewed rollback SQL in
  `.migration-backup/supabase/migrations/20260926150000_bot_callback_answer_for_actor.rollback.sql`
  after reverting the client. The additive DB function can also remain inert.
