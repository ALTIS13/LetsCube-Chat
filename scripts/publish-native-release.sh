#!/usr/bin/env bash
set -euo pipefail

umask 022

usage() {
  cat >&2 <<EOF
Usage:
  $0 PLATFORM CHANNEL VERSION BUILD ARTIFACT [NOTES]
  $0 windows VERSION INSTALLER NOTES --channel stable|test \\
    --updater-artifact SIGNED_BUNDLE --signature-file SIGNATURE
EOF
  exit 64
}

fail() {
  printf 'release publish failed: %s\n' "$1" >&2
  exit 1
}

strict_semver() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
}

valid_download_channel() {
  [[ "$1" == "stable" ]]
}

valid_updater_channel() {
  [[ "$1" == "stable" || "$1" == "test" ]]
}

normalize_windows_path() {
  local value="$1"
  if command -v cygpath >/dev/null 2>&1 && [[ "$value" =~ ^[A-Za-z]:[\\/] ]]; then
    cygpath -u "$value"
  else
    printf '%s\n' "$value"
  fi
}

require_regular_file() {
  [[ -f "$1" && ! -L "$1" ]] || fail "$2 must be a regular file"
}

require_confined_path() {
  local path="$1"
  local label="$2"
  local lexical_path
  local resolved_path
  lexical_path="$(realpath -s -m -- "$path")"
  resolved_path="$(realpath -m -- "$path")"
  case "$lexical_path" in
    "$release_root"|"$release_root"/*) ;;
    *) fail "$label violates release root confinement" ;;
  esac
  [[ "$lexical_path" == "$resolved_path" ]] || fail "$label contains a symlinked path"
}

load_validated_signature() {
  local path="$1"
  require_regular_file "$path" "immutable updater signature"
  signature="$(tr -d '\r\n' < "$path")"
  [[ "$signature" =~ [^[:space:]] ]] || fail "updater signature must be non-empty"
  [[ ${#signature} -ge 16 && ${#signature} -le 8192 ]] \
    || fail "updater signature length is invalid"
}

find_json_writer() {
  local candidate
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "jq"
    return
  fi
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import json' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  fail "missing JSON writer: jq or Python"
}

acquire_publish_lock() {
  install -d -m 0755 "$release_root"
  require_confined_path "$release_root" "release root"
  lock_directory=""
  if command -v flock >/dev/null 2>&1; then
    require_confined_path "$release_root/.publish.lock" "publish lock path"
    exec 9>"$release_root/.publish.lock"
    flock -x 9
  else
    lock_directory="$release_root/.publish.lock.d"
    require_confined_path "$lock_directory" "publish lock path"
    mkdir "$lock_directory" 2>/dev/null || fail "another release publish is running"
  fi
}

release_publish_lock() {
  [[ -z "$lock_directory" ]] || rmdir -- "$lock_directory" 2>/dev/null || true
  lock_directory=""
}

write_download_manifest() {
  local output="$1"
  if [[ "$json_writer" == "jq" ]]; then
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
      }' > "$output"
    return
  fi

  PLATFORM="$platform" CHANNEL="$channel" VERSION="$version" BUILD="$build" \
    PUBLISHED_AT="$published_at" NOTES="$notes" PUBLIC_URL="$public_url" \
    ARTIFACT_SIZE="$size" ARTIFACT_SHA256="$sha256" \
    "$json_writer" - "$output" <<'PY'
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
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as output_file:
    json.dump(document, output_file, ensure_ascii=False, indent=2)
    output_file.write("\n")
PY
}

write_updater_manifest() {
  local output="$1"
  if [[ "$json_writer" == "jq" ]]; then
    jq -n \
      --arg version "$version" \
      --arg notes "$notes" \
      --arg pub_date "$published_at" \
      --arg signature "$signature" \
      --arg url "$updater_public_url" \
      --argjson size "$updater_size" \
      --arg sha256 "$updater_sha256" \
      '{
        version: $version,
        notes: $notes,
        pub_date: $pub_date,
        mandatory: false,
        minimumSupportedVersion: null,
        platforms: {
          "windows-x86_64": {
            signature: $signature,
            url: $url,
            size: $size,
            sha256: $sha256
          }
        }
      }' > "$output"
    return
  fi

  VERSION="$version" NOTES="$notes" PUBLISHED_AT="$published_at" \
    UPDATER_SIGNATURE="$signature" UPDATER_URL="$updater_public_url" \
    UPDATER_SIZE="$updater_size" UPDATER_SHA256="$updater_sha256" \
    "$json_writer" - "$output" <<'PY'
import json
import os
import sys

document = {
    "version": os.environ["VERSION"],
    "notes": os.environ["NOTES"],
    "pub_date": os.environ["PUBLISHED_AT"],
    "mandatory": False,
    "minimumSupportedVersion": None,
    "platforms": {
        "windows-x86_64": {
            "signature": os.environ["UPDATER_SIGNATURE"],
            "url": os.environ["UPDATER_URL"],
            "size": int(os.environ["UPDATER_SIZE"]),
            "sha256": os.environ["UPDATER_SHA256"],
        },
    },
}
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as output_file:
    json.dump(document, output_file, ensure_ascii=False, indent=2)
    output_file.write("\n")
PY
}

publish_download_catalog() {
  [[ $# -ge 5 && $# -le 6 ]] || usage
  platform="$1"
  channel="$2"
  version="$3"
  build="$4"
  artifact="$(normalize_windows_path "$5")"
  notes="${6:-}"

  case "$platform" in
    android) extension="apk" ;;
    windows) extension="exe" ;;
    *) fail "unsupported platform" ;;
  esac
  valid_download_channel "$channel" || fail "unsupported legacy channel"
  strict_semver "$version" || fail "version must be strict SemVer"
  [[ "$build" =~ ^(0|[1-9][0-9]*)$ ]] || fail "build must be a non-negative integer"
  require_regular_file "$artifact" "artifact"
  [[ "${artifact,,}" == *."$extension" ]] || fail "artifact extension must be .$extension"
  [[ ${#notes} -le 500 ]] || fail "notes exceed 500 characters"

  local files_root="$release_root/releases/files/$platform"
  local manifest_root="$release_root/releases/v1/$platform"
  local version_root="$files_root/$version"
  local manifest_path="$manifest_root/$channel.json"
  local filename="letscube-$version.$extension"
  public_url="https://api.letscube.ru/releases/files/$platform/$version/$filename"
  [[ "$public_url" == https://api.letscube.ru/releases/files/* ]] || fail "artifact URL must use HTTPS"

  require_confined_path "$files_root" "download files path"
  require_confined_path "$manifest_root" "download manifest path"
  require_confined_path "$version_root" "download version path"
  install -d -m 0755 "$files_root" "$manifest_root"
  require_confined_path "$files_root" "download files path"
  require_confined_path "$manifest_root" "download manifest path"
  acquire_publish_lock
  require_confined_path "$files_root" "download files path"
  require_confined_path "$manifest_root" "download manifest path"
  require_confined_path "$version_root" "download version path"
  require_regular_file "$artifact" "artifact"
  [[ ! -e "$version_root" ]] || fail "release version already exists"

  temp_root="$(mktemp -d "$files_root/.publish-$version.XXXXXX")"
  temp_manifest="$(mktemp "$manifest_root/.$channel.json.XXXXXX")"
  install -m 0644 "$artifact" "$temp_root/$filename"
  chmod 0755 "$temp_root"
  sha256="$(sha256sum "$temp_root/$filename" | awk '{print $1}')"
  size="$(stat -c '%s' "$temp_root/$filename")"
  published_at="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
  write_download_manifest "$temp_manifest"
  chmod 0644 "$temp_manifest"

  mv -- "$temp_root" "$version_root"
  temp_root=""
  mv -f -- "$temp_manifest" "$manifest_path"
  temp_manifest=""
  release_publish_lock

  printf 'Published %s %s %s build %s (%s bytes, sha256 %s)\n' \
    "$platform" "$channel" "$version" "$build" "$size" "$sha256"
}

publish_signed_updater() {
  [[ $# -ge 4 ]] || usage
  platform="$1"
  version="$2"
  installer="$(normalize_windows_path "$3")"
  notes="$4"
  shift 4

  channel=""
  updater_artifact=""
  signature_file=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --channel)
        [[ -z "$channel" && $# -ge 2 ]] || usage
        channel="$2"
        shift 2
        ;;
      --updater-artifact)
        [[ -z "$updater_artifact" && $# -ge 2 ]] || usage
        updater_artifact="$(normalize_windows_path "$2")"
        shift 2
        ;;
      --signature-file)
        [[ -z "$signature_file" && $# -ge 2 ]] || usage
        signature_file="$(normalize_windows_path "$2")"
        shift 2
        ;;
      *) usage ;;
    esac
  done

  [[ "$platform" == "windows" ]] || fail "signed updater supports windows only"
  valid_updater_channel "$channel" || fail "unsupported updater channel"
  strict_semver "$version" || fail "version must be strict SemVer"
  require_regular_file "$installer" "installer"
  [[ "${installer,,}" == *.exe ]] || fail "installer extension must be .exe"
  require_regular_file "$updater_artifact" "updater artifact"
  [[ "${updater_artifact,,}" == *.exe ]] || fail "updater artifact extension must be .exe"
  require_regular_file "$signature_file" "signature file"
  cmp -s -- "$installer" "$updater_artifact" \
    || fail "installer and updater artifact must contain identical bytes"
  [[ ${#notes} -le 500 ]] || fail "notes exceed 500 characters"

  local updater_files_root="$release_root/releases/updater/files/windows"
  local updater_version_root="$updater_files_root/$version"
  local updater_manifest_root="$release_root/releases/updater/v1/windows"
  local updater_filename="letscube-$version-setup.exe"
  local updater_signature_filename="$updater_filename.sig"
  local updater_target="$updater_version_root/$updater_filename"
  local updater_signature_target="$updater_version_root/$updater_signature_filename"
  updater_manifest_path="$updater_manifest_root/$channel.json"
  updater_public_url="https://api.letscube.ru/releases/updater/files/windows/$version/$updater_filename"
  [[ "$updater_public_url" == "https://api.letscube.ru/releases/updater/files/windows/$version/$updater_filename" ]] \
    || fail "updater artifact URL must use the exact immutable HTTPS path"

  require_confined_path "$updater_files_root" "updater files path"
  require_confined_path "$updater_manifest_root" "updater manifest path"
  require_confined_path "$updater_version_root" "updater version path"
  install -d -m 0755 "$updater_files_root" "$updater_manifest_root"
  require_confined_path "$updater_files_root" "updater files path"
  require_confined_path "$updater_manifest_root" "updater manifest path"
  acquire_publish_lock
  require_confined_path "$updater_files_root" "updater files path"
  require_confined_path "$updater_manifest_root" "updater manifest path"
  require_confined_path "$updater_version_root" "updater version path"
  require_regular_file "$updater_artifact" "updater artifact"
  require_regular_file "$signature_file" "signature file"

  if [[ -e "$updater_version_root" ]]; then
    require_regular_file "$updater_target" "immutable updater artifact"
    require_regular_file "$updater_signature_target" "immutable updater signature"
    cmp -s -- "$updater_artifact" "$updater_target" \
      || fail "immutable updater artifact already exists with different content"
    cmp -s -- "$signature_file" "$updater_signature_target" \
      || fail "immutable updater signature already exists with different content"
    load_validated_signature "$updater_signature_target"
  else
    temp_updater_root="$(mktemp -d "$updater_files_root/.publish-$version.XXXXXX")"
    require_confined_path "$temp_updater_root" "temporary updater path"
    install -m 0644 "$updater_artifact" "$temp_updater_root/$updater_filename"
    install -m 0644 "$signature_file" "$temp_updater_root/$updater_signature_filename"
    load_validated_signature "$temp_updater_root/$updater_signature_filename"
    chmod 0755 "$temp_updater_root"
    require_confined_path "$updater_version_root" "updater version path"
    mv -- "$temp_updater_root" "$updater_version_root"
    temp_updater_root=""
    require_confined_path "$updater_version_root" "updater version path"
    load_validated_signature "$updater_signature_target"
  fi

  updater_sha256="$(sha256sum "$updater_target" | awk '{print $1}')"
  updater_size="$(stat -c '%s' "$updater_target")"
  published_at="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
  temp_updater_manifest="$(mktemp "$updater_manifest_root/.$channel.json.XXXXXX")"
  write_updater_manifest "$temp_updater_manifest"
  chmod 0644 "$temp_updater_manifest"
  mv -f -- "$temp_updater_manifest" "$updater_manifest_path"
  temp_updater_manifest=""
  release_publish_lock

  printf 'Published signed Windows updater %s %s (%s bytes, sha256 %s)\n' \
    "$channel" "$version" "$updater_size" "$updater_sha256"
}

release_root="$(normalize_windows_path "${RELEASE_ROOT:-/srv/letscube/releases/public}")"
command -v realpath >/dev/null 2>&1 || fail "missing command: realpath"
release_root_lexical="$(realpath -s -m -- "$release_root")"
release_root_resolved="$(realpath -m -- "$release_root")"
[[ "$release_root_lexical" == "$release_root_resolved" ]] \
  || fail "release root contains a symlinked path"
release_root="$release_root_lexical"
for command_name in sha256sum stat install mktemp awk cmp tr realpath; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: $command_name"
done
json_writer="$(find_json_writer)"

lock_directory=""
temp_root=""
temp_manifest=""
temp_updater_root=""
temp_updater_manifest=""
cleanup() {
  [[ -z "$temp_root" ]] || rm -rf -- "$temp_root" 2>/dev/null || true
  [[ -z "$temp_manifest" ]] || rm -f -- "$temp_manifest" 2>/dev/null || true
  [[ -z "$temp_updater_root" ]] || rm -rf -- "$temp_updater_root" 2>/dev/null || true
  [[ -z "$temp_updater_manifest" ]] || rm -f -- "$temp_updater_manifest" 2>/dev/null || true
  release_publish_lock
}
trap cleanup EXIT

if [[ $# -ge 2 && ( "$2" == "stable" || "$2" == "test" ) ]]; then
  publish_download_catalog "$@"
else
  publish_signed_updater "$@"
fi

trap - EXIT
