#!/bin/sh

set -eu

if [ "${CONFIGURATION:-}" != "Release" ]; then
  exit 0
fi

fail() {
  echo "Portico iOS Release metadata: $1" >&2
  exit 1
}

require_resolved() {
  name="$1"
  value="$2"
  case "$value" in
    ""|*\$*|*\{*|*\}*)
      fail "$name must be supplied as a resolved release input"
      ;;
  esac
}

require_resolved DEVELOPMENT_TEAM "${DEVELOPMENT_TEAM:-}"
require_resolved CODE_SIGN_IDENTITY "${CODE_SIGN_IDENTITY:-}"
require_resolved PROVISIONING_PROFILE_SPECIFIER "${PROVISIONING_PROFILE_SPECIFIER:-}"
require_resolved PORTICO_CAST_RECEIVER_APPLICATION_ID "${PORTICO_CAST_RECEIVER_APPLICATION_ID:-}"
require_resolved MARKETING_VERSION "${MARKETING_VERSION:-}"
require_resolved CURRENT_PROJECT_VERSION "${CURRENT_PROJECT_VERSION:-}"

[ "${CODE_SIGN_STYLE:-}" = "Manual" ] || fail "CODE_SIGN_STYLE must be Manual"
[ "${CODE_SIGNING_REQUIRED:-}" = "YES" ] || fail "CODE_SIGNING_REQUIRED must be YES"
[ "${APS_ENVIRONMENT:-}" = "production" ] || fail "APS_ENVIRONMENT must be production"
[ "${PRODUCT_BUNDLE_IDENTIFIER:-}" = "tv.getportico.ios" ] || fail "PRODUCT_BUNDLE_IDENTIFIER is not the approved iOS release ID"

case "$MARKETING_VERSION" in
  ''|*[!0-9.]*|.*|*.) fail "MARKETING_VERSION must contain only numeric dot-separated components" ;;
esac
case "$CURRENT_PROJECT_VERSION" in
  ''|*[!0-9]*) fail "CURRENT_PROJECT_VERSION must be numeric" ;;
esac
