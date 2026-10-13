# Portico for iPhone, iPad, Apple TV, Android and Android TV

The React Native (react-native-tvos) client for Portico. It builds on:

- `packages/client-core`: the headless services (sessions, content
  projections, detail, show workspace, search, saved, guide, playback).
- `packages/design`: colour, spacing and icon tokens.
- `Native/`: the AVPlayer and mpv player engines (Apple; the Android engines are under `android/`), audio, keychain, networking and system
  modules, with their JavaScript bindings in `src/bridge/`.
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

## The mpv player engine (iPhone, iPad, Apple TV)

The app has two player engines behind one contract (`Native/ENGINE-CONTRACT.md`): the system's
AVPlayer and mpv. The Player setting is Automatic (the default), this device's player, or mpv.

mpv comes from [MPVKit](https://github.com/mpvkit/MPVKit) (its LGPL product `MPVKit`: libmpv,
FFmpeg, libass, libplacebo, MoltenVK, dav1d and their dependencies as prebuilt xcframeworks),
pinned in both Xcode projects to the exact version `1.1.0-n9.0.2` (mpv 0.41). Nothing is checked
in: Xcode fetches it.

```bash
cd ios && pod install      # as before
xcodebuild -resolvePackageDependencies -workspace Portico.xcworkspace -scheme Portico   # fetches MPVKit (a large download, once)
```

Then build as usual. The same two commands apply in `tvos/`. Notes:

- The engine's Swift files compile to a stand-in when the package is missing (`#if
  canImport(Libmpv)`): the app still builds and simply has no mpv (no Player setting).
- Run with **Metal API Validation off** in the scheme's Diagnostics while debugging HDR titles;
  MoltenVK trips the validation layer there. Release builds are unaffected.
- mpv draws through Metal, which the simulators support, but VideoToolbox decoding and HDR need
  a device.
- To move to a newer MPVKit, change `version` in the `XCRemoteSwiftPackageReference "MPVKit"`
  entry of both `project.pbxproj` files. The engine needs mpv 0.38 or later.

## The mpv player engine (Android, Android TV, Fire TV)

The same second engine, behind the same contract, on Android: the system's Media3 player and
mpv, with the same Player setting. The Kotlin is in
`android/app/src/main/java/tv/getportico/portico/native/PorticoMpv*.kt`; libmpv and the small JNI
bridge to it are their own Gradle module, `android/portico-mpv`.

**What is fetched.** One `libmpv.so` per architecture from the media-kit project's published
Android builds, [libmpv-android-video-build](https://github.com/media-kit/libmpv-android-video-build)
release `v1.1.11`, flavour `full`. That is the LGPL flavour: FFmpeg 6.0 configured
`--disable-gpl --enable-version3` with every decoder and demuxer, linked into libmpv; mpv (a
revision of October 2023, between 0.36 and 0.37) built `-Dgpl=false`; libass 0.17.1; dav1d;
mbedTLS. The four archives (about 8 MB each) are pinned by SHA-256 in
`android/portico-mpv/build.gradle`; the build's `fetchLibmpv` task downloads them once into
`android/portico-mpv/build/libmpv/`, checks them, and takes `libmpv.so` out of each. Nothing is
checked in, and nothing else from the archives is used. The bridge
(`portico-mpv/src/main/cpp/portico_mpv_jni.c`, compiled by the NDK through CMake) is ours; it
includes mpv's `client.h`, which is under the ISC licence and is checked in beside it.

```bash
cd android
./gradlew :portico-mpv:fetchLibmpv        # the download and the checksum check, on their own
./gradlew :app:assembleGoogleDebug        # as before; fetches libmpv first when it is missing
```

Notes:

- **No network at build time, or another libmpv**: pass `-PporticoLibmpvDir=/path`, a folder
  holding `<abi>/libmpv.so` for every architecture being built. Nothing is fetched then. The
  library must be an LGPL build (no GPL parts) to ship in this app. To build one, use the scripts
  in the repository above (`buildscripts/bundle_full.sh`), or mpv-android's with FFmpeg's
  `--enable-gpl` removed and mpv's `-Dgpl=false` added.
- **Architectures.** libmpv is fetched for the architectures in `reactNativeArchitectures`
  (`gradle.properties`, or `-PreactNativeArchitectures=arm64-v8a` for one). One APK still carries
  all of them. `-PporticoAbiSplits=true` also writes one APK per architecture beside it; an app
  bundle is split by the store without that.
- **A build without mpv.** If `libmpv.so` or the bridge cannot be loaded on a device, the module
  reports `available: false`, the Player setting is not offered and everything plays in Media3.
- **To move to another libmpv release**, change `mpvRelease` and the four checksums in
  `android/portico-mpv/build.gradle`. The engine uses only long-standing parts of mpv's client
  interface (it sets the start position as an option rather than through `loadfile`, whose
  arguments changed in mpv 0.38), so newer builds work unchanged; a build with FFmpeg as separate
  shared libraries also needs those libraries packaged.
- **What this build of libmpv lacks**, and the engine therefore declares it does not do: bitstream
  passthrough (no S/PDIF muxer in its FFmpeg), deinterlacing in software (no deinterlacing
  filter), and Dolby Vision profile 5 colours (no libplacebo). See the engine's capability
  profile in `src/bridge/mpv-profile.ts`.

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
