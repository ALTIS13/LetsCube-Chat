# Bot viewer interface: pause checkpoint

Owner: shared web/backend and Windows/Android chat. Branch `main` at
`e5f8b3f1`; the current feature changes are uncommitted in
`D:\CodexProjects\LetsCube-Chat`. Preserve other owners' files.

Stage: private per-viewer bot panel implementation is present in the working
tree. The migration and rollback passed repeated apply, rollback and SQL smoke
on an isolated restore of the 2026-09-26 backup. SQL was not applied to
production. Bot API focused tests passed 45/45; API and web typechecks and API
build passed. The UI worker reported 39/39 synthetic Playwright cases on
desktop/mobile Chromium and mobile WebKit. An independent rerun was stopped
at 30/39 when the owner requested a pause; that interruption is not a failure.

Blocker: owner is restarting Codex after installing Figma, Mobbin, Rive and
MobileNext plugins. Do not continue tests, builds, commits or deployment until
the owner resumes. Browser fixture server was stopped.

Next: after restart, inspect each plugin's callable capabilities and quota
information read-only before spending paid calls. Then resume the remaining
client verification, review the diff, take a fresh verified production backup,
apply the migration once, deploy web/Bot Gateway/worker, run an isolated QA
canary and update the tracker. Do not touch iPhone PWA-specific layout here.
