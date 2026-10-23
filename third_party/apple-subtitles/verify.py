"""Fail closed on the Apple subtitle library's actual built feature and dependency surface."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

out = Path(sys.argv[1])
stems = {"avcodec", "avformat", "avutil", "swresample", "porticosubtitle", "ass", "freetype", "harfbuzz", "fribidi", "unibreak"}
expected = {"Lib" + s for s in stems}
for config in sorted((out / "meta").glob("*/ffmpeg-config_components.h")):
    text = config.read_text()
    for required in ["PGSSUB_DECODER", "DVDSUB_DECODER", "DVBSUB_DECODER", "OPUS_DECODER", "SUP_DEMUXER", "VOBSUB_DEMUXER", "MATROSKA_DEMUXER", "OGG_DEMUXER"]:
        if not re.search(r"#define CONFIG_" + required + r" 1\b", text):
            raise SystemExit(f"Missing {required}: {config}")
    if re.search(r"#define CONFIG_(H264_DECODER|HEVC_DECODER|HTTP_PROTOCOL|HTTPS_PROTOCOL|GPL|NONFREE) 1\b", text):
        raise SystemExit(f"Unexpected video/network/nonfree feature: {config}")
configs = list((out / "meta").glob("*/ffmpeg-config_components.h"))
if len(configs) != 4:
    raise SystemExit("Expected four checked Apple slices")
manifest = []
for xc in sorted((out / "xcframeworks").glob("*.xcframework")):
    if xc.stem not in expected:
        raise SystemExit(f"Unexpected framework {xc}")
    for binary in xc.glob("*/*.framework/" + xc.stem):
        links = subprocess.check_output(["otool", "-L", str(binary)], text=True)
        for line in links.splitlines():
            if not line[:1].isspace():
                continue
            dep = line.strip().split(" ")[0]
            if dep.startswith(("/System/Library/", "/usr/lib/")):
                continue
            if not any(dep == f"@rpath/{name}.framework/{name}" for name in expected):
                raise SystemExit(f"Unexpected dependency {dep}: {binary}")
        manifest.append({"path": str(binary.relative_to(out)), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "bytes": binary.stat().st_size})
if {xc.stem for xc in (out / "xcframeworks").glob("*.xcframework")} != expected or len(manifest) != 40:
    raise SystemExit("Missing framework slice")
if not (out / "notices/THIRD-PARTY-NOTICES.txt").is_file() or not (out / "source/SHA256SUMS").is_file():
    raise SystemExit("Missing licence/source bundle")
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Verified {len(manifest)} subtitle framework slices")
