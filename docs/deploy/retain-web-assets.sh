#!/bin/sh
set -eu

# The nginx image serves /assets directly. A Coolify volume mounted there keeps
# immutable files from previous releases available to already-open clients.
if [ "$#" -eq 0 ]; then
  source_dir=/opt/letscube/release-assets
  target_dir=/usr/share/nginx/html/assets
  if ! awk -v target="$target_dir" '$5 == target { found = 1 } END { exit !found }' /proc/self/mountinfo; then
    if [ "${LETSCUBE_REQUIRE_ASSET_VOLUME:-0}" = "1" ]; then
      echo "LETSCUBE asset volume is required but not mounted" >&2
      exit 1
    fi
    exit 0
  fi
elif [ "$#" -eq 2 ]; then
  source_dir=$1
  target_dir=$2
else
  echo "usage: retain-web-assets.sh [source_dir target_dir]" >&2
  exit 2
fi

test -d "$source_dir"
test -d "$target_dir"

find "$source_dir" -type f -exec sh -eu -c '
  source_dir=$1
  target_dir=$2
  shift 2
  temporary=
  trap '\''test -z "$temporary" || rm -f "$temporary"'\'' 0
  for source_file do
    relative=${source_file#"$source_dir"/}
    if [ -L "$target_dir" ]; then
      echo "asset symlink: target directory" >&2
      exit 1
    fi
    parent=$target_dir
    remaining=$relative
    while [ "${remaining#*/}" != "$remaining" ]; do
      parent="$parent/${remaining%%/*}"
      if [ -L "$parent" ]; then
        echo "asset symlink: $relative has a symlinked parent" >&2
        exit 1
      fi
      mkdir -p "$parent"
      remaining=${remaining#*/}
    done
    destination="$parent/$remaining"
    if [ -L "$destination" ]; then
      echo "asset collision: $relative is a symlink" >&2
      exit 1
    fi
    if [ -e "$destination" ]; then
      if ! cmp -s "$source_file" "$destination"; then
        echo "asset collision: $relative has different bytes" >&2
        exit 1
      fi
      continue
    fi
    temporary=$(mktemp "$parent/.letscube-asset.XXXXXXXX")
    cp "$source_file" "$temporary"
    chmod 0644 "$temporary"
    if ! ln "$temporary" "$destination" 2>/dev/null; then
      if ! cmp -s "$source_file" "$destination"; then
        echo "asset collision: $relative has different bytes" >&2
        exit 1
      fi
    fi
    rm -f "$temporary"
    temporary=
  done
' sh "$source_dir" "$target_dir" {} +
