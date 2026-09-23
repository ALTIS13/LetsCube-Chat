param(
    [string]$Sdk = 'D:\Progi\AndroidStudio-sdk',
    [ValidateSet(33, 34)][int]$ApiLevel = 34,
    [switch]$DarkMode,
    [int]$Port = 5582
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cleanup.ps1')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$out = Join-Path $repo 'output/native-boot-android'
$adb = Join-Path $Sdk 'platform-tools/adb.exe'
$sdkImage = Join-Path $Sdk "system-images/android-$ApiLevel/google_apis_playstore/x86_64"
$apk = Join-Path $repo 'android/app/build/outputs/apk/debug/app-debug.apk'
$testApk = Join-Path $repo 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
$emulatorExe = Join-Path $Sdk 'emulator/emulator.exe'
if ($Port -lt 5554 -or $Port -gt 5584 -or $Port % 2) { throw 'Use an even emulator console port in 5554..5584' }
foreach ($path in @($adb, $emulatorExe, (Join-Path $sdkImage 'userdata.img'), $apk)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing local prerequisite: $path" }
}
if (@(Get-NetTCPConnection -State Listen -LocalPort $Port,($Port + 1) -ErrorAction SilentlyContinue).Count) {
    throw 'An emulator port is already occupied'
}

function Invoke-Adb([string[]]$AdbArgs, [int]$TimeoutSeconds = 30, [switch]$AllowFailure) {
    $info = [Diagnostics.ProcessStartInfo]::new($adb)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in (@('-s', "emulator-$Port") + $AdbArgs)) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            $process.WaitForExit()
            throw "Owned ADB client timed out: $($AdbArgs[0])"
        }
        $result = $stdout.GetAwaiter().GetResult().Trim()
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            if ($AllowFailure) { return '' }
            throw "Owned ADB client failed: $($AdbArgs[0])"
        }
        return $result
    } finally { $process.Dispose() }
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
$lockPath = Join-Path $out 'run.lock'
try { $runLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch { throw 'Another Android boot QA run owns the shared output lock' }
try {
    Push-Location (Join-Path $repo 'android')
    try {
        & .\gradlew.bat :app:assembleDebugAndroidTest --offline --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Android instrumentation APK build failed' }
    } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $testApk)) { throw 'Instrumentation APK missing after Gradle build' }
    $apkSha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
    $testApkSha = (Get-FileHash -LiteralPath $testApk -Algorithm SHA256).Hash
    $bundleRoot = Join-Path $repo 'artifacts/kub/dist/public'
    $bundleIndex = Join-Path $bundleRoot 'index.html'
    if (-not (Test-Path -LiteralPath $bundleIndex)) { throw 'Built web index missing; run the production debug build first' }
    $indexSha = (Get-FileHash -LiteralPath $bundleIndex -Algorithm SHA256).Hash
    $sourceCommit = (& git -C $repo rev-parse HEAD).Trim()
    $shortCommit = (& git -C $repo rev-parse --short=12 HEAD).Trim()
    $entryScripts = @(Get-ChildItem -LiteralPath (Join-Path $bundleRoot 'assets') -Filter 'index-*.js' -File)
    if ($entryScripts.Count -ne 1 -or -not [IO.File]::ReadAllText($entryScripts[0].FullName).Contains($shortCommit)) {
        throw 'Built web bundle does not carry the current source commit; rebuild and sync first'
    }
    $bundleFiles = @(Get-ChildItem -LiteralPath $bundleRoot -File -Recurse | Where-Object {
        -not [IO.Path]::GetRelativePath($bundleRoot, $_.FullName).Replace('\', '/').StartsWith('.well-known/')
    })
    $archive = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $embeddedFiles = @($archive.Entries | Where-Object {
            $_.FullName.StartsWith('assets/public/') -and -not $_.FullName.EndsWith('/') -and
            $_.FullName -notin @('assets/public/cordova.js', 'assets/public/cordova_plugins.js')
        })
        if ($embeddedFiles.Count -ne $bundleFiles.Count) { throw 'Debug APK web file count differs from the built bundle' }
        foreach ($file in $bundleFiles) {
            $relative = [IO.Path]::GetRelativePath($bundleRoot, $file.FullName).Replace('\', '/')
            $entry = $archive.GetEntry("assets/public/$relative")
            if (-not $entry -or $entry.Length -ne $file.Length) { throw "Embedded web asset mismatch: $relative" }
            $stream = $entry.Open()
            try { $embeddedSha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) }
            finally { $stream.Dispose() }
            if ($embeddedSha -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) {
                throw "Embedded web asset digest mismatch: $relative"
            }
        }
    } finally { $archive.Dispose() }
    $runDir = Join-Path $out ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
    $avdRoot = Join-Path $runDir 'avd'
    $avdName = 'D298_QA_' + ($runDir -split '-')[-1]
    $avdDir = Join-Path $avdRoot "$avdName.avd"
    New-Item -ItemType Directory -Force -Path $avdDir | Out-Null
    $avdConfig = @"
avd.ini.encoding=UTF-8
abi.type=x86_64
hw.cpu.arch=x86_64
hw.cpu.ncore=2
hw.ramSize=2048
hw.lcd.width=1080
hw.lcd.height=1920
hw.lcd.density=420
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
hw.audioInput=no
hw.audioOutput=no
hw.camera.back=none
hw.camera.front=none
hw.gps=no
hw.sdCard=no
disk.dataPartition.size=4G
image.sysdir.1=$sdkImage\
tag.id=google_apis_playstore
target=android-$ApiLevel
"@
    [IO.File]::WriteAllText((Join-Path $avdDir 'config.ini'), $avdConfig)
    [IO.File]::WriteAllText((Join-Path $avdRoot "$avdName.ini"), "avd.ini.encoding=UTF-8`npath=$avdDir`ntarget=android-$ApiLevel`n")
    $emulatorArgs = @('-avd', $avdName, '-port', "$Port", '-no-window', '-no-audio', '-no-snapshot', '-no-boot-anim',
        '-gpu', 'swiftshader_indirect', '-no-metrics', '-wifi-user-mode-options', 'restrict=on,ipv6=off',
        '-network-user-mode-options', 'restrict=on,ipv6=off')
    [IO.File]::WriteAllText((Join-Path $runDir 'launch.json'), (@{
        avd=$avdName; arguments=$emulatorArgs; apkSha256=$apkSha; testApkSha256=$testApkSha; target='full-capacitor-shell';
        requestedApi=$ApiLevel; darkMode=$DarkMode.IsPresent;
        personalDeviceAccess='none'; createdUtc=[DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json) + "`n")
    $emulator = $null
    try {
        $emulator = Start-Process -FilePath $emulatorExe -ArgumentList $emulatorArgs -Environment @{ ANDROID_AVD_HOME=$avdRoot } -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDir 'emulator.stdout.log') -RedirectStandardError (Join-Path $runDir 'emulator.stderr.log')
        $deadline = [DateTime]::UtcNow.AddSeconds(180)
        $boot = ''
        while ([DateTime]::UtcNow -lt $deadline) {
            $emulator.Refresh()
            if ($emulator.HasExited) { throw 'Owned emulator exited during boot' }
            $boot = Invoke-Adb @('shell','getprop','sys.boot_completed') -TimeoutSeconds 10 -AllowFailure
            if ($boot -eq '1') { break }
            Start-Sleep -Seconds 2
        }
        if ($boot -ne '1') { throw 'Owned emulator did not boot within 180 seconds' }
        $fingerprint = Invoke-Adb @('shell','getprop','ro.build.fingerprint')
        $androidVersion = Invoke-Adb @('shell','getprop','ro.build.version.release')
        $androidApi = Invoke-Adb @('shell','getprop','ro.build.version.sdk')
        $observedAvd = ((Invoke-Adb @('emu','avd','name')) -split "`n")[0].Trim()
        if ($fingerprint -notlike 'google/sdk_gphone*' -or $observedAvd -ne $avdName) { throw 'Unexpected emulator identity; refusing installation' }
        Invoke-Adb @('shell','cmd','connectivity','airplane-mode','enable') | Out-Null
        Invoke-Adb @('shell','svc','wifi','disable') | Out-Null
        Invoke-Adb @('shell','svc','data','disable') | Out-Null
        if ($DarkMode) { Invoke-Adb @('shell','cmd','uimode','night','yes') | Out-Null }
        if ((Invoke-Adb @('shell','settings','get','global','airplane_mode_on')) -ne '1') { throw 'Owned emulator offline guard failed' }
        if ((Invoke-Adb @('shell','pm','list','packages','com.kub.messenger')).Contains('package:')) {
            throw 'Expected a fresh emulator without the production package'
        }
        if ((Invoke-Adb @('install','--no-streaming',$apk)) -notmatch 'Success') { throw 'Debug APK installation failed' }
        if ((Invoke-Adb @('install','--no-streaming',$testApk)) -notmatch 'Success') { throw 'Instrumentation APK installation failed' }
        function Check-Shell([string]$Mode) {
            $result = Invoke-Adb @('shell','am','instrument','-w','-r','-e','class',
                'com.kub.messenger.FullShellBootTest',
                'com.kub.messenger.test/androidx.test.runner.AndroidJUnitRunner') -TimeoutSeconds 180
            [IO.File]::WriteAllText((Join-Path $runDir "$Mode.instrumentation.log"), $result + "`n")
            if ($result -notmatch 'OK \(1 test\)' -or $result -notmatch 'INSTRUMENTATION_CODE: -1' -or
                $result -match 'FAILURES|INSTRUMENTATION_FAILED') {
                throw "Full shell instrumentation failed: $Mode; inspect the owned run log"
            }
            Write-Output "full_shell_$Mode=passed"
        }
        Check-Shell 'cold-and-resume'
        Invoke-Adb @('pull','/sdcard/Android/data/com.kub.messenger/files/full-shell-guest.png',
            (Join-Path $runDir 'guest-screen.png')) | Out-Null
        if (-not (Test-Path -LiteralPath (Join-Path $runDir 'guest-screen.png'))) { throw 'Focused guest screenshot missing' }
        Invoke-Adb @('shell','am','force-stop','com.kub.messenger') | Out-Null
        Check-Shell 'after-force-stop'
        if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne $apkSha) { throw 'APK changed during QA run' }
        if ((Get-FileHash -LiteralPath $testApk -Algorithm SHA256).Hash -ne $testApkSha) { throw 'Instrumentation APK changed during QA run' }
        $report = @{
            passed=$true; android=$androidVersion; api=$androidApi; apkSha256=$apkSha;
            testApkSha256=$testApkSha; bundleIndexSha256=$indexSha;
            sourceCommit=$sourceCommit; embeddedWebFiles=$bundleFiles.Count;
            modes=@('cold','resume','after-force-stop'); package='com.kub.messenger';
            accountAuthenticated=$false; requestedDarkMode=$DarkMode.IsPresent
        }
    } finally {
        if ($emulator) { Stop-OwnedBootEmulator -Emulator $emulator -Port $Port -AvdName $avdName -Executable $emulatorExe }
        Remove-OwnedBootAvd -RunDirectory $runDir
    }
    if (-not (Test-Path -LiteralPath (Join-Path $runDir 'cleanup.json')) -or (Test-Path -LiteralPath $avdRoot)) {
        throw 'Owned emulator cleanup did not complete'
    }
    $report.cleanupVerified = $true
    [IO.File]::WriteAllText((Join-Path $runDir 'result.json'), ($report | ConvertTo-Json) + "`n")
    Write-Output "full_shell_qa=passed report=$(Join-Path $runDir 'result.json')"
} finally { $runLock.Dispose() }
