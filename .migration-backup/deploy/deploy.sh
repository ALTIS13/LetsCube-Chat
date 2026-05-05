#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Pulls latest code, installs deps, builds Next.js, restarts pm2 services.
# Triggered by webhook.js on every push to main, OR run manually:
#   sudo -u deploy bash /var/www/neogram/deploy/deploy.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/var/www/neogram"
LOG_DIR="/var/log/neogram"
LOCK="/tmp/neogram-deploy.lock"

# Cap Node heap during install + build so the 1 GB VPS doesn't get OOM-killed.
# 512 MB old-space is plenty for `next build` of this app and leaves headroom
# for pm2-web (~70 MB) + pm2-bot (~30 MB) + nginx + system. Combined with the
# 4 GB swap configured on the host, this keeps the box stable.
export NODE_OPTIONS="--max-old-space-size=512"

# Give npm a writable cache directory.  The webhook.service unit hardens with
# ProtectHome=read-only, which makes /home/deploy/.npm (npm's default cache)
# unwritable.  /tmp is writable thanks to PrivateTmp=true on the unit.
export npm_config_cache="${TMPDIR:-/tmp}/npm-cache"
mkdir -p "$npm_config_cache"

# Single-flight: never run two deploys at once.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "deploy already in progress, exiting"
  exit 0
fi

mkdir -p "$LOG_DIR"

cd "$APP_DIR"

echo "▶ git fetch + reset"
git fetch --prune origin
git reset --hard origin/main

# After git reset our own file may have changed on disk, but bash already
# loaded the old version into memory.  Re-exec into the freshly pulled copy
# so the rest of the deploy uses the current logic, not stale instructions.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  export DEPLOY_REEXEC=1
  echo "▶ re-exec deploy.sh from updated source"
  exec bash "$0" "$@"
fi

echo "▶ npm ci (web)"
# `--omit=dev` keeps the prod image lean; if you need devDeps for build, switch to npm ci then npm prune --production after build.
npm ci --no-audit --no-fund

echo "▶ next build"
NODE_ENV=production npm run build

echo "▶ npm ci (bot)"
( cd bot && npm ci --no-audit --no-fund --omit=dev )

echo "▶ npm install (push-worker)"
# Use `install` instead of `ci`: the worker doesn't ship with a lockfile yet
# (the dev sandbox can't reach the npm registry to generate one) — `install`
# creates it on first run and re-uses it afterwards.
( cd push-worker && npm install --no-audit --no-fund --omit=dev )

echo "▶ pm2 reload"
# startOrReload on first run starts processes, on subsequent runs does zero-downtime reload.
# Note: the manifest is .cjs because deploy/package.json declares "type": "module"
# (so node treats webhook.js as ESM); pm2's manifest still uses CommonJS module.exports.
pm2 startOrReload "$APP_DIR/deploy/ecosystem.config.cjs" --update-env

echo "✅ deploy finished at $(date -Iseconds)"
