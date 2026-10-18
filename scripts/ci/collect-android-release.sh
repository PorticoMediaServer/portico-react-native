#!/usr/bin/env bash
# Deliberately enumerate every shipping flavor/variant: one absent asset fails the release.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
outputs=${1:-apps/native/android/app/build/outputs}
engine=${2:-third_party/media-engine/out/android}
dist=${3:-dist}
bundle=$(python3 -B scripts/ci/android-config.py source_bundle)
assets=(
    "$outputs/apk/google/release/app-google-release.apk"
    "$outputs/apk/firetv/release/app-firetv-release.apk"
    "$outputs/bundle/googleRelease/app-google-release.aab"
    "$outputs/bundle/firetvRelease/app-firetv-release.aab"
    "$engine/source/$bundle"
    "$engine/notices/THIRD-PARTY-NOTICES.txt"
)
for asset in "${assets[@]}"; do
    [[ -f "$asset" && -s "$asset" ]] || { echo "Missing or empty required release asset: $asset" >&2; exit 1; }
done
# Check the entire set before copying anything; debug, stale unflavored and split APKs cannot
# satisfy a missing universal release APK. The workflow explicitly disables ABI splits.
mkdir -p "$dist"
for asset in "${assets[@]:0:5}"; do cp "$asset" "$dist/"; done
cp "${assets[5]}" "$dist/media-engine-android-THIRD-PARTY-NOTICES.txt"
