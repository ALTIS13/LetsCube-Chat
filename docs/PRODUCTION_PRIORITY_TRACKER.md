# LETSCUBE Production Priority Tracker

Status: active production-hardening tracker, updated 2026-08-31.

This file is the working source of truth for the next production stages. Before starting any new production task, read this file first, then update the relevant checkboxes/status when work is completed, blocked, or intentionally deferred.

Execution ownership:

- This tracker/chat owns the shared backend and web interface plus Windows and Android applications.
- iPhone/iPad PWA implementation and physical QA are owned by a separate agent. Do not modify or repeat that work from this execution stream; only consume its committed `main` baseline after checking `git status` and `git log`.
- **2026-09-11:** on the owner's instruction this stream now also fixes the installed iPhone app's PWA problems, without a device; no parallel Apple track existed on the remote. Device QA stays open until an iPhone is available.

Approved architecture handoff (2026-08-30):

- `[x]` Registration lifecycle cleanup Tasks 1-5 are implemented, reviewed and deployed in report-only mode. A fresh production backup, checksum/restore-list verification, rolled-back migration rehearsal, exact migration apply, auth-gateway deployment, trusted worker deployment, bounded backfill and aggregate smoke all passed. The worker is healthy with `REGISTRATION_CLEANUP_ENABLED=true` and `REGISTRATION_CLEANUP_REPORT_ONLY=true`; the observed report contained one not-due invite lifecycle and no candidates or failures.
- `[!]` Automatic deletion remains deliberately disabled. Changing `REGISTRATION_CLEANUP_REPORT_ONLY=false` requires a separate aggregate report review and an explicitly observed bounded deletion canary; do not infer that approval from the completed report-only rollout.
- `[x]` LETSCUBE Bot API foundation is migrated, deployed and production-canary verified. Public creation remains restricted to one internal owner while the public app/download home, compact Stable changelog and shared motion system move to the next stage specified in `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`.
- The specification contains a mandatory macOS/iOS handoff. Apple clients must consume the shared registration, bot identity, notification, release/changelog and motion contracts instead of creating parallel backend behavior. iPhone/iPad PWA implementation remains externally owned and is not modified by this stage.

Legend:

- `[x]` done and covered by regression checks.
- `[~]` active stage.
- `[ ]` pending.
- `[!]` blocked or deferred by an external dependency.

## Open after the navigation and hints work of 2026-09-12

Everything below is on `integration/message-actions`, pushed, and **not** on `main`. `origin/main` is still
at `245e4d9`, the commit deployed earlier that day.

**One product question from the search audit of 2026-09-12, unanswered.** A number counts as a number only when
it starts with `+`: `normalizePhoneSearchQuery` strips spaces, brackets and dashes and then requires complete
E.164, and `tests/unit/global-search-phone-contract.test.mjs` asserts that `89991234567` and a bare
`9991234567` both normalise to nothing. Those queries fall through to the text search instead. Deliberate, and
tested as such — but it is how numbers are typed here, so whether to accept a leading `8` (and with which
country assumption) is the owner's call, not a patch to slip in.

**Two decisions belong to the owner and are not to be taken for him.**

1. **Where the administration hint's plate sits.** Measured at 390: the shield's foot is at 36, the header block
   ends at 124, so the plate opens 88px below the shield and its top lands exactly on 124 — clear of the search
   field and the folder strip, which it used to cover. Where it lands instead is the **first chat row**, of which
   only the timestamp shows until the hint is dismissed. That is the least-bad of three positions tried and it
   overlays content rather than a control, which is what Telegram's own hints do. The alternative offered: render
   the plate **in flow** so it pushes the list down instead, at the cost of the list shifting as the hint comes and
   goes. Both frames were sent. Do not pick one silently.
2. **`GlobalSearchPalette` — answered and done, and it cost something I did not predict.** The owner accepted
   the deletion on the condition that the search we keep is then checked for searching by number, by nickname and
   by messages, and for separating and filtering them properly. Deleted: 283 lines, plus `lib/globalSearchEvents.ts`
   which existed only to open it. Both signed-in specs were repointed at the header's field — the one search
   surface at every width — and both pass, `global-search.spec.ts` against the real backend.

   **Ctrl+K lived inside the palette** and was the only handler for it in the product. It already preferred the
   header's field and opened the palette only as a fallback, so the surviving half moved into `SidebarHeader`
   with its guards intact — nothing below 768, clear the query, focus, select — and `preventDefault` now runs
   only where the field is reachable, so elsewhere the browser keeps its own shortcut.

   **And the palette was the only consumer of `SEARCH_FILTERS`**, the nine selectable result types. Deleting it
   left the product with no way to filter by type except typing `type:message` into the query, which nobody
   discovers. That is not a tidy-up: it is a gap against what the owner asked to verify. Delegated on 2026-09-12
   as a reconnection of the existing list onto the sidebar search surface, following the pill row Telegram puts
   under its search field.

   Coverage lost, counted rather than glossed: one unit test (the palette's own field as a well, whose subject is
   gone), one signed-in safe-area test (it photographed the palette sheet; it had been broken already, because the
   «Поиск» button it clicked now appears only after the list scrolls, and it cannot be repointed — summoning the
   results column needs a typed query and that file photographs real accounts and reveals no text on purpose), and
   one `toBeFocused()` on mobile that is now trivial because the way in is a tap rather than an autofocus.

   One claimed orphan was not one, and checking rather than trusting the list is the point: `KubModal`'s
`mobileSheet` is live in both its values — twenty-four call sites, five passing `false` and nineteen taking
   the default `true` — so removing it would have turned nineteen mobile sheets into centred dialogs.
`SearchTypeFilter` is used twice inside its own file; only its `export` is surplus.

**One defect found and delegated, and it turned into two — both now closed.**

`tests/e2e/ios-standalone-safe-area.spec.ts` fails its **landscape** case on `webkit-ios-standalone`: a click
timeout on the «Меню» button. The project's viewport is 393x852, so landscape is 852 wide — above `md`.
`openFixtureChat` opens the DEV capture route, and `PublicPreviewCapturePage` renders `SidebarHeader` and
`FolderTabs` but, by its own comment, «stands in for the `Sidebar` root, which this page does not» — so no
`FolderRail`. The shell rework of 2026-09-12 moved that button from the header to the rail, so at 852 the
header's copy is `md:hidden` and the rail that owns it is absent from that page: there is no «Меню» button at
all. Portrait passes because below `md` the header still shows its own. The page's stated contract is that every
surface on it is a shipping component, so the fix is to make it mirror the shell again rather than to relax the
spec.

**Closed the same day, and the second half is the part worth reading.** The page now mounts `FolderRail` from
`md` as `Sidebar` does (**D-152**, fixed). That moved the failure exactly one line on, to `getByRole("menu")`:
a role that belongs to the header's dropdown, which is `md:hidden`, while from `md` the shell opens the side
list as a `role="dialog"` layer. The assertion had been describing the product as it stood before the shell
rework and had matched nothing since; it was repointed at the surface the shell actually opens, knowingly and
without weakening.

Only then did the test reach `expectClearOfHardware` — and it reported, on the first run that ever got there,
that the side list's first row stood 59px wide at x=0 inside a 59pt landscape notch. «Мой профиль» had been
entirely under the hardware. That is **D-153**, fixed with `px-safe` on the layer's root: `MainLayout` pads the
application for the notch, and a `fixed` box escapes an ancestor's padding, so every fixed surface has to take
the inset itself.

The lesson outlasts both: a guard that fails early is not checking anything after it, and the longer it has been
red the more has accumulated behind it.

**Still unverified, and it needs a real Tauri window**: that the desktop shell's window dragging, minimise,
maximise, close-to-tray and non-100% DPI still behave after the application's top bar was removed. `windows:tauri:qa`
refuses a loopback, unconfigured bundle, which is exactly what the validation build produces, so this cannot be
closed from here.

**Promises narrower than they sound, recorded so nobody widens them by accident.** A hint's «never again once
read» is a promise about **one device**: the decision lives in that browser's storage, and keeping it per account
means a database column with its own approval and migration. «A couple of hours of real use» is accumulated time
while the hint was offered **and the page was visible**, not wall clock since it first appeared.

## Current Execution Order

1. `[x]` Priority 1 - Auth and anti-abuse baseline.
2. `[x]` Priority 2 - RLS and security audit baseline.
3. `[!]` Priority 3 - Backup and restore drill follow-ups.
4. `[x]` Priority 4 - Operator security observability.
5. `[~]` Priority 5 - Installed web/PWA production shell. iPhone/iPad-specific implementation and QA are externally owned.
6. `[!]` Priority 6 - Monitoring and self-hosted Sentry.
7. `[~]` Native/mobile packaging resumed: Windows Tauri secure startup and signed updater are complete; Android Stable now publishes the signed `0.1.3/4` APK with authenticated upgrade/logout/login/session restore, foreground/background/killed FCM acceptance, exact taps/read-sync, offline/reconnect, initial read/unread anchoring, fast-upward/prepend/footer stability, bounded geolocation and complete product media/capture acceptance on official-GMS Nothing. Live recovery, signer/Asset Links parity and a fresh official-GMS automatic domain verification passed. Android embeds its web bundle at build time, so unlike the Windows shell it does not pick up deployed web fixes; the published `0.1.3` carries the bundle built from `920c8e8` and is behind. External backup, a rebuild for the stale bundle and Play release remain active gates.

## Next Execution Queue

Use this queue before starting the next production-hardening turn. Do not repeat completed items unless a new bug report or regression test proves the old fix is insufficient.

1. `[x]` Fix Coolify worker auto-deploy gap so `letscube-worker` updates automatically when worker/backend code changes. Verified on 2026-06-23: push `56ac76e` created worker deployment `l9ca22g6e83fkn2psv6cc8lx` with `is_webhook=true` and status `finished`. Worker `watch_paths` now limit deploys to `artifacts/api-server`, Docker/deploy files and workspace dependency manifests so docs-only commits do not redeploy the worker. GitHub Actions are intentionally disabled and workflow files were removed; Coolify webhooks are the deployment path.
2. `[~]` Continue chat performance audit and synchronization hardening. Current known findings:
   - `[x]` Composer text is cleared immediately after optimistic send instead of waiting for delivery/read checks.
   - `[x]` Fully read chat opens anchored to latest messages.
   - `[x]` Chat with unread messages opens near the first unread boundary.
   - `[x]` Chat info media gallery uses generated variants instead of original media files for tiles.
   - `[x]` Reproduce and fix fast upward history scrolling bug: when the user quickly scrolls up through older messages, the message list no longer jumps back to the newest/bottom position during initial bottom settling.
   - `[x]` Prevent older-history auto-prepend from racing initial chat open anchoring: the top-of-list loader is disabled until the initial unread/bottom scroll has been applied, so read chats do not silently open on an older slice.
   - `[x]` Keep the sent message visible in the sidebar immediately through the optimistic store update and reconcile it with the realtime echo by `client_message_id` (`a458cd9`).
   - `[x]` Reopen a recently visited PWA chat from cached messages without an empty loading loop, then reconcile in the background (`f2c6673`).
   - `[x]` Hydrate chat/sender metadata before completing push navigation so a slow PWA resume does not stay on the generic `Чат` fallback (`f2c6673`).
   - `[x]` Add proposal-only batched sidebar summaries RPC and a frontend compatibility path. The RPC reduces last-message/unread loading from approximately `2 + 3N` requests to three batch requests while remaining `SECURITY INVOKER` and RLS-aware.
   - `[x]` Applied `.migration-backup/supabase/migrations/20260709_chat_list_summaries.sql` manually on 2026-07-09 after a verified full database backup. All 10 users with chat memberships matched the legacy unread/preview semantics, anonymous RPC access is denied, authenticated REST and production frontend calls return `200`, and `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` is active in the healthy web deployment.
   - `[x]` Measured the active batch RPC and large-history rendering in production on 2026-07-10 with `owner`, `tech_admin`, `location_staff` and `client` QA accounts at 1440x900 and 390x844. For the 246-message history, cold sidebar readiness was 505-564 ms, summary RPC was 47-55 ms, first 100 messages rendered in 452-467 ms, and warm reopen was 174-200 ms. Loading the remaining 146 messages took two 642-757 ms prepend pages without returning to the bottom; scroll-anchor error was 0 px desktop and at most 42 px mobile.
   - `[x]` Replaced the startup permission fan-out with one authenticated access snapshot. `.migration-backup/supabase/migrations/20260710_current_user_access_snapshot.sql` was applied manually on 2026-07-11 after verified backup `/srv/letscube/backups/pre-migrations/20260711-105607-before-access-snapshot.dump`. Full parity covered all 12 profiles with zero global-role, global-permission or location-permission mismatches. `anon` has no execute grant, `authenticated` does. `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1` is active in production; live Playwright observed exactly one `current_user_access_snapshot` request and zero legacy `has_permission`, `has_location_permission` or `has_global_role` requests.
3. `[x]` Add a bounded 720p video transcode worker path and upload/playback quality selection. The trusted worker now creates H.264/AAC MP4 variants at up to 1280x720 without upscaling, with two ffmpeg threads and a ten-minute timeout. A production-runtime benchmark converted a 10-second 1080p/9 MB sample to approximately 1 MB in 1.55 seconds; landscape, portrait, audio and no-upscale contracts passed. Compact/standard playback prefers the ready 720p derivative, high quality and explicit original-file opening keep the original. Existing originals are retained. Production backfill is complete for all 26 non-deleted videos with a valid Storage source; five older videos initially outside the newest 120 media rows were recovered after adding bounded pagination.
4. `[x]` Added hybrid media upload progress, retry and current-session resume. Files above 6 MiB use TUS with exact 6 MiB chunks and bounded retries; smaller files keep the standard Storage path. Cancellation terminates partial uploads, retry keeps a stable object path, and chat/composer scopes prevent delayed files, recordings, location results or failed captions from crossing into another chat. A disposable 7 MiB production object was uploaded, read back at the exact size and deleted.
5. `[!]` Keep iPhone/iPad Home Screen as the only PWA install target. Android browsers use the APK catalog and Windows browsers use the EXE catalog. Further iPhone/iPad PWA implementation and physical QA are owned by a separate agent and are out of scope for this execution stream.
6. `[!]` Keep monitoring/Sentry and backup restore rehearsal deferred until the user confirms the backup environment and restore-test window.
7. `[~]` Complete the Capacitor Android release candidate. The signed and verified `0.1.3/4` APK is published in Stable; its matching AAB remains local and unpublished. Android 13/14/16 Google Play emulators passed the emulator lifecycle matrix. Separately, official-GMS Nothing passed same-key package-data and authenticated session/chat/native-registration retention, explicit logout/login plus cold session restore, warm/cold/killed callbacks, malformed/foreign rejection, signed-final foreground/background/killed FCM, exact-chat taps/read-sync, authenticated offline/reconnect, read/unread initial anchoring, fast-upward and prepend stability, footer stability, bounded geolocation, large-file product upload/progress/sent playback/cleanup and camera/photo/regular-video/video-circle/voice controls. Local Task 4, live Asset Links parity, recovery routing, fresh official-GMS automatic domain verification and Stable catalog publication are complete. External off-device backup and Play setup remain external gates.

    **Re-verified 2026-09-05 against the live bytes, not the manifest.** The
    download at `https://api.letscube.ru/releases/files/android/0.1.3/letscube-0.1.3.apk`
    is 6,744,616 bytes with SHA-256 `77049445...c509863`. That matches the
    manifest's `size` and `sha256`, and matches the locally built
    `android/app/build/outputs/apk/release/app-release.apk` byte for byte, so the
    published artifact is the reviewed one. Those bytes pass
    `scripts/verify-android-release.mjs`: v2 signature scheme, exactly one
    non-debug signing certificate, `com.kub.messenger`, versionName `0.1.3`,
    versionCode `4`, not debuggable, the exact exported-component and permission
    contracts, and a certificate matching the tracked Digital Asset Links
    statement, which is in turn byte-identical to the one
    `https://app.letscube.ru/.well-known/assetlinks.json` serves. The Android
    unit suite passes 46/46 and `android/version.properties` declares the same
    `0.1.3`/`4`, so no unreleased version bump exists. Gradle still configures
    the project offline, and `assembleRelease` fails closed without
    `LETSCUBE_ANDROID_KEYSTORE_PATH` before any task runs, which is where a
    verification pass has to stop.

    **The open item is the shipped web bundle, not the packaging.**
    `capacitor.config.ts` sets no `server.url`, so the WebView loads
    `assets/public/` out of the APK instead of `https://app.letscube.ru`, the way
    the Windows shell does. The published APK's `assets/public/` is
    byte-identical to `android/app/src/main/assets/public/`, built 2026-09-03
    20:15 from `920c8e8`; 37 commits under `artifacts/kub/` have landed since,
    and none of them can reach an installed Android client. One matters on its
    own: `be18439` fixed the pre-paint theme bootstrap, and the shipped bytes
    still carry the break. Parsing the APK's own `index.html` reproduces
    `SyntaxError: Unexpected token '.'`, so the `0.1.3` release note
    «Тема приложения следует системной» cannot hold before React
    mounts on the installed build, and the remaining "confirm on a device" step
    of D-028 cannot pass against `0.1.3` at all. Browser and Windows users
    already have the fix because both load the deployed origin; only a new APK
    gives it to Android.

    **And the published `0.1.3` has no push at all.** Looking for the stale
    bundle turned up something worse in the same artifact. `apkanalyzer
    resources names` over the two published APKs differs by exactly six string
    resources, all lost and none gained: `google_app_id`, `gcm_defaultSenderId`,
    `google_api_key`, `project_id`, `google_storage_bucket` and
    `google_crash_reporting_api_key`. Those are what the google-services Gradle
    plugin emits from `google-services.json`, and `FirebaseInitProvider` reads
    them at startup. `0.1.3` still carries the entire Firebase messaging stack --
    `FirebaseInitProvider`, `FirebaseMessagingService`, the Capacitor
    `MessagingService`, `FirebaseInstanceIdReceiver` -- with nothing for any of
    it to initialise from, and no `FirebaseOptions` is hardcoded anywhere under
    `android/app/src`. So `PushNotifications.register()` cannot obtain a token,
    and every account that took the `0.1.3` update lost notifications entirely.

    The cause is mechanical rather than mysterious. `android/app/build.gradle`
    applies the plugin inside a `try/catch` that logs at `info` level when the
    file is absent, so a release build that omits it prints nothing and
    succeeds. `google-services.json` is local-only and ignored, and the QA
    record of 2026-09-02 states it was deliberately left out of this worktree
    for the routing debug build; the `0.1.3` release was then built from that
    same worktree on 2026-09-03 and inherited the omission. `0.1.2`, built
    where the file was present, carries all six resources.

    Two gates now fail closed on it. `android/app/build.gradle` refuses a
    release task graph without `google-services.json`, checked after the
    existing signing gates so their message stays first, and only for release
    tasks so a debug build without Firebase still builds.
    `scripts/verify-android-release.mjs` rejects a release APK missing any of
    the four resources Firebase initialises from. Both are mutation-tested, and
    the hardened verifier was run against the real artifacts: it rejects the
    published `0.1.3` with "Release APK has no google-services configuration"
    and accepts the published `0.1.2` unchanged. The Android unit suite is
    48/48.

    The rebuild this entry already needed for the stale bundle is now also the
    fix for push, and it must be built where `google-services.json` is present.
    Note that the checkout that holds it, `D:\CodexProjects\LetsCube-Chat`, is
    202 commits behind `origin/main` and older than the `0.1.3` bundle, so it
    cannot simply be built from as it stands.
8. `[x]` Replace the retired Electron spike with a clean-profile Tauri 2 Windows client. The one-window secure startup, tray/single-instance behavior, Stable/Test channels and signed Tauri updater are complete. Physical `0.2.0 -> 0.2.1`, `0.2.1 -> 0.2.2`, `0.2.2 -> 0.2.3`, `0.2.7 -> 0.2.8`, `0.2.8 -> 0.2.9` and `0.2.9 -> 0.2.10` production-update rehearsals passed without losing the authenticated profile. The `0.2.10/14` release keeps the hardened startup fix, restores Yandex SmartCaptcha compatibility in WebView2 and replaces the legacy venue subtitle embedded in the startup SVG with the neutral LETSCUBE wordmark. A successful version change shows a compact four-second confirmation and then frees the top-right area for future call controls.
9. `[~]` Complete the external Windows release gates. LETSCUBE `0.2.10/14` retains the exact-origin native Windows toast/history/action contract: one stable Toast Header per chat, up to five unread message cards, exact per-message routing from fresh and historical cards, independent routing for other chats, and chat-scoped history removal after reading. Its reproducible updater wrapper reads the existing encrypted signing identity only from ignored local files and fails if the matching public key changes. Stable download plus Stable/Test updater catalogs expose the same verified immutable installer. A fail-closed Authenticode path, provider-isolated WNS sender, sanitized Windows matrix and native offline/long-session suite are prepared. A second fail-closed tool validates Microsoft package metadata, requires the exact PFN in its generated client contract, reports all missing metadata in one pass, renders matching sparse-package/executable manifests and builds a local unsigned `MakeAppx` validation artifact without changing the internal NSIS path. The live Supabase schema was audited read-only and the `windows/wns` proposal passed a production-schema transaction rehearsal with full rollback; it remains unapplied until a real identified client can acquire a WNS channel. Remaining external work is the real Microsoft package identity/publisher/PFN/Entra mapping, production signing and SmartScreen reputation, Windows 10 and alternate WebView2 device runs, Windows App SDK channel/COM registration, proposal application, server secrets and true killed-process physical delivery.
10. `[x]` Harden direct-email support notifications. New inbound email tickets now create the same PII-free `ticket_created` event as web tickets, eligible pool operators receive one creation notification, and later requester replies notify the pool while the ticket remains unassigned. The first email message does not create a duplicate requester notification. The production migration was applied after a verified dump and passed a transactional live-DB fanout smoke.
11. `[x]` Improve global search for messages and people. The existing full-history message RPC remains active and measured an average 33.221 ms over 20 runs in the current largest 236-message chat. Exact verified-phone lookup now accepts only an explicit complete `+E.164` query, requires `users.view`, returns a profile-only projection, caps results at 10 and grants execution only to `authenticated`. It never returns the phone field or queries `profile_contacts` from the frontend. Migration `20260801112259_privacy_safe_phone_search.sql` was applied after backup `/srv/letscube/backups/pre-migrations/20260801-113105-before-privacy-safe-phone-search.dump` and passed production transaction rehearsal plus post-apply authorization smoke. Production currently has no verified phone contacts, so real phone results remain empty until SMS/OTP verification is configured and completed.
12. `[x]` Unify the LETSCUBE web and Windows application chrome. Desktop now has one 44px application bar with one wordmark, aligned sidebar/chat control rows and exact-origin Tauri window controls. Placeholder build `0.0.0` is hidden, media quality uses a compact accessible track, the empty chat view uses factual copy, and the administration dashboard shows bounded real metrics, registrations, users and audit activity. The bundled startup and production handoff preserve pixel-stable endpoint geometry; the update pill sits below the titlebar and cannot cover window controls. Browser, mobile viewport, Rust and complete Windows lifecycle QA passed on 2026-08-20.
13. `[x]` Harden Windows WebView auth and reorganize user settings. Yandex SmartCaptcha now enables its supported embedded-WebView mode in Windows/native shells while retaining the browser flow. Physical WebView2 diagnostics found that the non-default Tauri `freezePrototype: true` blocked the Yandex runtime while assigning its internal `toString`; the client now uses Tauri's compatible default while exact-origin navigation, minimal capabilities, immutable desktop bridge and CSP remain enforced. The real Windows WebView loaded the runtime, rendered the checkbox frames and exposed no CAPTCHA load error. The auth shell now owns bounded vertical scrolling, so registration controls and recovery/privacy links remain reachable in a short `1360x860` window. Settings open on a quick section for theme and notifications, with direct Profile, Audio and Application tabs; mobile tabs use a stable 2x2 layout. Active microphone/self-monitor gain changes update the live Web Audio graph, processing changes prefer in-place track constraints, and video quality appears only after staging video with Economy, Standard and Original choices. Desktop `1440x900` plus mobile `390x844`/`412x915` layout checks, auth gateway regression, production build, smoke, database type drift, RLS smoke and the complete Windows lifecycle suite passed on 2026-08-21.
14. `[x]` Remove the nested vertical scroll surface from the folder editor. `KubModal` now remains the only vertical scroll owner while the chat checklist expands in normal modal flow, keeping its footer reachable without adjacent scrollbars. The focused regression passed against production at desktop `1440x900` and mobile `390x844`; full authenticated smoke passed all five project viewports.
15. `[x]` Expand and group emoji selection without stretching the interface. Folder icons now expose 48 choices across four task-oriented categories; the message composer exposes 80 emoji across five categories. Both use one reusable keyboard-accessible picker, render only the active category and remain overflow-free on desktop and mobile. The message picker is capped at 420px on wide chats and stays full-width on narrow screens.
16. `[x]` Deploy and canary the LETSCUBE Bot API foundation. A fresh backup, isolated PG17 restore, transactional schema smoke and RLS checks preceded production apply. The dedicated Bot Gateway runs exact commit `01d26a9225fee1cda0b8e9676b4ab03b084dec64`; token rotation, private/restricted update privacy, webhook/polling exclusion, idempotent sends, two-message notification grouping/read-sync, log redaction and exact cleanup passed with push-free QA participants. Bot creation remains limited to one internal owner.
17. `[~]` Build the unauthenticated public app/download home with theme-safe product previews, verified Windows/Android Stable downloads, a compact Stable changelog and shared motion feedback. Preserve native-shell routing, `/privacy`, `/support`, authentication callbacks and iPhone/iPad PWA ownership boundaries.
18. `[~]` Interface audit and polish stage. Requested by the user on 2026-09-01 and deliberately scheduled **after** the public home plan closes, so it does not interleave with an approved in-flight plan. The goal is a measurably better interface, not a restyling: find the accumulated visual defects, make the interface more responsive, and give actions real feedback. It has two halves that must not be merged into one undisciplined sweep.

    - **Half A - audit first, then fix.** Enumerate defects before changing anything. Sweep the six release viewports (`3840x2160`, `1920x1080`, `1440x900`, `412x915`, `390x844`, `360x800`), both themes, and all three shells (browser, Windows Tauri WebView2, Android APK WebView). Record every finding with a reproduction, the exact surface, a screenshot and a severity, then fix in scoped batches with a regression test proportional to the risk. Do not "polish by eye": a change without a recorded defect or an explicit design decision is out of scope. `360x800` was added on 2026-09-06: the matrix used to stop at 390, and three of the five findings of the first Android walk (D-058, D-060, D-061) came from below it, on the 360-wide phone the product is installed on. Expect findings in layout overflow and clipping, inconsistent spacing and control heights, focus and hover states, contrast in both themes, scrollbar and safe-area behaviour, keyboard insets on Android, long-content and long-name truncation, empty and error states, and loading placeholders that shift layout.
    - **Half B - execute the already approved motion plan.** `docs/superpowers/plans/2026-08-30-shared-motion-feedback.md` already specifies the response and action animations: semantic timing tokens (90/140/220/320 ms and a ~2.4 s transient success), a bounded global action-feedback controller, consistent copy/save feedback, standardized loading/modal/save transitions, and cross-platform visual QA. It is 5 tasks and 33 steps, none started. Execute that plan rather than inventing a parallel animation system.

    Binding constraints for both halves: preserve every contract in the critical regression list, especially chat entry anchoring, search and notification jumps, history prepend, fast upward scrolling, notification grouping and read sync. Never animate layout dimensions for decorative feedback and never let an essential action wait on an animation. Honour `prefers-reduced-motion: reduce` by removing movement while keeping text, icon and colour feedback. Keep loading placeholders dimensionally stable. iPhone/iPad PWA behaviour remains externally owned; provide shared tokens and handoff notes instead of editing it.

    The defect register is open at `docs/INTERFACE_DEFECT_REGISTER.md`; entries D-001 to D-005 were recorded on 2026-09-01 while capturing the product previews from the shipping components.

    Deliverables: a defect register with evidence, scoped fix commits with tests, the motion plan closed task by task, and a visual QA record across the viewport and shell matrix. Write the detailed task-by-task plan when this stage actually starts; this entry is the approved scope and ordering only.

    **Half A is substantially complete as of 2026-09-06, and it turned into
    something larger than an audit.** The owner asked for the interface to be
    brought to a modern standard with translucent surfaces, so the stage
    absorbed a redesign as well as a defect sweep. What shipped:

    - The product's surfaces are one material — four tokens per theme and two
      utilities — with the contract and its eleven rules in
      `docs/operations/interface-material.md`. Six of those rules were learned by
      breaking something first, which is why they are written down.
    - D-044 to D-050 are closed; D-048 closed itself when the text colour tokens
      landed for another reason.
    - Controls have one focus language instead of three. The old one was
      assembled and immediately overwritten — a focused button's computed style
      was byte-for-byte identical to an unfocused one — because Tailwind draws a
      ring as `box-shadow` and every glow and shadow utility answers to the same
      property.
    - Disabled controls are readable: they were faded with six different values
      of `opacity` across 79 places, measuring 2.23:1 and 1.94:1 against a
      threshold of 4.5.
    - The type scale has one bottom step instead of two, across 203 places.
    - Borders belong to what you aim at, not to everything.

    Four things this stage found are worth keeping in mind because they are
    general, not cosmetic: elevation is relative while tokens are absolute, and
    the same defect therefore arrived three times; a contrast measurement tells
    you whether text on a surface is legible and never whether the surface is
    visible; the application's own classes sat outside cascade layers and so
    silently beat every Tailwind utility applied beside them; and `opacity` is
    not a way to be disabled.

    **What remains in Half A:** the five-viewport, three-shell sweep is still
    browser-only — the Windows Tauri and Android WebView passes have not been
    run. Six realtime channels bind several tables each and work only because
    all their tables happen to be published; they are named in
    `tests/unit/realtime-channel-tables.test.mts` so the risk is visible in the
    tree rather than only in a report.

    **Progress as of 2026-09-03.** Half A's audit harness is
    `scripts/interface-audit.mjs`; it measures overflow, clipping, touch targets,
    contrast and focus visibility across the surface/viewport/theme matrix and
    refuses to measure an unstyled page — an early run produced 549 invented
    findings from raw HTML, every contrast reading exactly 1.00:1. The register
    at `docs/INTERFACE_DEFECT_REGISTER.md` now runs to D-019. Production
    measures 64 cells, 0 findings, 0 unreachable.

    Half B's motion plan is closed through Task 4; the shipped contract is
    documented in `docs/operations/shared-motion-feedback.md`. Task 5's browser
    validation is done; its Windows and Android runs remain.

    **Two defects found by this stage were worse than anything it set out to
    find, and neither was cosmetic.**

    The first: the profile was fetched three times concurrently while a stored
    session was being recovered — once by the mount effect and again for every
    auth event Supabase emits along the way. Measured against production, six
    restored sessions out of ten never reached the app; a person who closed the
    tab and came back sat on a spinner. Nothing was slow — that query executes in
    0.55ms, PostgREST was healthy and Postgres had 28 idle connections of 100 —
    but `loading` is only cleared in a `finally`, so one request that never
    settles holds the screen forever. Deduplicating to a single in-flight load
    took a local reproduction from 7/10 hung to 0/10. Fixed in `1310d5b`.

    The residual seen straight after the fix — 2 of 6 returns still hanging —
    was the measurement, not the product. Those runs signed in four times in two
    minutes, and the failures followed that rate: they clustered after the first
    few rounds, appeared as sign-ins that could not complete at all, and
    persisted with a fresh browser process per round, which rules out anything
    accumulating in the browser. Spaced 45 seconds apart, as a returning visitor
    actually behaves, production measured **0 of 6 hung**, every return in
    466-1169ms.

    The defect itself was not rate-induced, and the comparison that shows it is
    controlled: the same account at the same measurement rate went from 7/10 hung
    to 0/10 with only the code changed, and the instrumentation showed three
    identical outstanding profile requests in every hung run and none in the
    others.

    The second: two scroll-anchoring contracts listed as critical in the handoff
    had been reporting "skipped" on every run instead of protecting anything. The
    helper called `count()` on the chat list immediately after sign-in, and
    `count()` is a snapshot rather than a wait, so it read zero rows and skipped.
    They run now.

19. `[~]` Roles and permissions. Requested by the owner on 2026-09-04 ("крайне неудобно", "очень перегружена для администратора", "старые fallback роли"), then on the same day: remove the excess without breaking what works, and reassign anyone on a legacy role to a proper one. **Data half done and applied 2026-09-04 (`20260904060000`); the UI half and one owner decision remain.**

    **This entry's first version measured the wrong table, and the correction is the useful part.** It counted `role_permissions` rows and concluded that `owner` and `tech_admin` "grant an identical 40-permission set". They do — and it does not matter, because `has_permission` never reads those rows for them. Verified against production:

    ```
    has_permission(u, k):
      1. has_global_role(u,'owner') or has_global_role(u,'tech_admin') -> return true   -- no table read
      2. user_global_roles -> role_permissions, scope='global' and is_active
      3. otherwise _legacy_role_has_permission(profiles.role, k)                        -- hardcoded in the function
    ```

    What follows from that, all measured rather than reasoned:

    - **`role_permissions` currently decides nothing for anybody.** All 14 accounts resolve to exactly two outcomes: 40 permissions (4 accounts, via tier 1) or one, `chats.invite` (10 accounts, via tier 3). Nothing lands on `admin`'s 23 rows or `manager`'s 9. Emptying those tables would change no one's access.
    - **There are four administrators, not two.** Two hold `profiles.role='admin'` *and* a global `owner`/`tech_admin`; the other two hold `owner`/`tech_admin` while the legacy column still calls them ordinary users. Any reasoning that starts from `profiles.role` is wrong about who can do what.
    - **The location tier is load-bearing and must not be removed.** `_task_visible_to_current_user_v3`, the SELECT policy on `tasks`, calls `has_location_permission` five times, and that function *does* read `role_permissions`. 4 locations, 15 members, 40 tasks depend on it. The first version of this entry proposed deleting the tier "unless something depends on it" — something does.
    - **The chat tier is the genuinely dead one.** `has_permission` filters `scope='global'` and `has_location_permission` filters `scope='location'`, so a chat-scope role is read nowhere; real chat authority comes from `chat_members.role`.

    **Applied on 2026-09-04** — names and descriptions only, plus two backfills; no write to `profiles.role`, no change to `role_permissions`:

    - the five «клуб» titles became «Владелец / Администратор / Менеджер / Сотрудник / Участник локации», satisfying section 7 of `CLAUDE.md`. No UI change was needed: `getRoleLabel` prefers `roles.name` from the database, and the club strings lived only in the seed.
    - the three chat-scope roles are `is_active = false` — deactivated, not deleted, because the foreign keys cascade. The admin panel already filters inactive roles out of its assignment pickers.
    - seven pre-trigger accounts got the global `user` role they should always have had, and one `location_members.role_id` that was NULL was filled.

    Verified before and after: the full cross product of every account against every permission was compared, and **not one decision changed** — 4 accounts with all 40, 10 with one, exactly as before. The migration carries that check internally and aborts on drift in either direction, widening included.

    **Decided by the owner, 2026-09-04 — the parity is intentional, and this is not a defect to fix.** The split between `owner` and `tech_admin` is organisational: one runs the technical side, the other runs people and the product, and the second also comes in to test, so narrowing his reach would obstruct the thing he is there to do. The roles say who someone is; they were never an access boundary. The short-circuit in `has_permission` is therefore the correct implementation, and the descriptions now state it (`20260904070000`) so the next audit does not re-file it as a bug — this one did. Changing it later means changing the function, not the data.

    **Still open — the panel, but far less of it than this entry claimed.** Read on 2026-09-04, `RolesPermissionsTab.tsx` already does most of what was proposed here: it groups permissions with `PERMISSION_CATEGORY_ORDER` / `getPermissionCategory` into a two-column grid of labelled, described category cards, gives every permission a name, a description and its technical key, and already renders a notice reading «Владелец и тех. администратор всегда получают полный доступ. Набор прав здесь информационный и не ограничивает эти роли» — the exact statement this entry asked for.

    What is plausibly left is density rather than structure: eight category cards, every permission expanded with its full description, nothing collapsed, and one column below the `lg` breakpoint — a very tall page for a screen whose job is usually "check one thing". Collapsing categories by default with a count of what is enabled, and diffing two roles without opening both, would both help. But that is a guess at what the owner finds inconvenient, and **this entry has now been wrong three times by inferring the interface from the database instead of reading it. Ask before redesigning.**

    **A trap worth remembering.** The `20260514` seed uses `on conflict (key) do update ... is_active = true`, so re-running it silently restores the club titles and revives the chat roles. Recorded in the migration and covered by a test.

    Two smaller findings left deliberately untouched: one member row whose `role='staff'` disagrees with its `role_id=location_client` — aligning it would *add* `tasks.view` and `tasks.claim`, which is a widening and needs a decision — and the two bypass-role holders whose legacy column reads `user`: these are two of the five `is_test_account` logins, given `owner` and `tech_admin` deliberately so the functionality behind them could be exercised, and they disappear when those logins are deleted. The audit first read them as privilege that had leaked, which they are not — but any count of administrators that does not exclude test accounts is wrong by two.

20. `[~]` The user profile card. The frame moved off the docked column on 2026-09-04 (`94b5ce1`); its contents were reworked on the same day. The owner's reference is a desktop messenger's contact card, and the gap is in what the card *contains*, not where it sits.

    **Shipped:** above `DOCK_BREAKPOINT` the card floats and drags, reusing `lib/floatingWindow.ts` and the drag-skip that keeps header buttons clickable; below it, the docked panel renders exactly as before. Focus handling, Escape and the session-remembered position are in. Nobody has looked at a rendered pixel of it — see below.

    **The four findings the owner reported on 2026-09-04 after using it are addressed.** Each contract below was mutation-tested — 33 mutations, all caught — in `tests/unit/message-media-sections.test.mts` and `tests/unit/profile-window.test.mts`.

    - **The gallery is a sub-view, not an expanding block.** The card body is two stacked layers; «Общие медиа» pushes, the arrow in the title bar and Escape pop. `resolveProfileWindowEscape` in `lib/profileWindow.ts` decides between ignore / back / close, so a confirmation standing over the gallery still owns Escape. The root cause of "cannot be collapsed" was that for a private chat the info block rendered on `!isGroup` regardless of tab, so the media block was appended *underneath* it and nothing could take it away.
    - **The media is divided by type, with counts.** `lib/messageMediaSections.ts` classifies rows into Фото, Видео, GIF, Файлы, Ссылки, Голосовые, Видеосообщения and Аудио from `type` plus the voice/round-video predicates, which were lifted out of `ChatWindow.tsx` rather than copied, so playback and the gallery cannot disagree about a row. A section with a count of zero is never offered. The media query now also loads `audio`; links come from a separate, soft-failing query over text rows, capped at 60 and run only on opening the gallery. Counts are of loaded rows and read `12+` while more exist — «at least 12» is true either way, where a bare `12` beside 300 photos is not.
    - **There is one profile surface.** `ChatProfilePreviewModal` is deleted from `ChatList.tsx`; «Открыть профиль» and the group/channel information entry both go through `selectAndOpenPanel("info")`, the route `Поиск в чате` already used. The nickname copy button — the one thing the mini-profile had and the card did not — moved onto the card. **Behaviour change:** the mini-profile deliberately did not change `selectedChatId` (recorded in `QA_RESULTS.md`); the card lives inside the chat window, so opening it now selects the chat. That is the cost of having one surface.
    - **The media viewer regression is fixed.** `MediaViewer` is portalled to `document.body`, so its `z-[90]` is measured against the page instead of against the card's `z-[60]` stacking context, and the `z-[70]` support window no longer paints over a full-screen photo.

    **Motion:** the push uses `.kub-subview` in `index.css` — `transform` and `opacity` only, on `--kub-motion-standard` / `--kub-ease-standard`, with the layers absolutely positioned inside a box that already has a size, so nothing with a size is animated. Reduced motion collapses it with the rest.

    **Still not verified by eye.** There is no jsdom or component runner in this repository, so the push and pop, the drag, the docked fallback on a phone, the section strip scrolling horizontally, both themes and the paint order of a confirmation opened from inside the gallery have never been looked at. The contract tests cover structure, wiring and the pure classification, not appearance. The links query is also unverified against a real chat: it is a single loose `content ilike '%http%'` over text rows with no supporting index, bounded by `chat_id` + `created_at` and by a 60-row range, and it fails soft — if it errors the section is simply absent.

    **The division moved into the card on 2026-09-04, at the owner's request.** They had seen the divided sub-view, liked the result, and asked for it arranged the way their reference desktop contact card arranges it: the counts belong in the card, and the card scrolls. So the horizontal strip of section tabs is gone and the card root carries a vertical list of counted rows — icon, then a label that *is* its count, «1543 фотографии», one kind per line, full width, between the settings rows and the destructive actions. Pressing one pushes the same sub-view, now holding only that kind; the title bar names it, the arrow and Escape still pop it. A kind with a count of zero has no row, and in a chat that has never carried media the band is absent entirely.

    Two consequences worth writing down rather than rediscovering:

    - **The counts had to move to the front of the load.** They used to be fetched when «Общие медиа» was pressed. They cannot be, now that the card decides which rows exist from what came back: a kind not yet loaded is indistinguishable from one this chat has never contained. Both queries — the media page and the soft-failing links query — therefore run when the card opens, so opening a profile now costs what opening the gallery used to. Both loaders were rekeyed from the `currentUser` object to `currentUserId` at the same time; with the object in the dependency list, any profile change from the store would have emptied and refetched the counts underneath the reader.
    - **The counts are still of loaded rows, so they read «24+», not «1543».** `MEDIA_PAGE_SIZE` is 24 and `classifyMessageMedia` splits `image` into photo/GIF, `video` into video/GIF/round and `audio` into voice/track on the client. An exact per-kind total would need those predicates expressed again in PostgREST filter syntax — a second classifier, which is exactly what the module exists to prevent. The visible cost is that a kind living only beyond the loaded window has no row at all: 24 recent photos hide an older file. That was equally true of the tab strip, but the strip did not look like a complete inventory and this list does. Fixing it properly means either paging until every kind is settled or moving the classification into SQL; neither was in scope and neither should be done by eye.

    Russian numeral agreement lives in `messageMediaSections.ts` beside the classifier (`selectRussianPluralForm`, `MESSAGE_MEDIA_COUNT_FORMS`, `formatMediaCountLabel`): «1 фотография» / «2 фотографии» / «5 фотографий», with the teens taking the «many» form, and `видео` indeclinable in all three slots on purpose. The `12+` form keeps agreeing with the number actually printed. 23 mutations across the two contracts, all caught, including two guards that had to be strengthened first: `role="tablist"` matched only the literal the strip happened to be written with and walked past the same role reintroduced as an expression, and the harness's own "did the mutant apply" check mis-read a duplication as unapplied.

    **Also still not verified by eye**, for the same reason as above: the counted rows in either theme, their density beside the existing action rows, the docked card below 640, the one-row loading placeholder, and how a long label such as «619 голосовых сообщений» truncates in the narrow docked column.

21. `[~]` Testers' complaints, received 2026-09-11. Triaged against the current source and the `0.1.4` APK, which was cut from `ff5892d` — before the glass material `0d22348`, the list under the chrome `953df26` and the type scale `8e98765`. The Windows client loads app.letscube.ru, so the PC tester sees the current interface; only point 6 is partly an old-bundle issue.
   - Defects: (3) the composer jumps while typing — its measurement lands one frame late and the bubbles are not memoized; (5) forwarding shows nothing and swallows failures; (7) emoji cells are about 36×28 against 44×44; (12) the chat list reloads whole on every message, read receipt and focus — decorations are not involved, list rows draw no frames; (13) reopening a chat refetches everything and renders twice.
   - Missing features: (1) zoom in the media viewer; (2) sending without compression; (4) a per-viewer alias for a contact; (6) text size; (8) contacts; (10) forwarding several messages — forwarded media also lose their previews, which is a defect; (11) transliteration-aware search.
   - Product decision: (9) what delete means. `[x]` The private-chat delete path is closed (Priority 2, `7c6482f`).
   - Approved by the owner without changes: delete-for-both for private chats through a function either participant may call; compress by default with a «Без сжатия» toggle, originals opened in the viewer; contacts in stages — alias first, then a list that survives chat deletion, then phone discovery behind a privacy setting and rate limits; Telegram-style forwarding that opens the target chat with the forwarded messages above the composer; a text-size setting and a larger default on phones, rendered for the owner before shipping; keep the glass but draw the sidebar and top bar without live blur, plus «Уменьшить прозрачность»; transliteration with ё=е, aliases searchable; Android `0.1.5` after these.
   - Order: quick fixes (7, 5, 3, 1) → performance (12 with 13) → sending without compression → message actions (10, 9) → people (11, 4, 8) → text size → the APK.
   - `[x]` (5) Forwarding says whether the message arrived, and why not when it did not — `68130ef`, D-081. (7) Every emoji target is at least 44×44 under a finger while a cursor keeps the dense picker — `04258ee`, D-082. Validated in their own worktree and taken onto the branch unchanged; they ship with the next merged wave, after its gates. Forwarded media losing their previews is D-083 and stays with the forwarding item (10); a feedback card covering the top of a full-screen sheet on a phone is D-084.
   - `[x]` (3) Typing no longer moves the conversation: the composer's height lands in the frame it grows — `d497c11`, D-085 — and messages stop re-rendering with the list and the store — `19aaba0`, D-086. (1) A photo zooms in the viewer with a pinch, a double tap, Ctrl+wheel and a drag — `c1a1d2d`, fixture support `78c93d2`, D-087; Safari's trackpad pinch is not handled and a finger pinch is unverified on a device. Validated in their own worktree and taken onto the branch unchanged; they ship with the next merged wave, after its gates. With these, the quick fixes 7, 5, 3 and 1 are all done.
   - `[!]` Deploy deferred by the owner on 2026-09-11: the quick-fix wave is validated and pushed on `codex/bot-platform` (`74d32c2`), but the owner asked to finish every planned task first — interface and message-action changes could force another deploy — and move everything to production together. `main` stays at `0b69e38` until then.
   - `[x]` (12) The chat list applies a message, a receipt or a read to its own row and no longer refetches on focus — `546341d`, D-088; (13) a reopened chat renders once from the store and revalidates once, and a chat with unread messages lands on the first of them again — `a5ff648`, D-089; both measured per event by `a3186a0`. Taken from agent I's worktree and reviewed before merging, which added two fixes: a reopened chat kept the old copy of anything changed while it was closed (`e0e64c1`, D-090), and a Realtime update that leaves out a long message's text no longer blanks its preview (`ae64273`). A database proposal for fetching only what changed is recorded under D-089, not applied.
   - `[x]` (2) Photos and videos can be sent without compression: «Без сжатия» under «Фото или видео» on a phone, «Сжать изображение» in the desktop send dialog; the original goes as picked with a 1280px preview beside it, the viewer zooms the original, and 50 MB per original is checked before anything reads the file — `5f5a5b7` `43419f0` `b3efbc8` `5e6989c` from agent K, D-092, with D-093 to D-097 filed and D-093 fixed since (`a048415`). Taken in with its spec made to run on WebKit, where its own harness had failed it (`e3d0b93`), and with the place a photo or a video was taken removed before upload, which every video had carried until then (`0c0d15e`, D-098). On `integration/message-actions`, not verified on a device or against real storage. For the backend before this ships, listed under D-092: Storage has to admit a 50 MB original and the 250 MB videos the client already allows, the bucket has to admit the originals and `image/webp`, and the worker has to hold a 50 MB photo in memory.
22. `[x]` Test and gate defects found by the 2026-09-11 verification wave; evidence in `docs/QA_RESULTS.md` under that date. All taken the same day: five fixed, one not reproduced.
   - `tests/e2e/settings-profile-layout.spec.ts:50` compares sub-pixel input positions with `toBe` (456.2996 against 455.8954, deterministic) and needs a tolerance. Not reproduced later on 2026-09-11: signed in on the public configuration it passed at 1440, 1920 and 3840, so it was left unchanged rather than loosened without a failure. Reopen with the project and the two values if it fails again.
   - `[x]` `tests/e2e/unified-interface-chrome.spec.ts:139`: since `f58edfe` the «Звук» row names its value, so «Чистый голос» resolves to two buttons, and the mode contract has been unchecked since 2026-09-04. Fixed in `7cab5dd` with an exact name; the strict-mode failure is gone and the test passes.
   - `[x]` `tests/e2e/resumable-media-upload.spec.ts:2` imports `react`, which resolves only under `artifacts/kub`, so a full run from the repository root exits 1 having executed nothing; its `:56` has been failing unseen on a stale `cacheControl` expectation. Fixed in `3ec1d4e`: React is resolved from `artifacts/kub`, and the resume test expects `IMMUTABLE_PATH_MAX_AGE_SECONDS`; 16/16 from the root.
   - `[x]` `gotoOrSkip` in `tests/e2e/helpers/auth.ts` turns an unreachable dev server into skips (13 skipped and 0 passed, observed). It should fail when a base URL was given explicitly. Fixed in `2d33805`: with `KUB_BASE_URL` set and the navigation failing it throws; without it, it still skips.
   - `tests/e2e/pwa.spec.ts:122` lets Chromium's wording for a load that failed through ("Failed to load resource") but not WebKit's for the same event. When the page's boot-time update check is cut off by the test going offline or navigating away, WebKit logs "…/sw.js due to access control checks" and the test fails. Seen once in ten WebKit runs on 2026-09-11; the update check itself dates from `4d4d174`. Wait for the update check to be answered before going offline, or accept WebKit's wording for the worker script only. `[x]` Fixed on 2026-09-11 in `1ca749e` the second way, after it failed 3 of 6 WebKit runs with other work on the machine: the wording is let through when it names `/sw.js` and nothing else. WebKit 20/20 over ten runs; three mutations of the test prove the line admits exactly that.
   - `[x]` `tests/e2e/auth-yandex-captcha.spec.ts` runs only with `KUB_EXPECT_YANDEX_CAPTCHA=1`, and two of its tests had gone stale unseen: `:132` looked for the invite banner sentence `cdcdbcd` removed (one pill label since `7c067cb`), and `:206` pinned a zero-padding, overflow-hidden, dark plate where `61f56b0` gave it 136px of room and `cdcdbcd` made it light on purpose. Fixed in `b0f5d5a` to pin the pill and the plate's promises; 18/18 at 1440 and 360, three product mutations each red.
23. `[~]` Owner decisions from the 2026-09-11 wave.
   - `[x]` The 28 end-to-end test messages left in two production chats (realtime-messages 14, notification-center 8, composer 6) were soft-deleted on the owner's approval at 2026-09-11T05:28:57Z, in one transaction that required exactly 14, 8 and 6 live beforehand and exactly 28 changed. Their ids and timestamps — nothing else — were recorded first, locally and in `/srv/letscube/backups/data-cleanup/test-leftovers-20260911T052857Z.txt` (sha256 `3a70a984…`); undoing it is clearing `deleted_at` for those ids.
   - `[x]` `KUB_QA_ALLOW_MUTATIONS=1` was removed from the owner's QA file on the owner's instruction: that one line, with the other eleven byte-identical. Every spec that writes now skips by default, and a run that has to write sets the variable on its own command.
   - `[x]` D-063, the registration confirmation card on a narrow screen: six options rendered at 360x800 with production's 136px SmartCaptcha and sent to the owner on 2026-09-11. Only "the actions straight after the address" and "the actions pinned to the bottom" put all three buttons on screen; the first is recommended. Decided by the owner on 2026-09-11: the actions after the address, with the lockup and its caption kept. Implemented in `64a7436`, matching the chosen render: with the production captcha all three buttons are whole on screen on entry at 360, 390, 412, 1440 and 1920, with one pixel to spare at 360x800; ships with the next merged wave. A shorter screen still clips them — an iPhone SE's 667px, or a top inset above the shell's 16px padding.
   - `[~]` D-071, the message hover actions at tablet width: three arrangements rendered at 768 beside the sidebar and sent to the owner on 2026-09-11. As shipped, 11 of 120 messages put their time on a line of its own; with no lane and the actions over the message's top corner, or above it, none do. The corner is recommended. The owner decided further on 2026-09-11: no hover actions at all, as in Telegram — every action in the long-press and right-click menu (which already opens with a row of quick reactions) and a micro icon for a quick reaction; that retires the lane and the wasted line with it. The concept render was rejected by the owner the same day, with six Telegram screenshots and a request for a clear assessment against Telegram before more iterations. That assessment — 26 points: 2 match, 6 in part, 5 differ, 12 missing, 1 to remove — was published to the owner as a page and recorded under D-071, with a proposed order: one set of renders for the whole target approved at once, then the phone, the desktop, reactions, selection with forwarding and deleting, details and saving. Decided by the owner the same evening: one reaction per person, as in Telegram; ❤️ as the quick reaction on a double tap and on the hover button; swipe to reply on a phone; and complaints 10 (forwarding several, with forwarded media keeping previews) and 9 (what delete means) join this track, so the menu and selection are built once. Next: the full set of renders for approval. The conversation work in `MessageBubble.tsx` it waited for has merged (`19aaba0`).
   - `[~]` Message-action renders (agent J) went to the owner on 2026-09-11, integrated for gating as `integration/message-actions`, with agent K's sending-without-compression renders beside them. The owner's word on them: keep the blur behind the phone menu, because it helps the chosen message read; put icons instead of words on the emoji panel's category tabs; and implement exact per-message read times, with better read sync, before production. Database changes are authorized with verification — a schema backup, a rehearsal on a throwaway copy of production's schema, one transaction with a self-check. Location data in originals sent without compression is stripped by default, orientation kept, unless the owner says otherwise — built in `0c0d15e` for originals and for every video, D-098. Agent L built that backend — D-099 to D-102 and D-083, taken onto `integration/message-actions` as `563055f` to `1afd407` — and on a throwaway copy of the production schema its five migrations, their tests, the rollbacks and a second application all passed once `243dd3d` fitted the tests to that schema. The migrations are not applied to production: `20260911142000` would refuse the second emoji the client production runs still sends, so all five go out with the new client, after a schema backup, in their numbered order, each checked read-only once it lands. Found on the way, for before production: every signed-in person can read every reaction (D-104), and the achievements people have earned are readable without signing in (D-107). Found while gating it, and fixed before production: a private chat whose latest messages were deleted could not reach its older history (D-108, `9601f8c`); loading older history moved the reader 43px, and in a chat's first seconds a reader who had started to scroll up could be taken back to the bottom (D-109 and D-110, `80e7674`). The signed-in prepend contract passes on production data again. The owner's word the same evening: location removal stays on by default (D-098); the emoji panel's icons are approved, so `codex/bot-platform` was fast-forwarded to `f63ada5` and pushed — `main` untouched, nothing deployed; D-096 is to be solved as Telegram does, with an explicit split between the gallery and a file, and preferably with a minimal slider when sending from the gallery that shows the quality a photo or video will go at and runs from the original to strong compression, to save traffic and space — an assessment and renders first, as the first slice of item 25; and D-104 and D-107 are to be closed by migrations in the same rollout, rehearsed first — written in `6e2f5ed` and rehearsed on a copy of the production schema, with their rollbacks and a second application, not yet applied.
   - `[x]` D-091: in WebKit the desktop message menu — an iPad, a Mac, an iPhone held sideways — ended its entrance invisible, with the reaction bar and the action card at opacity 0. Found because the emoji target spec failed on WebKit alone; fixed in `b6eb2e0` by letting each surface hide itself until placed instead of the column that holds them. Rule 14 of `docs/operations/interface-material.md` records it.
   - `[x]` D-080: a 40px action lane sent the time placement into an endless loop that took the whole interface down. Fixed in `9d78cd1` (from agent H's worktree): a measured anchored time is held against the layout it produced, so the placement settles at every lane from 0 to 6.5rem on either side. 6/6 new settle checks red before and green after on 1440 and 390; placements at the shipped lanes unchanged on Chromium and WebKit. Ships with the next merged wave, after its gates.
24. `[ ]` Later, not now: a paid subscription for visual extras, in the spirit of Discord's. Named by the owner on 2026-09-11 while deciding D-071: with it a person may put several reactions on one message and use animated reactions and emoji; without it, one reaction per message. To be designed properly when its turn comes — nothing in the current work should build it or block it.
25. `[ ]` The media send flow and editor, Telegram as the reference. Asked for by the owner on 2026-09-11 and to be done in its turn: before a photo goes out, a basic editor to rotate it, hide what must not be seen (blur or cover), and mark things on it; for a video, where possible, trimming the parts that are not needed with a correct preview; then a look at the result and the send, with a caption if wanted. Like D-071, it starts with an assessment against Telegram — its tools, its send screen, its video trimming — then renders for approval, then code, so it is not rebuilt after each iteration. It extends the send dialog and the attach menu of the sending-without-compression work (agent K), and it follows the current work: the message actions and their backend, and that work's integration. Client-side video trimming in a browser needs its own decision on encoding — WebCodecs, a lazily loaded ffmpeg build, or a trim done by the media worker before the message is published — because uploading the parts cut away would defeat the point.
26. `[ ]` Later, the owner's direction: voice and video calls, and voice rooms in conversations as in Discord. Telegram stays the reference for everything a messenger already does; this is where the product goes after the complaint work and the rollout.
27. `[~]` Standing: the original functionality — tasks, and the control of location staff (the location administrator and location staff roles) — is not forgotten while the messenger work goes on. The owner's reminder of 2026-09-11. Every wave's gates include the specs that cover tasks and staff, a change that touches them says so, and their own improvements are planned the same way as the rest, from an assessment of what they need, when their turn comes. Those specs today: `tasks-filters.spec.ts` (the task filters, as owner or technical administrator) and `roles-visibility.spec.ts` (a client sees no task or admin interface, location staff open tasks without management controls, a location administrator reaches tasks and scoped admin surfaces, an owner reaches global admin and task cleanup), with `smoke`, `unified-interface-chrome` and `visual-style-layout` around them. All sign in and only read, so they run against the public production configuration with screenshots, traces and video off, and a role without QA credentials skips.
28. `[~]` The installed iPhone app against Telegram on iOS 26, from the owner's report of 2026-09-11 with a tester's screenshots. Three parts. The empty band under the composer, which stays when the keyboard opens, is D-111: the composer's own arithmetic holds, and the missing ~60pt is the viewport iOS hands a Home Screen web app; its fix waits for the tester's iOS version and whether the band is there before anything is typed, and the owner is asked whether it ships on its own. Near the Dynamic Island the chat header is a flat band where Telegram floats capsules over the wallpaper, and the app reads as one navy where Telegram has a tinted wallpaper and saturated own bubbles — the owner suspects the glass material. Both of those go the D-071 way: an assessment against Telegram on iOS 26 and option renders on real code for the owner's choice, started the same evening, before any change ships. The owner's choice the same night: option C, capsules and colour, in both themes; own bubbles in the rendered blue; LETSCUBE's own pattern of cubes and its motifs in place of the paper planes; and one style for every shell, the web app and Windows included (item 30). The tester's answers for D-111: an iPhone 15 Pro Max on iOS 26, the app opened from its Home Screen icon; the band is there from the first frame and stays after a relaunch. So the shell's `100dvh` was the cause to fix: in `12f4393` the installed app takes `100vh`, and with the keys up its shell is fitted to what is visible — to be confirmed on the tester's phone after the next deploy.
29. `[ ]` Recorded for later by the owner on 2026-09-11, without interrupting the current work.
   - D-112: in the Windows app the window's own buttons cover the page's top-right controls — «+ Новая» on «Задачи» takes a click only on its lower edge.
   - A tester's report on the production build: a video does not send (D-113); a 300 KB photo took very long to upload (D-114); photos sent together went out separately rather than as an album (D-115); a received photo is WebP, does not zoom and looks poor (D-116).
   - Media storage, Telegram as the reference: how Telegram keeps what people send — the copies and sizes it makes, deduplication, how long its servers keep them, and the device cache a person controls — against LETSCUBE's originals, WebP copies and media worker on self-hosted storage, ending in advice on whether storage needs a serious rework so that accumulating user media does not fill it. The owner's view: the quality should be fine, and WebP was chosen for its small size.
30. `[~]` The iOS 26 style in every shell, the owner's direction of the night of 2026-09-11, with a screenshot of Telegram's chat list on iOS 26 as the reference: the installed iPhone app, Android, the web app and the Windows app are to share one visual language, worked through as Telegram's is. One surface at a time, the D-071 way. The chat screen first, as option C of item 28 on every shell with LETSCUBE's own pattern of cubes (in progress). Then the chat list and navigation — the capsule top row, search, folder tabs, rows and a floating tab bar with its own search button — assessed against the reference and rendered in options for the owner's choice (in progress). Then profile and settings, tasks and administration, each in its turn. D-112, the Windows window buttons over page controls, is to be solved inside the navigation work, and D-117 by option C's palette. Broadened by the owner on 2026-09-11, after testers said the app feels "Android-like" from the amount of functions and information in it: every part that a person, a location's staff or an administrator sees is to follow Telegram's way of doing it — no function that looks unclear, or unlike Telegram's for the same job — while LETSCUBE keeps its own colours, logo, thumbnails and mascot; not a copy. It starts with an audit of every surface against Telegram, split into settings and profile, work surfaces (tasks and administration), and the communication functions around the chat (in progress beside the chat screen and navigation work), then fixes in batches with renders for approval. Recorded with it: D-118, a volume slider on phones; D-119, no quality choice when sending — compressed by default, «без сжатия» as a named function, the slider of 2026-09-11 withdrawn; D-120, the duplicate «Папки» tab; D-121, sound settings in stretched modules. D-118 and D-119 were fixed the same evening in `bce98f3`, not deployed: no volume slider under a finger, and no quality asked for — «Файл», described «Без сжатия», sends the original on every device. The same night the owner asked for the attach menu itself to become Telegram's attach sheet, whose tabs work in place, in the iOS style: D-122, assessed and rendered in options first (in progress). The chat screen in option C was merged for every shell in `f1adbbe`; the owner approved its final renders the same night, seven small questions about it remain open, and nothing is deployed. The owner also wants the attach sheet's further functions — a poll, a checklist, a contact, music — as placeholder tabs for now, so that the scrolling row can be judged. The three audits of every surface against Telegram were compiled for the owner on a private page — seven causes of the "Android-like" feel, fourteen functional defects recorded as D-123 to D-150, a phase order and 22 questions with a recommended answer each — and wait on his answers. The media reports D-113 to D-116 were investigated the same night; the send path is being fixed first. On 2026-09-12 the owner chose the attach sheet's look B and its rules (D-122), the taller bubble for tall pictures (D-116), the client's 250 MB for video — which the storage service already runs, so nothing changed on the server (D-113) — and the rebuilding of the backups so that unchanged media is not copied afresh every day, the read-only measurement having found them at 39 GB against 978 MB of stored media. Done and verified the same night, and it turned up worse than the copying: the nightly run had been dying on `tar` over live mail volumes, so four September sets carry no manifest or checksums, and the encrypted offsite upload had been refused by GitHub as over its 2 GiB pack limit every day since 1 September - the last copy off the machine was 31 August, because the 2.5 GB `bot-platform-rollout` rehearsal directory was being swept into the config archive. Both fixed, the upload completed at 04:02, and media now go into a deduplicating repository: a set is 33 MB instead of 987 MB, a second snapshot of unchanged media stored 0 KiB, a restored file matched the original byte for byte, and a full archive is still written weekly so the offsite copy carries the media. The twelve rehearsal containers were checked and removed on his word the same night, with production untouched either side of it. He then lifted the deploy hold («если требуется сделай деплой без моего вмешательства»), and the batch went to production as `17a1c47`, verified on the running containers rather than from the webhook. He answered all 22 questions «по рекомендации» — 1a through 22a — and then corrected three of them from his own Telegram: administration stays in the bottom capsule on iOS and Android, it belongs in Windows' collapsible side list, and the chat list must be narrowable to avatars alone. The navigation choice between A and B is held until an assessment of Telegram Desktop on Windows and of iOS 26's Liquid Glass has revisited it, because his corrections change what is being chosen between. That assessment came back on the same night and recommends **neither A nor B but A with corrections**: option A's phone with administration kept in the capsule, and on a computer Telegram Desktop's own structure - a 72-point folder rail with the side-menu button on it, the side list as a layer holding «Управление», a chat list draggable down to a 66-point avatar strip, settings in the left column, the profile as a right column that becomes a layer when it does not fit, and in-chat search taking the list column. B's edge rail wants the same 72 points as the folder rail, so the two cannot both stand. Telegram itself removed the hamburger on Android for a bottom bar while keeping it on Desktop, which is the owner's per-platform correction exactly. Answers 4, 11, 12 and 18 move, 11 reverses D-050 and is re-opened knowingly, 21 stands except for the width of «Управление» on a tab, which is being measured, and the collapsible column and side list belong to phase 0 rather than later. The owner approved it the same night - «А с поправками принято» - so navigation is settled and the rebuild has started with the desktop shell: the 72-point folder rail, the side list as a layer holding «Управление», the chat list dragged down to a 66-point avatar strip with both its width and its collapsed state remembered, and the LETSCUBE mark in the list's top row. Settings as a column, the profile as one component and in-chat search in the list column follow inside that structure; the phone capsule waits on the measurement of «Управление» on an 11-point tab.

## Deploy of 2026-09-12, the second: the recording row, the desktop shell, and the instrument that measured them

`main` `17a1c47` to `245e4d9`, 32 commits, on the owner's standing permission to deploy without him.
The push was gated mechanically rather than by eye: the command refused to run unless the range still held 32
commits, one author, nothing dated before 2026-09-11 and a clean tree - because a check printed in the same
command as the action it guards is not a check, which this project learned the hard way earlier the same night.

**Gates, each read by content rather than by exit code:** typecheck clean across all four packages named
individually (`scripts`, `api-server`, `mockup-sandbox`, `kub`); unit suite **1832 of 1832**, 0 failed, 0 skipped;
mounted routing matrix **15 of 15**; production build proved by its own output lines (`sw.js build a5945fbb4749d60a`,
`built in 12.38s`) with no source newer than the emitted `index.html`.

**Verified on the server, not through the webhook:** the running container is
`l64kyyu1sysev2izzjjbizhe:245e4d9714683323c4d169932646d8b6975de5e9` - the full SHA of the commit - one replica,
the previous `17a1c47e8f88` retired during the rollover (both were up for about a minute, then one).
**Reached the reader:** the live stylesheet carries `--kub-window-caption` (the top bar's removal) and
`--kub-chat-track` (the lightened recording track) while keeping `--kub-raise-veil`; `sw.js` answered the same
id `b6200ce4f3b7741a` on six consecutive requests, so no reader is being served two different builds.

**The build id differs from the local one by design, and that was checked rather than assumed.** `b6200ce4f3b7741a`
live against `a5945fbb4749d60a` here: `serviceWorkerBuild.ts` makes the id a SHA-256 digest of **every file the
build emits**, and the local build emitted a bundle carrying fixture Supabase values where the server's carries
production ones. Provenance rests on the image tag and the stylesheet markers, not on the digest.

**One scare, resolved by evidence.** A container vanished from the host between two snapshots taken 35 seconds
apart, at the same moment the old web replica went. There were **zero** exited or dead containers, so it had been
removed rather than crashed - and the earlier snapshot names it outright: `epdla8rvbtp7l0uqzrq8hjru` was
`ghcr.io/coollabsio/coolify-helper:1.0.14`, the build container, up about a minute, retired when the build
finished. Every application is running: web 1, bot gateway 1, support mail 1, the two others at 5 hours and 3
weeks - untouched by this push - and the whole Supabase set up. Disk 75% used, 29G free.

**Production QA, and the limit on it stated rather than papered over.** As a guest, the public home only: 200 at
1440 and at 390, title, all three sections, controls present, about 1050 characters of text, no page errors, and
the live page proved to be rendering **Inter** by the width probe rather than by `document.fonts.check`. The
messenger surfaces this batch actually changes cannot be photographed in production - signed-in production
screens are off limits - so their evidence remains the fixture frames, re-rendered in the product's own font.

**Unverified, and it should be said plainly: the Windows shell.** The top bar was deleted and its window buttons
moved to an overlay. Dragging the window, minimise, maximise, close-to-tray and non-100% DPI were never exercised
on a real Tauri window - `windows:tauri:qa` refuses a loopback, unconfigured bundle, which is exactly what the
validation build produces. The Windows client loads the deployed web application, so this reaches it on next
launch.

Rollback: fast-forward `main` back to `17a1c47`.

## Deploy of 2026-09-12

`main` `0b69e38` to `17a1c47`, on the owner's instruction to deploy without him. `letscube-web` and
`letscube-worker` both reached `17a1c47e8f88`, each read off its running container; one replica each, healthy,
the previous ones retired. The served bundle changed and carries the attach sheet's own strings, with «Музыка»
absent. Gates: typecheck clean, unit 1783 of 1783, routing matrix 15 of 15, production build clean, server tests
58 of 59 with one pre-existing foreign failure. Rollback: fast-forward `main` back to `0b69e38`.

Still to do after it: run the preview backfill, which needed the worker to carry the D-116 rule and now can, and
ask the tester to retry the video that failed, now that the send path names the file and the server's own reason.

## Last Confirmed Deploy Baseline

**Current: `84963d1`, deployed 2026-09-12 at 21:29 MSK.** The filter row's scroll arrows, the mechanism
lifted into a shared hook, and the register entries that close D-156 and open D-157.

Verified by reading the running container's own image tag —
`l64kyyu1sysev2izzjjbizhe:84963d1f340cc7429b19498de20aa53605eaa235`, the commit's full SHA — its health, and
the rollover: the previous container on `9c58247` had gone, one replica remained, and no build was still
running. `sw.js` answers `e1b8b92a787c7cc9` on six consecutive requests.

Then the bytes. The page's asset changed from `index-B1n3R-R-.js` to `index-BDTg7n-j.js`, and on the
new one the three controls («Выберите диалог», «Конфиденциальность», «Поддержка») are present and the marker
`Прокрутить фильтры` is found — the arrows' own labels, which exist only since this commit;
`Прокрутить папки` would have been no discriminator, since the folder strip has had them all along.

**The rollover window, caught by the probe itself, which is what this entry is really for.** Three consecutive
rounds in the middle of the swap fetched **144 bytes** — the stale asset name answered by the container that had
already moved on. An hour earlier exactly that reading made me believe a deploy had not landed. This time the
probe checked its controls every round, found them missing, and wrote «probe unreliable, not a verdict» instead of
reporting a verdict at all. Two rounds proved themselves and were counted; three did not and were not. That is the
whole difference between a measurement and a guess, and it cost one extra line in the loop.

Rollback: fast-forward `main` back to `9c58247`.

**Superseded:** `9c58247`, deployed 2026-09-12 at 20:48 MSK. Verified by reading the running container's own
image tag — `l64kyyu1sysev2izzjjbizhe:9c582479629ad147d89333f225710a997fd8c0bd`, the commit's full SHA —
its health (`Up … (healthy)`), and the rollover: the previous container on `245e4d9` had gone and one
replica remained, with no build still running. `sw.js` answers the id `533b119180156a9a` on six
consecutive requests, which is the same one-replica proof the previous baseline used.

Then the live files, with controls, because a probe that finds nothing and a probe that reads nothing look the
same. The served bundle carries `search-type-filters`, `Фильтр по типу` and `search-type-filter-` —
today's row of type filters — while `openGlobalSearch` is **absent**, which is the deleted palette's event
proved gone rather than assumed gone. The controls «Выберите диалог», «Конфиденциальность» and «Поддержка» are
present, so the absence above is a real absence. The stylesheet is served as `index-Du7qh2Mh.css` — the same
filename the validating build produced locally — and declares `--kub-bottom-nav`, the capsule's height, new in
this deploy. All four product images are served **byte-identical** to the committed files, compared by checksum.
`/`, `/privacy` and `/login` all answer 200.

**One number differs and it is not a discrepancy, recorded so nobody re-discovers it as an alarm.** The served
`sw.js` id is `533b119180156a9a`; the local validating build of the same commit produced
`60d1bb25848174d7`. The id is therefore not derived from the sources alone. What proves the deployed artefact
is this commit's is the pair that *is* content-derived: the container's image tag carries the full SHA, and the
stylesheet's content-hashed filename matches the local build exactly. Use the id for «one replica, answering
consistently», never for «the same build as mine».

Gates at that commit: typecheck clean, production build proved by its own `sw.js build` and `built in` lines,
unit suite **1858 of 1858**, the fixture Playwright set **41 passed and 0 failed** with all 31 skips accounted for
by project (desktop-only tests on the phone project, the routing matrix outside its width, one long-standing bot
skip), and the signed-in `global-search` spec **2 of 2** against the production backend with screenshots,
traces and video switched off and nothing written to disk.

**An instrument fault worth copying the fix for.** The first check of the live bundle read 144 bytes and found
none of its markers — because it asked for the *previous* build's hashed filename, which the new container does
not have. A stale asset path answers small and looks exactly like «not deployed yet». Take the asset URL from the
page on every attempt, and keep a control string that must be present: here the 144-byte response failed the
controls too, which is what exposed it.

Rollback: fast-forward `main` back to `245e4d9`.

**Superseded:** `245e4d9`, deployed 2026-09-12. Verified by reading the running container's own image tag
(`l64kyyu1sysev2izzjjbizhe:245e4d9714683323c4d169932646d8b6975de5e9`, the commit's full SHA), its replica count
after the rollover (one), and then the live files: the stylesheet declares `--kub-window-caption` and
`--kub-chat-track`, and `sw.js` answers the id `b6200ce4f3b7741a` on six consecutive requests. Gates at that
commit: typecheck clean across four packages, unit suite 1832 of 1832, routing matrix 15 of 15, production build
clean. Rollback: fast-forward `main` back to `17a1c47`.

**Superseded, and kept because its evidence pattern is the one to copy:** `45971c6`, deployed 2026-09-11.
Verified by reading the running
container's own image tag (`l64kyyu1sysev2izzjjbizhe:45971c602962…`), its healthcheck and its replica
count, and then by fetching the live files: `index.html` carries
`viewport-fit=cover`, the installed-app marker and `Alt-Svc: clear`; `sw.js`
carries its `@kub-sw-build` line with the 16-character id `fe02060fc5256c77`, and a
fresh browser loading the page ends up with exactly one cache, named by that id;
the stylesheet declares `--kub-safe-top` and the status band's `#3d78b8`. Before
the push, the same checks against `a30e392` found `Alt-Svc: clear` and none of the
rest.

Production QA as a guest, the public home only and nobody signed in: 9
checks passed across Chromium at 1440, WebKit at 393, and Chromium at 390
standing in for the installed app in the light theme (`navigator.standalone`
answered true, the notch's inset given to `env()` by the engine): viewport-fit
served, one cache named by the build, no band in a Safari tab, and a 59px band
of `rgb(61, 120, 184)` in the stand-in.

It carried the 2026-09-11 wave, validated as one tree
(`docs/QA_RESULTS.md`, 2026-09-11):

| area | what shipped |
| --- | --- |
| service worker | a new worker on every deploy, and the handoff that spares a page already on the new build (D-072); the offline page only for navigations (D-073); no backend host list (D-074) |
| installed iPhone app | drawn edge to edge with every edge reading the insets (D-075), the composer (D-076), the support window (D-077), the sidebar menu (D-078), the message menus, and the light theme's status band in blue (D-079) |
| chat | the inline time no longer wraps its spacer at phone widths (D-070) |
| tests and gates | named dropped tests, the production-write gate, the Windows QA bundle check, and the worker test that raced |
| database | the two 2026-09-11 changes were applied directly beforehand (Priority 2); their migration files ship here for the record |

Two things worth knowing after this deploy. Every browser and installed app
installs the new worker on its first launch, and that worker deletes
`kub-app-shell-v2`, so Cache Storage shrinks once for everyone. And the
installed iPhone app reads its `apple-mobile-web-app-*` tags only when it is
added to the home screen, so a device check of D-075 and D-079 needs the icon
removed and added again.

**Previous: `a30e392`, running from 2026-09-07.** This section had last
recorded `4f67e45`.

**Before that: `4f67e45`, deployed 2026-09-06.** Verified the way every deployment
in this stage was: by reading the running container's own image tag, its
healthcheck and its replica count, and then by fetching a live asset to confirm
the change reached a reader. A webhook firing is not evidence that anyone
received anything.

Three pushes went out after the staged interface batches below, each validated
at its own commit:

| tip | what it carried |
| --- | --- |
| `20feafc` | the flat stage track on the Windows startup screen |
| `07b3c82` | Windows 0.2.12 |
| `4f67e45` | the chat header WebKit fix, `pb-safe`, `Alt-Svc: clear`, Windows 0.2.13 |

Two live checks worth repeating after any web deploy, because both have failed
silently before: `curl -sI https://app.letscube.ru/index.html` must carry
`Alt-Svc: clear` (nginx replaces the inherited `add_header` set rather than
adding to it, so a location that grows a header of its own drops this one), and
the served stylesheet must contain
`padding-bottom:env(safe-area-inset-bottom,0px)` (`pb-safe` resolved to nothing
at all for months and looked deliberate in the source).

**HTTP/3 is off at the proxy as of 2026-09-06**, on the owner's instruction.
Traefik advertised `Alt-Svc: h3=":443"; ma=2592000`, and a VLESS/REALITY tunnel
carries TCP only — its iOS clients commonly drop UDP 443 so QUIC cannot leak
around the proxy — so an affected browser spent a full connect timeout on every
navigation for up to thirty days. The flag is removed from
`/data/coolify/proxy/docker-compose.yml`, backed up beside it as
`docker-compose.pre-http3-off.20260906-170416.yml`; rollback is that one flag
and a proxy restart, which briefly drops every service. Nothing in the product
needs UDP: no `RTCPeerConnection`, voice and video captured with `getUserMedia`
and uploaded over HTTPS, realtime over a WebSocket.

Two things checked and found irrelevant while diagnosing that, recorded so they
are not checked again: the server does no IP, geo or fail2ban filtering of VPN
exits, and ufw's missing `443/udp` rule does not matter because Docker's
published-port DNAT runs ahead of ufw and did forward UDP.

**Previous: `8bff49f`, deployed 2026-09-05/06 in four staged pushes.** The
staging was deliberate — the interface work changes how the whole product looks,
and shipping it apart from the fixes means a regression points at one batch
rather than at twelve commits.

| batch | tip | what it carried |
| --- | --- | --- |
| 1 | `5fcc6dd` | Windows startup screen rebuilt with real TLS fingerprints; the storage relocation fix; the material foundation; chat sync repairs; the file name that arrived as the sender's caption |
| 2 | `7837286` | `/privacy` printing in one column; the guest-session fixture dated from the run; a flake that was a race, not a threshold |
| 3 | `0f3c0cd` | the cascade-layer move; seven interface findings closed; the fourth text colour |
| 4 | `053aeb6` | the visual redesign: quieted material, glass that shows content, one focus language, the type scale, border discipline |
| 5 | `8bff49f` | realtime channels split per table |

Each batch was validated at its own commit before shipping — batches 2 and 3 in
a throwaway worktree, because a green run on the full tree says nothing about
whether a batch works **without** what sits above it. That caught three
failures in batch 2 that turned out to be a missing production build, which the
tests refuse to proceed without rather than passing trivially.

Every deployment was verified by reading the running container's own image tag,
its healthcheck and its replica count, and then by fetching the live stylesheet
to confirm the change reached a reader. A webhook firing is not evidence that
anyone received anything.

Rollback is a fast-forward of `main` to the previous tip in that table.

Three production database repairs were applied in the same window, each with a
verified schema backup taken first and each ending in a check that raises
rather than reporting success on a half-applied state. They are in
`.migration-backup/supabase/migrations/`: `20260905140000` gave back the
execute permission that had stopped **every** client upload for 37 hours;
`20260905150000` fixed a UUID pattern of 8-4-4-12 that had made two storage
paths unreachable since May; `20260906120000` and `20260906130000` published
four tables whose realtime bindings had never delivered.

- Previous baseline, superseded: `5da93e0` (public home with downloads and the
  compact Stable changelog, over the previous single-scroll folder editor,
  grouped emoji pickers, privacy-safe verified-phone search, Windows
  notification routing and chat-history anchoring baseline). `main` was
  fast-forwarded from `7a99f52` to `5da93e0` on 2026-09-02, taking 63 commits, so
  it no longer diverges from the branch the Bot Gateway canary was cut from.
- Deployed revision verified by behaviour, not by assumption: the live page
  renders the macOS and iPhone/iPad status as `В разработке` and joins the
  summary with `и` ("Windows и Android доступны для загрузки; macOS и iOS в
  разработке"). Both strings exist only in `5da93e0`. The served bundle changed
  from `index-Do_cSPEY.js` to `index-DY4jgnIu.js` roughly 150 seconds after the
  push. The Coolify deployment id, its healthcheck result and the replica
  replacement were not read from Coolify in this session and are therefore not
  recorded here.
- Coolify app: `letscube-web`.
- Public app: `https://app.letscube.ru`.
- Auto deploy: GitHub webhook to Coolify is active for `letscube-web`. The latest UI code container completed exact commit `aff77ab82c9af30deea25781caa742b558dbecbb`, passed its healthcheck and replaced the previous rolling replica. The chat-summary and access-snapshot RPC build flags remain enabled.
- Worker auto deploy: worker-specific GitHub webhook is verified. Deployment `hjlbhqir375ia6wzmqarhswq` completed exact commit `8d20b89645b9471b4477a8566a5d23ff5cfc9027` with `is_webhook=true`, status `finished` and a healthy `/api/healthz` check. Worker `watch_paths` remain limited to worker/build/runtime paths and shared package manifests. GitHub Actions are intentionally disabled and repo workflow files/secrets were removed to avoid billing-lock email noise.
- Self-host stack: Coolify proxy, self-hosted Supabase, Mailcow, app and worker deployment are already in place.
- Bot Gateway: Coolify application `letscube-bot-gateway` (`twezs89u2m6d6ln6c0rpaqxe`) is healthy on exact commit `01d26a9225fee1cda0b8e9676b4ab03b084dec64`; deployment `z9rvt9gh3qtos2oqp3lcxoh5` passed the 2026-08-31 production canary. Creation admission is still bounded to one internal owner.
- Support mail bridge: MX/SPF/DKIM/DMARC passed on authoritative and public
  resolvers. The non-public `letscube-support-mail` worker is enabled and
  healthy after verified backup
  `/srv/letscube/backups/automated/20260729-134340`. A real outbox delivery was
  accepted by Gmail MX and external receipt was confirmed. Commit `8c1f5fa`
  fixed the IMAP fetch/flag deadlock found by the first reply; production is
  restart-free after the repair. The manually seeded QA contact HMAC was
  corrected. A second physical reply was attached to the same ticket exactly
  once, acknowledged in Mailcow and displayed in the production operator UI
  without console/network errors, completing bidirectional acceptance. A
  dedicated GitHub push webhook was added for this resource, passed its initial
  ping and has auto deploy enabled; the next matching support-mail source push
  still needs to prove a deployment with `is_webhook=true`.
- Support notification fanout: migration
  `.migration-backup/supabase/migrations/20260801100856_support_email_pool_notifications.sql`
  is active after verified backup
  `/srv/letscube/backups/pre-migrations/20260801-101035-before-support-email-pool-notifications.dump`.
  The production DB smoke covers creation fanout, first-message dedupe and
  later unassigned requester replies inside `BEGIN ... ROLLBACK`. Client roles
  cannot execute the internal trigger helper. No support-mail source changed in
  this stage, so a webhook deployment was intentionally not manufactured.
- Production domains verified on 2026-07-09: `app.letscube.ru`, `deploy.letscube.ru`, `core.letscube.ru`, `mailserver.letscube.ru`, `notify.letscube.ru`, and SSH host `ms.letscube.ru` resolve and expose their expected services with valid TLS where applicable.
- `api.letscube.ru` now serves the read-only native release catalog with valid TLS through Coolify application `letscube-releases`; `status.letscube.ru` and `monitor.letscube.ru` remain reserved future endpoints.
- The installed Supabase MCP connector still targets the legacy cloud project. Production self-host checks must use `core.letscube.ru`, the local secret-safe env file, or read-only SSH/database inspection.

## Completed Baseline - Do Not Rebuild Without A New Finding

- `[x]` Self-host migration foundation: app, Supabase, Storage/media, mail delivery, and Coolify deployment moved to the server.
- `[x]` Docker subnet conflict with hoster gateway identified and avoided by custom Docker address pools.
- `[x]` Mail delivery baseline: Mailcow DNS, DKIM, PTR, external smoke, Supabase recovery email delivery and branded recovery template.
- `[x]` Auth copy: signup and recovery messages are generic and do not reveal account existence.
- `[x]` Password recovery route and UI flow work with self-hosted mail.
- `[x]` Existing-account signup cannot be used to obtain access to an existing user account.
- `[x]` Yandex SmartCaptcha gateway protects signup and recovery.
- `[x]` Direct public signup/recovery bypass paths are blocked at the proxy layer.
- `[x]` Auth gateway has in-function rate limiting before CAPTCHA/Auth calls.
- `[x]` Login token endpoint HTTP 429 maps to friendly Russian UI copy.
- `[x]` Invite code/link flow exists, with invite-only mode controlled from the admin panel.
- `[x]` Invite code field is hidden when invite-only mode is off; preconfigured invite links apply role/club in the background.
- `[x]` Reserved admin-like usernames are blocked for non-admin users.
- `[x]` RLS smoke and anon REST probes exist and cover authenticated/anonymous boundaries.
- `[x]` Group invite non-member hardening proposal was applied manually after explicit approval.
- `[x]` Notification center tabs and grouping are in place.
- `[x]` Message notification read-sync/grouping baseline is in place.
- `[x]` Chat scroll anchoring baseline: no unread -> bottom, unread -> first unread, search/notification jumps preserved.
- `[x]` LETSCUBE visual cleanup: auth branding, duplicate sidebar logo, mascot placement, and visible KUB/KUB text cleanup are done.
- `[x]` Unified interface chrome: one desktop wordmark, aligned shell dividers, compact media quality selector, factual welcome state, real-data admin dashboard and integrated Windows titlebar are complete.

## Priority 1 - Auth And Anti-Abuse

Status: `[x]` baseline complete. Keep as regression guard.

Goal: public auth endpoints must not allow bot signup, password guessing, recovery abuse, or CAPTCHA bypass.

Definition of done:

- `[x]` Signup and recovery go through the Yandex SmartCaptcha auth gateway in the public app.
- `[x]` Direct public bypass paths to sensitive Supabase Auth endpoints are blocked or rate limited at the proxy layer.
- `[x]` Login, signup, recovery, verify, resend and token endpoints have server-side throttling or gateway protections.
- `[x]` User-facing auth errors do not reveal whether an account exists.
- `[x]` Existing users cannot obtain a session through the registration screen.
- `[x]` 429/rate-limit errors map to friendly Russian UI copy.
- `[x]` Auth abuse checks have repeatable smoke tests and operational verification commands.

Keep checking:

- `[ ]` Run gateway/no-direct-auth Playwright checks when CAPTCHA env is enabled.
- `[ ]` Add an operator-facing auth anti-abuse smoke script if repeated manual curl checks become noisy.
- `[ ]` Revisit stronger account creation controls only if abuse continues despite CAPTCHA/rate limits/invite mode.

## Priority 2 - RLS And Security Audit

Status: `[x]` baseline complete. Keep as regression guard.

Goal: authenticated users can only read/write rows, objects and RPC effects allowed by membership, role, location and task permissions.

Definition of done:

- `[x]` All inspected exposed public tables have RLS enabled.
- `[x]` Public views are absent or use `security_invoker` / restricted grants.
- `[x]` Anonymous REST exposure checks exist.
- `[x]` Authenticated role boundary checks exist.
- `[x]` Storage policies for media, avatars and task attachments are path-scoped and role-aware.
- `[x]` SECURITY DEFINER function hardening is tracked through proposals when needed.

Keep checking:

- `[ ]` Run `pnpm.cmd rls:anon-rest` in security-stage validation.
- `[ ]` Run `pnpm.cmd rls:smoke` in security-stage validation.
- `[ ]` Run `KUB_QA_ALLOW_MUTATIONS=1 pnpm.cmd rls:smoke` only when mutation fixture validation is needed.
- `[ ]` Create new SQL proposals only for concrete drift or a verified gap.

Changes applied 2026-09-11, on the owner's approval. Each had a verified schema backup first, ran as one transaction with a self-check that raises instead of committing a half-applied state, and is recorded byte-identical in `.migration-backup/supabase/migrations/`:

- `[x]` `20260911120000_private_chat_owner_delete_repair.sql` (`7c6482f`). `Chat owners delete chat` allowed DELETE on any chat the caller owns, with no condition on type, and `trg_add_chat_creator_as_owner` makes whoever opens a private chat its owner — so either participant could delete the conversation for both sides, messages and media included through `trg_mark_chat_delete_cascade`, by calling the API directly. The interface only offers hiding a private chat for yourself; 24 private chats carried such an owner row. Found by the testers' complaint triage (queue item 21, point 9). Now `using (public.is_chat_owner(id) and type <> 'private')`. Confirmed first that the "block banned writes (delete)" guard on chats is RESTRICTIVE. No rehearsal database with this schema exists (the `bot-rehearsal-*` stacks hold only the gateway schema), so the proof was taken read-only on production: `EXPLAIN` without `ANALYZE` in a read-only transaction shows the RLS filter a DELETE gets without running it — before, the private owner filter was `NOT is_banned AND is_chat_owner(id)`; after, `private_chat_delete_allowed_now=false` and `group_chat_delete_allowed_now=true`. Backup `/srv/letscube/backups/db-schema/pre-20260911120000-private-chat-owner-delete-20260911T004702Z.sql`, 907027 bytes, sha256 `93ed2f10…83584a3`; migration sha256 `aaa53728…`.
- `[x]` `20260911130000_revoke_unfiltered_table_privileges.sql` (`dc0d39c`). `anon` and `authenticated` each held TRUNCATE, TRIGGER and REFERENCES — which RLS never filters — on the same 36 tables in `public`, among them `roles`, `permissions` and `user_global_roles`, and the default privileges re-granted them on every new table. Not reachable through PostgREST or pg_graphql, so hardening, not a live hole. No function contains TRUNCATE and no event trigger re-grants in `public`; platform schemas were left alone. A driver refused unless the database was still 36/36, and the self-check refused unless all three were gone with every SELECT/INSERT/UPDATE/DELETE grant unchanged. After: unfiltered 0; row-filtered grants identical (anon S39 I36 U36 D36, authenticated S51 I37 U37 D36); defaults `anon=arwd`, `authenticated=arwd`; live PostgREST as anon unchanged (`cosmetics`, `achievements`, `product_milestones` 200 before and after; `folders`, `profiles`, `chats` 401 before and after). Backup `/srv/letscube/backups/db-schema/pre-20260911130000-revoke-unfiltered-privileges-20260911T005817Z.sql`, 907059 bytes, sha256 `15fbd852…4240cf56`; migration sha256 `510a5a28…`; the rollback grant list is in the migration header. An earlier inline attempt never reached the database — the shell rejected an unbalanced quote — and the database was confirmed unchanged before the scripted retry.
- `[x]` Read-only audit alongside: RLS enabled on 61/61 tables in `public`, no RLS-off table readable or writable by anon/authenticated; no view in `public` readable by them without `security_invoker`; all 37 "block banned …" policies RESTRICTIVE, and the 33 permissive "… blocked" policies literally `false` on tables that grant writes to nobody else. Pre-existing and deliberately left: anon reads on tables guarded by "block banned" fail with `42501 permission denied for function is_banned` (HTTP 401) instead of an empty set — access fails closed, which for anon is correct.

## Priority 3 - Backup And Restore Drill

Status: `[!]` follow-ups deferred by user on 2026-06-22.

Goal: a full LETSCUBE production restore must be executable from backups without relying on memory or ad hoc commands.

Guardrails:

- No SQL changes in this stage unless explicitly requested.
- No restore into production.
- No destructive remote cleanup during inventory.
- No env, token, database password, SMTP password, or secret contents in repo/docs/logs.
- Restore rehearsal must use an isolated temporary target.

Definition of done:

- `[x]` P3.1 Read current backup status and runbooks before making changes.
- `[x]` P3.2 Record read-only live inventory: backup directories, scripts, timers, cron, Docker volumes, Supabase/Mailcow/Coolify config locations.
- `[x]` P3.3 Confirm Postgres logical backup command and retention policy.
- `[x]` P3.4 Confirm Supabase Storage/media backup command and retention policy.
- `[x]` P3.5 Confirm Coolify, Mailcow, Caddy, Supabase compose/env/config, and ops docs are backed up without exposing secret values.
- `[x]` P3.6 Add or update backup scripts only if missing, idempotent, and secret-safe. Existing scripts are present; no script update was needed during this inventory pass.
- `[x]` P3.7 Run non-destructive backup verification: archive listing, metadata checks, row/object counts where safe.
- `[!]` P3.8 Prepare isolated restore target plan and get explicit approval before any restore. Deferred.
- `[!]` P3.9 Rehearse restore into isolated target. Deferred.
- `[!]` P3.10 Verify restore: row counts, key tables, Storage object counts, basic app smoke. Deferred.
- `[x]` P3.11 Decide and document temporary off-server/offsite backup destination. Temporary target is a private GitHub repository with client-side encrypted chunks; permanent backup storage remains a later replacement.

Current baseline:

- Infrastructure docs describe backup/restore expectations.
- Self-host migration placed operational files under `/srv/letscube`.
- Server backup inventory and non-destructive verification are recorded in `docs/infra/BACKUP_RESTORE_STATUS_20260622.md`.
- Latest verified local backup set: `/srv/letscube/backups/automated/20260622-034450`.
- Latest backup checksum verification: passed.
- Temporary GitHub offsite backup is configured and encrypted before upload.
- GitHub offsite target: private repository `ALTIS13/letscube-encrypted-backups`.
- Server upload script: `/srv/letscube/scripts/letscube-github-offsite-backup.sh`.
- Server timer: `letscube-github-offsite-backup.timer`.
- Latest controlled GitHub offsite sync: completed for `/srv/letscube/backups/automated/20260622-034450`.

Next action:

- `[!]` Monitor the first scheduled GitHub offsite timer run on 2026-06-23. Deferred by user.
- `[!]` Replace temporary GitHub storage with a dedicated backup target (`rclone`, `restic`, or `borg`) when available. Deferred until backup environment is ready.
- `[!]` Prepare an isolated restore target plan and get explicit approval before any restore. Deferred.

## Priority 4 - Operator Security Observability

Status: `[x]` baseline complete. Keep as regression guard.

Goal: make auth abuse, invite-code abuse, and suspicious registration/login patterns visible to operators without leaking sensitive data.

Candidate work:

- `[x]` Add or document an operator smoke command for auth gateway rate limits and direct-auth bypass checks.
- `[x]` Add an admin-facing or ops-facing view/report for recent auth/invite security aggregates if product-safe.
- `[x]` Ensure reports do not show raw secrets, passwords, CAPTCHA tokens, recovery tokens, or full IP data unless explicitly approved.
- `[x]` Keep this separate from CAPTCHA/rate-limit implementation unless new gaps are found.

Current baseline:

- Operator smoke script: `scripts/auth-anti-abuse-smoke.mjs`.
- Package command: `pnpm.cmd auth:anti-abuse:smoke`.
- Runbook: `docs/security/AUTH_OPERATOR_SMOKE.md`.
- Default smoke checks direct `/auth/v1/signup` and `/auth/v1/recover` protection without creating users.
- Default smoke checks `auth-yandex-gateway` signup/recovery no-CAPTCHA handling.
- Repeated gateway rate-limit stress is opt-in through `--stress-rate-limit` or `KUB_AUTH_SMOKE_STRESS_RATE_LIMIT=1`.
- 2026-06-22 live smoke result: direct signup/recovery returned 403, gateway no-CAPTCHA returned `captcha_required`, opt-in stress observed 429 `rate_limited` on repeated gateway attempts.
- Admin/Ops report UI: `/admin/ops`.
- Admin/Ops report runbook: `docs/security/ADMIN_OPS_REPORT.md`.
- Admin/Ops report SQL proposal: `.migration-backup/supabase/migrations/20260622_admin_ops_security_report.sql`.
- SQL was not applied automatically. Until the RPC is applied, `/admin/ops` shows a friendly migration warning and still displays frontend protection status.
- The report intentionally returns aggregate counts and sanitized invite/auth event labels only; it does not show email, IP, password, CAPTCHA/recovery/push tokens, actor IDs, or target IDs.

## Priority 5 - Installed Web/PWA Production Shell

Status: `[~]` active. The iOS-only install policy and Android/Windows release catalogs are deployed. iPhone/iPad-specific implementation and physical QA are owned by a separate agent and must not be duplicated here.

Goal: retain the full browser client on every platform, expose PWA installation only on iPhone/iPad, and direct Android/Windows users to dedicated native packages.

Scope:

- `[x]` Refresh PWA shell identity: document title, Apple app title, manifest name/short name and install metadata use `LETSCUBE`.
- `[x]` Add platform-aware Settings distribution state: iPhone/iPad PWA, Android APK and Windows EXE. Android/Windows no longer render a PWA CTA or receive a manifest link.
- `[x]` Add a five-second, six-hour cached release check with stale fallback, strict manifest/SemVer/SHA validation and honest system download handoff without fake byte progress.
- `[x]` Deploy read-only `https://api.letscube.ru/releases/` through non-root Nginx/Coolify with SSH-only atomic publishing, CORS, no-cache manifests and immutable artifacts.
- `[x]` Verify PWA manifest, service worker registration, offline/reconnect banner and direct app-shell routes across desktop/mobile Playwright viewports.
- `[x]` Verify browser/PWA push contract: stable notification tags, same-tag close behavior, click routing, and no raw media/token fields in SW payload handling.
- `[x]` Harden browser/PWA push lifecycle: reconcile subscriptions on startup/focus/reconnect, detect stale VAPID keys, close read same-tag cards on active clients, update the installed-app badge, and preserve DB `read_at` as the cross-device source of truth.
- `[x]` Add Web Push `Topic` isolation and a backward-compatible Declarative Web Push fallback for iOS/iPadOS 18.4+ without changing Browser/PWA subscription semantics.
- `[x]` Remove the dual-dispatcher race: Supabase Cron/`send-push-notifications` owns production Web/FCM delivery; the legacy API push loop is off by default and cannot consume the same outbox unless explicitly enabled for isolated local testing.
- `[ ]` Verify the installed iPhone/iPad Home Screen window without browser chrome.
- `[ ]` Verify real browser/PWA push delivery and notification click routing against a live installed client.
- `[x]` Verify automated iOS manifest injection and confirm Android/Windows browsers are not offered PWA installation across all five Playwright viewports.
- `[ ]` Preserve full messenger functionality: auth, chats, media, camera, voice, video-circle, tasks, search, notifications.
- `[x]` Keep release signing material out of Git. The verified signed `0.1.3/4` APK passed release review and is published in Stable, superseding `0.1.2/3`; its AAB remains under ignored local storage and was not uploaded to Play Console.

Current baseline:

- The Android `0.1.3/4` signed APK is published in Stable. Its public manifest
  and fresh HTTPS download match the 6,744,616-byte canonical artifact and
  SHA-256 `7704944572e7c97150e159f3326b65b936fee1d11c0b01d852132423dc509863`,
  re-measured 2026-09-05. The superseded `0.1.2/3` was 6,513,250 bytes with
  SHA-256 `d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`.
  Baseline and final APKs produced byte-identical tracked Digital Asset Links
  JSON, while the old debug signature correctly failed in-place upgrade. The
  official-GMS Nothing device retained both a non-sensitive app-local sentinel
  and an authenticated QA session/chat/native-notification registration through
  the same-key upgrade. The matching AAB remains local and unpublished.
- Task 4 fix round 1/5 made the Asset Links verifier exact and cleared the
  production-preview browser gate (`e2e:smoke` 5/5; targeted 66 passed with four
  fixture-inapplicable mobile skips). One bounded Nothing login submission did
  not leave the login form, so authenticated upgrade/FCM remain open without a
  retry. Final safe lifecycle/callback checks passed on the official-GMS
  Nothing and sequential API 33/34/36 Google Play AVDs.
- Task 4 fix round 2/5 used the controller-approved temporary same-key QA
  baseline, but Android 15 exposed no WebView devtools socket and the single
  bounded CDP forward returned zero targets. The helper was not invoked. The
  temporary call was removed from source and compiled bytecode before the real
  final rebuild; final `0.1.2/3` is non-debuggable, strictly verified and has
  exact same-key Asset Links parity. Authenticated physical acceptance remains
  blocked on establishing a safe QA session.
- Task 4 fix round 3/5 used the separately authorized ignored QA baseline with
  temporary WebView debugging and `android:debuggable=true` to establish one
  bounded CDP-authenticated session. Final source/Gradle/version state was
  restored before rebuilding and upgrading to non-debuggable `0.1.2/3`.
  Session/chat/registration retention and post-DND background/killed grouped
  system-card, exact-chat tap and read-sync checks passed. Foreground
  realtime/in-app reconciliation passed, but independent foreground FCM
  transport remains unproven. Physical media/geolocation/history/footer checks
  remain skips after UIAutomator could not expose the attachment controls and
  the bounded device run was stopped.
- Task 4 fix round 4/5 used one controller-approved same-key, same-version
  debuggable QA overlay on official-GMS Nothing for bounded CDP instrumentation.
  Independent foreground FCM transport, authenticated offline/reconnect, a
  visible first-unread anchor and bounded geolocation passed. The overlay was
  replaced by restored-source, strictly verified, nondebuggable final `0.1.2/3`;
  the authenticated shell survived and all round-4 helpers/forwards were removed.
- Task 4 fix round 5/5 passed explicit physical logout, bounded helper login,
  cold authenticated session restore, fully-read/no-unread initial bottom,
  fast-upward stability, older-history prepend anchoring and sampled footer/
  timestamp stability. Synthetic media staging passed video-only quality,
  original selection and local preview playback, but no upload was sent because
  an isolated QA-only target was not proven within two minutes. Product upload
  progress/completion/sent playback/cleanup and camera/photo/regular-video/
  video-circle/voice remain physical skips, so Task 4 remains open.
- Controller closeout after the round cap proved a strictly QA-only product
  upload larger than 6 MiB with upload/send progress, completion, sent playback
  and product cleanup. Camera/photo, regular video, video-circle and voice each
  passed live/record/stop/cancel coverage without retaining or sending captured
  environment. Final `0.1.2/3` was rebuilt from restored production source,
  reinstalled nondebuggable with authenticated-shell retention, and all debug
  helpers/forwards were removed. Task 4 local physical acceptance is complete.
- The canonical local APK/AAB are the current restored-source Gradle outputs.
  Signed ZIP byte identity is not expected across independent rebuilds;
  package/version, nondebuggable state, signer/Asset Links parity and strict
  APK/AAB validation are the authoritative equivalence checks.
- Android final-review hardening is complete: callback recovery cannot reuse an
  unrelated persisted session, callback credentials are replaced out of browser
  history before exchange, and the release verifier rejects APKs without a v2
  signature. Canonical `0.1.2/3` was rebuilt and revalidated after these changes.
- The latest production web deployment is healthy. Live recovery opens the new
  password screen and removes callback query/fragment credentials from history;
  live Asset Links has exact final signer parity. Warm, cold and force-stopped
  implicit HTTPS routing passed on Realme under an approved association state.
  Realme's background-restricted OEM verifier is not counted as authoritative;
  the fresh system recheck on official-GMS Nothing returned
  `app.letscube.ru: verified` for the installed final package.
- `artifacts/kub/index.html` title and Apple web app title are `LETSCUBE`.
- `artifacts/kub/public/manifest.json` uses `LETSCUBE`, `display: standalone`, and `display_override` fallbacks.
- The iPhone home-screen icon uses a dedicated 180x180 LETSCUBE club asset; 192/512/maskable PWA icons use the same official mark, and the service worker precaches the complete icon set.
- Settings distribution block shows `iPhone/iPad / iOS PWA`, `Android APK`, `Windows EXE` or web-only status. Native manifests refresh on Settings open/resume without blocking app startup.
- The Windows stable download and both native updater catalogs offer LETSCUBE `0.2.8` build `12`. Their immutable 2,322,508-byte installer and adjacent updater signature passed server-side `minisign` verification. Public manifests agree on SHA-256 `697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd`; the versioned artifact returns immutable caching. The production handoff keeps one fixed scene across navigation, remains readable for at least 2.2 seconds and holds the confirmed state for at least 0.9 seconds before fading. Explicit client/server ports bound the two rail halves outside both device bodies, and font loading or the connected state cannot change endpoint geometry.
- `letscube-releases` deployment `x11jjzh6qbcnszndx5av5paj` finished exact commit `491e172`; TLS/health, 404 listing denial, POST denial, CORS/cache headers and Android artifact size/SHA parity passed.
- `tests/e2e/pwa.spec.ts` covers PWA shell metadata, service worker safety, offline/reconnect banner, and SPA direct routes on 1440, 1920, 3840, 390 and 412 viewports.
- `tests/e2e/pwa-install-settings.spec.ts` covers desktop install variant and iPhone Safari home-screen guidance from the Settings install button.
- `tests/e2e/push-phone-foundation.spec.ts` covers push settings layout, phone fallback, SW push grouping/click-routing, native push adapter token hygiene and Android channels on the same viewport matrix.
- 2026-07-12 production audit found one Apple subscription stale since 2026-06-22 and historical HTTP 403 delivery failures. A live probe proved two consumers were racing one outbox: the legacy five-second API worker failed with sanitized Apple `BadJwtToken`, while the canonical Edge cron subsequently delivered the same row. The API loop is now opt-in only; current web/Edge VAPID fingerprints match and the VAPID keypair is valid.
- A post-deploy Apple Web Push probe completed through the canonical Edge cron with `attempt_count=0` and no delivery error. The QA notification and outbox rows were removed afterward; physical iPhone background/card/tap confirmation remains the release gate.
- Same-chat OS push replacement is intentional: the latest card represents that chat. Different chats/tasks remain isolated by tag and hashed Web Push Topic; the in-app Notification Center retains grouped semantic rows and unread counts.
- Client-side chat media optimization baseline is in place: new image attachments and avatars are bounded before upload when possible; new image/video messages carry dimensions/size metadata for stable bubble layout.
- The trusted media worker now produces bounded `video_720p` MP4 derivatives. Frontend quality metadata is explicit for new image/video messages; compact/standard video playback uses a ready derivative and safely falls back to the original while high quality always uses the original.

Next media/performance action:

- `[~]` Media variants pipeline:
  - `[x]` Applied `.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql` to self-host Postgres after a schema backup.
  - `[x]` Added optional server-side `kub-worker` runtime target/service for trusted media processing; frontend still receives no service-role secrets.
  - `[x]` Added image message variants (`image_thumb`, `image_preview`) and user avatar variants (`avatar_128`, `avatar_256`) generation through `artifacts/api-server`.
  - `[x]` Wired frontend read path to prefer ready message image variants and user avatar variants over original media where available. Avatar variants for chat peers need manual application of `.migration-backup/supabase/migrations/20260623_avatar_variants_read_policy.sql`.
  - `[x]` Raised self-host Supabase Storage upload size for `supabase-storage` to 250 MB and verified a 60 MB object upload/delete through the Storage API.
  - `[x]` Added server-side video poster generation (`video_poster`) through the trusted worker and wired chat video bubbles to use ready posters.
  - `[x]` Wired chat info media gallery to use ready image/video variants for tiles instead of loading original media files.
  - `[x]` Reproduced and fixed fast upward scroll jump in long chat history: user wheel/touch/pointer input now cancels initial bottom settling so quick upward scrolling is preserved.
  - `[x]` Added bounded `video_720p` transcoding and upload/playback quality selection. The worker uses H.264/AAC MP4, maximum 1280x720, preserved aspect ratio, no upscaling, even dimensions, `yuv420p`, fast-start, two ffmpeg threads, and a ten-minute timeout. The frontend polls only chats containing video, coalesces focus/visibility refreshes, bounds its chat cache, and falls back once to the original if a derivative cannot load. The candidate scan now paginates through a bounded 1,200-row window instead of starving media older than the newest 120 rows. Production contains 26 ready DB rows and 26 matching Storage objects (32,522,253 bytes), with zero invalid ready dimensions/MIME/size; two legacy video rows have no Storage source and cannot be derived.
  - `[x]` Added a hybrid Storage upload path: standard uploads through 6 MiB and TUS above 6 MiB with exact 6 MiB chunks, retry delays `0/3/5/10/20s`, previous-upload resume in the current staged session, determinate progress, stable object paths and remote partial termination on cancel. Cross-chat scopes now cover picker/image preparation, upload/send, drafts, geolocation and voice/video recorder completion. Browser QA exercised progress/cancel on all five configured viewports, and production TUS uploaded/read/deleted a 7 MiB disposable object.

## Priority 6 - Monitoring And Self-Hosted Sentry

Status: `[!]` deferred until backup/restore baseline is safe.

Goal: add production monitoring without relying on foreign unstable SaaS paths.

Candidate work:

- `[ ]` Deploy self-hosted Sentry or a lighter local monitoring alternative.
- `[ ]` Verify error capture from frontend and Edge Functions without secrets/message content/media URLs.
- `[ ]` Add uptime and synthetic checks for app, Supabase, mail, and Coolify.
- `[ ]` Add backup job failure alerts.

## Native And Desktop Packaging

Status: `[~]` active. Android and Windows Tauri internal candidates are available; production signing and update gates remain open.

- `[x]` Production debug APK connection and physical launch: the public build allowlist, LETSCUBE adaptive icons/dark splash, Android `0.1.0` versioning, install and first launch were verified on a Nothing/Spacewar A063 running Android 15.
- `[x]` Native Android FCM foundation: local ignored Firebase client config, Capacitor permission/registration/channels, live auth-scoped device RPCs, RLS-protected device/outbox schema, trusted HTTP v1 delivery and one physical background notification/tap smoke are complete.
- `[x]` Self-hosted native release catalog: Android `0.1.0` internal APK and immutable Windows Tauri `0.2.0` build `4` NSIS are available at `api.letscube.ru`; public size/SHA and cache/CORS headers were verified.
- `[~]` Native push release QA: real owner-to-client message delivery, sender exclusion, category preference suppression, same-chat collapse, server-backed chat read-sync, cold-start tap routing, killed-process delivery, separate task delivery, location-staff task routing, restart registration recovery and Android 16 Google Play emulator coverage pass. On 2026-08-26 the signed final `0.1.2/3` Nothing A063 official-GMS candidate retained authenticated session/chat/registration through a same-key upgrade and passed fresh post-DND background/killed grouped cards, exact-chat taps and read-sync. Fix round 4 separately proved independent foreground FCM transport, authenticated offline/reconnect, first-unread anchoring and bounded geolocation. Fix round 5 passed explicit logout/login/session restore and the remaining large-chat/history/footer cases; controller closeout then passed large-file upload/progress/sent playback/cleanup plus camera/photo/video/video-circle/voice controls. An earlier card absence under active DND is not counted as a delivery failure. A second Android 15 Realme device passes APK/portrait UI QA, but its custom-ROM microG cannot complete Google Check-in (`AccountDisabled`); broader vendor/device coverage remains an external release-quality action.
- `[x]` Stabilize chat message footer geometry: a physical Android probe reproduced the `inline`/`anchored` ResizeObserver feedback loop on a medium-length incoming message. Once measured overflow anchors the footer it now remains anchored until a real viewport/content change; timestamp digits and private-delivery icons reserve fixed width. The same physical probe changed from two alternating layouts to one stable layout across 160 samples.
- `[x]` Release signing/AAB with the permanent RSA-4096 PKCS12 identity and all
  signing inputs outside Git. Canonical nondebuggable `0.1.2/3` APK/AAB pass
  strict identity, signer and structure checks; the encrypted off-device backup
  remains an external operational gate.
- `[x]` Android build-environment isolation: inherited unapproved `VITE_*`,
  infra pointers and secret-shaped variables are removed before Vite/Capacitor;
  only the four dedicated signing inputs are restored for Gradle release tasks.
- `[x]` Android verified HTTPS App Links and recovery callback are implemented
  for the exact `https://app.letscube.ru/auth/callback` route, and the three
  gates this bullet used to list are closed: the official-GMS domain
  verification and the warm/cold/killed callback rehearsal are recorded in
  queue item 7, and the production deployment was re-measured on 2026-09-05.
  `https://app.letscube.ru/.well-known/assetlinks.json` is byte-identical to
  the tracked `artifacts/kub/public/.well-known/assetlinks.json` (SHA-256
  `b36206f4...da879777`), carries one statement, one relation and one
  fingerprint for `com.kub.messenger`, and that fingerprint is the certificate
  the published `0.1.3` APK is actually signed with -- proven by running
  `scripts/verify-android-release.mjs` over the downloaded artifact, whose
  association check compares the two directly. Re-run that check whenever the
  signer changes; the association, not the app, is what a signer change breaks.
- `[x]` Retire the Electron spike after QA profile leakage and excessive package weight were confirmed. Electron source, installed package and shared QA profile were removed before publishing Tauri.
- `[x]` Tauri 2 internal candidate: isolated WebView2 profile, 1.19 MiB NSIS installer, tray/close-to-hide, branded startup, single instance, minimum exact-origin capabilities, clean-profile login and hidden-window foreground notifications.
- `[x]` Tauri rollout: frontend adapter deployed, clean installed-client QA repeated, and immutable Windows stable `0.2.0` build `4` published at 1,242,693 bytes with verified SHA-256.
- `[~]` Windows public release gate: repeatable isolated Tauri/WebView2 QA, same-version repair, silent uninstall, clean reinstall and real signed cross-version updater application pass. `0.2.7/11` passes physical hidden-window message/task isolation, five-card per-chat retention, exact fresh/history notification-card routing and chat-scoped read cleanup. Its immutable signed updater artifact was verified in Test and promoted unchanged to Stable. Sparse identity tooling now renders aligned package/executable metadata and passes `MakeAppx` validation locally. The live native-device schema is still Android/FCM-only; `.migration-backup/supabase/migrations/20260724_windows_wns_push_devices.sql` is a contract-tested, unapplied delta for authenticated Windows/WNS registration and shared native outbox enqueue. Real Microsoft identity/PFN onboarding, signed NSIS integration, Authenticode/SmartScreen, broader Windows 10/11 hardware QA and killed-process WNS delivery remain open.
- `[~]` Phone OTP delivery is available only to administrators with `system.manage`. Mandatory cutoff and data-access enforcement remain disabled.
- `[x]` Harden the existing LETSCUBE support conversations before adding another support transport: deterministic initial bottom position, preserved history reading, new-message affordance, responsive height cleanup and Playwright coverage. The shared anchor observes both content and viewport resizes; the final matrix passed 30/30 across all five desktop/mobile viewports.
- `[ ]` Add a separate staff-only LANGAME support workspace after the current support UX is stable. Their official documentation exposes the authenticated individual `Чат ТП` but no public integration API; require an official API/SSO contract or use a clearly separate email bridge rather than scraping the portal.

## Next Phone Verification Rollout

Status: `[~]` p1sms delivery is restricted to administrators after physical pilot QA. The current route is Telegram first with message-scoped digital fallback branches after `agg_error`, `not_delivered` or a terminal provider error; mandatory phone enforcement remains a separate future decision.

- Keep the current no-fake-verification fallback and never mark a number verified before a real OTP succeeds.
- `[x]` Privacy-safe exact phone search is deployed through `search_profiles_by_phone(text, integer)`. It accepts only normalized `+E.164`, requires `users.view`, returns profile fields without the phone number, and includes only `phone_verified = true` contacts.
- `[x]` The profile flow uses only the authenticated phone gateway. The browser cannot update Auth phone state or mark a number verified directly; the service-only gateway does so only after a valid code.
- `[x]` 2026-08-01 production audit: Supabase Auth `v2.189.0`, phone provider disabled, SMS autoconfirm disabled, Send SMS Hook not configured, zero verified phone contacts, and zero pending/duplicate/stale `phone_change` rows.
- `[x]` Delivery architecture selected: authenticated LETSCUBE gateway -> narrow p1sms adapter. The gateway owns the provider-compatible four-digit code because deployed GoTrue `v2.189.0` enforces 6-10 digits; no unsupported Auth setting or private fork is used.
- `[x]` p1sms source foundation: strict 44-character moderated template, hard 65-character guard, one immediate `telegram_auth` message per request, message-scoped `agg_error -> digit`, `not_delivered -> digit` and `error -> digit` fallbacks, no undocumented request fields, redirect blocking, four-digit HMAC-only storage, 10-minute TTL, five verification attempts, per-user/per-phone server ceilings and safe result categories. P1SMS support confirmed that `agg_error` is a separate not-sent status. LETSCUBE neither polls delivery nor issues a second provider request. Automated validation makes no real delivery request.
- `[x]` Provider activation: `P1SMS_API_KEY` and hook/HMAC secrets remain in trusted server storage. The shared LETSCUBE account stays isolated because runtime calls only the single-message send endpoint and never calls p1sms account, sender, history, scheduling, reject, phone-base, blacklist or cascade-management APIs.
- `[x]` The earlier global rollout migration was applied after physical pilot QA, then intentionally superseded by `20260821095000_phone_verification_admin_only.sql`: the global flag is now disabled and claim creation requires `system.manage`. `20260821101000_phone_gateway_admin_only.sql` also protects capability, cancellation, removal and SMS authorization at the server gateway, and cancels stale non-admin claims. Verified pre-change backup: `/srv/letscube/backups/pre-migrations/20260821-094138-before-phone-admin-only.dump`. Cutoff and `enforce_data_access` remain disabled.
- `[x]` Configure `GOTRUE_EXTERNAL_PHONE_ENABLED`, `GOTRUE_HOOK_SEND_SMS_ENABLED`, hook URI and hook secret in the self-hosted Auth runtime; SMS autoconfirm remains disabled.
- `[x]` Resend uses a fresh gateway delivery while preserving the 120-second UI/server cooldown and server-side per-user/per-phone limits. Broader CAPTCHA/cost alerting remains a global-rollout gate.
- `[x]` The current gateway flow does not use `auth.users.phone_change`; concurrent pending claims are rejected by phone HMAC and expired/cancelled OTP material is cleared.
- Decide separately where verified phone is required: profile contact, account recovery, sensitive admin actions, or optional MFA. Do not silently require phone verification for existing users without a migration and rollout plan.
- `[ ]` Complete real-device delivery QA for correct/wrong/expired/resend codes, provider outage, duplicate-number attempts, number changes, audit events, privacy-safe phone search, and recovery/MFA decisions before enabling enforcement.

The browser client remains the universal fallback and iPhone/iPad PWA remains the only web-installed target until Android and Windows release gates pass. Packaging must reuse the same validated frontend and may not weaken browser behavior.

## Default Validation Commands

Run only the commands relevant to the touched area, but prefer this baseline before commit/push:

- `git diff --check`
- `pnpm.cmd --filter @workspace/kub run typecheck`
- `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`
- `pnpm.cmd e2e:smoke` when frontend behavior changed.
- `pnpm.cmd db:types:check` when schema/types/database code changed.
- `pnpm.cmd rls:anon-rest` and `pnpm.cmd rls:smoke` during RLS/security stages.

Known validation notes:

- Vite sourcemap/chunk-size warnings may exist and are not automatically blocking unless new.
- `db:types:check` may report known advisory drift around message media fields/search RPCs/notification outbox until those are separately resolved.

## Security Guardrails For Every Stage

- No credentials, env values, access tokens, DB passwords, SMTP passwords, Firebase keys, CAPTCHA server keys, or service-role keys in git/docs/output.
- No `service_role` in frontend/public/mobile bundles.
- No `google-services.json`, keystores, or signing secrets in git.
- No SQL apply without explicit user approval.
- No production restore, destructive cleanup, or broad firewall/network changes without explicit user approval.
- Use focused diffs and record validation results.
