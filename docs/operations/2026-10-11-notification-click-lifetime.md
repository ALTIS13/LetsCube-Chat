# Notification action lifetime

Owner: coordinator; stage: source verification, narrow main rollout pending.
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
Main-tree build and running-image/content verification are still pending at this
checkpoint. Only the narrow fix may be carried to main;
unfinished native-preview feature commits and unowned sidebar work are excluded.

## Acceptance Boundary

This is a consumer-lifetime fix, not an explanation of D-349's reported OS
notifications after read, a natural FCM timing result or a native card-click test.
Android embeds its web bundle: the existing candidate18 does not contain this
fix and cannot be presented as notification-action parity. A later accepted
Android bundle/release is required. Windows and web consume the deployed shared
application, subject to actual running-container and served-content checks.
