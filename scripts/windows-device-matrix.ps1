[CmdletBinding()]
param(
  [string]$ArtifactPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
$family = if ($build -ge 22000) { "Windows 11" } else { "Windows 10" }

$webViewVersion = $null
$webViewRegistryRoots = @(
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients"
)
foreach ($root in $webViewRegistryRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
    $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    if ($entry -and $entry.name -like "*WebView2*" -and $entry.pv) {
      $webViewVersion = [string]$entry.pv
      break
    }
  }
  if ($webViewVersion) { break }
}

$artifact = [ordered]@{
  provided = $false
  exists = $false
  sizeBytes = $null
  authenticodeStatus = "not_checked"
}
if ($ArtifactPath) {
  $resolved = Resolve-Path -LiteralPath $ArtifactPath -ErrorAction SilentlyContinue
  $artifact.provided = $true
  if ($resolved) {
    $file = Get-Item -LiteralPath $resolved.Path
    $signature = Get-AuthenticodeSignature -LiteralPath $resolved.Path
    $artifact.exists = $true
    $artifact.sizeBytes = $file.Length
    $artifact.authenticodeStatus = [string]$signature.Status
  } else {
    $artifact.authenticodeStatus = "file_missing"
  }
}

$result = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString("o")
  osFamily = $family
  osVersion = [string]$os.Version
  osBuild = $build
  edition = [string]$os.Caption
  architecture = [string]$os.OSArchitecture
  webView2Version = $webViewVersion
  artifact = $artifact
}

$result | ConvertTo-Json -Depth 4
