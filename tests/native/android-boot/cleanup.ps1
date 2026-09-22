function Stop-OwnedBootEmulator {
    param(
        [Parameter(Mandatory)]$Emulator,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string]$AvdName,
        [Parameter(Mandatory)][string]$Executable
    )
    if ($AvdName -notmatch '^D298_QA_[a-f0-9]{6}$' -or $Port -lt 5554 -or $Port -gt 5584 -or $Port % 2) {
        throw 'Refusing stop without an exact QA emulator identity'
    }
    $Emulator.Refresh()
    if ($Emulator.HasExited) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($Emulator.Id)"
    if (-not $process -or $process.ProcessId -ne $Emulator.Id -or
        -not [string]::Equals($process.ExecutablePath, $Executable, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing stop: emulator process identity mismatch'
    }
    $namePattern = [regex]::Escape($AvdName)
    if ($process.CommandLine -notmatch "(?i)(?:^|\s)-avd\s+$namePattern(?=\s|$)" -or
        $process.CommandLine -notmatch "(?i)(?:^|\s)-port\s+$Port(?=\s|$)") {
        throw 'Refusing stop: emulator launch arguments mismatch'
    }
    $actualAvd = ((Invoke-Adb @('emu','avd','name')) -split "`n")[0].Trim()
    $fingerprint = Invoke-Adb @('shell','getprop','ro.build.fingerprint')
    if ($actualAvd -ne $AvdName -or $fingerprint -notlike 'google/sdk_gphone*') {
        throw 'Refusing stop: ADB serial identity mismatch'
    }
    Invoke-Adb @('emu','kill') | Out-Null
    if (-not $Emulator.WaitForExit(30000)) { throw 'Owned emulator shutdown timed out; do not terminate unrelated processes' }
}

function Remove-OwnedBootAvd {
    param([Parameter(Mandatory)][string]$RunDirectory)
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    $expectedParent = [IO.Path]::GetFullPath((Join-Path $repo 'output/native-boot-android'))
    $run = [IO.Path]::GetFullPath($RunDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ([IO.Path]::GetDirectoryName($run) -ne $expectedParent -or
        [IO.Path]::GetFileName($run) -notmatch '^run-\d{8}-\d{6}-[a-f0-9]{6}$') {
        throw 'Refusing cleanup outside an exact owned native-boot-android run directory'
    }
    # Reject redirected ancestors as well as redirected descendants before recursive deletion.
    $cursor = $run
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing cleanup through a reparse point' }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    $launch = Get-Content -LiteralPath (Join-Path $run 'launch.json') -Raw | ConvertFrom-Json
    $args = @($launch.arguments)
    $avdIndex = [Array]::IndexOf($args, '-avd')
    $portIndex = [Array]::IndexOf($args, '-port')
    $expectedAvd = 'D298_QA_' + ($run -split '-')[-1]
    if ($launch.avd -ne $expectedAvd -or $avdIndex -lt 0 -or $avdIndex + 1 -ge $args.Count -or
        $args[$avdIndex + 1] -ne $expectedAvd -or $portIndex -lt 0 -or $portIndex + 1 -ge $args.Count) {
        throw 'Refusing cleanup without this harness ownership receipt'
    }
    $port = 0
    if (-not [int]::TryParse([string]$args[$portIndex + 1], [ref]$port) -or $port -lt 5554 -or $port -gt 5584 -or $port % 2) {
        throw 'Invalid owned emulator console port in launch receipt'
    }
    $running = @(Get-CimInstance Win32_Process -Filter "name = 'emulator.exe' OR name = 'qemu-system-x86_64.exe'" |
        Where-Object { $_.CommandLine -match "(?:-avd\s+|@)$([regex]::Escape($expectedAvd))(?:\s|$)" -or $_.CommandLine.Contains($run) })
    if ($running.Count -or @(Get-NetTCPConnection -State Listen -LocalPort $port,($port + 1) -ErrorAction SilentlyContinue).Count) {
        throw 'Refusing cleanup until owned emulator processes and console ports have exited'
    }
    $target = Join-Path $run 'avd'
    if (-not (Test-Path -LiteralPath $target)) { return }
    $resolved = (Resolve-Path -LiteralPath $target).ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($resolved -ne $target -or [IO.Path]::GetDirectoryName($resolved) -ne $run) { throw 'Unexpected resolved AVD target' }
    $entries = @((Get-Item -LiteralPath $target -Force)) + @(Get-ChildItem -LiteralPath $target -Recurse -Force)
    if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
        throw 'Refusing recursive cleanup with redirected AVD entries'
    }
    $bytes = ($entries | Where-Object { -not $_.PSIsContainer } | Measure-Object -Property Length -Sum).Sum
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if (Test-Path -LiteralPath $resolved) { throw 'Owned AVD cleanup did not finish' }
    [IO.File]::WriteAllText((Join-Path $run 'cleanup.json'), (@{
        target='avd'; emulatorProcessesAbsent=$true; consolePortsClosed=$true;
        logicalBytesRemoved=$bytes; logsAndReportsPreserved=$true; completedUtc=[DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json) + "`n")
    Write-Output "owned_avd_cleanup=passed logical_bytes_removed=$bytes"
}
