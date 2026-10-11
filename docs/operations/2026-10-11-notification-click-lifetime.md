# Notification action lifetime

Owner: coordinator; stage: shared-web runtime accepted; Android bundle pending.
Scope: shared `NotificationBell`, not native OS delivery or rich preview.

## Reproduced Cause

The bell awaited notification-read RPCs, invite RPCs and chat access, then used
the original handler without checking whether its account/session/component was
still current. A message jump scheduled for150ms also survived manual selection
of another chat. The read hook already protected its own state; it did not own
the consumer's route, alert or chat-selection continuation.

The actual mounted React component, notification hook, invite/read helpers and
`safeOpenChat` reproduced23 behavioral failures against the original code.
The provider and unrelated presentation/platform ports were fictional. There
were no production requests, accounts, screenshots, traces or recordings.

## Changed Behavior

- Bind each action to its owner, account epoch, mounted lifetime and revision.
  Retire mounted lifetime in layout cleanup, in the actual DOM-removal commit.
- A newer notification action retires only the old UI continuation, not an
  already issued backend RPC. No automatic RPC retry or cancellation is added.
- Check after read/invite/refresh awaits and pass the same guard to
  `safeOpenChat`, so a replacement session cannot select or hydrate the old chat.
- Before scheduling and executing a message jump, require the same action and
  the exact selected chat. Manual navigation suppresses the old jump.
- Reset local pending-invite state when the owner/session changes.

Markup, styles, routing addresses, backend contracts and permission checks are
unchanged. No new package, listener, schema or provider configuration is added.

## Source Evidence

`tests/unit/notify-click-owner-lifetime.test.mjs` mounts the real React consumer
in Chromium with held provider responses and literal effect assertions. The
worker's actual GREEN is61/61, including18 compiled omission mutants; each
mutant must fail a behavioral assertion rather than a setup failure. Positive
controls retain task routing, message selection/address/jump and invite results.
Network requests are blocked and observed as zero. Initial RED is23 genuine
behavioral failures, not fixture errors. The worker retained these outputs in
tool sessions, not as separate log files; no historical logs are reconstructed.

Frozen SHA256:

| File | SHA256 |
| --- | --- |
| NotificationBell.tsx | 573f7456ca775febf95eeca01ac43cba074ff8ce3ea8a6e9dad3504522d8cd71 |
| notify-click-owner-lifetime.test.mjs | 1fba78514a70fea0edb9b049444f458abba1935a38fa69d099737d317f62a4f3 |

The original61 also pass in the main-based tree81b28cb8. Independent review then
identified a passive-cleanup timing gap masked by the original synchronous root
unmount fixture. Four new real asynchronous parent-removal cases reproduce RED:
DOM absent -> held RPC finished -> passive retirement, with route/select/alert
effects. A real12ms layout workload exposes React's cooperative scheduling gap;
no effect/scheduler mock or forced passive flush is used for removal. Layout
cleanup fixes that boundary; affected GREEN6/6 covers four new cases, one compiled
passive-cleanup omission and the live-action control. Historical61 are reused,
not presented as66 new passes or rerun without changed inputs.

Coordinator actual post-review kub typecheck and `git diff --check` pass.
Independent delta review accepts the layout-retirement fix with no P1/P2.
Main-tree typecheck and affected6/6 pass. The real local build reports
`sw.js build32a0af85cc7c06c0` and `built in34.26s`. Its fictional configuration
is not a production-byte expectation. Forty-two imports resolve in the two
commits' own trees. Only those reviewed commits81b28cb8/323c4988 were published;
unfinished native-preview feature commits and unowned sidebar work are excluded.

## Actual Publication

At15:04:58 UTC, the sole healthy web container47ef52aa99bd runs full revision
`323c4988d2e10f1455ce6473d26cc1d4e46c5945`, image ID
`sha256:b04206a2e2f690ed55f3f101bb0cf6d3262167173bda2c410bcd528328062acd`.
The public entry is `/assets/index-GFJqNGgt.js`, SHA256
`ffa564abdb7632f4186c1d7182f863352ca31c0cc82fd3d9939bc621527b93cd`;
public SW SHA256 is55b5ffdf525b47c87344e5c0abafe1508e3d2b173fc5ef384e651179a8e45b87.
Both match the running container, not the local fixture build.

The calibrated AST marker changes from two unsafe direct Bell timers to one
guarded helper/two guarded calls/zero unsafe timers. The exact old public entry
and old image remain available; initial and final runtime identities agree.
Actual before receipt SHA256 is
ff6bd0bf26d20d39c4666d09f4f33cddb40d0b2c82a14a2433405c694f4e22d1;
after receipt SHA256 is
ffc4b1bff9a480ca0b717d0124d9a4da986b027885ff4ef3b8946719731c98cf.
The read-only helper is independently source-accepted. Receipts contain runtime
metadata only, not personal notification content or native activation evidence.
A separate Coolify queue metadata query refused; it is not labelled PASS or
replayed. Direct running-image/content acceptance above establishes deployment.

## Acceptance Boundary

This is a consumer-lifetime fix, not an explanation of D-349's reported OS
notifications after read, a natural FCM timing result or a native card-click test.
Android embeds its web bundle: the existing candidate18 does not contain this
fix and cannot be presented as notification-action parity. A later accepted
Android bundle/release is required. Windows and web consume the deployed shared
application, subject to actual running-container and served-content checks.
