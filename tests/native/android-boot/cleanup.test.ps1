$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cleanup.ps1')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$out = Join-Path $repo 'output/native-boot-android'
$run = Join-Path $out ('run-20990101-000000-' + [guid]::NewGuid().ToString('N').Substring(0,6))
$avdName = 'D298_QA_' + ($run -split '-')[-1]
$avd = Join-Path $run 'avd'
New-Item -ItemType Directory -Force -Path $avd | Out-Null
[IO.File]::WriteAllText((Join-Path $avd 'synthetic-test-data'), 'fixture')
[IO.File]::WriteAllText((Join-Path $run 'report.json'), '{"fixture":true}')
function Expect-Rejected([string]$Path, [string]$Reason) {
    try { Remove-OwnedBootAvd -RunDirectory $Path } catch {
        if ($_.Exception.Message -notlike "*$Reason*") { throw }
        return
    }
    throw 'Unsafe cleanup was not rejected'
}
Expect-Rejected $repo 'outside an exact owned'
Expect-Rejected (Join-Path $out '../run-20990101-000000-aaaaaa') 'outside an exact owned'
[IO.File]::WriteAllText((Join-Path $run 'launch.json'), '{"avd":"NOT_OWNED","arguments":["-avd","NOT_OWNED","-port","5584"]}')
Expect-Rejected $run 'ownership receipt'
if (-not (Test-Path -LiteralPath (Join-Path $avd 'synthetic-test-data'))) { throw 'Rejected cleanup touched data' }
[IO.File]::WriteAllText((Join-Path $run 'launch.json'), (@{ avd=$avdName; arguments=@('-avd',$avdName,'-port','5584') } | ConvertTo-Json))
Remove-OwnedBootAvd -RunDirectory $run
if (Test-Path -LiteralPath $avd) { throw 'Owned data was not removed' }
if (-not (Test-Path -LiteralPath (Join-Path $run 'report.json'))) { throw 'Cleanup removed report' }
Remove-OwnedBootAvd -RunDirectory $run
Write-Output 'cleanup_tests=5_passed (repo refusal, parent escape refusal, foreign receipt refusal, data-only removal, idempotence)'
