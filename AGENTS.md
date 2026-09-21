# Instructions for agents working on LETSCUBE

**Start with `docs/HANDOVER.md`.** It is the current state of the project, what to
do next, and what is waiting on the owner. Then read
`docs/operations/working-lessons.md` before your first command — it is what this
project learned by getting things wrong, and most of it is about tools that report
success while doing nothing. `CLAUDE.md` is the long operational handbook and
applies to you as written; ignore only its references to Claude-specific tooling,
and note that its §1 and §2 are stale and superseded by `docs/HANDOVER.md`.

This file replaces an older `AGENTS.md` that described the product as a
computer-club messenger at a temporary domain. Both were wrong by then.

## The product

**LETSCUBE** — a production messenger at **https://app.letscube.ru**, with a
Windows (Tauri) and an Android (Capacitor) shell over the same web application in
`artifacts/kub`. Backend: self-hosted Supabase at `core.letscube.ru` (Auth,
Postgres, RLS, Realtime, Storage), a worker in `artifacts/api-server`, a Bot
Gateway, LiveKit voice. One host, `ms.letscube.ru`, under Coolify.

Never show a user «KUB», «КУБ», «компьютерный клуб» or «кибер-арена». Internal
`kub` identifiers stay where renaming would break contracts.

## Non-negotiable

- **Never print, commit, screenshot or report a secret** — keys, tokens,
  passwords, `.env*`, keystores, FCM tokens, push subscriptions, database dumps.
  Private material lives in `D:\CodexProjects\LetsCube-Chat\.ops-private\`; read
  only the one file a task needs.
- **`service_role` never reaches a client bundle.** No `SUPABASE_SERVICE_ROLE_KEY`
  in `VITE_*`, in `artifacts/kub`, or in any shell's bundle.
- **Never disable RLS.** Every table in `public` has it.
- **Production database changes follow `CLAUDE.md` §10 without exception**: a
  verified backup first, one transaction, a self-check that raises rather than
  committing a half-applied state, a rollback in the header, and a byte-identical
  copy in `.migration-backup/supabase/migrations/`. Read-only unless a change is
  authorised.
- **Never capture production screens or personal data.** A QA dev server carries
  the production configuration, so a spec that sends a message writes into
  production: every Playwright run takes `KUB_QA_ALLOW_MUTATIONS=0`, and signed-in
  runs switch screenshots, traces and video off. Never log message bodies, phone
  numbers, emails or personal media.
- **The owner's Android devices** carry his personal accounts. Access is
  authorised for measuring reference clients; exposure is not. Measure structure,
  keep nothing that carries content, and never run `uiautomator` inside a
  conversation. Do not install over the release build.
- **Do not change Java/JDK/JRE or the global PATH.** No native release signing,
  publication, package-id change or store submission without the owner's word.
- **Never bare `git stash` / `git stash pop`** — the stack is shared across
  worktrees.

## How to work here

- **Report to the owner in Russian.** Code and documentation follow the
  repository's existing conventions.
- **Adopt the reference clients' mechanics, or better them — never relabel our own
  structure and call it adopted.** Discord is the default; Telegram is the
  reference for chat with media viewing, folders and (contested) bots. Establish
  what a client *actually does*, dated, in `docs/operations/reference-clients.md`;
  a recollection is not a reference. Details: `CLAUDE.md` §7.
- **Decide without asking** on that basis. The authority is the derivation, and it
  stops at production migrations, anything that loses or exposes somebody's data,
  and anything irreversible the owner has not asked for.
- **Look before asserting.** Measure before fixing; reproduce before repairing;
  make a failing case go red against the shipped code before it goes green against
  yours. A number from a probe is not evidence until the probe has been shown to
  match something known to be there.
- **For anything visual**, render the exact element at 1440 and 390, both themes,
  and look at the pixels before reporting. The owner judges literally.
- **Mutation-test** the constants and rules you introduce, with assertions on
  literals — an assertion that reads the constant it mutates cannot fail.
- **Small, reviewable changes.** State the observed cause before the patch; report
  changed files and validation results after it.

## Validating and deploying

The full commands, and the traps in them, are in `CLAUDE.md` §5. The short form:

```
pnpm.cmd --filter @workspace/kub run typecheck
node --test "tests/unit/**/*.test.{mjs,mts,js,ts}"
pnpm.cmd --filter @workspace/api-server run build
node --test $(find tests/server -name "*.test.mjs")
MSYS2_ENV_CONV_EXCL=BASE_PATH PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build
git diff --check
```

Confirm a build ran by its own `sw.js build <id>` and `built in Ns` lines — from
Git Bash the older `cmd /c "set BASE_PATH=/&& …"` form exits 0 having built
nothing.

A push to `main` deploys the web application through Coolify. Before any push:
read `origin/main..HEAD` **as its own step** — other agents may have committed to
the shared branch — and resolve every `@/` import in the commits' own files
against their own tree. After it: verify by the running container's image tag and
a content marker in both directions, never by the webhook. `CLAUDE.md` §15 and
`docs/operations/working-lessons.md` §4 have the method.

Whether you may deploy without asking is the owner's to say; the prompt he starts
you with states it.
