# LETSCUBE: checkpoint for Claude after the Codex continuation

Date: 2026-09-27. Owner: Codex Main, handing control back to Claude. Stage:
**paused by the owner**. Source: local checkout, `origin/main`, the `iOS/MacOs`
thread's explicit stop report, and the linked operation records. Blocker:
D-111 has no measurement of the installed messenger shell; Android release work
is still on hold. Next action: remove the temporary public iOS probe, preserve
the local dirty changes, then measure the actual installed PWA before a fix.

## Read this first

- `docs/HANDOVER.md` and `docs/PRODUCTION_PRIORITY_TRACKER.md` remain the broad
  history and queue. This file records the **new stop boundary** and does not
  supersede their completed evidence.
- The main checkout is `D:\CodexProjects\LetsCube-Chat`. At this checkpoint its
  `main` is `98b5052f`, **three commits behind** `origin/main` at `1c066e8b`.
  Do not reset, checkout or fast-forward over the dirty paths below. The iOS
  work is in a separate worktree and branch `codex/ios-bottom-band`.
- `origin/main` currently includes temporary, unauthenticated
  `/__qa/ios-paintability.html` from `7ed60ff6` and the edge-test correction
  `1c066e8b`. The iOS agent confirmed a single healthy production web image
  tagged with full commit `1c066e8bd34f5815231f532f3f43d426f8162c07`,
  and confirmed that the public diagnostic page was still served **at stop**.
  It is not a product feature. Cleanup is the first allowed follow-up, with a
  new healthy-image/content check; an HTTP 200 alone is insufficient because
  the SPA may serve its entry page for a removed path. Do not assume cleanup
  occurred after this written checkpoint.
- The iOS agent was explicitly told to stop. The `iOS/MacOs` thread was idle
  after its stop report. No cloud phone is currently rented by that work.

## Work completed since the Claude handover

| Direction | Verified state and remaining boundary |
| --- | --- |
| Ordinary members | Contact list, private aliases, add/search/remove UI, normal group text-channel scope, archived-channel isolation, voice-room creation and account-switch guards reached web production from `050cdda9`. Contact schema was applied after a verified backup with RLS checks. Synthetic browser matrix: 181 passed, 50 explicit skips; full unit/server suites and builds passed. **Authenticated production member UI was not accepted as a complete flow.** [Record](2026-09-27-member-contacts-and-channels.md). |
| Media | Album mosaic and remembered HD/SD choice are on shared web. D-208 signed-media web canary reached production, with member/outsider signing and expiry checks; its `media` bucket is still public and the client can fall back to public URLs. File attachments, group avatars and long-session refresh remain unproved, and the private-bucket switch must wait for a compatible Android release. [Canary](2026-09-27-signed-media-canary.md), [album QA](2026-09-25-media-album-hd-qa.md). |
| Bots and notifications | Group bot full-message access is an explicit admin setting, not a silent widening; `sendPhoto`, callback answers and inline input were deployed and tested in bounded live QA. Native FCM/WNS payload privacy, web-push account switching and album dispatch have separate proof/limits. See `docs/HANDOVER.md` section 4 and the linked operation records; a private per-viewer bot interface is not built. |
| Native shells | The last recorded Android Stable cut is `0.1.11` / build 12, but **read the live catalog** before any future release. The owner later said **do not build/install/publish Android for now**. Windows uses the live web through Tauri; do not infer an EXE release from a web deploy. Native signing/publication requires a separate owner instruction. |
| Web operations | Boot recovery and persistent hashed-asset retention reached production with container and asset checks. The prior Safari-tab recovery symptom was never root-caused on the physical iPhone. See [asset runbook](web-asset-retention.md) and [PWA record](ios-pwa-viewport-validation.md). |

### Unreleased local work in the main checkout

These files were modified **after** `98b5052f` and are not in a commit or in
production. Preserve them as the user's current work, not as disposable test
output:

- `artifacts/kub/src/components/kub/KubModal.tsx`: connects a visible modal
  title to its `role="dialog"` through a stable `useId` and `aria-labelledby`.
- `tests/e2e/contacts-member-flow.spec.ts`: literal accessible-name regression.
- `tests/e2e/deployed-member-contacts-live.spec.ts`: new opt-in **read-only**
  production QA test; it does not enter chats or mutate the backend, and turns
  screenshots, trace and video off.

The regression first failed against the old modal on a synthetic 390px client,
then passed in Chromium and WebKit after the fix. Settings/modal regression
20/20, typecheck, production web build (`sw.js build 2183d2362401b1e2`,
`built in 20.75s`) and the full unit suite passed after that build. An initial
full unit attempt had two expected stale-bundle failures and was rerun after
building. A deployed QA-member smoke reached contacts with an HTTP 200 on
1440px Chromium, 390px Chromium and 390px WebKit, but then failed because the
**currently deployed** `KubModal` has no accessible dialog name; it did not
prove the add-search flow. The three Playwright failure-context files were
deleted. Do not call this patch released, and do not run an authenticated
Playwright test with failure-time page snapshots or personal-data capture.
The local fixture Vite server on port 5188 was stopped at handoff.

## iPhone PWA: measured, not fixed

The separate `iOS/MacOs` thread owns D-111, the blank bottom band in the
installed Home Screen PWA. Published earlier source fixes `c057d768`,
`b7b4e6c3`, `d2686623` and tests are in the [PWA record](ios-pwa-viewport-validation.md),
but the tester's newer images still show a **159-pixel uniform bottom band**
(about 58 pt on the examined screen). The active installed messenger bundle
and shell/composer geometry were not measured. Do not mark D-111 closed.

A rented MobileNext iPhone 14 Pro Max on iOS 26.5 ran a **guest-only,
manifest-free diagnostic Web App**, not the authenticated messenger. Its
values were: `screen.height=932`, `innerHeight=932`,
`document.clientHeight=873`, `visualViewport.height=932`, `100vh=932`,
`fixed.bottom=932`, `safe.bottom=34px`, `scrollY=0`. Control pointerdown was
recorded at y=636, the diagnostic edge target at y=840, and the same target
inside the disputed strip at y=890. Thus that strip was DOM-hit-testable **for
this diagnostic Web App**. Critically, its `innerHeight` was already 932, so
the current idle-height formula would not have truncated the shell to 873
under these measured values. A generic `innerHeight`/`100vh` CSS change is
**not justified**. The next experiment must measure the actual installed
LETSCUBE shell, composer, viewport and active JS/SW identity in a safe guest
or synthetic route, including keyboard open/closed and a validated lower-edge
touch. No production conversation screenshots, account credentials or
personal media were used for this device measurement. The rented device was
released. A separate allocation without a control agent was also released
without installing an unknown provisioning profile.

The iOS agent's isolated worktree is
`C:\Users\maksi\.codex\worktrees\ios-bottom-band\LetsCube-Chat`, branch
`codex/ios-bottom-band`, HEAD `1c066e8b` at stop. It has **one dirty file**:
`docs/operations/ios-pwa-viewport-validation.md`, containing an unpublished
more detailed measurement report. Preserve it. There is no source fix for the
bottom band in that branch. The temporary public probe and its e2e test still
need removal after an explicit resumption; record and verify that cleanup.

## Connected tools and economical use

This session's callable-tool inventory contained Figma (41 tools), Mobbin
(three search tools), Rive (40 tools), MobileNext (`mcp__mobile_mcp__`, 32
tools), Playwright MCP (25 tools), XcodeBuildMCP (44 tools), plus GitHub,
Coolify and remote SSH connectors. **Tool presence is not an authenticated
connection test.** Figma/Mobbin/Rive were inventoried without consuming design
search/generation quota; verify connection only when a concrete design file,
reference question or animation task is ready. Use Figma's applicable skill
before design-to-code calls. Mobbin references must name platform/client and
date; do not present screenshots as our own design. Rive is appropriate for an
actual animation asset/state machine, not for routine CSS motion.

MobileNext is the required path for physical iPhone PWA checks from this
Windows host. It **was proved usable** by the guest device session above, but
the paid minutes are finite and no lease should remain running. At resumption:
list available/remote devices, allocate one controllable iPhone for a written
hypothesis, check its foreground Web App and screen geometry, do guest-only
actions, record only anonymous measurements, then call
`mobile_release_remote_device` immediately. If the device lacks a control
agent, release it rather than spending minutes or guessing a provisioning
profile. The owner has authorised a cloud iPhone for this QA. Do not assume
XcodeBuildMCP provides native iOS capability on Windows: local `xcrun` was
unavailable; native Xcode work needs an actual Mac host. Current iPhone
distribution under test is the Home Screen **PWA**, not proof of a native iOS
App Store package.

For local web behavior use the repository's Playwright synthetic fixture and
`KUB_QA_ALLOW_MUTATIONS=0`. A production-configured QA server is still
production-connected. Signed-in QA must not save screenshots, traces, video
or DOM snapshots; never print credentials, tokens, message bodies or media.
For production deploy proof, check the actual running Coolify image and a
public content marker in both directions; a webhook response is not proof.

## Resume order

1. Respect this stop. Inspect both worktrees and `origin/main` afresh before
   editing. Keep the local `KubModal`/test patch and the iOS report dirty file.
2. Remove the temporary `__qa/ios-paintability.html` and its test from a
   reviewed iOS branch, publish cleanup only with the owner's resumed
   authority, and prove the diagnostic content marker is absent from the
   current public response and a single healthy image is running.
3. Measure the installed LETSCUBE PWA itself on a rented iPhone; only then
   design and regression-test a bottom-band fix. Release the device promptly.
4. Review, commit and deploy the separate `KubModal` accessibility candidate
   after syncing with current main. Rerun the opt-in read-only deployed member
   test without personal-data capture; the remaining channel/member QA stays
   separate.
5. Continue the tracker by evidence: do not flip D-208 private media while
   Android is paused, and do not issue native builds merely because web moved.

