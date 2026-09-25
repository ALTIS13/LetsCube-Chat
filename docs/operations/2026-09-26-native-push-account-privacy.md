# Native push account-rebind privacy, 2026-09-26

Owner: shared backend/Windows/Android stream. Status: Edge deployed; native
packages unchanged. Source commit: `7a1683f0`.

## Cause and decision

The existing `native_push_outbox_delivery_recheck` rejects a device rebound
before the check, but FCM or WNS can deliver a request already accepted by the
provider after that device changes accounts. Both transports previously carried
the former account's sender, preview and avatar in the OS payload. A longer DB
lock cannot recall an accepted provider request. Until an installed client can
validate the intended recipient before display, native OS cards therefore show
only `LETSCUBE` plus a generic event category. Exact chat/message IDs, route and
chat tag remain for authorized in-app navigation. In-app notification rows and
browser Web Push are not changed by this commit.

## Verification and rollout

- A synthetic same-token-rebind test failed on both FCM and WNS before the
  patch, then passed for legacy Android notification payloads, current data-only
  Android payloads, WNS toasts, tasks and system events. A UUID fixture retains
  the current Android `native_chat_v`, chat tag and exact message target.
- Focused FCM/WNS/native/Web/voice push tests: 53 passed before the final UUID
  case, then 18 focused privacy/FCM/WNS tests passed after it. Deno 2.5.2
  checked the Edge entrypoint, Kub typecheck passed, and `git diff --check`
  was clean. A mutation of the literal generic message body changed the value
  asserted by the tests.
- Before replacement, live `fcm.ts` and `wns.ts` matched the old Git revision:
  SHA-256 `e00eb019bcdf9700a7dce616bd35eb848c930edce988d9ec3a4af79b4df00ea7`
  and `8c9abbf9be1f02922dae0f775aef5be8a65ad88a6e60cabaabd3e46dfd838c13`.
  Root-only previous copies and staged candidates are at
  `/srv/letscube/backups/native-push-private-20260925T222247Z`.
- Only `supabase-edge-functions` was stopped during the three-file replacement,
  then restarted healthy. Its mounted `fcm.ts`, `wns.ts` and new
  `native-push-privacy.ts` hashes matched the reviewed source:
  `4d9dc9c08ec1158f8fea38d4ba18008aa228beaf964c2775af11710d6be704f6`,
  `e87eabad66c10d220a55c639780c6673386a20a856a5113e84cdbc30b2ad6e38`,
  `9921f44686f9b03ab3e18cb8ff6c0571a91a10175ed69bf150cf2132bc583005`.
  The runtime returned healthy, an unauthenticated direct POST returned 401,
  and three passive pg_net responses in the final 30-second window were HTTP
  200. Cron job `kub-send-push-notifications` remained successful.

## Limits and next work

- No live FCM/WNS card or tap was generated. Provider acceptance, OS display
  and physical-device behavior remain separate proof. Old cards already accepted
  by providers before this rollout cannot be recalled.
- A rebound token can still receive an unrelated **generic** old-account card;
  route IDs are opaque but not bound to a logged-in recipient at OS display time.
  Rich native sender/preview cards should return only with account-bound client
  display plus legacy-version fallback, followed by a separately authorized
  Android package cut and physical QA.
- Web Push/PWA has a related endpoint/account-switch risk and is coordinated
  with the separate iOS/PWA owner; this native-only change does not close it.
- Album items still create one notification and outbox row apiece. The next
  server design keeps per-message read/navigation rows, introduces an internal
  recipient/chat/sender/album aggregation key per endpoint, waits for a bounded
  quiet window and selects a still-unread exact message at delivery. Late parts,
  failed uploads, retries and provider-accepted-but-unacknowledged sends must be
  handled explicitly; exactly-once OS delivery cannot be promised.

## Rollback

Stop only `supabase-edge-functions`; install the two verified `*-before.ts`
files from the root-only rollout directory back as `fcm.ts` and `wns.ts` with
mode 644; remove the now-unused `native-push-privacy.ts` only after both older
modules are restored; start only that container. Verify the two original hashes,
health and passive push-cron HTTP responses. No database rollback is involved.
