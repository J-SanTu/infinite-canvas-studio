#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/.build.noindex/mac/mac-arm64/Santu Infinite Canvas.app}"
VERSION="$(/usr/bin/plutil -extract version raw -o - "$ROOT/package.json")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
OUT="${2:-$ROOT/macOS/Santu-Infinite-Canvas-$VERSION-arm64.pkg}"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/santu-installer.XXXXXX")"
WORK="$TEMP/build.noindex"
mkdir -p "$WORK"
trap 'rm -rf "$TEMP"' EXIT
/usr/bin/codesign --verify --deep --strict "$APP"
mkdir -p "$WORK/payload" "$WORK/packages" "$(dirname "$OUT")"
/usr/bin/ditto "$APP" "$WORK/payload/Santu Infinite Canvas.app"
/usr/bin/pkgbuild --analyze --root "$WORK/payload" "$WORK/components.plist"
/usr/bin/plutil -convert json -o "$WORK/components.json" "$WORK/components.plist"
node - "$WORK/components.json" <<'JS'
const fs = require('node:fs');
const path = process.argv[2];
const components = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const component of components) {
  component.BundleIsRelocatable = false;
  component.BundleOverwriteAction = 'upgrade';
  component.BundleIsVersionChecked = false;
}
fs.writeFileSync(path, JSON.stringify(components));
JS
/usr/bin/plutil -convert xml1 -o "$WORK/components.plist" "$WORK/components.json"
/usr/bin/sed "s/__VERSION__/$VERSION/g" "$ROOT/desktop/installer/distribution.xml" > "$WORK/distribution.xml"
/usr/bin/pkgbuild --root "$WORK/payload" --component-plist "$WORK/components.plist" --scripts "$ROOT/desktop/installer/scripts" --identifier cn.santu.infinitecanvas.installer --version "$VERSION" --install-location /Applications "$WORK/packages/component.pkg"
/usr/bin/productbuild --distribution "$WORK/distribution.xml" --resources "$ROOT/desktop/installer" --package-path "$WORK/packages" "$OUT"
