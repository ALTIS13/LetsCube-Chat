# Task 10 of 12: Windows acceptance boundary

**Checkpoint, 2026-11-05 19:20 UTC:** Owner: LETSCUBE coordinator. Windows-only
local audit at `main` / `32ab32fc`; no product changes or release. Status:
source/fixture and inventory evidence only. Next: authorized installed-client
delta on an isolated Win11 environment; WNS has separate identity, integration
and physical delivery gates. The [Task 10 plan](../superpowers/plans/2026-10-18-production-completion.md#task10-platform-delta-matrix-7928)
remains open.

## Reuse accepted evidence

- [Windows 0.2.14 build 18](../QA_RESULTS.md#2026-09-06---windows-0214-stable-release-and-the-defect-qa-caught-before-it-shipped):
  the release recorded exact Stable download and Stable/Test updater installer
  parity (2,367,306 bytes, SHA-256
  `51cafe43c6cef824f74bb33c1f3e97113ad46f347b859115e833dda4ec1f4a92`)
  and independent Tauri updater signature verification against the preceding
  installed version's key. No fresh public catalog or byte check this turn.
- [Lifecycle](../QA_RESULTS.md#2026-07-13---repeatable-windows-tauri-parity-and-installer-lifecycle-qa)
  and [toast evidence](../QA_RESULTS.md#2026-07-14---windows-027-grouped-message-actions):
  prior installed repair, reinstall and real cross-version updater application;
  isolated native WebView2 startup/offline Retry and update modes; running/tray
  toasts, exact fresh/history card routing, task isolation and chat-scoped
  history cleanup. These are not terminated-process receipt or an authenticated
  long-session run. The [prior soak attempt](../QA_RESULTS.md#2026-07-24---windows-sparse-identity-preflight)
  reached WebView2 but did not reach the authenticated shell or exercise reconnect.
- [September native source evidence](2026-09-22-boot-recovery.md): the current
  `windows-tauri/` tree matches `f1bbd60b`; retain the recorded offline Rust
  results (82 pass, 4 live-registry cases ignored). The source includes
  autostart and pre-React recovery changes after the `0.2.14` cut. A matching
  PE version string does not make those changes part of the installed build.

## Observed locally

| Boundary | Result |
| --- | --- |
| Host | Windows 11 Pro x64 build `26300`, WebView2 `156.0.4314.58`. No LETSCUBE process at the inventory sample. Local Hyper-V reported zero registered VMs; no Win10 or alternate WebView2 execution evidence. |
| Installed shell | The default per-user NSIS path contains `0.2.14`, Authenticode `NotSigned`; examined only as a file. The two checked build-output directories do not contain its NSIS installer. The installed EXE, a `0.2.14` debug EXE and a `0.2.10` release build output are distinct artifacts. |
| Archived installer | Local NSIS `0.2.10`, 2,321,755 bytes, SHA-256 `31ed5a8749a85802ce67581e92a9518f67b9c5930fb7463072ab7bcfd737d760` matches the prior release record. The matrix reports `NotSigned`. An adjacent updater `.sig` exists; it was not freshly verified. |
| Sparse identity | SDK `10.0.26100.0` has MakeAppx and SignTool; Windows App Runtime x64 packages are present. The current-user AppX name probe for LETSCUBE returned no match, not an exhaustive lookup by an unknown PFN. All seven public identity inputs were absent from this process environment. The synthetic render, missing-input refusal and temporary MakeAppx pack/unpack test passed. The fixture used `/nv`, contained only manifest/block map, and was removed; it did not sign or register anything. |
| Local suites at audit | 123 passed, 1 failed before the test repair below, excluding the already-passed temporary pack case. Includes 17 Chromium readiness fixtures with intercepted requests and `KUB_QA_ALLOW_MUTATIONS=0`, not WebView2 execution. The checkout lacked its esbuild Windows executable; the existing `0.27.3` binary in the other worktree was reused via a process-only override. No dependency install. The standard QA bundle inspection returned `ok` without launch; the long-session runner instead loads the remote renderer and needs a separately authorized QA session. |

## WNS test-only follow-up

Reproduced the stale source guard (5 pass, 1 fail): it still matched the
pre-`bdb346f4` projection and `device.provider` branch. Updated only
[`wns-delivery.test.mjs`](../../tests/unit/wns-delivery.test.mjs) and this report.
The guard checks required device fields as a set, separate WNS/FCM branches on
the validated snapshot, and the exact claim/device/fingerprint passed to the
bound RPC. It requires the recheck to be awaited and non-deliver results to be
refused before WNS channel I/O. Six in-memory mutants fail their intended
checks: missing session field, raw provider branch, unbound RPC, omitted
fingerprint, unawaited recheck, and inverted denial.

Focused run: 78 pass, 0 fail across `wns-delivery`, `windows-wns-device-schema`,
`native-push-binding` and `native-push-delivery-recheck`. The existing native
binding tests exercise the dispatcher with synthetic responses; no live
provider, package or device acceptance was added. Production code is unchanged.

## Remaining acceptance

1. **Installed-client offline and soak.** On isolated Windows 11/current
   WebView2, exercise the exact installed artifact and shared renderer with a
   dedicated QA session, no captures. Verify signed-in launch and tray/restore,
   warm offline/reconnect, cold offline startup/Retry within the supported
   contract, and a one-hour run across idle/lock or sleep/resume. Require one
   window/document, retained session, route and draft, recovery without reload,
   no unexpected errors and cleanup. The debug CDP offline toggle is useful but
   does not replace the installed-client and real network-loss cases.
2. **Compatibility and release delta.** Run the remaining rows in the
   [Windows matrix](../native/WINDOWS_QA_MATRIX.md) on disposable Windows 10
   22H2 x64 and Windows 11 x64 with a previous supported WebView2. For the next
   legitimate NSIS candidate, verify exact installer bytes and Tauri `.sig`,
   data-retaining in-place update and launch, and changed native behavior
   including autostart/tray and startup recovery; retain rollback evidence.
   Authenticode and SmartScreen reputation are separate from the Tauri signature
   and do not block the owner's first-party unsigned EXE path. No Store claim.
3. **WNS after full exit.** The current NSIS client has running-process toasts,
   not Windows App SDK channel acquisition or COM cold activation. Follow the
   [identity](../native/WINDOWS_PACKAGE_IDENTITY_RUNBOOK.md) and
   [WNS](../native/WINDOWS_WNS_RUNBOOK.md) gates: real Publisher/PFN and approved
   Entra mapping; signed sparse companion plus verified NSIS register/repair/
   update/remove lifecycle; fail-closed runtime PFN check, channel registration,
   renewal/revocation and cold route handoff. Separately review the historical
   unapplied WNS proposal against the current session-bound device/outbox
   contract before authorized schema and server-only provider setup. Then prove
   actual Windows 10/11 receipt with no LETSCUBE process, after reboot, and exact
   card activation after session restore, with mute/sender/revocation/expiry
   controls.

No installed launch, install, signing, registration, deployment, database or
production credential access, or host configuration change was performed.
