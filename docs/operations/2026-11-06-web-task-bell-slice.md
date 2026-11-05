# Task opening and bell navigation: web release

2026-11-06 MSK. Released only two bounded fixes to the shared web client:
the separately named task-opening control, and retirement of a pending
notification message jump after manual navigation away from and back to
the chat. Related browser tests were included; no Android catalog, database,
worker, storage policy, provider or Windows package was changed.

- Source: `67394d9c` (tasks), `f5716276` (bell), and `9ed010f5`
  (phone-path browser regression). Outgoing range was reviewed against
  `32ab32fc`; all 33 alias imports resolved in the commits' own trees.
- Card proof: old DOM had no button named by the exact task title; new
  DOM passed independent keyboard/pointer selection and opening on
  Chromium 1440/390 in both themes. Separate Realme 49 AX also passed.
- Exact scoped web tree: typecheck and Vite production-mode compilation
  with isolated public fixture env, service-worker stamp
  `ae3cbcd08b77e6dd`, 67 bell unit/mutation tests, and four desktop/mobile
  bell browser cases passed. The first cold Vite navigation timed out;
  the first mobile round-trip attempt targeted the hidden list. The
  phone test now uses the actual Back control and checks the route before
  selecting the next chat. No test production mutations.
- Actual previous image `32ab32fc` served stamp `d86e22971566dee8` with
  neither content marker. At 21:17:40Z the sole healthy web image was
  `9ed010f5ac046903bc142370e75208430ccf70fc`, public stamp
  `7004fda17e293691`. Public/container HTML, service worker and entry
  JS SHA-256 matched; both specific changed code markers were present.
  The previous image remains available. Public login was visible with
  HTTP 200, zero page errors and zero unexpected writes in isolated
  Chromium 1440 and WebKit 390; no production captures.

The published slice does not ship Android 49, approve the native
draft/Retry/revoke scenarios, close all of D-356, or replace the physical
signed-in iPhone evidence. Android Stable remains `0.1.46` / 47, optional.
