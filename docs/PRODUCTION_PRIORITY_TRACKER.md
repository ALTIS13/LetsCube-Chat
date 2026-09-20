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
31. `[ ]` The interface's accumulated "особенности", recorded as a class by the owner on 2026-09-18 with a screenshot of «Обновления»: «также в задачи добавь на потом исправление подобных "особенностей" интерфейса». The full measurement is D-222 in `docs/INTERFACE_DEFECT_REGISTER.md`; what belongs here is the shape of the work and why it is not a polish pass. Two independent halves. **A viewport breakpoint deciding a layout inside a container the owner drags** — the chat-list column is 260 to 540 points wide by hand and persisted, so no `@media` width predicts it, and every `sm:` inside it reads «wide» at any desktop size; 19 occurrences over 11 lines in 5 components survive classification out of 491 live matches, which is 3.9% and essentially one screen. **`rounded-full` on a box whose text can wrap** — a pill is a pill only while it is one line high, and above that the radius clamps to half the height; ~15 sites plus two primitives (`KubBadge`, `KubFilterChip`) out of 266, and this half needs no narrow container at all. The proof that a different breakpoint number cannot fix the first half: the same three components render in both the narrow column (from `md` up) and a viewport sheet (below `md`), so at 700 points `sm:` is true and the three-column form is right, and at 1440 `sm:` is equally true and it is wrong — one breakpoint, one state, two required answers. Container queries compile natively on the installed Tailwind 4.2.1 and the spellings are recorded, with the trap that `sm:` is 640 points while `@sm:` is 384; where a decision has consequences in JavaScript the project already has the pattern, twice and with tests, in `paneFitsProfileColumn` and `paneFitsChannelRail`. Order: tier 1 (the settings screen), then the two primitives, then tier 2. Every tier-1 line needs pixels at both column extremes and in the sheet below `md`, because that dual case is the whole reason a threshold change is not the answer.
32. `[~]` Calls in a private chat, and the record each one leaves in the conversation. Asked for by the owner on 2026-09-18: «в лс между людьми также учти немаловажную часть как уведомления о звонках в чате по аналогии с telegram/discord (с отображением того успешный ли это звонок или пропущенный, сколько он длился в случае если был успешный)». **It is a slice rather than an addition, and the reason is measured rather than assumed: one-to-one calls do not exist, so the record cannot come first.** Two facts checked against the code before this was written. The **interface** refuses voice outside a group — `lib/voiceChannel.ts:230`, `voiceChannelRowOffer` answers `not_a_group` for every other chat type. The **gateway does not check the chat type at all** — `voice-gateway/index.ts` reads the channel row, then the caller's `chat_members.role`, then `is_muted`, so a `voice_channels` row on a private chat would mint a token happily. So the transport and the server are already type-agnostic, and what is missing is the **interaction**: a group channel is a place you join, while a one-to-one call is somebody *ringing* you, and nothing in this system tells the other person that somebody is calling. Five things have to exist that do not: a ring that reaches the other person in the three states they can be in (application in front, in a background tab, closed); accept and decline; **missed**, which is the state the owner named and which the group mechanism cannot express — the service message of D-229 keys on `participant_count` crossing zero, and a call that rang and was not answered never reaches occupancy above one person; a duration measured from the answer rather than from the room's creation, noting that `docs/operations/voice.md` records that **asking for a token creates the room**, so the caller makes a room before anybody answers; and the in-chat record itself, carrying an outcome (answered, missed, declined, cancelled by the caller) and, when answered, how long it lasted. D-229's trigger is the obvious precedent for where the record lives and is the first thing to read, but its mechanism does not transfer to «missed». A feasibility measurement was run in parallel the same day and its answer belongs in the proposal before any of this is built — the crux is whether a ring can arrive fast enough in each of those three states, and on the installed iPhone app, where section 1.5 of the voice proposal records that iOS suspends the page in the background. The proposal goes in `docs/proposals/`, the way the voice work itself did, and the owner sees it before code.


33. `[ ]` Documents and the rest of what a message can carry, opened **in the
    chat** the way other media already is. Asked for by the owner on
    2026-09-20: «просмотр документов и т.п вещей сразу в чате, на примере
    других медиа». The reference for this one is **Telegram** — it is one of
    the three areas the owner named where Telegram wins (CLAUDE.md §7), and its
    in-chat document, PDF and file handling is the thing to measure ours
    against before designing. Note what already exists rather than rebuilding
    it: media preview and variant processing are in the completed baseline, so
    the question is what a document does *differently* from an image — how much
    can be shown without downloading, what happens to a format the browser
    cannot render, and what the three shells do differently, because a desktop
    application opening a file is not a browser tab doing it. Start from an
    assessment against Telegram, then renders for approval, then code, the way
    items 25 and 28 were run — the owner has twice asked not to have work
    rebuilt after each iteration.

34. `[ ]` Standing: the interface's intuitiveness and its response to the
    person using it, and the interface bugs found along the way. Asked for by
    the owner on 2026-09-20: «улучшение интуитивности и отклика интерфейса для
    пользователя, исправление багов интерфейса если таковые найдутся». This is
    deliberately **standing** rather than a stage with an end, and it does not
    replace queue item 18, whose discipline it inherits: a change needs a
    recorded defect or an explicit design decision, and nothing is polished by
    eye. `docs/INTERFACE_DEFECT_REGISTER.md` is where a defect is recorded and
    is already the product of item 18; the addition here is that **response**
    is a first-class subject alongside appearance — what a control does the
    instant it is pressed, whether an action that takes time says so, and
    whether what a surface claims matches what it does. Three of the day's own
    findings are the shape to look for: copy describing a landmark the pixels
    did not show, a control whose colours differed by one degree of hue, and a
    settings screen that opened somebody's microphone without saying so. The
    approved motion plan
    `docs/superpowers/plans/2026-08-30-shared-motion-feedback.md` is the
    response half's existing vehicle; do not build a second one beside it.
35. `[~]` Standing: **«where you were» is state the product owns and
    restores.** Asked for by the owner on 2026-09-20, as the principle behind
    the update complaint rather than as a feature of it: «В этом и смысл что
    требуется перенять даже подобные механики либо придумать им более красивую
    реализацию если таковые уже есть в открытом доступе или у тебя на уме. В
    дискорде условно я чётко знаю что даже в случае обрыва от канала я
    гарантировано вернусь в него по возврату связи в течении 5 минут, также с
    обновлениями которые в случае если происходят насильно то возвращают сразу
    в голосовой где я и был или в чат где я и был.»

    The rule, in one sentence: a person's place in the product — the
    conversation they had open and their position in it, the voice channel they
    were in — survives a reload, an update the product applied itself, and a
    connection drop; and **where it cannot survive, the product does not take
    the action that would end it.** The second half is the part that binds
    today. `artifacts/kub/src/lib/pwa/appUpdateNotice.ts` refuses a quiet
    restart while a call is connected and while a conversation is open, and
    both vetoes exist for exactly one reason: the matching restoration does not
    exist yet. They are placeholders for it, not policy.

    What is measured, as of 2026-09-20, so the gap is a fact rather than an
    impression. `selectedChatId` is declared at
    `artifacts/kub/src/store/app.store.ts:39`, initialised `null` at `:262`,
    never persisted and never in a route — `App.tsx` mounts the whole messenger
    at `/` and has no chat route — so **every reload lands on the chat list**.
    The voice room dies with the document: `hooks/useVoiceCall.ts` and
    `lib/voiceConnectionHealth.ts` carry LiveKit's in-page reconnect, nothing in
    that path writes to storage, and there is **no rejoin-after-reload of any
    kind**. Against that, the server already knows who is in which voice
    channel — `useVoicePresence`, `useVoiceElsewhere`, `useVoiceModeration` and
    `useServerChannels` all read that presence — so the restoration can be built
    from state that already exists rather than from state that has to be
    invented.

    Three restorations, in the order in which they unblock each other: **the
    conversation's address**, which is what makes a reload cheap and therefore
    what makes silent updating possible at all; **the voice rejoin**, with a
    stated window and a designed end to it, because a window needs an end and
    what happens one second past it has to be chosen rather than fallen into;
    and then **the relaxation of the update vetoes** that the first two earn.
    The order is not negotiable: do not weaken «never while a call is
    connected» before the rejoin exists and is proved against a real drop.

    Each restoration has to preserve the chat-entry contracts of CLAUDE.md
    section 11 — no unread opens at the bottom, unread opens at the first
    unread, search and notification jumps land on the exact message, a history
    prepend keeps the reader's anchor — because restoring *the chat* while
    losing *the position* is half a promise, and half a promise reads as a
    defect rather than as a feature.

    Reference: **Discord**, under the allocation of CLAUDE.md section 7.
    Updates, reconnection and restoring where you were are none of Telegram's
    three areas, so where the two disagree Discord's answer is taken unless
    ours is argued to be better. What each client actually does belongs in
    `docs/operations/reference-clients.md` section 9, dated and
    confidence-labelled and read from a shipped client rather than recalled;
    where ours differs deliberately the reason goes there beside the
    observation, and a preference is not a reason.

    First step taken, 2026-09-20: D-282 in
    `docs/INTERFACE_DEFECT_REGISTER.md` — the notice throttle re-set from our
    own deploy cadence, and a quiet restart for the one state where a reload
    already costs nothing.

    **Second step taken the same day, and it is the one that unblocks the
    rest:** the conversation now has an address — `/chat/<chatId>` and
    `/chat/<chatId>/m/<messageId>`, Discord's shape minus a guild. The promise
    is an equality rather than a behaviour, and it is what
    `tests/e2e/chat-address.spec.ts` holds: **entering a conversation through
    its URL lands exactly where entering it through a click lands** — the same
    message at the top, the same unread divider, the same jump-to-bottom
    control. Nothing in `MessageList` had to change for that; §11's entry rule
    was already right and already covered, and all the address does is carry it
    through a reload. The rule that keeps the URL and the store in step is
    `lib/chatRoute.ts`, mutation-tested; the wiring is `hooks/useChatAddress.ts`.

    **We are better than the reference here, not merely different**, and
    section 9 of `docs/operations/reference-clients.md` states the reason beside
    the observation: Discord's reading position is a client fact that dies with
    the page — no unread-derived jump target exists anywhere in their main
    bundle — so their cold boot lands at the bottom with a banner, while ours
    comes back from the server and can land on the divider either way.

    Still to do, in order: **the voice rejoin** (2B), and only then the
    relaxation of D-282's two vetoes.

    **The measurement 2B was waiting on is done, and it dissolved the blocker
    rather than answering it.** Read read-only off production on 2026-09-20 and
    written up in `docs/operations/voice.md` under «Coming back after a drop»:
    LiveKit's deployed configuration sets **no participant retention of any
    kind**, so there is no server-side window to measure and nothing that could
    make «five minutes» a lie. The five minutes is a **product decision**, ours
    to make, and `voiceReconciler.ts`'s `DEFAULT_STALE_MS` — which governs how
    long everybody *else* still sees the person in the channel — already agrees
    with it. That agreement is now stated at the constant rather than left to
    coincidence, with the direction of each error spelled out.

    Two things the same reading settled, which belong in the design rather than
    in a surprise: `empty_timeout: 60` with `auto_create: false` means a person
    who was **alone** loses the room a minute after dropping and cannot conjure
    it back, so a return is **«join again», not «reconnect»** and goes through
    the gateway's idempotent `CreateRoom` — which needs its own test, returning
    after the room has lapsed. And the reaper's window is the one the client's
    must equal, in both directions.

    **One product question is open and is not the agent's to answer**, because
    it decides whether the product may switch on somebody's microphone without
    being asked — which is exactly D-281. Discord does not auto-join voice on
    startup: every `selectVoiceChannel` call site in its bundle is a user
    action, and what puts a Discord user back is their *server* re-announcing a
    voice state we deliberately do not keep. So «guaranteed to come back» has to
    be built by us and has a fork in it: **rejoin automatically, or offer a
    one-press return.** The recommendation on file is to split it by cause —
    the product rejoins by itself when the *product* caused the interruption (a
    drop with the page alive, or an update it applied), and offers when the
    person or the browser did (a manual reload, a crash), since only the first
    two are interruptions nobody chose. The mute state travels with the record
    either way, and the call bar is what states the microphone is live.


36. `[ ]` The person behind the conversation: reaching a profile, the depth of
    the row menu, and the two search surfaces. Asked for by the owner on
    2026-09-20 with fourteen Discord screenshots, and the reference is
    **Discord** by CLAUDE.md §7. Four things, and the first is a **regression
    already located**, not a wish.

    **a. «У нас пропала возможность открыть профиль пользователя не заходя в
    ЛС с ним.»** Confirmed in the source before this was written:
    `ChatList.tsx:362` offers «Открыть профиль», and its `run` is
    `selectAndOpenPanel("info")`, which calls `onChatSelect(chat.id)` and then
    opens the info panel — so the only way to a profile is *through* the
    conversation. The label promises a profile and the action opens a chat.
    The comment above it records why: two profile surfaces were consolidated
    into one «so the two routes cannot drift apart again». The intent was
    sound; the lost capability was not noticed. **Discord's answer is that two
    surfaces are correct** — a compact popout with a «Полный профиль» button
    and the full modal — and they do not drift because the small one is a
    summary of the large one with an explicit escalation, not a second
    implementation of it.

    **a is repaired, 2026-09-20 — D-283 in
    `docs/INTERFACE_DEFECT_REGISTER.md`.** The card was extracted from
    `ChatInfoPanel` to `components/chat/MemberCard.tsx` and given a standalone
    container on the shell; the row entry opens the person and enters nothing.
    Measured before the change rather than described: the shipped build sent
    `mark_chat_read_through` at 1440 and 390, so asking who somebody was told
    them you had read what they wrote. The entry is now absent on a **bot** row,
    which the old `type === "private"` predicate had been offering it on; D-263
    owns giving a bot a card. **The two-surface split is not built** — it is
    the design half of this item and waits on the assessment and the owner's
    approval. A third profile surface, the search's «Мини-профиль», is recorded
    in D-283 and deliberately untouched.

    **b. «Глубина функционала не соответствует.»** Discord's DM-row context
    menu in his screenshot carries: пометить как прочитанное, закрепить,
    профиль, начать звонок, добавить заметку (видна только вам), добавить
    никнейм друга, закрыть ЛС, приложения, пригласить на сервер, удалить из
    друзей, игнорировать, заблокировать, заглушить. Ours carries eight, and
    the overlap is partial. Do not copy the list — several entries name
    concepts we do not have (friends, servers, notes). Work out which of them
    are mechanics worth having and which are Discord's own model, and say which
    is which.

    **c. «Функция поиска удобно показывает что можно сделать и даёт выбрать
    нужную функцию нажатием.»** Discord's in-chat search opens a filter menu —
    от конкретного пользователя, поиск определённого типа данных (ссылку,
    вложение или файл), упоминания, больше фильтров — each a click rather than
    a syntax somebody has to know. **«Глобальный поиск исполнен немного иначе
    чем в Telegram, но тем не менее интересно»**: the quick switcher («Куда
    отправимся?») lists ПРЕДЫДУЩИЕ КАНАЛЫ and УПОМИНАНИЯ, and teaches its own
    prefixes in a footer hint. He asks for ideas to be taken from it, not for
    a copy.

    **d.** The chat list itself he judges good — «исполнен также удобно» — with
    one loss he names: it does not show last messages the way Telegram's does.
    Ours does. Keep that; it is a place we are already ahead.

    Run it the way items 25 and 28 were run, because he has twice asked not to
    have work rebuilt after each iteration: assessment against the shipped
    client first, recorded in `docs/operations/reference-clients.md` with dates
    and confidence, then renders for his approval, then code. Point **a** is
    the exception — it is a located regression and may be repaired on its own,
    ahead of the rest.

    **The assessment is written, 2026-09-20 — section 15 of
    `docs/operations/reference-clients.md`.** Read off Discord stable 615980:
    the main bundle plus **4,321 chunks, 132 MB, zero failures**, and — new
    for this project — the 37 `en-US` locale chunks, which give 28,264
    key→string pairs and make every English label exact. That retires one row
    of section 13. **The next step is renders, not code.**

    Four findings that change the plan rather than decorate it:

    - **Discord's two profile surfaces do not stay honest because of a shared
      component — they share none. They share a store.** Popout and modal are
      different trees over one `UserProfileStore` and one fetch path with an
      in-flight gate and a 60-second freshness window. So **our two-tier design
      owes a profile store before it owes a popout**: building the small
      surface first would give us two components over two queries, which is
      the drift the consolidation was defending against.
    - **Discord's own search has our defect.** Twelve filters parse,
      **nine** are offered, and `linkFrom:` / `fileType:` / `fileName:` are
      reachable only by typing — the same shape
      `tests/unit/search-type-filters.test.mjs` exists for. Ours is worse in
      one place and identical in kind: the in-chat search **already parses**
      `from:`, `has:`, `before:`, `after:` and offers none of them, and the
      phone's bar has no chips, no hint and no menu at all.
    - **«Пометить как прочитанное» is the cheapest entry on the page.**
      `mark_chat_read_through` exists, the row draws an unread badge, and no
      menu entry writes it. Discord leads its DM menu with exactly this.
    - **Most of what makes Discord's menu long is conditional**, and a third
      of it presupposes objects we have not decided to have — friends, servers,
      activity. Section 15.2 separates the mechanics from the model entry by
      entry. The one honest surprise is **«Заметка о человеке»**: private, per
      person, needs no friends graph, and we have never discussed it.

    Not established, and recorded as such: what Discord's DM **row** itself
    draws (this pass followed the menu, the profile and the searches; the
    owner's screenshots are the evidence for d, not a bundle read).

37. `[ ]` Presence, idleness and the AFK channel — and the false positives that
    make or break it. Asked for by the owner on 2026-09-20, in the same message
    as item 35 but a different system, and he flagged the hard part himself.

    What he wants, in his words: statuses that change **in realtime**; a
    desktop client that counts presence from real use — «если у него запущено
    приложение на windows, то только при движении мышью учитывает онлайн»; and
    somebody who falls asleep in a voice channel counted as «Не активен» and
    **moved to the voice channel designated as the AFK channel in the
    group/server settings**.

    **«Эту систему также надо корректно продумать чтобы не было ложных
    срабатываний»** — and he gave the exact failure to avoid: a person watching
    a stream is not moving the mouse and **is not idle**, and Discord knows it
    because it counts the activity, not the input. So the design question is
    what counts as activity here, and the answer is not «input events». A call
    in which somebody is listening, a video playing, an upload running, a
    person reading a long conversation — each has to be decided deliberately,
    and every wrong answer either exiles somebody mid-conversation or never
    fires at all.

    Also in the screenshots and part of the same system: the status menu is
    В сети / Неактивен / Не беспокоить / Невидимый, and **«Неактивен» carries
    a duration** — 15 минут, 1 час, 8 часов, 24 часа, 3 дня, навсегда. A
    manual status with an expiry is a different mechanic from an automatic one
    and both exist side by side; work out how they interact before building
    either.

    This touches voice presence, which already exists server-side
    (`useVoicePresence.ts`, `useVoiceElsewhere.ts`) and is the same state the
    restoration principle needs, so sequence it with that work rather than
    beside it.


38. `[ ]` Badges: real icons, and the history a badge carries. Asked for by the
    owner on 2026-09-20 and called by him «скорее визуальная придирка, которую
    можно исправить позже» — so it is filed at that weight. What raises it
    above pure decoration is that he used it to draw a distinction, and the
    distinction turns out to be **already correct in our model**, which is
    worth recording so nobody "fixes" it.

    **His distinction:** roles live on a server/group, are created by whoever
    runs it, carry the permissions that apply *there*; badges are worn
    everywhere and carry history — «условно купил подписку с такого числа,
    админ приложения или т.п».

    **What the code already does**, read before this was written.
    `ProfileBadgeChip.tsx` states the same split in its own words — `ChatRoleChip`
    answers «кто он здесь» and the badge strip answers «кто он вообще», and the
    colour on the word is deliberately reserved for the group's role so the two
    rows can be told apart at a glance. Per-group roles with their own names and
    colours exist: `chat_roles.colour` with eight allowed values in
    `lib/chatRolePalette.ts`. Global badges exist as `ProfileBadgeRow`
    (`user_id, kind, key, title, detail, icon, colour, rank`) with
    `kind: "global_role" | "achievement"`. So the model is his model.

    **What is actually missing is exactly the two things he named:**
    - **No real icons.** `resolveBadgeIcon` maps a badge onto the product's own
      `KubIcon` set and renders *nothing* when the build lacks the name a row
      asked for. Discord's badges are small purpose-drawn coloured marks. His
      suggestion — «можем их генерировать сами нужного размера» — is the
      sensible route and should be weighed against a hand-drawn set.
    - **The explanation is a browser tooltip.** `ProfileBadgeChip.tsx:75` is
      `title={badge.detail ?? undefined}` — the native one, which cannot be
      styled, is slow to appear and does not exist on touch. Discord shows a
      designed card: the badge large, its name, and **since when** («СЕРЕБРО
      NITRO — Подписчик с 12.05.26»). `detail` is free text, so a date can be
      written into it but nothing holds it as a field; decide whether history
      deserves a column before writing dates into prose.

    Sequence it after item 36, whose profile work draws these same chips.


39. `[ ]` The settings overlay's shape, applied to every other full surface.
    Asked for by the owner on 2026-09-20, right after he reported the settings
    screen rendering «криво» inside a narrowed chat list: «такой же подход как
    к настройкам по возможности к остальным местам примени, страница ботов,
    админка и т.д». His own condition is the acceptance test and it is not
    optional: «обязательно проверь что все функции корректно помещаются и
    отображаются удобно для пользователя на маленьком и большом разрешении».

    Wait for the settings overlay itself to land, then follow it — one
    container used by all of them, not three that look alike. The surfaces to
    audit are the bots page, the admin layout and the tasks page. The
    measurement discipline is the same: photograph each at the narrow end and
    the wide end, both themes, and show what wraps, clips or collapses, rather
    than declaring it fits.

40. `[ ]` The bottom bar: three things, not two that duplicate each other.
    The owner, 2026-09-20: «кнопка мой профиль и настройки по сути дублируют
    друг друга, тогда лучше перенять подход к интерфейсу от discord». Discord
    is the reference by CLAUDE.md §7, and he supplied the screenshots.

    Discord's bar carries **three separate affordances**, which is why nothing
    there duplicates:

    | zone | what it opens |
    | --- | --- |
    | the avatar and the name | its own menu — edit profile, status with its durations, account switching |
    | microphone and headphones | quick toggles, in place, with their own chevrons for device choice |
    | the gear | the full settings |

    So the duplication goes away by **splitting**, not by deleting one of ours:
    pressing «в район никнейма» must open a menu of its own rather than a
    second door into settings. His words: «редактирование профиля уже при
    нажатии в район никнейма, либо аватарки (в общем до кнопок настройки
    звука), после чего как раз появляется подобное меню в котором можно
    перейти в редактор профиля».

    Two things already exist and must be joined rather than rebuilt: the status
    menu with durations is part of item 37, and the profile editor is item 36's
    second half. The quick audio toggles are the genuinely new piece, and they
    are the reason the bar is worth the work — a mute that needs a settings
    screen is a mute nobody reaches mid-call.

41. `[ ]` A list of sections where Discord keeps Библиотека, Магазин and
    Задания. The owner, 2026-09-20: «ботов и т.п можно перенести в место
    подобное тому что на скриншоте 3». Today the bots page is its own route
    reached from elsewhere; his point is that the product has a natural home
    for surfaces of that kind and is not using it. Decide what belongs there
    besides bots — tasks is the obvious candidate — and note that this is also
    where item 39's surfaces end up being reached from, so the two should be
    designed together.

42. `[ ]` The update notice moves to the window's own controls. The owner,
    2026-09-20: «уведомление об обновлении красиво убрать вправо-вверх рядом с
    кнопками действия с окном (пример с пк версии)», with a screenshot of
    Discord's desktop client where «Помощь» and the download arrow sit beside
    minimise, maximise and close.

    This closes his older complaint that the notice «визуально выглядит
    чужеродно» — not because the notice is ugly, but because it had no home.
    Beside the window controls is a home, and it is one the desktop shell
    already draws (`--kub-window-caption` exists). Note the shells differ here:
    a browser tab has no window controls of ours, so the web and the desktop
    answers cannot be identical — say what each gets. D-282's throttle and its
    quiet-restart rule are unaffected; this is where the offer is drawn, not
    when it is made.


43. `[ ]` A bot that makes a voice channel for whoever walks into the lobby —
    and the channel belongs to them. Named by the owner on 2026-09-20 and
    specified by him the same evening.

    **The lobby is a voice channel called «➕ Создать канал».** Whoever joins
    it gets a channel of their own and is moved into it. His words for the
    rest: «пользователь может в нём сидеть и управлять им пока он не удалён из-за
    его выхода (даже если заходит другой пользователь, а тот что создал выходит,
    то канал может жить пока его создатель не захочет отключить, права на управление
    в этом войсе также за ним)».

    **So the lifetime is owned rather than emptiness-driven, and that corrects
    a note written into this item a day earlier.** It said `empty_timeout: 60`
    gives a self-removing channel its signal instead of a timer. It does not,
    on its own: an owned channel may outlive its own emptiness at its owner's
    discretion and may outlive its owner's presence while other people are in
    it. Emptiness is an input; ownership is the rule.

    **The lifecycle is settled, and the two holes this entry listed are
    closed by the owner's own rule (2026-09-20):** «если все выходят то канал
    автоматически исчезает». So emptiness **is** the terminal condition, and
    ownership governs only what happens while somebody is still inside:

    - the creator leaving does not end it while others remain;
    - the creator keeps the rights in it and may close it deliberately;
    - **everybody leaving ends it, whatever the creator wants.**

    That answers the orphan (the creator who never returns cannot strand a
    channel, because the last person out closes it) and the immortal (there is
    no state in which a channel outlives its own emptiness). What is left of
    the earlier correction still stands: emptiness is the *terminal* rule, not
    the *only* rule — a channel with people in it survives its owner's absence,
    which a plain «delete when empty» would not express on its own.

    **What «управлять» contains is now visible** — see item 44, which
    records Discord's channel settings from the owner's screenshots. The
    permission model there is the one this feature needs, so 43 waits on 44
    rather than inventing a smaller one.

    Why it is bigger than a feature: it is the first thing asked of this
    product's bots that **acts on voice**, and the bot platform today is a chat
    platform. The events (somebody joined a voice channel), the permissions (a
    bot creating and deleting channels, moving a participant) and the cleanup
    all have to exist first. Scope it against Discord's bot API — the area the
    owner rates Discord highest on, «из-за большей кастомизации и удобства их
    реализации».

    One measured fact that still holds: `auto_create: false`, so only our
    gateway can bring a room into being. A bot cannot conjure one; every
    created channel goes through the same door as every other.


44. `[ ]` What a channel's own settings are, and the participant cap we are
    shipping today. The owner sent Discord's channel screens on 2026-09-20
    together with the rule for item 43, and one line of them is a live
    divergence rather than a feature request.

    **The divergence, first, because it is already in production.**
    `livekit.yaml` carries `room.max_participants: 10`, so **every voice
    channel in this product is capped at ten people**. The owner's statement is
    «изначально количество участников в голосовом не ограничено», and Discord's own
    control runs ∞…99 with the limit **off** by default. So the shipped value
    is not a tuned capacity decision, it is a default nobody revisited, and it
    contradicts the product's intent. Changing it is a one-line configuration
    change **and a capacity question** — the SFU is capped at 2 cores and 1 GiB
    (see D-262's measurement), and an unbounded room on that allocation is a
    promise the host has not been asked to keep. Measure before lifting, and
    lift deliberately rather than to infinity.

    **The settings surface, from his screenshots.** Discord's channel has four
    sections — Обзор, Права доступа, Приглашения, Интеграция — plus a
    destructive «Удалить канал» standing apart from them. Обзор carries the
    name, slow mode, content visibility, **bitrate (8–384 kbps, with a warning
    above 64)**, video quality, the user limit and a region assignment.

    **The permission model is the part that matters and it is the owner's own
    sentence:** «распространяются права группы каналов (текстовых/голосовых)
    либо личные права этого голосового». Discord draws exactly that: a
    channel either **inherits its category's permissions or overrides them**,
    with a banner saying which state it is in and a «Синхронизировать» button to
    go back. Each permission is **three-state per role or member** — deny,
    inherit, allow — not a checkbox, and that third state is the whole
    mechanism: it is what lets a category's answer flow through.

    Two consequences for us, both structural:

    - **We have no category layer.** Groups have channels; there is nothing
      between them for permissions to be inherited from. Either that layer gets
      built or the inheritance has a different parent, and which one is a
      decision, not a detail.
    - **Three-state is not our shape.** Our grants are boolean-by-role, so
      «inherit» has nowhere to live. This is the same data-model question item
      43 ran into, and it is why 43 now waits on this entry.

    Scope it against Discord, per CLAUDE.md §7, and sequence it after the
    roles and permissions work of item 19, which owns the model it would
    extend.


45. `[ ]` The micro-group: a conversation for a few people that is not a
    server. Named by the owner on 2026-09-20 while we were deciding whether a
    private chat's two-person voice cap should be lifted, and **specified by
    him the same evening**, which closed two of the three questions this entry
    first listed.

    **Why it exists, in his words:** «при подобной ситуации в дискорде
    происходит создание микро-группы под 2+ человек… иногда удобнее чем заходить на
    сервер основной». **It settles item 44's rule rather than adding a
    wish**: a private chat is two people by definition, and «one more person»
    is a different object, not a bigger one.

    **Decided by the owner, no longer open: it is a separate `chats.type`.**
    His reason is the right one and worth keeping verbatim — «сервер в дискорде
    именно что обладает огромным комбайном возможностей». A flag on a group would
    be a group pretending, and the seams would show.

    **How it is born, and this is the whole design.** Not a «create group»
    form. Two people are already talking in a private chat, one presses the
    add-to-conversation control in the header, and the micro-group exists —
    «почти бесшовно… буквально маленькая группа». So the gesture is the
    feature; a micro-group that had to be assembled from a form would answer a
    different need.

    **What it looks like:** a private chat, plus a member list down the right
    which can be hidden, as on a server. The **only** hierarchy is a small
    crown on its creator. Its own message history and media. Removed as
    quickly as it is made.

    **What actually happens, from the owner rather than from my guess.** This
    entry first said the live call must either migrate or be interrupted, and
    that an interruption «would kill the feature». That was wrong, and it is
    worth recording as wrong because the fear was doing design work:

    > «создаётся эта самая группа и в неё по сути созваниваются заново люди
    > которые были в изначальном войс чате в лс + происходит дозвон до добавленного
    > человека, у него эта группа появляется в списке чатов, явно визуально показывается
    > как новая и как та в которой ему идёт звонок в данный момент»

    **So it is a rejoin, and the rejoin is fine.** No session migrates. The
    group is made, the two who were already talking are reconnected into its
    channel automatically, and the added person is **rung**. The seamlessness
    is perceptual — it is fast and nobody presses anything — not a continuous
    transport. That is a far cheaper build than a migrating session, and it
    means the two-person cap on the private channel is never in the way.

    **The dependency this creates, and it is hard rather than the call was.**
    «дозвон до добавленного человека» is **ringing**, and this product has
    none: item 32 records that one-to-one calls do not exist precisely because
    nothing tells another person that somebody is calling, in the three states
    they can be in — application in front, background tab, closed. The
    micro-group needs that same mechanism, so **item 32's ring is a
    prerequisite for item 45**, not a neighbour. Build it once.

    And its own surface requirement, which is a chat-list state we do not have:
    the group must appear for the invited person marked **both as new and as
    ringing right now**. Two facts at once, in a row that today carries
    neither.

    **Ownership is settled and is not the private-chat case.** The owner:
    «владелец вправе делать что угодно со своей группой, также как создатель
    сервера… если не передал полномочия». Full rights, delegable, the same
    model a group's creator already has. The worry this entry carried — that
    migration `20260911120000` had to stop a private chat's owner deleting it
    for both sides — **does not transfer**, and the reason is exactly why the
    crown matters: there, «owner» was an accident of who happened to open the
    conversation; here it is a deliberate act with a visible mark. Record that
    distinction in the policy, because the two look identical in the schema and
    are opposite in intent.

    Still to settle: **what it does not get.** The point is that it is lighter,
    so the list of what it **lacks** — channels, roles, folders, invites,
    categories — is the specification, and writing it down is what stops it
    drifting into a group.

    **Production state, read 2026-09-20:** 28 private chats, 15 groups, no
    `channel` rows; a group already carries voice channels, the roles
    machinery, folders and invites. `chat_roles` is empty across the whole
    database, so the weight is in the concept rather than in anybody's data —
    which makes this a cheap moment to add a lighter shape and an expensive one
    later.

    Reference is Discord per CLAUDE.md §7. Sequence after item 44, whose rule
    it justifies, and read with item 32 (calls in a private chat), which is the
    other half of the same question.

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

## Standing Rule Recorded 2026-09-13: a good existing solution beats writing one

The owner, asked whether to add a dependency for writing an mp4 container: «Если это хорошая зависимость и слой
то почему бы и нет, это применимо к остальным функциям тоже, нам незачем всё писать с нуля если уже придумано
хорошее решение».

Recorded as a standing rule rather than as an answer about one package, because that is how it was given. It
does not license adding anything: «хорошая» is the load-bearing word, and the bar this project has already
applied elsewhere stands — a dependency is judged on what it costs to audit, how much of it is actually used,
whether it can be replaced later, and whether it drags a runtime in behind it.

What it does change: reaching for a hand-rolled version **to avoid the conversation** is no longer the safe
default. Two places in this codebase already pay for that instinct — three separate long-press implementations
(D-163), and a Radix context menu sitting unused beside a hand-written one.
## Direction Recorded 2026-09-13: the shape Discord has, not the shape Telegram has

The owner, answering a question about per-member tags: «мы и так планировали делать это скорее как каналы в
дискорде с войсами и т.п, чем просто группами как изначально в телеге».

Recorded here because it is cheap to write down and expensive to discover late. The interface audit stage spent
2026-09-13 comparing the group surface against Telegram — the reference pack the owner sent that day was of
Telegram group screens — and the entries it produced (D-164, D-169, D-170) propose Telegram-shaped answers. The
gaps are real; the shape of the fix is now open.

**Voice is named in that sentence and does not exist in this product at all.** Searched rather than assumed:
zero occurrences of `webrtc`, `RTCPeerConnection`, signalling, `livekit` or `jitsi` across the
client, the API server, the migrations and the Android project. `getUserMedia` appears in five files and
every one of them records rather than calls — the camera, video messages, voice messages, the audio settings and
the capability probe. So voice is a track, not a feature.

**What is already built and only needs an audience:** achievements. Tables, criteria, automatic and manual
granting, progress, and a surface that draws them — visible only to yourself in settings, as a way to unlock
cosmetics. Discord shows badges on any card it opens. See D-168.

Nothing is redesigned on the strength of one sentence. What changes today: no further Telegram-shaped fix is
started on that surface without first asking what the Discord-shaped one would be.
## Voice Channels — Slice 1 Result (2026-09-13)

**The riskiest assumption in the whole voice plan is tested, and it holds.**

A LiveKit SFU runs on the production host as a plain Compose project at
`/srv/letscube/voice-probe/`, reachable by nothing in the product. Two headless
browsers joined one room over the open internet and each heard the other. The
second ran with Chrome's own `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`,
which is the environment the tunnelled part of this audience is in, and its media
went over **TCP** — 82 374 bytes out, 85 805 in, candidate pair `prflx → host`,
`protocol: tcp`, no TURN and no certificate needed. The ordinary browser's went
over UDP. Both readings are from `getStats()` rather than from the call appearing
to work.

The kill criterion — a tunnelled client that cannot connect at all — is **not
met**, so the plan proceeds to slice 2 instead of being redesigned.

**What it costs.** Ten audio publishers for ten minutes, each subscribed to the
others, is 18.58 % of the container's two-core limit and 64 MiB. A fixed Postgres
read measured p95 137 ms before, 146 during and **150 after** — the highest
figure being the one taken when the SFU was idle is the plainest statement that
it is not what moved the number.

**The host, measured at last** and recorded because the proposal asked and nobody
had: 8 cores (EPYC 7662), 11 GiB memory, 119 GB disk at **82 % full**, 41
containers, load about 1.5 at rest.

Full detail, including three things learned by doing it — `auto_create: false`
biting first, Docker publishing past ufw on this host, and the kernel's UDP
receive buffer being too small for an SFU — is in `docs/operations/voice-probe.md`,
with the two commands that remove the probe entirely.

**Deliberately not done in slice 1:** no hostname, no DNS record, no TLS, no
Traefik router, no Coolify application, no migration, no client dependency and no
route on `app.letscube.ru`. Slice 1 had to be cheap to discard, and it is.

## What Was On Production But Not In Production (2026-09-14)

Two things this project believed were done turned out never to have reached the
server. Neither was found by a test; both were found by asking the live system
the question directly, which is now written down as a procedure rather than as
an anecdote.

### Six migrations, unapplied for three days

`6e2f5ed` and its neighbours were committed on 2026-09-11 and the register
described them as fixed. The database still carried the old policies. The worst
of them, **D-104**: `Anyone in chat can view reactions` with `using (true)`, and
`anon` holding SELECT, INSERT, UPDATE and DELETE — every signed-in account read
who reacted to what in every chat in the product, and could react to any message
whose id it knew.

All seven of that day's migrations were applied. The procedure, in the order it
was done: a `pg_dump` verified with `pg_restore -l` and hashed; a throwaway
database loaded from a schema-only dump of production; every migration **and its
rehearsal** run there and green; then production, as the role that owns the
tables; then the effect measured as `authenticated` with real claims, never as
the table's owner.

| | before | after |
| --- | --- | --- |
| reactions an outsider can read | 149 of 149 | **0 of 149** |
| an outsider may react to a message in a chat they are not in | yes | refused |
| achievements readable without an account | all 59 | refused outright |
| `set_message_reaction`, `delete_messages_for_everyone`, `forward_message`, `mark_chat_read_through` | absent | present |
| rows touched | — | none |

The client needed no deploy: each of those features tries its RPC and falls back
where it is absent, which is why nobody noticed for three days.

**`scripts/migration-inventory.*` now asks this question**, and
`docs/operations/deployment-inventory.md` carries its two limits and the triage of
the nine older entries that are superseded rather than missing.

### A push function seven weeks stale, with no Windows sender in it

Hashing every Edge Function against the served copy found
`send-push-notifications` dated 2026-07-14 where the repository's is 2026-08-31 —
and **without `wns.ts` at all**. The whole Windows Notification Service sender,
including the two helpers that stop a toast carrying an external or signed avatar
URL, had unit tests here and no existence there. Part of why «killed-process WNS
delivery» is an open Windows gate is that the sender was never deployed.

Deployed with a backup first and all four files verified byte-identical after.
No restart was needed, proved by the new code answering `401` to an unauthorised
call immediately. FCM and web push are untouched; Windows delivery stays off
until `WNS_TENANT_ID`, `WNS_CLIENT_ID` and `WNS_CLIENT_SECRET` exist, which is
the owner's to supply. Three other function directories were serving stale
copies of themselves; those were moved into the same backup.

**The functions have no inventory script yet.** The comparison was a directory
hash run by hand, and it is worth writing down as one.

## Last Confirmed Deploy Baseline

### 2026-09-19 — the voice evening: a media server, two client fixes, and the sounds

**`letscube-voice`: `livekit/livekit-server:v1.8.4` → `v1.13.7`** (D-256), on the
owner's explicit instruction to move the server rather than pin the client down.
Not a Coolify application — a plain compose file at `/srv/letscube/voice/`.
Rehearsed on the **real** `livekit.yaml` in a throwaway container in its own
network namespace before anything changed; it parsed the config with no edit and
started on the same ports. Both files backed up to
`.backup/*.20260919-171358` with a `sha256` beside them and diffed against the
originals. Then one line. Healthy, same `nodeIP`, same ports.

**It worked, and that is measured rather than hoped.** Before: ~8 new RTC
sessions a minute, median 15–16 seconds between one participant's own
successive sessions, `unsupported datachannel added` 69 times an hour. After:
**2 sessions in 27 minutes, one of them held 8 minutes 43 seconds unbroken, and
zero datachannel warnings** — same client, `JS 2.22.3, protocol 17`. Caveat kept:
one identity in those logs, so it is one client holding a session, not a
re-measured two-party call.

Rollback is the old tag; its image is still in the local cache, so it needs no
network.

**`letscube-web` 488 at `16ff4c98`** — D-254, the remote audio a voice channel
had never attached. **490 at `8c083ee9`** — D-255, the panel that measures both
directions, plus the four channel sounds, which are **committed but not wired**
and therefore make no sound until the owner has approved them by ear.

**489 failed** at `check_git_if_build_needed` — the GitHub-address fault again,
the ninth this week — and was retried through the deploy token rather than by a
second push. Re-measured from the server afterwards: `github.com` now resolves
to **only** `140.82.121.3`, which answers 4/4, so the fault is latent rather
than gone. **No `/etc/hosts` pin was added and none is recommended**: GitHub
rotates those addresses, and a stale pin breaks every clone, which is worse than
an intermittent failure costing one retry.

Markers proved in both directions each time — «Звук заблокирован» absent at
`34500bca` and present live for 488; «Ничего не приходит», «Входящий поток» and
«Исходящий поток» absent at `16ff4c98` and present live for 490, with «Связь
стабильна» as the control. The two headings are **sentence case in the source**
and uppercased by CSS, which is why the source spelling is the one to grep.

Gates at `8c083ee9`: typecheck clean, unit **3432/3432** with 0 skipped,
production build proved by its own `sw.js build 9beb1cb24b86e132` line.

### 2026-09-19 — `letscube-web` at `34500bca` (D-253, the panel that did not hold its readings)

**Deployment 487, `finished`.** One healthy replica, image tag
`l64kyyu1sysev2izzjjbizhe:34500bcaf03aa052416c5853b716381089cdca58`, read off the
running container. Clone succeeded first time.

**Proved to have reached the reader in both directions, by count rather than by
presence**, because the marker this change adds — the literal
`rounded-[inherit] border border-[color:var(--glass-line)]` — already existed in
the bundle from another component, so "it is there" would have proved nothing.
The previously served entry chunk carried it **3** times; the one the site serves
now carries it **4**. Exactly one new use, which is the health panel's glass.

Preceded by deployment 486 at `cf809d47` (D-214's two residuals, D-210 and
D-200), also `finished` with a single healthy replica.

Gates at `34500bca`: typecheck clean, the whole voice spec 64/64 at 1440,
production build proved by its own `sw.js build 0ecae37c3d255199` line.

### 2026-09-19 — `letscube-web` at `164887bb` (D-214, the role colour a reader can see)

**Deployment 484, `finished`.** One healthy replica, image tag
`l64kyyu1sysev2izzjjbizhe:164887bb6a29f05ff899f8958d6a43be311976ea`, read off the
running container rather than trusted from the webhook; the previous replica was
retired during the rollover.

**It took two attempts, and the first failure was not the commit.** Deployment
483 carried the same commit and failed after 139 seconds inside
`check_git_if_build_needed` — the GitHub-address fault diagnosed earlier today:
`github.com` resolves alternately to `140.82.121.3`, which connects 8/8 in 0 s,
and `140.82.121.4`, which connects 2/8 and otherwise times out at ~133 s. The
retry was triggered through the deploy token rather than by another push, so
`main` carries no empty commit for it.

**The change is proved to have reached the reader, in both directions.** The
class string `grid w-fit grid-cols-4 sm:grid-cols-8` — the swatch grid, which
exists only in this commit — is **absent** from `artifacts/kub/src` at the
previously deployed `ae2de203`, **present** at `164887bb`, and **present** in
`/assets/index-D0bMhhdY.js` as the live site serves it. A marker found only in
the bundle would prove nothing; a marker found in neither would not distinguish
"not deployed" from "I cannot see".

Gates at that commit: typecheck clean, unit 3315/3315, production build proved by
its own `sw.js build 6240c6270d61df0a` line. The migration behind it
(`20260919170000_a_role_colour_a_reader_can_see.sql`, sha256 `803200f9…`,
`UPDATE 10`) went in between the two client commits and is recorded under
Priority 2.

**All five applications were then surveyed the same way**, because a `failed`
row turned out to be no evidence either way (the rule is now written into
`CLAUDE.md` §15: Coolify decides whether a build is needed *inside* the step
that clones, so the address fault marks applications failed that would not have
built anything, and a build skipped by `watch_paths` leaves the old tag in
place). The running image tag against
`git log <deployed sha>..HEAD -- <that app's watch paths>`:

| app | running | verdict |
|---|---|---|
| `letscube-web` | `164887bb` | current |
| `letscube-worker` | `7325634c` → **redeployed to `164887bb`** (485, `finished`) | was missing `6c63e132`, the media preview backfill repair — a real staleness behind a harmless-looking `failed` row |
| `letscube-releases` | `3fcea10c` | current; nothing has touched `docs/deploy/release-catalog/**` since |
| `letscube-support-mail` | `7325634c` (image `:latest`, built 04:16) | one commit behind on its build inputs, and that commit is `6c63e132` — a worker file the mail bridge does not run. **Deliberately not redeployed**: a rollover of a live bridge buys nothing here |
| `letscube-bot-gateway` | `7325634c` | same one commit, same reasoning, and its auto-deploy is `false` by design. `56c8f2b8` — the `file_id` support PocketFlow's «Отправить обратно» needs — is **already in** `7325634c`; `git log 7325634c..HEAD -- artifacts/api-server/src/bot` is empty |

The api-server build at `HEAD` is proved good by the worker's own successful
build at `164887bb`, so neither of the two applications left behind is sitting
on a broken build it will discover during an emergency.

### 2026-09-19 — one production migration (D-208 step three): the legacy `media_path` back-fill

**No application was deployed and nothing on screen changed.** `letscube-web`
keeps its baseline. The `media` bucket is still `public = true` — step four is
the owner's and was not touched — so this migration hands nobody anything they
could not already fetch anonymously. What it does is finish the database side of
D-208: after it, every **live** media message reaches its original through the
pair `_kub_media_read_allowed` actually asks for.

**It was filed as a tidy-up and it is a prerequisite.** The read predicate
applied earlier today admits a message's own upload through
`m.media_bucket = 'media' and m.media_path = p_name and m.deleted_at is null` —
**both** halves. Ten live messages carried a `media_url` and neither column, so
only the uploader passed. Measured on production before and after: a chat member
goes from **0 of 9** to **9 of 9** on those originals, a non-member stays **0 of
9**, and the uploader stays **9 of 9**.

**`20260919130000_media_path_backfill_for_legacy_messages.sql`**, applied as
**`postgres`**. One transaction, self-check, `COMMIT`. 16,076 bytes, sha256
`69746b1f…550e5fd026`, hashed on the workstation, on the host and inside the
container before it ran and identical at all three; rollback
(`5667f6e1…86da67c8c`) and the rehearsal beside it in
`.migration-backup/supabase/migrations/`.

- **The owner is a third one, and it was established rather than assumed.** The
  sibling needed `supabase_admin` because `storage.objects` belongs to
  `supabase_storage_admin`. This writes `public.messages`, owned by `postgres`,
  which also owns the `private` schema and holds BYPASSRLS. Meanwhile
  `private.media_variant_jobs` belongs to `supabase_admin` and `postgres` holds
  **SELECT and nothing else** on it — which is how the rollback acquired a bug.
- **Backup, taken and read back first, and deliberately two files**, because a
  schema dump cannot restore a row:
  `…/pre-migrations/20260919-142208-before-media-path-backfill-for-legacy-messages.schema.dump`,
  1,653,522 bytes, sha256 `91cfdde3…71091c0b69`, read back with `pg_restore -l`
  inside the container — 2,508 TOC entries, `public.messages` with **all 11** of
  its triggers by name; and `….messages-media-columns.csv`, 161,001 bytes,
  sha256 `73c3e58a…cbf2fcf56c`, holding `(id, media_bucket, media_path)` for all
  3,431 rows — exactly what the migration can destroy, and no message body. It
  was read back by restoring it into a table in a rolled-back transaction: 3,431
  rows, 294 paths, digest **identical to live**. The first read-back attempt
  failed on its own method (`pg_restore -l` cannot read a pipe); that is a
  failed probe, not a failed backup, and the two were told apart before moving
  on.
- **Counts re-measured read-only, not carried forward:** 314 media messages, 294
  with both columns, 20 with a URL only (10 live, 10 on deleted messages), 778
  objects, 17 avatar URLs (10 profiles, 7 chats, 0 bots). The derivation was
  re-verified by **string equality, not a pattern**: 294 of 294. Two facts the
  file did not have — there are **two** URL bases among the 314, and the split
  is exact (all ten live legacy rows on the current host, the other base is
  precisely the ten deleted ones); and the variant pipeline is an independent
  third witness, since all 12 `media_variants` rows for the six image/video
  candidates already carry a `source_path` equal to the derived path.
- **Every trigger's effect was predicted before the write and measured after.**
  Three of eleven fire. The guard admitted because `auth.uid()` is null in a
  psql session, and it **had to be applied that way**: nine of the ten are
  forwards whose path begins with the original uploader's id, so impersonating
  the author would have been refused on three rows. The variant trigger enqueued
  **6** jobs into an empty queue, predicted to be no-ops and proved so — queue
  back to **0**, the twelve variant rows untouched, 778 objects with none
  created or updated. The bot trigger did **not** take its early return and then
  found **0** active bot members in those four chats.
- **A NOT VALID CHECK was the near miss.** `messages_media_metadata_shape` ties
  `media_metadata #>> '{preview,path}'` to `media_path`, and a NOT VALID check is
  still enforced on UPDATE, so a legacy row carrying a preview path would have
  aborted this. All ten carry `media_metadata = '{}'`; 0 rows in the table would
  violate it if it were validated today.
- **Four defects were fixed in the file before it ran.** Its self-check demanded
  that *no* live legacy row remain, contradicting its own deliberate exclusion of
  rows whose object is gone — a correctly skipped row would have aborted the
  migration that skipped it. Its URL assertion was a `LIKE` with the path
  interpolated into the pattern, the same wildcard hole the sibling's review
  caught, with 484 of 778 names carrying an underscore. Nothing asserted that no
  other row moved; two digests now do. And it had no timeouts and a greedy strip.
- **A fifth was caught by the rehearsal, in the rollback.** A tidy-up to
  withdraw the six queue rows was refused with `permission denied for table
  media_variant_jobs` and was removed rather than escalated to a superuser.
  Running the rollback inside the rehearsal has now caught a real rollback bug
  **three times in one day**.
- **Rehearsed on production inside a rolled-back transaction**, both files
  spliced in verbatim by a script that removes only `begin;`/`commit;` and then
  proves every other line survived, with impersonation calibrated against a
  known answer first (a member reads a row that already had a path, 3 of 3; a
  non-member does not, 0 of 3 — in all three phases). Both directions on values:
  the ten go 0 → **10 of 10** → 0, and the digest of every column not written is
  the same in all three phases and equal to the pre-apply reading.
- **Three mutations, all red**, each naming the check it targets: a half-applied
  UPDATE, a stray write to a row outside the back-fill, and a corrupted URL on a
  back-filled row — the last being the check that had been a `LIKE`.
- **Verified after the apply.** Rows with a path 294 → **304**, live legacy rows
  **0**, `edited_at` still null on all ten, bucket still `public = true`, `anon`
  still unable to execute the read predicate, ten `storage.objects` policies
  unchanged. The pre-apply CSV diffed against live shows **exactly 10 rows
  differ and all 10 are the recorded ten**.

**Rollback** is `20260919130000_media_path_backfill_for_legacy_messages.rollback.sql`,
which restores each row from `private.d208_media_path_backfill` — the record
table the forward migration leaves behind on purpose — and drops it. It restores
nothing it did not itself write, and it was run in the rehearsal, where every
value returned to its pre-migration reading.

**What remains before step four.** The database side of D-208 is finished. What
is left is client-side and outward-facing: a signed URL succeeding end to end for
a real member, which needs a session and has still not been attempted; the
demand-driven renewal re-read with a private bucket in view; and the sidecar
`.preview.` branch, which matches nothing on production and is still evidenced
only by a synthetic object.

### 2026-09-19 — one production migration (D-208 step nought): the media read policy admits a chat member

**No application was deployed and nothing on screen changed.** `letscube-web`
keeps its baseline. The `media` bucket is still `public = true` — making it
private is step four of D-208 and it is the owner's — so this migration hands
nobody anything they could not already fetch anonymously. It makes the
*authenticated* route capable of the same thing, which every later step of
D-208 needs and none of them had: signing an object requires `select` on
`storage.objects`, and a chat member did not have it for a photograph another
member sent, nor for any `variants/` object at all.

**`20260919120000_media_read_policy_admits_a_chat_member.sql`**, applied as
`supabase_admin`. One transaction, self-check, `COMMIT`. 16,196 bytes, sha256
`2c5592b5…c661e06d33`; rehearsal (`6c7defda…`) and rollback (`dfdb8e5c…`)
beside it in `.migration-backup/supabase/migrations/`, and the applied file is
byte-identical to the recorded one — proved by hashing it on the workstation,
on the host and inside the container before it ran.

- **It had to be `supabase_admin`, and not for the usual reason.**
  `storage.objects` is owned by **`supabase_storage_admin`**, and
  `pg_has_role('postgres','supabase_storage_admin','MEMBER')` is **false** here,
  so `postgres` cannot create or drop a policy on it at all. The new predicate
  is nevertheless owned by `postgres`, not by `supabase_admin`: both work, but
  `supabase_admin` is a superuser on this deployment and `postgres` is not,
  `postgres` measurably holds everything the body needs, and it is what the
  sibling `_kub_media_path_allowed` already runs as.
- **Backup, taken and verified first:**
  `/srv/letscube/backups/pre-migrations/20260919-134918-before-media-read-policy-admits-a-chat-member.schema.dump`,
  1,648,191 bytes, sha256 `0c706012…fa5b6627c`. Read back with `pg_restore -l`
  inside the container: 2,521 TOC entries, and **all ten** `storage.objects`
  policies present by name, the one being replaced included. Read back rather
  than assumed: a 0-byte dump sits in the same directory from earlier today.
- **Live vs file before anything was written.** The deployed
  `_kub_media_path_allowed` matches what the file assumes branch for branch. The
  object layout was re-counted rather than trusted and three numbers had moved:
  778 objects not 771, `chat-avatars/` 11 not 9, `variants/chats/` 8 not 6. And
  the bucket carries **two** SELECT policies, not one — `media bot avatars owner
  read` is separate and untouched.
- **Rehearsed on production inside a rolled-back transaction**, with three real
  accounts impersonated by `set local role authenticated` and real
  `request.jwt.claims`. The harness was calibrated against the known result
  first — it reproduced yesterday's `f f t f` and «0 rows of 2» exactly — before
  it was trusted for anything new. Migration and rollback both spliced in
  verbatim, and the rollback was run **because it was written**: every value
  returned to its pre-migration reading.
- **Both directions, on values.** A member goes false → **true** on another
  member's photo, its generated variants, their chat's avatar and its variants,
  and a sidecar preview; a non-member — which is also a *removed* member, since
  the predicate's only input is the `chat_members` row — stays **false** on
  every one of them, as does a member on the variants of a chat they are not in.
- **Writes are provably unchanged**, which is the assertion that mattered: in
  all three phases identically, three refused inserts (**42501**) and one
  control insert under the member's own prefix **allowed**, so the probe is
  known to distinguish; and an update of another account's object touched **0
  rows** *including after* the read widened. There is no DELETE probe on
  purpose: `storage.protect_delete` raises 42501, the same code an RLS refusal
  carries, so the two cannot be told apart.
- **Four defects were fixed in the file before it ran.** A banned account would
  have kept reading everything, because `messages` and `chat_members` carry a
  RESTRICTIVE `block banned reads` that a SECURITY DEFINER predicate bypasses —
  now checked, and rehearsed on a real ban row created and rolled back. `LIKE`
  in the sidecar branch was a wildcard hole with 484 of 778 object names
  carrying an underscore — proved by a name the old form admits and
  `starts_with` refuses, not argued. The predicate's owner moved from superuser
  to `postgres`. And the self-check, which had only asserted that a policy of a
  given *name* existed, now proves all three write policies still carry the
  write predicate.
- **Verified after the apply, on values.** Policy on the new predicate; ten
  policies present and the three write ones unchanged, the write predicate's
  definition hash identical; the function `postgres`-owned, SECURITY DEFINER,
  STABLE, `search_path` pinned, ACL `{postgres=X, authenticated=X}` with no
  `anon`; the full value matrix re-measured live and matching the rehearsal.
  Signing one object costs **4.1 ms**; the worst case, the whole
  `variants/messages/` prefix through the predicate, **71 ms** for 778 rows. An
  anonymous request for a real object still returns **200 / 99,344 bytes /
  `image/webp`** with an invented path still **400**, so the route users
  actually use is untouched.

**The ordering correction worth carrying forward.**
`20260919130000_media_path_backfill_for_legacy_messages.sql` is a
**prerequisite for step four**, not the tidy-up D-208 calls it. Ten live
messages carry a `media_url` and no `media_path`, all ten name an object that
exists, and this predicate reaches an original through `messages.media_path` —
so for those ten only the uploader passes. Deriving the address from the URL is
not the same as being allowed to sign it.

**Who can read an avatar now.** A person's avatar, their avatar variants and a
bot's avatar: any authenticated account — 18 of 18 here, where **5 of 18** could
already through the administrator branch, and where the live route is still the
whole internet. A chat's avatar and its variants: members of that chat only. The
migration's header claimed otherwise about a chat's avatar; it was corrected and
the file re-applied so that what is recorded is what ran.

### 2026-09-19 — the clone failure is diagnosed: one of GitHub’s two addresses is unreachable from this host

**Closed as a question after four wrong hypotheses across two days.** It is
not Docker, not the address pools, not conntrack, not NAT, not Horizon, not
DNS, and not a SNAT port collision. **One of the two addresses GitHub hands
out for `github.com` does not answer from this machine.**

Measured **from the host itself**, outside any container, eight attempts each:

```
140.82.121.3   ok  ok  ok  ok  ok  ok  ok  ok      8/8, every one in 0 s
140.82.121.4   —   —   —   ok  —   ok  —   —       2/8, the rest time out
```

and inside a fresh container on the `coolify` network, ten attempts each:
`…3` **10/10**, `…4` **6/10**. The resolver alternates between the two, so a
deployment whose clone happens to get `…4` at a bad moment hangs for the full
~133-second connect timeout and fails. That is the number recorded on every
one of these failures — deployments 438, 439, 445, 457, 472, 473 and 474.

**Why every earlier probe said the network was healthy**, including mine: they
used the literal `140.82.121.3`, which is precisely the address that always
works. A probe cannot see a fault in an address it never contacts. The first
reproduction outside a deployment came from connecting **by name** — one run
in eight hung for the full timeout while the hard-coded address succeeded in
the same container seconds later, and that single disagreement is what pointed
at the two addresses.

**It is upstream, and that is now measurable rather than assumed**: the host
reproduces it with no Docker in the path at all. Nothing in this repository
can fix it.

**What is available, and why none of it is obviously right.** Pinning
`github.com` to the working address in the host’s `/etc/hosts` stops the
failures today and trades an intermittent fault for a total one the day
GitHub rotates that address — a stopgap that must be time-boxed and watched,
not a fix. Lowering `tcp_syn_retries` makes the failure arrive sooner without
making the deployment succeed, because Coolify does not retry a clone.
Raising it with the provider is the only thing that ends it, and that is the
owner’s to do.

**The operational cost meanwhile is one retry**: a push to `main` re-triggers
the webhook, and deployment 475 of the next commit finished normally after
472, 473 and 474 had all failed.

### 2026-09-19 — `56c8f2b8` on every application, and the gateway finally moved

**All five applications now run `56c8f2b8` and all five follow `main`.** Read
off the running containers rather than trusted from a webhook.

#### The Bot Gateway had not been deployed since 2026-09-02

It ran `935a670`, seventeen days old, because it is the one application of
five with Coolify auto-deploy off **and** it was following `codex/bot-platform`
rather than `main`. Both are now fixed: the branch is `main`, and the image is
`twezs89u2m6d6ln6c0rpaqxe:56c8f2b8…`, single container, healthy.

That closes **D-241** (a bot’s picture could not be set), and it carries
**D-248**’s gateway half — the `file_id` re-send — which until now was written
and unreachable, so the database branch applied earlier today was inert.

**Proved with a calibrated probe**, each route by its own method, because «it
answered» and «something answered» are different facts:

```
PATCH …/avatar                401  gateway JSON      ← was 404 HTML before
PATCH …/profile               401  gateway JSON      ← control, always existed
PATCH …/definitelyNotARoute   404  <!DOCTYPE html>   ← control, never existed
```

#### The deployment credential, and why there was none

Every past deployment of this application went through the Coolify API with a
token that no longer exists; the only surviving token holds `["read"]`. On the
owner’s explicit authorisation a second token was created with abilities
**`["deploy"]`** — not `*`. Its plaintext was generated on the server and
written only to `/root/.coolify-deploy-token`, mode 600; Coolify stores
sha256 of it, so the database row cannot be turned back into a usable
credential. Calibrated before use: **401** with no token, **404 `No resources
found`** with the token and a nonexistent uuid, **200** with the real one.

#### Branch state

`main` and `integration/message-actions` are identical. `codex/bot-platform`
remains at `33a3bb83`, an ancestor of `main`, and is now referenced by
nothing.

### 2026-09-19 — `12b6acea` deployed, and the clone failure recurred with new evidence

**Deployed.** `letscube-web` runs image
`l64kyyu1sysev2izzjjbizhe:12b6aceafcf494aa218ca21e5e2855547dcf5f04`, read off
the running container rather than trusted from the webhook. It carries D-234
(the time at the bubble’s corner, including when a forwarded header sets the
width), D-243 (a group with a bot keeps its composer) and D-244 (a group’s
commands reach the bot). PocketFlow ships in the same commits but is not in
this bundle; it has its own image and is not started.

**Gates:** typecheck clean across the workspace, unit **3202/3202**, mounted
routing matrix **15/15**, production build proved by its own lines
(`sw.js build 639c9360c3db11be`, `built in 10.23s`), bot specs 21/21, the
D-234 contract 14/14 at both viewports. Pixels looked at for every visual
change, before and after.

#### The clone failure recurred — deployment 457 — and one new fact narrows it

Same signature as 438, 439 and 445: `Failed to connect to github.com port 443
after **134990 ms**`. With `net.ipv4.tcp_syn_retries = 6` that is a SYN series
exhausting its retries, not a refusal — the packets left and nothing answered.

**The new fact:** deployments **458 and 459 cloned the same repository
successfully within the same two minutes** (all three were created within two
seconds of each other). So at the moment 457 was timing out, this host could
reach GitHub. That rules out the provider’s egress as a whole and rules out
GitHub, which the earlier entries could only infer from a retry afterwards.

**What was tested and did not reproduce it.** Six containers on the `coolify`
network connecting to `140.82.121.3:443` at once: **12 of 12 succeeded**. The
probe was calibrated in both directions before being believed — a blackholed
address FAILed at the timeout and a closed port FAILed instantly.

**And the probe’s timings were garbage, which is worth recording.** The helper
image’s `date` does not support `%3N`: `date +%s%3N` returns ten digits, so
every «ms» it printed was a seconds difference. The verdicts were sound and the
numbers were not — exactly the shape this project already has a note about.

**One observation, offered as a lead rather than a cause.** The host’s
`MASQUERADE` rules carry no `--random-fully`, which is a known source of
precisely this symptom: two containers allocating the same SNAT source port to
the same destination, one SYN silently dropped, a ~130 s timeout, and a retry
seconds later succeeding. It fits every observation — including why six
deliberate simultaneous connects did **not** reproduce it, since a collision
needs the same source port rather than merely the same moment. It is **not
demonstrated**, and adding the flag would be a change to the host’s firewall
made on a hypothesis.

**What would settle it:** the source port of a failing clone. `conntrack` is
not installed on this host and `/proc/net/stat/nf_conntrack` does not exist, so
the counter that would show `insert_failed` cannot be read as things stand.

**Operationally it costs one retry.** A push to `main` re-triggers the webhook,
and deployment 460 of the next commit finished normally.

### 2026-09-19 — a role colour becomes a palette key (D-214), in three steps rather than one instant

**Applied to production.** `20260919170000_a_role_colour_a_reader_can_see.sql`,
sha256 `803200f9…`, identical on workstation, host and inside the container.
`UPDATE 10`; the three blank rows untouched; the hex constraint replaced by the
palette-key one, whose text is byte-identical to `chat_roles`’s own; `role_update`
still owned by `supabase_admin`, still security definer, ACL still
`authenticated=X` with no `anon`, and now validating a key rather than a hex.

#### The ordering is the point

A client and a database cannot flip in the same instant, so it went in three:

1. **`ae2de203`** — the client reads *both* shapes. Deploy-safe alone: with
   every row still a hex, nothing on screen changes. Validated in isolation by
   setting the rest of the work aside — typecheck clean, unit **3314/3314**,
   and the production build run on the state that was actually committed.
2. the migration, after step one was live and the rollover had finished.
3. the picker becomes eight swatches, once no writer can produce a hex.

Within step one, one decision is load-bearing: **the palette is asked before
the hex.** A key like `decade` is also a legal hex body and `normalizeRoleColour`
accepts a bare one, so the other order would paint a colour nobody picked. A
guard asserts no key is hex-shaped and its message says to rename the key —
because the database, the rollback and every future reader have no such
tiebreak.

#### Two measurements corrected the entry that commissioned this

D-214’s title is wrong twice. «Never reaches a pixel» is **false** — it reaches
fifteen, all in the administration panel, which the entry never looked at.
«And cannot» is **right**, and the blocker is one line: the column holds one
value and the product has two themes. Three rescues were measured and all
fail; the third, composing toward the text colour, cannot generalise because
the picker was free — `#FFFFFF` at 80% reads 1.28:1.

And the addendum’s own arithmetic was off, because its script walked up to the
first fully-opaque ancestor and skipped the translucent material. Measured
against the ground the marks really composite on: the 12×12 swatches do **not**
«read fine» — light-theme gold is **1.47:1**, and they read because of the 1px
ring and the size. The 6px dot goes from 1.51:1 to **4.97:1** on a palette key,
and needs no ring — the border token composites to about 1.3:1 on that ground,
so a ring would be a fainter line around a clearer mark.

#### Evidence

Backup `20260919-151623-before-role-colour-palette-key.{schema.dump,roles.csv}`,
1,654,410 and 726 bytes, both `sha256sum -c` OK and the dump read back with
`pg_restore -l` — 2,525 TOC entries with `role_update` present.

Rehearsed **on production inside a rolled-back transaction**, the migration and
its rollback spliced verbatim: owner `#F5B50A` → `amber` → `#F5B50A`, hex
constraint → palette constraint → hex constraint, counts unchanged throughout,
and no residue afterwards.

**The splice itself caught a mistake worth recording.** Stripping `begin;` and
`commit;` by matching anywhere removed **five** lines from the migration and
four from the rollback, because `begin` also opens every plpgsql block — it
would have rehearsed a corrupted function. Only the first bare `begin;` and the
last bare `commit;` are the wrapper, and the strip now asserts it removed
exactly two lines.

**Still open, and named rather than folded in:** `ProfileBadgeChip` drops the
colour entirely, so on a profile card the founder and the technical
administrator still collapse to one tone — the assignment list now tells them
apart and the card does not. And in that list the badge’s *border* still comes
from the tone, so an amber dot can sit in a pink border. Both need their own
decision and their own measurement.

### 2026-09-19 — PocketFlow, and the audit of the Bot Platform it forced

**Nothing deployed.** A new workspace package, `artifacts/pocketflow`, plus a
Docker stage and a compose service behind a `pocketflow` profile. `main` is
untouched; the work is on `integration/message-actions` through `b08b20f1`.

#### Why this exists, and why the audit came first

The owner commissioned a reference bot that is useful to an ordinary person and
is at the same time a compliance test of the Bot Platform from outside — with a
stated requirement that the same source run against Telegram with only
`BOT_API_BASE_URL` and `BOT_TOKEN` changed.

**That requirement does not hold, and the audit is how we know.** The public
API is seventeen methods and four update types, and the disagreement with
Telegram is structural rather than a matter of coverage:

| | LETSCUBE | Telegram |
|---|---|---|
| chat / message ids | UUID | 64-bit integers |
| a file to send | a storage object reference | a `file_id` or an upload |
| a write | `idempotency_key` required | no such field |
| a date | timestamptz string | unix seconds |

So the promise is kept one level up: `src/app/` is written against a neutral
transport interface and never sees a UUID, a storage path or an idempotency
key, and `transport/letscube.ts` is the only module that knows the wire format.
A `transport/telegram.ts` beside it is the whole of a Telegram build.

#### Seven gaps, three of them blocking

Recorded in `docs/proposals/2026-09-19-pocketflow-reference-bot.md`.

**G-1 is the one worth reading.** A bot cannot send a file at all. `sendPhoto`
takes a `chat-media` object path; `bot_upload_authorize_internal` requires the
object to **already exist**; `getFile` returns a signed URL and **not** the
path; and `private.bot_upload_grants` exists, looks like an upload mechanism,
and is referenced by no `storage.objects` policy — so it grants nothing. The
minimal fix is to accept a `file_id` in place of the storage reference, which
is Telegram’s own model and therefore **raises** compatibility rather than
lowering it.

G-2 no inline mode. G-3 no polls. G-4 no `editMessageReplyMarkup`. **G-5 no
`parse_mode`, and the client formats every message anyway** — verified against
`formatText.tsx`, which is why `lib/render.ts` exists and why a test reads that
file and fails if its grammar changes. G-6 nothing from P1 upward. G-7 there is
no SDK and no examples in this repository at all; PocketFlow is the first
external consumer of this API.

#### Three defects found by tests rather than by use

This is the part worth keeping, because each was invisible to inspection:

- `mailto:a@b.c` classified as a **URL carrying credentials**. The scheme check
  required `://`, so a schemeless string with a colon and an `@` became
  `https://mailto:a@b.c`, which parses as host `b.c` with userinfo `mailto:a` —
  and would have been stored by the watcher.
- `завтра Позвонить в 18:00` would have fired **nine hours early**, with a
  confirmation correctly saying «завтра». Nobody would have reported it.
- `net.BlockList.check()` answers **"not blocked"** for a string that is not an
  IP at all, so an SSRF guard built on it fails **open** on garbage.

And two dead controls the wiring test caught on its first run: the «Webhooks»
button on `/start` named an action nobody had registered, and `/help`
advertised `/hook` when the command is `/webhooks`.

#### One of mine, recorded because the mechanism is invisible

Every scripted edit this session wrote through Python’s text mode, which on
Windows converts **every** newline in the file to CRLF. Eighteen files were
rewritten and nothing noticed: `grep` cannot see a CR, and the diff reads as an
ordinary change. It surfaced only when a Dockerfile contract test quoted its
actual value. Scripted edits must read and write bytes.

**Gates at `b08b20f1`:** typecheck clean across the workspace, unit
**3191/3191**, pocketflow **245/245**, compose parses, and the built bundle
proved by running it against a deliberately unreachable database — it loads,
validates its configuration and fails at `connect ECONNREFUSED`, which is the
first thing it should not be able to do.

**Not done:** inline mode and polls are unreachable (G-2, G-3); the `/hook`
endpoint and the update webhook have never run against the real platform,
because a bot token is the owner’s to issue.

### 2026-09-19 — one production migration (D-249, D-250): a bot can fetch the file, and is told how big it is

**No application was deployed.** `letscube-web` keeps its baseline. The gateway
half is written, typechecked and tested but **undeployed**, and the ordering
matters: until `letscube-bot-gateway` is redeployed, `getFile` answers **500**
where it answered 404, because the running `fileMetadata` still asserts
`bucket === "chat-media"` on a row the database now supplies. That is a method
which has never once succeeded, with **0 enabled webhooks** and 0 delivery
attempts on production, so the window costs nothing — but it closes only on a
deploy. Everything D-250 changes is inside the database and needs no deploy at
all: the gateway forwards `update.payload` verbatim.

**`20260919050000_a_bot_can_fetch_a_file_and_is_told_its_size.sql`**, applied as
`supabase_admin` — it owns neither function (both are `postgres`) but may
replace both and may hand the new helper over, and `CREATE OR REPLACE` keeps an
existing function's owner and ACL, which the self-check then proves. One
transaction, self-check, `COMMIT`. 23,793 bytes, sha256
`3cf30a25…0ab1843f`; rehearsal (`78638b1b…`) and rollback (`5148532e…`) beside
it in `.migration-backup/supabase/migrations/`.

- **Backup, taken and verified first:**
  `/srv/letscube/backups/pre-migrations/20260919-065901-before-bot-file-lookup-and-metadata.schema.dump`,
  1,646,195 bytes, sha256 `40b4aeb8…3ed48e5a`. Read back with `pg_restore -l`
  inside the container: 2,504 TOC entries, all three target functions among them.
- **Live vs file, before touching anything:** the deployed
  `bot_file_lookup_internal`, `bot_message_update_payload` and
  `bot_can_receive_message` are byte-identical to
  `20260831100000_bot_platform_foundation.sql` once whitespace is normalised.
- **Grants, measured rather than assumed.** Both functions are owned by
  `postgres` and SECURITY DEFINER, so they run as `postgres`: which has SELECT on
  `storage.objects` and `storage.buckets`, holds BYPASSRLS, and may execute
  `public._kub_chat_media_chat_id` and `private.bot_can_receive_message` — all
  four checked. `postgres` may **not** execute
  `private.message_media_path_allowed`; that pair works only because its caller
  `private.guard_message_media_path` is owned by `supabase_admin`. The new
  helper lives in schema `private` (`postgres=UC/postgres`; `service_role` has no
  USAGE), is handed to `postgres` and closed to PUBLIC.
- **Rehearsed on production inside a rolled-back transaction**, on values: two
  bots, two chats, five storage objects across both buckets and ten media
  messages; BEFORE measured, the migration spliced in verbatim, **13 rules**
  asserted, then the rollback file run verbatim in the same transaction and the
  BEFORE state re-measured. The rollback was run because it was written —
  and the same discipline caught a real bug in a rollback earlier that day.
- **Verified after the apply, on values:** ownership, definer and ACLs intact
  and `service_role` still executes the lookup; of the 262 live media messages
  the size is now known for **262** (was 64) and the mime for **262** (was 65);
  three real messages through the payload builder return `byte_size` as a
  number, `mime_type` as a string and `width` as a number. No real bot is a
  member of a chat that has media, so `getFile` itself cannot be exercised on
  production data — the rehearsal fixture is where that is proved.

**The rule, written down because it is the whole design.** The bucket literal
was the wrong shape of rule, not merely the wrong name: nothing constrains
`messages.media_bucket` at write time, so its safety was accidental — and
accidentally absent in one direction, since a forward carries the source's
bucket and path and a `chat-media` object from chat A, forwarded into B,
satisfied it. Measured in the rehearsal: `00000 bucket=chat-media` before,
`P0002` after. `getFile` now asks what it actually needs — the bot may read the
message, the object **exists** in `storage.objects`, and either the bucket is
**public** or the path is scoped to **this chat** by
`public._kub_chat_media_chat_id`. No bucket name appears in the body.

**Proved by mutation, seven at the database and four in the source.** Dropping
the chat-scoping arm, the object-existence join, `bot_can_receive_message`, the
`size` spelling, the storage-size fallback, the `duration_ms` spelling, or the
numeric `width` each turned exactly one rehearsal rule red. In the source:
restoring the bucket literal (6 tests), the 100 MiB cap (1), the absent-key type
error (1), and letting the recorded SQL name a bucket again (1). **Two of the
seven database mutations passed on the first attempt** — not because the code
was redundant but because the assertions used `<>`, which cannot see an absent
value; they are `is distinct from` now, and all seven go red.

**Two further defects found in `fileMetadata` while fixing it**, either of which
would have shipped a 500 instead of the 404: `jsonb_strip_nulls` means an
unknown fact arrives as an **absent key**, and no production message carries
`media_metadata.file_name` at all; and the gateway's size bound (100 MiB) was
smaller than the `media` bucket's own `file_size_limit` (250 MB).

**Gates:** `@workspace/api-server` typecheck clean; `tests/unit` **3238/3238**
(18 new in `tests/unit/bot-file-metadata.test.mts`); `tests/server` **123/124**
after a fresh build — the one failure,
`voice-call-service-message-db.test.mjs` «the end line lands with no
room_finished webhook at all», is the same **pre-existing** voice-track failure
recorded under D-248 below, and names nothing this change touches.

### 2026-09-19 — one production migration (D-248): a bot can send back the file it was sent

**No application was deployed.** `letscube-web` keeps its baseline; the gateway
half of this change is written, typechecked and tested but **undeployed**, and
blocked on the same two owner actions as D-241 (the only Coolify token has
`read` abilities, and `letscube-bot-gateway` follows branch `codex/bot-platform`).
Until it is deployed, the wire still refuses `file_id` at the zod schema and the
database's new branch is unreachable from outside. The database change is inert
until then, and harmless: every existing payload behaves exactly as before.

**G-1 of `docs/proposals/2026-09-19-pocketflow-reference-bot.md`, the half that
is closable without a new upload route.** The four media methods could not
succeed for any input and never had — measured, not inferred: `chat-media` holds
**0** objects, `private.bot_upload_grants` **0** rows, and **0** of 294 media
messages were ever sent by a bot. Full statement of the defect, the
authorization rule and the mutation table is D-248.

**`20260919040000_a_bot_can_send_back_the_file_it_was_sent.sql`**, applied as
`postgres` — the owner of both functions and of `messages`, `bots`, `chats` and
`chat_bot_members`, and holding BYPASSRLS. One transaction, self-check,
`COMMIT`. 35,363 bytes, sha256
`c480bbd4a53bfb4d46c888d7fda1e09cb1506e1de018e2442f5d6eccda53189b`; rehearsal
(`183bda47…`) and rollback (`28ca0f50…`) recorded beside it in
`.migration-backup/supabase/migrations/`.

- **Backup, taken and verified first:**
  `/srv/letscube/backups/pre-migrations/20260919-030109-before-bot-file-id-resend.schema.dump`,
  1,405,995 bytes, sha256
  `5567f094545fab159c312a72513a9ae204c98b7f318b3aacb21729437b60aaf1`.
  Verified by `sha256sum -c` after writing, and by content: the
  «PostgreSQL database dump complete» marker present, 138 `CREATE TABLE`, 421
  `CREATE FUNCTION`, 212 `CREATE POLICY`, 89 `CREATE TRIGGER`, both target
  functions named.
- **Live vs file, before touching anything:** the deployed
  `bot_send_message_internal` and `bot_message_command_internal` agree with
  `20260831100000_bot_platform_foundation.sql` byte for byte (6,726 and 8,146
  normalised characters, identical). The new bodies were then generated **from
  that file by exact string replacement**, so the unchanged parts cannot drift.
- **Rehearsed on production inside a rolled-back transaction, on values.** A
  bot, two group chats and five media messages; the before state read
  (`22023 bot_send_media_input_invalid` for a `file_id` send;
  `42501 bot_media_grant_required` for the storage-reference send), then the two
  bodies spliced in verbatim and ten rules asserted. Production unchanged
  afterwards: 0 leftover rows, 0 grant rows, and the live bodies still without
  `file_id` before the apply.
- **Proved by mutation, on the database.** Removing one predicate at a time from
  the rehearsal's DDL and re-running it on production: dropping
  `source_message.chat_id = p_chat_id` makes the cross-chat send **succeed**
  (`00000`), dropping `bot_can_receive_message` admits a message older than
  `joined_at`, dropping `deleted_at is null` admits a deleted message, and
  dropping the `type` match sends an image as a video. Four rules, four
  assertions, each red for its own reason; the unmutated control passes.
- **Verified after the apply:** the same ten rules pass on the committed
  functions; the ACL is byte-identical to the pre-apply measurement
  (`postgres=X/postgres service_role=X/postgres`, owner `postgres`, security
  definer), `service_role` still holds EXECUTE on both, and the live bodies now
  match the migration file exactly.
- **The rollback was run, not merely written.** Dry-run on production with its
  final `commit;` replaced by `rollback;`: both bodies restored, both grants
  re-asserted, its self-check passed, live bodies unchanged afterwards (same
  `md5(prosrc)` before and after). The first attempt failed at
  `syntax error at or near "prosrc"` — `position(x in y)` is a special SQL form
  and cannot take a `pg_catalog.` qualifier; it is now `pg_catalog.strpos`. An
  untested rollback is not a rollback, and this one would have failed at the
  moment it was needed.

**The authorization rule, written down because it is the whole design.** A
`file_id` resolves only when the bot may **read** the source
(`private.bot_can_receive_message`, unchanged), may **send** into the
destination (`bot_membership_authorize_internal`, unchanged), **and the source
message is in that same chat**. The third is a deliberate narrowing of Telegram:
a same-chat re-send points at an object an already-visible message in that chat
points at, so nobody gains a byte, whereas a cross-chat re-send would turn «may
see in A» into «may publish in B» — the escalation `joined_at` exists to
prevent, with a bot choosing when. Narrowing is reversible; a leak is not.

**Two defects the measurement turned up, recorded and not fixed.** D-249:
`bot_file_lookup_internal` looks only in `chat-media`, so `getFile` has returned
404 for **every** real file since the platform shipped — and the gateway
re-asserts the same literal, so relaxing the database alone would turn the 404
into a 500. D-250: the app writes `size_bytes`/`duration_ms` while the bot API
reads `size`/`duration`, so every `attachment.byte_size` a bot has ever seen was
null. **Uploading new bytes remains open** and is the larger half of G-1; it
needs a real upload route, and `private.bot_upload_grants` cannot serve as one
because no `storage.objects` policy references it.

**Gates:** `@workspace/api-server` typecheck clean; `tests/unit`
bot suites **94/94** (83 existing plus 11 new in
`tests/unit/bot-file-id-resend.test.mts`); nine source-side mutations killed
9/9. `tests/server` **123/124** — the one failure,
`voice-call-service-message-db.test.mjs` «the end line lands with no
room_finished webhook at all», is **pre-existing and belongs to the voice
track**: that test loads a fixed list of four voice migrations plus
`20260918200000`, names none of this work, and runs on PGlite rather than on
anything this change touches.

### 2026-09-19 — one production migration (D-242), and why `letscube-bot-gateway` was not deployed

**No application was deployed.** `letscube-web` keeps the baseline below; the bot
gateway still runs `935a670db6ab…c62a35` (`Up 2 weeks`, healthy). One database
migration was applied.

**`20260919030000_a_refusal_to_set_a_picture_says_why.sql`**, applied as
`supabase_admin` — `postgres` neither owns `bot_set_avatar_internal` nor could
execute it. One transaction, self-check, `COMMIT`. Migration sha256
`0b143ea7…48dfe2d1`; rehearsal and rollback recorded beside it in
`.migration-backup/supabase/migrations/`.

- **Backup, taken and verified first:**
  `/srv/letscube/backups/pre-migrations/20260919-022448-before-avatar-refusal-says-why.schema.dump`,
  1,640,957 bytes, sha256 `1ff13821…95bb2a90`. Verified by reading it back with
  `pg_restore -l` inside the container — 2,504 TOC entries, the target function
  among them. (`pg_restore -l /dev/stdin` over a pipe cannot verify a custom-format
  dump: it needs to seek, and answers «did not find magic string in file header»
  on a perfectly good archive. Copy the file into the container instead.)
- **Live vs file, before touching anything:** the deployed definition and
  `.migration-backup/supabase/migrations/20260904010000_bot_avatar.sql` agree
  byte for byte — both bodies 1,368 bytes, sha256 `e5a09bcd…`.
- **Rehearsed on production inside a rolled-back transaction**, on values rather
  than on DDL: each of the five refusal paths called and its SQLSTATE read, once
  as `supabase_admin` and once as `service_role`, before and after the change
  spliced in verbatim. 24 measurements; production unchanged afterwards (5
  `P0001` lines still present, ACL unchanged, 3 active bots, 3 owner rows).
- **Verified after the apply**, the same twelve calls on the committed function:
  `22023`, `42501`, `P0002`, `55000`, `22023`, and the success path returning —
  identical as `service_role`. Live body now sha256 `7b5d1cff…`, identical to the
  file.

**The migration carries a second fix nobody had filed.** The function's ACL was
`{supabase_admin=X/supabase_admin}`: `service_role`, the role the Bot Gateway
resolves to through PostgREST, could not execute it at all, and every call
answered `42501 permission denied for function bot_set_avatar_internal` before
the function's own checks ran. `20260904010000_bot_avatar.sql` revoked from
`public, anon, authenticated` and granted to nobody — the same mistake as the
2026-09-05 `_kub_bot_avatar_path_allowed` repair, in the same migration, one
function over. Fixing the SQLSTATEs alone would have shipped a feature that still
could not work, and would have reported the permission failure as «Бот не
найден». The grant is to `service_role` only; `anon`, `authenticated` and PUBLIC
stay out and the self-check enforces it. (`postgres` now reads as able to execute
it: it is a member of `service_role` and inherits the grant.)

**The deployment of `letscube-bot-gateway` (D-241) is blocked on two things, both
of them owner actions.** First, no credential on this instance can trigger a
deployment: `personal_access_tokens` in `coolify-db` holds one row with abilities
`["read"]`, auto-deploy is off (`is_auto_deploy_enabled = false`), and `php
artisan` has no deploy command; every past deployment of this application went
through the API with a token that no longer exists. Second,
`applications.git_branch` for `twezs89u2m6d6ln6c0rpaqxe` is **`codex/bot-platform`,
not `main`** — deploying it «at `main`» means changing the branch it follows.

It does not have to be changed. `origin/codex/bot-platform` is `33a3bb83`
(2026-09-12), an ancestor of `main`, and already contains `b5402f7d`; everything
that enters this image is byte-identical to `main` there. Details and the
calibrated pre-deploy probe are in D-241.

### 2026-09-19 — `b35da2e2` (the owner's first real call, three defects it found, and slice F)

**Current baseline.** `letscube-web` runs image
`l64kyyu1sysev2izzjjbizhe:b35da2e2…`, single replica. Deployments 450, 451 and
452 all finished; the clone failures recorded below have not recurred since.

#### The owner made one test call, and it found three defects no test could

This is the entry's reason for existing. Every gate was green, every spec
passed, and one real call produced five system messages where one belonged, a
connection that hung itself up every few seconds, and a participant count that
flapped. **The three share a shape**, and it is worth more than any of the
fixes:

| | the old rule | the new subject matter it was handed |
|---|---|---|
| D-237 | the group-call trigger announces a room | a room in a **private chat** |
| D-238 | the participant count is presence | a count driven by a hanging-up client |
| D-239 | the rail's view decides a call is over | a call **the rail never lists** |

Each rule was correct when written. Each was given a case its author could not
have had in mind. And **every test of each one passed**, because a test supplies
the subject matter the rule was written for — a group chat, a healthy client, a
rail channel. A feature that changes what an old rule's inputs *mean* is not a
change that rule's tests can see.

**D-239 is the one that made the feature unusable**, and the SFU's own log named
it while ruling out the obvious answer: every disconnect said
`CLIENT_REQUEST_LEAVE` with ICE healthy and on UDP, and every return was a fresh
session with `Reconnect: false`. Not a network fault — the application hanging
up on itself, because `voiceCallLostItsChannel` read «this chat's view lists no
such channel» as «an administrator ended it», which is true of a group and is
the permanent state of every private chat.

#### What else shipped

- **Sound.** Synthesised rather than sampled — oscillators and an envelope, no
  audio files and no licensing question. The ring is 440 + 480 Hz on a
  1.2s-on / 2s-off cadence; the 40 Hz beat is what makes it read as a telephone.
  Silence is one rule rather than eight handlers: the sound is driven by the ring
  row's state, so every way a call can end is the same `state !== "ringing"`.
- **The band a person cannot miss** — accent wash, pulsing avatar ring, state as
  an eyebrow above the name (the old order was the shape of a chat-list row,
  which is what the owner read it as), and filled labelled buttons.
- **Slice F, «Активные сеансы»** — the device list and a per-device call switch,
  built on `auth.sessions` rather than `user_push_devices`, because that table is
  keyed on a push token and a browser tab with no notification permission still
  rings.
- **D-222 tier 2** — where the register's own instruction («one screenshot each
  at 768 and 1024 before anybody edits them») paid for itself: 3 of 8 lines bite,
  5 do not, and the worst was understated — a grid **103px wider than its pane**,
  so «удалить команду» was painted past the edge of the window.

#### Five more production migrations

`20260918250000` (the call record), `20260918260000` (the missed-call sweep, on
`pg_cron`, observed running), `20260918270000` (the hours arm), `20260918280000`
(the private chat stops being told about a channel, with four stray rows deleted
under a predicate narrow enough to reach only them), `20260918290000` (the device
registry) and `20260919000000` (session times said in UTC). Each backed up,
rehearsed in a rolled-back transaction on production, and verified on values.

**The last one is a latent defect found by an agent reviewing my work, and
proved by mutation.** `auth.sessions.refreshed_at` is `timestamp WITHOUT time
zone` while its neighbours are not, and the listing cast it `::timestamptz` —
which interprets it in the **reading** session's zone. A session refreshed 29
days 20 hours ago was listed for a reader in UTC and **absent** for one in
Asia/Tokyo:

```
old (::timestamptz)      UTC 1 | Tokyo 0 | UTC+14 0
new (at time zone 'UTC') UTC 1 | Tokyo 1 | UTC+14 1
```

A no-op on this deployment, where the server is UTC and no role overrides it —
which is exactly why it would have gone unnoticed until somebody's device
vanished from their own list.

#### The deployment failures, closed as far as they can be

Six of roughly fourteen deployments failed at `git clone` with a ~133-second
connect timeout. Ruled out by measurement: Docker's address pools (unchanged and
not conflicting), conntrack (381 of 262144), NAT and FORWARD (present, millions
of packets passing), GitHub's webhooks (all 200), Horizon (cycling normally),
and DNS (stable, both addresses reachable). Twelve fresh containers on the same
network cloned the same repository in 0.65 s each, and the exact failing command
run by hand completed in 2.9 s.

**One wrong turn is recorded because it was mine.** A probe reporting every
destination blocked — GitHub, Cloudflare, Google DNS, Docker's registry —
briefly looked like proof of a network fault. It was written with `</dev/tcp/…>`,
which is a bash construct, against an image whose `sh` is not bash: every address
answered «no such file». A probe that answers the same thing about everything is
not evidence, and this project already had a note saying so.

**Gates at `b35da2e2`:** typecheck clean across four packages, unit **3148/3148**,
and at each commit the specs covering what it touched at 1440 and 390. Pixels at
every step. One pre-existing flake is named rather than absorbed:
`voice-call.spec.ts`'s connection-panel test fails about half the time at 390,
A/B'd at 9/9 with the new work and 8/10 without it over 18 runs per arm.

**Still open:** D-238, which cannot be closed without watching a call made after
D-239's fix — and no call has been made since. Slice D needs a device. Slice G is
specified in §4b of the proposal and is being built.
### 2026-09-18 — `09c6ae76` (one-to-one calls complete: A, B, C and E, and three more migrations)

**`main` is at `09c6ae76`. Production is not, yet** — deployment 445 failed at
the clone, for the third time today with the same signature (see the section
below). `b5c02b3b` is what is serving, so slices A, B and C are live and slice
E's notice is not. The database half of every slice was applied directly and is
unaffected either way.

What a person can now do that they could not this morning: **call the other
participant of a private chat**, from either side; be rung on **every device
they are signed in on**, with the rest stopping the moment one answers; and read
in the conversation afterwards **what the call was** — answered with its length,
missed, declined or cancelled, worded from their own side of it.

#### The commits

- **`7cee6672`** — slice C, the missed-call sweep (`pg_cron`, every minute).
- **`b5c02b3b`** — slice B's client half: the row in the conversation, the
  chat-list preview, and the hours arm the renderer's author found missing in my
  migration.
- **`09c6ae76`** — slice E: the notice the iPhone gets and nobody else does.
- **`c7a63529`, `0d771881`, `fdf97646`, `2b295493`** — the deploy records, the
  failed-deployment diagnosis, the slice F fork, and D-234/235/236.

#### Three more production migrations, each backed up, rehearsed and verified

- `20260918250000_a_call_says_so_in_the_private_chat.sql` — backup
  `pre-20260918250000-call-record-20260918T150815Z.sql` (1,382,869 bytes, sha256
  `fd29d841…`). The outcome is **derived, never reported**: the function still
  validates the word the client sends and then ignores it. Rehearsed with a
  client deliberately lying — `declined` on an answered call — and the record
  came out `answered` with 192000 ms.
- `20260918260000_a_missed_call_is_recorded_even_if_nobody_is_there.sql` — backup
  `pre-20260918260000-missed-sweep-20260918T152548Z.sql` (1,386,487 bytes, sha256
  `5c0eb7c1…`). Observed running rather than assumed scheduled: three consecutive
  minutes in `cron.job_run_details`, each `succeeded`.
- `20260918270000_a_call_over_an_hour_says_hours.sql` — backup
  `pre-20260918270000-hour-arm-20260918T162419Z.sql` (1,389,591 bytes, sha256
  `4a445552…`). An hour read «Звонок, 60 мин 0 с»; it now reads «Звонок, 1 ч».
  The self-check asserts **every older arm case by case** rather than trusting
  that an added branch changed nothing.

#### The grant trap, twice, with opposite answers

Worth recording together because the same question produced two different right
answers on two tables the same day.

On `voice_channels`, INSERT is held at the **table** level and UPDATE column by
column, so three new columns arrived writable-on-insert — and a blocked caller
could have inserted a room already ringing, stepping around the one gate the
owner's «every private chat, minus the block list» rests on. Closing it needed
the grant **replaced**, because a column-level revoke against a table-level grant
is accepted without complaint and changes nothing.

On `messages`, the identical shape does **not** matter, and that was measured
rather than hoped: the INSERT policy requires `uid() = user_id` and UPDATE
requires `user_id = uid()`, while a system row must carry `user_id IS NULL`. A
client can neither insert nor update one, whatever the column grants say — proved
in the rehearsal by trying it, where RLS refuses. Narrowing a twenty-column
table-level grant on `messages` would have been a far riskier change than the one
it was protecting against.

#### Two defects that would have shipped, both found by the people building them

**Every call-back button in the product, dead until reload.** The busy guard read
`channelId !== null`, and `useVoiceCall` publishes a failure as
`{...IDLE, phase: "failed", channelId}` — so one dismissed microphone prompt
would have made every «call back» answer «Вы в другом голосовом чате» for the
rest of the session.

**A ring that outlived its call locked a pair out for ever.** `voice_call_ring`
refuses a `ringing` **or** `answered` room, and nothing cleared an `answered`
one — so a call whose clients all died left those two people unable to call each
other again, with nothing in any interface able to fix it. Repaired on two
clocks: the recount's existing two-minute grace for the residue, and thirty
seconds inside `voice_call_ring` itself, because two minutes of «you cannot call
this person» is a shorter defect rather than none.

#### What is still not built, named so it is not mistaken for done

**Slice D** — Android ringing while closed — is not startable without a device.
**Slice F** — the per-device switch — has a fork recorded in the proposal: the
registry should probably be `auth.sessions` rather than `user_push_devices`, and
it needs a product decision about what «active» means (342 sessions across 15
users, `not_after` null on every one) plus one verification (`session_id` in the
access token, strongly evidenced against the deployed gotrue binary and not yet
read off a real token).

#### The clone failure is now a recurrence, not an incident

Deployments **438, 439 and 445** all died at `check_git_if_build_needed()` with
«Failed to connect to github.com port 443» — and the number is nearly identical
each time: **134872 ms, 133969 ms**. That is a connect timeout being exhausted,
not a refusal, which is the signature of SYN packets being dropped rather than
answered.

Everything measured around it says the pieces are healthy: the same command,
from the same network, with the same helper image, answers in **0.65 s**
immediately afterwards and returns the right commit; GitHub delivers its
webhooks with 200; Horizon cycles its workers normally; the address pools are
the custom ones this server needs. Deployments 440–444 succeeded in between.

So it is sporadic and it is **not diagnosed** — three out of roughly eight
deployments today. Stated as an open question rather than as a closed incident,
because «transient, recovered» was the honest reading after the first two and is
no longer a sufficient one. What would settle it: whether the failure correlates
with the provider's egress or with something Coolify does to the build
container's network, which needs a failure caught while it is happening rather
than read afterwards.

**Gates at `09c6ae76`:** typecheck clean across four packages, unit **3095/3095**,
and at each commit the specs covering what it touched at 1440 and 390. Pixels at
every step, looked at rather than scanned — and they earned it twice: the ring
card was photographed sitting on the conversation's date separator, and the
release card's chips were photographed still ellipses after the grid fix.
### 2026-09-18 — two deployments failed on a transient GitHub outage, and three wrong hypotheses first

**Not a code failure, and the diagnosis is the point.** Deployments 438 and 439
(`fb433a5b` and `a9bac968`) both failed after ~2m 18s, six minutes apart, at the
**clone**, before a single build step ran:

```
fatal: unable to access 'https://github.com/ALTIS13/LetsCube-Chat.git/':
  Failed to connect to github.com port 443 after 134872 ms
Deployment failed: … check_git_if_build_needed()
```

Afterwards, from the **same network with the same image**, the same operation
took 0.35 s and returned the right commit:

```
docker run --rm --network coolify ghcr.io/coollabsio/coolify-helper:1.0.14 \
  sh -c 'git ls-remote --heads https://github.com/ALTIS13/LetsCube-Chat.git main'
→ a9bac9680f775a963fa86afcadda8f607ec13590  refs/heads/main
```

So: transient, recovered, and nothing to fix. Production kept serving
`c7a63529`, and what did not reach it was a test file and documentation — the
database changes those commits *describe* were already applied directly, so no
user-facing behaviour was waiting on the deploy.

#### Where the evidence lives, because it took too long to find

Coolify keeps the whole build transcript in its own database, and no token is
needed to read it:

```
docker exec coolify-db psql -U coolify -d coolify -At \
  -c "select id, status, created_at from application_deployment_queues order by created_at desc limit 4;"
docker exec coolify-db psql -U coolify -d coolify -At \
  -c "select logs from application_deployment_queues where id = <id>;"
```

`logs` is a JSON array of `{output}` lines — the failing command included.

#### The three hypotheses that were wrong, and the one reading error behind them

**`docker logs coolify` stamps in UTC; the host's `date` is MSK.** Read as one
clock, a perfectly live queue looked like one that had stopped three hours
earlier — the last line said 15:12 while the host said 18:11. That single
misreading produced all three detours:

1. **«Horizon is stuck.»** Measured instead: the worker processes were 0:44,
   1:43 and 2:41 old, so Horizon was cycling them normally. A stuck queue has
   old workers, not fresh ones.
2. **«The webhook is not arriving.»** Measured instead:
   `gh api repos/ALTIS13/LetsCube-Chat/hooks/<id>/deliveries` shows all three
   hooks delivering with **200**, the most recent one *while I was looking at
   it* — which is what finally exposed the timezone error.
3. **«Docker's address pools drifted»** — the failure mode this server has
   actually had before (see CLAUDE.md §8). Measured instead: `daemon.json` still
   carries `bip 192.168.240.1/24` and the `172.30.0.0/16` pool, and GitHub was
   reachable from the host, from the default bridge and from the `coolify`
   network alike.

The rule this restates, which this file already holds in other words: **read
the log the system wrote before reasoning about the system.** Each of the three
checks above was sound work answering a question that was never the question.
### 2026-09-18 — `10a87f09` (a private chat rings, and three production migrations behind it)

**Current baseline.** `letscube-web` runs image
`l64kyyu1sysev2izzjjbizhe:10a87f094dfca77bfa57cdabd704daac224399db`, read off the
running container; the previous replica (`f795e76e…`) was observed alive beside
it and then gone.

**Proved in the served bundle, both ways.** `/assets/index-dt238rK2.js`
(3,126,459 bytes, path taken from the page on the same request) carries
«Входящий звонок» twice and `voice_call_ring` once, with «Вы в разговоре» as the
control that this is the real bundle. At `HEAD~1` the first two appear nowhere in
`artifacts/kub/src` and the control does — which is the half that makes their
presence mean anything.

Three commits:

- **`f795e76e`** — D-222 tier 1 and half B: the settings screen asks the box it
  is drawn in rather than the window. Recorded in its own right below.
- **`6cf783df`** — the first two call migrations, applied and verified before the
  client half existed.
- **`10a87f09`** — the client half, the third migration, and D-233.

#### Three production migrations, each backed up, rehearsed and verified

All three applied as `supabase_admin`, which owns `voice_channels` — ownership
here does not follow the schema and was read off `pg_tables.tableowner`, not off
a migration's description of itself. There is no other database with this schema,
so every rehearsal ran **on production inside a transaction ending in ROLLBACK**,
on synthetic rows, with `auth.users`'s and `profiles`'s registration triggers
disabled inside that transaction so that no real account was read or written.

- `20260918220000_a_private_chat_can_ring.sql` — backup
  `pre-20260918220000-private-chat-ring-20260918T105612Z.sql` (1,367,301 bytes,
  sha256 `db1d1b31…`, 138 `CREATE TABLE`). Thirteen probes, each answering a
  value: the non-owner makes the room through the RPC where their own insert is
  refused by RLS, a group is refused, a block is refused, a second ring is
  refused, the caller cannot answer themselves, stopping twice is not an error, a
  nonsense reason is, a drifted room is normalised, an incoherent ring violates
  its constraint, and nothing outside the rehearsal moved.
- `20260918230000_a_ring_cannot_be_forged.sql` — backup
  `pre-20260918230000-ring-forgery-20260918T110141Z.sql` (1,379,468 bytes, sha256
  `93abf8d3…`, 138). Written because verifying the first one on the applied
  database printed `INSERT,SELECT` where its own header said «SELECT and nothing
  else».
- `20260918240000_a_call_that_died_does_not_lock_the_pair_out.sql` — backup
  `pre-20260918240000-ring-lockout-20260918T121104Z.sql` (1,380,828 bytes, sha256
  `a147d02a…`, 138). Written because a call whose clients all died left the pair
  unable to call each other **for ever**.

#### The two findings worth more than the migrations

**INSERT and UPDATE on one table were granted at different levels, and a new
column inherits accordingly.** UPDATE on `voice_channels` is held column by
column — seven of them — so the three ring columns got nothing. INSERT is held at
the **table** level, and a table grant covers every column the table will ever
have, so they arrived writable-on-insert. Since a private chat's owner may insert
a room there, a blocked caller could have inserted one **already ringing** and
stepped around the single gate the owner's «every private chat, minus the block
list» rests on.

**And the obvious fix is a silent no-op.** `revoke insert (col) … from
authenticated` against a table-level grant is accepted without complaint and
changes nothing — a column-level revoke cannot cut a table-level privilege. It
was caught only because the self-check compared `column_privileges` with what it
wanted instead of assuming the statement had worked. The grant had to be
*replaced*: revoked whole, re-granted as the explicit fourteen columns, asserted
in both directions, and a group voice channel proved to still insert afterwards.

#### What the ring rests on, verified at the right level

The whole design is «the subscription that already exists carries it», so three
things were checked rather than assumed: `has_column_privilege('authenticated',
…, 'SELECT')` answers true for each ring column — the predicate Realtime actually
uses, and the one `has_table_privilege` famously lies about here; the table is
published for insert, update and delete; and the publication carries **no column
list** (`pg_publication_rel.prattrs is null`), which is what makes a column added
today reach the wire at all.

**Not yet observed:** a ring travelling over a live WebSocket to a second signed-in
device. The three conditions above are what that requires and each is verified;
the wire itself has not been watched, and this line says so rather than claiming
it has.

**Gates at `10a87f09`:** typecheck clean across four packages, unit **3063/3063**,
`voice-call.spec.ts` and `voice-ring.spec.ts` **138 passed** across 1440 and 390.
Pixels in both directions, both themes, both widths — and they earned their keep:
the desktop ring card was photographed sitting across the conversation's date
separator and its «НОВЫЕ СООБЩЕНИЯ» mark, which is what turned it into a band in
the flow at every width (D-233).
### 2026-09-18 — `313c5b83` (six more deploys the same day; the microphone stops being open all the time)

**Current baseline.** `letscube-web` runs image
`l64kyyu1sysev2izzjjbizhe:313c5b836e6646bc0b80a9fd9e3a2fcd22721714`, read off the
running container rather than trusted from the webhook, and the previous replica
(`db6742eb…`) was retired during the rollover — both were observed alive together
for about a minute and then only the new one.

**Proved in the served assets, in both directions**, because a marker absent from
a live bundle proves nothing on its own. The asset paths were taken from the page
on the same request: `/assets/index-BP5tNQzl.css` (239,714 bytes) carries
`kub-hold-target`, with `kub-voice-call-bar` as the control that the sheet is the
real one; `/assets/index-DxspfRVI.js` (3,113,057 bytes) carries «Говорить», with
«Выйти» ×5 as its control. Both markers are **absent at `HEAD~1`**, which is the
half that makes their presence mean anything. Neither marker has an upper-case
letter, so the CSS build's lower-casing — which has silently sunk a marker before
on this project — could not apply.

Six pushes since `fbbd5e2d`, each of which rebuilds `letscube-web` whether or not
it touches the application (docs-only pushes redeploy it here):

- **`d3341661`** — the privacy policy says what a voice call does, section 7 added
  and 15 sections renumbered to 16; the Android listing stops describing the
  microphone permission as only a recorder and gives live call audio its own Data
  Safety item naming Play's «processed ephemerally».
- **`49eec894`** — D-231: a pre-call connection test cannot honestly be built
  here, with the measurement that says why. A feature deliberately **not** built,
  because it would have lied to every user.
- **`465653cc`, `d4790286`, `03fff708`, `db6742eb`** — the one-to-one call
  proposal and its three revisions: the ring measured per shell, the owner's
  Windows decision and what a «device» actually is here, and the hidden-window
  throttling risk that nobody has checked (open question 8).
- **`41d23fb2`** — Windows autostart, to the tray and normally. Slice D2 of that
  proposal, complete: `winreg` directly rather than `tauri-plugin-autostart`,
  which bakes its launch arguments at init (so «start minimised» could not be
  toggled) and writes the program path unquoted (so any account with a space in
  the user name would get a command line Windows truncates). Observed in the
  registry at every step with a known-present control read in the same call.
- **`313c5b83`** — push-to-talk and the voice gate (D-232). See below.

**What `313c5b83` changes for a person in a call.** The microphone had two states
— publishing, or self-muted — so a shared room heard everything in between.
Three modes now: «Всегда» (what the product has always done, and the default, so
a stored setting goes on meaning what it meant), «По голосу» (a gate with 6 dB of
hysteresis and a 400 ms hold), «Рация» (a held key or a held button, with no
hold-open at all).

The gate drives `MediaStreamTrack.enabled` rather than a mute, and that was
measured rather than preferred: against a loopback `RTCPeerConnection`, **4902
bytes in two seconds enabled and 482 disabled**, with `media-source.audioLevel`
at 0 — so the room hears silence while the publication, the permission and the
participant list stay untouched. A mute would have blinked a crossed microphone
beside the person's name through every sentence.

**Scope, stated rather than buried:** push-to-talk and the noise gate are named
twice as *out of scope* in `docs/proposals/2026-09-13-voice-channels.md`. Both
lines are struck through in place with an addendum under section 7 saying what
was built and why, rather than quietly deleted. D-232 in
`docs/INTERFACE_DEFECT_REGISTER.md` carries the measurements.

**Gates at this commit:** typecheck clean across all four packages; unit
**3035/3035**; the voice e2e **54/54 at both 1440 and 390**; audio settings and
the channel rail 70 passed with 24 skipped (width-dependent tests and opt-in
captures, each with a named reason). Pixels re-captured in both themes at both
viewports and looked at, not scanned.

**Two contracts proved by mutation rather than asserted.** Four mutations of the
44px hold target turn `tests/unit/touch-target-system.test.mjs` red — removing
the opt-in, shrinking the area to 2px, painting a ground on it, and lifting it
out of the coarse-pointer query. And the e2e half, which is the one that matters:
a press 5px above the painted pill resolves to the talk control on a phone and to
the capsule's own padding on a computer; with the class removed the phone answers
«capsule» too. A stylesheet rule that reaches nothing looks identical to one that
works, which is exactly how `.kub-range` spent half a day inside a desktop-only
media query.
### 2026-09-18 — `fbbd5e2d` (eighteen deploys, one day, and five production migrations)

- **`0b5d62df`** — the voice gateway's moderation half: `/force-mute` and
  `/remove`, with the authorisation matrix, the rate limit and the client's
  refusal vocabulary. Deployed to the functions volume after a verified backup
  and checked by a calibrated route probe: `token`, `force-mute` and `remove`
  all answer 400 to an empty body while `NoSuchRouteZZZ` answers 404 — a route
  that exists rejects the body, one that does not rejects the path.
- **`fbbd5e2d`** — slice 5's server half (D-230) and slice 3's last two items
  (D-228, D-229). Four deployables and two production migrations, each verified
  separately rather than inferred from the push.

  **`letscube-web`** and **`letscube-worker`** both read off the running
  containers at `fbbd5e2d…7079e8`; the worker logged `voiceReconciler started`
  with its 30-second tick, which is where the rate limit's prune lives.

  **The Edge Function**, eight files copied to
  `/srv/letscube/platform/supabase-docker/volumes/functions/voice-gateway` after
  a backup to `/srv/letscube/backups/functions/voice-gateway-20260918T070527Z.tgz`,
  and **all eight compared byte for byte** — local and remote sha256 identical
  for `index.ts`, the new `admission.mjs`, and the six unchanged modules.

  **Two environment names added**, with both files backed up first to
  `/srv/letscube/backups/config/` (stamp `20260918T070649Z`):
  `VOICE_ENABLED=true` — behaviour-neutral, because the gateway treats absent,
  empty and `true` alike as open, so setting it is what makes the switch
  *operable* — and `VOICE_MAX_TOTAL_PARTICIPANTS=` **left empty**, which is no
  cap and today's behaviour. The insertion refuses rather than guesses: the
  script checks its anchor matched exactly once before replacing the file.

  **The kill switch was proved live, and proved scoped, by driving it.** With
  `VOICE_ENABLED=false` and the container restarted:

      token       -> 503 {"ok":false,"error":"voice_disabled"}
      force-mute  -> 400 {"ok":false,"error":"invalid_request"}
      remove      -> 400 {"ok":false,"error":"invalid_request"}
      webhook     -> 401 {"ok":false,"error":"unauthorized"}

  That single probe answers two questions at once. The switch works — and it
  also proves the container is running the **new** code, because the old code
  would have answered `400` there; no separate staleness check was needed. And
  the three routes it must *not* touch still answer for themselves: a moderator
  keeps their levers while a call drains, and the SFU's events still reach the
  gateway, so no chat list is left showing calls that had ended.

  Restored to `true` and re-probed: `token` back to 400, `NoSuchRouteZZZ` 404.
  A route that exists rejects the body; one that does not rejects the path.

  **Two production migrations, each backed up, rehearsed and proved
  behaviourally after applying.**

  `20260918200000_a_call_says_so_in_the_conversation.sql` as `supabase_admin`,
  backup `pre-20260918200000-call-service-message-20260918T064858Z.sql`
  (1,353,004 bytes, sha256 `ac9eeee7…`, 137 `CREATE TABLE`). Asked on production
  after applying, `voice_call_transition` answers `start / nothing / end /
  nothing` for 0→1 unannounced, 1→2 announced, 2→0 announced and 0→1 already
  announced — which *is* «once per call, not once per join», stated as four
  values rather than as a claim.

  `20260918190000_voice_limits_bind_the_deployment.sql` as `supabase_admin`,
  backup `pre-20260918190000-voice-limits-20260918T070048Z.sql` (1,359,780
  bytes, sha256 `f5413a57…`, 137 `CREATE TABLE`). **Rehearsed twice**, and the
  second time was not optional: the first rehearsal was on a throwaway
  PostgreSQL 18.4 cluster, and production is **17.6** read off `version()`, so
  the whole file was rehearsed again here inside a transaction that ended in
  ROLLBACK. Proved behaviourally afterwards, inside another rolled-back
  transaction: the 21st attempt in a window is refused with
  `retry_after_seconds: 60`; **three refusals later the table still holds
  exactly 20 rows**, which is the property that bounds it by the limit rather
  than by the attack rate; a different caller is unaffected; `moderate` has its
  own allowance; and with two in-flight mints and no connected rows
  `voice_active_participants(30)` answers 2 while
  `voice_active_participants(0)` answers 0 — the two terms of the cap, told
  apart.

  One probe of mine was refused by the table's own CHECK constraint because I
  spent an action named `probe`, which is not one of the two it allows. The
  constraint doing its job, and the cheapest possible confirmation that the
  action vocabulary is closed.

  **Waiting on the owner:** `VOICE_MAX_TOTAL_PARTICIPANTS` is empty, which means
  no ceiling. The number cannot be derived from this repository — section 1.6 of
  the voice proposal records no `nproc`, no `free -h` and no traffic allowance
  for this host — and the only measured input is the egress table of section
  2.3: **18.2 Mbps worst case for one room of twenty, 117.6 for one of fifty,
  per room and quadratic.** Setting it is one line in the functions `.env` plus
  a container restart.

- **`1af94092`** — per-participant volume (D-227), and the slider track token it
  needed. Verified in the live bundle **and** the live stylesheet: four product
  sentences present, a control present, a fabricated one absent, and both
  `--kub-range-track` declarations shipped — `#081629` and `#dcebf7`.

  Worth recording because it nearly became a false report: the probe said
  `#DCEBF7` was **absent**. The production CSS pipeline lower-cases hex, and the
  needle that matched was the one whose digits contain no letters. Reading the
  declaration out whole (`--kub-range-track:[^;]+;`) printed both values at once
  and settled it; a case-sensitive hex needle against a built stylesheet cannot.

- **`8d0898ca`** — the call bar (D-225) and the record of the database change
  applied the same hour (D-226). Image tag read off the running container;
  markers verified in the live bundle with a control present and a fabricated
  one absent.

  **One production database change, applied as `postgres`:**
  `20260918180000_a_renamed_heading_reaches_the_other_rails.sql`. Backup
  `/srv/letscube/backups/db-schema/pre-20260918180000-categories-realtime-20260918T052408Z.sql`,
  1,352,382 bytes, sha256 `9ff7198a…36534a95`, 137 `CREATE TABLE`; the whole
  file rehearsed on production inside a transaction that ended in ROLLBACK, and
  production re-measured unchanged after it. Before → after: published
  `false` → `true`, replica identity `d` → `f`, published tables in `public`
  32 → 33, **filenode 144372 → 144372** (the migration asserts that itself),
  RLS still on, six policies intact, `anon` still unable to read. No Realtime
  restart and no slot work: `realtime.list_changes` rebuilds its `add-tables`
  argument from `pg_publication_tables` on every poll.

  Rollback is `20260918180000_…rollback.sql`, the same two locks and nothing
  else; the only thing it brings back is the silence.

- **`e094d4bd`** — the client half, which closes D-221, and two SDK defaults it
  uncovered (D-223, D-224). Image tag read off the running container; the
  previous replica retired. Verified in the live bundle in both directions: the
  six new sentences and the three seam markers
  (`stopLocalTrackOnUnpublish`, `ParticipantPermissionsChanged`,
  `LocalTrackUnpublished`) are present, a known older string
  («Вы сможете только слушать») is present so the read is working, and a
  fabricated near-miss is absent so `includes` is not trivially true.

  D-223 is the one to read first: the microphone had been published with no
  `source`, so `isMicrophoneEnabled` answered false for everybody and every
  person in every call was drawn permanently muted, while `setVolume` found no
  publication to change and **deafening — shipped the same day — did nothing at
  all.** Neither was reachable by any test here, because the e2e suite replaces
  the whole transport; both were found by reading the installed
  `livekit-client` bundle.

### 2026-09-18 — `a4592b94` (eight deploys, one day)

The owner reported four things on 2026-09-18 and all four are on production.
Read off the running container each time rather than trusted from the webhook.

- **`749a13e5`** — channels («Добавить канал» did nothing in a group with no
  channels, D-212), the phone's duplicate «Папки» tab (D-120), and the invite
  rule that disagreed with the server in both directions (D-165, D-170).
- **`facd7c6e`** — badges: a member row carried LETSCUBE-wide standing in words
  beside the group's own (D-213), «Пользователь» on almost every contact card,
  and two of four standings drawing the same picture at 11px.
- **`0919380c`** — the label on an icon button was clipped to a six-pixel
  sliver (D-216).
- **`1674ddb7`** — the per-group roles migration, applied after a verified
  schema backup and a seventeen-case rehearsal (D-215, server half).
- **`f05cb617`** — per-group roles, the interface: the group's word in the row,
  both sets stacked on the card, the management screen, and an eight-colour
  palette measured at 4.5:1 as text in both themes.
- **`a4592b94`** — the dead CSS bubble removed, and the tooltip's timing put
  back on the motion tokens, which taking it out uncovered.

`letscube-web` runs `l64kyyu1sysev2izzjjbizhe:a4592b94…`, one replica, healthy,
the previous one retired during the rollover (watched: two replicas, then one).

**Verified on the served files, not on the build.** 16 `--kub-role-` tokens in
the served stylesheet; «Роли группы», «Роли группы настраивает владелец» and
«Выдать роль» all present in the served entry chunk, read as utf8 because latin1
hides Cyrillic. One probe came back negative and it was the probe, not the
deploy: `.kub-tooltip` was still in the stylesheet because I had never removed
it — the class had survived its component, which is how somebody later
"fixes" a tooltip by reaching for a class nothing uses. Removed in `a4592b94`.

**Gates at that commit:** typecheck clean, unit **2810/2810**, build proved by
its own `sw.js build` and «built in» lines, e2e **49/49** at 1440 and 390 across
chat-roles, member-badges and icon-tooltip with three stated skips.

**Android 0.1.7 build 8** published the same day, verified four ways: the signer
certificate byte-for-byte the one 0.1.5 and 0.1.6 carry, the Firebase config by
hash, a calibrated probe of the bundled web copy in both directions across all
four chunks, and the published file downloaded and compared byte for byte
(`94f5b999…`, 7 226 429 bytes). Windows needed no release: the Tauri shell
navigates to `https://app.letscube.ru/`, so it took every one of these with no
reinstall.

**The publish nearly went unnoticed as a no-op.** `publish-native-release.sh`
defaults `RELEASE_ROOT` to `/srv/letscube/releases/public`, and from Windows Git
Bash MSYS rewrites that into the Git installation directory: it built the whole
tree locally and printed «Published android stable 0.1.7 build 8» with the
correct size and hash while the live manifest answered 0.1.6 on three fetches.
It has to run on the release host.

### 2026-09-15 — `8d38b17fdba714a279c36f89ad908f8e2cd8d627`

The support and administration forms stop offering what the server refuses
(D-142, D-144, D-139), and the five red media specs are triaged (D-206).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:8d38b17fdba714a279c36f89ad908f8e2cd8d627`, read off
  the running container, healthy. Live entry moved from `index-jzr0-3b9.js` to
  `index-KCUZDAFl.js`, 2,937,662 bytes.
- Marker «Сообщений за 5 минут — от 1 до 200.», calibrated in four directions and
  compared in node rather than in the shell because it is Cyrillic: present in
  the built bundle, absent from the live one beforehand, control present in
  both, a nonsense string in neither.
- Gates: typecheck clean, unit **2714/2714** with 17 mutations red and every file
  restored byte-for-byte, e2e 24/24 at 1440 and 24/24 at 390, `git diff --check`
  clean.

**A third register entry proposed a fix the database refuses.** D-142 said to
gate the invite role picker on «tech admin»; `registration_invite_create` checks
`has_permission(auth.uid(), 'system.manage')`, which also admits a global
administrator granted that key and the legacy `profiles.role` column. After
D-124 and D-202 this is now a pattern rather than an accident: **an entry's
proposed fix is a hypothesis about the server, and has to be measured like one.**

**The defect a person actually hits was not in the entry at all.** D-144's
editor carried `maxLength={4_000}` on all five actions while three of the five
RPCs refuse anything over 1000 — so a 1500-character reason typed to the end,
submitted, and came back refused.

**Twenty-eight frames were captured and looked at rather than filed**, and one
fixed a grammatical fault the code review had passed over: two role names read
as the subject of a singular verb.

**Honesty notes kept rather than dropped:** one mutation stayed green because
the state it restores is unreachable from the interface without an option that
was removed, and it is recorded as such; D-143's five header bars on a phone are
real and unfixed; D-139 has no pixels because no fixture exists for a location
member without admin rights; and `pnpm run format:check` does **not** pass on
HEAD, on roughly twenty untouched files — so biome is not currently a gate and
no report should claim it as one.


### 2026-09-15 — `35a30bdc5023863a87ece5324a0004e6baa69cac`

A received photograph's worker copy reaches the open chat (D-095), and the
attach sheet's magic number becomes the claim it stood in for (D-195).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:35a30bdc5023863a87ece5324a0004e6baa69cac`, read off
  the running container, healthy. Live entry moved from `index-Cn_2zF0d.js` to
  `index-jzr0-3b9.js`, 2,932,262 bytes, control string present.

**This deploy has no content marker, and that is stated rather than dressed
up.** The change is logic, and every identifier it introduces —
`onlyPicturesOutstanding`, `MESSAGE_VARIANT_IMAGE_POLL_INTERVAL_MS`,
`hasVideoMessages` — is mangled by the minifier; checked in the built bundle
before the push rather than assumed. So identity rests on the container's image
tag and reach on the entry filename moving off the one recorded before the push.
That is weaker than a calibrated marker and is the honest description of it.

- Gates: typecheck clean, unit **2661/2661** after a rebuild, `git diff --check`
  clean, `attach-sheet` 24/24 where it had been 22 passed / 2 failed, and the
  new `photo-variant-arrival` 2/2 at both viewports — red when the gate is
  restored, and red again when the pace returns to sixty seconds, the second
  proving the twelve-second bound is real rather than a patient assertion.

**Six media entries were verified rather than trusted, and half were already
fixed.** The register's «fixed on the branch, not deployed» caveats were stale:
the four commits they name are all ancestors of `origin/main`. D-113, D-114 and
D-122 closed as bookkeeping — verified *wired*, not merely present. D-115
(albums) is still real and deliberately not started: a feature, not a defect.
D-116 is partly done and its remaining half, a backfill of forty previews, needs
`letscube-worker` deployed with the D-116 rule — **whether that worker is
deployed was not checked, and is the next thing to check.**

**D-195's arithmetic, finally:** the panel grows +134 while the tab capsule
leaves the flow (−78) for a send capsule that floats and reserves 76px inside
the scroller. Net +57 against a threshold of 60. It went red in `e8af325`, which
*correctly* replaced a fixed 96px reserve with a measured 76px one — those
twenty points are the whole deficit. The product was right and the number was
wrong, which is why the number is gone.

**D-206 filed:** five media e2e specs were already red before any of this,
proved by reverting and re-running to an identical 5 of 18. Three broke in the
same 2026-09-13 wave that broke D-195 — one day's work moved four measured
numbers and nobody re-read the tests calibrated against the old ones.


### 2026-09-15 — `d80c89cb8125c358508a38fe5ba84dad235c7e6e`

The two things the owner reported blocked — creating a group at all, and
creating channels in an existing one — plus the task buttons matching their
RPCs, the last two rows of D-133, and a modal stack so Escape closes one layer
rather than two.

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:d80c89cb8125c358508a38fe5ba84dad235c7e6e`, read off
  the running container, healthy, one replica. Live entry moved from
  `index-Di3dP3Dm.js` to `index-Cn_2zF0d.js`, 2,932,270 bytes.
- Marker «Пропустить и назвать группу», calibrated in four directions and
  compared **in node rather than in the shell**, because it is Cyrillic and the
  encoding of a shell match is one more thing that can be wrong — the lesson of
  the `latin1` probe two deploys ago. Present in the committed source, absent
  from the live bundle beforehand, control present in both, a nonsense string in
  neither.
- Gates: typecheck clean, unit **2661/2661**, `git diff --check` clean, e2e for
  each new surface at 1440 and 390.

**A database change went with it**, applied separately and first:
`20260915160000_a_private_delete_is_not_a_staff_action.sql`, after a verified
schema backup (1,338,630 bytes, sha256
`23c08ecbb3946fcfdb834a3cd650188df8e4a255fc71901dea25e3fe35ebd288`) and its own
rehearsal on production, rolled back. `audit_logs` held 392 rows before and
after.

**Both of the owner's reports turned out to be client-side, and the database was
measured first in each case.** The group-creation probe is worth keeping: it
reported the `chats` insert refused by RLS while every conjunct of that policy's
own WITH CHECK, measured as the same person, was true. A contradiction means the
probe is wrong, and it was — the same insert as a bare statement under
`SET LOCAL ROLE authenticated` succeeds. Believing it would have sent me to
rewrite a policy that was never at fault.

**Still open and waiting on the owner:** the `media` bucket is public and holds
all 771 objects. Flipping it breaks every image in the product the moment it
happens — URLs are persisted in rows as well as built in seven call sites — so
the sequence is client first, then the twenty legacy paths and the avatars, then
the bucket. Recorded in `docs/audit/2026-09-15-storage-audit.md`.


### 2026-09-15 — `86acfb2440a2c39ce65a74db89bfbf2c09e61e1c`

A refused read stops being drawn as an empty account (D-203), three meanings of
«staff» become one on the folders screen (D-202 / F-8), and the reaction refusal
becomes reachable with a rollback behind it (D-204). Carries the service-message
work deployed as database state earlier the same night (D-166).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:86acfb2440a2c39ce65a74db89bfbf2c09e61e1c`, read off
  the running container, healthy, one replica — the previous one is gone. Live
  entry moved from `index-BOJop3WX.js` to `index-Di3dP3Dm.js`, 3,030,214 bytes.
- Marker `chat-list-unavailable`, calibrated in **four** directions: control
  `LETSCUBE` in both bundles, the marker in the shipping one only,
  `zzz-never-shipped` in neither. Round eight read a 144-byte asset, the
  documented mid-rollover state.
- A Cyrillic needle was carried alongside it purely to confirm yesterday's
  lesson — «Не удалось загрузить задачи», compared in `utf8` this time, matched
  correctly where the `latin1` comparison of the previous deploy had answered
  «absent» about a string that was present.
- Gates: typecheck clean, unit **2631/2631**, server **98/98** against a fresh
  `artifacts/api-server/dist`, production build proved by its own output (`sw.js`
  build `4787c40a6c50bb61`), `git diff --check` clean. New e2e:
  `group-service-messages` 6/6 and `chat-list-refusal` 4/4, each at both 1440
  and 390.

**The database half went first and separately**, under
`20260915140000_a_group_says_who_came_and_went.sql`: one transaction, a verified
schema backup beforehand (1,331,541 bytes, sha256
`d23512daa48ac89249a8de87997b717759b680012050376a39d5e15c96d51320`), a rehearsal
on production that measured all eight branches and rolled back, and a self-check
that raises rather than committing a half-applied state.

**Three tests were found agreeing with the defect they were written for**, in
one session. The list work had five mutations come back green — a short source
pattern matching a second occurrence lower in the file, a lazy `[\s\S]*?`
running into the next block and finding the same words there, and a notice left
behind `{false && (` that still satisfied a `data-testid` check. The reaction
rollback mutation stayed green because the chat revalidates itself after 2.5 s
when Realtime never answers, so a patient assertion passes over a missing
rollback entirely. And a loose alternation over two possible sentences passed
whichever the product drew.

**What is deliberately not covered:** the `stale` rendering of a list. Reaching
it needs a second read refused after a first succeeded, and nothing a test can
trigger from the page does that; an `.or(...)` assertion covering both outcomes
was drafted and thrown away rather than banked as evidence.


### 2026-09-15 — `8cb48f203fd6d4efb451da4807db801b8bd43f91`

A member row says who somebody is and opens them (D-168), and two defects caught
in the rendered pixels rather than in the code: the presence dot floating beside
the avatar (D-201) and a row announcing a missing username beside a presence
that already filled the line.

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:8cb48f203fd6d4efb451da4807db801b8bd43f91`, read off
  the running container, healthy, one replica — the previous one is gone. Live
  entry moved from `index-CAQ3ZNvU.js` to `index-BOJop3WX.js`, 3,024,433 bytes.
- Marker `calc(14.645% - 4px)` — the dot's new inset — calibrated in **four**
  directions before the push: control `LETSCUBE` present in both bundles, the
  marker in the shipping one only, and `zzz-never-shipped` in neither. Rounds
  four and five read a 144-byte asset, the documented mid-rollover state.
- Gates: typecheck clean, unit **2562/2562**, e2e **27/27** on
  `chromium-desktop-1440` and **33/33** on `chromium-mobile-390` with the
  did-not-run guard, production build proved by its own output (`sw.js` build
  `926eedacb75001a7`), `git diff --check` clean.

**An ASCII marker was chosen deliberately.** The first calibration asked whether
«Дата входа неизвестна» was in the bundle and got «no» for both files, which
read as «the string was not built». It was built: the probe read the file as
`latin1`, so a needle made of Cyrillic code points could never match. `grep -rl`
found the string in the very file the probe had just declared free of it. The
ASCII needle in the same probe matched correctly, which is what exposed it — one
needle working and one not, in one file. Recorded as a memory; the general rule
it belongs to is «an empty result means unknown».

**The rendered pixels caught what the tests did not.** Both visual defects
passed every assertion as written — the dot because nothing measured its
position, and the copy because the e2e assertion was
`/Без имени пользователя|был|сети/`, an alternation that passes whichever of the
two the product draws. The dot's position was then measured rather than
eyeballed: a first reading of the downscaled capture put it on the *left*, and
measuring the green pixels against the avatar's bounding box gave 14.87px from a
16px-radius centre at 42.3°, which is the lower-right rim.


### 2026-09-15 — `a826465f59e7f274484324d8dc5e00f967924eaa`

Moderation stops being refused to the people who hold it (D-197), and a refused
ban read stops reading as an acquittal (D-198). Android **0.1.5 build 6** cut,
published and verified the same night (D-199).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:a826465f59e7f274484324d8dc5e00f967924eaa`, read off
  the running container, healthy, one replica. Live entry moved from
  `index-mWTUgV58.js` to `index-CAQ3ZNvU.js`, 3,019,624 bytes.
- Marker «read refused» — the string the new refusal path introduces —
  **calibrated in both directions**: absent from the live bundle before the push
  and present in the bundle being shipped; «LETSCUBE» as the control, present in
  both. Rounds four and five read a 144-byte asset with the control also absent,
  which is the documented mid-rollover state and not a failed deploy.
- Gates: typecheck clean, unit **2560/2560**, server **98/98** against a fresh
  `artifacts/api-server/dist`, production build proved by its own output
  (`sw.js` build `6d6df174a40d4a09`) rather than by its exit code.

**The database change was applied separately and first**, under
`.migration-backup/supabase/migrations/20260915120000_sanctions_see_the_whole_role_system.sql`:
one transaction, a verified schema backup taken beforehand (1,328,659 bytes,
sha256 `69e209c45270acc1d84118544b86bd51e5d123bf445644c664bcdefada19ce74`, with
the completion marker present), a rehearsal on production that reproduced the
defect, applied the fix and rolled back, and a self-check that raises rather
than committing a half-applied state.

**Android 0.1.5 build 6.** Published to the stable catalogue and read back from
outside: the downloaded artifact is byte-identical to the signed build,
7,220,933 bytes, sha256
`4723feb19fe5a34bcbff2d45c8489b2299259ce29812a19217960b55794c6f44`. Before
publishing it was measured against the published 0.1.4 downloaded from the same
catalogue and hash-checked against its manifest: the **signer certificate
matches** (SHA-256 `ac8249647e3e32b32e7dba283c6c7bc835f293401a3cf82115901ce74f4a0839`
on both), so the update installs rather than being refused as a different app;
the four Firebase string resources are present and hash-equal, so push survives;
and a probe calibrated in both directions found this tree's commit and today's
features in the new bundle only. The AAB gradle also produced is deliberately
unpublished — store submission is not tasked.

**Windows and the PWA needed no release, and that was measured rather than
assumed.** The Tauri shell loads `https://app.letscube.ru/`
(`windows-tauri/src-tauri/src/lib.rs:31`), so an installed client already
carries every web change; the only commits under `windows-tauri/` since the
0.2.14 cut are QA-only. Cutting a version there would push an update carrying
nothing to everyone who installed it. The PWA revalidates `sw.js` on every start
(`no-cache, no-store, must-revalidate`) and applies through `KUB_SKIP_WAITING`.

**Three deploys before this one are not recorded here.** `ca04e21`, `bf0a769`
and the commits between them reached production on 2026-09-13 and 2026-09-14;
the rolling «Current:» line that held `ca04e21` was removed by a later edit and
nothing replaced it, so the baseline section skips from `2b1a11e` to this entry.
Recorded as a gap rather than back-filled from memory.


### 2026-09-14 — `2b1a11e75ca66c6a042fd4e9c8698b9eb79e6f13`

Shared media becomes a place in a sequence, and a failed page stops looking like
the end of the list (D-171).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:2b1a11e75ca66c6a042fd4e9c8698b9eb79e6f13`, one
  replica. Live entry `index-mWTUgV58.js`, 3018945 bytes.
- Marker «Сентябрь» — the capitalised month, which only the new grouping module
  holds — absent from the live bundle and present in the committed source;
  «Проверить микрофон» as the control, present in both because it shipped an
  hour earlier. Rounds four and five read a 146-byte asset with the control
  also absent, the seventh time today.
- Gates: typecheck clean, unit **2534/2534** with no re-run needed,
  `shared-media-browsing.spec.ts` 14/14 at both 1440 and 390, adjacent
  `media-viewer-zoom` and `channel-card` 20/20.

**This commit also repaired `main`.** `ed04007` had committed 128 lines of this
work's in-flight `tests/unit/profile-window.test.mts` — a misattribution made
while sorting three agents' files by reading a grep count of `bot|media|viewer`
as though it had counted only `bot`. Between `ed04007` and `2b1a11e` the unit
suite was **red at HEAD**: the test asserted `tailShown` three times against a
`ChatInfoPanel.tsx` that had none. Production was never affected, because the
deploy does not run the suite — but anybody checking out `main` in that window
would have found it broken, and nothing would have told them why.

*The rule that failed is one already written down: an empty result means
unknown. A grep that printed nothing was read as confirmation of the opposite
of what it was asked.*


### 2026-09-14 — `7a9f9da40651641619408873751ad5f3d0c65773`

The bot surfaces, the sound settings and the switch that drew a black box
(D-125, D-126, D-127, D-137), on top of the two server doors a person needs
into a bot.

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:7a9f9da40651641619408873751ad5f3d0c65773`, one
  replica. Live entry `index-Dmou5OAt.js`, 3009628 bytes.
- **The marker was calibrated against the committed source, not the local
  build**, and that mattered this time: a third agent's work was still
  uncommitted in the tree, so the local `dist` held code the deploy would not.
  Coolify builds the pushed commit; the marker has to come from the same place.
  «Проверить микрофон» absent from the live bundle and present in the committed
  source, «Убрать шум» as the control, present in both.
- **No removal marker, and none was invented.** «Проверка микрофона» survives
  inside an error sentence — «…не поддерживается этим браузером» — so it stays
  in the bundle and cannot prove a removal.
- Rounds four and five read a 146-byte asset where the control was also absent:
  the sixth time today that string separated «I cannot see» from «not
  deployed».
- Gates: typecheck clean, unit **2532/2533** with the one failure re-run alone
  and green (`android-release-signing` times out at 25s under full-suite load —
  11/11 by itself, verified rather than taken on the agent's word), production
  build proved by `public-product-assets` accepting the `dist`,
  `bot-chat-surfaces` + `audio-settings-vocabulary` **40 passed** across 1440
  and 390.
- Those e2e runs used a **fresh** dev server. Both long-running fixture servers
  were serving `app.store.ts?t=` after hot updates, which this file records as
  breaking any spec that imports the store by URL.
- Rollback is a fast-forward of `main` back to `fd3b9e5`, plus
  `20260914150000_bot_press_and_bot_chat.rollback.sql` if the two wrappers have
  to go too — it says plainly that removing them makes every inline keyboard a
  question nobody can answer again.


### 2026-09-14 — `df11bbe9a4ce2530642172f1ca8460f2c3b12a26`

The handle between the panes stops being a black strip and stops dragging 73px
behind the pointer (D-196), and Escape stops being spent on a hint nobody
opened (D-194, deployed as `78c7fd1` an hour earlier).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:df11bbe9a4ce2530642172f1ca8460f2c3b12a26`, one
  replica. Live entry `index-CVfDE49D.js`, 3001177 bytes.
- **The marker was calibrated in all three directions this time**: the new
  handle's class list absent from the live bundle and present in the built one,
  the retired flex column present in the live bundle and **absent** from the
  built one, and «Ширина списка чатов» present in both as the control. Rounds
  four and five again read a 146-byte asset where the control was also absent —
  the fifth time today that string was the only thing separating «I cannot see»
  from «not deployed».
- Gates: typecheck clean, unit **2460/2460**, `desktop-shell.spec.ts` 34 passed
  with 2 skipped across 1440 and 1920, `shell-escape.spec.ts` 4/4 across 1440
  and 390, `chat-list-event-cost.spec.ts` 8 passed with 1 skipped at 390 — two
  of those were red before D-194.
- Rollback is a fast-forward of `main` back to `9cc2f50`.

**Two register entries opened rather than fixed**, both measured: D-195 (two
tests of `attach-sheet.spec.ts` red at both viewports, pre-existing — three
picks grow the sheet to 374 where the test wants more than 377, so «still closes
by its handle and its dim» has not been checked since) and the note in D-196
that its own test had agreed with the defect for as long as the defect existed.


### 2026-09-14 — `5b9dbfe9efef548989cc22a349949f111b0a1740`

Muting a chat becomes a fact of the account, with durations (D-167), and D-194
is recorded rather than guessed at.

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:5b9dbfe9efef548989cc22a349949f111b0a1740`, one
  replica after the rollover. Live entry `index-DHhDW6NP.js`, 3001025 bytes.
- Marker «На 8 часов» absent from the live bundle and present in the built one;
  «Отключить уведомления» as the control, present in both. Rounds four and five
  again read a 146-byte asset where the control was also absent.
- Gates: typecheck clean across all four packages, unit **2460/2460**,
  `chat-mute.spec.ts` 14/14 across 1440 and 390, production build proved by its
  own lines.
- The database was not touched: `chat_notification_preferences` was already
  there with its policies, and `_notification_push_allowed` already honoured
  both `push_enabled` and `muted_until`. The whole change is client-side.
- Rollback is a fast-forward of `main` back to `8b2f120`.


### 2026-09-14 — `5f84709ec6ccbedf7d86e47c944f00df3b7a6b69`

A failed read of the rooms stops taking the rail away and hanging up a live
call (D-193), found in the interface audit hours after the rail shipped.

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:5f84709ec6ccbedf7d86e47c944f00df3b7a6b69`, one
  replica after the rollover.
- Marker «Не удалось загрузить каналы.» absent from the live bundle and present
  in the built one; «Каналы видят все участники группы» as the control.
  Afterwards `index-Dd9LBD4G.js`, 2992440 bytes, both present. Rounds four and
  five read a 146-byte asset where the control was also absent, which is again
  what told an empty answer from a real one.
- Gates: typecheck clean, unit **2430/2430**, `server-channel-rail` and
  `voice-call` 50 passed with 18 skipped by width across 1440 and 390, and the
  new surfaces green at the viewports nobody had checked — 51 passed across 360,
  412 and 1920, and `server-channels-admin` 12/12 on `webkit-mobile-390`.
- Rollback is a fast-forward of `main` back to `1e26453`.


### 2026-09-14 — `1e26453edc57ccf22b0d2c21c9b860c4980f72da`

A group is a server: a rail of rooms beside the conversation, «Каналы» on the
settings screen, and the one-room mechanic retired rather than left beside it
(D-191, D-192).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:1e26453edc57ccf22b0d2c21c9b860c4980f72da`, read off
  the running container; one replica after the rollover.
- **The marker was calibrated in both directions with one string each way**, and
  the second is the better one. «Каналы видят все участники группы» was absent
  from the live bundle and present in the built one — an addition. «Начать
  голосовой чат» was present in the live bundle and **absent** from the built
  one — a removal, which is the half a marker usually cannot prove.
- **And the control string earned its keep.** Rounds three to five of the check
  read a 146-byte asset, where the removal marker said `retired_gone=True` — a
  true answer from a file that contains nothing at all. The control «Голосовой
  чат» read false in exactly those rounds, which is the only thing that told an
  empty answer from a real one. A removal marker without a control is a marker
  that reports success mid-rollover.
- Round six: `index-O7m58HS7.js`, 2991622 bytes, addition present, removal gone,
  control present.
- Gates: typecheck clean, unit suite **2428/2428**, production build proved by
  its own lines, and every touched e2e spec green — `server-channel-rail` 13
  passed with 17 skipped by width, `server-channels-admin` 24/24,
  `blocks-and-reports` 18/18, `voice-call` 18/18 after six tests of the retired
  mechanic were replaced by three that assert it is gone.
- Rollback is a fast-forward of `main` back to `88e1802`, plus
  `20260914140000_channel_categories.rollback.sql` if the schema has to go too.


### 2026-09-14 — `1ed4aa7aacc83358f2eb0a60e233dab2b3420d2b`

Channel headings in the schema, and «Блокировки» narrowed to the rule that
actually reads it (D-188, D-191).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:1ed4aa7aacc83358f2eb0a60e233dab2b3420d2b`, read off
  the running container; one replica after the rollover.
- **No string marker was available and none was invented.** The change adds no
  user-visible text: the gate is structural, and `lib/serverChannels.ts` is
  tree-shaken out because nothing imports it yet — measured, zero occurrences
  in the built bundle. The evidence is the image tag plus the entry chunk
  moving from `index-C3vWA54p.js` to `index-DbsyNKkT.js` and settling there.
- **And the entry filename cannot be predicted from a local build.** The local
  build of the same commit produced `index-D9Oj_45R.js`, the server's produced
  `index-DbsyNKkT.js`. The service-worker plugin stamps a fresh build id into
  the graph every run — three local builds of one tree gave `fdc43de6…`,
  `f4e2e990…`, `90067c39…` — so the hash proves the bundle **changed** and can
  never prove it is a particular one. Rounds three and four of the check also
  disagreed with each other while both replicas were up, which is the ordinary
  rollover flap.
- Gates: typecheck clean, unit suite **2361/2361**, production build proved by
  its own `sw.js build` and `built in` lines.
- Rollback is a fast-forward of `main` back to `e571438`, plus
  `20260914140000_channel_categories.rollback.sql` if the schema has to go too.

### 2026-09-14 — `8a929308b10abdc7de975e1f6bfba7a2e1bccb99`

Personal blocking and content reporting reach the interface, the staff queue
«Жалобы» is mounted behind the database's own rule, and two defects found on the
way out are fixed (D-189 in the schema, D-190 in the composer).

- `letscube-web` runs image
  `l64kyyu1sysev2izzjjbizhe:8a929308b10abdc7de975e1f6bfba7a2e1bccb99` — the
  commit's full SHA, read off the running container rather than trusted from
  the webhook. One replica; the previous one was retired during the rollover.
- **Marker calibrated in both directions before the push**: «Пользователь
  ограничил переписку.» present in the bundle being shipped and absent from the
  live one, with «Сообщение» as the control that proves the probe can find
  Cyrillic in that file. After the rollover the live entry carries the marker
  and the control, 2955068 bytes.
- The first two rounds of that check returned a 146-byte asset with neither the
  marker nor the control — «I cannot see», not «not deployed». Keeping a
  control string is what tells those apart, and taking the asset URL from the
  page on every round is what keeps the probe pointed at the right file.
- Gates at that commit: typecheck clean, unit suite 2345/2345, production build
  proved by its own `sw.js build` and `built in` lines,
  `blocks-and-reports.spec.ts` 9/9 on `chromium-desktop-1440` and
  `chromium-mobile-390`, `channel-card.spec.ts` 12/12 after repairing an
  expectation that had been red since `fd9255c`.
- Production afterwards: `/`, `/privacy`, `/support`, `/download` all 200;
  `content_reports` and `user_blocks` both still empty, so nothing this wave
  wrote anything.
- Rollback is a fast-forward of `main` back to `5fc15dc`, plus
  `20260914130000_a_reported_message_may_be_deleted.rollback.sql` and
  `20260914120000_personal_blocks_and_reports.rollback.sql` in that order if
  the schema has to go too. Both refuse rather than discarding silently.

### Earlier

**`b0a407a`, deployed 2026-09-14.** Ten register entries closed, four of them
found by looking rather than by a scan, plus two things that were believed
deployed and were not.

- `letscube-web` runs `l64kyyu1sysev2izzjjbizhe:b0a407ad37947642d8851b360accc737764d2e4d`
  — read off the running container — healthy; `https://app.letscube.ru` answers
  200.
- **Marker calibrated both ways**: «Передать права владельца» is 1 in the bundle
  built here and 0 in what production served before the push, «Покинуть группу»
  is 1 in both as the control. The served file went `index-Ceyera6g.js` →
  `index-b_6mrD7o.js`; two mid-rollover reads returned 144 bytes.
- Gates: kub typecheck clean, unit **2282/2282**, and every e2e spec touched
  green — `bot-management` 34/34, `member-actions-reachable` 12/12,
  `plain-failure-messages` 10/10, `round-video-stacking` + `media-original-claim`
  42/42 across all seven projects including `webkit-mobile-390`.

### Closed

| | |
| --- | --- |
| D-097 | «Открыть оригинал» claimed what it could not deliver |
| D-129 | a round video painted over the header, the pinned bar and the composer |
| D-132 | errors named migrations, functions and build files on screen |
| D-133 | eleven far-reaching administration actions ran on one press (bots and administration halves) |
| D-145 | bot settings saved silently, and the list ignored the bot's picture |
| D-150 | a group's owner could not leave, only delete for everyone |
| D-183 | voice called one thing by two names |
| D-184 | every destructive dialog painted a red glyph on the accent colour |
| D-185 | the deployed push function was seven weeks old, with no Windows sender |
| D-186 | a confirmation swallowed the presses meant for what was behind it |

### Three findings worth more than the fixes

**A fix in a commit is not a fix in a database.** Six migrations of 2026-09-11
sat unapplied for three days while the register called them fixed, among them
the one that stopped every signed-in account reading every chat's reactions
(D-104). Found by reading the live policies by hand; `scripts/migration-inventory.*`
now asks the question, and `docs/operations/deployment-inventory.md` records
what it cannot answer.

**The same question, asked of the Edge Functions,** found the push function
dated 2026-07-14 against the repository's 2026-08-31 and missing `wns.ts`
entirely (D-185). `scripts/function-inventory.mjs` asks it now; as of today all
22 files match with nothing extra on either side.

**A justification for not doing something is never re-checked.** A pass declined
a live никнейм lookup on the grounds that `profiles` hides a banned account's
row from everybody. That policy restricts what a *banned caller* reads, not what
anybody reads about a banned account — so the lookup was possible all along, and
the field now answers while the name is typed. The wrong reading is kept beside
the right one in D-132.

### The previous baseline

**`67454a6`, deployed 2026-09-14.** Voice is a feature people can switch on, and
three administration defects are closed.

- `letscube-web` runs `l64kyyu1sysev2izzjjbizhe:67454a668fb59ff12b98c3ef02cce1e14895ae08`
  — the full SHA read off the running container — healthy;
  `https://app.letscube.ru` answers 200.
- **Marker calibrated both ways**: «Начать голосовой чат» is 1 in the bundle
  built here and was 0 in what production served before the push, with
  «Присоединиться» as the control at 1 both times. The served file went from
  `index-mSZR-sOQ.js` to `index-Ceyera6g.js`; two mid-rollover reads returned
  144 bytes and the watch kept going.
- `letscube-worker` is not redeployed by this push and did not need to be: its
  `LIVEKIT_*` live in `/srv/letscube/secrets/letscube-infra.env`, which survives
  a deploy.

### Voice, end to end and in people's hands

An owner or administrator of a group presses «Начать голосовой чат» in
«Информация о группе»; everybody in the group then sees the capsule under the
chat header and can join; the administrator can end it, which asks first and
disconnects the people in it. No SQL, no migration — the policy
`admins manage voice channels` already allowed exactly this and nobody else.

**The reconciler runs.** It was the last piece not wired, and the four names
went into the secrets file the worker's entrypoint sources, not Coolify's
environment UI — which holds *nothing at all* for that application, a fact worth
recording because looking there first finds no list to add to. Proved rather
than assumed: a `voice_participants` row was written for a channel the SFU has
no room for, and the next pass removed it 30 seconds later, logging
`reconciled: 1, unknown: 0, reaped: 0`.

While adding them, one pre-existing defect in that file: it is sourced by `sh`
and one value carried a space with no quotes, so its second word ran as a
command — the worker printed «/run/secrets/letscube-infra.env: Support: not
found» on every start and that variable had been truncated to its first word
ever since. Every unquoted value carrying a space is now quoted.

### Found by looking at the rendered pixels

- **D-183**: voice called one thing by two names — «ГОЛОСОВОЙ КАНАЛ» over
  «Начать голосовой чат», and five gateway refusals saying «канал» beside eleven
  saying «чат». One word now, Telegram's, because the shipped mechanic is
  Telegram's. «Завершить голосовой чат» also wore the «×» every dismissable
  thing wears; it wears a hang-up glyph.
- **D-184**: `KubModal`'s header badge painted `--kub-cyan` whatever it held, so
  every destructive dialog in the product showed a red glyph on the accent
  colour. The modal takes `tone` now and five dialogs pass it, `AppDialogs`
  among them, so every `requestAppConfirm` follows.
- **D-134** (high, data loss): «Снять блокировку» deleted every `bans` row for
  the person, expired history included, on one press with nothing asked. Two
  questions the register left open were answered against production rather than
  reasoned about: the audit triggers do keep a trace, and «Снять» in
  «Блокировки» never had the defect.
- **D-140**: a refused read in «Блокировки» rendered «Активных банов нет».
- **D-141**: the users search invited «@никнейм» and the «@» matched nobody.
- **D-146**: «Базовая роль» printed the legacy field eighteen lines above the
  global roles of the same person.

Gates at this commit: kub typecheck clean, unit 2203/2203, `voice-call.spec.ts`
145 passed / 9 skipped / 0 failed across seven projects, production build proved
by its own `sw.js build 52e6930d4c180f7c` and `built in 14.93s` lines.

### The previous baseline

**`7260ee8`, deployed 2026-09-14**, the fourth deploy of this run: voice slice 2.

**Nothing in it is visible yet, deliberately.** A voice channel is a row in
`public.voice_channels`, no row exists, and nothing in this interface creates
one -- so the capsule and the panel row have nothing to show, and the reconciler
sleeps without `LIVEKIT_*`. The code is reviewed, built and deployed before the
SFU it needs exists, which is the opposite of putting a stub in front of people.

- `letscube-web` runs `l64kyyu1sysev2izzjjbizhe:7260ee8002796115d72a4e8c8faaed46781d854b`
  -- the full SHA read off the running container, not trusted from the webhook --
  healthy; `https://app.letscube.ru` answers 200.
- **Marker calibrated both ways**: «не умеет записывать звук» is in the bundle
  built here (1) and was absent from what production served before the push (0),
  with «Голосовое» as the control at 5 both times. The served file went from
  `index-ss_27b8S.js` to `index-mSZR-sOQ.js`. Two mid-rollover reads returned a
  144-byte asset -- "I cannot see", not "not deployed" -- and the watch kept
  going rather than concluding.
- The SDK is its own chunk: `livekit-client.esm-DijAR4tD.js`, 561.21 kB /
  147.71 kB gzip, served 200 and reached only by a dynamic import. Proved both
  ways -- three SDK strings present in that chunk and absent from the entry, and
  a fourth marker absent from both as the calibration.
- `letscube-worker` and `letscube-bot-gateway` are not redeployed by this push;
  `artifacts/api-server` did move, so the worker will pick the reconciler up on
  its next deploy, where it will log that `LIVEKIT_*` is missing and sleep.
- **`letscube-voice-probe` runs beside them**, restored to its slice 1
  configuration after the webhook capture: no webhook block, no ufw rule.

### What slice 2 measured against the real SFU

Five things the gateway had been written to believe, checked on the probe rather
than read about, and the two that were wrong:

1. **The webhook `Authorization` header carries the token alone, with no
   `Bearer`.** The route used a Bearer-only reader, so every real delivery would
   have been refused 401 -- a deployed gateway and a silent SFU, with nothing in
   a log to say which. The unit tests missed it because they were written from
   the same assumption; they now send the measured form, and restoring the old
   reader turns eight of them red.
2. **`public.profiles` has no `display_name`.** The gateway asked for it and its
   own cosmetic fallback swallowed the error, so every caller would have joined
   nameless. The test stub had invented the column too.
3. `sha256` is standard base64, the body is camelCase with unpopulated fields
   omitted, `participant.joinedAt` is a decimal string present on the leave as
   well as the join, and four of the six events one call produces are ones to
   ignore before touching the idempotency table.
4. **`maxParticipants` is enforced by the SFU**: a room capped at two took two
   publishers and refused the third.
5. LiveKit 1.8.4 answers `{"participants":[]}` for an empty room; the reconciler
   comment claiming proto3 omits the field was wrong, though its handling was
   right.

`docs/operations/voice-probe.md` carries the table and the four environmental
traps that cost an hour before the first webhook arrived.

### The previous baseline

**`e6006f5`, deployed 2026-09-13**, the third deploy of the day. The badge
reaches the member list and the profile dialog; signing out and leaving settings
with something typed both ask first; and a dialog no longer dismisses itself on
the key press that opened it.

- `letscube-web` runs `l64kyyu1sysev2izzjjbizhe:e6006f53271d0501e48ead28494252cb6dc590e2`,
  one replica, healthy; `https://app.letscube.ru` answers 200.
- **Marker calibrated both ways**: `chat-info-member-badges` is in the bundle
  built here and absent from what production served before the push;
  `profile-badges` is the control. The served file went from `index-Dtg6_FHL.js`
  to `index-ss_27b8S.js`. One mid-rollover read showed the control at 0 as well,
  which is the rollover state.
- `letscube-worker` and `letscube-bot-gateway` unchanged, correctly: nothing
  under `artifacts/api-server` moved.
- **`letscube-voice-probe` runs beside them**, 0.28 % CPU and 36 MiB at rest. It
  is slice 1's SFU and no part of the product can reach it;
  `docs/operations/voice-probe.md` has the two commands that remove it.

Three defects were found while building these and are recorded rather than
carried: D-181 (Escape opened a dialog and the same press closed it, in every
dialog in the product), D-182 (a keystroke in the list search replaced the
settings panel and discarded a typed name), and the member row that read
«Владелец [♛ Владелец]» — this chat's owner beside LETSCUBE's, one word meaning
two things a line apart.

Rollback is a fast-forward of `main` back to `4ac06e3`.

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
- `[x]` `20260914120000_personal_blocks_and_reports.sql` (`2b80a6b`). Personal blocking and content/user reporting, the database half of D-187: `public.user_blocks` one-directional and invisible to the person blocked, a SECURITY DEFINER guard `blocked_from_chat` behind a RESTRICTIVE INSERT policy on `public.messages` scoped to private chats, and `public.content_reports` writable by anybody and readable only by `is_manager_or_admin`. Thirteen rehearsal rules on a throwaway copy — a fourteenth added by the repair below — and four on production, each measured as `authenticated` with real claims inside a rolled-back transaction — a policy measured as its own table's owner is not measured at all. Four defects were caught before it reached production, the first of which is a property of this deployment rather than of the migration: `pg_default_acl` grants `anon` and `authenticated` `arwd` on every new table in `public`, so both tables `revoke all … from anon, authenticated` before granting. Backup `/srv/letscube/backups/pre-migrations/20260914-030745-before-blocks-and-reports.schema.dump`.
- `[x]` `20260914130000_a_reported_message_may_be_deleted.sql`, applied the same day, repairing the one above. `content_reports_message_id_fkey` is ON DELETE SET NULL while `content_reports_message_present` required `(kind = 'message') = (message_id IS NOT NULL)`: a referential action is a write, and the UPDATE it performs re-checks every CHECK, so deleting a reported message was refused — and with `messages_chat_id_fkey` ON DELETE CASCADE that meant an ordinary owner could no longer delete a group holding one. Measured on production in a rolled-back transaction on a temporary pair carrying the two definitions verbatim, then proved on the real table in four rules after the fix: the message id may be cleared, a report about a person still may not carry one, and deleting the reported message leaves the complaint standing. The CHECK is now one-directional, `check (kind = 'message' or message_id is null)`; SET NULL is kept deliberately, because «somebody complained and the message is gone» is the case staff most need to see. Backup `/srv/letscube/backups/pre-migrations/20260914-034240-before-reported-message-may-be-deleted.schema.dump`, 1318216 bytes, sha256 `9c7b8377…cc28f9cc`; migration sha256 `067d0edb…`; rollback beside it, and it refuses to run while any report names a message that has since gone. D-189.
- `[x]` `20260914140000_channel_categories.sql`, applied to production the same day. Headings for a group's channels, so a group can be shaped like a server: `public.chat_channel_categories` plus a `category_id` on `topics` and on `voice_channels`. **Run as `supabase_admin`, not as `postgres`** — `voice_channels` is owned by `supabase_admin` while `topics`, `chats` and `messages` are owned by `postgres`, the first attempt died on «must be owner of table voice_channels» and rolled the whole transaction back, and `postgres` cannot `set role supabase_admin` here (`pg_has_role` answers false). The new table's owner is set back to `postgres` at the end so it matches its siblings, and the self-check refuses any other owner. The category is scoped to its chat by a composite foreign key on `(chat_id, category_id)` rather than by a trigger, and the delete action names its column — `on delete set null (category_id)` — because a bare `set null` would try to null the NOT NULL `chat_id` and fail the delete, which is D-189 six hours later. Seven rules proved on production in a rolled-back transaction, kept as the rehearsal file beside the migration. Backup `/srv/letscube/backups/pre-migrations/20260914-043011-before-channel-categories.schema.dump`, 1318213 bytes, sha256 `bec5ea79…5ed3c77`. D-191.
- `[x]` Read-only audit after the day's three migrations, 2026-09-14: RLS on **66/66** tables in `public` and none without it; no RLS-off table reachable by `anon` or `authenticated`; all 47 "block banned" policies RESTRICTIVE; no view readable without `security_invoker`. The three tables added today grant `authenticated` only row-filtered privileges and grant `anon` nothing at all — `chat_channel_categories` SELECT/INSERT/UPDATE/DELETE, `user_blocks` SELECT/INSERT/DELETE, `content_reports` SELECT/INSERT plus the column-level UPDATE on `(status, handled_by, handled_at)`. Policy counts: categories 2 permissive + 4 restrictive, reports 3 + 1, blocks 1 + 1. Row counts afterwards confirm every probe of the day rolled back — 0 categories, 0 blocks, 0 reports, 1 voice channel, 11 topics, 3358 messages.
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
