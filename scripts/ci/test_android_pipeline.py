"""Disposable clean-checkout fixtures for Android prerequisite and release boundaries."""

import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("android_config", ROOT / "scripts/ci/android-config.py")
config_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config_module)


class AndroidPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="portico android pipeline ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in (
            "scripts/ci/android-config.py", "scripts/ci/prepare-android.sh",
            "scripts/ci/collect-android-release.sh", "apps/native/android/build.gradle",
            "apps/native/android/gradle.properties", "third_party/media-engine/sources.lock.json",
        ):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        self.config = config_module.read_config(self.root)
        self.env = os.environ.copy()
        self.env.update({"ANDROID_HOME": str(self.root / "sdk"),
                         "GITHUB_ENV": str(self.root / "github-env"),
                         "TRACE": str(self.root / "trace"), "MEDIA_ENGINE_JOBS": "2"})
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env["PATH"] = f'{self.bin}:{self.env["PATH"]}'

    def script(self, path, body):
        path = self.root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body + "\n")
        path.chmod(0o755)

    def run_helper(self, name):
        return subprocess.run(["bash", str(self.root / "scripts/ci" / name)],
                              cwd=self.root, env=self.env, text=True, capture_output=True)

    def prerequisites(self):
        self.script("sdk/cmdline-tools/latest/bin/sdkmanager",
                    'printf "sdk:%s\\n" "$*" >> "$TRACE"')
        self.script("bin/rustup", 'printf "rust:%s\\n" "$*" >> "$TRACE"')
        ndk = self.root / "sdk/ndk" / self.config["ndk"] / "source.properties"
        ndk.parent.mkdir(parents=True)
        ndk.write_text(f'Pkg.Revision = {self.config["ndk"]}\n')
        self.script("third_party/media-engine/build-android.sh",
                    'printf "engine:%s|%s|%s|%s\\n" "$*" "$ANDROID_NDK_HOME" '
                    '"$RUSTUP_TOOLCHAIN" "$MEDIA_ENGINE_JOBS" >> "$TRACE"')

    def test_clean_preparation_selects_pins_and_all_app_abis(self):
        self.prerequisites()
        result = self.run_helper("prepare-android.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = (self.root / "trace").read_text().splitlines()
        self.assertEqual(lines, [
            f'sdk:--install ndk;{self.config["ndk"]} platforms;android-{self.config["sdk"]} '
            f'build-tools;{self.config["build_tools"]}',
            f'rust:toolchain install {self.config["rust"]} --profile minimal',
            f'engine:--abis {self.config["abis"]}|{self.env["ANDROID_HOME"]}/ndk/'
            f'{self.config["ndk"]}|{self.config["rust"]}|2',
        ])
        self.assertIn(f'ANDROID_NDK_HOME={self.env["ANDROID_HOME"]}/ndk/{self.config["ndk"]}',
                      (self.root / "github-env").read_text())

    def test_failed_sdk_install_stops_before_engine(self):
        self.prerequisites()
        self.script("sdk/cmdline-tools/latest/bin/sdkmanager", "exit 42")
        self.assertEqual(self.run_helper("prepare-android.sh").returncode, 42)
        self.assertFalse((self.root / "trace").exists())

    def test_failed_engine_verification_stops_preparation(self):
        self.prerequisites()
        self.script("third_party/media-engine/build-android.sh", "exit 43")
        self.assertEqual(self.run_helper("prepare-android.sh").returncode, 43)
        self.assertFalse((self.root / "github-env").exists())

    def test_installed_ndk_must_match_pin(self):
        self.prerequisites()
        (self.root / "sdk/ndk" / self.config["ndk"] / "source.properties").write_text(
            "Pkg.Revision = 99.0.0\n")
        self.assertNotEqual(self.run_helper("prepare-android.sh").returncode, 0)
        self.assertNotIn("engine:", (self.root / "trace").read_text())

    def test_gradle_engine_pin_drift_is_rejected_before_install(self):
        self.prerequisites()
        path = self.root / "apps/native/android/build.gradle"
        for name, old, new in (("NDK", self.config["ndk"], "99.0.0"),
                               ("API", "minSdkVersion = 24", "minSdkVersion = 25")):
            with self.subTest(pin=name):
                original = path.read_text()
                path.write_text(original.replace(old, new))
                self.assertNotEqual(self.run_helper("prepare-android.sh").returncode, 0)
                self.assertFalse((self.root / "trace").exists())
                path.write_text(original)

    def test_unsupported_empty_or_duplicate_abi_is_rejected(self):
        path = self.root / "apps/native/android/gradle.properties"
        for abis in ("arm64-v8a,mips", "", "x86_64,x86_64"):
            with self.subTest(abis=abis):
                path.write_text(f"reactNativeArchitectures={abis}\n")
                with self.assertRaises(ValueError):
                    config_module.read_config(self.root)

    def release_assets(self):
        paths = [f"apps/native/android/app/build/outputs/{p}" for p in (
            "apk/google/release/app-google-release.apk",
            "apk/firetv/release/app-firetv-release.apk",
            "bundle/googleRelease/app-google-release.aab",
            "bundle/firetvRelease/app-firetv-release.aab",
        )] + [f'third_party/media-engine/out/android/source/{self.config["source_bundle"]}',
              "third_party/media-engine/out/android/notices/THIRD-PARTY-NOTICES.txt"]
        for path in paths:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(path)
        return [self.root / p for p in paths]

    def test_collects_exact_flavored_release_set_and_preserves_bytes(self):
        assets = self.release_assets()
        # Old/unrelated variants must never leak into a release.
        for name in ("apk/release/old.apk", "apk/google/debug/app-google-debug.apk",
                     "apk/google/release/app-google-x86_64-release.apk"):
            path = self.root / "apps/native/android/app/build/outputs" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("unwanted")
        result = self.run_helper("collect-android-release.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = {p.name: p.read_bytes() for p in assets[:-1]}
        expected["media-engine-android-THIRD-PARTY-NOTICES.txt"] = assets[-1].read_bytes()
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / "dist").iterdir()}, expected)

    def test_each_missing_or_empty_required_asset_fails_before_copy(self):
        assets = self.release_assets()
        # A stale dist and a legacy unflavored output cannot conceal a missing variant.
        stale = self.root / "dist/stale.apk"
        stale.parent.mkdir()
        stale.write_text("old")
        legacy = self.root / "apps/native/android/app/build/outputs/apk/release/old.apk"
        legacy.parent.mkdir(parents=True)
        legacy.write_text("old")
        for path in assets:
            original = path.read_bytes()
            for mode in ("missing", "empty"):
                with self.subTest(asset=path.name, mode=mode):
                    path.unlink()
                    if mode == "empty":
                        path.touch()
                    result = self.run_helper("collect-android-release.sh")
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(str(path.relative_to(self.root)), result.stderr)
                    self.assertEqual(list((self.root / "dist").iterdir()), [stale])
                    path.write_bytes(original)


if __name__ == "__main__":
    unittest.main()
