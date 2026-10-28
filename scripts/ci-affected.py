#!/usr/bin/env python3
"""Full hourly checks, with bounded selection retained for explicit local use.

Every launched command is bounded in time, but never the selection: a run still
executes all of its selected/full-tree commands. A hung suite is terminated with
its own process group and reported as a failing command instead of holding the
job until the workflow's own timeout.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

import test_watchdog

ROOT = Path(__file__).resolve().parents[1]
TEST = re.compile(r"^func (Test[A-Z]\w*)\(", re.M)
JS_TEST = re.compile(r"\.test\.(?:[cm]?js|tsx?)$")

# Per-command bound. This is a hang guard for one suite invocation, not a scope
# filter or a test deadline: the full-tree and mandatory security commands stay
# exactly as selected, and each still gets the whole window.
COMMAND_TIMEOUT = 15 * 60
TERMINATE_GRACE = 5

# JavaScript files are supervised one process at a time (test_watchdog.Runner).
# The per-test limit turns a slow test into a named failure for its own file; the
# per-file watchdog names a hung file and continues; the exit grace turns a leaked
# handle into a named failure instead of a suite-wide stall.
TEST_TIMEOUT_MS = test_watchdog.DEFAULT_TEST_TIMEOUT_MS
TEST_FILE_SECONDS = test_watchdog.DEFAULT_FILE_SECONDS
TEST_EXIT_GRACE = test_watchdog.DEFAULT_EXIT_GRACE

# The job page gets a short, complete answer: the first failures as annotations,
# a Markdown summary, and one JSON file with every member of every group. The
# console preview stays bounded, but no failure is dropped from the JSON.
ANNOTATION_LIMIT = 10
DIAGNOSTICS_FILE = "js-failures.json"
_VERSION_CACHE = None

# Test trees this campaign deliberately does not run. They are excluded before
# selection, so the reported selection is the eligible set rather than a number
# that silently loses files on the way to execution. Each tree keeps its own
# workflow: dedicated hourly and checkpoint Vega jobs run its portable checks.
EXCLUDED_TREES = {
    "apps/vega/": "Vega portable checks run in the dedicated hourly/checkpoint job; only packaging needs the SDK",
}

MANDATORY_TESTS = {
    False: (
        "packages/client-core/test/account-sessions.test.ts",
        "packages/client-core/test/session-refresh.test.ts",
        "packages/client-core/test/identity-restrictions.test.ts",
        "packages/client-core/test/profiles-membership.test.ts",
        "packages/client-core/test/generated-routes.test.ts",
        "packages/client-core/test/credential-scoped-logout.test.ts",
        "web-next/test/account-entry-authority.test.ts",
        "web-next/test/viewer-storage.test.ts",
    ),
    True: (
        "apps/native/test/next-accounts-entry.test.ts",
        "apps/native/test/next-local-session-renewal.test.ts",
        "apps/native/test/next-account-proof-entry.test.ts",
        "apps/native/test/next-shell-tv-profile-menu.test.ts",
    ),
}


class CommandTimeout(subprocess.CalledProcessError):
    """A command outlived COMMAND_TIMEOUT; its process group was terminated."""

    def __init__(self, argv, timeout):
        super().__init__(124, argv)  # 124 is the conventional timeout exit status
        self.timeout = timeout


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).splitlines()


def changed():
    if os.environ.get("CI_FULL_TREE") == "1":
        return set(git("ls-files"))
    base = os.environ.get("CI_BASE", "")
    if not base or set(base) == {"0"}:
        base = "HEAD^"
    # Missing history is an error, never permission to omit affected checks.
    return set(git("diff", "--name-only", "--diff-filter=ACMRTD", base, "HEAD", "--"))


def _signal_group(process, sig):
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass


def _group_alive(process):
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _await_group(process, seconds):
    """Wait up to `seconds` for the whole command group to empty, reaping its leader."""
    deadline = time.monotonic() + seconds
    while _group_alive(process):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        process.poll()  # reap the leader as soon as it exits
        time.sleep(min(0.05, remaining))
    process.wait()
    return True


def _stop_group(process):
    """TERM the command's own group, give it a bounded grace, then KILL what remains."""
    _signal_group(process, signal.SIGTERM)
    _await_group(process, TERMINATE_GRACE)
    # The grace is for the group, not only its leader: a leader that exits on TERM
    # must not hide a descendant that ignores it, so the group is always confirmed
    # with KILL. Both waits stay bounded, and a command that cannot be killed is
    # reported by the failing timeout rather than hanging this runner again.
    _signal_group(process, signal.SIGKILL)
    _await_group(process, TERMINATE_GRACE)


def run(args, cwd=ROOT, timeout=None):
    argv = list(map(str, args))
    limit = COMMAND_TIMEOUT if timeout is None else timeout
    print("+", " ".join(argv), flush=True)
    process = subprocess.Popen(argv, cwd=cwd, start_new_session=True)
    try:
        code = process.wait(timeout=limit)
    except subprocess.TimeoutExpired:
        _stop_group(process)
        print(f"timed out after {limit:g}s, command terminated: {' '.join(argv)}",
              file=sys.stderr, flush=True)
        raise CommandTimeout(argv, limit) from None
    if code:
        raise subprocess.CalledProcessError(code, argv)
    return code


def run_all(commands):
    failed = False
    timed_out = False
    for args, cwd in commands:
        try:
            run(args, cwd)
        except subprocess.CalledProcessError as error:
            failed = True
            timed_out = timed_out or isinstance(error, CommandTimeout)
    if failed:
        raise SystemExit(124 if timed_out else 1)


def test_names(files):
    return {name for file in files if file.is_file()
            for name in TEST.findall(file.read_text()) if name != "TestMain"}


def go_plan(module, paths):
    prefix = module + "/"
    selected = {}
    for name in sorted(paths):
        if not name.startswith(prefix) or not name.endswith(".go"):
            continue
        file = ROOT / name
        directory = file.parent
        if not directory.is_dir():
            continue
        package = "./" + str(directory.relative_to(ROOT / module))
        tests = list(directory.glob("*_test.go"))
        if name.endswith("_test.go"):
            candidates = [file]
        else:
            candidates = list(directory.glob(file.stem + "*_test.go"))
            if not candidates:
                # Catalogue is deliberately never expanded to its full suite on a push.
                # Check compile/vet here; named counterparts and all package tests run nightly.
                candidates = [] if package == "./internal/catalog" else tests
        selected.setdefault(package, set()).update(test_names(candidates))
    if paths & {module + "/go.mod", module + "/go.sum"}:
        selected["./..."] = set()  # compile the changed module dependency graph
    return selected


def go_checks(module, group):
    print_versions()
    if os.environ.get("CI_FULL_TREE") == "1" and group == "affected":
        vet = ["bash", str(ROOT / "scripts/vet-go.sh")] if module == "server" else ["go", "vet", "./..."]
        run_all([(["go", "test", "-count=1", "./..."], ROOT / module), (vet, ROOT / module)])
        return
    if group == "affected":
        selected = go_plan(module, changed())
    elif group == "auth":
        selected = {"./internal/httpapi": {
            "TestRefreshRoundTripOverPlainHTTP",
            "TestUnknownAndKnownNamesHaveTheSameSignInCooloff",
            "TestAccountRestoreUsesAccountScopeUntilExplicitProfileSelection",
            "TestSessionFamilyHTTPLogoutAuthenticGenerations",
            "TestASecondProfileOfTheOwnersAccountIsNotAnAdministrator",
            "TestRestrictedProfileRouteMatrix", "TestRestrictedProfileWriteRouteMatrix",
        }}
    elif group == "media":
        selected = {
            "./internal/mediaexec": test_names((ROOT / module / "internal/mediaexec").glob("*_test.go")),
            "./internal/remotemedia": {
                "TestPrivateRootsRedirectsAndMetadataAreExplicitlyFenced",
                "TestDNSChangesAreRevalidatedAgainstApprovedAddresses",
                "TestManualRedirectsReturnEachHopWithoutContactingDestination",
                "TestPolicyProxyRejectsRebindingAndUnauthenticatedRequests",
                "TestServeEndpointRejectsMembersBeforeDispatch",
                "TestServeDialChecksExactOriginAndReconnectBeforeNetwork",
            },
        }
    elif group == "hosted":
        selected = {
            "./internal/identity": test_names((ROOT / module / "internal/identity").glob("*_test.go")),
            "./internal/egress": test_names((ROOT / module / "internal/egress").glob("*_test.go")),
            "./internal/security": test_names((ROOT / module / "internal/security").glob("*_test.go")),
            "./internal/httpapi": {
                "TestBrowserCookieOriginsAndFamilyIntentAreIsolated",
                "TestIdentityContinuationReadIsNotMediaOriginAuthority",
                "TestSessionReviewQueryAllowlist",
            },
        }
    else:
        raise ValueError(group)
    commands = []
    for package, names in sorted(selected.items()):
        if group != "affected":
            actual = test_names((ROOT / module / package.removeprefix("./")).glob("*_test.go"))
            if not names or not names <= actual:
                raise RuntimeError(f"missing mandatory security test: {package}: {names - actual}")
        pattern = "^(" + "|".join(sorted(names)) + ")$" if names else "^$"
        commands.append((["go", "test", "-count=1", "-run", pattern, package], ROOT / module))
        vet = ["go", "vet"]
        if package == "./internal/thirdparty/sqlite":
            vet.append("-unsafeptr=false")  # same maintained-driver exception as vet-go.sh
        commands.append(([*vet, package], ROOT / module))
    run_all(commands)


def dependencies(file, known, workspaces):
    result = set()
    # Include imports, requires, new URL(..., import.meta.url), and bounded harness module maps.
    for spec in re.findall(r"['\"]([^'\"\n]+)['\"]", file.read_text(errors="replace")):
        if spec.startswith("."):
            base = file.parent / spec
        elif spec.startswith("@core/"):
            base = ROOT / "packages/client-core/src" / spec[6:]
        elif spec in {"@core", "@design", "@i18n"}:
            package = {"@core": "client-core", "@design": "design", "@i18n": "i18n"}[spec]
            base = ROOT / "packages" / package / "src/index.ts"
        elif spec.startswith("@/") and file.is_relative_to(ROOT / "web-next"):
            base = ROOT / "web-next/src" / spec[2:]
        else:
            workspace = next((name for name in workspaces if spec == name or spec.startswith(name + "/")), None)
            if not workspace:
                continue
            directory = workspaces[workspace]
            exports = json.loads((directory / "package.json").read_text()).get("exports", {})
            key = "." + spec[len(workspace):]
            target = exports if isinstance(exports, str) and key == "." else exports.get(key) if isinstance(exports, dict) else None
            if isinstance(target, dict):
                target = target.get("import") or target.get("default") or target.get("types")
            base = directory / (target if isinstance(target, str) else spec[len(workspace):].lstrip("/") or "src/index")
        base = base.resolve()
        candidates = [base, *(Path(str(base) + ext) for ext in (".ts", ".tsx", ".js", ".mjs", ".cjs")),
                      *(base / ("index" + ext) for ext in (".ts", ".tsx", ".js", ".mjs"))]
        if base.suffix in {".js", ".jsx"}:
            candidates.extend([base.with_suffix(".ts"), base.with_suffix(".tsx")])
        result.update(candidate for candidate in candidates if candidate in known)
    return result


def out_of_scope(file):
    """Why this campaign does not run `file`, or None when it does.

    Exclusion is decided here, before the selection is counted, so a file that
    this campaign will not run is never reported as selected and never reaches
    the executor only to be dropped there.
    """
    relative = file.relative_to(ROOT).as_posix()
    for prefix, reason in EXCLUDED_TREES.items():
        if relative.startswith(prefix):
            return reason
    return None


def js_plan(paths, native=False, excluded=None):
    files = {ROOT / name for name in git("ls-files")
             if Path(name).suffix in {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"}
             and (ROOT / name).is_file()}
    workspaces = {}
    for file in files:
        if file.name == "package.json":
            name = json.loads(file.read_text()).get("name")
            if name:
                workspaces[name] = file.parent
    impacted = {ROOT / name for name in paths}
    for name in paths:
        file = ROOT / name
        if file.name in {"package.json", "package-lock.json", "register.mjs"}:
            directory = file.parent
            impacted.update(p for p in files if p.is_relative_to(directory))
    edges = {file: dependencies(file, files, workspaces) for file in files if file.suffix != ".json"}
    while True:
        more = {file for file, deps in edges.items() if deps & impacted} - impacted
        if not more:
            break
        impacted.update(more)
    tests = {p for p in impacted if JS_TEST.search(str(p)) and p.is_file()}
    for name in MANDATORY_TESTS[bool(native)]:
        if not (ROOT / name).is_file():
            raise RuntimeError("missing mandatory security test: " + name)
        tests.add(ROOT / name)
    for file in sorted(tests):
        reason = out_of_scope(file)
        if reason:
            tests.discard(file)
            if excluded is not None:
                excluded.append((file.relative_to(ROOT).as_posix(), reason))
    return sorted(tests)


def route(relative, native):
    """The group - its name is also its working directory - that runs one file.

    Every selected file has exactly one route, or an error names it. Selection
    and execution therefore cover the same set: a selected file is never dropped
    silently between the two.
    """
    parts = relative.parts
    if native and parts[:3] == ("apps", "native", "test"):
        return "apps/native"
    if parts[:2] == ("web-next", "test"):
        return "web-next"
    if parts[:2] == ("web", "test"):
        return "web"
    if parts[0] == "packages" and len(parts) > 2:
        return "/".join(parts[:2])
    if parts[:4] == ("server", "receiver", "cast", "test"):
        return "."
    if parts[:2] == ("scripts", "test"):
        # Repository-level script regressions run from the repository root: the
        # fixture they build resolves its own sources, so the root is their group.
        return "."
    raise RuntimeError("selected test file has no route in this campaign: "
                       + relative.as_posix())


def shard_settings():
    """Read CI_SHARD_INDEX/CI_SHARD_TOTAL; absent means one shard (everything)."""
    index_text = os.environ.get("CI_SHARD_INDEX", "").strip()
    total_text = os.environ.get("CI_SHARD_TOTAL", "").strip()
    if not index_text and not total_text:
        return 0, 1
    if not index_text or not total_text:
        raise SystemExit("CI_SHARD_INDEX and CI_SHARD_TOTAL must be set together")
    try:
        index, total = int(index_text), int(total_text)
    except ValueError:
        raise SystemExit("CI_SHARD_INDEX and CI_SHARD_TOTAL must be integers") from None
    if total < 1 or index < 0 or index >= total:
        raise SystemExit(f"invalid shard {index} of {total}")
    return index, total


def shard_of(name, total):
    """Stable assignment of one repository-relative path to a shard."""
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % total


def shard_files(files, index, total):
    """The files owned by this shard; every selected file belongs to exactly one."""
    return [file for file in files
            if shard_of(file.relative_to(ROOT).as_posix(), total) == index]


def report_directory(index, total, label="native-tests"):
    """Persistent report directory (check-jobs.py provides CI_TEST_REPORT_DIR)."""
    base = os.environ.get("CI_TEST_REPORT_DIR") or os.environ.get("PORTICO_TEST_EVENTS_DIR")
    if base:
        directory = Path(base) / f"{label}-shard{index}-of{total}"
        directory.mkdir(parents=True, exist_ok=True)
        return directory, False
    return Path(tempfile.mkdtemp(prefix="portico-test-events-")), True


def js_command(group, file):
    """The exact per-file command: same loader/flags as the suite, one file wide."""
    if group in ("apps/native", "web", "web-next"):
        args = ["node", "--experimental-transform-types", "--import", "./test/register.mjs"]
        if group == "apps/native":
            # Offline source tests load real modules through vm.SourceTextModule
            # (test/helpers/offline-source-module.mjs).
            args.append("--experimental-vm-modules")
    else:
        # Package sources may use syntax strip-only mode refuses - a constructor
        # parameter property, for instance - so package files load in transform
        # mode, without the Native register. Nothing about the sources changes.
        args = ["node", "--experimental-transform-types"]
    return [*args, f"--test-timeout={TEST_TIMEOUT_MS}",
            f"--test-reporter={ROOT / 'scripts/test-events.mjs'}",
            "--test-concurrency=1", "--test", file]


def _tool_line(command):
    try:
        # A version probe must never hold the job: a stuck interpreter answers
        # "unavailable" after 15 s instead of blocking the whole log header.
        text = subprocess.check_output(
            command, text=True, stderr=subprocess.DEVNULL, timeout=15)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return "unavailable"
    return text.strip().splitlines()[0] if text.strip() else "unavailable"


def tool_versions():
    """The actual interpreters this job ran, not a promised version or a secret."""
    global _VERSION_CACHE
    if _VERSION_CACHE is None:
        node = shutil.which("node") or "node"
        node_version = _tool_line([node, "--version"])
        go = _tool_line(["go", "version"])
        _VERSION_CACHE = (f"node {node_version} ({node})"
                          if node_version != "unavailable" else "node unavailable",
                          go if go != "unavailable" else "go unavailable")
    return _VERSION_CACHE


def print_versions():
    node, go = tool_versions()
    print(f"VERSIONS {node} | {go}", flush=True)


def _normalized_message(message):
    for line in str(message or "").splitlines():
        text = re.sub(r"\s+", " ", line).strip()
        if text:
            return text
    return ""


def _repo_relative(result, detail):
    """The workspace-qualified path used by summaries, annotations and JSON."""
    location = (detail or {}).get("location") or {}
    raw = str(location.get("file") or result.file)
    # A caller-relative path stays relative: resolving it against this script's
    # cwd would invent a "scripts/" prefix. Only an absolute path is rebased.
    if Path(raw).is_absolute():
        try:
            raw = str(Path(raw).resolve().relative_to(ROOT.resolve()))
        except (OSError, ValueError):
            raw = Path(raw).name
    group = result.group
    if group and group not in ("", ".") and raw != group and not raw.startswith(group + "/"):
        raw = f"{group}/{raw}"
    return raw


def _failure_member(result, detail):
    location = detail.get("location") or {}
    message = str(detail.get("message") or "")
    return {
        "file": _repo_relative(result, detail),
        "test": detail.get("test") or "(file)",
        "name": detail.get("name"),
        "code": detail.get("code"),
        "message": message,
        "normalized": detail.get("normalized") or _normalized_message(message),
        "line": location.get("line"),
        "column": location.get("column"),
        "frames": detail.get("frames") or [],
        "errors": detail.get("errors") or [],
    }


def _fallback_detail(result):
    """A failing file with no test failure still names its cause."""
    if getattr(result, "file_error", None):
        return result.file_error
    message = (result.stderr[0] if getattr(result, "stderr", None) else
               (result.notes[0] if result.notes else f"{result.status}: no message"))
    return {"test": "(file)", "name": result.status, "message": message,
            "normalized": _normalized_message(message), "frames": [],
            "errors": [], "location": {"file": result.file, "line": 1, "column": None}}


def _annotation_escape(text):
    return str(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _property_escape(text):
    return (_annotation_escape(text).replace(":", "%3A").replace(",", "%2C"))


def publish_js_report(runner, directory):
    """Publish every failure to the job summary, annotations and a JSON report.

    The console keeps its bounded per-file preview; this function is the complete
    record. Identical normalized messages are grouped and shown once as
    `x34 <message>`, while `js-failures.json` retains every member and its full
    cause chain, location and frames.
    """
    results = list(runner.results)
    files = []
    members = []
    for result in results:
        if result.ok:
            continue
        details = list(getattr(result, "failure_details", None) or [])
        if not details:
            details = [_fallback_detail(result)]
        entries = [_failure_member(result, detail) for detail in details]
        members.extend(entries)
        files.append({
            "group": result.group,
            "file": _repo_relative(result, {"location": {"file": result.file}}),
            "status": result.status,
            "tests": result.tests,
            "passed": result.passed,
            "failed": result.failed,
            "cancelled": result.cancelled,
            "counts_source": result.counts_source,
            "notes": result.notes,
            "stderr": list(getattr(result, "stderr", None) or []),
            "failures": entries,
        })
    groups = {}
    for member in members:
        groups.setdefault(member["normalized"], []).append(member)
    grouped = [{"message": message, "count": len(items), "members": items}
               for message, items in groups.items()]
    grouped.sort(key=lambda item: (-item["count"], item["message"]))
    totals = {
        "files": len(results),
        "passed": sum(1 for result in results if result.ok),
        "failed": sum(1 for result in results if not result.ok),
        "failures": len(members),
        "groups": len(grouped),
    }
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    report = {"shard": dict(runner.context), "totals": totals,
              "files": files, "groups": grouped}
    report_path = directory / DIAGNOSTICS_FILE
    report_path.write_text(json.dumps(report, indent=2) + "\n")

    lines = ["## JS test failures", "",
             f"{totals['files']} file(s): {totals['passed']} passed, "
             f"{totals['failed']} failed; {totals['failures']} failure(s) in "
             f"{totals['groups']} group(s); shard {runner.context.get('shard', '1/1')}",
             "", f"Full report: `{report_path}`"]
    if files:
        lines += ["", "### Failing files"]
        for entry in files:
            first = entry["failures"][0]
            location = str(first["file"])
            if first["line"]:
                location += f":{first['line']}"
                if first["column"]:
                    location += f":{first['column']}"
            lines.append(
                f"- **{entry['status'].upper()}** `{entry['file']}` "
                f"({entry['tests']} tests, {entry['failed']} failed): "
                f"{first['normalized']}")
            for member in entry["failures"][:5]:
                where = str(member["file"])
                if member["line"]:
                    where += f":{member['line']}"
                    if member["column"]:
                        where += f":{member['column']}"
                lines.append(f"  - `{member['test']}` at `{where}`: {member['normalized']}")
            if len(entry["failures"]) > 5:
                lines.append(f"  - ... {len(entry['failures']) - 5} more in `{report_path.name}`")
    repeated = [item for item in grouped if item["count"] > 1]
    if repeated:
        lines += ["", "### Same error across tests"]
        for item in repeated:
            lines.append(f"- x{item['count']} {item['message']}")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write("\n".join(lines) + "\n")

    for member in members[:ANNOTATION_LIMIT]:
        properties = [f"file={_property_escape(member['file'])}"]
        if member["line"]:
            properties.append(f"line={member['line']}")
            if member["column"]:
                properties.append(f"col={member['column']}")
        if member["test"] and member["test"] != "(file)":
            properties.append(f"title={_property_escape(member['test'])}")
        print(f"::error {','.join(properties)}::{_annotation_escape(member['message'])}",
              flush=True)
    print(f"DIAGNOSTICS {totals['failures']} failure(s) in {totals['failed']} file(s), "
          f"{totals['groups']} group(s); full report {report_path}", flush=True)
    return report


def js_checks(native):
    print_versions()
    paths = changed()
    index, total = shard_settings()
    excluded = []
    selected = js_plan(paths, native, excluded)
    owned = shard_files(selected, index, total)
    groups = {}
    unrouted = []
    for file in owned:
        relative = file.relative_to(ROOT)
        try:
            group = route(relative, native)
        except RuntimeError as error:
            unrouted.append(str(error))
            continue
        groups.setdefault(group, []).append(str(file.relative_to(ROOT / group)))

    print(f"SELECTED {len(selected)} eligible test files of "
          f"{len(selected) + len(excluded)} in the tree; shard {index} of {total} "
          f"owns {len(owned)}", flush=True)
    if excluded:
        print(f"OUT OF SCOPE {len(excluded)} selected file(s) are not run by this "
              f"campaign (their own workflow keeps them):", flush=True)
        for name, reason in excluded:
            print(f"  {name}: {reason}", flush=True)
    for group, files in sorted(groups.items()):
        for file in files:
            print(f"  {group}/{file}", flush=True)
    if unrouted:
        for name in unrouted:
            print(f"UNROUTED {name}", flush=True)
    routed = sum(len(files) for files in groups.values())
    if routed + len(unrouted) != len(owned):
        raise RuntimeError(
            f"{len(owned) - routed - len(unrouted)} selected file(s) disappeared "
            "between selection and execution")
    for name in MANDATORY_TESTS[bool(native)]:
        print(f"MANDATORY {name} -> shard {shard_of(name, total)} of {total}", flush=True)

    failed = bool(unrouted)
    directory, ephemeral = report_directory(index, total)
    runner = test_watchdog.Runner(
        directory, file_seconds=TEST_FILE_SECONDS, test_timeout_ms=TEST_TIMEOUT_MS,
        exit_grace=TEST_EXIT_GRACE,
        context={"suite": "native-js" if native else "js", "shard": f"{index}/{total}",
                 "selected": len(owned), "eligible": len(selected),
                 "excluded": len(excluded)})
    entries = [(group, ROOT / group, file) for group, files in sorted(groups.items()) for file in files]
    runner.run(entries, lambda group, cwd, file: js_command(group, file))
    publish_js_report(runner, directory)
    if not runner.exit_code:
        print(f"TEST FILES PASS: {len(entries)} files, shard {index} of {total}, {runner.elapsed:.1f}s", flush=True)
    else:
        failed = True
        print(f"TEST FILES FAIL: exit {runner.exit_code}, shard {index} of {total}, {runner.elapsed:.1f}s", flush=True)
    if failed:
        raise SystemExit(1 if not runner.interrupted else runner.exit_code)
    if ephemeral and all(result.ok for result in runner.results):
        shutil.rmtree(directory, ignore_errors=True)


CHECKPOINT_DIR = "apps/native/test"


def checkpoint_selection():
    """Exactly the Native test files the checkpoint runs.

    Recursively select every extension admitted by the hourly selector. A nested
    or MJS regression must not disappear merely because the checkpoint used to
    use a top-level TS glob.
    """
    selected = sorted(name for name in git("ls-files", "--", CHECKPOINT_DIR)
                      if Path(name).is_relative_to(CHECKPOINT_DIR)
                      and JS_TEST.search(name))
    if not selected:
        raise RuntimeError("checkpoint selection is empty")
    for name in selected:
        if not (ROOT / name).is_file():
            raise RuntimeError("missing selected checkpoint test: " + name)
    missing = [name for name in MANDATORY_TESTS[True] if name not in selected]
    if missing:
        raise RuntimeError("missing mandatory security test: " + ", ".join(missing))
    return selected


def checkpoint_checks():
    """Run every checkpoint file under one supervisor.

    One process per file, with the per-test limit, the per-file watchdog and the
    exit grace: a hung or leaked checkpoint file is named instead of hiding every
    later file behind one suite-wide timeout.
    """
    print_versions()
    selected = checkpoint_selection()
    print(f"CHECKPOINT {len(selected)} test files", flush=True)
    for name in selected:
        print(f"  {name}", flush=True)
    directory, ephemeral = report_directory(0, 1, "native-checkpoint")
    runner = test_watchdog.Runner(
        directory, file_seconds=TEST_FILE_SECONDS, test_timeout_ms=TEST_TIMEOUT_MS,
        exit_grace=TEST_EXIT_GRACE,
        context={"suite": "native-checkpoint", "selected": len(selected)})
    entries = [("apps/native", ROOT / "apps/native",
                str(Path(name).relative_to("apps/native"))) for name in selected]
    runner.run(entries, lambda group, cwd, file: js_command(group, file))
    publish_js_report(runner, directory)
    if runner.exit_code:
        raise SystemExit(runner.exit_code)
    print(f"CHECKPOINT PASS: {len(selected)} files, {runner.elapsed:.1f}s", flush=True)
    if ephemeral and all(result.ok for result in runner.results):
        shutil.rmtree(directory, ignore_errors=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["go", "js", "native-js", "checkpoint"])
    parser.add_argument("--module", default="server")
    parser.add_argument("--group", choices=["affected", "auth", "media", "hosted"], default="affected")
    options = parser.parse_args()
    if options.kind == "go":
        go_checks(options.module, options.group)
    elif options.kind == "checkpoint":
        checkpoint_checks()
    else:
        js_checks(options.kind == "native-js")
