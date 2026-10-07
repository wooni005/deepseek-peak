#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_UUID="deepseek-peak@arjan"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Deploying $EXTENSION_UUID..."

# Disable first if currently enabled
if gnome-extensions info "$EXTENSION_UUID" 2>/dev/null |
    grep -q "Ingeschakeld: Ja"; then
    echo "Disabling extension..."
    gnome-extensions disable "$EXTENSION_UUID"
fi

mkdir -p "$INSTALL_DIR"

cp "$PROJECT_DIR/extension.js" "$INSTALL_DIR/"
cp "$PROJECT_DIR/pricing.js" "$INSTALL_DIR/"
cp "$PROJECT_DIR/metadata.json" "$INSTALL_DIR/"
cp "$PROJECT_DIR/stylesheet.css" "$INSTALL_DIR/"

echo "Files copied to:"
echo "  $INSTALL_DIR"

echo "Enabling extension..."
gnome-extensions enable "$EXTENSION_UUID"

echo
gnome-extensions info "$EXTENSION_UUID"
