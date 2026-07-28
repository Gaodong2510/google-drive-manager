#!/usr/bin/env bash
# Build a modern (targetSdk 35) CloudBridge APK for sideload install.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$ROOT/android"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:${ANDROID_HOME}/build-tools/35.0.0:$PATH"

SERVER_URL="${SERVER_URL:-http://127.0.0.1:8787}"
if [[ "$SERVER_URL" == "http://127.0.0.1:8787" ]]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -n "${IP:-}" ]]; then
    SERVER_URL="http://${IP}:8787"
  fi
fi

echo "Building CloudBridge APK  SERVER_URL=$SERVER_URL"
echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"

cd "$ANDROID_DIR"
chmod +x gradlew
./gradlew :app:assembleRelease -PSERVER_URL="$SERVER_URL"

UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
KEYSTORE="$ANDROID_DIR/cloudbridge-release.jks"
OUT="$ROOT/cloudbridge.apk"

if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair -v -keystore "$KEYSTORE" -storepass cloudbridge -keypass cloudbridge \
    -alias cloudbridge -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=CloudBridge, OU=SelfHosted, O=CloudBridge, L=Internet, ST=NA, C=CN"
fi

ALIGNED="$(mktemp /tmp/cb-align.XXXXXX.apk)"
zipalign -f -p 4 "$UNSIGNED" "$ALIGNED"
apksigner sign --ks "$KEYSTORE" --ks-pass pass:cloudbridge --key-pass pass:cloudbridge \
  --out "$OUT" "$ALIGNED"
rm -f "$ALIGNED"
apksigner verify "$OUT"

# Publish for web download if frontend public exists
PUB="$ROOT/../frontend/public/download"
mkdir -p "$PUB"
cp "$OUT" "$PUB/cloudbridge.apk"
if [[ -d "$ROOT/../frontend/dist" ]]; then
  mkdir -p "$ROOT/../frontend/dist/download"
  cp "$OUT" "$ROOT/../frontend/dist/download/cloudbridge.apk"
fi

echo ""
echo "OK → $OUT"
aapt dump badging "$OUT" | head -n 3
echo "Download (if panel running): http://<host>:8787/download/cloudbridge.apk"
