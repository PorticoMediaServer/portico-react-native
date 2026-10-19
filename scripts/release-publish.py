#!/usr/bin/env python3
"""Validate exact CI output and publish immutable native application releases.

Artifact contents are data only: never import, source, or execute downloaded code.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
import xml.etree.ElementTree as ET
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("google_upload", Path(__file__).with_name("google-play-upload.py"))
google = importlib.util.module_from_spec(spec)
spec.loader.exec_module(google)
require = google.require
digest = google.digest_file
REPO = google.REPO
BRANCHES = {"main", "apple-actions-builds"}
ARTIFACTS = {"android": "android-and-fire-os", "vega": "vega-release-packages",
             "ios": "Portico-ios-unsigned", "tvos": "Portico-tvos-unsigned"}
JOBS = {"javascript", "vega", "apple-contracts", "vega-packages / packages",
        "android / Google Android and Fire OS APKs and bundles",
        "apple / javascript", "apple / media (ios)", "apple / media (tvos)",
        "apple / apps (ios, iphoneos)", "apple / apps (tvos, appletvos)"}
JOBS |= {"android / Media engine (" + abi + ")" for abi in google.ABIS}
MAX_ASSET = 2 * 1024**3 - 1
MAX_EXPANDED = 12 * 1024**3
SEMVER = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"


def command(args, **kwargs):
    return subprocess.check_output([str(a) for a in args], **kwargs)


def api(endpoint, payload=None, optional=False):
    args = ["gh", "api", "repos/" + REPO + "/" + endpoint]
    if payload is not None:
        args += ["--method", "POST", "--input", "-"]
    result = subprocess.run(args, input=None if payload is None else json.dumps(payload).encode(),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if optional and result.returncode and b"(HTTP 404)" in result.stderr:
        return None
    require(result.returncode == 0, "GitHub API failed: " + endpoint + ": " + result.stderr.decode())
    return json.loads(result.stdout) if result.stdout else None


def patch(endpoint, payload):
    subprocess.run(["gh", "api", "repos/" + REPO + "/" + endpoint, "--method", "PATCH",
                    "--input", "-"], input=json.dumps(payload).encode(), check=True,
                   stdout=subprocess.DEVNULL)


def collection(endpoint, key):
    records = []
    for page in range(1, 21):
        result = api(endpoint + ("&" if "?" in endpoint else "?") + f"per_page=100&page={page}")
        records.extend(result[key])
        if len(records) >= result["total_count"]:
            return records
    raise ValueError("Excessive GitHub pagination")


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def stable_version(value):
    require(re.fullmatch(SEMVER, value) is not None, "Expected stable X.Y.Z version without v prefix")
    return value


def context(env):
    require(env["GITHUB_REPOSITORY"] == REPO, "Publisher is restricted to the upstream repository")
    head = google.sha(env["GITHUB_SHA"])
    event, ref = env["GITHUB_EVENT_NAME"], env["GITHUB_REF"]
    if event == "workflow_dispatch":
        require(ref in {"refs/heads/" + b for b in BRANCHES}, "Untrusted dispatch branch")
        version = stable_version(env.get("RELEASE_VERSION", ""))
        require(re.fullmatch(r"[1-9][0-9]*", env.get("SOURCE_RUN_ID", "")) is not None,
                "Manual publication requires source_run_id")
    else:
        require(event == "push" and ref.startswith("refs/tags/v"), "Only version tags or trusted dispatch")
        version = stable_version(ref.removeprefix("refs/tags/v"))
    return head, version, event == "workflow_dispatch"


def checked_versions(root, version):
    for app in ("native", "vega"):
        path = root / "apps" / app
        require(json.loads((path / "package.json").read_text())["version"] == version,
                app + " package version differs from release")
        lock = json.loads((path / "package-lock.json").read_text())
        require(lock["version"] == version and lock["packages"][""]["version"] == version,
                app + " lock root version differs from release")
    manifest = tomllib.loads((root / "apps/vega/manifest.toml").read_text())["package"]
    require(manifest["version"] == version and manifest["id"] == "tv.getportico.portico.vega",
            "Vega source identity/version mismatch")
    gradle = (root / "apps/native/android/app/build.gradle").read_text()
    require(re.findall(r'versionName\s+"([^"]+)"', gradle) == [version], "Android source version mismatch")
    codes = re.findall(r"versionCode\s+([0-9]+)", gradle)
    require(len(codes) == 1 and int(codes[0]) > 0, "Invalid Android versionCode")
    apple_builds = {}
    for platform in ("ios", "tvos"):
        pbx = (root / f"apps/native/{platform}/Portico.xcodeproj/project.pbxproj").read_text()
        require(set(re.findall(r"MARKETING_VERSION = ([^;]+);", pbx)) == {version},
                platform + " source version mismatch")
        builds = set(re.findall(r"CURRENT_PROJECT_VERSION = ([^;]+);", pbx))
        require(len(builds) == 1 and next(iter(builds)).isdigit(), "Invalid Apple build version")
        apple_builds[platform] = next(iter(builds))
    if version == "0.0.1":
        require(codes[0] == "1" and set(apple_builds.values()) == {"1"},
                "Initial release requires Android versionCode 1 and Apple build 1")
    return {"android_code": codes[0], "apple_builds": apple_builds}


def trusted_run(run, head, *, manual, run_id):
    require(run["id"] == int(run_id), "Wrong run ID")
    require(run["repository"]["full_name"] == REPO and run["head_repository"]["full_name"] == REPO
            and run["repository"]["id"] == run["head_repository"]["id"], "Foreign/fork run")
    require(run["head_sha"] == head, "CI head differs from exact dispatch/tag SHA")
    if manual:
        require(run["status"] == "completed" and run["conclusion"] == "success"
                and run["path"] == ".github/workflows/ci.yml", "Full successful ci.yml run required")
        require(run["head_branch"] in BRANCHES
                and (run["event"] == "pull_request" or
                     (run["event"] == "push" and run["head_branch"] == "main")), "Untrusted CI source")
    else:
        require(run["path"] == ".github/workflows/release.yml" and run["event"] == "push"
                and run["head_branch"] == os.environ["GITHUB_REF_NAME"]
                and run["status"] == "in_progress", "Wrong current tag release run")


def trusted_jobs(run, manual):
    jobs = collection(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs", "jobs")
    prefix = "" if manual else "checks / "
    selected = jobs if manual else [j for j in jobs if j["name"].startswith(prefix)]
    names = {j["name"].removeprefix(prefix) for j in selected}
    require(JOBS <= names, "Full platform CI jobs missing: " + ", ".join(sorted(JOBS - names)))
    require(all(j["status"] == "completed" and j["conclusion"] == "success"
                and j["head_sha"] == run["head_sha"] for j in selected),
            "Every full-CI job must have completed successfully in this attempt")
    return jobs


def artifact_record(run, name):
    records = collection(f"actions/runs/{run['id']}/artifacts", "artifacts")
    matches = [a for a in records if a["name"] == name]
    require(len(matches) == 1, "Missing or ambiguous artifact: " + name)
    artifact = api(f"actions/artifacts/{matches[0]['id']}")
    origin = artifact["workflow_run"]
    require(not artifact["expired"] and 0 < artifact["size_in_bytes"] <= MAX_EXPANDED
            and origin["id"] == run["id"] and origin["head_sha"] == run["head_sha"]
            and origin["head_branch"] == run["head_branch"]
            and origin["repository_id"] == run["repository"]["id"]
            and origin["head_repository_id"] == run["repository"]["id"],
            "Foreign/expired artifact: " + name)
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", artifact["digest"]) is not None,
            "Missing GitHub artifact digest")
    return artifact


def gate():
    head, version, manual = context(os.environ)
    require(command(["git", "rev-parse", "HEAD"]).decode().strip() == head, "Checkout SHA mismatch")
    metadata = checked_versions(Path("."), version)
    if not manual:
        require(any(subprocess.run(["git", "merge-base", "--is-ancestor", head,
                                    "refs/remotes/origin/" + branch],
                                   stderr=subprocess.DEVNULL).returncode == 0 for branch in BRANCHES),
                "Version tag must be reachable from a trusted branch")
    permission = api("collaborators/" + os.environ["GITHUB_ACTOR"] + "/permission")["permission"]
    require(permission in {"admin", "maintain", "write"}, "Dispatch/push actor must have repository write access")
    state = {"head": head, "version": version, "manual": manual, "versions": metadata,
             "base": os.environ.get("SOURCE_BASE_SHA", ""),
             "publisher_run_id": os.environ["GITHUB_RUN_ID"]}
    if manual:
        run = api("actions/runs/" + os.environ["SOURCE_RUN_ID"])
        trusted_run(run, head, manual=True, run_id=os.environ["SOURCE_RUN_ID"])
        jobs = trusted_jobs(run, True)
        if run["event"] == "pull_request":
            google.sha(state["base"])
            require(subprocess.run(["git", "merge-base", "--is-ancestor", state["base"], head]).returncode == 0,
                    "Approved base must be an ancestor of the reviewed head")
        state.update(run=run, jobs=jobs,
                     artifacts={p: artifact_record(run, name) for p, name in ARTIFACTS.items()})
        require(run["head_branch"] == os.environ["GITHUB_REF_NAME"], "CI and dispatch branches differ")
    signing_id = os.environ.get("GOOGLE_SIGNING_RUN_ID", "")
    if signing_id:
        require(manual and re.fullmatch(r"[1-9][0-9]*", signing_id), "Signing reuse requires a manual run ID")
        run = api("actions/runs/" + signing_id)
        require(run["id"] == int(signing_id) and run["repository"]["full_name"] == REPO
                and run["head_repository"]["full_name"] == REPO
                and run["head_repository"]["id"] == run["repository"]["id"]
                and run["path"] == ".github/workflows/google-play-upload-sign.yml"
                and run["status"] == "completed" and run["conclusion"] == "success"
                and run["event"] == "workflow_dispatch" and run["head_branch"] == os.environ["GITHUB_REF_NAME"]
                and run["head_sha"] == head, "Untrusted/incomplete/different-head signing run")
        signing_jobs = collection(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs", "jobs")
        require({"checks", "prepare", "sign"} <= {j["name"] for j in signing_jobs}
                and all(j["status"] == "completed" and j["conclusion"] == "success"
                        and j["head_sha"] == head for j in signing_jobs), "Signing jobs must all succeed")
        state["signing"] = {"run": run, "jobs": signing_jobs,
                            "artifact": artifact_record(run, "google-play-upload-signed")}
    write_json(Path("release-state.json"), state)
    with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
        stream.write(f"version={version}\nrun_id={state.get('run', {}).get('id', os.environ['GITHUB_RUN_ID'])}\n")
        for platform, record in state.get("artifacts", {}).items():
            stream.write(f"{platform}_id={record['id']}\n")
        stream.write(f"signing_id={state.get('signing', {}).get('artifact', {}).get('id', '')}\n")


def check_files(root, *, flat=True):
    require(root.is_dir(), "Missing artifact directory")
    paths = list(root.rglob("*"))
    require(all(not p.is_symlink() and (p.is_dir() or p.is_file()) for p in paths), "Special artifact file")
    files = {p.relative_to(root).as_posix(): p for p in paths if p.is_file()}
    require(files and len(files) < 1000 and sum(p.stat().st_size for p in files.values()) <= MAX_EXPANDED,
            "Empty or excessive artifact")
    require(all(re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", n)
                and ".." not in PurePosixPath(n).parts and (not flat or "/" not in n) for n in files),
            "Unexpected artifact path")
    require("SHA256SUMS" in files and files["SHA256SUMS"].stat().st_size < 1024**2,
            "Missing/excessive checksums")
    sums = {}
    for line in files["SHA256SUMS"].read_text().splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_./-]+)", line)
        require(match is not None and match[2] not in sums, "Malformed/duplicate checksum")
        sums[match[2]] = match[1]
    require(set(sums) == set(files) - {"SHA256SUMS"}, "Checksum coverage differs from artifact files")
    for name, expected in sums.items():
        require(digest(files[name]) == expected, "Checksum mismatch: " + name)
    return sums


def verify_download(root, record):
    # download-artifact v4 warns on a digest mismatch. Independently fail closed on
    # GitHub's immutable ZIP digest and compare its exact files with the extracted input.
    with tempfile.TemporaryFile() as stream:
        subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{record['id']}/zip"],
                       stdout=stream, check=True)
        require(stream.tell() == record["size_in_bytes"], "Downloaded artifact ZIP size mismatch")
        stream.seek(0)
        require("sha256:" + hashlib.file_digest(stream, "sha256").hexdigest() == record["digest"],
                "Downloaded artifact ZIP digest mismatch")
        stream.seek(0)
        with ZipFile(stream) as archive:
            google.safe_zip(archive)
            actual = {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()}
            files = {i.filename for i in archive.infolist() if not i.is_dir()}
            require(files == set(actual), "Extracted files differ from immutable artifact ZIP")
            for name in files:
                with archive.open(name) as source:
                    require(hashlib.file_digest(source, "sha256").hexdigest() == digest(actual[name]),
                            "Extracted artifact differs from immutable ZIP: " + name)


def expected_artifact_files(platform, revision):
    source = f"portico-media-engine-{'android' if platform == 'android' else 'apple'}-source-r{revision}.tar"
    if platform == "android":
        files = {"SOURCE_COMMIT", "THIRD-PARTY-NOTICES.txt", source}
        files |= {f"app-{flavor}-release.{ext}" for flavor in ("google", "firetv") for ext in ("apk", "aab")}
        return files | {f"{kind}-{abi}.json" for kind in ("manifest", "build-info") for abi in google.ABIS}
    if platform == "vega":
        return {"SOURCE_COMMIT"} | {f"portico-vega_{arch}.vpkg" for arch in ("aarch64", "armv7", "x86_64")}
    return {f"Portico-{platform}-unsigned.xcarchive.zip", "THIRD-PARTY-NOTICES.txt", source}


def source_commit(source, state, current):
    google.sha(source)
    commit = api("git/commits/" + source)
    require(commit["sha"] == source and commit["tree"]["sha"] == current["tree"]["sha"],
            "Artifact source tree differs from exact reviewed commit")
    run = state["run"]
    if state["manual"] and run["event"] == "pull_request":
        require([p["sha"] for p in commit["parents"]] == [state["base"], state["head"]],
                "Artifact source must merge the approved base and exact run head, in order")
    else:
        require(source == state["head"], "Artifact source differs from tag/main SHA")
    return commit


def safe_members(archive):
    infos = archive.infolist()
    require(len(infos) < 100000 and len({i.filename for i in infos}) == len(infos), "Duplicate/excessive ZIP paths")
    require(sum(i.file_size for i in infos) <= MAX_EXPANDED, "Excessive ZIP expansion")
    for info in infos:
        name = info.filename.rstrip("/")
        require(name and not name.startswith("/") and "\\" not in name
                and all(p not in ("", ".", "..") for p in name.split("/"))
                and not info.flag_bits & 1 and info.file_size <= MAX_ASSET,
                "Unsafe/encrypted ZIP member")
    return {i.filename: i for i in infos}


def android_identity(attributes, version, code):
    require(attributes.get("package") == google.APP_ID
            and attributes.get("{http://schemas.android.com/apk/res/android}versionName") == version
            and attributes.get("{http://schemas.android.com/apk/res/android}versionCode") == code,
            "Embedded Android package/version mismatch")


def inspect_android(root, version, code):
    expected = {"app-" + flavor + "-release." + ext for flavor in ("google", "firetv") for ext in ("apk", "aab")}
    require({p.name for p in root.glob("*.apk")} | {p.name for p in root.glob("*.aab")} == expected,
            "Unexpected APK/AAB set")
    bundletool = google.tool()
    aapt = Path(os.environ["ANDROID_HOME"]) / "build-tools/35.0.0/aapt2"
    notices = (root / "THIRD-PARTY-NOTICES.txt").read_bytes()
    require(notices, "Missing Android notices")
    require(any(root.glob("*.tar")), "Missing Android corresponding source")
    results = {}
    for name in sorted(expected):
        path = root / name
        is_bundle = path.suffix == ".aab"
        prefix = "base/" if is_bundle else ""
        with ZipFile(path) as archive:
            names = safe_members(archive)
            require(archive.read(prefix + "assets/index.android.bundle"), "Missing embedded Android JavaScript")
            require(archive.read(prefix + "assets/media-engine/THIRD-PARTY-NOTICES.txt") == notices,
                    "Embedded Android notices mismatch")
            abis = {n.removeprefix(prefix).split("/")[1] for n in names
                    if n.startswith(prefix + "lib/") and n.endswith(".so")}
            require(abis == google.ABIS, "Android ABI set mismatch")
            for abi in abis:
                manifest = json.loads((root / f"manifest-{abi}.json").read_text())[abi]
                require((root / f"build-info-{abi}.json").is_file(), "Missing Android build metadata")
                for lib in google.LIBRARIES:
                    data = archive.read(f"{prefix}lib/{abi}/lib{lib}.so")
                    require(data.startswith(b"\x7fELF"), "Invalid media ELF")
                    if lib != "porticompv":
                        require(hashlib.sha256(data).hexdigest() == manifest[f"lib{lib}.so"]["sha256"]
                                and len(data) == manifest[f"lib{lib}.so"]["size"], "Media library manifest mismatch")
        if is_bundle:
            google.command(["java", "-jar", str(bundletool), "validate", "--bundle=" + str(path)])
            xml = google.command(["java", "-jar", str(bundletool), "dump", "manifest",
                                  "--bundle=" + str(path), "--module=base"])
            android_identity(ET.fromstring(xml).attrib, version, code)
        else:
            badging = command([aapt, "dump", "badging", path]).decode()
            match = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
            require(match is not None and match.groups() == (google.APP_ID, code, version),
                    "Embedded APK identity/version mismatch")
        results[name] = {"application_id": google.APP_ID, "version": version, "version_code": code,
                         "abis": sorted(abis), "signing": "repository development key"}
    return results


def inspect_vega(path, version):
    # VPKG is zstd-compressed tar. Stream inspection only; never extract or invoke the vendor SDK.
    proc = subprocess.Popen(["zstd", "-d", "-q", "-c", str(path)], stdout=subprocess.PIPE)
    metadata, names, total = {}, set(), 0
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as archive:
            for member in archive:
                name = member.name
                require(name not in names and len(names) < 100000, "Duplicate/excessive VPKG members")
                names.add(name)
                require(not name.startswith("/") and "\\" not in name
                        and all(p not in ("", ".", "..") for p in name.rstrip("/").split("/"))
                        and (member.isfile() or member.isdir()), "Unsafe VPKG member")
                total += member.size
                require(total < MAX_ASSET, "Excessive VPKG expansion")
                if name in {"manifest.toml", "meta-info/build-info.json"}:
                    require(member.size < 1024**2, "Excessive Vega metadata")
                    metadata[name] = archive.extractfile(member).read()
                if name in {"bundle/index.bundle", "bundle/index.hermes.bundle"}:
                    require(member.size > 0, "Empty Vega JavaScript")
        require(proc.wait() == 0, "Invalid zstd VPKG")
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    package = tomllib.loads(metadata["manifest.toml"].decode())["package"]
    build = json.loads(metadata["meta-info/build-info.json"])["data"]
    require(package["version"] == version and build["version"] == version
            and package["id"] == "tv.getportico.portico.vega"
            and {"bundle/index.bundle", "bundle/index.hermes.bundle"} <= names, "Embedded Vega identity/version mismatch")
    return {"application_id": package["id"], "version": version}


def apple_identity(plist, version, build, platform, *, extension=False):
    require(plist.get("CFBundleIdentifier") == google.APP_ID + (".TopShelf" if extension else "")
            and plist.get("CFBundleShortVersionString") == version and plist.get("CFBundleVersion") == build,
            "Embedded Apple bundle identity/version mismatch")
    require(plist.get("CFBundleSupportedPlatforms") == (["iPhoneOS"] if platform == "ios" else ["AppleTVOS"]),
            "Apple archive must contain the correct device platform")


def inspect_apple(path, platform, version, build, notices):
    prefix = f"Portico-{platform}.xcarchive/"
    app = prefix + "Products/Applications/Portico.app/"
    with ZipFile(path) as archive:
        names = safe_members(archive)
        require(all(n.startswith(prefix) or n.startswith("__MACOSX/") for n in names), "Unexpected xcarchive root")
        info = plistlib.loads(archive.read(prefix + "Info.plist"))
        props = info["ApplicationProperties"]
        require(props["CFBundleIdentifier"] == google.APP_ID and props["ApplicationPath"] == "Applications/Portico.app"
                and props["CFBundleShortVersionString"] == version and props["CFBundleVersion"] == build,
                "Archive application properties mismatch")
        apple_identity(plistlib.loads(archive.read(app + "Info.plist")), version, build, platform)
        require(archive.read(app + "main.jsbundle"), "Apple archive is missing embedded JavaScript")
        matches = [n for n in names if n.startswith(app) and n.endswith("THIRD-PARTY-NOTICES.txt")]
        require(matches and any(archive.read(n) == notices for n in matches), "Apple embedded media notices mismatch")
        for name in names:
            if name.startswith(app + "PlugIns/") and name.endswith(".appex/Info.plist"):
                apple_identity(plistlib.loads(archive.read(name)), version, build, platform, extension=True)
        # Framework symlinks are legitimate archive data. They are never followed/extracted here.
    return {"application_id": google.APP_ID, "version": version, "build": build, "signing": "unsigned"}


def inspect_signed(root, state, android):
    sums = check_files(root, flat=False)
    support = {p.name for p in android.iterdir() if p.name in {"SOURCE_COMMIT", "THIRD-PARTY-NOTICES.txt"}
               or p.suffix in {".tar", ".json"}}
    expected = {"portico-google-upload.aab", "PREPARED_SHA256SUMS", "provenance.json", "verification.json"}
    expected |= {"source/" + n for n in support | {"BUILD_SHA256SUMS"}}
    require(set(sums) == expected, "Unexpected/missing signed Google support files")
    provenance = json.loads((root / "provenance.json").read_text())
    verification = json.loads((root / "verification.json").read_text())
    run, record = state["run"], state["artifacts"]["android"]
    require(provenance["repository"] == REPO and provenance["expected_head_sha"] == state["head"]
            and provenance["expected_source_sha"] == state["source"]
            and provenance["run"]["id"] == run["id"]
            and provenance["run"]["run_attempt"] == run["run_attempt"]
            and provenance["artifact"]["id"] == record["id"]
            and provenance["artifact"]["digest"] == record["digest"],
            "Signed Google provenance differs from exact validated CI artifact")
    require(provenance["expected_base_sha"] == state["base"]
            and provenance["source_commit"]["sha"] == state["source"]
            and provenance["source_commit"]["tree"] == state["source_commit"]["tree"],
            "Signed Google source Git provenance mismatch")
    bundle = verification["bundle"]
    require(bundle == provenance["bundle"] and bundle["application_id"] == google.APP_ID
            and bundle["version_code"] == state["versions"]["android_code"]
            and set(bundle["abis"]) == google.ABIS, "Signed Google package metadata mismatch")
    signed, original = root / "portico-google-upload.aab", android / google.GOOGLE_AAB
    fingerprint = verification["upload_certificate_sha256"]
    require(re.fullmatch(r"[a-f0-9]{64}", fingerprint) is not None, "Invalid upload certificate metadata")
    require(verification["signed_aab_sha256"] == sums[signed.name]
            and verification["original_aab_sha256"] == digest(original)
            and provenance["original_google_aab_sha256"] == digest(original)
            and verification["all_payload_entries_identical"] is True
            and verification["all_payload_entries_signature_verified"] is True,
            "Signed Google verification metadata mismatch")
    require(google.payload_hashes(signed) == google.payload_hashes(original), "Signed Google payload differs from CI")
    for path in (root / "source").iterdir():
        if path.name != "BUILD_SHA256SUMS":
            require(path.is_file() and (android / path.name).is_file()
                    and digest(path) == digest(android / path.name), "Signed corresponding source mismatch")
    require((root / "source/SOURCE_COMMIT").read_text() == state["source"] + "\n"
            and (root / "source/BUILD_SHA256SUMS").read_bytes() == (android / "SHA256SUMS").read_bytes(),
            "Signed source/checksums mismatch")
    google.command(["java", str(Path(__file__).with_name("VerifyGoogleBundle.java")), str(signed), fingerprint])
    return verification


def deterministic_tar(output, root):
    subprocess.run(["tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
                    "-czf", str(output), "-C", str(root), "."], check=True)


def root_licenses(head):
    names = command(["git", "ls-tree", "--name-only", head]).decode().splitlines()
    licenses = [n for n in names if re.fullmatch(r"(?:LICEN[SC]E|NOTICE|COPYING)(?:[.-][A-Za-z0-9_.-]+)?", n)]
    require("LICENSE" in licenses, "Tracked root LICENSE is required in corresponding source")
    return licenses


def prepare():
    state = json.loads(Path("release-state.json").read_text())
    head, version, manual = context(os.environ)
    require((head, version, manual) == (state["head"], state["version"], state["manual"]), "Release context changed")
    require(checked_versions(Path("."), version) == state["versions"], "Source versions changed")
    if not manual:
        run = api("actions/runs/" + os.environ["GITHUB_RUN_ID"])
        trusted_run(run, head, manual=False, run_id=os.environ["GITHUB_RUN_ID"])
        state.update(run=run, artifacts={p: artifact_record(run, name) for p, name in ARTIFACTS.items()})
    else:
        run = api("actions/runs/" + str(state["run"]["id"]))
        trusted_run(run, head, manual=True, run_id=state["run"]["id"])
        require(run["run_attempt"] == state["run"]["run_attempt"], "CI was rerun during publication")
    state["jobs"] = trusted_jobs(run, manual)
    for platform, record in state["artifacts"].items():
        require(artifact_record(run, ARTIFACTS[platform]) == record, "Artifact metadata changed")
    current = api("git/commits/" + head)
    metadata = {}
    revision = json.loads(Path("third_party/media-engine/sources.lock.json").read_text())["revision"]
    require(isinstance(revision, int) and revision > 0, "Invalid media source revision")
    for platform in ARTIFACTS:
        root = Path("inputs") / platform
        sums = check_files(root)
        require(set(sums) == expected_artifact_files(platform, revision),
                "Missing/unexpected package, source, notices or build metadata: " + platform)
        verify_download(root, state["artifacts"][platform])
        if platform in ("android", "vega"):
            source = (root / "SOURCE_COMMIT").read_text()
            require(re.fullmatch(r"[a-f0-9]{40}\n", source), "Malformed SOURCE_COMMIT")
            source = source.strip()
            commit = source_commit(source, state, current)
            require("source" not in state or source == state["source"], "Platform SOURCE_COMMIT mismatch")
            state.update(source=source, source_commit=commit)
        else:
            require("SOURCE_COMMIT" not in sums, "Unexpected Apple source marker")
        if platform == "android":
            metadata[platform] = inspect_android(root, version, state["versions"]["android_code"])
        elif platform == "vega":
            expected = {f"portico-vega_{arch}.vpkg" for arch in ("aarch64", "armv7", "x86_64")}
            require(set(sums) == expected | {"SOURCE_COMMIT"}, "Unexpected Vega files")
            metadata[platform] = {name: inspect_vega(root / name, version) |
                                  {"architecture": name.removeprefix("portico-vega_").removesuffix(".vpkg")}
                                  for name in sorted(expected)}
        else:
            name = f"Portico-{platform}-unsigned.xcarchive.zip"
            require(name in sums and "THIRD-PARTY-NOTICES.txt" in sums and any(n.endswith(".tar") for n in sums),
                    "Incomplete Apple archive/source/notices artifact")
            require(all(n in {name, "THIRD-PARTY-NOTICES.txt"} or n.endswith(".tar") for n in sums),
                    "Unexpected Apple artifact file")
            metadata[platform] = inspect_apple(root / name, platform, version,
                                              state["versions"]["apple_builds"][platform],
                                              (root / "THIRD-PARTY-NOTICES.txt").read_bytes())
    if "signing" in state:
        signing_run = api("actions/runs/" + str(state["signing"]["run"]["id"]))
        require(signing_run == state["signing"]["run"], "Signing run changed")
        require(artifact_record(signing_run, "google-play-upload-signed") == state["signing"]["artifact"],
                "Signing artifact changed")
        verify_download(Path("inputs/google-upload"), state["signing"]["artifact"])
        metadata["google_upload"] = inspect_signed(Path("inputs/google-upload"), state, Path("inputs/android"))
    dist = Path("dist")
    dist.mkdir()
    # Public tracked application source, including shared packages and vendored media build source.
    source_tar = dist / f"Portico-corresponding-app-source-v{version}.tar"
    subprocess.run(["git", "archive", "--format=tar", "--prefix=Portico-source/", "-o", str(source_tar),
                    head, "apps", "packages", "third_party", "scripts", ".node-version", *root_licenses(head)], check=True)
    for name in root_licenses(head):
        (dist / f"Portico-v{version}-{name}").write_bytes(command(["git", "show", head + ":" + name]))
    for platform in ARTIFACTS:
        root = Path("inputs") / platform
        deterministic_tar(dist / f"Portico-{platform}-v{version}.tar.gz", root)
        for path in sorted(root.iterdir()):
            if path.suffix in {".apk", ".vpkg"} or path.name.endswith(".xcarchive.zip"):
                label = "-development" if path.suffix == ".apk" else ""
                shutil.copyfile(path, dist / f"Portico-v{version}-{platform}{label}-{path.name}")
            elif path.suffix == ".aab":
                shutil.copyfile(path, dist / f"Portico-v{version}-android-development-{path.name}")
    if "signing" in state:
        root = Path("inputs/google-upload")
        deterministic_tar(dist / f"Portico-google-upload-signed-v{version}.tar.gz", root)
        shutil.copyfile(root / "portico-google-upload.aab", dist / f"Portico-v{version}-google-upload-signed.aab")
    state["inspection_tools"] = {"bundletool_version": google.BUNDLETOOL_VERSION,
                                 "bundletool_sha256": google.BUNDLETOOL_SHA256, "android_build_tools": "35.0.0"}
    state["embedded_packages"] = metadata
    write_json(dist / "provenance.json", state)
    google.write_sums(dist, "SHA256SUMS.txt")
    require(all(0 < p.stat().st_size <= MAX_ASSET for p in dist.iterdir()), "Release asset exceeds 2 GiB")
    # Marker is immutable across retries; notes do not depend on the current publisher run ID.
    marker = f"<!-- portico-release v{version} commit={head} source={state['source']} ci={run['id']} -->"
    signed_note = ("Google upload-signed AAB and certificate verification are included; no Play upload performed."
                   if "signing" in state else
                   "Google and Fire AABs use the repository development key; no upload-signed Google AAB is included.")
    notes = (f"Portico native apps v{version}\n\n{marker}\n\n"
             f"Release commit: `{head}`. CI artifact source: `{state['source']}`.\n"
             f"Full successful build: https://github.com/{REPO}/actions/runs/{run['id']} "
             f"(attempt {run['run_attempt']}).\n\n"
             "Android/Android TV and Fire OS APKs use development signing; ABIs: arm64-v8a, armeabi-v7a, x86, x86_64.\n"
             "Vega packages: aarch64, armv7, x86_64. iOS and tvOS device xcarchives are unsigned "
             "and require Apple distribution signing.\n"
             + signed_note + "\n\n"
             "Platform bundles preserve corresponding media source, notices and build checksums. "
             "Application source, full build/run provenance and release asset SHA-256 checksums are included. "
             "Build verification does not establish store or physical-device acceptance.\n")
    Path("release-notes.md").write_text(notes)
    write_json(Path("release-state.json"), state)


def resolve_tag(tag):
    ref = api("git/ref/tags/" + tag, optional=True)
    if ref is None:
        return None
    obj = ref["object"]
    for _ in range(5):
        if obj["type"] == "commit":
            return obj["sha"]
        require(obj["type"] == "tag", "Version ref does not point to a Git commit/tag")
        obj = api("git/tags/" + obj["sha"])["object"]
    raise ValueError("Excessive annotated tag nesting")


def verify_assets(release, files, *, complete):
    assets = api(f"releases/{release['id']}/assets?per_page=100")
    require(len(assets) < 100 and len({a["name"] for a in assets}) == len(assets), "Ambiguous/excessive release assets")
    require({a["name"] for a in assets} <= set(files), "Existing release has unexpected assets")
    if complete:
        require({a["name"] for a in assets} == set(files), "Release asset set is incomplete")
    for asset in assets:
        path = files[asset["name"]]
        require(asset["state"] == "uploaded" and asset["size"] == path.stat().st_size,
                "Existing asset is incomplete or conflicts: " + asset["name"])
        expected = "sha256:" + digest(path)
        if asset.get("digest"):
            require(asset["digest"] == expected, "Existing asset content conflicts: " + asset["name"])
        else:
            # Older GitHub releases may lack digest metadata. Verify bytes without replacing assets.
            with subprocess.Popen(["gh", "api", "-H", "Accept: application/octet-stream",
                                   f"repos/{REPO}/releases/assets/{asset['id']}"], stdout=subprocess.PIPE) as proc:
                actual = hashlib.file_digest(proc.stdout, "sha256").hexdigest()
                require(proc.wait() == 0 and "sha256:" + actual == expected, "Existing asset digest mismatch")
    return {a["name"] for a in assets}


def publish():
    state = json.loads(Path("release-state.json").read_text())
    head, version, manual = context(os.environ)
    require((head, version, manual) == (state["head"], state["version"], state["manual"]), "Publish context changed")
    dist = Path("dist")
    files = {p.name: p for p in dist.iterdir()}
    sums = {}
    for line in (dist / "SHA256SUMS.txt").read_text().splitlines():
        expected, name = line.split("  ")
        require(name not in sums and re.fullmatch(r"[A-Za-z0-9_.-]+", name), "Invalid release checksums")
        sums[name] = expected
    require(set(sums) == set(files) - {"SHA256SUMS.txt"}
            and all(digest(files[n]) == value for n, value in sums.items()), "Prepared release assets changed")
    require(json.loads((dist / "provenance.json").read_text()) == state, "Prepared provenance changed")
    require(all(0 < p.stat().st_size <= MAX_ASSET for p in files.values()), "Invalid release asset size")
    tag = "v" + version
    existing = resolve_tag(tag)
    require(existing in (None, head), "Immutable version tag points to another commit")
    notes = Path("release-notes.md").read_text()
    release = api("releases/tags/" + tag, optional=True)
    if release:
        require(release["target_commitish"] == head and release["body"] == notes
                and release["prerelease"] is False and release["name"] == "Portico apps " + tag,
                "Existing release conflicts with prepared provenance/notes")
        verify_assets(release, files, complete=not release["draft"])
    if existing is None:
        require(manual, "Tag-push publication requires the existing version tag")
        # GITHUB_TOKEN-created refs do not trigger push workflows: no duplicate cold CI build.
        api("git/refs", {"ref": "refs/tags/" + tag, "sha": head})
    require(resolve_tag(tag) == head, "Version tag changed before upload")
    if release is None:
        release = api("releases", {"tag_name": tag, "target_commitish": head, "name": "Portico apps " + tag,
                                   "body": notes, "draft": True, "prerelease": False})
    uploaded = verify_assets(release, files, complete=not release["draft"])
    if release["draft"]:
        for name in sorted(set(files) - uploaded):
            subprocess.run(["gh", "release", "upload", tag, str(files[name]), "--repo", REPO], check=True)
        verify_assets(release, files, complete=True)
        require(resolve_tag(tag) == head, "Version tag changed before publication")
        patch(f"releases/{release['id']}", {"draft": False, "make_latest": "true"})
    published = api(f"releases/{release['id']}")
    require(published["draft"] is False and published["prerelease"] is False
            and resolve_tag(tag) == head, "Release publication readback failed")
    verify_assets(published, files, complete=True)
    print(published["html_url"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("gate", "prepare", "publish"))
    args = parser.parse_args()
    globals()[args.operation]()


if __name__ == "__main__":
    main()
