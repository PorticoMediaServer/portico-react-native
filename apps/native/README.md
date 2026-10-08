# Portico for iPhone, iPad, Apple TV, Android and Android TV

The React Native (react-native-tvos) client for Portico. It builds on:

- `packages/client-core`: the headless services (sessions, content
  projections, detail, show workspace, search, saved, guide, playback).
- `packages/design`: colour, spacing and icon tokens.
- `Native/`: the AVPlayer, audio, keychain, networking and system modules, with
  their JavaScript bindings in `src/bridge/`.
- `android/`: the same native modules for Android, in Kotlin, under the same
  names (Media3 for playback, the Keystore for records). Every screen is shared;
  only this layer differs.

## Layout

| Folder | Role |
| --- | --- |
| `src/ui` | The design system. Every visual primitive lives here; no other folder may use hex colours, `StyleSheet.create`, font literals or raw `Pressable`/`Text`. |
| `src/app` | Session controller, content/detail hooks, routes, device preferences, the server-compat shim. |
| `src/shell` | Authenticated frame: television rail, handheld bottom tabs, navigation stack, Menu-key policy. |
| `src/screens` | Destinations: auth flow, Home, Library, Detail, Show, Entity, Search, Saved, Live TV, Channels, Settings. |
| `src/player` | Player engine binding + full-screen chrome, handheld mini bar, television now-playing pill. |
| `ios/` | iPhone/iPad Xcode project (`tv.getportico.portico.ios`). |
| `tvos/` | Apple TV Xcode project (`tv.getportico.portico.tv`). |
| `android/` | Android project (`tv.getportico.portico`): phones, tablets, Android TV, and Fire TV as the `firetv` flavor. |

## Product rules baked in

- Television keeps the left rail; iPhone uses a bottom tab bar (Home ·
  Library · Live TV · Saved · Search) with Search/Account in the header.
- Every library opens on Discover · Browse · Collections · Categories tabs
  authored by the server. The client never ranks or groups content.
- Server administration is not in the apps. Settings holds device
  preferences, account/profile, server connections and a web hand-off.
- Pause/Play is the only filled transport control. Option boxes are Audio ·
  Subtitles · Quality · Speed · Sleep, collapsed to one sheet on phones.
- Handheld audio continues in a compact mini bar; television shows a
  top-right now-playing pill. Video is full-screen only.

## Running

```bash
npm install --legacy-peer-deps
npm start                         # Metro on port 19424
# tvOS
cd tvos && pod install && xcodebuild -workspace Portico.xcworkspace -scheme Portico -sdk appletvsimulator -destination 'name=Apple TV' build
# iOS
cd ios && pod install && xcodebuild -workspace Portico.xcworkspace -scheme Portico -sdk iphonesimulator -destination 'name=iPhone 17' build
```

Debug builds load JS from `127.0.0.1:19424`. `npx tsc --noEmit` must stay
clean.

**Release builds for the simulators** embed the JS bundle and need no Metro:
`-configuration Release -sdk iphonesimulator` (or `appletvsimulator`) with
`CODE_SIGN_IDENTITY=-`. Don't use `CODE_SIGNING_ALLOWED=NO`: it drops the
entitlements, so the keychain (credentials, the TV activation key) and the app
group fail and every sign-in screen shows an error.

**After moving or re-cloning the checkout, run `pod install` again** (for `ios/`
and `tvos/`). The generated `build/generated/autolinking/autolinking.json` holds
absolute paths. A stale copy makes codegen find no libraries: it writes an
empty component registry, so safe-area-context, svg, screens and reanimated fall
back to old-style views. In a Release build that meant a blank screen and a
crash at launch (`RCTEventEmitter.receiveEvent`), because the production bundle
has nothing registered to receive old-style view events.
`src/app/legacy-events.ts` now drops such events with a warning instead of
crashing.

## Android

One Gradle project for phones, tablets and televisions (the manifest has both the
phone and the Leanback launcher). Two product flavors: `google` (devices with
Google Play services; includes Google Cast) and `firetv` (Fire OS; no Play
services, no Cast).

```bash
npm install --legacy-peer-deps
npm start                                             # Metro on port 19424 (debug builds only)
cd android
./gradlew :app:assembleGoogleDebug                    # or assembleFiretvDebug
./gradlew :app:assembleGoogleRelease                  # embeds the JS bundle; needs no Metro
adb install app/build/outputs/apk/google/debug/app-google-debug.apk
adb reverse tcp:19424 tcp:19424                       # Metro, for a debug build on an emulator
```

- **JDK 17** (the React Native Gradle plugin pins it) and the Android SDK
  (platform 36, NDK 27). Add `-PreactNativeArchitectures=arm64-v8a` to build one
  ABI.
- **A server on the development machine**: plain HTTP is accepted only for
  loopback at sign-in, so forward it (`adb reverse tcp:32500 tcp:32500`) and
  sign in to `127.0.0.1:32500`.
- **Television layout.** Android TV reports 960×540 dp where tvOS has
  1920×1080 pt. `TelevisionDisplay.kt` overrides the density at start-up so the
  shared screens lay out in the tvOS space unchanged.
- **Native modules** live in
  `android/app/src/main/java/tv/getportico/portico/native/` and keep the Apple
  names, methods and events (`PorticoRuntime`, `PorticoNetwork`,
  `PorticoPlaybackModule` + the `PorticoPlayer` view, `PorticoSystemMedia`,
  `PorticoDownloads`, `PorticoTopShelf`, …). A module that does not apply to a
  kind of device is absent there (`PorticoDownloads` on a television,
  `PorticoTopShelf` on a phone, `PorticoCast` on Fire TV), and the shared code
  hides the feature.
- **Deep links** for checks: `adb shell am start -a android.intent.action.VIEW -d "portico://item/<id>" tv.getportico.portico`
  (`portico://play/<id>`, `portico://device`).
- **Debug builds keep the fast-forward key** for React Native's developer menu;
  test that key on a release build.
- **Release signing**: the release build type is signed with the debug keystore
  until a release key exists. Cast needs `-PporticoCastApplicationId=<id>`;
  Hosted sign-in needs `-PporticoHostedUrl=<origin>`.
- Icons and the launch logo are generated: `scripts/make-icons.sh android`.

## Known gaps

- Subtitle selection in the player is a placeholder (the native subtitle
  bridge exists in `src/bridge` but is not wired).
- Poster-size preference is stored but not yet applied to card metrics.
- `src/app/compat.ts` folds newer server fields (`artwork` objects, extra
  navigation views) into the shape the checked-in core validates; remove once
  `packages/client-core` catches up.
- Playlist editing, history clearing and recording actions are not exposed.
