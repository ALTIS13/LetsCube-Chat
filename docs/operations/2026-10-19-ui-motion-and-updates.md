# UI Motion And Update Experience

Owner: Codex coordinator; branch `codex/ui-motion-updates-20261019`, base
`9f6c7afe`. The owner requests smoother navigation/message scrolling, an
understandable PWA/Android update flow and signed-in access to changelog.
Preserve the incumbent liquid-glass design and existing account/scroll/call
contracts. Standing implementation/release authority applies; SQL is not needed.

## Work And Acceptance

- [x] Coordinator: reproduce motion/scroll cost, repair demonstrated causes;
  preserve entry/unread/older-page anchors, reader takeover and reduced motion.
- [x] Pascal: replace Android's external-browser APK handoff with native
  download/progress/verified-ready/explicit system installation. Persist state,
  constrain URL/path/size/hash/package/version/signer and handle permission/retry.
- [x] Nash: expose PWA ready/applying/retry state and settings check/apply access,
  preserving quiet-restart, draft/outbox/call and Windows-caption safeguards.
- [x] Linnaeus: reachable signed-in changelog using actual catalog release data,
  with search/navigation/back behavior and no public-route logout or lost chat.
- [ ] Coordinator: independent scoped reviews, affected tests, frozen browser
  matrix at390/1440 in both themes, actual Realme update-flow acceptance,
  original signed next-version artifact and guarded publication/live checks.

Workers have disjoint write scopes; MainLayout/App/global CSS/motion and final
cross-stream bindings belong to the coordinator. No broad suite replays, personal
captures, production test messages, A063 access or unrelated cache cleanup.
All browser fixtures use loopback-only fake Supabase and QA mutations disabled.
Browser plugin/skill is absent from the current catalog; installed repository
Playwright supplies synthetic Chromium/WebKit validation. No extra browser or
design-tool subscription/rental is needed for the initial bounded measurements.

## Observations

Android `ReleaseDistributionSection` currently renders an ordinary external
artifact anchor and clears its handoff message after2500ms. It does not know
when a download finishes and cannot offer installation. A UI-only success label
would be false; native completion and verified-file ownership are required.

The existing public changelog is mounted only on public home/download pages,
not on the signed-in settings path. Reuse its actual catalog, not invented
release entries. Message fluidity investigation is still measuring; no claim of
root cause or device FPS is made from source inspection alone.

Private bounded measurements: `.ops-private/ui-motion-20261019/`.

## Initial Source Acceptance

PWA focused55 and real waiting-worker/new-document receipt checks pass. Changelog
focused39 and four synthetic width/theme pixels pass. Both are integrated into
the actual Settings screen; the subsequent combined screen/browser checks are
in progress. The existing `settings-prompts:102` source-regex failure also rejects
the unchanged baseline handler; it is retained, not suppressed or claimed green.

Actual prepend/momentum regression: twelve scroll steps made zero progress on
the shipped code. Initial repair passes helper8 and affected Chromium/WebKit8;
independent review found one remaining commit-before-scroll ownership race,
which is being repaired. Opacity-only pane arrival preserves the mounted tree,
overlay coordinate system and immediately usable controls; reduced-motion and
arrival checks pass4. This is not a claim of physical-device FPS improvement.

Independent changelog review also found an inherited unbounded JSON-body read
after the release-catalog header timeout. Its finite-body repair and the updated
Settings/PWA integration fixture are in progress. Android source passes19 focused
checks and native API compilation, but install/call/draft safeguards and quiet
foreground catalog discovery are being completed before the final source freeze.
No signing, publication or production SQL effects have occurred yet.

## Combined Acceptance And Limits

Final first-prepend correction records in-flight reader intent independently of
the settling hold, folds pending motion into the initial anchor before band
compensation and retains that adjusted anchor on later commits.24 helper/actual-
callback checks (seven literal mutants), new first-prepend4 and active-hold4
Chromium/WebKit cases pass. One existing WebKit growth test in the combined run
stopped at100 rows before its drift assertion:9/10, then a separate1/1 recheck on
unchanged source. Its original output directory was accidentally reused and the
raw failure artifact lost; the summary is retained, not represented as10/10 or
as a proven fixture/product cause. Broader long-session acceptance remains open.

Full actual messenger fixtures prove signed-in changelog/update controls at390/
1440 in both themes/engines:8/8. Update notice placement, header/composer reach,
action and throttle:14/14. Original new-fixture failures were an incorrect
`settings-open-updates` locator; the real existing disclosure id is `application`.
No product source was weakened to satisfy the fixture.

Native compact status is fixed below chrome, not in the shell's flex flow, so
checking/downloading/ready cannot resize the message viewport. Final actual
messenger geometry/hit-tests pass8/8 in both engines/themes/widths; exact pixels
viewed. The progress bar reuses the existing theme-token/transform pattern rather
than WebKit's unstyled native green track; literal42% and its loaded scale mutant
pass2. Settings keeps expanded details and44px install/permission actions.

Native UI/source acceptance28 includes reload holds/rings, exact call identity
after async guarded Settings close, cancelled intent, no-download foreground/
five-minute discovery and persistent observation. Original native policy7 and
API compilation remain valid. The new PWA call-identity repair passes31 focused
checks, including the actual waiting-worker/new-entry/consumed-success flow;
unchanged33 adjacent checks are reused. Old boolean confirmation cannot authorize
a different/recreated call after Settings close or at the late reload edge.

The final full kub typecheck and actual Vite build pass; local synthetic build
`2eb0404bab81a8b6`,7496 transformed modules,13.53s. Known sourcemap/mixed-import/
large-chunk warnings remain, not new build failures. Mechanical Impeccable detect
on the five changed UI consumers reports `[]`; existing liquid-glass tokens are
preserved. No dependency or service configuration change.

A bounded Realme Chrome gesture probe refused before opening a tab because this
device has no Chrome package (its existing browser is Yandex). No browser or
global setting was installed/changed. Exact owned reverse port was removed;
existing mobilecli forward preserved; phone returned HOME. This is not physical
scroll evidence. Android32 guest upgrade and native artifact verification remain
the release gates. Positive in-app32 -> next33 installation is intentionally a
natural-next-release criterion: installed31 does not contain the new plugin.
No same-version/downgrade exception or synthetic installed-success is introduced.

Native deadline review is repaired: one connection owns a20s catalog or15min
download budget from before headers through the final body read, with abort,
late-completion and owner-safe cleanup.16 actual compiled Java/probe/loaded-mutant
checks pass using cached Android36 without global SDK/PATH changes; the uncalibrated
production budget literals are checked independently. Native API compilation passes.
The new request helper must also be present in the final APK's class definitions.
This is controlled Java transport evidence, not a hostile-network device claim.

Independent final source reviews are clean for first-prepend intent, native UI
guard/discovery and catalog deadlines; the coordinator reviewed the final exact-
snapshot PWA guard and native request lifecycle. Android metadata is now0.1.31/32;
build/device/publication remain separate next gates, not source acceptance claims.
