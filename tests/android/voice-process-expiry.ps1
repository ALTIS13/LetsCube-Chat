param(
    [string]$Adb = 'D:\Progi\AndroidStudio-sdk\platform-tools\adb.exe',
    [string]$Serial = 'emulator-5580'
)
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-\d+$') { throw 'Only an explicitly selected emulator is allowed' }
$fingerprint = & $Adb -s $Serial shell getprop ro.build.fingerprint
if ($LASTEXITCODE -ne 0 -or $fingerprint -notlike 'google/sdk_gphone*') { throw 'Unexpected emulator fingerprint' }
$offline = & $Adb -s $Serial shell settings get global airplane_mode_on
if ($offline.Trim() -ne '1') { throw 'This fixture requires the network-disabled emulator' }

function Invoke-Probe([string]$Phase) {
    $result = & $Adb -s $Serial shell am instrument -w -r -e class com.kub.messenger.VoiceCallProcessExpiryTest -e voiceExpiryPhase $Phase com.kub.messenger.test/androidx.test.runner.AndroidJUnitRunner
    if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -notmatch 'OK \(1 test\)') { throw "Instrumentation phase failed: $Phase" }
    Write-Output "expiry_phase_${Phase}=passed"
}

Invoke-Probe 'publish'
# Kill only this offline fixture's app process. No force-stop, which would cancel cards itself.
& $Adb -s $Serial shell am kill com.kub.messenger
if ($LASTEXITCODE -ne 0) { throw 'Could not request the owned fixture process to stop' }
$pidValue = (& $Adb -s $Serial shell pidof com.kub.messenger) -join ''
if ($pidValue.Trim()) { throw 'Process is still alive; timeout evidence would be invalid' }
$dump = (& $Adb -s $Serial shell dumpsys notification --noredact) -join "`n"
if ($dump -notmatch 'NotificationRecord\([^\r\n]*pkg=com\.kub\.messenger[^\r\n]*tag=letscube\.voice:') { throw 'Positive control failed: no card survived process exit' }
Write-Output 'process_absent_and_card_still_present=true'
Start-Sleep -Seconds 9
$pidValue = (& $Adb -s $Serial shell pidof com.kub.messenger) -join ''
if ($pidValue.Trim()) { throw 'Process restarted during the timeout interval' }
Invoke-Probe 'verify'
Write-Output 'os_timeout_after_process_exit=passed'
