# Portico media engine

The second player engine in the Portico apps is [mpv](https://mpv.io). This folder builds mpv
and every library it uses from pinned source, with one recipe for Android and Apple, as
separate dynamic libraries. Nothing here is a prebuilt download except MoltenVK (Khronos's own
release build of an Apache-2.0 library).

## Why we build it ourselves (licensing in plain words)

Portico is GPLv3 and Justin owns all of its copyright, so his own code can go on the app
stores. Third-party GPL code cannot, and LGPL code can only when it is used the way the LGPL
expects: as **separate, replaceable dynamic libraries**, with the licence texts and the
**corresponding source** shipped with the app. The engines used before did not fit that well:

- Apple used MPVKit, whose FFmpeg is LGPL **version 3** (forced by GMP) and **statically
  linked**, and which bundles GnuTLS, Nettle, GMP, libbluray and uavs3d.
- Android used media-kit's `libmpv.so`: FFmpeg 6.0 under LGPL version 3 with mbedTLS, all linked
  statically into one library.

This build is **LGPL 2.1 or later** throughout (FFmpeg with no `--enable-gpl`,
`--enable-version3` or `--enable-nonfree`; mpv with `-Dgpl=false`), every library is its own
`.so` / framework, and `collect-notices.sh` produces the notices and the source bundle a release
must carry. FFmpeg is the **same version the Portico server pins**, so both ends decode alike.

## What is built

| Component | Version | Licence | Why |
|---|---|---|---|
| FFmpeg | 8.1.2 (= server pin) | LGPL-2.1-or-later | Demuxing, decoding, parsing, network reads. Every decoder, demuxer, parser and bitstream filter; no encoders, muxers or devices; a small set of filters (the ones mpv inserts itself: deinterlacing, rotation, flips). Hardware decoding: MediaCodec (Android), VideoToolbox (Apple). |
| OpenSSL | 3.5.9 (LTS) | Apache-2.0 | TLS for FFmpeg's `https` (FFmpeg accepts OpenSSL 3 without `version3` when GPL is off). Client-side algorithms only. |
| mpv | 0.41.0 | LGPL-2.1-or-later (`-Dgpl=false`) | The player core, `libmpv`. Android draws with `vo=gpu` (OpenGL ES); Apple with `vo=gpu-next` on Vulkan through MoltenVK. |
| libass | 0.17.5 | ISC | Styled (ASS/SSA) subtitles. Fonts: CoreText on Apple, the app's own fonts folder on Android. |
| FreeType | 2.15.0 | FTL | Font rasterising for libass. |
| HarfBuzz | 14.6.0 | MIT | Text shaping for libass. |
| FriBidi | 1.0.17 | LGPL-2.1-or-later | Right-to-left text for libass. |
| libunibreak | 8.0 | Zlib | Unicode line breaking for libass (CJK text without spaces wraps correctly). |
| dav1d | 1.5.4 | BSD-2-Clause | AV1 software decoding. |
| libplacebo | 7.360.1 | LGPL-2.1-or-later | mpv's renderer (mandatory since mpv 0.35): scaling, colour, HDR tone mapping. |
| Little CMS | 2.19.1 | MIT | Colour management (ICC) for libplacebo and mpv. |
| libdovi | 3.4.0 | MIT | Dolby Vision metadata for libplacebo (`vo=gpu-next`). Rust, built with cargo-c. |
| uchardet | 0.0.8 | LGPL-2.1-or-later (tri-licence) | Detects the character set of subtitles that are not UTF-8. |
| libiconv | 1.19 | LGPL-2.1-or-later | **Android only.** Converts those subtitles; Android's own iconv starts at API 28, the app supports API 24. Apple's C library has iconv. |
| MoltenVK | 1.4.2 | Apache-2.0 | **Apple only.** Vulkan on Metal. Khronos's release build (dynamic frameworks, OS 15.0+). |
| glslang | 16.6.0 | BSD-3-Clause and others | **Apple only.** GLSL to SPIR-V compiler for libplacebo's Vulkan renderer; built static (no optimizer, no HLSL) and linked into libplacebo. |

Every source URL, SHA-256 and tool version is in `sources.lock.json`. zlib is the platform's
own (the NDK's `libz.so`, Apple's `libz`). The C++ runtime on Android is the NDK's
`libc++_shared.so`, which React Native already packages; the engine does not ship a copy.

**Dropped** compared with the old engines, and why: GnuTLS, Nettle, GMP, mbedTLS (OpenSSL does
TLS); libbluray, libsmbclient, libxml2/DASH, uavs3d, Lua, LuaJIT, JavaScript (the app plays
files and HLS from its server, never discs, SMB shares, DASH or scripts); every encoder and
muxer (a player encodes nothing; S/PDIF passthrough is not used, sound is decoded to PCM).
`verify.py` fails a build that contains any of GnuTLS, Nettle, GMP, mbedTLS, x264, x265,
libbluray, libsmbclient or fdk-aac.

## Layout

```
sources.lock.json      every pinned source and tool
lib/common.sh          the shared recipe (FFmpeg configuration, mpv/libplacebo/libass options, …)
build-android.sh       Android: four ABIs, one .so per library
build-apple.sh         Apple: one dynamic framework per library, one .xcframework each
apple/Package.swift    the local Swift package both Xcode projects use (product PorticoMediaEngine)
apple/openssl-targets.conf   OpenSSL targets for iOS/tvOS devices and simulators
patches/               changes to upstream sources (see below)
verify.py              checks a finished build (licences, linking, contents, manifest)
manifest/*.json        the recorded dependency graphs verify.py compares a build with
smoke/                 android-smoke.sh: plays generated files through the engine on a device or emulator
check-ffmpeg-pin.py    fails when FFmpeg differs from the server's pin
collect-notices.sh     licence notices and the corresponding source bundle
work/  out/  apple/Frameworks/    build products (not in Git)
```

## Android (Ubuntu or macOS)

Prerequisites: the Android SDK with NDK **27.1.12297006** (the app's `ndkVersion`; `sdkmanager
"ndk;27.1.12297006"`), `rustup`, `python3` (with `venv`), `perl`, `pkg-config`, `make`, `curl`,
a C compiler for the build tools (nasm, cargo-c). No root access is needed: meson, ninja, cmake
(pip, in a venv), nasm (from source) and cargo-c (`cargo install --locked`) are installed at
their pinned versions into `work/tools`, and the four Android Rust targets with `rustup target
add`.

```bash
third_party/media-engine/build-android.sh                 # all four ABIs: ~30 min the first time on 12 cores, ~3 GB of work files
third_party/media-engine/build-android.sh --abis x86_64   # one emulator architecture
MEDIA_ENGINE_JOBS=4 MEDIA_ENGINE_WORK_DIR=/big/disk/work third_party/media-engine/build-android.sh
```

The output is `out/android/`: `lib/<abi>/*.so` (twenty libraries per ABI, stripped, plain
SONAMEs such as `libavcodec.so`, 16 KB page alignment), `include/mpv/`, `meta/<abi>/` (FFmpeg's
configuration and component list, mpv's features), `notices/`, `source/`, `manifest.json`.
`apps/native/android/portico-mpv/build.gradle` packages it; `-PporticoLibmpvDir=` points it
elsewhere. Each component is rebuilt only when its pin, its recipe or an earlier component
changes; `--clean` starts over.

### Smoke test on a device or emulator

`smoke/android-smoke.sh [--abi x86_64]` compiles a small libmpv program (`smoke/mpv-smoke.c`),
pushes it with the libraries to the connected device or emulator (`ANDROID_SERIAL` to choose),
makes test files with this machine's `ffmpeg`, and plays each to the end with no video or audio
output: H.264/AAC with ASS subtitles in MKV, HEVC Main 10 in MP4, AV1 (dav1d) with Opus, VP9,
MPEG-2/AC-3 in TS, E-AC-3, FLAC, HLS, a Windows-1251 SRT that must come out as UTF-8, and TLS
(refused without trusted roots, accepted with them). It proves the libraries load and decode on
the device's own C library; MediaCodec, drawing and the app are tested in the app.

## Apple (on a Mac)

Prerequisites: Xcode 16 or later with the iOS and tvOS platforms installed, `rustup`, `python3`,
`perl`, `pkg-config` (`brew install pkgconf`), `curl`. Everything else is installed into
`work/tools` at its pinned version.

```bash
third_party/media-engine/build-apple.sh
```

Slices: iOS device (arm64), iOS simulator (arm64 + x86_64), tvOS device (arm64), tvOS
simulator (arm64 only: Rust has no x86_64 tvOS simulator target). Minimum OS: the deployment
targets of the Xcode projects (15.1), which the script reads from both `project.pbxproj` files
and checks against the lock. Each library becomes `Lib<name>.framework` (install name
`@rpath/Lib<name>.framework/Lib<name>`, an Info.plist with bundle id
`tv.getportico.media-engine.lib<name>`, a `PrivacyInfo.xcprivacy` declaring the
required-reason APIs its binary actually imports, and its licence notice), combined into
`out/apple/xcframeworks/Lib<name>.xcframework` and copied to `apple/Frameworks/` for the Swift
package. `Libmpv.framework` carries mpv's headers and a module map, so the engine's
`import Libmpv` / `#if canImport(Libmpv)` code is unchanged.

### Apple playbook (first build and test on the Mac)

1. **Prerequisites.** Xcode 16+ selected (`xcode-select -p`), iOS and tvOS platforms installed
   (Xcode > Settings > Components), `rustup` (`curl https://sh.rustup.rs -sSf | sh`, then
   `rustup toolchain install 1.99.0` if `rustc --version` differs), `brew install pkgconf`.
   About 15 GB free.
2. **Build the engine** from the repository root: `third_party/media-engine/build-apple.sh`
   (about an hour the first time; it stops early and says why if Xcode, an SDK, a tool or a
   checksum is wrong). It ends by running `verify.py apple`.
3. **First verify run.** `manifest/apple.json` was derived from the Android build (it could not
   be produced without a Mac). If verify reports differences in that file only, read them: each
   framework should load only other engine frameworks and Apple system libraries. If they are
   right, record them with `python3 third_party/media-engine/verify.py apple --update-expected`
   and commit `third_party/media-engine/manifest/apple.json`. Any other failure is a real problem.
4. **Pods**: `cd apps/native/ios && pod install`, and the same in `apps/native/tvos`.
5. **Open** `apps/native/ios/Portico.xcworkspace`. The `PorticoMediaEngine` package appears
   under Package Dependencies as a local package; if Xcode shows "missing binary target", step 2
   did not finish. Build for an iOS simulator, then for a device; then the same for
   `apps/native/tvos` (tvOS simulator on an Apple-silicon Mac).
6. **What to test first**, on a device:
   - Settings > Player: choose mpv. Play an H.264 MP4, an HEVC 10-bit HDR MKV, an AV1 file
     (software, dav1d) and an HLS stream from the server.
   - Styled ASS subtitles (positioning, fonts), a PGS subtitle track, a non-UTF-8 SRT (Cyrillic
     or Chinese) that must display correctly (uchardet + iconv).
   - A Dolby Vision profile 8 and, if available, profile 5 title (colours must be right on an
     HDR and an SDR screen).
   - Seek, pause in the background, audio track switching, 5.1 audio over HDMI/AirPlay.
   - `Console.app` (or Xcode's console) shows no `dyld` "Library not loaded" errors when the
     app starts (a wrong install name would show there).
   - Archive a Release build and run Xcode's "Validate App": every embedded framework must pass
     (bundle ids, minimum OS, privacy manifests).
7. Report the results and any `verify.py` failures.

## Verify

`verify.py android|apple` runs at the end of each build; run it again any time. It reads ELF
and Mach-O files directly (no other tools) and checks: FFmpeg's licence is "LGPL version 2.1 or
later" and its configuration has no gpl/version3/nonfree; mpv is `gpl=false`; no forbidden
library is linked or embedded (dependency names, symbols and tell-tale strings); exactly the
expected libraries exist, each names itself correctly and contains no copy of another (FFmpeg
and OpenSSL are not inside libmpv); every dependency is one of ours or an allowed system
library; Android: plain SONAMEs, 16 KB alignment, stripped; Apple: `@rpath` install names,
minimum OS, Info.plist, privacy manifest, module map; the decoders, demuxers, parsers,
protocols, filters and hardware decoders the app relies on are present; the dependency graph
matches `manifest/<platform>.json`; the notices and source bundle exist. `--update-expected`
re-records the manifest after an intended change.

## Releasing: notices and corresponding source

`collect-notices.sh` (run by the build scripts) writes `out/<platform>/notices/` and
`out/<platform>/source/portico-media-engine-<platform>-source-r<revision>.tar` (the source
archives exactly as pinned, libdovi's vendored Rust crates, this recipe and its patches) with
its SHA-256. The notices go into the apps automatically (Android:
`assets/media-engine/THIRD-PARTY-NOTICES.txt`; Apple: `NOTICE.txt` in every framework and the
full file in `Libmpv.framework`). **Each release must publish the source bundle** next to the
app (for example as a release asset); the notice text says it is published with each release.

## Updating a component

1. Change its `version`, `url`, `file` and `sha256` in `sources.lock.json` (download it and run
   `sha256sum`), bump `revision`.
2. FFmpeg: change it only together with the server
   (`main-server/third_party/ffmpeg/sources.lock.json`), then run
   `./check-ffmpeg-pin.py <server>/third_party/ffmpeg/sources.lock.json`.
3. libplacebo: also update `subsources` to the submodule commits of the new tag
   (`https://api.github.com/repos/haasn/libplacebo/contents/3rdparty?ref=<tag>`).
4. mpv: check that `patches/mpv/*.patch` still applies (the build stops if not).
5. Rebuild both platforms; `verify.py` must pass. If the dependency graph changed on purpose,
   review it and run `verify.py <platform> --update-expected`.
6. A new tool version: change it in `tools`; the scripts reinstall it.

## Patches

- `patches/mpv/0001-vulkan-moltenvk-context-for-ios-and-tvos.patch`: mpv has no Vulkan context
  for iOS/tvOS. This adds `--gpu-context=moltenvk`, which renders into a `CAMetalLayer` the app
  passes as `wid` (what `Native/PorticoMpvCore.swift` does), and a `moltenvk` build option. It
  also stops mpv's build from adding the Mac's own library folders (`-L/usr/local/lib`) to the
  link when cross-compiling for iOS/tvOS. Written for Portico; LGPL-2.1-or-later like mpv.

- `patches/libdovi/0001-build-the-library-without-benchmark-dependencies.patch`: removes
  libdovi's benchmark-only dependency (criterion) and the 61 lock entries only it needed, so the
  vendored Rust crates in the source bundle are 19 MB instead of 190 MB (mostly Windows import
  libraries). Every remaining crate keeps the version and checksum upstream's `Cargo.lock` pins.

## Certificate trust

mpv never connects to the server itself: the engines give it `http://127.0.0.1:<port>/...` and
the in-app relay (`PorticoMpvRelay`, Android and Apple) fetches from the server with the app's
own HTTP client (OkHttp / URLSession), so certificates are checked exactly as for every other
request, including an owner's own certificate for their domain, and plain HTTP keeps working.
mpv's protocols are limited to `file,http,tcp,crypto` (no `https`, no `tls`), and `tls-verify`
is set to `yes`: should mpv ever be handed an HTTPS address, it verifies the certificate and
refuses rather than trusting it unchecked, as mpv does by default. No root-certificate bundle is
shipped: it would be a second, unmaintained trust store beside the system's.
