#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METADATA="$PROJECT_DIR/metadata.json"

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

EXTENSION_UUID="$(read_metadata uuid)"

if [ -z "$EXTENSION_UUID" ]; then
    echo "error: could not read 'uuid' from $METADATA" >&2
    exit 1
fi

INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Deploying $EXTENSION_UUID..."

# Disable first if currently enabled (match both Dutch and English CLI output)
if gnome-extensions info "$EXTENSION_UUID" 2>/dev/null |
    grep -qE "Ingeschakeld: Ja|Enabled: Yes"; then
    echo "Disabling extension..."
    gnome-extensions disable "$EXTENSION_UUID"
fi

mkdir -p "$INSTALL_DIR"

cp "$PROJECT_DIR/extension.js" "$INSTALL_DIR/"
cp "$PROJECT_DIR/pricing.js" "$INSTALL_DIR/"
cp "$PROJECT_DIR/holidays.js" "$INSTALL_DIR/"
cp "$PROJECT_DIR/gio-async.js" "$INSTALL_DIR/"
cp "$PROJECT_DIR/metadata.json" "$INSTALL_DIR/"
cp "$PROJECT_DIR/stylesheet.css" "$INSTALL_DIR/"

echo "Files copied to:"
echo "  $INSTALL_DIR"

# A freshly added extension directory is only known to the running GNOME Shell
# after it rescans. On Wayland this needs a full session restart (log out and
# back in); on X11 you can use Alt+F2 -> r.
if gnome-extensions list 2>/dev/null | grep -qx "$EXTENSION_UUID"; then
    echo "Enabling extension..."
    gnome-extensions enable "$EXTENSION_UUID"

    echo
    gnome-extensions info "$EXTENSION_UUID"
else
    cat <<EOF

The running GNOME Shell does not know '$EXTENSION_UUID' yet, so it cannot be
enabled right now. Reload the shell first:

  - Wayland: log out and log back in
  - X11:     Alt+F2, type 'r', Enter

Then enable the extension:

  gnome-extensions enable $EXTENSION_UUID

EOF
fi
