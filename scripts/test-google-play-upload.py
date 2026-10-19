#!/usr/bin/env python3
"""Regression checks for the signing boundary; no production credentials or network access."""
import hashlib
import importlib.util
import io
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import warnings
from zipfile import ZipFile, ZipInfo

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("upload", Path(__file__).with_name("google-play-upload.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class UploadBoundaryTests(unittest.TestCase):
    def fixture(self):
        head, source, base = "a" * 40, "b" * 40, "c" * 40
        run = {"id": 1, "repository": {"full_name": upload.REPO, "id": 3},
               "head_repository": {"full_name": upload.REPO}, "status": "completed",
               "path": ".github/workflows/ci.yml", "event": "pull_request",
               "head_branch": "apple-actions-builds", "head_sha": head,
               # Deliberately floating PR metadata: immutable Git parents must prevail.
               "pull_requests": [{"head": {"sha": "d" * 40}}]}
        artifact = {"name": "android-and-fire-os", "expired": False,
                    "workflow_run": {"id": 1, "head_sha": head, "repository_id": 3,
                                     "head_repository_id": 3, "head_branch": "apple-actions-builds"}}
        jobs = [{"name": "android / Google Android and Fire OS APKs and bundles",
                 "conclusion": "success", "status": "completed", "head_sha": head}]
        commit = {"sha": source, "parents": [{"sha": base}, {"sha": head}]}
        return [run, artifact, jobs, commit, head, source, base]

    def test_historical_head_and_failed_overall_run(self):
        args = self.fixture()
        args[0]["conclusion"] = "failure"
        upload.verify_provenance(*args)

    def test_reject_untrusted_provenance(self):
        cases = [
            (0, "head_repository", {"full_name": "fork/repository"}),
            (0, "repository", {"full_name": "foreign/repository", "id": 3}),
            (0, "head_branch", "untrusted"),
            (0, "head_sha", "e" * 40),
            (0, "status", "in_progress"),
            (0, "path", ".github/workflows/untrusted.yml"),
            (0, "event", "workflow_dispatch"),
            (1, "expired", True),
            (1, "name", "arbitrary-upload"),
            (3, "sha", "e" * 40),
            (3, "parents", [{"sha": "e" * 40}, {"sha": "a" * 40}]),
            (3, "parents", [{"sha": "a" * 40}, {"sha": "c" * 40}]),
        ]
        for index, key, value in cases:
            with self.subTest(key=key, value=value):
                args = self.fixture()
                args[index][key] = value
                with self.assertRaises(ValueError):
                    upload.verify_provenance(*args)
        for key, value in (("id", 9), ("head_repository_id", 9), ("head_sha", "e" * 40),
                           ("head_branch", "untrusted")):
            args = self.fixture()
            args[1]["workflow_run"][key] = value
            with self.subTest(artifact=key), self.assertRaises(ValueError):
                upload.verify_provenance(*args)
        for conclusion in ("failure", "cancelled", None):
            args = self.fixture()
            args[2][0]["conclusion"] = conclusion
            with self.subTest(job=conclusion), self.assertRaises(ValueError):
                upload.verify_provenance(*args)
        args = self.fixture()
        args[2] *= 2
        with self.assertRaises(ValueError):
            upload.verify_provenance(*args)

    def test_main_push_requires_exact_source(self):
        args = self.fixture()
        args[0].update(event="push", head_branch="main")
        args[1]["workflow_run"]["head_branch"] = "main"
        args[3]["sha"] = args[4]
        args[5] = args[4]
        upload.verify_provenance(*args)
        args[5] = "e" * 40
        with self.assertRaises(ValueError):
            upload.verify_provenance(*args)

    def archive(self, entries):
        buffer = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with ZipFile(buffer, "w") as archive:
                for name, data in entries:
                    archive.writestr(name, data)
        buffer.seek(0)
        return ZipFile(buffer)

    def test_reject_unsafe_zip_paths(self):
        for name in ("../escape", "/absolute", "a/../b", "a//b", "./a", "a\\b", "a\nb"):
            with self.subTest(name=name), self.archive([(name, b"x")]) as archive:
                with self.assertRaises(ValueError):
                    upload.safe_zip(archive)
        for entries in ([("a", b"x"), ("a", b"y")], [("folder/a", b"x")]):
            with self.archive(entries) as archive, self.assertRaises(ValueError):
                upload.safe_zip(archive, flat=True)

    def test_reject_special_zip_entries(self):
        link = ZipInfo("link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.archive([(link, b"target")]) as archive, self.assertRaises(ValueError):
            upload.safe_zip(archive)

    def test_reject_expansion_limit(self):
        old_limit = upload.MAX_TOTAL
        try:
            upload.MAX_TOTAL = 1
            with self.archive([("a", b"xx")]) as archive, self.assertRaises(ValueError):
                upload.safe_zip(archive)
        finally:
            upload.MAX_TOTAL = old_limit

    def test_complete_checksum_coverage(self):
        checksum = hashlib.sha256(b"payload").hexdigest()
        sums = f"{checksum}  file\n".encode()
        with self.archive([("file", b"payload"), ("SHA256SUMS", sums)]) as archive:
            self.assertEqual(upload.check_sums(archive), {"file": checksum})
        for entries in (
            [("file", b"tampered"), ("SHA256SUMS", sums)],
            [("file", b"payload"), ("extra", b"hidden"), ("SHA256SUMS", sums)],
            [("file", b"payload"), ("SHA256SUMS", sums * 2)],
            [("file", b"payload"), ("SHA256SUMS", b"unsafe format")],
        ):
            with self.archive(entries) as archive, self.assertRaises(ValueError):
                upload.check_sums(archive)

    def test_signature_stripping_keeps_unrelated_meta_inf(self):
        for name in ("META-INF/MANIFEST.MF", "meta-inf/old.sf", "META-INF/OLD.RSA",
                     "META-INF/OLD.DSA", "META-INF/OLD.EC", "META-INF/SIG-OLD"):
            self.assertTrue(upload.signature(name), name)
        for name in ("base/assets/index.android.bundle", "META-INF/services/a",
                     "META-INF/native-image/a.SF", "base/META-INF/OLD.RSA", "META-INF/NOTICE"):
            self.assertFalse(upload.signature(name), name)

    def test_payload_comparison_ignores_only_signatures(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = [Path(folder) / name for name in ("before.aab", "after.aab", "bad.aab")]
            for path, payload, sig in zip(paths, (b"same", b"same", b"changed"), (b"old", b"new", b"new")):
                with ZipFile(path, "w") as archive:
                    archive.writestr("base/assets/index.android.bundle", payload)
                    archive.writestr("META-INF/OLD.RSA", sig)
            self.assertEqual(upload.payload_hashes(paths[0]), upload.payload_hashes(paths[1]))
            self.assertNotEqual(upload.payload_hashes(paths[0]), upload.payload_hashes(paths[2]))

    def test_prepared_tampering_and_coverage(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "provenance.json").write_text("{}")
            upload.write_sums(root)
            self.assertEqual(upload.verify_prepared(root), {})
            (root / "provenance.json").write_text('{"tampered":true}')
            with self.assertRaises(ValueError):
                upload.verify_prepared(root)
            upload.write_sums(root)
            (root / "extra").write_text("hidden")
            with self.assertRaises(ValueError):
                upload.verify_prepared(root)

    def test_java_verifier_rejects_unsigned_tampered_and_wrong_certificate(self):
        import os
        import subprocess
        import secrets

        def run(args, password=None):
            env = upload.clean_env({"FIXTURE_PASSWORD": password} if password else {})
            result = subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(result.returncode, 0, args[0])
            return result.stdout

        with tempfile.TemporaryDirectory(prefix="google-upload-test-") as folder:
            root = Path(folder)
            password = secrets.token_urlsafe(24)
            key = root / "fixture.p12"
            run(["keytool", "-genkeypair", "-alias", "fixture", "-keyalg", "RSA", "-keysize", "3072",
                 "-validity", "30", "-dname", "CN=Disposable CI test fixture", "-storetype", "PKCS12",
                 "-keystore", str(key), "-storepass:env", "FIXTURE_PASSWORD",
                 "-keypass:env", "FIXTURE_PASSWORD"], password)
            os.chmod(key, 0o600)
            cert = run(["keytool", "-exportcert", "-keystore", str(key),
                        "-storepass:env", "FIXTURE_PASSWORD", "-alias", "fixture"], password)
            fingerprint = hashlib.sha256(cert).hexdigest()
            unsigned, signed, tampered = [root / n for n in ("unsigned.jar", "signed.jar", "tampered.jar")]
            with ZipFile(unsigned, "w") as archive:
                archive.writestr("base/assets/index.android.bundle", b"fixture payload")
            run(["jarsigner", "-keystore", str(key), "-storepass:env", "FIXTURE_PASSWORD",
                 "-keypass:env", "FIXTURE_PASSWORD", "-signedjar", str(signed), str(unsigned), "fixture"],
                password)
            verifier = str(Path(__file__).with_name("VerifyGoogleBundle.java"))
            run(["java", verifier, str(signed), fingerprint])
            with ZipFile(signed) as src, ZipFile(tampered, "w") as dest:
                for info in src.infolist():
                    data = src.read(info)
                    if info.filename == "base/assets/index.android.bundle":
                        data = b"tampered payload"
                    dest.writestr(info, data)
            for path, expected in ((unsigned, fingerprint), (tampered, fingerprint), (signed, "0" * 64)):
                result = subprocess.run(["java", verifier, str(path), expected], env=upload.clean_env(),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertNotEqual(result.returncode, 0, str(path))


if __name__ == "__main__":
    unittest.main()
