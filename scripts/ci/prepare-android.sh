#!/usr/bin/env bash
# Run from a clean checkout before Gradle. No unverified engine cache or moving source refs.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
config() { python3 -B scripts/ci/android-config.py "$1"; }
ndk=$(config ndk)
sdk=$(config sdk)
build_tools=$(config build_tools)
rust=$(config rust)
abis=$(config abis)

sdk_home=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[[ -n "$sdk_home" ]] || { echo "ANDROID_HOME or ANDROID_SDK_ROOT is required" >&2; exit 1; }
sdkmanager="$sdk_home/cmdline-tools/latest/bin/sdkmanager"
[[ -x "$sdkmanager" ]] || { echo "Missing Android SDK manager: $sdkmanager" >&2; exit 1; }
command -v rustup >/dev/null || { echo "rustup is required to install pinned Rust $rust" >&2; exit 1; }
# GitHub's Android runner has accepted SDK licences. Closed stdin makes an unaccepted licence
# fail rather than hanging or hiding an installer error behind a yes/pipefail SIGPIPE.
"$sdkmanager" --install "ndk;$ndk" "platforms;android-$sdk" "build-tools;$build_tools" </dev/null
export ANDROID_NDK_HOME="$sdk_home/ndk/$ndk"
grep -Fxq "Pkg.Revision = $ndk" "$ANDROID_NDK_HOME/source.properties"
rustup toolchain install "$rust" --profile minimal
export RUSTUP_TOOLCHAIN="$rust"
export MEDIA_ENGINE_JOBS=${MEDIA_ENGINE_JOBS:-2}
# The recipe verifies source SHA-256s, builds the headers/libraries/notices/source, then runs
# verify.py against the checked-in dependency graph for precisely the app's ABI set.
third_party/media-engine/build-android.sh --abis "$abis"
if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf 'ANDROID_NDK_HOME=%s\n' "$ANDROID_NDK_HOME" >> "$GITHUB_ENV"
fi
