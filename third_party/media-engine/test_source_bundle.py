"""Corresponding-source requirements remain specific to the recipe being verified."""
import importlib.util
import io
import json
import pathlib
import os
import subprocess
import hashlib
import tarfile
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("media_engine_verify", HERE / "verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
LOCK = json.loads((HERE / "sources.lock.json").read_text())
SOURCES = {entry["file"] for entry in LOCK["components"].values() if "android" in entry["platforms"] and not entry.get("prebuilt")}
SOURCES.update(sub["file"] for entry in LOCK["components"].values() if "android" in entry["platforms"] for sub in entry.get("subsources", {}).values())
PATCHES = {path.name for path in (HERE / "patches").rglob("*.patch")}
RECIPE = {"libdovi-vendored-crates.tar", "sources.lock.json", "build-android.sh", "common.sh"}
CONTEXT = {"recipe/scripts/prepare-ffmpeg-source.py": HERE.parent.parent / "scripts/prepare-ffmpeg-source.py",
           "recipe/third_party/ffmpeg/sources.lock.json": HERE.parent / "ffmpeg/sources.lock.json"}
RECIPE_PATHS = {"sources.lock.json": "recipe/third_party/media-engine/sources.lock.json",
                "build-android.sh": "recipe/third_party/media-engine/build-android.sh",
                "common.sh": "recipe/third_party/media-engine/lib/common.sh"}


class SourceBundleTest(unittest.TestCase):
    def check_bundle(self, members, notices=True, omit_context=None, corrupt_context=None, misplaced_context=False, exercise=False):
        with tempfile.TemporaryDirectory(prefix="source-bundle-") as directory:
            out = pathlib.Path(directory)
            source = out / "android/source"
            source.mkdir(parents=True)
            bundle_root = f"portico-media-engine-android-source-r{LOCK['revision']}"
            bundle = source / f"{bundle_root}.tar"
            with tarfile.open(bundle, "w") as archive:
                for name in sorted(members):
                    relative = RECIPE_PATHS.get(name, f"archives/{name}")
                    actual = {"sources.lock.json": HERE / name, "build-android.sh": HERE / name, "common.sh": HERE / "lib/common.sh"}.get(name)
                    body = actual.read_bytes() if actual else b"test source member\n"
                    entry = tarfile.TarInfo(f"{bundle_root}/{relative}")
                    entry.size = len(body)
                    archive.addfile(entry, io.BytesIO(body))
                for relative, actual in CONTEXT.items():
                    if relative == omit_context:
                        continue
                    body = b"altered source\n" if relative == corrupt_context else actual.read_bytes()
                    entry = tarfile.TarInfo(f"{bundle_root}/{pathlib.Path(relative).name if misplaced_context else relative}")
                    entry.size = len(body)
                    archive.addfile(entry, io.BytesIO(body))
            if notices:
                folder = out / "android/notices"
                folder.mkdir()
                (folder / "THIRD-PARTY-NOTICES.txt").write_text("\n".join(f"{name} {entry['version']}" for name, entry in LOCK["components"].items() if "android" in entry["platforms"]))
            report = verify.Report()
            verify.check_notices(report, out, "android")
            if exercise:
                with tarfile.open(bundle) as archive:
                    archive.extractall(out / "extracted", filter="data")
                engine = out / "extracted" / bundle_root / "recipe/third_party/media-engine"
                work = out / "work"
                (work / "downloads").mkdir(parents=True)
                (work / "downloads" / LOCK["components"]["ffmpeg"]["file"]).write_bytes(b"not the checked upstream archive")
                result = subprocess.run(["bash", "-c", 'source "$1/lib/common.sh"; me_extract ffmpeg', "_", str(engine)],
                                        env={**os.environ, "MEDIA_ENGINE_WORK_DIR": str(work), "MEDIA_ENGINE_OUT_DIR": str(out / "output")}, capture_output=True, text=True)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("Jellyfin FFmpeg source checksum mismatch", result.stderr)
                self.assertNotIn("No such file or directory", result.stderr)
            return report

    def test_android_corresponding_source_uses_its_own_recipe_without_an_apple_build(self):
        members = SOURCES | PATCHES | RECIPE
        self.assertNotIn("build-apple.sh", members)
        self.assertEqual([], self.check_bundle(members).failures)

    def test_every_android_recipe_input_is_still_required_even_if_apple_script_is_present(self):
        for required in RECIPE:
            with self.subTest(required=required):
                report = self.check_bundle((SOURCES | PATCHES | RECIPE | {"build-apple.sh"}) - {required})
                self.assertIn(f"android: the source bundle lacks {RECIPE_PATHS.get(required, required)}", report.failures)

    def test_every_selected_component_and_subsource_archive_is_still_required(self):
        for required in SOURCES:
            with self.subTest(required=required):
                report = self.check_bundle((SOURCES | PATCHES | RECIPE) - {required})
                self.assertIn(f"android: the source bundle lacks {required}", report.failures)

    def test_every_checked_patch_is_still_required(self):
        for patch in PATCHES:
            with self.subTest(patch=patch):
                report = self.check_bundle((SOURCES | PATCHES | RECIPE) - {patch})
                self.assertIn(f"android: the source bundle lacks patch {patch}", report.failures)

    def test_missing_notices_still_fail(self):
        report = self.check_bundle(SOURCES | PATCHES | RECIPE, notices=False)
        self.assertTrue(any("is missing (run collect-notices.sh)" in failure for failure in report.failures))

    def test_canonical_helper_and_patch_lock_are_required_at_their_repository_paths(self):
        for relative in CONTEXT:
            with self.subTest(relative=relative):
                report = self.check_bundle(SOURCES | PATCHES | RECIPE, omit_context=relative)
                self.assertIn(f"android: the source bundle lacks {relative}", report.failures)
        self.assertTrue(self.check_bundle(SOURCES | PATCHES | RECIPE, misplaced_context=True).failures)

    def test_canonical_source_context_cannot_be_replaced_with_same_named_files(self):
        for relative in CONTEXT:
            with self.subTest(relative=relative):
                report = self.check_bundle(SOURCES | PATCHES | RECIPE, corrupt_context=relative)
                self.assertIn(f"android: the source bundle has different bytes for {relative}", report.failures)

    def test_packaged_recipe_resolves_its_real_offline_preparer_and_patch_manifest(self):
        self.assertEqual([], self.check_bundle(SOURCES | PATCHES | RECIPE, exercise=True).failures)

    def test_actual_packager_preserves_canonical_relative_source_context(self):
        with tempfile.TemporaryDirectory(prefix="source-recipe-") as directory:
            destination = pathlib.Path(directory) / "recipe"
            subprocess.run(["bash", "-c", 'source "$1/lib/common.sh"; me_source_recipe "$2"', "_", str(HERE), str(destination)], check=True)
            for relative, actual in CONTEXT.items():
                self.assertEqual(hashlib.sha256(actual.read_bytes()).digest(), hashlib.sha256((destination.parent / relative).read_bytes()).digest())
            self.assertEqual((HERE / "lib/common.sh").read_bytes(), (destination / "third_party/media-engine/lib/common.sh").read_bytes())
            self.assertFalse((destination / "third_party/media-engine/out").exists())
            self.assertFalse((destination / "third_party/media-engine/work").exists())


if __name__ == "__main__":
    unittest.main()
