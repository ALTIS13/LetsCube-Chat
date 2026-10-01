# Codex takeover after Claude, 2026-10-01

Owner: the main Codex conversation. Scope: recover the current checkout,
audit Claude's delta, inspect the explicitly authorised tester conversation,
transcribe its voice notes locally and reconcile the work queue. No product
patch, migration, deployment or native release was performed by this audit.

## Source and live state

- Previous Codex stop: `98b5052f`, recorded in
  [the earlier handoff](2026-09-27-claude-resume-after-codex.md).
- Main checkout was clean at `96024009`, 84 commits behind `origin/main`.
  Fetch and fast-forward brought it to `29176d72`; no reset or stash was used,
  and ignored operational material was preserved. Delta from the previous
  Codex stop: 97 commits, 465 changed paths.
- SSH to `ms.letscube.ru` confirms one healthy web container whose image is
  `l64kyyu1sysev2izzjjbizhe:29176d72e6b1686a61bd91ef322d592f115e40e6`.
  Public `sw.js` has build `7bb746a94ecb91c9`, entry
  `/assets/index-CgxVpMeW.js`. That entry contains `presence_beat` and
  `micro_group`, but not the unfinished `phone_findable_by` candidate.
- API worker runs `2b96d57e`; Bot Gateway runs `229a65e2`. Their healthy
  containers are not assumed to follow every web push.
- Production metadata, read inside `BEGIN READ ONLY` / `ROLLBACK`: RLS is on
  all 82 public ordinary tables. This is not a complete policy/security audit.
- Stable catalogs still say Android **0.1.11 / build 12**, Windows
  **0.2.14 / build 18**. Android embeds the web at its cut; Windows loads the
  current web. No native publication is implied by the web source delta.

## What Claude completed

| Area | Commit-backed delta and remaining evidence boundary |
| --- | --- |
| iPhone / accessibility | `35a19e66`: installed root at `100lvh` (D-111); `1d517198`: contacts clear the status bar; `7898909b`: modal names. Guest installed-PWA device measurements and later tester feedback exist; they are not a complete authenticated iPhone regression. |
| Sending / media | `c133c238`: playback outlives the chat; `8201c584`: upload placeholders; `956839ed`, `e97f9ae8`, `6ea2f84b`, `7cf0a349`: persistent outbox, reconnect retry and app-level uploads. Files over 25 MiB are not guaranteed to survive restart. |
| Conversation continuity | `f2c61b42`: first unread on return; `85d7ffac`: remove redundant history reads; `651b179d`: live hidden-message sync; `08e4bc33`: safe automatic web update. |
| Navigation / search | Desktop user panel, tasks/bots inside the shell, channel previews and unread counts, system folders instead of the extra type filter, filter completions, ranked chat search and scoped people search. Key commits: `e510fe81`, `59873f99`, `79ab49a2`, `dd51e509`. |
| Group conversations | `80ceec3b`: invite links; `2b96d57e`: `dm_group` and server vocabulary; `30f3d1b8`: group calls / moving a private call; `05cb6cd5`: folded blocked messages. Killed-process ringing remains a separate native boundary. |
| Tasks | Periods, checklists, reminders, co-executors and `dce1c32b`'s atomic multi-location creation. |
| Data / presence | `0b49ddd6`: deleted-message cleanup / media purge; `6abd5f1c`: immutable conversation kind; `1e4ea736`: database-published presence; `29176d72`: membership DELETEs scoped to the reader's chats. |
| Audio regressions | `331ebe71`: D-329 seek through the application player and D-330 typed text is not a voice player. Historical seek browser proof is Chromium, not physical Safari. |

Database rollout details, including a recorded 2m16s notification-trigger
incident, are in [the September 30 record](2026-09-30-database-changes.md).
Do not flatten that incident into an unconditional successful rehearsal.
The private bot viewer predated this handoff; it is not a newly missing feature.
Items 45, 47 and 50 are already implemented/settled despite older handover prose.

## The actual unfinished Claude checkpoint: item 74

The separate `.worktrees/bot-platform` checkout, branch
`integration/message-actions`, is at the same committed HEAD but has **18 dirty
paths**. The phone-search candidate is preserved there, not copied over main:

- `PhoneSearchSetting.tsx`, `phoneFindability.ts`, privacy preferences/settings,
  global-search results and invite candidates;
- untracked `20260930235000_phone_search_for_everybody.sql` and its rollback;
- existing phone-contract tests not reconciled with the new normalisation;
- deletion of `docs/CODEX_START_PROMPT.md`, also uncommitted and not adopted here.

Read-only production checks found **none** of the new privacy column, the
`private.phone_lookups` table or privacy-aware RPC implementation. Do not publish
the candidate UI before its schema exists, and do not call it released.

Pre-release blockers to resolve before any application:

1. **Privacy read failure:** the store falls back to defaults on its first
   failed read (`lib/privacyPreferences.ts:151`); an unrelated preference
   save writes the whole row (`hooks/usePrivacyPreferences.ts:39`). The new
   `everybody` default overwrites a previously saved `contacts` restriction.
   Reproduced locally with the candidate store and a synthetic gateway: the
   successful-read control preserves `contacts`; first-read failure followed
   by a presence save writes `everybody` and fails the literal assertion.
   No production setting was written. Preserve that red case as a regression;
   unknown persisted preferences must not be widened by a save.
2. **Concurrent lookup limit:** SQL lines 95-114 count, check and insert without
   serialising calls for the account. Require a concurrent database rehearsal
   and an atomic limit, not only sequential happy-path checks.
3. **Incomplete verification:** a fresh run of
   `global-search-phone-contract.test.mjs` in that worktree has 2 passes / 1
   failure: the new normaliser accepts a Russian number without `+`, while the
   old literal expects `null`. Settle and test the intended contract rather
   than deleting the assertion. Dedicated findability/privacy tests are absent.

Then: verified before-state backup, isolated migration rehearsal including
grants, privacy, blocks, unknown number and concurrency; raising self-checks,
rollback, identical migration backup and real post-apply proof. The audit did
not apply SQL or alter anyone's privacy settings.

## Authorised tester intake

Read exactly the owner's two-person conversation with the named tester, from
2026-09-27 through its latest message on 2026-09-30. Export: 128 non-deleted
messages, seven voice notes. No other conversation, phone/email data or signed
media address was copied into tracked documentation.

The audio was downloaded into ignored
`.ops-private/2026-10-01-tester-intake/` and transcribed **locally**, using the
already installed `faster-whisper` medium model, Russian, CPU/int8, with no
model download or external audio upload. Total decoded duration: **313.8 s**.
The raw message export, audio, source IDs, timestamps, segments and transcripts
stay in that private intake. ASR is not a human-certified verbatim transcript;
only clear product complaints are used below.

| Voice / MSK time | Duration | Complaint and existing task |
| --- | ---: | --- |
| V01, Sep 27 19:35 | 44.7 s | Playback stops on chat exit; upload lost after exit/lock: D-313, D-314. Shared-web fixes exist; OS suspension and native acceptance remain distinct. |
| V02, Sep 28 10:45 | 42.7 s | Channel list needs last author, message, time and activity at a glance: item 54. Implemented; do not add a duplicate. |
| V03, Sep 28 10:46 | 27.5 s | Redundant forward-success notice after opening the destination: item 55, fixed. |
| V04, Sep 28 10:48 | 78.7 s | VPN/IP change requires restart; offline send cannot wait: items 53 and 52. Shared source exists; physical Android VPN-switch acceptance is still required. |
| V05, Sep 28 10:49 | 37.0 s | Failed text/voice must survive restart, without rewriting/re-recording: item 52. Persistent queue implemented within its documented file-size limit. |
| V06, Sep 28 19:14 | 53.8 s | Extra type filter is awkward; phone Enter sometimes sends: items 69 and 71. System folders and phone/landscape Enter rules implemented. |
| V07, Sep 29 18:46 | 29.4 s | Seeking voice jumps to an end; the word "voice" renders a player: D-329 and D-330, fixed in source. |

Additional written feedback maps to existing contacts, caption handoff, task
reminders/co-executors/periods/multi-location tasks, people search and item 56's
bottom-edge blur work. These are not filed a second time.

**New unrecorded complaint:** Sep 30, 19:40 MSK, mentioning a person in a chat.
Filed as **D-331 / item 75**, with source evidence, reproduction and acceptance
conditions. Member autocomplete is absent; a manual handle is only a coloured
span. Live notification behaviour of that span remains unmeasured.

## Tools and skills now available

Counts are the main coordinator's current callable schemas, not an entitlement
or quota guarantee. Subagents have a narrower toolset: their missing schemas
must not be reported as missing from this conversation.

| Tooling | Current capability / limitation |
| --- | --- |
| Figma, 42 tools | Read-only identity check succeeded, Full seat. Read `figma-design-to-code` before design context and `figma-use` before `use_figma`; exact file access and quota not measured. |
| Mobbin, 3 tools | One bounded standard screen search returned a Discord iOS reference. Useful for flows/screens, not an excuse to copy a different client's mechanics. |
| Rive | No callable tools here; configured localhost endpoint timed out. Do not claim the animation editor is connected. |
| MobileNext, 32 MCP tools | Local device list succeeded: Nothing A063, Android 15, online. No app/device mutation. `mobilecli 1.0.13` also works from npm cache; cloud catalog returned 101 model/version choices. No phone was rented. |
| Cloud-device budget | Original 200 minutes is historical, not a checked remaining balance. Before a future lease: concrete hypothesis, correct guest-only fixture, one device, immediate release. Catalog access is not reservation/entitlement proof. |
| Playwright, 25 MCP tools + repository CLI | Local `@playwright/test 1.59.1`: isolated Chromium 147 and WebKit 26.4 DOM/click smoke succeeded. Signed-in runs prohibit screenshots, trace, video and DOM snapshots; `KUB_QA_ALLOW_MUTATIONS=0`. |
| Chrome CUA | Tools exist, but the subagent's empty-tab attempt timed out then returned a JSON parsing error. Not confirmed operational; the direct Playwright path works. |
| Subagents, 5 management tools | Two bounded read-only audits ran in this handoff; no sidebar task was created. Reuse workers and keep non-overlapping scopes. |
| SSH / Coolify | 20 remote-SSH tools, 10 Coolify read-only tools and 45 LetsCube write schemas. Read-only SSH/Coolify probes succeeded. Write-token validity was not tested; unrelated project aliases are out of scope. |
| XcodeBuildMCP, 44 tools | Callable schemas and cached plugin do not supply a Mac: local `xcrun` is absent. Native iOS/macOS build/sign/run needs a genuine Mac/Xcode host; iPhone PWA QA can use MobileNext. |
| Local ASR | `faster-whisper 1.2.1`, CTranslate2 4.8.2, PyAV 18.1.0 and cached medium weights; seven authorised files actually transcribed. |

Runtime checks: Node 24.15.0, pnpm 10.33.2, Python 3.12.10. Installed relevant
skills include frontend testing, React practices, Supabase, plugin management,
reference-driven product audit, Figma, Apple-specific skills and Superpowers.
Load the one needed for the operation, not an old hard-coded tool list. Preserve
the established Liquid Glass material; measure pixels at 1440/390, both themes.

## Next work and validation

1. Finish and independently verify the preserved item 74 candidate, resolving
   the pre-release blockers above before any migration or deployment.
2. Implement D-331 / item 75 with member scope, stable identity, keyboard/touch,
   IME/Enter, accessible completion and actual notification checks.
3. D-208: remaining signed-media cases, compatible Android and managed cache,
   then a separately gated private-bucket change. The current public fallback
   is not the privacy fix.
4. Native acceptance: VPN/network change, locked/killed-process calls, offline
   uploads and authorised iPhone chat/composer/push. Android build/install/
   publication remains on hold; Nothing being online does not lift that hold.
5. Item 37: Windows idle/AFK, push under DND and the documented cross-device
   race hypothesis; then roles/channel permissions, remaining bot/document,
   badge, backup/observability and parked public-home stages in the tracker.

Fresh checks on committed main: kub typecheck **passed**; 104 selected unit
tests **passed, no skips** (outbox, persistence, reconnection, Enter, people
scope, folders, typed media, voice shell/volume and compression metadata).
The full suite, authenticated production UI and native matrix were **not**
rerun. Candidate phone-contract test is **red, 2/3**, as recorded above; the
synthetic failed-read privacy regression is also **red**, after a green control.
Documentation diff/link checks are separate from product acceptance. No commit
or push is implied by this record; a push to main auto-deploys even docs here.
