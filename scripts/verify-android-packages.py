#!/usr/bin/env python3
"""Verify release APK/AAB contents against the media engine just built from source."""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--engine", type=Path, default=Path("third_party/media-engine/out/android"))
parser.add_argument("--abis", nargs="+", default=["arm64-v8a", "armeabi-v7a", "x86", "x86_64"])
parser.add_argument("packages", nargs="+", type=Path)
args = parser.parse_args()
libraries = (
    "avcodec avformat avutil avfilter swresample swscale ssl crypto mpv ass freetype "
    "harfbuzz fribidi unibreak dav1d placebo lcms2 dovi uchardet iconv"
).split()
notices = (args.engine / "notices/THIRD-PARTY-NOTICES.txt").read_bytes()
for package in args.packages:
    prefix = "base/" if package.suffix == ".aab" else ""
    with ZipFile(package) as archive:
        names = set(archive.namelist())
        present = {
            name[len(prefix):].split("/")[1]
            for name in names if name.startswith(prefix + "lib/") and name.endswith(".so")
        }
        if present != set(args.abis):
            raise SystemExit(f"{package}: expected ABIs {args.abis}, found {sorted(present)}")
        for abi in args.abis:
            bridge = archive.read(f"{prefix}lib/{abi}/libporticompv.so")
            if not bridge.startswith(b"\x7fELF"):
                raise SystemExit(f"{package}: invalid JNI bridge for {abi}")
            for library in libraries:
                name = f"lib{library}.so"
                expected = (args.engine / "lib" / abi / name).read_bytes()
                actual = archive.read(f"{prefix}lib/{abi}/{name}")
                if hashlib.sha256(actual).digest() != hashlib.sha256(expected).digest():
                    raise SystemExit(f"{package}: {abi}/{name} differs from the verified media build")
        if archive.read(prefix + "assets/media-engine/THIRD-PARTY-NOTICES.txt") != notices:
            raise SystemExit(f"{package}: media notices differ from the source build")
        if not archive.read(prefix + "assets/index.android.bundle"):
            raise SystemExit(f"{package}: embedded JavaScript is missing")
    print(f"Verified {package}: {len(args.abis)} ABIs, media libraries, JNI bridge, notices and JavaScript")
