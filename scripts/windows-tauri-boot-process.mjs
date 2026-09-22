import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function readWindowsProcessIdentity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, "native QA requires a positive child PID");
  const probe = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    try { $item = [Diagnostics.Process]::GetProcessById(${pid}) }
    catch [ArgumentException] { return }
    try {
      [pscustomobject]@{
        pid = [int]$item.Id
        path = [string]$item.MainModule.FileName
        created = $item.StartTime.ToUniversalTime().ToString('o')
      } | ConvertTo-Json -Compress
    } finally { $item.Dispose() }
  `], { encoding: "utf8", windowsHide: true });
  assert.equal(probe.status, 0, "native QA could not inspect the child process");
  return probe.stdout.trim() ? JSON.parse(probe.stdout) : null;
}

export function sameWindowsProcessIdentity(expected, actual) {
  return Boolean(expected && actual && expected.pid === actual.pid &&
    typeof expected.path === "string" && typeof actual.path === "string" &&
    expected.path.toLowerCase() === actual.path.toLowerCase() &&
    expected.created && expected.created === actual.created);
}

export function stopOwnedWindowsProcess(identity) {
  assert(identity && Number.isSafeInteger(identity.pid) && identity.pid > 0, "owned process identity required");
  const stop = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    try { $item = [Diagnostics.Process]::GetProcessById([int]$env:LETSCUBE_BOOT_QA_PID) }
    catch [ArgumentException] { exit 0 }
    try {
      # Retain a live handle so the verified process ID cannot be reused before Kill.
      $handle = $item.SafeHandle
      $handleRef = $false
      $handle.DangerousAddRef([ref]$handleRef)
      try {
      if ($item.HasExited) { exit 0 }
      $path = $item.MainModule.FileName
      $created = $item.StartTime.ToUniversalTime().ToString('o')
      if (-not [string]::Equals($path, $env:LETSCUBE_BOOT_QA_EXE, [StringComparison]::OrdinalIgnoreCase) -or
          $created -cne $env:LETSCUBE_BOOT_QA_CREATED) { exit 2 }
      $item.Kill($true)
      if (-not $item.WaitForExit(5000)) { exit 3 }
      } finally { if ($handleRef) { $handle.DangerousRelease() } }
    } catch [InvalidOperationException] {
      if (-not $item.HasExited) { exit 4 }
    } finally { $item.Dispose() }
  `], {
    env: { ...process.env, LETSCUBE_BOOT_QA_PID: String(identity.pid),
      LETSCUBE_BOOT_QA_EXE: identity.path, LETSCUBE_BOOT_QA_CREATED: identity.created },
    stdio: "ignore", windowsHide: true, timeout: 15000,
  });
  assert.equal(stop.status, 0, "refusing to stop a process that does not match the owned handle");
}
