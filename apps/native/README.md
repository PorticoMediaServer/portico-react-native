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

mpv and everything it uses (FFmpeg 8.1.2, the server's version, under LGPL 2.1; OpenSSL;
libass, FreeType, HarfBuzz, FriBidi, libunibreak; dav1d; libplacebo, Little CMS, libdovi;
uchardet; MoltenVK) is Portico's own build from pinned sources: the media engine in
[`third_party/media-engine`](../../third_party/media-engine/README.md). Each library is its own
dynamic framework, combined into an `.xcframework`; a local Swift package
(`third_party/media-engine/apple/Package.swift`, product `PorticoMediaEngine`) wraps them, and
both Xcode projects depend on it. Nothing is downloaded by Xcode and nothing built is checked in,
so **build the engine once before opening the projects**, like `pod install`:

```bash
third_party/media-engine/build-apple.sh     # from the repository root; about an hour the first time
cd apps/native/ios && pod install            # as before (and in tvos/)
```

Then build as usual. Notes:

- Until `build-apple.sh` has run, Xcode cannot resolve the `PorticoMediaEngine` package (its
  frameworks are missing) and says so. The engine's Swift files compile to a stand-in when the
  `Libmpv` module is missing (`#if canImport(Libmpv)`), so removing the package from a project
  still builds an app without mpv (no Player setting).
- Simulators: iOS simulator frameworks are built for arm64 and x86_64; tvOS simulator ones for
  arm64 only (Rust, which libdovi is written in, has no x86_64 tvOS simulator target), so the
  Apple TV simulator needs an Apple-silicon Mac.
- Run with **Metal API Validation off** in the scheme's Diagnostics while debugging HDR titles;
  MoltenVK trips the validation layer there. Release builds are unaffected.
- mpv draws through Metal (Vulkan on MoltenVK), which the simulators support, but VideoToolbox
  decoding and HDR need a device.
- To change a version, see "Updating a component" in the media engine's README; the engine needs
  mpv 0.38 or later.

## The mpv player engine (Android, Android TV, Fire TV)

The same second engine, behind the same contract, on Android: the system's Media3 player and
mpv, with the same Player setting. The Kotlin is in
`android/app/src/main/java/tv/getportico/portico/native/PorticoMpv*.kt`; libmpv and the small JNI
bridge to it are their own Gradle module, `android/portico-mpv`.

**Where libmpv comes from.** The same media engine as on Apple
([`third_party/media-engine`](../../third_party/media-engine/README.md)), built for the four
architectures the app ships (`arm64-v8a armeabi-v7a x86 x86_64`) with the NDK the app uses.
Each library is its own `.so` (libmpv.so, libavcodec.so, libssl.so, libass.so, ...; 21 to 35
MB per architecture before compression, 29 MB for arm64). `android/portico-mpv/build.gradle` packages them
from `third_party/media-engine/out/android`, with the engine's licence notices as
`assets/media-engine/THIRD-PARTY-NOTICES.txt`, and stops with instructions when they are
missing. The bridge (`portico-mpv/src/main/cpp/portico_mpv_jni.c`, compiled by the NDK
through CMake) is ours; it compiles against the engine's own `mpv/client.h`.

```bash
third_party/media-engine/build-android.sh   # from the repository root, once (about half an hour)
cd apps/native/android
./gradlew :app:assembleGoogleDebug          # as before
```

Notes:

- **One emulator architecture**: `build-android.sh --abis x86_64` and build the app with
  `-PreactNativeArchitectures=x86_64`.
- **A build elsewhere**: `-PporticoLibmpvDir=/path/to/out/android` (the folder holding
  `lib/<abi>/*.so`, `include/mpv/` and `notices/`).
- **Architectures.** One APK still carries all of them. `-PporticoAbiSplits=true` also writes
  one APK per architecture beside it; an app bundle is split by the store without that.
- **A build without mpv.** If `libmpv.so` or the bridge cannot be loaded on a device, the module
  reports `available: false`, the Player setting is not offered and everything plays in Media3.
- **libc++.** libplacebo and uchardet use the NDK's `libc++_shared.so`, which React Native
  already packages in the app; the engine does not ship its own copy.
- **What the engine does not do on Android**, and therefore declares it does not do: bitstream
  passthrough (sound is decoded to PCM; FFmpeg has no muxers), deinterlacing (the engine does
  not ask for it; the build has FFmpeg's bwdif and yadif filters, so it could), and Dolby
  Vision profile 5 colours (mpv draws with `vo=gpu`; libplacebo's Dolby Vision reshaping is
  used only by `vo=gpu-next`). See the engine's capability profile in
  `src/bridge/mpv-profile.ts`.
- **Network.** mpv only ever reads `http://127.0.0.1:<port>/...` from the in-app relay
  (`PorticoMpvRelay`), which fetches from the server with OkHttp, so the server's certificate is
  checked exactly as for the rest of the app. mpv's own protocols are limited to plain HTTP and
  files, and it is set to verify certificates should it ever be given an HTTPS address.

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
