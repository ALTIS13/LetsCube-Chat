# Backup monitoring: bounded Task 11 preparation

## State and evidence

Source/test preparation only; **not installed, scheduled or delivery-tested**.
No production commands, backup, sync, restore or alert sends were run for this
slice. The five completion/handover documents belong to the coordinator.

The accepted read-only inventory was captured on **2026-10-18 at 16:01 UTC**
(host monitoring supplement 16:02 UTC). Its ignored receipt is
`.ops-private/sealed-recovery-20261018/backup-operations-inventory.json`, SHA256
`e61251794f8656fee94f681bcb984263d83962ce5e601510ca52625e74026ed4`.
These are dated observations, not a fresh health check:

| Job | Installed source SHA256 | Schedule MSK / jitter | Last successful completion UTC |
| --- | --- | --- | --- |
| `letscube-backup.service` | `105e0d20edb46399209be0f4b3c8759d53be42249550a8abdbaca92e92ea978f` | 03:35 daily / 30 min | 2026-10-18 00:42:40.465945 |
| `letscube-github-offsite-backup.service` | `116eae7fff8b7faf3149f93e17884e3c3a98763d1a1f85e214d81ed9f57cfd71` | 04:45 daily / 45 min | 2026-10-18 02:09:40.840780 |

Both timers were active/persistent. Both oneshots were `inactive/dead`,
`Result=success`, `ExecMainCode=1`, `ExecMainStatus=0`: this is successful
completion, not a down daemon. The 30-day structured journal projection found
19 successful completions and zero failures per job; that is not lifetime
failure history. Both `OnFailure`/`OnSuccess` properties were empty.

The local producer is `/srv/letscube/scripts/letscube-backup.sh`; the offsite
producer is `/srv/letscube/scripts/letscube-github-offsite-backup.sh`.
No maintained repo copies were found by filename/content search, so neither is
patched here. The reference source below stays in this authorized document;
it does not import a host helper or live capability.

Existing metadata paths are `/srv/letscube/backups/automated`,
`/srv/letscube/logs/backups` and
`/srv/letscube/offsite/github-backups-worktree`. No machine-readable per-job
STATUS JSON was verified. Log/archive contents and env overrides were not read.
The local retention default is 14 days (18 directories observed), not a verified
effective retention setting.

GitHub encrypted offsite already exists: 25 age-encrypted chunks, local commit
`7dc1006ff39d218e6ab9187f141c7d7877989d40`, one locally reachable commit. A
separate strict-host-key remote-ref check returned `HOST_KEY_REFUSED`, so
independent remote custody/history retention remains unknown. **Do not change
SSH trust or interpret this refusal as absence of the offsite job.** The
[older runbook](../infra/BACKUP_RESTORE_RUNBOOK.md) describes both offsite paths;
its disabled generic-offsite path is not the active GitHub job.

## Minimal observation contract

Reuse the two exact jobs, their source pins above, and existing structured
systemd/journal metadata. No SQL, Docker exec, credentials, environment values,
log bodies, archive reads, dump verification or Git push is needed for STATUS.

The future collector must allowlist only:

- `systemctl show` of those exact services: `ActiveState`, `SubState`, `Result`,
  `ExecMainCode`, `ExecMainStatus`; timers: `ActiveState`, last trigger and next
  elapse metadata. Never use `systemctl status` (it includes log messages).
- The existing 30-day journal projection: timestamp, exact unit and structured
  job result only; no `MESSAGE`, exception, command line or stderr text. Record
  the latest proven success/failure separately. Incomplete/denied history is
  UNKNOWN, never zero failures. Timestamp conversion uses numeric journal
  microseconds, not locale-dependent `MSK` display strings.
- Exact producer file hash and observation UTC. Pin drift, missing units,
  partial reads and collection failures produce UNKNOWN with a constant reason;
  never run a producer's `check`, `run` or `sync-latest` to obtain STATUS.

Below is a small, pure Python 3 reference assessor. Input is the collector's
complete allowlisted projection, with UTC Unix seconds as integers and null for
no observed success/failure. `run` is normalized by `systemd_run` below. Unknown
or incomplete history must be passed as invalid input, not invented timestamps.
Output is whitelist-only; raw input strings/exceptions are never echoed.

The proposed polling interval is 5 minutes and observation TTL is 900 seconds,
allowing polling jitter without accepting indefinitely frozen receipts.
The **proposed** stale-success threshold is 26 hours: daily schedule plus up to
45 minutes jitter, 60 minutes runtime allowance and 15 minutes observation slack.
Runtime allowance is policy, not measured worst-case backup duration or RPO.

```python
PINS = {
    "local": "105e0d20edb46399209be0f4b3c8759d53be42249550a8abdbaca92e92ea978f",
    "offsite": "116eae7fff8b7faf3149f93e17884e3c3a98763d1a1f85e214d81ed9f57cfd71",
}

def systemd_run(service):
    active, sub = service.get("ActiveState"), service.get("SubState")
    result = service.get("Result")
    code, status = service.get("ExecMainCode"), service.get("ExecMainStatus")
    if active in ("activating", "deactivating") or (active, sub) == ("active", "running"):
        return "RUNNING"
    if active == "failed" or (isinstance(result, str) and result not in ("", "success")):
        return "FAILED"
    if (active, sub, result, code, status) == ("inactive", "dead", "success", "1", "0"):
        return "SUCCESS"
    return "UNKNOWN"

def assess(job, sample, now):
    base = {"job": job if job in PINS else "unknown", "status": "UNKNOWN"}
    keys = {"sha256", "collectedAt", "lastSuccessAt", "lastFailureAt", "timerActive", "run"}
    if type(now) is not int or now < 0 or not isinstance(sample, dict) or set(sample) != keys:
        return dict(base, reason="INVALID_METADATA")
    if job not in PINS or sample["sha256"] != PINS[job]:
        return dict(base, reason="SOURCE_DRIFT")
    observed, success, failure = (sample[k] for k in ("collectedAt", "lastSuccessAt", "lastFailureAt"))
    if type(observed) is not int or not 0 <= observed <= now:
        return dict(base, reason="INVALID_TIME")
    if any(v is not None and (type(v) is not int or not 0 <= v <= observed) for v in (success, failure)):
        return dict(base, reason="INVALID_TIME")
    if type(sample["timerActive"]) is not bool or sample["run"] not in ("SUCCESS", "FAILED", "RUNNING", "UNKNOWN"):
        return dict(base, reason="INVALID_METADATA")
    if now - observed > 900:
        return dict(base, reason="OBSERVATION_EXPIRED")
    age = None if success is None else now - success
    if sample["run"] == "FAILED" or (failure is not None and (success is None or failure >= success)):
        state = "FAILED"
    elif age is not None and age >= 93600:
        state = "STALE"
    elif success is None or sample["run"] == "UNKNOWN":
        state = "UNKNOWN"
    elif not sample["timerActive"]:
        state = "TIMER_OFF"
    elif sample["run"] == "RUNNING":
        state = "RUNNING"
    else:
        state = "RECENT_SUCCESS"
    return dict(base, status=state, collectedAt=observed, lastSuccessAt=success,
                lastFailureAt=failure, successAgeSeconds=age, timerActive=sample["timerActive"])
```

The operator sees only job alias, status, collection time, success/failure times,
age and timer activity. `RECENT_SUCCESS` means a recent **job exit**, not a
verified recoverable backup. RUNNING does not clear an older failure or stale
success; a later proven success does clear the active failure while retaining
`lastFailureAt` (equal-second success/failure ties remain FAILED). A stale
observation is UNKNOWN even if its stored job was OK.

At the inventory capture time both recorded jobs satisfy RECENT_SUCCESS.
This is a replay of dated metadata, not current live STATUS. Keep these separate
receipt fields: `backupCapturePhase=UNKNOWN`,
`remoteCustody=NOT_INDEPENDENTLY_VERIFIED`, `alertDelivery=NOT_VERIFIED`.
Directory mtime, local Git commit and job exit do not substitute for them.

## Focused controls

Execute the source block then this block locally in one Python namespace. No
files, host commands or network are needed. These controls validate the assessor,
not the installed producers or the future collector/notification delivery.

```python
import json

def controls():
    now = 200000
    def sample():
        return dict(sha256="105e0d20edb46399209be0f4b3c8759d53be42249550a8abdbaca92e92ea978f",
                    collectedAt=now, lastSuccessAt=now - 100,
                    lastFailureAt=None, timerActive=True, run="SUCCESS")
    def check(expected, **delta):
        value = sample()
        value.update(delta)
        assert assess("local", value, now)["status"] == expected
    terminal = {"ActiveState": "inactive", "SubState": "dead", "Result": "success",
                "ExecMainCode": "1", "ExecMainStatus": "0"}
    assert systemd_run(terminal) == "SUCCESS"
    assert systemd_run(dict(terminal, ExecMainCode="2")) == "UNKNOWN"
    assert systemd_run(dict(terminal, Result="signal", ExecMainCode="2", ExecMainStatus="15")) == "FAILED"
    assert systemd_run(dict(terminal, ActiveState="failed", Result="exit-code", ExecMainStatus="1")) == "FAILED"
    assert systemd_run({}) == "UNKNOWN"
    check("RECENT_SUCCESS")
    check("FAILED", run="FAILED")
    check("FAILED", lastFailureAt=now - 1)
    check("RECENT_SUCCESS", lastFailureAt=now - 101)
    check("STALE", lastSuccessAt=now - 93600)
    check("RECENT_SUCCESS", lastSuccessAt=now - 93599)
    check("STALE", lastSuccessAt=now - 93600, run="RUNNING")
    check("FAILED", run="RUNNING", lastFailureAt=now - 1)
    check("RUNNING", run="RUNNING")
    check("TIMER_OFF", timerActive=False)
    check("UNKNOWN", lastSuccessAt=None)
    check("UNKNOWN", run="UNKNOWN")
    check("UNKNOWN", collectedAt=now - 901, lastSuccessAt=now - 1000)
    check("RECENT_SUCCESS", collectedAt=now - 900, lastSuccessAt=now - 1000)
    check("UNKNOWN", lastSuccessAt=now + 1)
    check("UNKNOWN", collectedAt=now + 1)
    check("UNKNOWN", sha256="0" * 64)
    check("UNKNOWN", timerActive=1)
    bad = sample()
    bad["stderr"] = "PRIVATE_SENTINEL"
    result = assess("local", bad, now)
    assert result == {"job": "local", "status": "UNKNOWN", "reason": "INVALID_METADATA"}
    assert "PRIVATE_SENTINEL" not in json.dumps(result)
    offsite = sample()
    offsite["sha256"] = "116eae7fff8b7faf3149f93e17884e3c3a98763d1a1f85e214d81ed9f57cfd71"
    assert assess("offsite", offsite, now)["status"] == "RECENT_SUCCESS"

controls()
```

Literal omission controls must also reject mutants that remove source-pin,
observation-TTL, recent-failure or stale-success checks. No host failure was
injected; local source controls cannot be labelled a real failure-alert canary.

Local PowerShell invocation (Python already installed; no installs/file writes):

```powershell
$doc = Get-Content -Raw -LiteralPath docs/operations/2026-10-18-backup-monitoring.md
$blocks = [regex]::Matches($doc, '(?s)```python\r?\n(.*?)\r?\n```')
if ($blocks.Count -ne 2) { throw 'SOURCE_BLOCK_COUNT' }
$program = $blocks[0].Groups[1].Value + "`n" + $blocks[1].Groups[1].Value
$program | python -I -B -
if ($LASTEXITCODE -ne 0) { throw 'LOCAL_CONTROLS_FAILED' }
Write-Output 'LOCAL_SOURCE_CONTROLS_PASS'
```

Verified locally: 25 cases; four literal guard-omission mutants rejected; dated
inventory replay passes for both jobs. No installed collector, status-file write
or real alert delivery is covered by these checks.

## Failure path and next reversible step

All six discovered Coolify channels were **disabled**, with zero notification
events. Stored `backupFailureFlag=true` / `serverUnreachableFlag=true` are not
delivery evidence. No owner admin recipient was proved. Do not borrow a product
chat, expose a server key or call the current alert route PASS.

The usable **manual** path is an authorized operator's SSH metadata observation
of systemd/journal, independent of the application DB and Coolify DB. It requires
the host/SSH to be reachable. An installed observer would emit only the receipt
above, exit 0 for RECENT_SUCCESS/RUNNING, 1 for FAILED/STALE/TIMER_OFF, 2 for
UNKNOWN/collection error; stderr contains only a constant error class. This is
not implemented alert transport and cannot detect complete host loss by itself.

Next reversible implementation is one DB-independent read-only collector using
the exact allowlist above, leaving producer commands/timers unchanged. After
review it can atomically publish root-owned mode-0600 JSON beneath the existing
root-controlled backup log directory (proposed filenames
`letscube-backup.status.json` and `letscube-github-offsite-backup.status.json`;
not existing verified files). No raw logs or config enter the receipt. Preserve
last success on failure; a fresh FAILED/UNKNOWN receipt must replace a stale OK
receipt. A consumer must check collection age, not JSON-file mtime alone.
Actual installation/scheduling is outside this slice.

External failure/stale-age delivery remains **unconfigured/unverified** until an
existing owner admin destination is identified and its independent no-DB route
has a controlled failure/recovery delivery receipt. No provider purchase is a
prerequisite. Verify offsite push/ref acknowledgement in the existing job's own
credential context only in a separately authorized step; keep strict host-key
checks. Do not rerun backup/sync merely to populate monitoring.

Current backup/offsite cadence is roughly daily; actual capture phase and a
numeric guaranteed RPO are unmeasured. Automated backups are not yet proved to
bundle the accepted sealed-only R3 supplements/tools. The accepted
[D342 package restore](2026-10-18-production-completion.md) subboundary remains
accepted without replay; this STATUS design does **not** close external custody,
offsite retention, whole-host outage notification or D342 as a whole.
