#!/usr/bin/env bash
# Validate approved CI credentials in a disposable hosted-runner keychain.
set -euo pipefail
umask 077
SIGNING_DIR=$(mktemp -d "$RUNNER_TEMP/portico-signing.XXXXXX")
KEYCHAIN_PATH="$SIGNING_DIR/check.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -base64 48)
cleanup() {
    security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
    rm -rf "$SIGNING_DIR"
}
trap cleanup EXIT
export SIGNING_DIR
python3 - <<'PYTHON'
import base64, os, pathlib, plistlib, subprocess, datetime
root = pathlib.Path(os.environ['SIGNING_DIR'])
for key, filename in [
    ('APPLE_DISTRIBUTION_P12_BASE64', 'distribution.p12'),
    ('APPLE_IOS_APP_STORE_PROFILE_BASE64', 'ios.mobileprovision'),
    ('APPLE_TVOS_APP_STORE_PROFILE_BASE64', 'tvos.mobileprovision'),
    ('APPLE_TOPSHELF_APP_STORE_PROFILE_BASE64', 'topshelf.mobileprovision'),
]:
    value = os.environ.get(key)
    if not value:
        raise SystemExit('Missing environment secret: ' + key)
    (root / filename).write_bytes(base64.b64decode(value, validate=True))
profiles = [
    ('ios', 'iOS', 'tv.getportico.portico'),
    ('tvos', 'tvOS', 'tv.getportico.portico'),
    ('topshelf', 'tvOS', 'tv.getportico.portico.TopShelf'),
]
for name, platform, bundle in profiles:
    decoded = subprocess.check_output(['security', 'cms', '-D', '-i', str(root / (name + '.mobileprovision'))], stderr=subprocess.DEVNULL)
    profile = plistlib.loads(decoded)
    entitlements = profile['Entitlements']
    assert profile['TeamIdentifier'] == ['WB7BUK5Z7C']
    assert platform in profile['Platform']
    assert entitlements['application-identifier'] == 'WB7BUK5Z7C.' + bundle
    assert entitlements.get('get-task-allow') is False
    assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    if name != 'ios':
        assert 'group.tv.getportico.portico' in entitlements['com.apple.security.application-groups']
    if name != 'topshelf':
        assert entitlements['com.apple.developer.applesignin'] == ['Default']
    # The certificate must be identical across all three profiles.
    cert = profile['DeveloperCertificates'][0]
    if (root / 'profile-certificate.der').exists():
        assert (root / 'profile-certificate.der').read_bytes() == cert
    else:
        (root / 'profile-certificate.der').write_bytes(cert)
    print('Valid profile:', profile['Name'], 'expires', profile['ExpirationDate'].date())
PYTHON
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 3600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$SIGNING_DIR/distribution.p12" -P "$APPLE_DISTRIBUTION_P12_PASSWORD" -k "$KEYCHAIN_PATH" -T /usr/bin/codesign
# Scope noninteractive signing access to this temporary keychain's imported key.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null
identity=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | awk '/"Apple Distribution: Justin Ehler \(WB7BUK5Z7C\)"/ {print $2}')
[[ "$identity" =~ ^[A-Fa-f0-9]{40}$ ]] || { echo 'No unique valid CI signing identity'; exit 1; }
profile_identity=$(openssl x509 -inform DER -in "$SIGNING_DIR/profile-certificate.der" -fingerprint -sha1 -noout | cut -d= -f2 | tr -d :)
[[ "$identity" == "$profile_identity" ]] || { echo 'Profile and signing certificate differ'; exit 1; }
printf 'int main(void) { return 0; }\n' > "$SIGNING_DIR/probe.c"
xcrun --sdk iphoneos clang -arch arm64 -miphoneos-version-min=15.1 -isysroot "$(xcrun --sdk iphoneos --show-sdk-path)" "$SIGNING_DIR/probe.c" -o "$SIGNING_DIR/probe"
codesign --force --sign "$identity" --keychain "$KEYCHAIN_PATH" --timestamp=none "$SIGNING_DIR/probe"
codesign --verify --strict "$SIGNING_DIR/probe"
echo 'Hosted-runner key import, profile matching, private-key use and signature verification passed.'
echo 'This proves credential access, not a signed Portico archive or TestFlight acceptance.'
