[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Apk,
  [string]$Serial = "",
  [string]$AdbPath = "",
  [string]$ApkAnalyzerPath = "",
  [ValidateSet("install", "upgrade", "links", "permissions", "smoke")]
  [string]$Mode = "smoke"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PackageName = "com.kub.messenger"
$LinkUrl = "https://app.letscube.ru/auth/callback"
$AllowedPermissions = @(
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO"
)
$Verdicts = [System.Collections.Generic.List[object]]::new()

function Add-Verdict([string]$Command, [bool]$Passed) {
  $Verdicts.Add([ordered]@{
    command = $Command
    verdict = if ($Passed) { "passed" } else { "failed" }
  })
}

function Get-AdbPath {
  if ($AdbPath) {
    if (-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) { throw "Android Debug Bridge is unavailable." }
    return $AdbPath
  }
  $command = Get-Command adb.exe -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command adb -ErrorAction SilentlyContinue }
  if (-not $command) { throw "Android Debug Bridge is unavailable." }
  return $command.Source
}

function Get-ApkAnalyzerPath {
  if ($ApkAnalyzerPath) {
    if (-not (Test-Path -LiteralPath $ApkAnalyzerPath -PathType Leaf)) { throw "Android APK analyzer is unavailable." }
    return $ApkAnalyzerPath
  }
  if (-not $env:ANDROID_HOME) { throw "Android APK analyzer is unavailable." }
  $candidate = Join-Path $env:ANDROID_HOME "cmdline-tools\\latest\\bin\\apkanalyzer.bat"
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Android APK analyzer is unavailable." }
  return $candidate
}

function Assert-ApkIdentity {
  try {
    if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw "APK input is unavailable." }
    $analyzer = Get-ApkAnalyzerPath
    $output = @(& $analyzer "manifest" "application-id" $Apk 2>&1)
    if ($LASTEXITCODE -ne 0 -or $output.Count -ne 1 -or $output[0].ToString().Trim() -ne $PackageName) {
      throw "APK package identity assertion failed."
    }
  } catch {
    Add-Verdict "apk_identity" $false
    throw "APK package identity assertion failed."
  }
  Add-Verdict "apk_identity" $true
}

function Invoke-Adb([string]$Name, [string[]]$Arguments) {
  $output = & $script:Adb @script:AdbTarget @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Android device command failed." }
  Add-Verdict $Name $true
  return ($output -join "`n")
}

function Select-Device {
  $devices = & $script:Adb devices 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Android device discovery failed." }
  $online = @($devices | Where-Object { $_ -match "^([^\s]+)\s+device$" } | ForEach-Object { ($_.ToString() -split "\s+")[0] })
  if ($Serial) {
    if ($online -notcontains $Serial) { throw "Requested Android device is unavailable." }
    return @("-s", $Serial)
  }
  if ($online.Count -ne 1) { throw "Select one Android device with -Serial." }
  return @("-s", $online[0])
}

function Assert-Installed {
  $output = Invoke-Adb "package_identity" @("shell", "pm", "path", $PackageName)
  if ($output -notmatch "package:") { throw "Expected Android package is not installed." }
}

function Install-Apk([bool]$Upgrade) {
  if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw "APK input is unavailable." }
  $arguments = if ($Upgrade) { @("install", "-r", $Apk) } else { @("install", $Apk) }
  $output = Invoke-Adb (if ($Upgrade) { "upgrade" } else { "install" }) $arguments
  if ($output -notmatch "(?im)^success$") { throw "Android package installation failed." }
  Assert-Installed
}

function Assert-Portrait {
  $output = Invoke-Adb "portrait" @("shell", "dumpsys", "activity", "top")
  if ($output -notmatch "(?im)(screenorientation|requestedorientation)\s*=\s*1") {
    throw "Android portrait orientation assertion failed."
  }
}

function Assert-Permissions {
  $output = Invoke-Adb "permissions" @("shell", "dumpsys", "package", $PackageName)
  foreach ($permission in $AllowedPermissions) {
    if ($output -notmatch [regex]::Escape($permission)) { throw "Android permission contract assertion failed." }
  }
}

function Assert-VerifiedLink {
  $links = Invoke-Adb "verified_links" @("shell", "pm", "get-app-links", $PackageName)
  if ($links -notmatch "(?im)app\.letscube\.ru\s*:\s*(verified|approved)") {
    throw "Android App Link verification assertion failed."
  }
  $resolution = Invoke-Adb "link_resolution" @("shell", "cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.VIEW", "-c", "android.intent.category.BROWSABLE", "-d", $LinkUrl)
  if ($resolution.Trim() -notin @("com.kub.messenger/.MainActivity", "com.kub.messenger/com.kub.messenger.MainActivity")) {
    throw "Android App Link resolution assertion failed."
  }
  $launch = Invoke-Adb "link_launch" @("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-c", "android.intent.category.BROWSABLE", "-d", $LinkUrl)
  if ($launch -notmatch "(?im)status:\s*ok") { throw "Android App Link launch assertion failed." }
}

try {
  if ($Mode -in @("install", "upgrade", "smoke")) { Assert-ApkIdentity }
  $script:Adb = Get-AdbPath
  $script:AdbTarget = Select-Device
  $model = (Invoke-Adb "device_model" @("shell", "getprop", "ro.product.model")).Trim()
  $api = (Invoke-Adb "device_api" @("shell", "getprop", "ro.build.version.sdk")).Trim()
  if (-not $model -or $model -notmatch "^[A-Za-z0-9 ._-]{1,80}$" -or $api -notmatch "^\d{1,3}$") {
    throw "Android device identity could not be safely reported."
  }

  switch ($Mode) {
    "install" { Install-Apk $false }
    "upgrade" { Assert-Installed; Install-Apk $true }
    "links" { Assert-Installed; Assert-VerifiedLink; Assert-Portrait }
    "permissions" { Assert-Installed; Assert-Permissions }
    "smoke" { Install-Apk $true; Assert-Portrait; Assert-Permissions; Assert-VerifiedLink }
  }

  [ordered]@{ device = [ordered]@{ model = $model; api = [int]$api }; verdicts = $Verdicts } | ConvertTo-Json -Depth 4
} catch {
  Add-Verdict $Mode $false
  [ordered]@{ device = $null; verdicts = $Verdicts; failure = "Android device matrix failed." } | ConvertTo-Json -Depth 4
  exit 1
}
