param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Preflight", "Sign", "Verify", "VerifyBundle")]
  [string]$Mode,

  [Parameter(Mandatory = $false)]
  [string]$Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$codeSigningOid = "1.3.6.1.5.5.7.3.3"

function Get-RequiredEnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required signing configuration is missing: $Name"
  }
  return $value.Trim()
}

function Resolve-SignTool {
  $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitsRoot) {
    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Filter "signtool.exe" -File -Recurse |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw "signtool.exe is required for Authenticode signing and verification."
}

function Resolve-SigningProvider {
  $provider = Get-RequiredEnvironmentValue "WINDOWS_SIGNING_PROVIDER"
  if ($provider -notin @("artifact", "certificate_store")) {
    throw "WINDOWS_SIGNING_PROVIDER must be artifact or certificate_store."
  }
  return $provider
}

function Test-ArtifactSigningConfiguration {
  foreach ($name in @(
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "WINDOWS_ARTIFACT_SIGNING_ENDPOINT",
    "WINDOWS_ARTIFACT_SIGNING_ACCOUNT",
    "WINDOWS_ARTIFACT_SIGNING_PROFILE"
  )) {
    [void](Get-RequiredEnvironmentValue $name)
  }

  if (-not (Get-Command "artifact-signing-cli" -ErrorAction SilentlyContinue)) {
    throw "artifact-signing-cli is not installed or unavailable in PATH."
  }
}

function Get-CodeSigningCertificate {
  $thumbprint = (Get-RequiredEnvironmentValue "WINDOWS_CERTIFICATE_THUMBPRINT") -replace "\s", ""
  $timestampUrl = Get-RequiredEnvironmentValue "WINDOWS_TIMESTAMP_URL"
  $parsedTimestamp = $null
  if (
    -not [Uri]::TryCreate($timestampUrl, [UriKind]::Absolute, [ref]$parsedTimestamp) -or
    $parsedTimestamp.Scheme -ne "https"
  ) {
    throw "WINDOWS_TIMESTAMP_URL must be an absolute HTTPS URL."
  }

  $certificate = Get-ChildItem "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
  if (-not $certificate) {
    throw "The configured Authenticode certificate is not installed for the current user."
  }
  if (-not $certificate.HasPrivateKey) {
    throw "The configured Authenticode certificate has no accessible private key."
  }
  if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) {
    throw "The configured Authenticode certificate is outside its validity period."
  }
  $hasCodeSigningEku = $certificate.EnhancedKeyUsageList |
    Where-Object { $_.ObjectId.Value -eq $codeSigningOid }
  if (-not $hasCodeSigningEku) {
    throw "The configured certificate is not valid for code signing."
  }

  return @{
    Certificate = $certificate
    Thumbprint = $thumbprint
    TimestampUrl = $timestampUrl
  }
}

function Invoke-Preflight {
  $provider = Resolve-SigningProvider
  [void](Resolve-SignTool)
  if ($provider -eq "artifact") {
    Test-ArtifactSigningConfiguration
  } else {
    [void](Get-CodeSigningCertificate)
  }

  Write-Host "[Authenticode] Signing prerequisites are available for provider '$provider'."
}

function Resolve-TargetPath {
  param([Parameter(Mandatory = $true)][string]$TargetPath)

  $resolved = Resolve-Path -LiteralPath $TargetPath -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
    throw "Authenticode target must be a file."
  }
  if ([IO.Path]::GetExtension($resolved.Path).ToLowerInvariant() -ne ".exe") {
    throw "Authenticode target must be an executable."
  }
  return $resolved.Path
}

function Invoke-Verify {
  param([Parameter(Mandatory = $true)][string]$TargetPath)

  $resolvedPath = Resolve-TargetPath $TargetPath
  $signature = Get-AuthenticodeSignature -LiteralPath $resolvedPath
  if (
    $signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    -not $signature.SignerCertificate
  ) {
    throw "Authenticode verification failed with status '$($signature.Status)'."
  }
  $hasCodeSigningEku = $signature.SignerCertificate.EnhancedKeyUsageList |
    Where-Object { $_.ObjectId.Value -eq $codeSigningOid }
  if (-not $hasCodeSigningEku) {
    throw "Authenticode signer is not valid for code signing."
  }

  $signTool = Resolve-SignTool
  & $signTool verify /pa /all $resolvedPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "signtool verification failed."
  }
  Write-Host "[Authenticode] Verified $([IO.Path]::GetFileName($resolvedPath))."
}

function Invoke-Sign {
  param([Parameter(Mandatory = $true)][string]$TargetPath)

  $resolvedPath = Resolve-TargetPath $TargetPath
  $provider = Resolve-SigningProvider
  if ($provider -eq "artifact") {
    Test-ArtifactSigningConfiguration
    $endpoint = Get-RequiredEnvironmentValue "WINDOWS_ARTIFACT_SIGNING_ENDPOINT"
    $account = Get-RequiredEnvironmentValue "WINDOWS_ARTIFACT_SIGNING_ACCOUNT"
    $profile = Get-RequiredEnvironmentValue "WINDOWS_ARTIFACT_SIGNING_PROFILE"
    & artifact-signing-cli -e $endpoint -a $account -c $profile -d "LETSCUBE" $resolvedPath
  } else {
    $signing = Get-CodeSigningCertificate
    $signTool = Resolve-SignTool
    & $signTool sign /sha1 $signing.Thumbprint /fd SHA256 /tr $signing.TimestampUrl /td SHA256 /d "LETSCUBE" $resolvedPath
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticode signing command failed."
  }

  Invoke-Verify $resolvedPath
}

function Invoke-VerifyBundle {
  param([Parameter(Mandatory = $true)][string]$BundlePath)

  $resolvedBundle = Resolve-Path -LiteralPath $BundlePath -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolvedBundle.Path -PathType Container)) {
    throw "Bundle path must be a directory."
  }
  $installers = @(Get-ChildItem -LiteralPath $resolvedBundle.Path -Filter "*-setup.exe" -File)
  if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS setup executable, found $($installers.Count)."
  }
  Invoke-Verify $installers[0].FullName
}

switch ($Mode) {
  "Preflight" {
    Invoke-Preflight
  }
  "Sign" {
    if ([string]::IsNullOrWhiteSpace($Path)) {
      throw "-Path is required for Sign mode."
    }
    Invoke-Sign $Path
  }
  "Verify" {
    if ([string]::IsNullOrWhiteSpace($Path)) {
      throw "-Path is required for Verify mode."
    }
    Invoke-Verify $Path
  }
  "VerifyBundle" {
    if ([string]::IsNullOrWhiteSpace($Path)) {
      throw "-Path is required for VerifyBundle mode."
    }
    Invoke-VerifyBundle $Path
  }
}
