# Apple CI and TestFlight preparation

`Apple builds` prepares production JavaScript on Ubuntu, then builds the pinned
media sources and Xcode archives on separate `xcode-27` runners for iOS and tvOS.
No personal Mac or local simulator state is required. Component caches include
recipe/patch stamps; strict media verification still runs after a cache restore.
The bundle is SHA-256 checked on the Mac runner before normal Hermes compilation.
CocoaPods installs use the lockfile with `--deployment`.

`Portico-ios-unsigned` and `Portico-tvos-unsigned` are unsigned physical-device
archives with media notices and source. They cannot be installed through
TestFlight. Device archives do not prove simulator, UI automation or playback
acceptance. Failed verification retains diagnostic logs; checks must pass before
framework artifacts reach the app jobs.

## Shared identity

The apps share `tv.getportico.portico` for one combined App Store Connect record.
Top Shelf uses `tv.getportico.portico.TopShelf`, with the tvOS app and extension
sharing `group.tv.getportico.portico`. Portal capabilities match the existing
entitlements. Earlier portal identifiers were preserved. A bundle-ID change
creates a separate app/keychain identity; prior development-install state is
not automatically migrated.

## Signing readiness

`Apple signing readiness` imports the approved certificate into a disposable
hosted-runner keychain, validates all three profiles against the team, bundle IDs
and certificate, signs a small iOS executable and verifies its signature.
Decoded inputs and the temporary keychain are removed on exit. This establishes
noninteractive credential access, not a signed Portico archive.

The `apple-distribution` GitHub environment holds these secrets:

- `APPLE_DISTRIBUTION_P12_BASE64`
- `APPLE_DISTRIBUTION_P12_PASSWORD`
- `APPLE_IOS_APP_STORE_PROFILE_BASE64`
- `APPLE_TVOS_APP_STORE_PROFILE_BASE64`
- `APPLE_TOPSHELF_APP_STORE_PROFILE_BASE64`

Only `main` and the temporary `apple-actions-builds` branch may use it; Justin
reviews jobs before secrets are released. Unsigned builds do not use signing
secrets. Canonical signing files belong in the Portico project's
`.private/apple-signing/`, outside every Git repository. The PEM private key is
encrypted; the password-protected PKCS12 uses Apple's compatible import encoding.
Signing files, passwords and API keys must never enter build artifacts.

## Distribution checkpoint

Create one record named Portico with iOS and tvOS platforms using the shared ID.
On October 18, 2026, the Developer account recorded the current agreement as
accepted, while App Store Connect still blocked Add Apps with its agreement
modal. Do not accept agreements again on the account holder's behalf.

Signed Portico archive/export validation, upload authentication, TestFlight
metadata/groups, installs and device playback remain separate checks. These
workflows do not upload an app or submit a store release.
