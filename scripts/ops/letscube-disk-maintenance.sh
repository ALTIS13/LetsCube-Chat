#!/usr/bin/env bash
#
# Reclaim what regrows, and nothing else.
#
# Written 2026-09-05 after the root filesystem reached 86%. The cause was not
# user data: `docker system df` reported 21.92GB of build cache with zero of it
# in use, plus 10.33GB of images no container references. Clearing the cache
# alone took the disk from 86% to 68%.
#
# WHAT THIS DELIBERATELY DOES NOT TOUCH, and why each one matters:
#
#   backups      /srv/letscube/backups is 25GB, and it is the WORKING SET, not
#                rubbish: letscube-backup.sh already prunes past
#                LETSCUBE_BACKUP_RETENTION_DAYS (14), and nothing older than
#                that survives. Deleting a backup to free space is how a
#                restore fails later.
#   volumes      They hold data. `docker volume prune` is never run here.
#   containers   Coolify owns their lifecycle.
#   tagged
#   images       The previous release image is what a rollback needs. Only
#                DANGLING (untagged, unreferenced) layers are removed, which is
#                what `docker image prune` without `-a` means.
#   releases     /srv/letscube/releases is 794MB and is served to users. The
#                three 96MB Windows 0.1.x builds are the Electron era and are
#                probably retirable, but that is a product decision about what
#                remains downloadable, not maintenance.
#
# So this only removes things Docker will rebuild on demand, plus journal
# history past a cap.

set -Eeuo pipefail
umask 077

MODE="${1:-run}"
LOG_ROOT="/srv/letscube/logs/maintenance"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_ROOT/letscube-disk-maintenance-$STAMP.log"
LOCK="/run/letscube-disk-maintenance.lock"

# Keep a week of build cache: a deploy within that window still builds fast.
CACHE_KEEP_HOURS="${LETSCUBE_BUILD_CACHE_KEEP_HOURS:-168}"
# Above this, the week-old rule is not enough and the whole cache goes.
PRESSURE_PERCENT="${LETSCUBE_DISK_PRESSURE_PERCENT:-80}"
JOURNAL_CAP="${LETSCUBE_JOURNAL_CAP:-400M}"

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }
disk_percent() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
disk_line() { df -h / | tail -1 | awk '{print $3" used of "$2", "$5" full, "$4" free"}'; }

check() {
  command -v docker >/dev/null || { log "docker is not on PATH"; exit 1; }
  docker info >/dev/null 2>&1 || { log "docker is not answering"; exit 1; }
  install -d -m 700 "$LOG_ROOT"
  log "disk maintenance check ok"
}

run() {
  local before after freed pressure
  before="$(disk_percent)"
  log "before: $(disk_line)"

  # 1. Build cache. The big one, and it costs nothing but a slower next build.
  if [ "$before" -ge "$PRESSURE_PERCENT" ]; then
    log "disk at ${before}% (>= ${PRESSURE_PERCENT}%), clearing the whole build cache"
    docker builder prune --force 2>&1 | tail -1 | sed 's/^/  /'
  else
    log "clearing build cache older than ${CACHE_KEEP_HOURS}h"
    docker builder prune --force --filter "until=${CACHE_KEEP_HOURS}h" 2>&1 | tail -1 | sed 's/^/  /'
  fi

  # 2. Dangling layers only. No `-a`: a tagged image is somebody's rollback.
  log "removing dangling images"
  docker image prune --force 2>&1 | tail -1 | sed 's/^/  /'

  # 3. Journal history past the cap. Present logs are untouched.
  log "capping the journal at ${JOURNAL_CAP}"
  journalctl --vacuum-size="${JOURNAL_CAP}" 2>&1 | tail -1 | sed 's/^/  /'

  after="$(disk_percent)"
  freed=$((before - after))
  log "after: $(disk_line)"
  log "reclaimed ${freed} percentage points"

  # Say so loudly if the disk is still tight: that means the growth is in data
  # this script must not touch, and a person needs to look.
  if [ "$after" -ge 85 ]; then
    log "WARNING: still at ${after}% after maintenance. The growth is in data this"
    log "WARNING: script leaves alone — backups, volumes, releases or the database."
    log "WARNING: Look at: du -xh --max-depth=2 / | sort -rh | head"
  fi
}

exec 9>"$LOCK"
flock -n 9 || { echo "another disk maintenance run holds the lock"; exit 0; }

case "$MODE" in
  check) check ;;
  run)
    check
    install -d -m 700 "$LOG_ROOT"
    run 2>&1 | tee -a "$LOG"
    # Keep a season of our own logs, no more.
    find "$LOG_ROOT" -type f -name 'letscube-disk-maintenance-*.log' -mtime +90 -delete 2>/dev/null || true
    ;;
  *) echo "usage: $0 [check|run]" >&2; exit 64 ;;
esac
