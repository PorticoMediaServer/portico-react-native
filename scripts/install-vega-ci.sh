#!/usr/bin/env bash
# Install Amazon's pinned Vega tools directly from the vendor's public distribution.
# https://developer.amazon.com/docs/vega/0.24/continuous-integration
# SDK/authentication directories must never be uploaded or cached as public artifacts.
set -euo pipefail
[[ "$(uname -sm)" == "Linux x86_64" ]] || { echo "Vega CI requires Linux x86_64" >&2; exit 1; }
cli_version=1.4.2
cli_sha256=2789ad833bff8395c796d203d805309ea2d27cf26a3d6c1141a5dc6a403aba8a
sdk_version=0.24.12112
base=https://k-artifactory-external.labcollab.net/artifactory/api/kpm/kpm-default-prod-local
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The vendor returns a temporary signed download URL. Keep it out of logs.
curl --fail --silent --show-error --retry 3 --get \
  --data-urlencode platform=linux-x86_64 --data-urlencode "version=$cli_version" \
  "$base/KeplerVersionManager" -o "$work/download.json"
url=$(jq -er '.s3_link' "$work/download.json")
curl --fail --silent --show-error --location --retry 3 "$url" -o "$work/vega.tar.gz"
echo "$cli_sha256  $work/vega.tar.gz" | sha256sum --check
mkdir -p "$HOME/vega/bin"
tar -xzf "$work/vega.tar.gz" -C "$HOME/vega/bin"
export PATH="$HOME/vega/bin:$PATH"
export NONINTERACTIVE=true SKIP_VVD_INSTALL=true
vega sdk install "$sdk_version" --non-interactive </dev/null
vega sdk use "$sdk_version"
vega --version
if [[ -n "${GITHUB_PATH:-}" ]]; then echo "$HOME/vega/bin" >> "$GITHUB_PATH"; fi
