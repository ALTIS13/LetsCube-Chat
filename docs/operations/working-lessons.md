# Working lessons

What this project learned by getting it wrong, written so the next agent does
not pay for it again. Each entry is a rule and the measurement that proved it —
the measurement is the part to keep, because a rule without its reason gets
«simplified» away by the first reader who does not see why it is there.

These were kept, until 2026-09-21, in one agent's private memory outside the
repository. They are here now because an agent that cannot read them will repeat
them. `CLAUDE.md` §5 already carries the ones about starting servers and running
the suites; this file does not repeat those, it points at them.

---

## 1. A number is not evidence that the right question was asked

This is the lesson underneath most of the others, so it comes first.

**An empty result means «unknown», not «no».** In one day six probes answered
confidently about the probe rather than the system. `docker ps | grep web` found
no web container — Coolify names containers by application id
(`l64kyyu1sysev2izzjjbizhe`), not by service. A test renamed under a
`--test-name-pattern` made a mutation run select something else and report the
guard «survived». `grep 'side="top"'` against a file Vite served found 0 because
Vite serves *transformed* JSX (`side: "top"`).

**A plausible number is worse than an empty one**, because nothing about it looks
like a failure. `grep -c $'\r'` in this Git Bash answers the file's line count
whether or not it has a CR byte. `grep -i` does not fold Cyrillic: `смета`
matched 1 line where the truth was 7. Reading a UTF-8 bundle as `latin1` makes
every Cyrillic needle miss.

**How to apply.** Before believing a probe, prove it matches something known to
be there: a control string present in every build, a term that must exist, the
named test run and passing before it is mutated. Make instruments able to say
UNKNOWN. Count Russian text in node with `toLocaleLowerCase("ru-RU")` — which is
also what the product does. Measure line endings in Python on bytes, never with
grep.

**A declaration is not a surface.** A list of options in the source proves
nothing renders it: `SEARCH_FILTERS` (nine entries) had no consumer, while the
identical-looking `SEARCH_SECTION_LABELS` twelve lines above did. Before stating
that the interface offers something, find the consumer — search `'<Name'` with
the angle bracket, follow it to a mount, or look at the pixels.

**A grep can match a comment.** This codebase comments heavily, and a comment is
the densest place for exactly the vocabulary a scan looks for. A search for a
component name returned a file that only *mentioned* it in prose, and a defect
mechanism was built on the wrong container. Strip comments before any
source-scanning assertion (`tests/unit/voice-room-seam.test.mjs` has a `strip()`
helper).

**Verify order by position, not by eye.** A grep listing shows *presence*, and
the eye supplies the order it expected. A patch «moved a row above a heading»
and was reported correct from line numbers 121 and 142 — which said the opposite.
When the change is about order, make the patch script assert
`indexOf(a) < indexOf(b)` and exit non-zero, then confirm with rendered
coordinates.

**A checklist needs the sentence a user would say.** `docs/operations/voice.md`
had seven production checks, all passing, all about signalling and bookkeeping.
Nobody had ever heard anybody: no remote track was ever attached to anything
that could play it. Ask which line of a «proved» list a user would recognise as
the thing they wanted. A stub boundary is also a **coverage** boundary — name
what falls beyond it.

---

## 2. Tests that cannot fail

**A guard failing early hides everything after it.** A test is a sequence, and
everything past the red line is unchecked. Repairing one early assertion in
`ios-standalone-safe-area.spec.ts` let the next line run for the first time, and
it found the entry to a person's own profile sitting under a landscape notch.
When an old test fails, ask what it *stopped checking*, and treat the next
line's first failure as a finding, not as your regression.

**A green mutation may mean redundant, not unreached.** Before blaming the dev
server's watcher, read the DOM the browser actually holds — `className`,
`getComputedStyle`. Stripping a class left a guard green because the property
was *inherited* from an ancestor: the class had never been load-bearing, and the
record calling it necessary was wrong.

**An assertion must not read its own subject.** Several guards this week asserted
against the very constant being mutated, so the mutation changed both sides and
stayed green. Assert on **literals**. Likewise, a test that checks an identifier
(an import line, an event name) outlives the thing it names — test the behaviour.

**A fixed date compared with `now()` is a time bomb.** A fixture pinned to
`2026-09-18T12:00:00Z` went red at 12:02 that day with nothing changed — and
worse, once red it stopped testing its own title, so a real regression produced
the same red line. Pin fixtures relative (`now() - '3 minutes'::interval`).

**Force the mechanism; do not wait for it.** A guard failed once in a full run and
passed eight times alone: the two requests it compared straddled a wall-clock
second one time in a thousand. Repetition was the wrong instrument. Name the
mechanism, switch it on (hold 1.1 s between the requests), and prove the fix
with four runs — forced and unfixed (red), forced and fixed (green), **a real
defect injected into the fixed code (red)**, and a plain run (green). The third
row is the one usually skipped and the one that proves the fix did not blunt
the check.

**A width nothing runs is a width nothing protects.** A viewer-header test was red
only at 360px, for as long as nobody ran 360. The project's viewport matrix is a
habit of four names, encoded nowhere: in the docs 390 is named 38 times and 360
five. The durable fix found: **a guard carries its own widths** rather than
relying on a matrix somebody might run.

---

## 3. Windows, Git Bash and tools that report success

Most of these share one shape: **an exit code of 0 from something that did not do
the work.** Prove a run happened by reading what the program itself printed —
a test count, `built in Ns`, `sw.js build <id>` — never by its exit code.

- **The build command lies.** `cmd /c "set BASE_PATH=/&& … build"` from Git Bash
  exits 0 having built nothing (MSYS rewrites `/`). Use
  `MSYS2_ENV_CONV_EXCL=BASE_PATH PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`.
  Recorded in `CLAUDE.md` §5.
- **`subprocess.run(..., shell=True)` is cmd.exe here.** `VAR=x node …` exits 0
  having run nothing; six mutation cases came back «green» that never executed.
  Pass the command as a list and variables in `env=`.
- **`cmd | tail` returns tail's exit code.** Use `set -o pipefail`,
  `${PIPESTATUS[0]}`, or redirect to a file. A failed production rehearsal was
  reported as `exit=0` this way.
- **The publish script runs on the server.** `scripts/publish-native-release.sh`
  run from Git Bash rewrote `/srv/letscube/...` into a local Windows path,
  «published» there, and printed success. `scp` it to the host and run it there;
  then prove it against the live manifest and the downloaded file's bytes.
- **Python text mode writes CRLF.** `io.open(p, 'w')` rewrites every newline on
  this machine; one scripted edit converted 18 files. Read and write **bytes**:
  `io.open(p,'rb').read().decode('utf-8')` / `io.open(p,'wb').write(s.encode('utf-8'))`.
- **Tool inputs decode escapes, and shells execute backticks.** A `\u00a0` typed
  into a written file arrived as a real no-break space; a `git commit -m "…
  \`draggable\` …"` ran `draggable` as a command and dropped the word. Commit with
  `git commit -F -` and a **quoted** heredoc (`<<'MSG'`); put quote-heavy work in
  script files; check the bytes.
- **Vite's watcher misses scripted bursts.** After a scripted multi-file edit,
  `curl` the dev server for each file and grep a marker of the new code before
  running e2e. Distinct from the `app.store.ts?t=` staleness in `CLAUDE.md` §5.
- **`fonts.check` is not a check.** It answers `true` for a face that never
  loaded. Prove a face by rendered **width** with and without it in the stack.
  (Inter is self-hosted since 2026-09-20 — `/fonts/inter/`, 174 KB — so the
  specific trap is gone, but the instrument lesson stands.)

---

## 4. Deploying and knowing that it landed

**Which commit is running** is answered only by the container's image tag, which
is the full 40-character SHA:

```bash
ssh -i C:/Users/maksi/.ssh/letscube_ed25519 root@ms.letscube.ru \
  'docker ps --format "{{.Image}}" | grep l64kyyu1sysev2izzjjbizhe'
```

Containers are named by Coolify application id: web `l64kyyu1sysev2izzjjbizhe`,
bot gateway `twezs89u2m6d6ln6c0rpaqxe`. A search for «web» finds nothing.

**Whether content changed** is answered by the `sw.js` build id and the entry
chunk hash, which are content-derived and reproducible. But a local build and a
production build of the same commit have **different** ids, because production
bakes in the real `VITE_*` configuration — never carry a local id over as the
thing to wait for on the server. The id is written `const BUILD = {"id":"…"}`,
not `build <id>`.

**Prove a deploy with a content marker in both directions**: absent from the
previous commit's source, present in the new one, present in what the site
serves. Best is a marker that proves a *removal* — no cache can fake an absence
of old code. Watch the spelling: CSS `uppercase` and the build lower-casing hex
both change what the bundle carries.

**Mid-rollover, the page and its assets disagree.** A 144-byte asset is nginx
filler from the old replica, meaning «I cannot see», not «not deployed». Take
the asset URL from the page on every attempt, and keep control strings.

**An SPA answers 200 on every path.** `curl` proves nothing about client-side
routing. To check a route contract, drive a real browser and read
`location.pathname` after the app has booted — and read it *after* it has
settled: a reading taken two seconds after navigation inside a batch once
reported a redirect that had simply not happened yet.

**A failed Coolify deployment row is not a stale application.** Coolify queues a
row for every auto-deploy app on every push and decides inside the clone step
whether to build. Read the running image tag against
`git log <deployed sha>..HEAD -- <that app's watch paths>`. To diagnose a deploy
that never happened, read the log out of `coolify-db`:
`application_deployment_queues.logs` (its stamps are UTC; the host's `date` is
MSK).

**One of GitHub's addresses is unreachable from the host.** `140.82.121.4` times
out; `140.82.121.3` does not. DNS alternates, so a clone hangs ~133 s and fails
about half the time. It has two faces in the log — a failure inside
`check_git_if_build_needed` or a non-zero exit from `git clone`. Re-push or
re-trigger (the deploy token recipe is in `CLAUDE.md` §15); do not re-diagnose.
A self-healing `/etc/hosts` pin with a daily health check is installed at
`/root/github-pin-check.sh`.

**`letscube-web` rebuilds on every push to `main`**, docs included — it has no
`watch_paths`. A docs-only rebuild produces byte-identical assets, so users are
not offered an update.

**Restart, do not `compose up -d`, to make LiveKit re-read its config.** `up -d`
answers «Running» and never re-reads a changed file when the compose file itself
did not change. Verify the container's start time moved.

---

## 5. The database

**`has_table_privilege` lies on column grants.** On `voice_channels` UPDATE is
granted per column, so the table-level answer is `false` by design. This project
drew the wrong conclusion from it four times. Ask `has_column_privilege` per
column and lay it against the client's actual `.update({...})`.

**A column REVOKE cannot cut a table grant.** It is accepted silently and changes
nothing. On `voice_channels` INSERT is table-level, so a newly added column
arrives writable on insert. Replace the grant; then assert the result in both
directions.

**A Supabase `postgres_changes` filter reaches a DELETE only under `REPLICA
IDENTITY FULL`**, or when the filtered column is part of the primary key. Otherwise
the DELETE never matches and the subscription still says SUBSCRIBED. Check replica
identity before filtering a binding that includes DELETE. (`FULL` here: `tasks`,
`task_events`, `locations`, `location_members`; the rest are `default(pk)`.)

**A register entry's proposed fix is a hypothesis.** Three entries in one day
proposed fixes the database refuses. Read the RPC or policy on production,
read-only, and measure behaviourally inside `begin; … rollback;` **with a control
that must succeed**. Impersonate properly — `set_config('request.jwt.claims', …)`
plus `set_config('role','authenticated')` — because a policy measured as the
table's owner is not measured at all. Client mirrors of server predicates
already exist and quote the function they mirror: `lib/serverRoleAccess.ts`,
`moderationAccess.ts`, `folderAccess.ts`, `taskActionAccess.ts`,
`inviteRoleGrants.ts`, `support/operatorRules.ts`.

**A self-check must be able to fail for the reason it names.** A migration's
self-check claimed to catch a missing `SECURITY DEFINER`; it could not, because
the calling function was itself definer and the trigger inherited its context.
Removing `security definer` left the whole rehearsal green. Mutate the migration
and require each self-check to go red.

**Every production database change** follows `CLAUDE.md` §10 — backup verified
first (and proved to be a backup of the *before* state), one transaction, a
self-check that raises rather than committing a half-applied state, rollback in
the header, recorded byte-identical in `.migration-backup/supabase/migrations/`,
applied as `supabase_admin` where `postgres` does not own the objects. The
delegation of design decisions does not relax this.

---

## 6. Audio

**An 8-bit analyser has a 48 dB dead bucket.** `getByteTimeDomainData` is
`b = ⌊128(1+x)⌋`; any negative sample lands on 127, so every live capture reports
at least one step, and a rule like `level > 0` can never be false. The no-input
warning shipped inert that way, and «voice activation» at its default threshold
could never close the microphone. `getFloatTimeDomainData` on the same node is
exact to −90 dBFS. Never build a level rule on the byte API; and distrust any
constant justified as «one step of the instrument» — that reason expires when
the instrument changes.

**Statistics computed after a clamp are statistics about the clamp.** A proposed
«refuse a flat run» rule measured spread in scale *positions*, where a dead
capsule and a quiet room both sit on the floor; in raw decibels the order
inverted. Measure before the clamp.

---

## 7. Layout and pixels

**The owner judges visuals literally.** Several changes judged good from the
stylesheet were rejected on sight, and once the wrong element was changed
entirely because the owner's words were read loosely. Render the exact element,
every state, both themes, 1440 and 390, and **look at the pixels** before
reporting. Identify the element from where it sits and what it is between.

**Measure contrast where the least is visible**, not where it is brightest. An
empty meter track shipped at 1.09:1 because the filled states were measured and
the resting state was only looked at. A second measurement was 2.9× wrong because
the crop caught neighbouring elements — crop to the element.

**Computed style cannot see the radius clamp.** `getComputedStyle` reports the
specified radius; the paint clamps it to half the shorter side. Compare pixels.

**Reserve room for a floating element inside the scroller**, as end padding, not
by shrinking the container — otherwise a band of ground stays behind in the old
element's shape.

---

## 8. Reference clients

**Copying the configuration is not copying the result.** Discord's profile popout
was read from its bundle and reproduced exactly — and ours covered the message it
was opened from. Discord's popout covers its row too; its messages are full-width
text rows with nowhere else to go. Ours are bubbles about half the pane wide, so
there was 380px free beside them. Matching the configuration reproduced
Discord's *constraint* instead of its solution. Read a reference for the
mechanism, then measure what that mechanism produces in our layout.

**Mobile Discord is not the web bundle.** Discord web and desktop are one bundle;
the Android app is a separate program. Three divergences were found in two days
(settings, profile, update notice, bottom bar — see `reference-clients.md`),
each under a decision already taken from the web reading. For any phone surface
the web bundle is a hypothesis: measure the Android app, or record the phone
shape as **unestablished**.

**An element that does not move is not proof a gesture is free.** A rightward
swipe in a Telegram chat did not move the message bubble, and was reported as an
unclaimed direction. It did not move because the whole screen did — rightward is
back-to-list. Measure the outcome, not the element you expected to react. And on
Android gesture navigation the back gesture lives at **both** edges (30dp each
on the owner's devices), which a row swipe must not start inside.

---

## 9. Several agents in one worktree

Every global resource is shared: the stash stack, the index, ports, the branch
checked out, the dev server's hot-update state.

- **The index is shared, and path-scoping does not save you.** `git add <path>`
  takes the file *whole*, so a neighbour's in-flight edit rides into your commit
  — and if the rest of their change is untracked, your commit cannot build.
  `054bf8ee` carried half of another agent's `MainLayout.tsx`, imported a file
  not in that revision, and reached `main`. Before committing, resolve every
  `@/` import in the commit's own files against that commit's own tree.
- **Read `origin/main..HEAD` as its own step.** A `git log` and a `git push` in one
  command means you see another agent's unreviewed commits and cannot stop.
- **A check that shares a call with the action it guards is a log line.** A
  `git rev-parse --abbrev-ref HEAD` printed a foreign branch in the same command
  that then committed onto it.
- **Never bare `git stash` / `pop`.** The stack is shared across worktrees.
- **A port collision is silent.** Require a server you start to announce its own
  port before you trust it (`CLAUDE.md` §5).

---

## 10. The owner, and how to work with him

These are standing instructions, not preferences. They are also recorded in
`CLAUDE.md` §7 and `docs/HANDOVER.md`.

- **Reports in Russian**; code and docs follow the repository's conventions.
- **Adopt the reference clients' mechanics, or better them — never relabel our own
  structure and call it adopted.** Discord is the default; Telegram wins for chat
  with media viewing, folders, and (contested) bots.
- **Decide without asking** on that basis — the authority is the *derivation*, and
  it stops at production migrations, anything that loses or exposes somebody's
  data, and anything irreversible he has not asked for.
- **«Where you were» is product state**: the open conversation, the voice channel,
  and both across an update the product applied itself.
- **Look before asserting.** Several of this project's worst hours were spent
  fixing things adopted from a recollection rather than a reading — including a
  version number (Android stable is `0.1.7`, not the `0.1.4` a note claimed;
  read `https://api.letscube.ru/releases/v1/android/stable.json`).
- **Never capture production screens or data.** A QA dev server carries the
  production configuration, so every Playwright run takes
  `KUB_QA_ALLOW_MUTATIONS=0`, and signed-in runs switch screenshots, traces and
  video off. On the owner's Android device, access is authorised and exposure is
  not: measure structure, keep nothing that carries content, and **never run
  `uiautomator` inside a conversation** — a WebView hands message text to the
  accessibility tree.
