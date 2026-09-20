#!/bin/bash
# Keep this file LF-only; macOS /bin/bash rejects CRLF shell options.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release builds must run on macOS." >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "macOS release builds must run natively on Apple Silicon (arm64)." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
BUNDLE_VERSION="${DWB_BUNDLE_VERSION:-15}"
PRODUCT="DWB MCP Studio"
BUNDLE_ID="com.devwithbebz.dwb-mcp-studio"
OUT="$ROOT/releases/macos"
APP="$OUT/$PRODUCT.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
RUNTIME="$RESOURCES/runtime"
DMG="$OUT/DWB-MCP-Studio-${VERSION}-macos-arm64.dmg"
ZIP="$OUT/DWB-MCP-Studio-${VERSION}-macos-arm64.zip"

rm -rf "$OUT"
mkdir -p "$MACOS" "$RUNTIME/node/bin" "$RUNTIME/node/lib/node_modules"

echo "==> Build and test Node core"
npm run typecheck
npm run build

echo "==> Build native macOS app"
swift test --package-path macos/DWBPlatform
swift build --package-path macos/DWBMCPStudioApp --configuration release --arch arm64
SWIFT_BIN="$(swift build --package-path macos/DWBMCPStudioApp --configuration release --arch arm64 --show-bin-path)/DWBMCPStudio"
test -x "$SWIFT_BIN"
cp "$SWIFT_BIN" "$MACOS/$PRODUCT"
chmod 755 "$MACOS/$PRODUCT"

echo "==> Bundle DWB runtime"
cp -R dist "$RUNTIME/dist"
cp -R scripts "$RUNTIME/scripts"
cp package.json package-lock.json LICENSE THIRD-PARTY.md README.md "$RUNTIME/"
(
  cd "$RUNTIME"
  npm ci --omit=dev --no-audit --no-fund
)

NODE_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$(command -v node)")"
cp "$NODE_REAL" "$RUNTIME/node/bin/node"
chmod 755 "$RUNTIME/node/bin/node"

NPM_ROOT="$(npm root -g)"
if [[ ! -d "$NPM_ROOT/npm" ]]; then
  echo "Bundled npm could not be located at $NPM_ROOT/npm" >&2
  exit 1
fi
cp -R "$NPM_ROOT/npm" "$RUNTIME/node/lib/node_modules/npm"

file "$MACOS/$PRODUCT"
file "$RUNTIME/node/bin/node"
if ! file "$MACOS/$PRODUCT" | grep -q "arm64"; then
  echo "SwiftUI executable is not arm64." >&2
  exit 1
fi
if ! file "$RUNTIME/node/bin/node" | grep -q "arm64"; then
  echo "Bundled Node.js is not arm64." >&2
  exit 1
fi

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${PRODUCT}</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${PRODUCT}</string>
  <key>CFBundleDisplayName</key>
  <string>${PRODUCT}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>${BUNDLE_VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>DWBReleaseVersion</key>
  <string>${VERSION}</string>
</dict>
</plist>
PLIST

echo "==> Sign application"
SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:--}"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  codesign --force --sign - "$RUNTIME/node/bin/node"
  codesign --force --deep --sign - "$APP"
else
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$RUNTIME/node/bin/node"
  codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
fi
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Build ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

echo "==> Build DMG"
DMG_ROOT="$(mktemp -d)"
trap 'rm -rf "$DMG_ROOT"' EXIT
cp -R "$APP" "$DMG_ROOT/$PRODUCT.app"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create   -volname "$PRODUCT"   -srcfolder "$DMG_ROOT"   -ov   -format UDZO   "$DMG" >/dev/null

(
  cd "$OUT"
  shasum -a 256 "$(basename "$DMG")" "$(basename "$ZIP")" > SHA256SUMS.txt
)

echo "==> Release artifacts"
ls -lh "$OUT"
echo "VERSION=$VERSION"
echo "APP=$APP"
echo "DMG=$DMG"
echo "ZIP=$ZIP"
