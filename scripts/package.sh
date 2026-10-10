#!/usr/bin/env bash
set -euo pipefail

# Builds an upload-ready bundle for https://extensions.gnome.org.
#
# The archive contains the extension files at the top level (no containing
# folder), which is what extensions.gnome.org expects. Only the runtime files
# are included; tests/, scripts/ and README.md are left out.
#
# Usage:
#     ./scripts/package.sh
#
# Output:
#     dist/<uuid>.shell-extension.zip

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METADATA="$PROJECT_DIR/metadata.json"

# Files that ship with the extension (order does not matter).
RUNTIME_FILES=(extension.js pricing.js holidays.js gio-async.js metadata.json stylesheet.css)

read_metadata() {
    local key="$1"

    if command -v python3 >/dev/null 2>&1; then
        python3 - "$METADATA" "$key" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

print(data.get(sys.argv[2], ""))
PY
    else
        sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$METADATA" |
            head -n 1
    fi
}

UUID="$(read_metadata uuid)"
VERSION="$(read_metadata version)"

if [ -z "$UUID" ]; then
    echo "error: could not read 'uuid' from $METADATA" >&2
    exit 1
fi

DIST_DIR="$PROJECT_DIR/dist"
OUT="$DIST_DIR/$UUID.shell-extension.zip"

# Stage the runtime files in a directory named after the UUID. This is required
# for the directory name to match the UUID, and makes the tooling pack the
# files at the root of the archive.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
SRC="$STAGE_DIR/$UUID"
mkdir -p "$SRC"

for file in "${RUNTIME_FILES[@]}"; do
    if [ ! -f "$PROJECT_DIR/$file" ]; then
        echo "error: missing runtime file: $file" >&2
        exit 1
    fi

    cp "$PROJECT_DIR/$file" "$SRC/$file"
done

mkdir -p "$DIST_DIR"
rm -f "$OUT"

build_with_pack() {
    gnome-extensions pack --force --quiet \
        --out-dir="$DIST_DIR" \
        --extra-source=pricing.js \
        --extra-source=holidays.js \
        --extra-source=gio-async.js \
        "$SRC"
}

build_with_zip() {
    ( cd "$SRC" && zip -X -q "$OUT" "${RUNTIME_FILES[@]}" )
}

BUILDER=""

if command -v gnome-extensions >/dev/null 2>&1; then
    if build_with_pack; then
        BUILDER="gnome-extensions pack"
    else
        echo "warning: 'gnome-extensions pack' failed, falling back to zip" >&2
    fi
fi

if [ -z "$BUILDER" ]; then
    if command -v zip >/dev/null 2>&1; then
        build_with_zip
        BUILDER="zip"
    else
        echo "error: neither 'gnome-extensions pack' nor 'zip' is available" >&2
        exit 1
    fi
fi

if [ ! -f "$OUT" ]; then
    echo "error: archive was not created at $OUT" >&2
    exit 1
fi

# Verify the archive structure: required files at the top level (not nested).
list_archive() {
    unzip -Z1 "$OUT"
}

for required in metadata.json extension.js pricing.js holidays.js gio-async.js; do
    if ! list_archive | grep -qx "$required"; then
        echo "error: archive is missing top-level file: $required" >&2
        exit 1
    fi
done

echo "Built with: $BUILDER"
echo "Version:    ${VERSION:-unknown}"
echo "Created:    $OUT"
echo "Contents:"
list_archive | sed 's/^/  /'

# Optional: run the same static-analysis tool used by extensions.gnome.org when
# it is installed. It must run on the zip, not on the repository directory.
echo

if command -v shexli >/dev/null 2>&1; then
    echo "shexli package check:"
    shexli "$OUT" || true
else
    echo "Tip: run 'shexli \"$OUT\"' before uploading to extensions.gnome.org."
fi
