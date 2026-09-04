# Disk maintenance

Installed 2026-09-05 after the root filesystem reached 86%.

## What was actually filling the disk

Measured before changing anything, because the obvious suspects were wrong:

| | size | verdict |
|---|---|---|
| Docker build cache | **21.92 GB** | garbage, none of it in use |
| Docker images not referenced by a container | 10.33 GB | reclaimable, but see below |
| `/srv/letscube/backups` | 25 GB | **working set, not garbage** |
| `/srv/letscube/offsite` | 4.5 GB | working set |
| `/var/log` (journal 702 MB) | 923 MB | capped now |
| `/srv/letscube/releases` | 794 MB | served to users |

Clearing the build cache alone took the disk from **86% to 68%** — 19 GB — with
all 53 containers still up and none unhealthy.

The 25 GB of backups looks like the biggest number and is the one thing that
must not be touched: `letscube-backup.sh` already prunes past
`LETSCUBE_BACKUP_RETENTION_DAYS` (14), and nothing older than that survives.
That 25 GB *is* the fourteen days. Deleting a backup to free space is how a
restore fails later.

## What runs

`scripts/ops/letscube-disk-maintenance.sh`, installed on the server at
`/srv/letscube/scripts/letscube-disk-maintenance.sh`, driven by
`letscube-disk-maintenance.timer` — weekly, Sunday 05:20 MSK with a 20-minute
jitter, deliberately clear of the 03:35 backup and the 04:52 offsite run.

Three steps, all of them things Docker or systemd will recreate on demand:

1. **Build cache.** Older than `LETSCUBE_BUILD_CACHE_KEEP_HOURS` (168h), so a
   deploy within the week still builds fast. Above
   `LETSCUBE_DISK_PRESSURE_PERCENT` (80%) it clears the lot instead.
2. **Dangling images only** — `docker image prune` without `-a`. A tagged image
   is somebody's rollback.
3. **Journal history** vacuumed to `LETSCUBE_JOURNAL_CAP` (400M). Present logs
   are untouched.

It takes a `flock`, logs to `/srv/letscube/logs/maintenance/`, and keeps ninety
days of its own logs. `... check` verifies Docker is answering and creates the
log directory without changing anything.

## What it deliberately leaves alone

- **Backups** — already rotated; see above.
- **Volumes** — they hold data. `docker volume prune` is never run.
- **Containers** — Coolify owns their lifecycle.
- **Tagged images** — needed for a rollback.
- **`/srv/letscube/releases`** — served to users. The three 96 MB Windows
  `0.1.x` builds are the Electron era and are probably retirable, but what stays
  downloadable is a product decision, not maintenance.

If the disk is still at 85% or more after a run, the script says so three times
in its log and names the command to run, because at that point the growth is in
data it is not allowed to touch and a person has to look.

## Verified on installation

- `check` passes.
- A real run executed all three steps and reported reclaiming nothing — correct,
  the cache had been cleared manually minutes earlier.
- The pressure branch was exercised by forcing the threshold to 1%: it took the
  clear-everything path.
- 53 containers up, 0 unhealthy, before and after.

## Still open, needing an owner decision

- **510 orphaned storage blobs, 762 MiB.** Versions of replaced media and
  avatars accumulated over the project's life, provably unreferenced (a
  name+version comparison against `storage.objects` returns zero live matches).
  Removing them needs the Storage API and `SELFHOST_SERVICE_ROLE_KEY`; deleting
  storage rows directly is refused by `storage.protect_delete()`, correctly.
- **Unused tagged images, 10.33 GB.** Reclaimable with `docker image prune -a`,
  at the cost of every rollback target that is not currently running.
