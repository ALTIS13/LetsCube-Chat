[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$privateKeyPath = Join-Path $repoRoot ".codex-local/windows-updater/updater.key"
$passwordPath = Join-Path $repoRoot ".codex-local/windows-updater/updater-password.txt"
$localPublicKeyPath = Join-Path $repoRoot ".codex-local/windows-updater/updater.key.pub"
$trackedPublicKeyPath = Join-Path $repoRoot "scripts/windows-updater-public.key"
$tauriRoot = Join-Path $repoRoot "windows-tauri"

foreach ($requiredPath in @($privateKeyPath, $passwordPath, $localPublicKeyPath, $trackedPublicKeyPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required Windows updater signing file is missing: $requiredPath"
  }
}

$localPublicKey = (Get-Content -LiteralPath $localPublicKeyPath -Raw).Trim()
$trackedPublicKey = (Get-Content -LiteralPath $trackedPublicKeyPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($localPublicKey) -or $localPublicKey -ne $trackedPublicKey) {
  throw "The local updater signing identity does not match the public key embedded in LETSCUBE."
}

Push-Location $repoRoot
try {
  & pnpm.cmd windows:tauri:prepare
  if ($LASTEXITCODE -ne 0) {
    throw "Windows Tauri dependency preparation failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$hadPrivateKey = Test-Path Env:TAURI_SIGNING_PRIVATE_KEY
$hadPassword = Test-Path Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$previousPrivateKey = if ($hadPrivateKey) { $env:TAURI_SIGNING_PRIVATE_KEY } else { $null }
$previousPassword = if ($hadPassword) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD } else { $null }
$previousPath = $env:Path

try {
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $privateKeyPath -Raw).Trim()
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
  $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

  Push-Location $tauriRoot
  try {
    & pnpm.cmd --ignore-workspace exec tauri build
    if ($LASTEXITCODE -ne 0) {
      throw "Windows updater build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} finally {
  $env:Path = $previousPath
  if ($hadPrivateKey) {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousPrivateKey
  } else {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  }
  if ($hadPassword) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
  } else {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  }
}
