# LETSCUBE Project Handoff For Claude

Last updated: 2026-09-01 (Europe/Moscow), revised the same day after an
independent verification pass against the live checkout.

This file is the current operational handoff for Claude. Read it before changing
code, infrastructure, database objects, release metadata, or product copy.

## 1. Current Stop Point

The user explicitly paused implementation so the current context could be written
down. Do not silently skip ahead or repeat already completed work.

**Task 2 is complete and independently approved (2026-09-01).** Two independent
reviews of `3990715..0e406a3` both returned APPROVED with no P0/P1. Every
required contract was mutation-tested: moving the configuration gate ahead of
the public routes, widening `isPublicRoute` to prefix matching, dropping a route
from the public set and forcing `isSupabaseConfigured()` to `true` all turn the
suite red. Their ten robustness findings and two wrong documentation statements
are resolved in `f4ab801`. Evidence:
`.superpowers/sdd/2026-08-30-public-home-downloads-changelog/task-2-review-report.md`.

**Current task: Task 3 — sanitized real-interface product assets.** See section
4 and `task-3-brief.md`. Then Task 4 (final UI), then Task 5 (validation and
deploy).

**Queued next, after Task 5 closes: the interface audit and polish stage.** The
user requested it on 2026-09-01 and explicitly scheduled it after the current
plan, so do not interleave it. Its approved scope and ordering are queue item 18
of `docs/PRODUCTION_PRIORITY_TRACKER.md`. Two halves, kept separate on purpose:

1. Audit first, then fix. Enumerate the accumulated visual defects with a
   reproduction, screenshot and severity across the five release viewports, both
   themes and all three shells, then fix in scoped batches with regression tests.
   A change without a recorded defect or an explicit design decision is out of
   scope; do not polish by eye.
2. Execute the already approved
   `docs/superpowers/plans/2026-08-30-shared-motion-feedback.md` for the response
   and action animations. It is 5 tasks and 33 steps, none started. Do not build
   a second animation system beside it.

Write that stage's detailed task-by-task plan when it starts, not before.

The follow-up left outside Task 2 is **closed as of 2026-09-06**, and not by
the means this note predicted. It said `isSupabaseConfigured()` had no direct
coverage — mutating its `&&` to `||` kept the whole suite green while a
half-configured build (URL present, key missing, a realistic Coolify
misconfiguration) would enter `AppRoutes` and throw at `createClient()` instead
of rendering the configuration screen — and that closing it needed a third
dev-server variant.

It needed no server at all. The check was untestable rather than untested:
`client.ts` reads `import.meta.env` at load and imports supabase-js, neither of
which a `node --test` process has. The decision is pure, so it moved to
`artifacts/kub/src/lib/supabase/config.ts`, which imports nothing;
`tests/unit/supabase-config.test.mjs` pins both operators — the `&&` for "both
halves present" and the `||` that prefers the publishable key name while the
legacy one still works — including empty-string values, which is the shape a
deployment actually fails on. Four mutations turn it red, among them the exact
one this note named.

The general lesson is worth more than the fix: a check that cannot be reached
from a test is not a gap in the suite, it is a gap in the module boundary, and
moving the decision is usually cheaper than building a harness around it.

The bot track is not the current work. Bot Platform v1 is implemented, migrated,
deployed and production-canary verified; see section 6 and
`docs/operations/bot-gateway.md`. Creation admission was widened to general
availability on 2026-09-02 at the owner's instruction: the canary cohort is
retired in code rather than enlarged, `BOT_CREATION_ENABLED` is now a kill
switch, and `letscube-bot-gateway` runs `935a670`. Note that this application is
the only one of five with Coolify auto-deploy disabled, so it does not follow a
push and has to be deployed deliberately. The
public home/downloads/changelog stage is the correct next step, exactly as
sequenced in the approved design.

## 2. Authoritative Checkout And Git State

- Main repository: `D:\CodexProjects\LetsCube-Chat`
- Current isolated worktree: `D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform`
- Current branch: `codex/bot-platform`
- Remote: `https://github.com/ALTIS13/LetsCube-Chat.git`
- Implementation baseline before this handoff commit:
  `aeaaace9efd0c5dfed5542d2ffca8a3a681e0152`
- Working tree: clean
- Branch: ahead of `origin/codex/bot-platform`, all commits intentionally
  unpushed. Read the live count rather than trusting a number written here:
  `git rev-list --left-right --count origin/codex/bot-platform...HEAD`

The task environment may still display the removed/stale desktop path
`C:\Users\maksi\Desktop\kub-messenger-clean`. Do not use it as the authoritative
checkout. Always verify `git rev-parse --show-toplevel`, branch, status, and remote
before editing.

**`main` was fast-forwarded to `5fcc6dd` and deployed on 2026-09-05**, on the
owner's explicit instruction, after the whole set was validated at that exact
commit. This paragraph replaced one saying the commits were intentionally
unpushed; anything left elsewhere in this file that still says so describes the
state before that date.

Deployment baseline:

- `main` and `codex/bot-platform` are both at `5fcc6dd`.
- `letscube-web` runs image `l64kyyu1sysev2izzjjbizhe:5fcc6ddd5529…` — verified
  by reading the running container's tag, not by trusting the webhook. It passed
  its healthcheck and replaced the previous replica; one replica runs.
- Verified live at `https://app.letscube.ru`: 200, and the served stylesheet
  carries `--kub-raise-veil`, nineteen `backdrop-filter` declarations and the
  moved light ground — so the change reached the reader, not only the build.
- Gates at that commit: typecheck of both packages clean, unit suite 1304/1304,
  production build clean, mounted routing matrix 15/15.
- Rollback is a fast-forward of `main` back to `7b95021`.

Two production database repairs were applied the same day, each with a verified
schema backup taken first and each with a self-check that raises rather than
reporting success on a half-applied state. Both are recorded in
`.migration-backup/supabase/migrations/`:

- `20260905140000_bot_avatar_policy_repair.sql` — every client upload had been
  failing since 2026-09-04T14:54Z with "permission denied for function
  _kub_bot_avatar_path_allowed". The bot-avatar migration created four
  `storage.objects` policies calling that function and revoked its EXECUTE from
  `public` and `anon` without granting it to anyone; `authenticated` held it by
  inheritance from PUBLIC and lost it too. Message media, avatars and TUS
  uploads all fell over, none of which involves a bot.
- `20260905150000_media_path_uuid_pattern_repair.sql` — `_kub_media_path_allowed`
  carried a UUID pattern of 8-4-4-12 where a UUID is 8-4-4-4-12, so the two
  branches it guards (a chat's avatar, an administrator replacing someone's
  picture) had never been reachable. It predates the outage above and was hidden
  by it.

Both were read off production before being written, and one report that
identified the first was wrong on two details that would have caused harm if
taken on trust: the live UUID pattern in the bot function was already correct,
and the first apply attempt had to be repeated as `supabase_admin` because
`postgres` does not own that function. Verify against the database, not against
a description of it.

Two more production database changes were applied on 2026-09-11, on the owner's
approval, each with a verified schema backup taken first, each one transaction
with a self-check that raises rather than committing a half-applied state, and
each recorded byte-identical in `.migration-backup/supabase/migrations/`:

- `20260911120000_private_chat_owner_delete_repair.sql` (`7c6482f`) — whoever
  opens a private chat becomes its owner, and `Chat owners delete chat` let an
  owner delete any chat they own, so either participant could delete a private
  conversation, messages and media included, for both sides by calling the API
  directly; the interface only offers hiding it for yourself. 24 private chats
  carried such an owner row. The policy now requires `type <> 'private'`. No
  rehearsal database with this schema exists, so the before/after proof was
  taken read-only on production: `EXPLAIN` without `ANALYZE`, inside a read-only
  transaction, shows the RLS filter a DELETE would get without running it.
- `20260911130000_revoke_unfiltered_table_privileges.sql` (`dc0d39c`) — `anon`
  and `authenticated` held TRUNCATE, TRIGGER and REFERENCES, which RLS never
  filters, on 36 tables in `public`, and the default privileges re-granted them
  on every new table. Not reachable through PostgREST or pg_graphql, so
  hardening rather than a live hole; every row-filtered grant was checked
  unchanged afterwards.

A read-only security audit taken alongside found RLS on 61 of 61 tables in
`public`, no view readable without `security_invoker`, and every "block banned"
policy restrictive. Backups, hashes and measurements are in the tracker under
Priority 2; the rollback for the second change is listed in its own header.

Never push directly to `main` without complete validation, and check what else
is in `HEAD` before pushing it — pushing `HEAD:main` without reading the log
once carried three other agents' unreviewed commits into `main` in this project.

Interface material: the product's surfaces were rebuilt as one translucent
material during this stage. The contract, and the fourteen rules behind it —
eight of which were learned by breaking something — are in
`docs/operations/interface-material.md`. Read it before touching a surface.

## 3. Sources Of Truth

Read these files before continuing:

1. `docs/PRODUCTION_PRIORITY_TRACKER.md`
2. `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`
3. `docs/superpowers/plans/2026-08-30-public-home-downloads-changelog.md`
4. `docs/superpowers/plans/2026-08-30-bot-platform.md`
5. `docs/QA_RESULTS.md`
6. `docs/operations/bot-gateway.md`

The ignored SDD workspace also contains useful evidence and review reports:

`D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform\.superpowers\sdd\2026-08-30-public-home-downloads-changelog\`

`AGENTS.md` is partially stale. Its security rules remain useful, but its old KUB,
computer-club, temporary-domain, HomeNode, and deployment wording is not current.
Do not reintroduce those user-facing terms or old domains.

## 4. Approved Public Home Plan And Status

### Task 1: release manifest highlights - complete and approved

- Release manifest `schemaVersion` remains `1`.
- Optional `highlights` is backward compatible; absent values parse as `[]`.
- Parser accepts 0-6 highlights; publisher requires 1-6.
- Entries are trimmed and limited to 140 UTF-16 code units.
- `ReleasePlatform` may recognize future `macos`, `ios`, and `web`, but the current
  publisher remains Android/Windows only.
- Legacy release CLI behavior is preserved.
- Production jq/Python parity tests exist and passed with jq 1.7.1.
- `pnpm.cmd release:catalog:test` needs a real jq 1.7.1 for the parity case;
  without one that single test skips and the suite still reports success. Do not
  modify global PATH; point `KUB_JQ_BIN` at a pinned binary instead. A pinned
  `jq-1.7.1` (SHA-256
  `7451fbbf37feffb9bf262bd97c54f0da558c63f0748e64152dd87b0a07b6d6ab`) is kept
  outside the repository at `C:\Users\maksi\.local\bin\jq-1.7.1\jq.exe`.
  Re-verified on 2026-09-01: 34/34 passed with 0 skipped.

### Task 2: public routing foundation - complete and independently approved

Implemented:

- `artifacts/kub/src/lib/publicHomeRouting.ts`
- `artifacts/kub/src/lib/platform/desktop.ts`
- `artifacts/kub/src/lib/publicRoutes.ts`
- routing integration in `artifacts/kub/src/App.tsx`
- minimal `PublicHomePage.tsx` and `DownloadPage.tsx`
- mounted routing coverage in `tests/e2e/public-home-routing.spec.ts`, in two
  matrices: the configured one against the shared server, and an unconfigured
  one that owns port `5188` and starts its own Vite server with every public
  Supabase name stripped from the inherited environment
- near-match negatives in `tests/unit/public-routes.test.mjs`

Current behavior contract:

- Browser guest `/` -> public home.
- Native desktop/mobile shell guest `/` -> `/login`.
- Authenticated user `/` -> messenger.
- Auth callback/error precedence is preserved.
- Exact public routes remain public.
- Protected guest deep links and public-route near matches go to `/login`.
- `isDesktopShell()` detects native shell generally; existing Windows-only
  `isDesktopApp()` and `getDesktopBridge()` semantics remain Windows-only.

No production defect was ever found in this task. The two P2 test gaps raised by
the first review are closed and were proven by mutation, so neither is a source
scan that can stay green while the contract regresses. The unconfigured matrix
refuses a busy port, refuses to run when an env file under `artifacts/kub` could
re-supply configuration, requires the child to announce the port itself before
being trusted, and fails loudly rather than skipping when a prerequisite is
absent.

### Task 3: sanitized real-interface product assets - pending

- Use genuine LETSCUBE interface references with fictional, checked-in data.
- A DEV-only fixture/capture route is allowed.
- Never capture production chats, user data, phone numbers, emails, tokens, or
  private media.
- Produce bounded responsive WebP assets and verify them visually.

### Task 4: final public home UI - pending

- Build the real usable public home, not a generic marketing landing page.
- Theme-aware light/dark presentation; follow system preference.
- Windows and Android are active download platforms.
- macOS and iOS must be shown as `В разработке`; do not invent downloads, App
  Store availability, release dates, or certification claims.
- Include a compact Stable changelog from release metadata.
- Use restrained, polished motion and clear interaction feedback.
- Preserve accessibility, responsive behavior, and exact public-route contracts.

### Task 5: release validation and deploy - pending

- Run complete regression validation.
- Verify live release artifact bytes and SHA values, not only JSON metadata.
- Deploy only after review and validation.
- Perform production visual QA on desktop and mobile viewports.
- Record evidence in the tracker and QA documents.

## 5. Validation Commands For The Current Task

Use PowerShell 7 and `pnpm.cmd`, never `pnpm.ps1`.

Do not start these servers from Git Bash. MSYS rewrites the value of
`BASE_PATH=/` into the Git installation path, Vite then serves under
`/Program Files/Git/`, and every route answers `302`.

Use PowerShell as shown. If a Git Bash invocation is unavoidable, the correct
switch is `MSYS2_ENV_CONV_EXCL=BASE_PATH`, which governs environment-value
conversion. `MSYS_NO_PATHCONV=1` does **not** help here: it governs
command-line argument conversion, and measured on this workstation it left
`BASE_PATH` converted while additionally mangling the script path argument.

For the configured mounted-routing matrix, start Vite explicitly on a dedicated
port with safe fixture values (these are not production credentials):

```powershell
$env:PORT = '5187'
$env:BASE_PATH = '/'
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY = 'playwright-public-fixture'
pnpm.cmd --filter @workspace/kub run dev
```

In another shell:

```powershell
$env:KUB_BASE_URL = 'http://127.0.0.1:5187'
pnpm.cmd exec playwright test tests/e2e/public-home-routing.spec.ts --project=chromium-desktop-1440 --workers=1
node --test tests/unit/public-home-routing.test.mts tests/unit/public-routes.test.mjs tests/unit/distribution-platform.test.mts
pnpm.cmd --filter @workspace/kub run typecheck
cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"
git diff --check
```

The routing unit suite runs on the Node test runner. This repository has no
Vitest dependency and no `artifacts/kub/src/**/*.test.ts` files; an earlier
revision of this section named a Vitest command that cannot execute. Use the
`node --test` command above.

The current configured mounted test previously passed 12/12. A run without a Vite
server produced connection-refused failures; that was test setup, not an app defect.
Stop the temporary server after the test.

For the unconfigured matrix the same Vite command is used on the dedicated port
`5188` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
`VITE_SUPABASE_PUBLISHABLE_KEY` explicitly absent from the environment. No
`.env` file exists under `artifacts/kub`, so the process environment is the only
configuration source and the unconfigured state is reproducible.

Existing build warnings about Vite sourcemaps, mixed Supabase imports, and chunk
size are known warnings, not automatic permission to ignore new errors.

### Running specs that sign in, and the other servers the suite needs

The dev-server command above is for the routing matrix only:
`http://127.0.0.1:54321` is a fixture no QA account exists in. A spec that signs
in needs the real public configuration the deployed bundle carries. Keep it in
files outside the repository and never print it:

    js=$(curl -s https://app.letscube.ru/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
    bundle=$(curl -s "https://app.letscube.ru$js")
    printf '%s' "$bundle" | grep -oE 'https://core\.letscube\.ru' | head -1 > "$CFG/.u"
    printf '%s' "$bundle" | grep -oE 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' | head -1 > "$CFG/.k"

Decode the JWT payload and confirm `role` is `anon`; stop if it is
`service_role`. From Git Bash: `MSYS2_ENV_CONV_EXCL=BASE_PATH PORT=<port>
BASE_PATH=/ VITE_SUPABASE_URL="$(cat "$CFG/.u")"
VITE_SUPABASE_ANON_KEY="$(cat "$CFG/.k")" pnpm.cmd --filter @workspace/kub run dev`.

- Start every Playwright run with `KUB_QA_ALLOW_MUTATIONS=0`. The owner's QA file
  set it to 1 until 2026-09-11, when that line was removed on the owner's
  instruction; the process environment wins over the file, so `0` keeps a flag
  that reappears from turning a check into a production write. A run that has to
  write sets `1` on its own command, for a named spec. A new spec that writes
  asks `qaMutationsAllowed()` from `tests/e2e/helpers/auth.ts`.
- A signed-in spec looks at production screens, and the repository config keeps
  a screenshot, a trace and a video of every failure. Run signed-in specs with a
  configuration that switches all three off: the 2026-09-11 wave used an
  untracked `output/pw-signed-in-no-artifacts.config.ts` (`output/` is ignored)
  that imports `../playwright.config`, resets `testDir` to `../tests/e2e` and
  overrides `use` with `screenshot`, `trace` and `video` set to `"off"`.
- One server per configuration, each on its own port. The bot specs and the
  configured routing matrix need the fixture; `bot-management` also needs
  `VITE_BOT_MANAGEMENT_URL=http://127.0.0.1:54322`. `registration-confirmation`,
  `letscube-brand-auth-layout` and `privacy-support-public` need
  `VITE_AUTH_CAPTCHA_SITE_KEY` (any value) with
  `VITE_AUTH_CAPTCHA_PROVIDER=yandex`; do not put the captcha key on the server
  the signed-in specs use. `auth-yandex-captcha` needs that server too, plus
  `KUB_EXPECT_YANDEX_CAPTCHA=1` on the Playwright command: without it the whole
  spec skips, which is how two of its tests went stale unseen until
  2026-09-11. `ios-standalone-safe-area.spec.ts` and
  `message-meta-spacer-line.spec.ts` need `VITE_PUBLIC_PREVIEW_FIXTURE=1` on a
  fixture server. `pwa-service-worker.spec.ts` needs no server: it builds the
  application itself.
- Port hygiene: check the port is free first (an orphaned Vite answers 200 with
  stale configuration), then confirm `/src/lib/supabase/client.ts` contains the
  expected host. A server that dies mid-run shows up as skips, not failures.
- `cmd | tail` returns `tail`'s exit code: use `set -o pipefail`,
  `${PIPESTATUS[0]}`, or redirect to a file.
- From Git Bash run `node node_modules/@playwright/test/cli.js test …`;
  `pnpm.cmd exec playwright` fails on "C:\Program". A full run from the root
  currently stops at load on `resumable-media-upload.spec.ts`; pass explicit
  files.
- Playwright's "N did not run" is now followed by names, and a run that would
  pass with such tests fails. A `--reporter` given on the command line replaces
  the configured reporters, so name the guard there too:
  `--reporter=list,./tests/e2e/helpers/did-not-run-guard.ts`.
- Build before the unit suite: `tests/unit/public-product-assets.test.mjs`
  refuses a `dist/public` older than its sources.
- `windows:tauri:qa` refuses an unbuilt, unconfigured, loopback or stale
  `artifacts/kub/dist/public`, and the validation build above produces exactly
  such a bundle.

## 6. Completed Production Baseline Not To Rebuild

The project is a production-oriented LETSCUBE messenger with:

- self-hosted Supabase Auth/Postgres/RLS/Realtime/Storage;
- browser application and iPhone/iPad-only PWA policy;
- dedicated Windows Tauri EXE and Android APK delivery;
- notification center grouping/read sync and web/native delivery foundations;
- support ticket workflow and support mail;
- media preview/variant processing and optimized chat media behavior;
- invite-only controls, invitation roles/groups, anti-abuse controls;
- verified-phone search and administrator-restricted phone verification;
- bot platform v1 and production Bot Gateway canary;
- public privacy/support/bot documentation routes;
- Windows update UI, notification routing, and Android release catalog.

Bot Gateway canary is complete. Production app UUID/deployment IDs and exact canary
evidence are documented in `docs/operations/bot-gateway.md` and QA/tracker files.
Do not expose bot tokens, owner IDs, or service credentials in reports.

## 7. Product Ownership And Scope Boundaries

- Visible product name and application label: `LETSCUBE`.
- Remove user-facing `KUB`, `КУБ`, `компьютерный клуб`, `кибер-арена`, and other
  gaming-club positioning unless a specific business/legal context requires it.
- Internal `kub`/`KUB` code, environment, database, and Android identifiers may
  remain when changing them would break contracts.
- Android package ID remains `com.kub.messenger`.
- iPhone/iPad PWA and native iOS work are owned by another agent. Do not modify
  iOS/PWA-specific behavior in this track. Shared contracts and handoff docs are OK.
  **Superseded for the PWA on 2026-09-11:** the owner directed this track to fix
  the installed iPhone app's problems without a device, and no parallel Apple
  track existed on the remote. PWA fixes are in scope here; native iOS is not,
  and anything that needs the device stays recorded as unverified until it is
  checked on one.
- This track owns backend/shared web, Windows, and Android work.
- Browser is the universal fallback. PWA install UI is for iPhone/iPad only.
- Do not restore Electron; Windows uses Tauri and EXE installer distribution.

## 8. Live Infrastructure Map

Use only the service subdomains; the apex `letscube.ru` belongs to another project
and must not be used for this application.

- Web application: `https://app.letscube.ru`
- Coolify: `https://deploy.letscube.ru`
- Public API/release catalog: `https://api.letscube.ru`
- Server SSH host: `ms.letscube.ru`, port `22`
- Server IPv4 previously used: `157.22.206.43` (verify live before use)
- Mail host: `mailserver.letscube.ru`
- Support address: `support@app.letscube.ru`
- Server application root: `/srv/letscube`
- Local SSH key: `C:\Users\maksi\.ssh\letscube_ed25519`

Do not assume live state from this file. Verify DNS, TLS, git revision, Coolify
deployment, container health, disk space, database connectivity, and backups before
any production action. Do not print sensitive environment values while verifying.

Important infrastructure history: Docker's stock subnet conflicted with the
provider gateway. Docker/Coolify must keep the non-conflicting custom address pools
already established on the server; do not reset Docker networking to defaults.

## 9. Secrets And Private Data

Private local material is stored outside the worktree under:

`D:\CodexProjects\LetsCube-Chat\.ops-private\`

Relevant names include `p1sms.txt`, provider API PDFs/scripts, `smsRU.txt`, VAPID
material, Android signing material, migration backup material, and private task
folders. Read only the minimum required file. Never echo values to terminal output,
chat, docs, screenshots, commits, test reports, or client bundles.

Additional rules:

- Never put `service_role` or trusted backend credentials in frontend code.
- Never print or commit FCM registration tokens.
- `android/app/google-services.json` is local-only and ignored; never print or
  commit it.
- Never commit `.env*`, keystores, private keys, signing passwords, provider keys,
  raw push subscriptions, or production database dumps.
- Never log message bodies, phone numbers, emails, or personal media during QA.
- Trusted delivery credentials belong only in backend/Coolify environment storage.
- Do not change Java/JDK/JRE or global PATH.

## 10. Database And Deployment Safety

The user has previously authorized carefully reviewed SQL proposals, but that is not
permission for blind migration. Before any database change:

1. Confirm the exact target database and current schema.
2. Create and verify a fresh backup.
3. Review the migration for additive/idempotent behavior, locks, RLS, grants, and
   rollback implications.
4. Rehearse read-only or against a safe environment when feasible.
5. Apply once, validate data/RLS/application behavior, and record evidence.

Never disable RLS. Never expose `service_role` to frontend/mobile/desktop bundles.
Do not apply unrelated proposals while completing the public-home plan.

Coolify auto-deploy behavior must be verified rather than assumed. Deploy only the
intended revision after tests. Keep browser/PWA, Windows, Android, mail, Supabase,
and Bot Gateway services independently observable.

## 11. Critical Regression Contracts

Every relevant change must preserve:

- Chat entry: no unread -> bottom; unread -> first unread.
- Search and notification jumps land on the exact message.
- History prepend preserves the user's anchor.
- Fast upward scrolling must not snap to bottom or jump to oldest history.
- Notification-center grouping, read sync, and per-chat clearing.
- Browser/PWA push behavior and native notification routing.
- Message sender exclusion, mutes, preferences, and cross-device read sync.
- Android voice, video circle, regular video, camera/photo, and geolocation.
- Browser install CTA hidden inside Android APK.
- LETSCUBE auth branding, centered layout, responsive captcha, and no duplicate logo.
- Support workflows, privacy route, media previews, avatars, and upload progress.
- Windows updater, notification-card routing, grouped toast history, and tray behavior.

## 12. Phone Verification State

- Verification is open to every authenticated account as of 2026-09-02. It had
  been administrator-only since 2026-08-21, closed in three places at once: the
  `isAdmin` guard around `<PhoneSection />`, a blanket administrator check in
  front of every action of the `phone-verification-gateway` Edge Function, and
  `has_permission(..., 'system.manage')` inlined into both database gates.
  Opening any one alone changed nothing, which is why the policy row and the
  earlier "enable for all accounts" migration existed while the feature stayed
  unreachable. Migration `20260902120000_phone_verification_open_to_all_users`
  restored the policy predicate; the gates read
  `phone_verification_available_internal` (policy row, or an unexpired pilot
  entry) again.
- Provider: P1SMS trusted backend integration.
- Current route: Telegram first; message-scoped digital fallback after `agg_error`,
  `not_delivered`, or a terminal provider error.
- Code length: 4 digits.
- Resend cooldown: 120 seconds.
- Do not mention Telegram in user-facing success copy unless product explicitly
  changes that decision.
- Do not alter provider account-wide templates/cascades or other LETSCUBE projects.
- Mandatory verification at registration is **not implemented**. The policy
  column `required_for_created_at_or_after` exists and is read by
  `phone_verification_policy_read`, but nothing enforces it, so setting it would
  change no behaviour. `enforce_data_access` stays `false`; turning it on would
  cut existing unverified accounts off and needs its own rollout plan.
- Delivery cost and abuse are bounded by rate limits, not by the audience:
  120 seconds between sends per claim and per user/phone pair, 5 messages per
  user per hour, 10 per user per day, 5 per phone number per hour, with
  webhook-id idempotency. These are the controls that matter now that every
  account can request a code.
- Search by phone uses only verified normalized E.164 values, requires the proper
  permission, and must not return the phone number itself in search results.

## 13. Native And Packaging Open Items

Windows remaining gates include Authenticode/SmartScreen, killed-process WNS
delivery, Windows 10/11 device matrix, and long-session/offline QA. Existing MSIX/
PWA product identities must not be deleted or remapped casually. EXE installer is
the primary Windows distribution path; sparse identity remains an audited proposal,
not permission for an identity migration.

Android has a strong tested baseline, but broader vendor/device QA and external
release operations remain. Do not perform release signing/AAB publication, deep
links/app links, package-ID changes, or store submission unless explicitly tasked.

Current version numbers in the tracker may change. Read live catalog/manifest data
before claiming a Stable version or publishing an update.

## 14. Working Style For Claude

- Make small, reviewable patches; do not rewrite the project.
- Inspect existing patterns before introducing abstractions or dependencies.
- Use `rg` for targeted searches.
- Use PowerShell 7 and `pnpm.cmd` on Windows.
- Do not use mouse automation or open secrets in editors/screenshots.
- Do not modify unrelated files or revert concurrent user/agent changes.
- Before editing, state the observed root cause and intended scoped patch.
- Add tests proportional to the behavioral risk.
- Validate before committing; review before pushing; deploy only after validation.
- Keep reports in Russian for the user, but code/docs may follow the repository's
  existing language conventions.
- Check `git status` frequently because another Apple-focused agent may create
  external changes. Preserve and coordinate with those changes instead of reverting
  them.

## 15. Production Deployment Path

Deployment is Coolify-webhook driven. GitHub Actions are intentionally disabled
and workflow files were removed; do not reintroduce them.

- Push to GitHub triggers the per-application Coolify webhook.
- `letscube-web` builds the browser application from `artifacts/kub`. Public-home
  work in this plan deploys through this application and no other.
- `letscube-worker` builds `artifacts/api-server`; its `watch_paths` are limited
  to worker/build/runtime paths and shared manifests, so docs-only commits do
  not redeploy it.
- `letscube-bot-gateway` (`twezs89u2m6d6ln6c0rpaqxe`) runs the isolated Bot
  Gateway runtime.
- `letscube-support-mail` runs the non-public support mail bridge.

Ordered rollout for the current track:

1. Finish and review the task in its worktree; keep commits unpushed until the
   scoped review approves them.
2. Push `codex/bot-platform` to its own remote branch first, never straight to
   `main`.
3. Merge to `main` only after typecheck, unit tests, the mounted Playwright
   matrix and the production build have all passed.
4. Pushing `main` triggers the `letscube-web` webhook. Verify the deployment
   reached the exact intended commit, passed its healthcheck and replaced the
   previous replica; auto-deploy behavior must be checked, never assumed.
5. Perform production visual QA on desktop and mobile viewports, then record the
   deployment baseline, commit and evidence in
   `docs/PRODUCTION_PRIORITY_TRACKER.md` and `docs/QA_RESULTS.md`.

Task 5 of the public-home plan additionally requires verifying live release
artifact bytes and SHA values, not only the JSON manifest, before any download
surface is announced as available.

## 16. Local Workstation Environment

Verified on 2026-09-01 on the Windows 11 workstation:

- Node 24.15.0, pnpm 10.33.2, Git 2.54.0, PowerShell 7.6.5, ripgrep 15.1.0,
  cargo 1.97.0, Playwright 1.59.1 with Chromium already installed.
- Pinned `jq-1.7.1` outside the repository; see section 4 for the path and
  `KUB_JQ_BIN`.
- Claude Code session settings live in the ignored worktree file
  `.claude/settings.local.json`. `.claude/` is excluded through
  `.git/info/exclude`, so it never appears in `git status` and does not affect
  the Codex workflow.
- Three stale worktree registrations pointing at removed
  `C:\Users\maksi\Desktop\...` paths were pruned. Branches
  `codex/resumable-media-task-1`, `codex/video-transcode-720p` and
  `codex/video-transcode-frontend` are untouched and still exist.

## 17. Immediate Resume Checklist

```powershell
Set-Location 'D:\CodexProjects\LetsCube-Chat\.worktrees\bot-platform'
git rev-parse --show-toplevel
git status -sb
git remote -v
git log --oneline -12
git rev-list --left-right --count origin/codex/bot-platform...HEAD
```

Then:

1. Read the three current plan/spec/tracker files in section 3.
2. Read `task-3-brief.md` and the Task 3 section of the plan.
3. Implement Task 3: the checked-in fictional fixture, the DEV-only capture
   route behind both `import.meta.env.DEV` and `VITE_PUBLIC_PREVIEW_FIXTURE=1`,
   the capture script, the bounded WebP assets and the asset contract test.
4. Never capture production chats, user data, phone numbers, emails, tokens or
   private media. Compressed-byte string scans are not accepted as proof of
   image privacy; look at the generated pixels and record the sign-off.
5. Run the asset validation, review the diff, then commit.
6. Continue with Task 4 UI, then Task 5 validation and deploy.
7. Only after Task 5 closes, open the interface audit and polish stage from
   queue item 18 of the tracker, and write its plan then.

Do not start a different roadmap item unless the user redirects the work.
