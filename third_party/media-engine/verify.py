#!/usr/bin/env python3
"""Checks a finished media engine build. The build scripts run it last; run it again any time:

    python3 verify.py android [--out DIR] [--abis "arm64-v8a ..."]
    python3 verify.py apple   [--out DIR]

What it checks, for every library of every architecture:

  * FFmpeg is LGPL 2.1: its recorded configuration says "LGPL version 2.1 or later", has no
    --enable-gpl, --enable-version3 or --enable-nonfree, and every FFmpeg library carries that
    licence string (and no other).
  * mpv was built with gpl=false (its config.h and the feature list compiled into libmpv).
  * No forbidden library is linked or embedded: GnuTLS, Nettle, GMP, mbedTLS, x264, x265,
    libbluray, libsmbclient, fdk-aac (dependency names, symbol names and tell-tale strings).
  * Each component is its own dynamic library: exactly the expected libraries exist, each one
    names itself correctly (Android SONAME / Apple install name), FFmpeg and OpenSSL are not
    copied into libmpv or each other, and every dependency is either one of ours or an allowed
    system library.
  * Android: plain SONAMEs (no .so.N), 16 KB page alignment, stripped. Apple: @rpath install
    names, minimum OS versions, framework Info.plist and privacy manifest.
  * The decoders, demuxers, parsers, protocols, filters and hardware decoders the app relies on
    are present.
  * The dependency graph matches the recorded manifest (manifest/<platform>.json).
  * The notices and the corresponding source bundle exist.
  * No library carries the build machine's folders: the work directory, the home folder, or any
    /home/ or /Users/ path (file names in asserts, configuration strings, run paths). MoltenVK,
    Khronos's own build, is checked only for this machine's folders.

Exit status 0 when everything passes, 1 otherwise. --write-manifest also writes
out/<platform>/manifest.json (sizes and SHA-256 of every file). --update-expected rewrites
manifest/<platform>.json from this build; use it only after reviewing why it changed.

Pure Python 3.8+: ELF and Mach-O files are read directly, no other tools are needed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import plistlib
import re
import struct
import sys
import tarfile

HERE = pathlib.Path(__file__).resolve().parent

# ---------------------------------------------------------------------------------------------
# What a build must contain.

# library stem -> component (Android file lib<stem>.so; Apple framework Lib<stem> unless noted)
LIBRARIES = {
    "avcodec": "ffmpeg", "avformat": "ffmpeg", "avutil": "ffmpeg", "avfilter": "ffmpeg",
    "swresample": "ffmpeg", "swscale": "ffmpeg",
    "ssl": "openssl", "crypto": "openssl",
    "mpv": "mpv", "ass": "libass", "freetype": "freetype", "harfbuzz": "harfbuzz",
    "fribidi": "fribidi", "unibreak": "libunibreak", "dav1d": "dav1d", "placebo": "libplacebo",
    "lcms2": "lcms2", "dovi": "libdovi", "uchardet": "uchardet",
}
ANDROID_ONLY = {"iconv": "libiconv"}
APPLE_ONLY = {"MoltenVK": "moltenvk"}  # framework name as is

FFMPEG_LIBS = ["avcodec", "avformat", "avutil", "avfilter", "swresample", "swscale"]

REQUIRED = {
    "decoder": [
        # video
        "h264", "hevc", "av1", "libdav1d", "vp8", "vp9", "mpeg1video", "mpeg2video", "mpeg4",
        "msmpeg4v3", "vc1", "wmv3", "flv", "mjpeg", "theora",
        # audio
        "aac", "ac3", "eac3", "truehd", "mlp", "dca", "flac", "opus", "vorbis", "mp3", "mp2",
        "alac", "pcm_s16le", "pcm_s24le", "pcm_bluray", "pcm_dvd", "wmav2", "wmapro",
        # subtitles
        "subrip", "srt", "ass", "ssa", "webvtt", "movtext", "pgssub", "dvdsub", "dvbsub", "ccaption",
    ],
    "demuxer": [
        "mov", "matroska", "mpegts", "hls", "flv", "avi", "asf", "ogg", "wav", "flac", "mp3",
        "aac", "ac3", "eac3", "truehd", "dts", "srt", "ass", "webvtt", "vobsub", "mpegps",
        "m4v", "h264", "hevc", "mpegvideo", "vc1", "concat",
    ],
    "parser": [
        "h264", "hevc", "av1", "vp8", "vp9", "mpegvideo", "mpeg4video", "vc1", "aac", "ac3",
        "dca", "mlp", "mpegaudio", "opus", "flac", "vorbis", "dvdsub", "dvbsub",
    ],
    "protocol": ["file", "http", "https", "tcp", "tls", "crypto"],
    "filter": ["format", "scale", "bwdif", "yadif", "rotate", "vflip", "aresample", "hwdownload"],
    "bsf": ["h264_mp4toannexb", "hevc_mp4toannexb", "extract_extradata", "vp9_superframe_split"],
}
REQUIRED_PLATFORM = {
    "android": {"decoder": ["h264_mediacodec", "hevc_mediacodec", "vp9_mediacodec", "av1_mediacodec",
                            "mpeg2_mediacodec", "vp8_mediacodec", "mpeg4_mediacodec"]},
    "apple": {"hwaccel": ["h264_videotoolbox", "hevc_videotoolbox", "vp9_videotoolbox",
                          "av1_videotoolbox", "mpeg2_videotoolbox"]},
}
# Components FFmpeg must never contain, whatever else changes.
FORBIDDEN_FFMPEG_CONFIG = ["--enable-gpl", "--enable-version3", "--enable-nonfree", "--enable-gnutls",
                           "--enable-mbedtls", "--enable-gmp", "--enable-libx264", "--enable-libx265",
                           "--enable-libbluray", "--enable-libsmbclient", "--enable-libfdk-aac",
                           "--enable-securetransport", "--enable-libxml2"]

# (what, dependency-name regex, symbol regex, byte markers)
FORBIDDEN = [
    ("GnuTLS", r"gnutls", r"^_?gnutls_", [b"GnuTLS", b"gnutls_global_init"]),
    ("Nettle", r"nettle|hogweed", r"^_?nettle_", [b"nettle_sha256_init"]),
    ("GMP", r"(^|/)libgmp|gmp\.framework", r"^_?__gmp[zn]_", [b"__gmpz_init"]),
    ("mbedTLS", r"mbed(tls|crypto|x509)", r"^_?mbedtls_", [b"mbedtls_ssl_init", b"mbed TLS"]),
    # (FFmpeg's H.264 decoder itself contains "x264 - core": it recognises x264-made streams.)
    ("x264", r"x264", r"^_?x264_", [b"x264_encoder_open"]),
    ("x265", r"x265", r"^_?x265_", [b"x265_encoder_open", b"x265 (build"]),
    ("libbluray", r"bluray", r"^_?bd_(open|get_titles)", [b"bd_get_title_info"]),
    ("libsmbclient", r"smbclient", r"^_?smbc_", [b"smbc_init"]),
    ("fdk-aac", r"fdk", r"^_?(aacEncOpen|aacDecoder_Open)", [b"aacEncOpen", b"FDK AAC"]),
]

ANDROID_SYSTEM = {"libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so", "libEGL.so",
                  "libGLESv2.so", "libGLESv3.so", "libz.so", "libc++_shared.so", "libmediandk.so"}
APPLE_SYSTEM = re.compile(r"^(/usr/lib/(libSystem\.B|libc\+\+\.1|libz\.1|libiconv\.2|libobjc\.A|libresolv\.9)\.dylib"
                          r"|/System/Library/Frameworks/([A-Za-z0-9]+)\.framework/(Versions/A/)?\3)$")
APPLE_FRAMEWORKS_ALLOWED = {"Foundation", "CoreFoundation", "CoreVideo", "CoreMedia", "VideoToolbox",
                            "AudioToolbox", "AVFoundation", "CoreText", "CoreGraphics", "QuartzCore",
                            "Metal", "IOSurface", "UIKit", "Security", "IOKit", "CoreAudio"}

# ---------------------------------------------------------------------------------------------
# ELF


class Elf:
    def __init__(self, path: pathlib.Path):
        self.path = path
        data = path.read_bytes()
        if data[:4] != b"\x7fELF":
            raise ValueError(f"{path} is not an ELF file")
        self.is64 = data[4] == 2
        e = "<" if data[5] == 1 else ">"
        if self.is64:
            (self.phoff, self.shoff) = struct.unpack_from(e + "QQ", data, 0x20)
            (phentsize, phnum, shentsize, shnum, shstrndx) = struct.unpack_from(e + "HHHHH", data, 0x36)
        else:
            (self.phoff, self.shoff) = struct.unpack_from(e + "II", data, 0x1C)
            (phentsize, phnum, shentsize, shnum, shstrndx) = struct.unpack_from(e + "HHHHH", data, 0x2A)
        self.data = data
        # program headers
        self.load_aligns = []
        dynamic = None
        for i in range(phnum):
            off = self.phoff + i * phentsize
            if self.is64:
                p_type, _, p_offset, p_vaddr, _, p_filesz, _, p_align = struct.unpack_from(e + "IIQQQQQQ", data, off)
            else:
                p_type, p_offset, p_vaddr, _, p_filesz, _, _, p_align = struct.unpack_from(e + "IIIIIIII", data, off)
            if p_type == 1:
                self.load_aligns.append(p_align)
            elif p_type == 2:
                dynamic = (p_offset, p_filesz)
        # sections
        sections = []
        for i in range(shnum):
            off = self.shoff + i * shentsize
            if self.is64:
                name, sh_type, _, addr, offset, size, link, _, _, entsize = struct.unpack_from(e + "IIQQQQIIQQ", data, off)
            else:
                name, sh_type, _, addr, offset, size, link, _, _, entsize = struct.unpack_from(e + "IIIIIIIIII", data, off)
            sections.append((name, sh_type, addr, offset, size, link, entsize))
        names = sections[shstrndx] if shnum else None

        def secname(n):
            if not names:
                return ""
            start = names[3] + n
            return data[start:data.index(b"\0", start)].decode()
        self.section_names = [secname(s[0]) for s in sections]
        self.has_symtab = any(s[1] == 2 for s in sections)  # SHT_SYMTAB
        # dynamic section via its section header (strings via its linked string table)
        self.needed, self.soname = [], None
        for s in sections:
            if s[1] != 6:  # SHT_DYNAMIC
                continue
            strtab = sections[s[5]]
            fmt = e + ("qQ" if self.is64 else "iI")
            step = 16 if self.is64 else 8
            for off in range(s[3], s[3] + s[4], step):
                tag, val = struct.unpack_from(fmt, data, off)
                if tag == 0:
                    break
                if tag in (1, 14):
                    start = strtab[3] + val
                    text = data[start:data.index(b"\0", start)].decode()
                    (self.needed.append(text) if tag == 1 else setattr(self, "soname", text))
        # dynamic symbols: (name, defined)
        self.symbols = []
        for s in sections:
            if s[1] != 11:  # SHT_DYNSYM
                continue
            strtab = sections[s[5]]
            step = 24 if self.is64 else 16
            for off in range(s[3], s[3] + s[4], step):
                if self.is64:
                    st_name, st_info, _, st_shndx = struct.unpack_from(e + "IBBH", data, off)
                else:
                    st_name, _, _, st_info, _, st_shndx = struct.unpack_from(e + "IIIBBH", data, off)
                if not st_name:
                    continue
                start = strtab[3] + st_name
                name = data[start:data.index(b"\0", start)].decode(errors="replace")
                bind = st_info >> 4
                if bind in (1, 2):  # GLOBAL, WEAK
                    self.symbols.append((name, st_shndx != 0))


# ---------------------------------------------------------------------------------------------
# Mach-O

LC_REQ_DYLD = 0x80000000
LC_ID_DYLIB, LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB = 0xD, 0xC, 0x18 | LC_REQ_DYLD
LC_REEXPORT_DYLIB, LC_LOAD_UPWARD_DYLIB = 0x1F | LC_REQ_DYLD, 0x23 | LC_REQ_DYLD
LC_SYMTAB, LC_BUILD_VERSION, LC_RPATH = 0x2, 0x32, 0x1C | LC_REQ_DYLD
LC_VERSION_MIN_IPHONEOS, LC_VERSION_MIN_TVOS = 0x25, 0x2F
PLATFORMS = {2: "ios", 3: "tvos", 7: "ios-simulator", 8: "tvos-simulator", 1: "macos", 6: "maccatalyst"}
CPU = {0x0100000C: "arm64", 0x01000007: "x86_64"}


class MachO:
    """One architecture slice."""

    def __init__(self, data: bytes, offset: int, size: int):
        magic = struct.unpack_from("<I", data, offset)[0]
        if magic != 0xFEEDFACF:
            raise ValueError("not a 64-bit little-endian Mach-O slice")
        _, cputype, _, filetype, ncmds, _, _, _ = struct.unpack_from("<IiiIIIII", data, offset)
        self.arch = CPU.get(cputype & 0xFFFFFFFF, hex(cputype))
        self.filetype = filetype
        self.id, self.dylibs, self.rpaths = None, [], []
        self.platform, self.minos = None, None
        self.symbols = []
        off = offset + 32
        for _ in range(ncmds):
            cmd, cmdsize = struct.unpack_from("<II", data, off)
            if cmd in (LC_ID_DYLIB, LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_LOAD_UPWARD_DYLIB):
                name_off = struct.unpack_from("<I", data, off + 8)[0]
                name = data[off + name_off:off + cmdsize].split(b"\0", 1)[0].decode()
                (setattr(self, "id", name) if cmd == LC_ID_DYLIB else self.dylibs.append(name))
            elif cmd == LC_RPATH:
                p = struct.unpack_from("<I", data, off + 8)[0]
                self.rpaths.append(data[off + p:off + cmdsize].split(b"\0", 1)[0].decode())
            elif cmd == LC_BUILD_VERSION:
                plat, minos = struct.unpack_from("<II", data, off + 8)
                self.platform, self.minos = PLATFORMS.get(plat, str(plat)), _ver(minos)
            elif cmd in (LC_VERSION_MIN_IPHONEOS, LC_VERSION_MIN_TVOS):
                self.platform = "ios" if cmd == LC_VERSION_MIN_IPHONEOS else "tvos"
                self.minos = _ver(struct.unpack_from("<I", data, off + 8)[0])
            elif cmd == LC_SYMTAB:
                symoff, nsyms, stroff, _ = struct.unpack_from("<IIII", data, off + 8)
                for i in range(nsyms):
                    n_strx, n_type, _, _, _ = struct.unpack_from("<IBBHQ", data, offset + symoff + i * 16)
                    if not n_type & 0x01 or n_type & 0xE0:  # external, not a debugging entry
                        continue
                    start = offset + stroff + n_strx
                    name = data[start:data.index(b"\0", start)].decode(errors="replace")
                    self.symbols.append((name, (n_type & 0x0E) != 0))
            off += cmdsize


def _ver(v: int) -> str:
    return f"{v >> 16}.{(v >> 8) & 0xFF}" + (f".{v & 0xFF}" if v & 0xFF else "")


def macho_slices(path: pathlib.Path) -> list:
    data = path.read_bytes()
    magic = struct.unpack_from(">I", data, 0)[0]
    if magic in (0xCAFEBABE, 0xCAFEBABF):
        count = struct.unpack_from(">I", data, 4)[0]
        slices, wide = [], magic == 0xCAFEBABF
        for i in range(count):
            if wide:
                _, _, off, size, _, _ = struct.unpack_from(">iiQQII", data, 8 + i * 32)
            else:
                _, _, off, size, _ = struct.unpack_from(">iiIII", data, 8 + i * 20)
            slices.append(MachO(data, off, size))
        return slices
    return [MachO(data, 0, len(data))]


# ---------------------------------------------------------------------------------------------


class Report:
    def __init__(self):
        self.failures, self.passes = [], 0

    def check(self, ok: bool, what: str):
        if ok:
            self.passes += 1
        else:
            self.failures.append(what)
        return ok


def config_components(path: pathlib.Path) -> dict:
    """{kind: {name}} from FFmpeg's config_components.h (CONFIG_<NAME>_<KIND> 1)."""
    found = {k: set() for k in ("decoder", "demuxer", "parser", "protocol", "filter", "bsf", "hwaccel")}
    for m in re.finditer(r"#define CONFIG_([A-Z0-9_]+)_(DECODER|DEMUXER|PARSER|PROTOCOL|FILTER|BSF|HWACCEL) 1",
                         path.read_text()):
        found[m.group(2).lower()].add(m.group(1).lower())
    return found


def define(path: pathlib.Path, name: str):
    m = re.search(r'#define ' + re.escape(name) + r' (?:"((?:[^"\\]|\\.)*)"|(\S+))', path.read_text())
    if not m:
        return None
    return bytes(m.group(1), "utf-8").decode("unicode_escape") if m.group(1) is not None else m.group(2)


def check_ffmpeg_meta(r: Report, meta: pathlib.Path, platform: str, where: str, libs: dict):
    cfg = meta / "ffmpeg-config.h"
    if not r.check(cfg.is_file(), f"{where}: FFmpeg's config.h was not recorded ({cfg})"):
        return
    licence = define(cfg, "FFMPEG_LICENSE")
    r.check(licence == "LGPL version 2.1 or later", f"{where}: FFmpeg licence is {licence!r}, not LGPL 2.1")
    configuration = define(cfg, "FFMPEG_CONFIGURATION") or ""
    for flag in FORBIDDEN_FFMPEG_CONFIG:
        r.check(not re.search(re.escape(flag) + r"(\s|$)", configuration), f"{where}: FFmpeg was configured with {flag}")
    for stem in FFMPEG_LIBS:
        blob = libs.get(stem)
        if blob is None:
            continue
        r.check(b"LGPL version 2.1 or later" in blob, f"{where}: lib{stem} does not carry the LGPL 2.1 licence string")
        for other in (b"GPL version 2 or later", b"GPL version 3 or later", b"LGPL version 3 or later",
                      b"nonfree and unredistributable"):
            r.check(other not in blob.replace(b"LGPL version 2.1 or later", b""), f"{where}: lib{stem} carries {other.decode()!r}")
    if "avutil" in libs:
        r.check(configuration.encode() in libs["avutil"], f"{where}: libavutil's built-in configuration differs from the recorded config.h")
    comps = meta / "ffmpeg-config_components.h"
    if not r.check(comps.is_file(), f"{where}: FFmpeg's component list was not recorded"):
        return
    have = config_components(comps)
    wanted = {k: list(v) for k, v in REQUIRED.items()}
    for kind, names in REQUIRED_PLATFORM.get(platform, {}).items():
        wanted.setdefault(kind, []).extend(names)
    for kind, names in wanted.items():
        missing = [n for n in names if n not in have[kind]]
        r.check(not missing, f"{where}: FFmpeg lacks {kind}s {', '.join(missing)}")
    r.check(not have.get("encoder") and not re.search(r"#define CONFIG_[A-Z0-9_]+_(ENCODER|MUXER) 1", comps.read_text()),
            f"{where}: FFmpeg contains encoders or muxers (a player needs none)")


def check_mpv_meta(r: Report, meta: pathlib.Path, where: str, libmpv: bytes | None):
    cfg = meta / "mpv-config.h"
    if not r.check(cfg.is_file(), f"{where}: mpv's config.h was not recorded"):
        return
    r.check(define(cfg, "HAVE_GPL") == "0", f"{where}: mpv was not built with gpl=false")
    features = define(cfg, "FULLCONFIG") or ""
    r.check("gpl" not in features.split(), f"{where}: mpv's feature list includes gpl")
    for needed in ("ffmpeg", "libass", "libplacebo", "uchardet", "iconv", "lcms2", "zlib"):
        r.check(needed in features.split(), f"{where}: mpv was built without {needed}")
    for unwanted in ("libbluray", "dvdnav", "cdda", "libarchive", "lua", "javascript", "rubberband", "vapoursynth"):
        r.check(unwanted not in features.split(), f"{where}: mpv was built with {unwanted}")
    if libmpv is not None:
        r.check(features.encode() in libmpv, f"{where}: libmpv's built-in feature list differs from the recorded config.h")


def check_forbidden(r: Report, where: str, name: str, deps: list, symbols: list, blob: bytes):
    for label, dep_re, sym_re, markers in FORBIDDEN:
        bad = [d for d in deps if re.search(dep_re, d, re.I)]
        r.check(not bad, f"{where}: {name} depends on {label} ({', '.join(bad)})")
        sym = [s for s, _ in symbols if re.search(sym_re, s)]
        r.check(not sym, f"{where}: {name} has {label} symbols ({', '.join(sym[:3])})")
        hit = [m.decode() for m in markers if m in blob]
        r.check(not hit, f"{where}: {name} contains {label} code ({', '.join(hit)})")


# Symbols that betray a component copied (statically) into another library.
OWN_SYMBOLS = {
    "avcodec": r"^_?avcodec_(open2|send_packet)$", "avformat": r"^_?avformat_open_input$",
    "avutil": r"^_?av_frame_alloc$", "avfilter": r"^_?avfilter_graph_alloc$",
    "swresample": r"^_?swr_alloc$", "swscale": r"^_?sws_scale$",
    "ssl": r"^_?SSL_CTX_new$", "crypto": r"^_?EVP_DigestInit_ex$",
    "ass": r"^_?ass_library_init$", "freetype": r"^_?FT_Init_FreeType$", "harfbuzz": r"^_?hb_shape$",
    "fribidi": r"^_?fribidi_get_par_embedding_levels_ex$", "unibreak": r"^_?set_linebreaks_utf8$",
    "dav1d": r"^_?dav1d_open$", "placebo": r"^_?pl_renderer_create$", "lcms2": r"^_?cmsCreateTransform$",
    "dovi": r"^_?dovi_parse_rpu$", "uchardet": r"^_?uchardet_new$", "mpv": r"^_?mpv_create$",
    "iconv": r"^_?(lib)?iconv_open$",
}


def path_needles(work: pathlib.Path) -> tuple:
    """(this machine's folders, any machine's) as byte strings a release library must not contain."""
    mine = set()
    for folder in (work, HERE):
        for form in {str(folder), os.path.realpath(folder)}:
            if len(form) > 1:
                mine.add(form.rstrip("/").encode())
    home = os.environ.get("HOME", "").rstrip("/")
    if len(home) > 1:
        mine.add((home + "/").encode())
    return sorted(mine), [b"/home/", b"/Users/"]


def _string_around(blob: bytes, at: int) -> str:
    start = at
    while start > 0 and 32 <= blob[start - 1] < 127:
        start -= 1
    end = at
    while end < len(blob) and 32 <= blob[end] < 127:
        end += 1
    text = blob[start:end].decode("ascii", "replace")
    return text if len(text) <= 160 else text[:157] + "..."


def check_paths(r: Report, where: str, name: str, blob: bytes, needles: tuple, prebuilt: bool = False):
    mine, anyone = needles
    for needle in mine + ([] if prebuilt else anyone):
        at = blob.find(needle)
        r.check(at < 0, f"{where}: {name} contains the build folder path {needle.decode(errors='replace')!r} "
                        f"(in {_string_around(blob, at)!r})" if at >= 0 else "")


def check_own_symbols(r: Report, where: str, stem: str, symbols: list):
    defined = {s for s, d in symbols if d}
    for other, pattern in OWN_SYMBOLS.items():
        hits = [s for s in defined if re.search(pattern, s)]
        if other == stem:
            r.check(bool(hits), f"{where}: lib{stem} does not export its own API ({pattern})")
        else:
            r.check(not hits, f"{where}: lib{stem} contains a copy of lib{other} ({', '.join(hits)})")


# ---------------------------------------------------------------------------------------------


def verify_android(args, r: Report) -> dict:
    root = args.out / "android"
    expected = set(LIBRARIES) | set(ANDROID_ONLY)
    abis = args.abis.split() if args.abis else sorted(p.name for p in (root / "lib").iterdir() if p.is_dir())
    needles = path_needles(args.work)
    r.check(bool(abis), f"no ABIs were built under {root / 'lib'}")
    inventory = {}
    for abi in abis:
        where = f"android/{abi}"
        libdir = root / "lib" / abi
        files = sorted(p.name for p in libdir.glob("*") if p.is_file())
        stems = {f[3:-3] for f in files if f.startswith("lib") and f.endswith(".so")}
        r.check(stems == expected and len(files) == len(stems),
                f"{where}: libraries differ from the expected set (missing {sorted(expected - stems)}, unexpected {sorted(set(files) - {f'lib{s}.so' for s in expected})})")
        blobs = {}
        inv = {}
        for f in files:
            path = libdir / f
            elf = Elf(path)
            stem = f[3:-3]
            blob = path.read_bytes()
            blobs[stem] = blob
            r.check(elf.soname == f, f"{where}: {f} has SONAME {elf.soname!r} (Android needs exactly {f})")
            r.check(not re.search(r"\.so\.\d", " ".join(elf.needed)), f"{where}: {f} needs a versioned library ({elf.needed})")
            ours = sorted(d for d in elf.needed if d.startswith("lib") and d[3:-3] in expected)
            system = sorted(d for d in elf.needed if d not in ours)
            bad = [d for d in system if d not in ANDROID_SYSTEM]
            r.check(not bad, f"{where}: {f} depends on libraries the app does not have ({', '.join(bad)})")
            r.check(all(a >= 16384 for a in elf.load_aligns), f"{where}: {f} is not 16 KB aligned (LOAD alignments {[hex(a) for a in elf.load_aligns]})")
            r.check(not elf.has_symtab, f"{where}: {f} is not stripped")
            check_forbidden(r, where, f, elf.needed, elf.symbols, blob)
            check_paths(r, where, f, blob, needles)
            if stem in OWN_SYMBOLS:
                check_own_symbols(r, where, stem, elf.symbols)
            inv[f] = {"needs": ours, "system": system, "size": path.stat().st_size,
                      "sha256": hashlib.sha256(blob).hexdigest()}
        check_ffmpeg_meta(r, root / "meta" / abi, "android", where, blobs)
        check_mpv_meta(r, root / "meta" / abi, where, blobs.get("mpv"))
        # libmpv must reach FFmpeg, libass and libplacebo as separate libraries.
        mpv_needs = set(inv.get("libmpv.so", {}).get("needs", []))
        for dep in ("libavcodec.so", "libavformat.so", "libavutil.so", "libavfilter.so", "libswresample.so",
                    "libswscale.so", "libass.so", "libplacebo.so"):
            r.check(dep in mpv_needs, f"{where}: libmpv.so does not load {dep} as a separate library")
        r.check({"libssl.so", "libcrypto.so"} <= set(inv.get("libavformat.so", {}).get("needs", [])),
                f"{where}: libavformat.so does not load OpenSSL as separate libraries")
        inventory[abi] = inv
    r.check((root / "include" / "mpv" / "client.h").is_file(), "android: libmpv's headers are missing")
    return inventory


def verify_apple(args, r: Report) -> dict:
    root = args.out / "apple" / "xcframeworks"
    names = {f"Lib{s}" for s in LIBRARIES} | set(APPLE_ONLY)
    found = {p.stem for p in root.glob("*.xcframework")}
    r.check(found == names, f"apple: xcframeworks differ (missing {sorted(names - found)}, unexpected {sorted(found - names)})")
    targets = json.loads((HERE / "sources.lock.json").read_text())["tools"]["apple-deployment"]
    # Architectures each slice must have at least (MoltenVK's own frameworks carry more: arm64e
    # on tvOS devices, x86_64 in the tvOS simulator, which Rust and so libdovi do not support).
    needles = path_needles(args.work)
    wanted_slices = {"ios": {"arm64"}, "ios-simulator": {"arm64", "x86_64"}, "tvos": {"arm64"}, "tvos-simulator": {"arm64"}}
    if args.slices:
        requested = args.slices.split()
        if not requested or len(set(requested)) != len(requested) or set(requested) - set(wanted_slices):
            raise ValueError(f"invalid Apple slices: {args.slices}")
        wanted_slices = {name: wanted_slices[name] for name in requested}
    inventory = {}
    for xc in sorted(root.glob("*.xcframework")):
        name = xc.stem
        info = plistlib.loads((xc / "Info.plist").read_bytes())
        slices = {}
        for lib in info.get("AvailableLibraries", []):
            plat = lib["SupportedPlatform"] + ("-simulator" if lib.get("SupportedPlatformVariant") == "simulator" else "")
            if plat.startswith(("macos", "xros")):
                continue
            slices[plat] = lib
        got = {p: set(l["SupportedArchitectures"]) for p, l in slices.items()}
        r.check(set(got) == set(wanted_slices) and all(wanted_slices[p] <= got[p] for p in got),
                f"apple: {name} slices are {sorted((p, sorted(a)) for p, a in got.items())}, expected at least {sorted((p, sorted(a)) for p, a in wanted_slices.items())}")
        for plat, lib in slices.items():
            where = f"apple/{plat}"
            fw = xc / lib["LibraryIdentifier"] / lib["LibraryPath"]
            binary = fw / name
            if not r.check(binary.is_file(), f"{where}: {name}.framework has no binary"):
                continue
            plist = plistlib.loads((fw / "Info.plist").read_bytes())
            os_name = plat.split("-")[0]
            minimum = targets[os_name]
            r.check(plist.get("CFBundleExecutable") == name, f"{where}: {name} Info.plist names executable {plist.get('CFBundleExecutable')!r}")
            r.check(bool(plist.get("CFBundleIdentifier")), f"{where}: {name} Info.plist has no bundle identifier")
            r.check(plist.get("CFBundlePackageType") == "FMWK", f"{where}: {name} Info.plist is not a framework's")
            r.check(_vtuple(plist.get("MinimumOSVersion", "99")) <= _vtuple(minimum),
                    f"{where}: {name} needs OS {plist.get('MinimumOSVersion')}, the app supports {minimum}")
            r.check((fw / "PrivacyInfo.xcprivacy").is_file(), f"{where}: {name} has no privacy manifest")
            blob = binary.read_bytes()
            check_paths(r, where, name, blob, needles, prebuilt=name in APPLE_ONLY)
            for sl in macho_slices(binary):
                w = f"{where}/{sl.arch}"
                r.check(sl.id == f"@rpath/{name}.framework/{name}", f"{w}: {name} install name is {sl.id!r}")
                r.check(sl.platform == plat, f"{w}: {name} is built for {sl.platform}, not {plat}")
                r.check(sl.minos is not None and _vtuple(sl.minos) <= _vtuple(minimum), f"{w}: {name} needs OS {sl.minos}, the app supports {minimum}")
                ours = sorted(d.split("/")[-1] for d in sl.dylibs if d.startswith("@rpath/") and d.split("/")[-1] in names)
                other = [d for d in sl.dylibs if not d.startswith("@rpath/")]
                bad = [d for d in other if not APPLE_SYSTEM.match(d)
                       or ("/System/Library/Frameworks/" in d and d.split("/")[4].split(".")[0] not in APPLE_FRAMEWORKS_ALLOWED)]
                bad += [d for d in sl.dylibs if d.startswith("@rpath/") and d.split("/")[-1] not in names]
                r.check(not bad, f"{w}: {name} depends on {', '.join(bad)}")
                check_forbidden(r, w, name, sl.dylibs, sl.symbols, blob)
                stem = name[3:] if name.startswith("Lib") else None
                if stem in OWN_SYMBOLS:
                    check_own_symbols(r, w, stem, sl.symbols)
                inventory.setdefault(plat, {}).setdefault(name, {"needs": ours, "system": sorted(other)})
            inventory[plat][name].update(size=binary.stat().st_size, sha256=hashlib.sha256(blob).hexdigest())
            meta = args.out / "apple" / "meta" / plat
            if name == "Libavutil":
                libs = {s: (xc.parent / f"Lib{s}.xcframework" / lib["LibraryIdentifier"] / f"Lib{s}.framework" / f"Lib{s}").read_bytes()
                        for s in FFMPEG_LIBS if (xc.parent / f"Lib{s}.xcframework" / lib["LibraryIdentifier"] / f"Lib{s}.framework" / f"Lib{s}").is_file()}
                check_ffmpeg_meta(r, meta, "apple", where, libs)
            if name == "Libmpv":
                check_mpv_meta(r, meta, where, blob)
                r.check((fw / "Modules" / "module.modulemap").is_file(), f"{where}: Libmpv has no module map (import Libmpv would fail)")
                mpv_needs = set(inventory[plat]["Libmpv"]["needs"])
                for dep in ("Libavcodec", "Libavformat", "Libavutil", "Libavfilter", "Libswresample", "Libswscale",
                            "Libass", "Libplacebo", "MoltenVK"):
                    r.check(dep in mpv_needs, f"{where}: Libmpv does not load {dep} as a separate framework")
    return inventory


def _vtuple(v: str):
    return tuple(int(x) for x in str(v).split("."))


def check_notices(r: Report, out: pathlib.Path, platform: str):
    lock = json.loads((HERE / "sources.lock.json").read_text())
    notices = out / platform / "notices" / "THIRD-PARTY-NOTICES.txt"
    if r.check(notices.is_file(), f"{platform}: {notices} is missing (run collect-notices.sh)"):
        text = notices.read_text()
        for name, entry in lock["components"].items():
            if platform in entry["platforms"]:
                r.check(f"{name} {entry['version']}" in text, f"{platform}: the notices do not cover {name} {entry['version']}")
    bundle = out / platform / "source" / f"portico-media-engine-{platform}-source-r{lock['revision']}.tar"
    if r.check(bundle.is_file(), f"{platform}: the corresponding source bundle {bundle.name} is missing"):
        with tarfile.open(bundle) as tar:
            members = {pathlib.PurePosixPath(m).name for m in tar.getnames()}
        for name, entry in lock["components"].items():
            if platform in entry["platforms"] and not entry.get("prebuilt"):
                r.check(entry["file"] in members, f"{platform}: the source bundle lacks {entry['file']}")
                for sub in entry.get("subsources", {}).values():
                    r.check(sub["file"] in members, f"{platform}: the source bundle lacks {sub['file']}")
        for needed in ("libdovi-vendored-crates.tar", "sources.lock.json", "build-android.sh", "build-apple.sh", "common.sh"):
            r.check(needed in members, f"{platform}: the source bundle lacks {needed}")
        patches = sorted(p.name for p in (HERE / "patches").rglob("*.patch"))
        for p in patches:
            r.check(p in members, f"{platform}: the source bundle lacks patch {p}")


def compare_manifest(r: Report, platform: str, inventory: dict, update: bool):
    path = HERE / "manifest" / f"{platform}.json"
    graph = {group: {lib: {"needs": v["needs"]} for lib, v in libs.items()} for group, libs in inventory.items()}
    if update:
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"platform": platform, "libraries": graph}, indent=2, sort_keys=True) + "\n")
        print(f"Recorded {path}")
        return
    if not r.check(path.is_file(), f"{platform}: no recorded manifest ({path}); review a build, then run with --update-expected"):
        return
    recorded = json.loads(path.read_text())["libraries"]
    for group, libs in graph.items():
        if not r.check(group in recorded, f"{platform}: {group} is not in the recorded manifest"):
            continue
        for lib, v in libs.items():
            want = recorded[group].get(lib)
            r.check(want is not None and want["needs"] == v["needs"],
                    f"{platform}/{group}: {lib} loads {v['needs']}, the manifest records {want and want['needs']}")
        missing = set(recorded[group]) - set(libs)
        r.check(not missing, f"{platform}/{group}: missing {sorted(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("platform", choices=["android", "apple"])
    parser.add_argument("--out", type=pathlib.Path, default=HERE / "out")
    parser.add_argument("--abis", default="")
    parser.add_argument("--slices", default="", help="Apple slices selected by build-apple.sh; default: all")
    parser.add_argument("--work", type=pathlib.Path,
                        default=pathlib.Path(os.environ.get("MEDIA_ENGINE_WORK_DIR") or HERE / "work"),
                        help="the build's work directory, which no library may name (default: MEDIA_ENGINE_WORK_DIR or ./work)")
    parser.add_argument("--ndk", default="", help=argparse.SUPPRESS)  # accepted for symmetry; not needed
    parser.add_argument("--write-manifest", action="store_true")
    parser.add_argument("--update-expected", action="store_true")
    args = parser.parse_args()
    r = Report()
    inventory = verify_android(args, r) if args.platform == "android" else verify_apple(args, r)
    check_notices(r, args.out, args.platform)
    compare_manifest(r, args.platform, inventory, args.update_expected)
    if args.write_manifest:
        out = args.out / args.platform / "manifest.json"
        out.write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n")
        print(f"Wrote {out}")
    for f in r.failures:
        print(f"FAIL {f}")
    print(f"{r.passes} checks passed, {len(r.failures)} failed.")
    return 1 if r.failures else 0


if __name__ == "__main__":
    sys.exit(main())
