param(
    [string]$Sdk = 'D:\Progi\AndroidStudio-sdk',
    [string]$Jdk = 'C:\Program Files\Android\Android Studio\jbr',
    [int]$Port = 5584,
    [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cleanup.ps1')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$out = Join-Path $repo 'output/native-boot-android'
$sdkImage = Join-Path $Sdk 'system-images/android-34/google_apis_playstore/x86_64'
$adb = Join-Path $Sdk 'platform-tools/adb.exe'
$java = Join-Path $Jdk 'bin/java.exe'
$launcher = @(Get-ChildItem "$env:USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/*/gradle-8.14.3/lib/gradle-launcher-8.14.3.jar")
if ($launcher.Count -ne 1) { throw 'BLOCKED: exactly one cached Gradle 8.14.3 launcher is required; no download permitted' }
foreach ($path in @($java, $adb, (Join-Path $sdkImage 'userdata.img'))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "BLOCKED: missing local prerequisite $path" }
}
if ($Port -lt 5554 -or $Port -gt 5584 -or $Port % 2 -ne 0) { throw 'Use an even emulator console port in the ADB-recommended range 5554..5584' }
function Write-Json($Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12) + "`n") }
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
            $process.Kill() # This exact command client only, never the shared adb server.
            $process.WaitForExit()
            throw "QA emulator adb command timed out: $($AdbArgs[0])"
        }
        $text = $stdout.GetAwaiter().GetResult()
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            if ($AllowFailure) { return '' }
            throw "QA emulator adb command failed: $($AdbArgs[0])"
        }
        return $text.Trim()
    } finally { $process.Dispose() }
}
function Get-HarnessDigest {
    $paths = @('run.ps1','cleanup.ps1','prepare.mjs','prepare.test.mjs',
        'cleanup.test.ps1','ownership.test.ps1','build.gradle','settings.gradle',
        'src/main/AndroidManifest.xml','src/main/java/qa/letscube/boot/BootActivity.java',
        'src/main/java/qa/letscube/boot/BootInstrumentation.java')
    $lines = foreach ($path in $paths) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $path) -Algorithm SHA256).Hash.ToLowerInvariant()
        "$path $hash"
    }
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))).ToLowerInvariant()
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
$lockPath = Join-Path $out 'run.lock'
try { $runLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch { throw 'BLOCKED: another Android boot QA run holds the shared build/output lock' }
try {
$harnessSha = Get-HarnessDigest
& node --test (Join-Path $PSScriptRoot 'prepare.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Source extraction tests failed' }
$receipt = Get-Content (Join-Path $out 'source-receipt.json') -Raw | ConvertFrom-Json
# A disposable QA-only debug certificate, never an application/release signing identity.
$qaKey = Join-Path $out 'qa-debug.keystore'
if (-not (Test-Path -LiteralPath $qaKey)) {
    & (Join-Path $Jdk 'bin/keytool.exe') -genkeypair -keystore $qaKey -storepass android -keypass android -alias androiddebugkey -dname 'CN=Offline Boot QA' -keyalg RSA -validity 30 *> (Join-Path $out 'qa-key-generation.log')
    if ($LASTEXITCODE -ne 0) { throw 'QA-only debug certificate generation failed' }
}
$gradleArgs = @("`"-Dorg.gradle.java.home=$Jdk`"", '-classpath', "`"$($launcher[0].FullName)`"", 'org.gradle.launcher.GradleMain',
    '--offline', '--no-daemon', '--max-workers=2', '--console=plain', '-p', "`"$PSScriptRoot`"",
    '--project-cache-dir', "`"$(Join-Path $out 'gradle-cache')`"", 'assembleDebug')
$build = Start-Process -FilePath $java -ArgumentList $gradleArgs -Environment @{ ANDROID_HOME = $Sdk; ANDROID_SDK_ROOT = $Sdk } -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $out 'build.stdout.log') -RedirectStandardError (Join-Path $out 'build.stderr.log')
$buildLog = Get-Content -LiteralPath (Join-Path $out 'build.stdout.log') -Raw
if ($build.ExitCode -ne 0 -or $buildLog -notmatch 'BUILD SUCCESSFUL') { throw 'BLOCKED: isolated offline Gradle build failed; inspect output/native-boot-android/build.*.log' }
$apk = Join-Path $out 'build/outputs/apk/debug/letscube-boot-qa-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Build did not produce the expected isolated QA APK' }
$apkSha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
Write-Output 'offline_qa_apk_build=passed'
if ($BuildOnly) { return }

$occupied = @(Get-NetTCPConnection -State Listen -LocalPort $Port,($Port + 1) -ErrorAction SilentlyContinue)
if ($occupied.Count) { throw 'BLOCKED: requested emulator ports occupied; choose another even -Port' }
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
target=android-34
"@
[IO.File]::WriteAllText((Join-Path $avdDir 'config.ini'), $avdConfig)
[IO.File]::WriteAllText((Join-Path $avdRoot "$avdName.ini"), "avd.ini.encoding=UTF-8`npath=$avdDir`ntarget=android-34`n")
$emulatorArgs = @('-avd', $avdName, '-port', "$Port", '-no-window', '-no-audio', '-no-snapshot', '-no-boot-anim',
    '-gpu', 'swiftshader_indirect', '-no-metrics', '-wifi-user-mode-options', 'restrict=on,ipv6=off',
    '-network-user-mode-options', 'restrict=on,ipv6=off')
Write-Json (Join-Path $runDir 'launch.json') @{ avd=$avdName; arguments=$emulatorArgs; source=$receipt; harnessSha256=$harnessSha; personalDeviceAccess='inventory only; no targeted command'; apkSha256=$apkSha }
$emulator = Start-Process -FilePath (Join-Path $Sdk 'emulator/emulator.exe') -ArgumentList $emulatorArgs -Environment @{ ANDROID_AVD_HOME=$avdRoot } -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDir 'emulator.stdout.log') -RedirectStandardError (Join-Path $runDir 'emulator.stderr.log')
$started = $false
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    while ([DateTime]::UtcNow -lt $deadline) {
        $emulator.Refresh()
        if ($emulator.HasExited) { throw 'BLOCKED: owned emulator exited during boot; inspect its sanitized logs' }
        $remaining = [Math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalSeconds)
        if ($remaining -le 0) { break }
        $boot = Invoke-Adb @('shell','getprop','sys.boot_completed') -TimeoutSeconds ([Math]::Min(10,$remaining)) -AllowFailure
        if ($boot -eq '1') { $started = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $started) { throw 'BLOCKED: owned API 34 emulator did not boot within 180 seconds' }
    $fingerprint = Invoke-Adb @('shell','getprop','ro.build.fingerprint')
    if ($fingerprint -notlike 'google/sdk_gphone*') { throw 'Unexpected emulator identity; installation refused' }
    $observedAvd = Invoke-Adb @('emu','avd','name')
    if (($observedAvd -split "`n")[0].Trim() -ne $avdName) { throw 'Unexpected AVD name; installation refused' }
    Invoke-Adb @('shell','cmd','connectivity','airplane-mode','enable') | Out-Null
    Invoke-Adb @('shell','svc','wifi','disable') | Out-Null
    Invoke-Adb @('shell','svc','data','disable') | Out-Null
    if ((Invoke-Adb @('shell','settings','get','global','airplane_mode_on')) -ne '1') { throw 'Offline guard failed' }
    if ((Invoke-Adb @('shell','pm','list','packages','com.kub.messenger')).Contains('package:')) { throw 'Fresh emulator unexpectedly contains production application; refusing run' }
    $installed = Invoke-Adb @('install','--no-streaming',$apk)
    if ($installed -notmatch 'Success') { throw 'Isolated QA APK installation did not succeed' }
    $native = Invoke-Adb @('shell','am','instrument','-w','-r','qa.letscube.boot/qa.letscube.boot.BootInstrumentation') -TimeoutSeconds 180
    [IO.File]::WriteAllText((Join-Path $runDir 'instrumentation.log'), $native)
    $reportLine = ($native -split "`n" | Where-Object { $_ -like 'INSTRUMENTATION_RESULT: qa_report=*' })
    if (@($reportLine).Count -ne 1) { throw 'Instrumentation produced no unique structured report' }
    $report = ($reportLine -replace '^INSTRUMENTATION_RESULT: qa_report=', '') | ConvertFrom-Json
    $report | Add-Member source $receipt
    $report | Add-Member baseline (& git -C $repo rev-parse HEAD)
    $report | Add-Member runDirectory ([IO.Path]::GetRelativePath($repo,$runDir))
    $report | Add-Member apkSha256 $apkSha
    $report | Add-Member apkUnchangedDuringRun ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -eq $apkSha)
    $report | Add-Member harnessSha256 $harnessSha
    $report | Add-Member harnessUnchangedDuringRun ((Get-HarnessDigest) -eq $harnessSha)
    $currentHash = (Get-FileHash -LiteralPath (Join-Path $repo 'artifacts/kub/index.html') -Algorithm SHA256).Hash.ToLowerInvariant()
    $report | Add-Member sourceUnchangedDuringRun ($currentHash -eq $receipt.sourceSha256)
    Write-Json (Join-Path $runDir 'report.json') $report
    $positive = @($report.results | Where-Object { -not $_.mutation -and $_.status -eq 'passed' }).Count
    $killed = @($report.results | Where-Object { $_.mutation -and $_.status -eq 'passed' }).Count
    if ($native -notmatch 'INSTRUMENTATION_CODE: -1' -or $report.failures -ne 0 -or $positive -ne 7 -or $killed -ne 3 -or
        $report.unexpectedRequests -ne 0 -or -not $report.engineVersion -or -not $report.sourceUnchangedDuringRun -or
        -not $report.apkUnchangedDuringRun -or -not $report.harnessUnchangedDuringRun) { throw 'Android proof failed; inspect the owned run report' }
} finally {
    Stop-OwnedBootEmulator -Emulator $emulator -Port $Port -AvdName $avdName -Executable (Join-Path $Sdk 'emulator/emulator.exe')
    Remove-OwnedBootAvd -RunDirectory $runDir
}
$cleanupReceipt = Join-Path $runDir 'cleanup.json'
if (-not (Test-Path -LiteralPath $cleanupReceipt) -or (Test-Path -LiteralPath $avdRoot)) {
    throw 'Refusing to publish an Android report without completed owned AVD cleanup'
}
$report | Add-Member cleanupVerified $true
Write-Json (Join-Path $runDir 'report.json') $report
Write-Json (Join-Path $out 'latest-report.json') $report
$report | Select-Object enginePackage,engineVersion,android,api,scenarioCount,failures,assertions,unexpectedRequests,deadlineObservedMs,lateCommitObservedMs,sourceUnchangedDuringRun,apkUnchangedDuringRun,harnessUnchangedDuringRun,cleanupVerified | Format-List
} finally { $runLock.Dispose() }
