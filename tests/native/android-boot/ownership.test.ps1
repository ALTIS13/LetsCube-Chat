$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cleanup.ps1')

$script:expectedExecutable = 'C:\qa-sdk\emulator\emulator.exe'
$script:expectedAvd = 'D298_QA_abcdef'
$script:processEvidence = [pscustomobject]@{
    ProcessId = 1842
    ExecutablePath = $script:expectedExecutable
    CommandLine = 'emulator.exe -avd D298_QA_abcdef -port 5584 -no-window'
}
$script:deviceAvd = $script:expectedAvd
$script:deviceFingerprint = 'google/sdk_gphone64_x86_64/emu64xa:14/UPB5.230623.003/11111111:userdebug/dev-keys'
$script:killCount = 0
function Get-CimInstance { return $script:processEvidence }
function Invoke-Adb([string[]]$AdbArgs) {
    $command = $AdbArgs -join ' '
    switch ($command) {
        'emu avd name' { return $script:deviceAvd }
        'shell getprop ro.build.fingerprint' { return $script:deviceFingerprint }
        'emu kill' { $script:killCount++; return '' }
        default { throw "Unexpected adb command: $command" }
    }
}
$emulator = [pscustomobject]@{ Id = 1842; HasExited = $false }
$emulator | Add-Member ScriptMethod Refresh { }
$emulator | Add-Member ScriptMethod WaitForExit { param($Milliseconds) return $true }

function Expect-Refusal([string]$Reason) {
    $before = $script:killCount
    try {
        Stop-OwnedBootEmulator -Emulator $emulator -Port 5584 -AvdName $script:expectedAvd -Executable $script:expectedExecutable
    } catch {
        if ($_.Exception.Message -notlike "*$Reason*") { throw }
        if ($script:killCount -ne $before) { throw 'Foreign emulator serial was stopped' }
        return
    }
    throw 'Unsafe emulator stop was not refused'
}

$script:processEvidence.ProcessId = 9999
Expect-Refusal 'process'
$script:processEvidence.ProcessId = 1842
$script:processEvidence.CommandLine = 'emulator.exe -avd FOREIGN -port 5584 -no-window'
Expect-Refusal 'launch'
$script:processEvidence.CommandLine = 'emulator.exe -avd D298_QA_abcdef -port 5584 -no-window'
$script:deviceAvd = 'FOREIGN'
Expect-Refusal 'identity'
$script:deviceAvd = $script:expectedAvd
$script:deviceFingerprint = 'unknown/device'
Expect-Refusal 'identity'
$script:deviceFingerprint = 'google/sdk_gphone64_x86_64/emu64xa:14/UPB5.230623.003/11111111:userdebug/dev-keys'
Stop-OwnedBootEmulator -Emulator $emulator -Port 5584 -AvdName $script:expectedAvd -Executable $script:expectedExecutable
if ($script:killCount -ne 1) { throw 'Owned emulator serial was not stopped exactly once' }
Write-Output 'ownership_tests=5_passed'
