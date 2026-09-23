# Interface visual pass, 2026-09-23

Owner: Codex. Stage: local UI repair and synthetic browser verification. Source:
`D:\CodexProjects\LetsCube-Chat` at `15b8fbb7` plus the working-tree patch.
Blocker: no production or physical-device proof for this patch. Next: broader
screen inventory, then the separately gated native/device matrix.

## Scope and results

- Reviewed public landing/download/Bot API/support, support operator UI, chat
  sidebar with a running call, and session-device settings at 1440px and 390px
  in light and dark themes. Visual inspection used local Playwright captures
  and synthetic fixtures only, never production accounts or support tickets.
- D-222 follow-up: unknown device title wraps at a forced 260px settings width.
  The existing regression was red before the fix; 26 session-device cases passed
  afterward, with two desktop-only checks intentionally skipped on mobile.
- D-272: at a 66px folded chat list the call exit no longer crosses the column
  or overlaps the return-to-call control. A real running-call fixture checks
  geometry and clicks exit in both themes. This does not alter call transport.
- D-299 to D-303: public support is reachable on a phone, Bot API contents
  links have 44px targets, the opened guest chat keeps its send button in the
  first 390x844 viewport, and admin support text/filters fit narrow layouts.
  Before/after browser assertions were red before the relevant fixes and green
  afterward. The support-filter change specifically covers a narrow
  fine-pointer window; coarse-pointer phones already had a shared 44px rule.
- D-157 continuation: both overflowing horizontal rows now mask text before
  their translucent scroll arrows, and the arrows have a visible keyboard
  focus outline. Real search and six-folder fixtures were captured and
  inspected; WebKit mobile also rendered the repaired folder strip.

## Validation

- `pnpm.cmd --filter @workspace/kub run typecheck`: exit 0.
- Fixture-env `pnpm.cmd --filter @workspace/kub run build`: exit 0. Known Vite
  sourcemap, mixed-import and chunk-size warnings remained; no new build error.
- `git diff --check`: exit 0.
- Biome on the two new test files: exit 0. A wider Biome check also reported
  pre-existing formatting in the older support and voice test files; they were
  not mechanically reformatted as unrelated churn.
- Combined public-navigation, support-mobile-layout and public-support E2E:
  24/24 pass across desktop/mobile and both themes.
- Folded-call geometry and exit tests: 2/2 pass, dark/light desktop.
- Session devices: 26 pass, 2 intentional mobile-project skips.
- The initial broad voice-shell/desktop-shell run had five role-dependent
  desktop-shell failures because an ignored local Vite env enabled an unmocked
  `current_user_access_snapshot` RPC. After starting the fixture server with
  `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=0`, those exact five cases passed; five
  mobile-project skips were intentional. The entire broad run was not repeated
  after this fixture-only correction, so do not describe it as all green.
- After the D-157 change, the full desktop-shell spec on 1440px Chromium and
  390px mobile Chromium passed 29 cases with 25 intentional platform skips.
  The focused WebKit mobile folder cases passed in both themes. The shared
  edge-scroll unit suite passed 21/21. Typecheck and the fixture production build passed again;
  the same known Vite warnings remained.

## Limits

No deploy, native signing, physical-device run or production data change was
performed. The screenshots prove these local fixture layouts, not visual parity
on every production route. Other open visual defects remain in
`docs/INTERFACE_DEFECT_REGISTER.md`; this pass closes only the measured cases
listed above. The work does not change iOS/PWA-specific implementation.
