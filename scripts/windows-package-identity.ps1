param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Preflight", "Render", "PackUnsigned")]
  [string]$Mode,

  [Parameter(Mandatory = $false)]
  [string]$OutputDirectory = ".local/windows-package-identity"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$executableName = "letscube-windows-tauri.exe"
$minimumWindowsBuild = 19041
$requiredIdentityNames = @(
  "WINDOWS_PACKAGE_NAME",
  "WINDOWS_PACKAGE_PUBLISHER",
  "WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME",
  "WINDOWS_PACKAGE_APPLICATION_ID",
  "WINDOWS_PACKAGE_FAMILY_NAME",
  "WINDOWS_PACKAGE_VERSION",
  "WINDOWS_WNS_REMOTE_ID"
)

function Assert-RequiredIdentityValues {
  $missing = @(
    $requiredIdentityNames | Where-Object {
      [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
    }
  )
  if ($missing.Count -gt 0) {
    throw "Required Windows identity configuration is missing: $($missing -join ', ')"
  }
}

function Get-RequiredIdentityValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required Windows identity configuration is missing: $Name"
  }
  return $value.Trim()
}

function Assert-SafeXmlValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][int]$MaximumLength
  )

  if ($Value.Length -gt $MaximumLength -or $Value -match "[\x00-\x1F]") {
    throw "$Name is not valid Windows identity metadata."
  }
}

function Get-IdentityConfiguration {
  Assert-RequiredIdentityValues
  $packageName = Get-RequiredIdentityValue "WINDOWS_PACKAGE_NAME"
  $publisher = Get-RequiredIdentityValue "WINDOWS_PACKAGE_PUBLISHER"
  $publisherDisplayName = Get-RequiredIdentityValue "WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME"
  $applicationId = Get-RequiredIdentityValue "WINDOWS_PACKAGE_APPLICATION_ID"
  $packageFamilyName = Get-RequiredIdentityValue "WINDOWS_PACKAGE_FAMILY_NAME"
  $packageVersion = Get-RequiredIdentityValue "WINDOWS_PACKAGE_VERSION"
  $remoteIdValue = Get-RequiredIdentityValue "WINDOWS_WNS_REMOTE_ID"

  if ($packageName -notmatch "^[A-Za-z0-9.-]{3,50}$") {
    throw "WINDOWS_PACKAGE_NAME must contain only letters, numbers, periods or dashes."
  }
  if ($applicationId -notmatch "^[A-Za-z0-9.-]{1,64}$") {
    throw "WINDOWS_PACKAGE_APPLICATION_ID is not a valid manifest application id."
  }
  $expectedFamilyPattern = "^$([regex]::Escape($packageName))_[A-Za-z0-9]{13}$"
  if ($packageFamilyName -notmatch $expectedFamilyPattern) {
    throw "WINDOWS_PACKAGE_FAMILY_NAME must match the selected package name and Microsoft publisher id."
  }
  Assert-SafeXmlValue "WINDOWS_PACKAGE_PUBLISHER" $publisher 256
  Assert-SafeXmlValue "WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME" $publisherDisplayName 256

  $versionParts = $packageVersion.Split(".")
  if (
    $versionParts.Count -ne 4 -or
    @($versionParts | Where-Object { $_ -notmatch "^\d+$" -or [uint32]$_ -gt 65535 }).Count -gt 0
  ) {
    throw "WINDOWS_PACKAGE_VERSION must contain four numeric parts from 0 to 65535."
  }

  $remoteId = [Guid]::Empty
  if (-not [Guid]::TryParse($remoteIdValue, [ref]$remoteId) -or $remoteId -eq [Guid]::Empty) {
    throw "WINDOWS_WNS_REMOTE_ID must be a non-empty Microsoft Entra application GUID."
  }

  return @{
    ApplicationId = $applicationId
    PackageFamilyName = $packageFamilyName
    PackageName = $packageName
    PackageVersion = $packageVersion
    Publisher = $publisher
    PublisherDisplayName = $publisherDisplayName
    RemoteId = $remoteId.ToString()
  }
}

function Resolve-WindowsSdkTool {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitsRoot) {
    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Directory |
      Sort-Object Name -Descending |
      ForEach-Object {
        $toolPath = Join-Path $_.FullName "x64\$Name"
        if (Test-Path -LiteralPath $toolPath -PathType Leaf) {
          Get-Item -LiteralPath $toolPath
        }
      } |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw "$Name from the Windows SDK is required."
}

function Get-EscapedXmlValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  return [Security.SecurityElement]::Escape($Value)
}

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Invoke-Render {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Configuration,
    [Parameter(Mandatory = $true)][string]$TargetDirectory
  )

  $resolvedOutput = if ([IO.Path]::IsPathRooted($TargetDirectory)) {
    [IO.Path]::GetFullPath($TargetDirectory)
  } else {
    [IO.Path]::GetFullPath((Join-Path (Get-Location) $TargetDirectory))
  }
  [void](New-Item -ItemType Directory -Path $resolvedOutput -Force)

  $packageName = Get-EscapedXmlValue $Configuration.PackageName
  $publisher = Get-EscapedXmlValue $Configuration.Publisher
  $publisherDisplayName = Get-EscapedXmlValue $Configuration.PublisherDisplayName
  $applicationId = Get-EscapedXmlValue $Configuration.ApplicationId
  $packageVersion = Get-EscapedXmlValue $Configuration.PackageVersion

  $packageManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package IgnorableNamespaces="uap uap10"
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="$packageName" Publisher="$publisher" Version="$packageVersion" ProcessorArchitecture="neutral" />
  <Properties>
    <DisplayName>LETSCUBE</DisplayName>
    <PublisherDisplayName>$publisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
  </Properties>
  <Resources>
    <Resource Language="ru-ru" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>
  <Applications>
    <Application Id="$applicationId" Executable="$executableName" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">
      <uap:VisualElements AppListEntry="none" DisplayName="LETSCUBE" Description="LETSCUBE Messenger" BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
</Package>
"@

  $executableManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="0.0.0.0" name="LETSCUBE" />
  <msix xmlns="urn:schemas-microsoft-com:msix.v1"
    publisher="$publisher"
    packageName="$packageName"
    applicationId="$applicationId" />
</assembly>
"@

  $clientConfiguration = [ordered]@{
    applicationId = $Configuration.ApplicationId
    packageFamilyName = $Configuration.PackageFamilyName
    packageName = $Configuration.PackageName
    remoteId = $Configuration.RemoteId
  } | ConvertTo-Json

  Write-Utf8File (Join-Path $resolvedOutput "AppxManifest.xml") $packageManifest
  Write-Utf8File (Join-Path $resolvedOutput "$executableName.manifest") $executableManifest
  Write-Utf8File (Join-Path $resolvedOutput "wns-client-config.json") $clientConfiguration

  Write-Host "[Windows identity] Rendered public package metadata without printing identity values."
  return $resolvedOutput
}

function Invoke-Preflight {
  [void](Get-IdentityConfiguration)
  [void](Resolve-WindowsSdkTool "makeappx.exe")
  [void](Resolve-WindowsSdkTool "signtool.exe")

  $currentBuild = [Environment]::OSVersion.Version.Build
  if ($currentBuild -lt $minimumWindowsBuild) {
    throw "Sparse package identity requires Windows build $minimumWindowsBuild or newer."
  }

  $runtimePackages = @(Get-AppxPackage "Microsoft.WindowsAppRuntime*" -ErrorAction SilentlyContinue)
  if ($runtimePackages.Count -eq 0) {
    throw "Windows App Runtime is required before WNS client registration can be tested."
  }

  Write-Host "[Windows identity] SDK, runtime and public metadata prerequisites are available."
}

function Invoke-PackUnsigned {
  $configuration = Get-IdentityConfiguration
  $resolvedOutput = Invoke-Render $configuration $OutputDirectory
  $makeAppx = Resolve-WindowsSdkTool "makeappx.exe"
  $packagePath = "$resolvedOutput.unsigned.msix"
  $packageStage = Join-Path $resolvedOutput ".package-staging"

  [void](New-Item -ItemType Directory -Path $packageStage -Force)
  Copy-Item -LiteralPath (Join-Path $resolvedOutput "AppxManifest.xml") -Destination $packageStage
  try {
    & $makeAppx pack /o /d $packageStage /nv /p $packagePath | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
      throw "MakeAppx failed to build the unsigned identity package."
    }
  } finally {
    Remove-Item -LiteralPath $packageStage -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host "[Windows identity] Built an unsigned validation package. It is not deployable until production signing succeeds."
}

switch ($Mode) {
  "Preflight" {
    Invoke-Preflight
  }
  "Render" {
    $configuration = Get-IdentityConfiguration
    [void](Invoke-Render $configuration $OutputDirectory)
  }
  "PackUnsigned" {
    Invoke-PackUnsigned
  }
}
