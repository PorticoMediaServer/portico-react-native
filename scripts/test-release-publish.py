#!/usr/bin/env python3
"""Offline publisher boundary tests; no compilation of applications or release mutation."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).with_name("release-publish.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
HEAD, BASE, SOURCE, TREE = "a" * 40, "b" * 40, "c" * 40, "d" * 40
ENV = {"GITHUB_REPOSITORY": p.REPO, "GITHUB_SHA": HEAD, "GITHUB_EVENT_NAME": "workflow_dispatch",
       "GITHUB_REF": "refs/heads/apple-actions-builds", "GITHUB_REF_NAME": "apple-actions-builds",
       "RELEASE_VERSION": "0.0.1", "SOURCE_RUN_ID": "100", "GITHUB_RUN_ID": "200"}
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def run_fixture():
    return {"id": 100, "repository": {"id": 1, "full_name": p.REPO},
            "head_repository": {"id": 1, "full_name": p.REPO}, "head_sha": HEAD,
            "head_branch": "apple-actions-builds", "path": ".github/workflows/ci.yml",
            "status": "completed", "conclusion": "success", "event": "pull_request", "run_attempt": 1}


def zip_bytes(files):
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return stream.getvalue()


class Boundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_cwd = Path.cwd()
        os.chdir(self.root)

    def tearDown(self):
        os.chdir(self.old_cwd)
        self.temp.cleanup()

    def write(self, name, data=b"payload"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_context_and_stable_versions(self):
        self.assertEqual(p.context(ENV), (HEAD, "0.0.1", True))
        tag = ENV | {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/tags/v1.2.3"}
        self.assertEqual(p.context(tag), (HEAD, "1.2.3", False))
        for env in (ENV | {"GITHUB_REPOSITORY": "fork/repo"}, ENV | {"SOURCE_RUN_ID": ""},
                    ENV | {"GITHUB_SHA": HEAD[:8]}, ENV | {"GITHUB_REF": "refs/heads/untrusted"},
                    tag | {"GITHUB_REF": "refs/tags/v1.2.3-beta"},
                    tag | {"GITHUB_REF": "refs/heads/main"},
                    ENV | {"GITHUB_EVENT_NAME": "pull_request_target"}):
            with self.subTest(env=env), self.assertRaises(ValueError):
                p.context(env)
        for version in ("v0.0.1", "01.0.1", "0.0", "0.0.1+build", "1.0.0-rc1", "0.0.1\n"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                p.stable_version(version)

    def test_only_exact_complete_same_repository_ci(self):
        run = run_fixture()
        p.trusted_run(run, HEAD, manual=True, run_id="100")
        for field, value in (("id", 99), ("head_sha", BASE), ("conclusion", "failure"),
                             ("status", "in_progress"), ("event", "workflow_dispatch"),
                             ("head_branch", "untrusted"), ("path", ".github/workflows/android-builds.yml"),
                             ("head_repository", {"id": 2, "full_name": "fork/repo"})):
            with self.subTest(field=field), self.assertRaises(ValueError):
                p.trusted_run(run | {field: value}, HEAD, manual=True, run_id="100")

    def test_full_ci_jobs_including_apple_are_required(self):
        jobs = [{"name": name, "status": "completed", "conclusion": "success", "head_sha": HEAD}
                for name in p.JOBS]
        with patch.object(p, "collection", return_value=jobs):
            p.trusted_jobs(run_fixture(), True)
        for bad in ([j for j in jobs if j["name"] != "apple / apps (ios, iphoneos)"],
                    [j | {"conclusion": "skipped"} if j["name"] == "apple / apps (tvos, appletvos)" else j for j in jobs],
                    [jobs[0] | {"head_sha": BASE}] + jobs[1:]):
            with patch.object(p, "collection", return_value=bad), self.assertRaises(ValueError):
                p.trusted_jobs(run_fixture(), True)
        with patch.object(p, "collection", return_value=[j | {"name": "checks / " + j["name"]} for j in jobs]):
            p.trusted_jobs(run_fixture(), False)

    def test_merge_uses_approved_ordered_parents_and_exact_tree(self):
        state = {"run": run_fixture(), "base": BASE, "head": HEAD, "manual": True}
        commit = {"sha": SOURCE, "tree": {"sha": TREE}, "parents": [{"sha": BASE}, {"sha": HEAD}]}
        with patch.object(p, "api", return_value=commit):
            self.assertEqual(p.source_commit(SOURCE, state, {"tree": {"sha": TREE}}), commit)
        for bad in (commit | {"parents": [{"sha": HEAD}, {"sha": BASE}]},
                    commit | {"parents": [{"sha": BASE}, {"sha": "e" * 40}]},
                    commit | {"tree": {"sha": BASE}}, commit | {"sha": HEAD}):
            with patch.object(p, "api", return_value=bad), self.assertRaises(ValueError):
                p.source_commit(SOURCE, state, {"tree": {"sha": TREE}})
        with patch.object(p, "api", return_value=commit), self.assertRaises(ValueError):
            p.source_commit(SOURCE, state | {"manual": False}, {"tree": {"sha": TREE}})

    def test_checksum_coverage_tampering_duplicates_and_symlinks(self):
        self.write("file")
        p.google.write_sums(self.root)
        self.assertEqual(set(p.check_files(self.root)), {"file"})
        self.write("file", b"tampered")
        with self.assertRaises(ValueError):
            p.check_files(self.root)
        p.google.write_sums(self.root)
        self.write("extra", b"unlisted")
        with self.assertRaises(ValueError):
            p.check_files(self.root)
        (self.root / "extra").unlink()
        sums = (self.root / "SHA256SUMS").read_bytes()
        self.write("SHA256SUMS", sums * 2)
        with self.assertRaises(ValueError):
            p.check_files(self.root)
        self.write("SHA256SUMS", sums)
        (self.root / "link").symlink_to(self.root / "file")
        with self.assertRaises(ValueError):
            p.check_files(self.root)
        (self.root / "link").unlink()
        self.write("source/file")
        p.google.write_sums(self.root)
        with self.assertRaises(ValueError):
            p.check_files(self.root)
        p.check_files(self.root, flat=False)

    def test_immutable_artifact_digest_and_extracted_files(self):
        root = self.root / "input"
        root.mkdir()
        (root / "file").write_bytes(b"payload")
        raw = zip_bytes({"file": b"payload"})
        record = {"id": 7, "size_in_bytes": len(raw), "digest": "sha256:" + hashlib.sha256(raw).hexdigest()}
        def download(args, stdout, **kwargs):
            stdout.write(raw)
        with patch.object(p.subprocess, "run", side_effect=download):
            p.verify_download(root, record)
            with self.assertRaises(ValueError):
                p.verify_download(root, record | {"digest": "sha256:" + "0" * 64})
            (root / "file").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                p.verify_download(root, record)

    def test_outer_allowlist_requires_exact_corresponding_source_revision(self):
        for platform in p.ARTIFACTS:
            expected = p.expected_artifact_files(platform, 1)
            self.assertNotIn("private-key.pem", expected)
            self.assertNotIn("vendor-sdk.tar", expected)
            if platform != "vega":
                source = "portico-media-engine-" + ("android" if platform == "android" else "apple") + "-source-r1.tar"
                self.assertIn(source, expected)
                self.assertNotEqual(expected - {source}, expected)
                self.assertNotIn(source.replace("r1.tar", "r2.tar"), expected)

    def test_embedded_android_identity(self):
        attrs = {"package": p.google.APP_ID, ANDROID_NS + "versionName": "0.0.1", ANDROID_NS + "versionCode": "1"}
        p.android_identity(attrs, "0.0.1", "1")
        for key, value in (("package", "wrong.app"), (ANDROID_NS + "versionName", "0.1.0"),
                           (ANDROID_NS + "versionCode", "2")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                p.android_identity(attrs | {key: value}, "0.0.1", "1")

    def test_android_real_zip_payload_and_metadata(self):
        root = self.root / "android"
        root.mkdir()
        (root / "THIRD-PARTY-NOTICES.txt").write_bytes(b"notices")
        (root / "source.tar").write_bytes(b"source")
        elf = b"\x7fELFpayload"
        for abi in p.google.ABIS:
            (root / f"manifest-{abi}.json").write_text(json.dumps({abi: {
                f"lib{lib}.so": {"size": len(elf), "sha256": hashlib.sha256(elf).hexdigest()}
                for lib in p.google.LIBRARIES if lib != "porticompv"}}))
            (root / f"build-info-{abi}.json").write_text("{}")
        for flavor in ("google", "firetv"):
            for ext in ("apk", "aab"):
                prefix = "base/" if ext == "aab" else ""
                files = {prefix + "assets/index.android.bundle": b"JS",
                         prefix + "assets/media-engine/THIRD-PARTY-NOTICES.txt": b"notices"}
                files |= {f"{prefix}lib/{abi}/lib{lib}.so": elf for abi in p.google.ABIS for lib in p.google.LIBRARIES}
                (root / f"app-{flavor}-release.{ext}").write_bytes(zip_bytes(files))
        xml = b'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="tv.getportico.portico" android:versionName="0.0.1" android:versionCode="1"/>'
        with patch.dict(os.environ, {"ANDROID_HOME": "/unused"}), patch.object(p.google, "tool", return_value=Path("/unused.jar")), \
                patch.object(p.google, "command", return_value=xml), patch.object(p, "command", return_value=
                    b"package: name='tv.getportico.portico' versionCode='1' versionName='0.0.1'"):
            self.assertEqual(len(p.inspect_android(root, "0.0.1", "1")), 4)
            with self.assertRaises(ValueError):
                p.inspect_android(root, "0.1.0", "1")
            (root / "THIRD-PARTY-NOTICES.txt").write_bytes(b"different")
            with self.assertRaises(ValueError):
                p.inspect_android(root, "0.0.1", "1")

    def apple(self, *, version="0.0.1", missing_js=False, bundle_id=p.google.APP_ID):
        prefix = "Portico-ios.xcarchive/"
        app = prefix + "Products/Applications/Portico.app/"
        props = {"CFBundleIdentifier": p.google.APP_ID, "CFBundleShortVersionString": "0.0.1",
                 "CFBundleVersion": "1", "ApplicationPath": "Applications/Portico.app"}
        plist = {"CFBundleIdentifier": bundle_id, "CFBundleShortVersionString": version,
                 "CFBundleVersion": "1", "CFBundleSupportedPlatforms": ["iPhoneOS"]}
        files = {prefix + "Info.plist": plistlib.dumps({"ApplicationProperties": props}),
                 app + "Info.plist": plistlib.dumps(plist),
                 app + "Frameworks/Libmpv.framework/THIRD-PARTY-NOTICES.txt": b"notices"}
        if not missing_js:
            files[app + "main.jsbundle"] = b"javascript"
        return self.write("archive.zip", zip_bytes(files))

    def test_complete_device_apple_archive(self):
        archive = self.apple()
        p.inspect_apple(archive, "ios", "0.0.1", "1", b"notices")
        for kwargs in ({"version": "0.1.0"}, {"bundle_id": "wrong.bundle"}, {"missing_js": True}):
            with self.subTest(kwargs=kwargs), self.assertRaises((ValueError, KeyError)):
                p.inspect_apple(self.apple(**kwargs), "ios", "0.0.1", "1", b"notices")
        with self.assertRaises(ValueError):
            p.inspect_apple(self.apple(), "ios", "0.0.1", "2", b"notices")

    def vpkg(self, *, manifest_version="0.0.1", build_version="0.0.1", extra=None):
        files = {"manifest.toml": f'[package]\nid = "tv.getportico.portico.vega"\nversion = "{manifest_version}"\n'.encode(),
                 "meta-info/build-info.json": json.dumps({"data": {"version": build_version}}).encode(),
                 "bundle/index.bundle": b"JS", "bundle/index.hermes.bundle": b"Hermes"}
        files.update(extra or {})
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as archive:
            for name, data in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        return self.write("test.vpkg", subprocess.check_output(["zstd", "-q", "-c"], input=stream.getvalue()))

    def test_vega_real_zstd_tar_metadata_and_paths(self):
        p.inspect_vega(self.vpkg(), "0.0.1")
        for kwargs in ({"manifest_version": "0.1.0"}, {"build_version": "0.1.0"}, {"extra": {"../private": b"x"}}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                p.inspect_vega(self.vpkg(**kwargs), "0.0.1")

    def signed_fixture(self):
        android = self.root / "android"
        root = self.root / "signed"
        android.mkdir()
        root.mkdir()
        original = zip_bytes({"base/manifest/AndroidManifest.xml": b"manifest", "base/assets/js": b"JS"})
        (android / p.google.GOOGLE_AAB).write_bytes(original)
        for name, data in {"SOURCE_COMMIT": (SOURCE + "\n").encode(), "THIRD-PARTY-NOTICES.txt": b"notices",
                           "source.tar": b"source", "manifest-arm64-v8a.json": b"{}"}.items():
            (android / name).write_bytes(data)
        p.google.write_sums(android)
        source = root / "source"
        source.mkdir()
        for path in android.iterdir():
            if path.suffix != ".aab":
                (source / ("BUILD_SHA256SUMS" if path.name == "SHA256SUMS" else path.name)).write_bytes(path.read_bytes())
        signed = root / "portico-google-upload.aab"
        signed.write_bytes(zip_bytes({"base/manifest/AndroidManifest.xml": b"manifest", "base/assets/js": b"JS",
                                     "META-INF/PORTICO.SF": b"signature"}))
        bundle = {"application_id": p.google.APP_ID, "version_code": "1", "abis": sorted(p.google.ABIS)}
        commit = {"sha": SOURCE, "tree": {"sha": TREE}}
        state = {"head": HEAD, "source": SOURCE, "base": BASE, "source_commit": commit,
                 "versions": {"android_code": "1"}, "run": {"id": 100, "run_attempt": 1},
                 "artifacts": {"android": {"id": 7, "digest": "sha256:artifact"}}}
        provenance = {"repository": p.REPO, "expected_head_sha": HEAD, "expected_source_sha": SOURCE,
                      "run": state["run"], "artifact": state["artifacts"]["android"],
                      "expected_base_sha": BASE, "source_commit": commit, "bundle": bundle,
                      "original_google_aab_sha256": p.digest(android / p.google.GOOGLE_AAB)}
        verification = {"upload_certificate_sha256": "f" * 64, "signed_aab_sha256": p.digest(signed), "bundle": bundle,
                        "original_aab_sha256": p.digest(android / p.google.GOOGLE_AAB),
                        "all_payload_entries_identical": True, "all_payload_entries_signature_verified": True}
        p.write_json(root / "provenance.json", provenance)
        p.write_json(root / "verification.json", verification)
        (root / "PREPARED_SHA256SUMS").write_bytes(b"prepared sums")
        p.google.write_sums(root)
        return root, state, android

    def test_signed_google_provenance_payload_and_support(self):
        root, state, android = self.signed_fixture()
        with patch.object(p.google, "command", return_value=b"verified") as verifier:
            p.inspect_signed(root, state, android)
            self.assertIn("VerifyGoogleBundle.java", verifier.call_args.args[0][1])
            for bad in (state | {"source": HEAD}, state | {"head": BASE},
                        state | {"run": {"id": 101, "run_attempt": 1}}):
                with self.assertRaises(ValueError):
                    p.inspect_signed(root, bad, android)
            (root / "private-key.pem").write_bytes(b"do not publish")
            p.google.write_sums(root)
            with self.assertRaises(ValueError):
                p.inspect_signed(root, state, android)
            (root / "private-key.pem").unlink()
            (android / p.google.GOOGLE_AAB).write_bytes(zip_bytes({"payload": b"changed"}))
            p.google.write_sums(root)
            with self.assertRaises(ValueError):
                p.inspect_signed(root, state, android)

    def test_source_versions_include_lock_roots_and_build_numbers(self):
        for app in ("native", "vega"):
            self.write(f"apps/{app}/package.json", b'{"version":"0.0.1"}')
            self.write(f"apps/{app}/package-lock.json",
                       b'{"version":"0.0.1","packages":{"":{"version":"0.0.1"}}}')
        self.write("apps/vega/manifest.toml",
                   b'[package]\nversion = "0.0.1"\nid = "tv.getportico.portico.vega"\n')
        self.write("apps/native/android/app/build.gradle", b'versionName "0.0.1"\nversionCode 1')
        for platform in ("ios", "tvos"):
            self.write(f"apps/native/{platform}/Portico.xcodeproj/project.pbxproj",
                       b'MARKETING_VERSION = 0.0.1;\nCURRENT_PROJECT_VERSION = 1;')
        self.assertEqual(p.checked_versions(self.root, "0.0.1")["android_code"], "1")
        bad = self.root / "apps/vega/package-lock.json"
        bad.write_text('{"version":"0.0.1","packages":{"":{"version":"0.1.0"}}}')
        with self.assertRaises(ValueError):
            p.checked_versions(self.root, "0.0.1")

    def test_artifact_requires_exact_run_head_repository_and_digest(self):
        run = run_fixture()
        record = {"id": 7, "name": "android-and-fire-os", "expired": False,
                  "size_in_bytes": 100, "digest": "sha256:" + "e" * 64,
                  "workflow_run": {"id": 100, "head_sha": HEAD, "head_branch": "apple-actions-builds",
                                   "repository_id": 1, "head_repository_id": 1}}
        with patch.object(p, "collection", return_value=[record]), patch.object(p, "api", return_value=record):
            self.assertEqual(p.artifact_record(run, record["name"]), record)
        for bad in (record | {"expired": True}, record | {"digest": None},
                    record | {"workflow_run": record["workflow_run"] | {"head_sha": BASE}},
                    record | {"workflow_run": record["workflow_run"] | {"head_repository_id": 2}}):
            with patch.object(p, "collection", return_value=[record]), patch.object(p, "api", return_value=bad):
                with self.assertRaises((ValueError, TypeError)):
                    p.artifact_record(run, record["name"])

    def test_root_licenses_are_included_without_docs(self):
        with patch.object(p, "command", return_value=b"LICENSE\nNOTICE.txt\nCOPYING.md\nREADME.md\nAGENTS.md\nprivate\n"):
            self.assertEqual(p.root_licenses(HEAD), ["LICENSE", "NOTICE.txt", "COPYING.md"])
        with patch.object(p, "command", return_value=b"README.md\n"):
            with self.assertRaises(ValueError):
                p.root_licenses(HEAD)

    def test_publish_draft_resume_immutable_conflicts_and_final_readback(self):
        state = {"head": HEAD, "version": "0.0.1", "manual": True}
        p.write_json(Path("release-state.json"), state)
        dist = self.root / "dist"
        dist.mkdir()
        p.write_json(dist / "provenance.json", state)
        (dist / "application.apk").write_bytes(b"APK")
        p.google.write_sums(dist, "SHA256SUMS.txt")
        Path("release-notes.md").write_text("exact notes")
        files = {f.name: f for f in dist.iterdir()}
        tag, release, uploaded, uploads, mutations = None, None, {}, [], []
        def endpoint(path, payload=None, optional=False):
            nonlocal tag, release
            if path == "releases/tags/v0.0.1":
                return copy.deepcopy(release)
            if path == "git/refs":
                tag = payload["sha"]
                mutations.append("tag")
                return {}
            if path == "releases":
                release = payload | {"id": 8, "html_url": "https://example/release"}
                mutations.append("draft")
                return copy.deepcopy(release)
            if path == "releases/8/assets?per_page=100":
                return list(uploaded.values())
            if path == "releases/8":
                return copy.deepcopy(release)
            raise AssertionError(path)
        def upload(args, **kwargs):
            name = Path(args[4]).name
            uploads.append(name)
            path = files[name]
            uploaded[name] = {"name": name, "state": "uploaded", "size": path.stat().st_size,
                              "digest": "sha256:" + p.digest(path)}
        def publish(path, payload):
            release.update(payload)
            mutations.append("publish")
        with patch.dict(os.environ, ENV), patch.object(p, "api", side_effect=endpoint), \
                patch.object(p, "resolve_tag", side_effect=lambda _: tag), patch.object(p, "patch", side_effect=publish), \
                patch.object(p.subprocess, "run", side_effect=upload):
            tag = BASE
            with self.assertRaises(ValueError):
                p.publish()
            self.assertEqual(mutations, [])
            tag = None
            p.publish()
            self.assertFalse(release["draft"])
            self.assertEqual(release["make_latest"], "true")
            self.assertEqual(set(uploads), set(files))
            self.assertEqual(mutations, ["tag", "draft", "publish"])
            uploads.clear()
            p.publish()
            self.assertEqual(uploads, [])
            release["draft"] = True
            uploaded.pop("application.apk")
            p.publish()
            self.assertEqual(uploads, ["application.apk"])
            uploaded["application.apk"]["digest"] = "sha256:" + "0" * 64
            with self.assertRaises(ValueError):
                p.publish()
            self.assertEqual(uploads, ["application.apk"])


if __name__ == "__main__":
    unittest.main()
