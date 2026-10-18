#!/usr/bin/env python3
"""Prepare a trusted CI artifact, then sign only its Google AAB. Never executes artifact code."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from zipfile import ZipFile

REPO = "PorticoMediaServer/portico-react-native"
APP_ID = "tv.getportico.portico"
GOOGLE_AAB = "app-google-release.aab"
ABIS = {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}
LIBRARIES = ("porticompv avcodec avformat avutil avfilter swresample swscale ssl crypto mpv ass "
             "freetype harfbuzz fribidi unibreak dav1d placebo lcms2 dovi uchardet iconv").split()
BUNDLETOOL_VERSION = "1.18.3"
# Official google/bundletool release asset digest, also checked on initial download.
BUNDLETOOL_SHA256 = "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29"
MAX_TOTAL = 4 * 1024**3
MAX_FILE = 2 * 1024**3


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest_file(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def sha(value):
    require(bool(re.fullmatch(r"[a-f0-9]{40}", value)), "Expected a full lowercase Git SHA")
    return value


def signature(name):
    upper = name.upper()
    if not upper.startswith("META-INF/"):
        return False
    leaf = upper[9:]
    return "/" not in leaf and (leaf == "MANIFEST.MF" or leaf.startswith("SIG-")
                                or leaf.endswith((".SF", ".RSA", ".DSA", ".EC")))


def safe_zip(archive, flat=False):
    infos = archive.infolist()
    names = [info.filename for info in infos]
    require(len(names) == len(set(names)) and len(names) <= 100000, "Duplicate/excessive ZIP entries")
    require(sum(info.file_size for info in infos) <= MAX_TOTAL, "ZIP expands beyond limit")
    for info in infos:
        name = info.filename
        parts = PurePosixPath(name).parts
        mode = info.external_attr >> 16
        require(name and not name.startswith("/") and "\\" not in name
                and all(ord(c) >= 32 and ord(c) != 127 for c in name)
                and all(p not in ("..", ".") for p in name.rstrip("/").split("/"))
                and str(PurePosixPath(name)) == name.rstrip("/"), "Unsafe ZIP path")
        require(not flat or (len(parts) == 1 and not info.is_dir()), "Artifact must contain flat files")
        require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR)
                and not (info.flag_bits & 1), "Special/encrypted ZIP entry")
        require(info.file_size <= MAX_FILE and
                info.file_size <= max(info.compress_size, 1) * 1000, "Oversized ZIP entry")
    return names


def api(endpoint):
    return json.loads(subprocess.check_output(["gh", "api", "repos/" + REPO + "/" + endpoint]))


def verify_provenance(run, artifact, jobs, commit, head, source, base):
    require(run["repository"]["full_name"] == REPO
            and run["head_repository"]["full_name"] == REPO, "Foreign/fork run")
    require(run["status"] == "completed" and run["path"] == ".github/workflows/ci.yml",
            "Source must be a completed trusted CI workflow")
    require(run["head_sha"] == head, "Historical run head does not match approved head")
    if run["event"] == "pull_request":
        require(run["head_branch"] == "apple-actions-builds", "Untrusted source branch")
        # PR API head is mutable. The exact merge object's parents are the immutable evidence.
        require([p["sha"] for p in commit["parents"]] == [sha(base), head],
                "SOURCE_COMMIT must merge the approved base and historical head, in order")
    else:
        require(run["event"] == "push" and run["head_branch"] == "main"
                and source == head, "Only main push or same-repository approved PR builds are trusted")
    require(commit["sha"] == source, "Incorrect source Git object")
    require(artifact["name"] == "android-and-fire-os" and not artifact["expired"]
            and artifact["workflow_run"]["id"] == run["id"]
            and artifact["workflow_run"]["head_sha"] == head
            and artifact["workflow_run"]["head_branch"] == run["head_branch"]
            and artifact["workflow_run"]["repository_id"] == run["repository"]["id"]
            and artifact["workflow_run"]["head_repository_id"] == run["repository"]["id"],
            "Artifact is expired or does not belong to trusted run")
    matches = [j for j in jobs if j["name"] == "android / Google Android and Fire OS APKs and bundles"]
    require(len(matches) == 1 and matches[0]["conclusion"] == "success"
            and matches[0]["status"] == "completed" and matches[0]["head_sha"] == head,
            "Android package job must have succeeded in this run attempt")


def check_sums(archive):
    names = set(safe_zip(archive, flat=True))
    require("SHA256SUMS" in names, "Missing source checksums")
    require(archive.getinfo("SHA256SUMS").file_size < 1024 * 1024, "Oversized checksums")
    sums = {}
    for line in archive.read("SHA256SUMS").decode("ascii").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_.-]+)", line)
        require(match is not None, "Invalid source checksum line")
        value, name = match.groups()
        require(name not in sums, "Duplicate source checksum")
        sums[name] = value
    require(set(sums) == names - {"SHA256SUMS"}, "Source checksum coverage differs from ZIP")
    for name, expected in sums.items():
        with archive.open(name) as stream:
            require(hashlib.file_digest(stream, "sha256").hexdigest() == expected,
                    "Source checksum mismatch: " + name)
    return sums


def tool():
    path = Path(os.environ["RUNNER_TEMP"]) / "bundletool-all-1.18.3.jar"
    if not path.exists():
        url = ("https://github.com/google/bundletool/releases/download/"
               + BUNDLETOOL_VERSION + "/bundletool-all-" + BUNDLETOOL_VERSION + ".jar")
        with urllib.request.urlopen(url, timeout=120) as response, path.open("wb") as output:
            shutil.copyfileobj(response, output)
    require(digest_file(path) == BUNDLETOOL_SHA256, "Official bundletool SHA256 mismatch")
    return path


def clean_env(extra=None):
    env = {key: os.environ[key] for key in ("PATH", "JAVA_HOME", "HOME", "LANG") if key in os.environ}
    env["LC_ALL"] = "C"
    env.update(extra or {})
    return env


def command(args, env=None):
    # Capture tool diagnostics: never echo secret input or key-provider diagnostics into CI logs.
    result = subprocess.run(args, env=clean_env(env), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, "Tool failed: " + Path(args[0]).name)
    return result.stdout


def inspect_bundle(path, bundletool, source_dir):
    notices = (source_dir / "THIRD-PARTY-NOTICES.txt").read_bytes()
    manifests = {abi: json.loads((source_dir / f"manifest-{abi}.json").read_text())[abi] for abi in ABIS}
    with ZipFile(path) as archive:
        safe_zip(archive)
        names = set(archive.namelist())
        require(archive.read("base/assets/index.android.bundle"), "Missing embedded JavaScript")
        require(archive.read("base/assets/media-engine/THIRD-PARTY-NOTICES.txt") == notices,
                "Embedded media notices differ from corresponding source notices")
        present = {n.split("/")[2] for n in names if n.startswith("base/lib/") and n.endswith(".so")}
        require(present == ABIS, "Unexpected Google AAB native ABIs")
        for abi in ABIS:
            for library in LIBRARIES:
                data = archive.read(f"base/lib/{abi}/lib{library}.so")
                require(data[:4] == b"\x7fELF", "Missing/invalid native media ELF")
                if library != "porticompv":
                    record = manifests[abi][f"lib{library}.so"]
                    require(len(data) == record["size"]
                            and hashlib.sha256(data).hexdigest() == record["sha256"],
                            "Media library differs from source-build manifest")
                    # The media build already checks 16 KB LOAD alignment; recheck signed payload.
                    endian = "<" if data[5] == 1 else ">"
                    wide = data[4] == 2
                    offset = struct.unpack_from(endian + ("Q" if wide else "I"), data, 32 if wide else 28)[0]
                    stride, count = struct.unpack_from(endian + "HH", data, 54 if wide else 42)
                    aligns = [struct.unpack_from(endian + ("Q" if wide else "I"), data,
                                                offset + i * stride + (48 if wide else 28))[0]
                              for i in range(count)
                              if struct.unpack_from(endian + "I", data, offset + i * stride)[0] == 1]
                    require(aligns and all(a >= 16384 for a in aligns), "Media ELF is not 16 KB aligned")
    command(["java", "-jar", str(bundletool), "validate", "--bundle=" + str(path)])
    manifest = command(["java", "-jar", str(bundletool), "dump", "manifest", "--bundle=" + str(path),
                        "--module=base"])
    root = ET.fromstring(manifest)
    require(root.attrib["package"] == APP_ID, "Unexpected Google application ID")
    version = root.attrib["{http://schemas.android.com/apk/res/android}versionCode"]
    require(version.isdigit(), "Invalid versionCode")
    return {"application_id": APP_ID, "version_code": version, "abis": sorted(ABIS),
            "bundletool_version": BUNDLETOOL_VERSION, "bundletool_sha256": BUNDLETOOL_SHA256}


def write_sums(root, name="SHA256SUMS"):
    files = sorted(p for p in root.rglob("*") if p.is_file() and p != root / name)
    (root / name).write_text("".join(f"{digest_file(p)}  {p.relative_to(root).as_posix()}\n" for p in files))


def prepare(output):
    run_id, artifact_id = os.environ["SOURCE_RUN_ID"], os.environ["SOURCE_ARTIFACT_ID"]
    require(run_id.isascii() and run_id.isdigit() and artifact_id.isascii() and artifact_id.isdigit(),
            "Run and artifact IDs must be decimal")
    head, source = sha(os.environ["EXPECTED_HEAD_SHA"]), sha(os.environ["EXPECTED_SOURCE_SHA"])
    run = api("actions/runs/" + run_id)
    artifact = api("actions/artifacts/" + artifact_id)
    require(artifact["id"] == int(artifact_id) and run["id"] == int(run_id), "Wrong API identity")
    require(0 < artifact["size_in_bytes"] <= MAX_TOTAL, "Oversized artifact download")
    jobs = []
    page = 1
    while True:
        batch = api(f"actions/runs/{run_id}/attempts/{run['run_attempt']}/jobs?per_page=100&page={page}")
        jobs.extend(batch["jobs"])
        if len(jobs) >= batch["total_count"]:
            break
        page += 1
        require(page <= 20, "Too many source jobs")
    commit = api("git/commits/" + source)
    verify_provenance(run, artifact, jobs, commit, head, source, os.environ["EXPECTED_BASE_SHA"])
    archive_path = Path(os.environ["RUNNER_TEMP"]) / "google-source-artifact.zip"
    with archive_path.open("wb") as stream:
        subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{artifact_id}/zip"],
                       stdout=stream, check=True)
    require(archive_path.stat().st_size == artifact["size_in_bytes"], "Artifact ZIP size mismatch")
    require(artifact["digest"] == "sha256:" + digest_file(archive_path), "GitHub artifact digest mismatch")
    output.mkdir()
    support = output / "source"
    support.mkdir()
    with ZipFile(archive_path) as archive:
        sums = check_sums(archive)
        require(archive.read("SOURCE_COMMIT").decode("ascii") == source + "\n",
                "Downloaded SOURCE_COMMIT differs from exact approved source")
        required = {"SOURCE_COMMIT", "THIRD-PARTY-NOTICES.txt", GOOGLE_AAB}
        required |= {f"{kind}-{abi}.json" for kind in ("manifest", "build-info") for abi in ABIS}
        require(required <= set(sums) and any(n.endswith(".tar") for n in sums),
                "Missing corresponding source or native build metadata")
        for name in sums:
            if name in ("SOURCE_COMMIT", "THIRD-PARTY-NOTICES.txt") or name.endswith((".tar", ".json")):
                with archive.open(name) as stream, (support / name).open("wb") as dest:
                    shutil.copyfileobj(stream, dest)
        (support / "BUILD_SHA256SUMS").write_bytes(archive.read("SHA256SUMS"))
        with archive.open(GOOGLE_AAB) as stream, (output / "google-original.aab").open("wb") as dest:
            shutil.copyfileobj(stream, dest)
    bundle = inspect_bundle(output / "google-original.aab", tool(), support)
    provenance = {"repository": REPO, "run": run, "artifact": artifact, "source_commit": commit,
                  "android_job": next(j for j in jobs if j["name"] ==
                                      "android / Google Android and Fire OS APKs and bundles"),
                  "expected_head_sha": head, "expected_source_sha": source,
                  "expected_base_sha": os.environ["EXPECTED_BASE_SHA"], "bundle": bundle,
                  "original_google_aab_sha256": sums[GOOGLE_AAB]}
    (output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    write_sums(output)
    print(f"Prepared trusted Google AAB: {source}, versionCode {bundle['version_code']}")


def payload_hashes(path):
    with ZipFile(path) as archive:
        safe_zip(archive)
        result = {}
        for info in archive.infolist():
            if not info.is_dir() and not signature(info.filename):
                with archive.open(info) as stream:
                    result[info.filename] = hashlib.file_digest(stream, "sha256").hexdigest()
        return result


def verify_prepared(root):
    expected = {}
    for line in (root / "SHA256SUMS").read_text().splitlines():
        value, name = line.split("  ", 1)
        require(re.fullmatch(r"[a-f0-9]{64}", value) and
                re.fullmatch(r"(?:source/)?[A-Za-z0-9_.-]+", name), "Unsafe prepared checksum")
        require(name not in expected, "Duplicate prepared checksum")
        expected[name] = value
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()
              and p != root / "SHA256SUMS"}
    require(actual == set(expected), "Prepared file coverage mismatch")
    for name, value in expected.items():
        require(not (root / name).is_symlink() and digest_file(root / name) == value,
                "Prepared checksum mismatch")
    return json.loads((root / "provenance.json").read_text())


def sign(root, output):
    provenance = verify_prepared(root)
    fingerprint = os.environ["ANDROID_UPLOAD_CERT_SHA256"].replace(":", "").lower()
    require(bool(re.fullmatch(r"[a-f0-9]{64}", fingerprint)), "Missing/invalid upload certificate SHA256")
    require(os.environ.get("ANDROID_APPLICATION_ID", APP_ID) == APP_ID, "Invalid application ID contract")
    require(os.environ["ANDROID_UPLOAD_KEY_ALIAS"] == "portico-upload", "Unexpected upload key alias")
    for name in ("ANDROID_UPLOAD_STORE_PASSWORD", "ANDROID_UPLOAD_KEY_PASSWORD"):
        require(os.environ.get(name), "Missing secret: " + name)
    original = root / "google-original.aab"
    require(digest_file(original) == provenance["original_google_aab_sha256"], "Original AAB mismatch")
    bundletool = tool()
    before = inspect_bundle(original, bundletool, root / "source")
    require(before == provenance["bundle"], "Prepared bundle metadata mismatch")
    private = Path(os.environ["SIGNING_DIR"])
    require(private.is_dir() and stat.S_IMODE(private.stat().st_mode) == 0o700
            and private.parent.resolve() == Path(os.environ["RUNNER_TEMP"]).resolve(),
            "Signing directory must be mode 0700 under runner.temp")
    keystore = private / "upload.p12"
    with keystore.open("xb") as stream:
        os.chmod(keystore, 0o600)
        stream.write(base64.b64decode(os.environ["ANDROID_UPLOAD_KEYSTORE_BASE64"], validate=True))
    password_env = {k: os.environ[k] for k in ("ANDROID_UPLOAD_STORE_PASSWORD", "ANDROID_UPLOAD_KEY_PASSWORD")}
    cert = command(["keytool", "-exportcert", "-storetype", "PKCS12", "-keystore", str(keystore),
                    "-storepass:env", "ANDROID_UPLOAD_STORE_PASSWORD", "-alias", "portico-upload"],
                   password_env)
    require(hashlib.sha256(cert).hexdigest() == fingerprint, "Keystore upload certificate SHA256 mismatch")
    unsigned = private / "unsigned.aab"
    with ZipFile(original) as src, ZipFile(unsigned, "w") as dest:
        for info in src.infolist():
            if not signature(info.filename):
                with src.open(info) as stream, dest.open(info, "w") as target:
                    shutil.copyfileobj(stream, target)
    output.mkdir()
    signed = output / "portico-google-upload.aab"
    command(["jarsigner", "-keystore", str(keystore), "-storetype", "PKCS12",
             "-storepass:env", "ANDROID_UPLOAD_STORE_PASSWORD", "-keypass:env", "ANDROID_UPLOAD_KEY_PASSWORD",
             "-digestalg", "SHA-256", "-sigalg", "SHA256withRSA", "-sigfile", "PORTICO",
             "-signedjar", str(signed), str(unsigned), "portico-upload"], password_env)
    # Trust only the explicitly selected local upload certificate; self-signed upload keys are expected.
    command(["jarsigner", "-verify", "-strict", "-keystore", str(keystore), "-storetype", "PKCS12",
             "-storepass:env", "ANDROID_UPLOAD_STORE_PASSWORD", str(signed), "portico-upload"], password_env)
    command(["java", str(Path(__file__).with_name("VerifyGoogleBundle.java")), str(signed), fingerprint])
    require(payload_hashes(original) == payload_hashes(signed), "Signing changed non-signature payload")
    after = inspect_bundle(signed, bundletool, root / "source")
    require(before == after, "Signing changed package/version/ABI metadata")
    shutil.copytree(root / "source", output / "source")
    shutil.copyfile(root / "SHA256SUMS", output / "PREPARED_SHA256SUMS")
    shutil.copyfile(root / "provenance.json", output / "provenance.json")
    verification = {"upload_certificate_sha256": fingerprint, "signed_aab_sha256": digest_file(signed),
                    "original_aab_sha256": digest_file(original), "bundle": after,
                    "all_payload_entries_identical": True, "all_payload_entries_signature_verified": True}
    (output / "verification.json").write_text(json.dumps(verification, indent=2) + "\n")
    write_sums(output)
    summary = (f"Signed Google AAB for {APP_ID}, versionCode {after['version_code']}.\n"
               f"Upload certificate SHA256: {fingerprint}\n"
               "Verified signature, source provenance, embedded JS, four ABIs and identical payload.\n"
               "No store upload performed. Check versionCode availability in the selected Play listing.\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write(summary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "tool", "sign"))
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.operation == "tool":
        tool()
    elif args.operation == "prepare":
        prepare(args.output)
    else:
        sign(args.input, args.output)


if __name__ == "__main__":
    main()
