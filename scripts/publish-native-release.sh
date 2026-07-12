#!/usr/bin/env bash
set -euo pipefail

umask 022

usage() {
  printf 'Usage: %s PLATFORM CHANNEL VERSION BUILD ARTIFACT [NOTES]\n' "$0" >&2
  exit 64
}

fail() {
  printf 'release publish failed: %s\n' "$1" >&2
  exit 1
}

[[ $# -ge 5 && $# -le 6 ]] || usage

platform="$1"
channel="$2"
version="$3"
build="$4"
artifact="$5"
notes="${6:-}"
release_root="${RELEASE_ROOT:-/srv/letscube/releases/public}"

if command -v cygpath >/dev/null 2>&1; then
  [[ "$artifact" =~ ^[A-Za-z]:[\\/] ]] && artifact="$(cygpath -u "$artifact")"
  [[ "$release_root" =~ ^[A-Za-z]:[\\/] ]] && release_root="$(cygpath -u "$release_root")"
fi

case "$platform" in
  android) extension="apk" ;;
  windows) extension="exe" ;;
  *) fail "unsupported platform" ;;
esac

[[ "$channel" == "stable" ]] || fail "unsupported channel"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
  || fail "version must be strict SemVer"
[[ "$build" =~ ^(0|[1-9][0-9]*)$ ]] || fail "build must be a non-negative integer"
[[ -f "$artifact" && ! -L "$artifact" ]] || fail "artifact must be a regular file"
[[ "${artifact,,}" == *."$extension" ]] || fail "artifact extension must be .$extension"
[[ ${#notes} -le 500 ]] || fail "notes exceed 500 characters"

for command_name in sha256sum stat install mktemp awk; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: $command_name"
done

files_root="$release_root/releases/files/$platform"
manifest_root="$release_root/releases/v1/$platform"
version_root="$files_root/$version"
manifest_path="$manifest_root/$channel.json"
filename="letscube-$version.$extension"
public_url="https://api.letscube.ru/releases/files/$platform/$version/$filename"

install -d -m 0755 "$files_root" "$manifest_root"
lock_directory=""
if command -v flock >/dev/null 2>&1; then
  exec 9>"$release_root/.publish.lock"
  flock -x 9
else
  lock_directory="$release_root/.publish.lock.d"
  mkdir "$lock_directory" 2>/dev/null || fail "another release publish is running"
fi

temp_root=""
temp_manifest=""
cleanup() {
  [[ -z "$temp_root" ]] || rm -rf -- "$temp_root" 2>/dev/null || true
  [[ -z "$temp_manifest" ]] || rm -f -- "$temp_manifest" 2>/dev/null || true
  [[ -z "$lock_directory" ]] || rmdir -- "$lock_directory" 2>/dev/null || true
}
trap cleanup EXIT

[[ ! -e "$version_root" ]] || fail "release version already exists"

temp_root="$(mktemp -d "$files_root/.publish-$version.XXXXXX")"
temp_manifest="$(mktemp "$manifest_root/.$channel.json.XXXXXX")"

install -m 0644 "$artifact" "$temp_root/$filename"
chmod 0755 "$temp_root"
sha256="$(sha256sum "$temp_root/$filename" | awk '{print $1}')"
size="$(stat -c '%s' "$temp_root/$filename")"
published_at="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"

if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg platform "$platform" \
    --arg channel "$channel" \
    --arg version "$version" \
    --argjson build "$build" \
    --arg publishedAt "$published_at" \
    --arg notes "$notes" \
    --arg url "$public_url" \
    --argjson size "$size" \
    --arg sha256 "$sha256" \
    '{
      schemaVersion: 1,
      platform: $platform,
      channel: $channel,
      available: true,
      version: $version,
      build: $build,
      publishedAt: $publishedAt,
      minimumSupportedVersion: null,
      mandatory: false,
      notes: $notes,
      artifact: {url: $url, size: $size, sha256: $sha256}
    }' > "$temp_manifest"
else
  python_command=""
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import json' >/dev/null 2>&1; then
      python_command="$candidate"
      break
    fi
  done
  [[ -n "$python_command" ]] || fail "missing JSON writer: jq or Python"
  PLATFORM="$platform" CHANNEL="$channel" VERSION="$version" BUILD="$build" \
    PUBLISHED_AT="$published_at" NOTES="$notes" PUBLIC_URL="$public_url" \
    ARTIFACT_SIZE="$size" ARTIFACT_SHA256="$sha256" \
    "$python_command" - "$temp_manifest" <<'PY'
import json
import os
import sys

document = {
    "schemaVersion": 1,
    "platform": os.environ["PLATFORM"],
    "channel": os.environ["CHANNEL"],
    "available": True,
    "version": os.environ["VERSION"],
    "build": int(os.environ["BUILD"]),
    "publishedAt": os.environ["PUBLISHED_AT"],
    "minimumSupportedVersion": None,
    "mandatory": False,
    "notes": os.environ["NOTES"],
    "artifact": {
        "url": os.environ["PUBLIC_URL"],
        "size": int(os.environ["ARTIFACT_SIZE"]),
        "sha256": os.environ["ARTIFACT_SHA256"],
    },
}
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as output:
    json.dump(document, output, ensure_ascii=False, indent=2)
    output.write("\n")
PY
fi
chmod 0644 "$temp_manifest"

mv -- "$temp_root" "$version_root"
temp_root=""
mv -f -- "$temp_manifest" "$manifest_path"
temp_manifest=""
[[ -z "$lock_directory" ]] || rmdir -- "$lock_directory"
lock_directory=""
trap - EXIT

printf 'Published %s %s %s build %s (%s bytes, sha256 %s)\n' \
  "$platform" "$channel" "$version" "$build" "$size" "$sha256"
