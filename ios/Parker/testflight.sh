#!/bin/sh
# Archive the iPhone app and upload it to App Store Connect (TestFlight).
#
#   ios/Parker/testflight.sh            # archive + upload
#   ios/Parker/testflight.sh --export   # archive + export the .ipa only (no upload)
#
# Needs: Xcode with the Apple account signed in (Xcode → Settings → Accounts) —
# signing is automatic and cloud-managed, so the Apple Distribution certificate
# and the App Store profile are created on first use; and the app record in
# App Store Connect ("Parker Notes", bundle dev.getparker.parker), created once
# by hand — the API cannot create records. Bump CURRENT_PROJECT_VERSION in
# project.yml before each upload: App Store Connect refuses a build number it
# has already seen for the same MARKETING_VERSION.
set -eu
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
DEST=upload; [ "${1:-}" = "--export" ] && DEST=export

command -v xcodegen >/dev/null || { echo "brew install xcodegen" >&2; exit 1; }
xcodegen generate >/dev/null
mkdir -p build
cat > build/exportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>H5X7SH54MC</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

xcodebuild -project Parker.xcodeproj -scheme Parker -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Parker.xcarchive \
  -allowProvisioningUpdates archive | grep -E "error|warning: .*sign|\*\* " || true
xcodebuild -exportArchive -archivePath build/Parker.xcarchive \
  -exportOptionsPlist build/exportOptions.plist -exportPath "build/$DEST" \
  -allowProvisioningUpdates | grep -E "error|Progress 100%: Upload|Exported|\*\* " || true
