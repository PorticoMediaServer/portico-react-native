#!/usr/bin/env python3
"""Read Android CI inputs, rejecting drift between the app and pinned engine."""

import json
import pathlib
import re
import sys


def read_config(root):
    engine = json.loads((root / "third_party/media-engine/sources.lock.json").read_text())
    gradle = (root / "apps/native/android/build.gradle").read_text()
    properties = (root / "apps/native/android/gradle.properties").read_text()

    def value(name):
        match = re.search(rf'^\s*{name}\s*=\s*"?([\d.]+)"?\s*$', gradle, re.M)
        if not match:
            raise ValueError(f"Cannot read {name} from Android build.gradle")
        return match[1]

    ndk = engine["tools"]["android-ndk"]["version"]
    if value("ndkVersion") != ndk:
        raise ValueError("App ndkVersion differs from the media-engine pin")
    if value("minSdkVersion") != engine["tools"]["android-api"]["version"]:
        raise ValueError("App minSdkVersion differs from the media-engine API pin")
    match = re.search(r'^reactNativeArchitectures\s*=\s*([^\n]+)', properties, re.M)
    abis = [abi.strip() for abi in match[1].split(",")] if match else []
    if (not abis or len(set(abis)) != len(abis)
            or not set(abis) <= {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}):
        raise ValueError("reactNativeArchitectures must name distinct supported engine ABIs")
    return {
        "ndk": ndk,
        "sdk": value("compileSdkVersion"),
        "build_tools": value("buildToolsVersion"),
        "rust": engine["tools"]["rust"]["version"],
        "abis": " ".join(abis),
        "source_bundle": f'portico-media-engine-android-source-r{int(engine["revision"])}.tar',
    }


if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parents[2]
    try:
        config = read_config(root)
        if len(sys.argv) != 2 or sys.argv[1] not in config:
            raise ValueError(f"Usage: android-config.py {'|'.join(config)}")
        print(config[sys.argv[1]])
    except (ValueError, KeyError) as error:
        sys.exit(str(error))
