# Notification preferences and capability - 2026-10-07

Owner: coordinator, `codex/bot-inline-media-20261002`, base `6e747adf`.
Item 76 / D-335 preparation; adjacent defect D-347. Native previews remain generic.
This record separates a deployable web preference repair from source preparation
that is not an installed Android capability or production database change.

## Observed failures

The actual `usePush` hook could publish account A's delayed preference response
after switching to B, and copy A's categories into B's next whole-row save.
An older failed optimistic save could also restore an unsaved draft. Two mounted
hook instances could overwrite each other's confirmed categories. Native enable
completion could disable the newer registration intent after a retired save.
Editing a category during a held initial subscription reconciliation could leave
the enable control indefinitely unready without another event.

An independent reviewer reproduced a further provider race: A's held unsubscribe
left an endpoint temporarily visible; B with push already enabled reused it and
became active. A's completion removed the actual provider subscription, while B
still displayed active. The changed lease and retry boundaries now pass their
regression checks; final independent review accepted the fix. This is not a reported
delivery failure on a real phone.

## Implementation boundaries

- Preference state and callbacks belong to the actual account and account epoch;
  late read/write feedback cannot publish into a replacement owner.
- Same-document writes are ordered, merge only unconfirmed changed fields into a
  freshly read owner row, and roll back to the last confirmed state. This is not
  cross-document/device atomicity. RLS remains the server authority; dispatched
  requests cannot be retrospectively cancelled.
- Native context checks remain independent of app ownership. The browser
  permission call still runs synchronously inside the real user gesture.
- Browser deletion has a shared same-document lease and provider revision.
  Reconciliation and manual provider operations cannot reuse a snapshot being
  removed by another hook. Settlement automatically rereads the provider;
  refused stale-key cleanup cannot trigger an automatic deletion loop.
- The new distinct `MessagePreviews` bridge negotiates only a candidate identity.
  An authenticated, exact five-key capability reply must match current user,
  session and device. No app-version or voice capability grants preview authority.
- Account-wide consent has `none`, `sender`, `message` choices. Auth callbacks
  synchronously invalidate old work and defer client calls; account epoch, request
  revisions, disposal and an owner write barrier fence delayed results/remounts.
  Opt-in needs exact owner-row ACK and a fresh capability confirmation. Failed
  `none` is locally closed without inventing a saved ACK.
- Old APKs and ordinary browsers make no capability call. An unavailable server
  shows generic device status, not an inferred account consent. Known choices
  remain visible but disabled during saving; the panel does not collapse.
- The added SQL capability is an unversioned proposal only. Exact live session,
  enabled/unrevoked Android FCM device and default-none consent are mandatory.
  It does not authorize private display or replace current-card/credential checks.

## Verification checkpoint

- Actual preference hook initial RED 20/23; subsequent rollback 2, multi-instance 1
  and held-reconcile 2 failures exposed the affected boundaries. Provider review
  added RED 3 and a separate failed-cleanup RED. Final GREEN 64/64 includes
  24 compiled behavioral mutants, with actual provider removal in the fixture.
- Actual native preview contract/hook 37/37, including 17 compiled behavioral
  mutants, plus adjacent settings 27/27. These use fictional providers/claims.
- Actual Settings consumer 8/8 plus expanded ready matrix 4/4. Coordinator viewed
  the exact panel at 1440/390 in both themes. Added saving-layout regression went
  RED because the selected radio disappeared, then GREEN with three disabled
  radios and at most 2 px height change.
- Final mounted preference ownership refresh 3/3: Chromium 1440/390 and WebKit 390;
  fictional accounts, localhost backend, no production mutations or captures.
- Current SQL proposal fixture 135/135, including 8 new capability mutants and 1
  new raising ACL mutant. Previous authorization evidence is reused, not claimed
  as live JWT or recovery acceptance.
- Final typecheck exit 0; production-config web build `cd49e9074b3bfa2d`,
  `built in 21.25s`, after the provider-race correction. Independent preview
  and provider reviews have no open P1/P2. The provider reviewer checked the
  exact frozen source/test hashes without replaying unchanged suites.
- Impeccable context respected the incumbent settings design. Its targeted
  detector returned no findings. No paid design/mobile quota was consumed.

## Publication and next gate

Read-only preflight identifies the single healthy web image `a96a4d55`, fresh
backup `20261007-034854`, all 15 checksums valid, archive list readable and rollback
image retained. This is web rollout readiness, not a full PG17 restore drill.
The public old entry has one full preference read and no preview capability call;
the final local candidate has two reads and one distinct capability call.
Its entry is `/assets/index-CVyjXO4K.js`, SHA-256
`d0ffbc36b55cf31c43867e5cf4b2096a9aeea3a0f5a2dbda0d6768bc93b1e5df`.
Actual before/after markers, healthy exact revision and retained old entry are
required after any main push. Web fixes reach the browser/Windows shell; installed
Android still requires a separately accepted bundle upgrade.

No production SQL, APK sync/assemble/sign/install/publication, provider send,
package identity, signing, OS card or rented device acceptance is claimed.
D-335 stays OPEN. PG17 recovery/backup/real JWT HTTP, native credentials/current
epoch/current-card and lock-screen/device proof remain separate stages.

Fresh authorized tester intake is processed in ignored storage. Only sanitized
product observations and their deduplicated task mapping belong in tracked docs;
raw bodies, identifiers, URLs, media, prompts and ASR text never do.
