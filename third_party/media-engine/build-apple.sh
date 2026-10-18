#!/usr/bin/env bash
# Builds the media engine for iPhone, iPad and Apple TV from the pinned sources in
# sources.lock.json, as one dynamic framework per library, each combined into an .xcframework.
# Run it on a Mac before opening the Xcode projects (like `pod install`):
#
#   third_party/media-engine/build-apple.sh            # everything (about an hour the first time)
#   third_party/media-engine/build-apple.sh --clean    # forget earlier builds first
#
# Slices: iOS device (arm64), iOS simulator (arm64 + x86_64), tvOS device (arm64), tvOS
# simulator (arm64; Rust has no x86_64 tvOS simulator target, which libdovi needs).
#
# Output:
#   out/apple/xcframeworks/<Name>.xcframework   Libmpv, Libavcodec, ... Libssl, Libcrypto, MoltenVK
#   apple/Frameworks/                           the same, where the local Swift package
#                                               (apple/Package.swift, product PorticoMediaEngine)
#                                               that both Xcode projects use finds them
#   out/apple/meta/<slice>/                     FFmpeg's configuration, mpv's feature list
#   out/apple/notices/, out/apple/source/       licence texts and the corresponding source
#
# Needs: macOS with Xcode (see sources.lock.json for the minimum) and its command line tools,
# rustup, python3, perl, pkg-config (brew install pkgconf), curl. meson, ninja, cmake, nasm and
# cargo-c are installed into the work directory at their pinned versions.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
set -E
trap 'me_say "Command failed at line $LINENO (status $?): $BASH_COMMAND"' ERR
trap 'me_say "Command failed at line $LINENO (status $?): $BASH_COMMAND"' ERR

CLEAN=0
SLICES="ios ios-simulator tvos tvos-simulator"
while (( $# )); do
    case "$1" in
        --clean) CLEAN=1; shift ;;
        --slices) (( $# >= 2 )) || me_die "--slices needs a space-separated list"; SLICES="$2"; shift 2 ;;
        -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
        *) me_die "Unknown argument $1 (see --help)" ;;
    esac
done

[[ -n "$SLICES" ]] || me_die "Select at least one Apple slice"
seen=" "
for slice in $SLICES; do
    case "$slice" in ios|ios-simulator|tvos|tvos-simulator) ;; *) me_die "Unknown Apple slice: $slice" ;; esac
    [[ "$seen" != *" $slice "* ]] || me_die "Duplicate Apple slice: $slice"
    seen+="$slice "
done

PLATFORM=apple
NATIVE="$ME_ROOT/../../apps/native"

# ---------------------------------------------------------------------------------------------
# Fail early: wrong machine, missing or old Xcode, missing tools, deployment targets that no
# longer match the Xcode projects.

[[ "$(uname -s)" == Darwin ]] || me_die "build-apple.sh runs on a Mac (Android: build-android.sh)."
command -v xcodebuild >/dev/null || me_die "Xcode is not installed (xcodebuild is missing)."
XCODE_VERSION=$(xcodebuild -version 2>/dev/null | sed -n 's/^Xcode //p')
[[ -n "$XCODE_VERSION" ]] || me_die "xcodebuild did not report a version. Run: sudo xcode-select -s /Applications/Xcode.app"
# Xcode's developer folder: the compilers and SDKs live here, and it is mapped to a neutral name.
DEVELOPER_DIR_PATH=$(xcode-select -p)
XCODE_MIN=$(me_lock tool xcode minimum)
python3 -I -c 'import sys; a=[int(x) for x in sys.argv[1].split(".")]; b=[int(x) for x in sys.argv[2].split(".")]; sys.exit(0 if a>=b else 1)' \
    "$XCODE_VERSION" "$XCODE_MIN" || me_die "Xcode $XCODE_VERSION is older than the required $XCODE_MIN."
for tool in xcrun lipo install_name_tool otool codesign plutil nm strip; do
    command -v "$tool" >/dev/null || xcrun -f "$tool" >/dev/null 2>&1 || me_die "$tool is missing (install Xcode's command line tools)."
done
for sdk in iphoneos iphonesimulator appletvos appletvsimulator; do
    xcrun --sdk "$sdk" --show-sdk-path >/dev/null 2>&1 || me_die "The $sdk SDK is missing from Xcode $XCODE_VERSION (Xcode > Settings > Components)."
done

deployment_target() {  # <ios|tvos> -> the highest deployment target in that Xcode project
    local key project
    [[ "$1" == ios ]] && key=IPHONEOS_DEPLOYMENT_TARGET || key=TVOS_DEPLOYMENT_TARGET
    project="$NATIVE/$1/Portico.xcodeproj/project.pbxproj"
    [[ -f "$project" ]] || me_die "$project not found."
    sed -n "s/.*$key = \([0-9.]*\);.*/\1/p" "$project" | sort -t. -k1,1n -k2,2n | tail -1
}
IOS_MIN=$(deployment_target ios)
TVOS_MIN=$(deployment_target tvos)
[[ "$IOS_MIN" == "$(me_lock tool apple-deployment ios)" && "$TVOS_MIN" == "$(me_lock tool apple-deployment tvos)" ]] \
    || me_die "The Xcode projects target iOS $IOS_MIN / tvOS $TVOS_MIN, sources.lock.json says $(me_lock tool apple-deployment ios) / $(me_lock tool apple-deployment tvos). Update the lock (and rebuild)."

me_check_disk 30
(( CLEAN )) && rm -rf "$ME_WORK/build/$PLATFORM" "$ME_WORK/prefix/$PLATFORM" "$ME_WORK/stamps/$PLATFORM" "$ME_WORK/frameworks" "$ME_OUT/$PLATFORM"
mkdir -p "$ME_LOGS" "$ME_WORK/stamps/$PLATFORM"
me_tools

# ---------------------------------------------------------------------------------------------
# Per-target toolchain settings. A target is one slice and one architecture.

TARGETS=""
for slice in $SLICES; do
    TARGETS+="$slice:arm64 "
    [[ "$slice" != ios-simulator ]] || TARGETS+="$slice:x86_64 "
done

set_target() {
    SLICE="${1%%:*}"; ARCH="${1##*:}"
    case "$SLICE" in
        ios)            SDK=iphoneos;         MIN=$IOS_MIN;  TRIPLE="$ARCH-apple-ios$MIN";            SUBSYSTEM=ios ;;
        ios-simulator)  SDK=iphonesimulator;  MIN=$IOS_MIN;  TRIPLE="$ARCH-apple-ios$MIN-simulator";  SUBSYSTEM=ios-simulator ;;
        tvos)           SDK=appletvos;        MIN=$TVOS_MIN; TRIPLE="$ARCH-apple-tvos$MIN";           SUBSYSTEM=tvos ;;
        tvos-simulator) SDK=appletvsimulator; MIN=$TVOS_MIN; TRIPLE="$ARCH-apple-tvos$MIN-simulator"; SUBSYSTEM=tvos-simulator ;;
    esac
    case "$SLICE:$ARCH" in
        ios:arm64)            RUST=aarch64-apple-ios ;;
        ios-simulator:arm64)  RUST=aarch64-apple-ios-sim ;;
        ios-simulator:x86_64) RUST=x86_64-apple-ios ;;
        tvos:arm64)           RUST=aarch64-apple-tvos ;;
        tvos-simulator:arm64) RUST=aarch64-apple-tvos-sim ;;
        *) me_die "No Rust target for $SLICE $ARCH" ;;
    esac
    [[ "$ARCH" == arm64 ]] && { CPU_FAMILY=aarch64; FF_ARCH=aarch64; OSSL=portico-apple-arm64; } \
                           || { CPU_FAMILY=x86_64;  FF_ARCH=x86_64;  OSSL=portico-apple-x86_64; }
    SYSROOT=$(xcrun --sdk "$SDK" --show-sdk-path)
    TAG="$SLICE-$ARCH"
    PREFIX="$ME_WORK/prefix/$PLATFORM/$TAG"
    BUILD="$ME_WORK/build/$PLATFORM/$TAG"
    mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include" "$PREFIX/Frameworks" "$BUILD"
    export CC="$(xcrun --sdk "$SDK" -f clang)" CXX="$(xcrun --sdk "$SDK" -f clang++)"
    export AR="$(xcrun --sdk "$SDK" -f ar)" RANLIB="$(xcrun --sdk "$SDK" -f ranlib)"
    export NM="$(xcrun --sdk "$SDK" -f nm)" STRIP="$(xcrun --sdk "$SDK" -f strip)"
    export SDKROOT="$SYSROOT"
    export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" PKG_CONFIG_PATH="" PKG_CONFIG_SYSROOT_DIR=""
    # Deployment targets for anything that reads them from the environment (Rust, CMake).
    unset IPHONEOS_DEPLOYMENT_TARGET TVOS_DEPLOYMENT_TARGET
    [[ "$SLICE" == ios* ]] && export IPHONEOS_DEPLOYMENT_TARGET="$MIN" || export TVOS_DEPLOYMENT_TARGET="$MIN"
    # Joined forms (--target=, -isysroot<dir>): OpenSSL's Configure would read a separate
    # argument as a target name. The SDK path has no spaces in a standard Xcode install.
    [[ "$SYSROOT" != *" "* ]] || me_die "The SDK path contains a space: $SYSROOT"
    # No build-machine folders in the libraries (lib/common.sh, "Neutral paths").
    CFLAGS_T="--target=$TRIPLE -isysroot$SYSROOT -fPIC -fstack-protector-strong $(me_path_map_cflags "$DEVELOPER_DIR_PATH")"
    # Room for the install names the frameworks get later; only libraries actually used are linked.
    LDFLAGS_T="--target=$TRIPLE -isysroot$SYSROOT -Wl,-headerpad_max_install_names -Wl,-dead_strip_dylibs"
    write_cross_file
}

meson_list() { local out="" a; for a in "$@"; do out+="'$a', "; done; printf '[%s]' "${out%, }"; }

write_cross_file() {
    # shellcheck disable=SC2086
    cat > "$BUILD/cross.ini" <<EOF
[binaries]
c = '$CC'
cpp = '$CXX'
objc = '$CC'
objcpp = '$CXX'
ar = '$AR'
nm = '$NM'
strip = '$STRIP'
ranlib = '$RANLIB'
pkg-config = '$(command -v pkg-config)'
nasm = '$(command -v nasm)'

[built-in options]
c_args = $(meson_list $CFLAGS_T "-I$PREFIX/include")
cpp_args = $(meson_list $CFLAGS_T "-I$PREFIX/include")
objc_args = $(meson_list $CFLAGS_T "-I$PREFIX/include")
c_link_args = $(meson_list $LDFLAGS_T "-L$PREFIX/lib")
cpp_link_args = $(meson_list $LDFLAGS_T "-L$PREFIX/lib")
objc_link_args = $(meson_list $LDFLAGS_T "-L$PREFIX/lib")

[properties]
needs_exe_wrapper = true
pkg_config_libdir = '$PREFIX/lib/pkgconfig'

[host_machine]
system = 'darwin'
subsystem = '$SUBSYSTEM'
kernel = 'xnu'
cpu_family = '$CPU_FAMILY'
cpu = '$ARCH'
endian = 'little'
EOF
    # Generators such as FriBidi's Unicode tables run on the build Mac. The
    # exported SDKROOT/CC describe the Apple device, so configure native tools
    # explicitly with the macOS SDK and target instead of inheriting them.
    local host_sdk host_cc host_cxx host_target
    host_sdk=$(xcrun --sdk macosx --show-sdk-path)
    host_cc=$(xcrun --sdk macosx -f clang)
    host_cxx=$(xcrun --sdk macosx -f clang++)
    host_target="$(uname -m)-apple-macos11.0"
    cat > "$BUILD/native.ini" <<EOF
[binaries]
c = '$host_cc'
cpp = '$host_cxx'

[built-in options]
c_args = ['--target=$host_target', '-isysroot$host_sdk']
cpp_args = ['--target=$host_target', '-isysroot$host_sdk']
c_link_args = ['--target=$host_target', '-isysroot$host_sdk']
cpp_link_args = ['--target=$host_target', '-isysroot$host_sdk']
EOF
}

meson_build() {
    local name="$1"; shift
    local dir="$BUILD/$name"
    rm -rf "$dir"
    meson setup "$dir" "$ME_WORK/src/$name" --cross-file "$BUILD/cross.ini" --native-file "$BUILD/native.ini" \
        --prefix "$PREFIX" --libdir lib --buildtype release --default-library shared \
        --wrap-mode nodownload "$@"
    # mpv writes its configure command line and config folder into config.h.
    [[ -f "$dir/config.h" ]] && me_neutralize "$DEVELOPER_DIR_PATH" "$dir/config.h"
    ninja -C "$dir" -j "$ME_JOBS"
    ninja -C "$dir" install
}

cmake_apple() {  # <name> <source dir> <cmake args...>
    local name="$1" src="$2" dir="$BUILD/$1"; shift 2
    local system=iOS; [[ "$SLICE" == tvos* ]] && system=tvOS
    rm -rf "$dir"
    cmake -S "$src" -B "$dir" -G Ninja \
        -DCMAKE_SYSTEM_NAME="$system" -DCMAKE_OSX_SYSROOT="$SYSROOT" -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN" -DCMAKE_C_COMPILER="$CC" -DCMAKE_CXX_COMPILER="$CXX" \
        -DCMAKE_C_FLAGS="$CFLAGS_T" -DCMAKE_CXX_FLAGS="$CFLAGS_T" \
        -DCMAKE_SHARED_LINKER_FLAGS="$LDFLAGS_T" -DCMAKE_EXE_LINKER_FLAGS="$LDFLAGS_T" \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
        -DCMAKE_INSTALL_NAME_DIR="$PREFIX/lib" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
        -DCMAKE_MACOSX_BUNDLE=OFF "$@"
    cmake --build "$dir" -j "$ME_JOBS"
    cmake --install "$dir"
}

# ---------------------------------------------------------------------------------------------
# Components, in dependency order.

build_openssl() {
    cd "$ME_WORK/src/openssl"
    make distclean >/dev/null 2>&1 || true
    # OpenSSL's own iOS targets hard-code iphoneos and an old minimum OS; these two targets
    # inherit its iOS settings (no async, which needs ucontext) and take the compiler and
    # flags from here, so the same recipe serves iOS, tvOS and both simulators.
    CC="$CC" ./Configure "$OSSL" --config="$ME_ROOT/apple/openssl-targets.conf" \
        --prefix="$PREFIX" --libdir=lib --openssldir=/dev/null/portico-no-openssl-dir \
        $(me_openssl_common_flags) $CFLAGS_T $LDFLAGS_T
    # Engines and modules are not built (no-engine, no-module); their folders must not name the
    # work directory either. The "compiler:" line OpenSSL_version() reports is made neutral.
    local dirs=(ENGINESDIR=/dev/null/portico-no-engines MODULESDIR=/dev/null/portico-no-modules)
    make "${dirs[@]}" crypto/buildinf.h
    me_neutralize "$DEVELOPER_DIR_PATH" crypto/buildinf.h
    make -j"$ME_JOBS" "${dirs[@]}" build_libs
    make "${dirs[@]}" install_dev
}

build_fribidi() { meson_build fribidi $(me_fribidi_common_flags); }

build_freetype() { meson_build freetype $(me_freetype_common_flags); }

build_harfbuzz() { meson_build harfbuzz $(me_harfbuzz_common_flags); }

build_libunibreak() {
    cd "$ME_WORK/src/libunibreak"
    make distclean >/dev/null 2>&1 || true
    ./configure --host="${ARCH/arm64/aarch64}-apple-darwin" --prefix="$PREFIX" --libdir="$PREFIX/lib" \
        --enable-shared --disable-static CC="$CC" CFLAGS="$CFLAGS_T -O2" LDFLAGS="$LDFLAGS_T"
    make -j"$ME_JOBS"
    make install
    rm -f "$PREFIX"/lib/libunibreak.la
}

build_libass() {
    meson_build libass $(me_libass_common_flags) -Dcoretext=enabled -Drequire-system-font-provider=true -Dasm=enabled
}

build_dav1d() { meson_build dav1d $(me_dav1d_common_flags) -Denable_asm=true; }

build_lcms2() { meson_build lcms2 $(me_lcms2_common_flags); }

build_libdovi() {
    cd "$ME_WORK/src/libdovi/dolby_vision"
    export CARGO_HOME="$ME_WORK/cargo-home"
    # Source folders in panic messages: neutral names (flags separated by 0x1f).
    local flags=() f
    while read -r f; do flags+=("$f"); done < <(me_rust_remap_flags)
    unset RUSTFLAGS
    export CARGO_ENCODED_RUSTFLAGS="$(IFS=$'\x1f'; printf '%s' "${flags[*]}")"
    rustup target list --installed | grep -qx "$RUST" || rustup target add "$RUST"
    cargo cinstall --profile release-deploy --locked --offline --target "$RUST" --library-type cdylib \
        --prefix "$PREFIX" --libdir "$PREFIX/lib" --target-dir "$BUILD/libdovi" -j "$ME_JOBS"
}

build_uchardet() {
    cmake_apple uchardet "$ME_WORK/src/uchardet" -DBUILD_BINARY=OFF -DBUILD_STATIC=OFF -DBUILD_SHARED_LIBS=ON
}

build_glslang() {
    # Static, no optimizer, no HLSL: only what libplacebo calls. Linked into libplacebo.
    cmake_apple glslang "$ME_WORK/src/glslang" -DBUILD_SHARED_LIBS=OFF -DENABLE_OPT=OFF -DENABLE_HLSL=OFF \
        -DENABLE_GLSLANG_BINARIES=OFF -DGLSLANG_TESTS=OFF -DBUILD_EXTERNAL=OFF -DENABLE_PCH=OFF \
        -DGLSLANG_ENABLE_INSTALL=ON
}

build_moltenvk() {
    # Khronos's own dynamic framework for this slice, and a vulkan.pc that points at it with
    # the Vulkan headers libplacebo is generated from.
    local id
    case "$SLICE" in
        ios) id=ios-arm64 ;;
        ios-simulator) id=ios-arm64_x86_64-simulator ;;
        tvos) id=tvos-arm64_arm64e ;;
        tvos-simulator) id=tvos-arm64_x86_64-simulator ;;
    esac
    rm -rf "$PREFIX/Frameworks/MoltenVK.framework"
    cp -R "$ME_WORK/src/moltenvk/MoltenVK/dynamic/MoltenVK.xcframework/$id/MoltenVK.framework" "$PREFIX/Frameworks/"
    local headers="$ME_WORK/src/libplacebo/3rdparty/Vulkan-Headers/include"
    local version
    version=$(sed -n 's/^#define VK_HEADER_VERSION \([0-9]*\)$/\1/p' "$headers/vulkan/vulkan_core.h")
    [[ -n "$version" ]] || me_die "Could not read VK_HEADER_VERSION."
    cat > "$PREFIX/lib/pkgconfig/vulkan.pc" <<EOF
Name: Vulkan-Loader
Description: Vulkan on Metal (MoltenVK $(me_lock moltenvk version))
Version: 1.4.$version
Libs: -F$PREFIX/Frameworks -framework MoltenVK
Cflags: -I$headers
EOF
}

build_libplacebo() {
    meson_build libplacebo $(me_libplacebo_common_flags) -Dvulkan=enabled -Dvk-proc-addr=enabled \
        -Dopengl=disabled -Dglslang=enabled -Dvulkan-sdk="$PREFIX"
}

build_ffmpeg() {
    local dir="$BUILD/ffmpeg" asm=()
    rm -rf "$dir"; mkdir -p "$dir"; cd "$dir"
    [[ "$ARCH" == x86_64 ]] && asm=(--x86asmexe=nasm)
    "$ME_WORK/src/ffmpeg/configure" \
        --prefix="$PREFIX" --libdir="$PREFIX/lib" \
        --target-os=darwin --enable-cross-compile --arch="$FF_ARCH" \
        --cc="$CC" --cxx="$CXX" --ar="$AR" --nm="$NM" --ranlib="$RANLIB" --strip="$STRIP" \
        --pkg-config=pkg-config --host-cc="$(xcrun --sdk macosx -f clang)" \
        --host-cflags="-isysroot$(xcrun --sdk macosx --show-sdk-path)" --host-ldflags="-isysroot$(xcrun --sdk macosx --show-sdk-path)" \
        --extra-cflags="$CFLAGS_T -I$PREFIX/include" --extra-ldflags="$LDFLAGS_T -L$PREFIX/lib" \
        --install-name-dir='@rpath' \
        $(me_ffmpeg_common_flags) \
        --enable-videotoolbox \
        ${asm[@]+"${asm[@]}"}
    # av*_configuration() reports this command line: neutral folders only.
    me_neutralize "$DEVELOPER_DIR_PATH" config.h
    make -j"$ME_JOBS"
    make install
    if [[ "$ARCH" == arm64 ]]; then
        mkdir -p "$ME_OUT/$PLATFORM/meta/$SLICE"
        cp config.h "$ME_OUT/$PLATFORM/meta/$SLICE/ffmpeg-config.h"
        cp config_components.h "$ME_OUT/$PLATFORM/meta/$SLICE/ffmpeg-config_components.h"
    fi
}

build_mpv() {
    # mpv adds Objective-C (needed for its iOS/tvOS audio output and the MoltenVK context) only
    # once it has found an SDK; these two variables give it the target SDK instead of macOS's.
    MACOS_SDK="$SYSROOT" MACOS_SDK_VERSION="$(xcrun --sdk "$SDK" --show-sdk-version)" \
    meson_build mpv $(me_mpv_common_flags) \
        -Dcocoa=disabled -Dswift-build=disabled -Dmacos-cocoa-cb=disabled -Dmacos-media-player=disabled \
        -Dmacos-touchbar=disabled -Dcoreaudio=disabled -Davfoundation=disabled -Daudiounit=enabled \
        -Dgl=disabled -Dplain-gl=disabled -Dios-gl=disabled -Dvideotoolbox-gl=disabled \
        -Dvulkan=enabled -Dmoltenvk=enabled -Dvideotoolbox-pl=enabled
    if [[ "$ARCH" == arm64 ]]; then
        mkdir -p "$ME_OUT/$PLATFORM/meta/$SLICE"
        cp "$BUILD/mpv/config.h" "$ME_OUT/$PLATFORM/meta/$SLICE/mpv-config.h"
    fi
}

# ---------------------------------------------------------------------------------------------

ORDER="openssl fribidi freetype harfbuzz libunibreak libass dav1d lcms2 libdovi uchardet glslang moltenvk libplacebo ffmpeg mpv"
for name in $ORDER; do
    me_components "$PLATFORM" | grep -qx "$name" || me_die "Component $name is not in sources.lock.json for $PLATFORM."
done
for name in $(me_components "$PLATFORM"); do
    [[ " $ORDER " == *" $name "* ]] || me_die "sources.lock.json names $name for $PLATFORM, but this script does not build it."
done

me_say "Checking sources"
me_fetch_all "$PLATFORM"
mkdir -p "$ME_WORK/src"

component_key() {
    local name="$1" previous="$2"
    {
        echo "$previous"; echo "$XCODE_VERSION"
        python3 -I -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["components"][sys.argv[2]], sort_keys=True))' "$ME_LOCK" "$name"
        declare -f "build_$name" set_target write_cross_file meson_build cmake_apple
        declare -f me_path_forms me_path_map_pairs me_path_map_cflags me_rust_remap_flags me_neutralize
        declare -f me_ffmpeg_common_flags me_openssl_common_flags me_mpv_common_flags me_libplacebo_common_flags \
            me_libass_common_flags me_harfbuzz_common_flags me_freetype_common_flags me_fribidi_common_flags \
            me_dav1d_common_flags me_lcms2_common_flags
        cat "$ME_ROOT/patches/$name"/*.patch "$ME_ROOT/apple/openssl-targets.conf" 2>/dev/null || true
    } | shasum -a 256 | cut -d' ' -f1
}

EXTRACTED=" "
prepare_source() {
    local name="$1"
    [[ "$EXTRACTED" == *" $name "* ]] && return
    if [[ "$name" == moltenvk ]]; then
        rm -rf "$ME_WORK/src/moltenvk"; mkdir -p "$ME_WORK/src/moltenvk"
        tar -xf "$ME_DOWNLOADS/$(me_lock moltenvk file)" -C "$ME_WORK/src/moltenvk" --strip-components=1 \
            MoltenVK/LICENSE MoltenVK/MoltenVK/dynamic/MoltenVK.xcframework
    else
        me_extract "$name"
    fi
    [[ "$name" == libdovi ]] && me_vendor_libdovi
    EXTRACTED+="$name "
}
# libplacebo's Vulkan headers are needed by the MoltenVK step, before libplacebo itself.
prepare_source libplacebo

for target in $TARGETS; do
    set_target "$target"
    key=""
    for name in $ORDER; do
        key=$(component_key "$name" "$key")
        stamp="$ME_WORK/stamps/$PLATFORM/$TAG-$name"
        if [[ -f "$stamp" && "$(cat "$stamp")" == "$key" ]]; then
            me_say "$TAG: $name is up to date"
            continue
        fi
        rm -f "$stamp"
        prepare_source "$name"
        me_check_disk 10
        me_say "$TAG: building $name"
        log="$ME_LOGS/$PLATFORM-$TAG-$name.log"
        set +e
        ( set -euo pipefail -x; "build_$name" ) > "$log" 2>&1
        status=$?
        set -e
        if (( status != 0 )); then
            tail -40 "$log" >&2
            me_die "$name failed for $TAG. Full log: $log"
        fi
        echo "$key" > "$stamp"
    done
done

# ---------------------------------------------------------------------------------------------
# Frameworks.

# A restored component cache contains prefixes/build trees, while out/ is
# regenerated. Restore inspection metadata even when every compile is up to date.
mkdir -p "$ME_OUT/$PLATFORM"
for slice in $SLICES; do
    meta="$ME_OUT/$PLATFORM/meta/$slice"
    cached_build="$ME_WORK/build/$PLATFORM/$slice-arm64"
    mkdir -p "$meta"
    cp "$cached_build/ffmpeg/config.h" "$meta/ffmpeg-config.h"
    cp "$cached_build/ffmpeg/config_components.h" "$meta/ffmpeg-config_components.h"
    cp "$cached_build/mpv/config.h" "$meta/mpv-config.h"
done
me_write_build_info "$PLATFORM" "$ME_OUT/$PLATFORM/build-info.json"
"$ME_ROOT/collect-notices.sh" "$PLATFORM"

# library stem -> component (for the version and the notice)
STEMS="avcodec:ffmpeg avformat:ffmpeg avutil:ffmpeg avfilter:ffmpeg swresample:ffmpeg swscale:ffmpeg
ssl:openssl crypto:openssl mpv:mpv ass:libass freetype:freetype harfbuzz:harfbuzz fribidi:fribidi
unibreak:libunibreak dav1d:dav1d placebo:libplacebo lcms2:lcms2 dovi:libdovi uchardet:uchardet"
REVISION=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["revision"])' "$ME_LOCK")
FW="$ME_WORK/frameworks"
XC="$ME_OUT/$PLATFORM/xcframeworks"
rm -rf "$FW" "$XC"; mkdir -p "$FW" "$XC"

# The real (not symlinked) dylib of a library in a prefix.
dylib_of() {  # <prefix> <stem>
    local f
    for f in "$1/lib/lib$2".*dylib "$1/lib/lib$2.dylib"; do
        [[ -f "$f" && ! -L "$f" ]] && { echo "$f"; return; }
    done
    me_die "lib$2 was not built in $1"
}

stem_of_install_name() {  # an install name of one of our libraries -> its stem, or nothing
    local base; base=$(basename "$1")
    base=${base#lib}; base=${base%%.*}
    for pair in $STEMS; do [[ "${pair%%:*}" == "$base" ]] && { echo "$base"; return; }; done
    # System libraries are intentionally not rewritten. An empty successful
    # result lets the caller continue under set -e while preserving their names.
    return 0
}

platform_names() {  # <slice> -> CFBundleSupportedPlatforms value and UIDeviceFamily
    case "$1" in
        ios) echo "iPhoneOS 1,2" ;; ios-simulator) echo "iPhoneSimulator 1,2" ;;
        tvos) echo "AppleTVOS 3" ;; tvos-simulator) echo "AppleTVSimulator 3" ;;
    esac
}

write_info_plist() {  # <framework dir> <name> <version> <slice>
    local fw="$1" name="$2" version="$3" slice="$4" min plat family
    read -r plat family <<< "$(platform_names "$slice")"
    [[ "$slice" == ios* ]] && min=$IOS_MIN || min=$TVOS_MIN
    python3 -I - "$fw/Info.plist" "$name" "$version" "$REVISION" "$plat" "$family" "$min" <<'EOF'
import plistlib, sys, re
path, name, version, revision, plat, family, minimum = sys.argv[1:]
short = ".".join((re.findall(r"\d+", version) + ["0", "0"])[:3])
plistlib.dump({
    "CFBundleDevelopmentRegion": "en",
    "CFBundleExecutable": name,
    "CFBundleIdentifier": "tv.getportico.media-engine." + name.lower(),
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": name,
    "CFBundlePackageType": "FMWK",
    "CFBundleShortVersionString": short,
    "CFBundleVersion": revision,
    "CFBundleSupportedPlatforms": [plat],
    "MinimumOSVersion": minimum,
    "UIDeviceFamily": [int(x) for x in family.split(",")],
}, open(path, "wb"))
EOF
}

# The privacy manifest Apple requires of SDKs that use "required reason" APIs. The binary's
# imported symbols decide what is declared; an API with no reason that fits these libraries
# stops the build so a person decides, rather than a reason being guessed.
write_privacy_manifest() {  # <framework dir> <binary>
    local fw="$1" binary="$2"
    xcrun nm -u -arch all "$binary" 2>/dev/null | sed 's/^ *//' | sort -u > "$ME_WORK/imports.txt"
    python3 -I - "$ME_WORK/imports.txt" "$fw/PrivacyInfo.xcprivacy" "$binary" <<'EOF'
import plistlib, sys, re
imports = set(open(sys.argv[1]).read().split())
categories = {
    # category: (symbols, reason code, why it fits)
    "NSPrivacyAccessedAPICategoryFileTimestamp": (
        r"^_(stat|fstat|fstatat|lstat|getattrlist|getattrlistbulk|fgetattrlist|getattrlistat)(\$INODE64)?$",
        "C617.1"),   # metadata of files inside the app's container (downloads, subtitles, fonts)
    "NSPrivacyAccessedAPICategorySystemBootTime": (r"^_mach_absolute_time$", "35F9.1"),  # elapsed time for playback timing
}
undecided = [s for s in imports if re.match(r"^_(statfs|statvfs|fstatfs|fstatvfs)(\$INODE64)?$", s)]
if undecided:
    sys.exit(f"{sys.argv[3]} uses disk-space APIs ({', '.join(sorted(undecided))}); decide the reason and add it to build-apple.sh.")
accessed = []
for category, (pattern, reason) in categories.items():
    if any(re.match(pattern, s) for s in imports):
        accessed.append({"NSPrivacyAccessedAPIType": category, "NSPrivacyAccessedAPITypeReasons": [reason]})
plistlib.dump({
    "NSPrivacyTracking": False,
    "NSPrivacyTrackingDomains": [],
    "NSPrivacyCollectedDataTypes": [],
    "NSPrivacyAccessedAPITypes": accessed,
}, open(sys.argv[2], "wb"))
EOF
}

notice_for() {  # <framework dir> <component>
    local dest="$1/NOTICE.txt" f
    {
        echo "$2 $(me_lock "$2" version) — $(me_lock "$2" licence)"
        echo "Source: $(me_lock "$2" url)"
        echo "All third-party notices for the Portico media engine: THIRD-PARTY-NOTICES.txt in Libmpv.framework."
        echo
        find "$ME_OUT/$PLATFORM/notices/$2" -type f | sort | while read -r f; do
            echo "--- ${f#"$ME_OUT/$PLATFORM/notices/"} ---"; cat "$f"; echo
        done
    } > "$dest"
}

for slice in $SLICES; do
    for pair in $STEMS; do
        stem=${pair%%:*}; component=${pair##*:}
        name="Lib$stem"
        fw="$FW/$slice/$name.framework"
        rm -rf "$fw"; mkdir -p "$fw"
        inputs=()
        for target in $TARGETS; do
            [[ "${target%%:*}" == "$slice" ]] || continue
            inputs+=("$(dylib_of "$ME_WORK/prefix/$PLATFORM/$slice-${target##*:}" "$stem")")
        done
        lipo -create "${inputs[@]}" -output "$fw/$name"
        # Its own name, and every reference to another of our libraries, as @rpath frameworks.
        install_name_tool -id "@rpath/$name.framework/$name" "$fw/$name"
        otool -L "$fw/$name" | tail -n +2 | awk '{print $1}' | while read -r dep; do
            other=$(stem_of_install_name "$dep")
            [[ -n "$other" && "$other" != "$stem" ]] && install_name_tool -change "$dep" "@rpath/Lib$other.framework/Lib$other" "$fw/$name"
            [[ "$dep" == *MoltenVK.framework/MoltenVK && "$dep" != "@rpath/MoltenVK.framework/MoltenVK" ]] \
                && install_name_tool -change "$dep" "@rpath/MoltenVK.framework/MoltenVK" "$fw/$name"
            true
        done
        # No build-machine paths stay behind.
        otool -l "$fw/$name" | awk '/cmd LC_RPATH/ {getline; getline; print $2}' | sort -u | while read -r rp; do
            install_name_tool -delete_rpath "$rp" "$fw/$name"
        done
        links=$(otool -L "$fw/$name" | awk '/^[[:space:]]/ {print $1}')
        [[ "$links" != *"$ME_WORK"* ]] || me_die "$name still refers to the build directory: $links"
        # -S as well: the debug map's object-file paths (N_OSO) name the build folders.
        strip -x -S "$fw/$name"
        if [[ "$stem" == mpv ]]; then
            mkdir -p "$fw/Headers" "$fw/Modules"
            cp "$ME_WORK/prefix/$PLATFORM/$slice-arm64/include/mpv/"*.h "$fw/Headers/"
            {
                echo "framework module Libmpv {"
                for h in "$fw/Headers/"*.h; do echo "    header \"$(basename "$h")\""; done
                echo "    export *"
                echo "}"
            } > "$fw/Modules/module.modulemap"
            cp "$ME_OUT/$PLATFORM/notices/THIRD-PARTY-NOTICES.txt" "$fw/"
        fi
        write_info_plist "$fw" "$name" "$(me_lock "$component" version)" "$slice"
        write_privacy_manifest "$fw" "$fw/$name"
        notice_for "$fw" "$component"
        codesign --force --sign - --timestamp=none "$fw/$name" >/dev/null
    done
    # MoltenVK: Khronos's framework for this slice, with a privacy manifest and its notice.
    case "$slice" in
        ios) id=ios-arm64 ;; ios-simulator) id=ios-arm64_x86_64-simulator ;;
        tvos) id=tvos-arm64_arm64e ;; tvos-simulator) id=tvos-arm64_x86_64-simulator ;;
    esac
    fw="$FW/$slice/MoltenVK.framework"
    rm -rf "$fw"; cp -R "$ME_WORK/src/moltenvk/MoltenVK/dynamic/MoltenVK.xcframework/$id/MoltenVK.framework" "$fw"
    write_privacy_manifest "$fw" "$fw/MoltenVK"
    notice_for "$fw" moltenvk
    codesign --force --sign - --timestamp=none "$fw/MoltenVK" >/dev/null
done

for pair in $STEMS MoltenVK:moltenvk; do
    stem=${pair%%:*}
    [[ "$stem" == MoltenVK ]] && name=MoltenVK || name="Lib$stem"
    args=()
    for slice in $SLICES; do args+=(-framework "$FW/$slice/$name.framework"); done
    xcodebuild -create-xcframework "${args[@]}" -output "$XC/$name.xcframework" >/dev/null \
        || me_die "Could not create $name.xcframework."
done

# Where the local Swift package (apple/Package.swift) finds them.
rm -rf "$ME_ROOT/apple/Frameworks"; mkdir -p "$ME_ROOT/apple/Frameworks"
cp -R "$XC"/*.xcframework "$ME_ROOT/apple/Frameworks/"

python3 -I "$ME_ROOT/verify.py" "$PLATFORM" --out "$ME_OUT" --work "$ME_WORK" --slices "$SLICES" --write-manifest
me_say "Done. Open the Xcode workspaces; the PorticoMediaEngine package now resolves from apple/Frameworks."
