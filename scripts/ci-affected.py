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


def js_plan(paths, native=False):
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
    tests = {p for p in impacted if re.search(r"\.test\.(?:[cm]?js|tsx?)$", str(p)) and p.is_file()}
    for name in MANDATORY_TESTS[bool(native)]:
        if not (ROOT / name).is_file():
            raise RuntimeError("missing mandatory security test: " + name)
        tests.add(ROOT / name)
    return sorted(tests)


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
    else:
        args = ["node", "--experimental-strip-types"]
    return [*args, f"--test-timeout={TEST_TIMEOUT_MS}",
            f"--test-reporter={ROOT / 'scripts/test-events.mjs'}",
            "--test-concurrency=1", "--test", file]


def js_checks(native):
    paths = changed()
    index, total = shard_settings()
    selected = js_plan(paths, native)
    owned = shard_files(selected, index, total)
    groups = {}
    for file in owned:
        relative = file.relative_to(ROOT)
        if native and relative.parts[:3] == ("apps", "native", "test"):
            group = "apps/native"
        elif str(relative).startswith("web-next/test/"):
            group = "web-next"
        elif str(relative).startswith("web/test/"):
            group = "web"
        elif str(relative).startswith("packages/"):
            group = "/".join(relative.parts[:2])
        elif str(relative).startswith("server/receiver/cast/test/"):
            group = "."
        else:
            continue
        groups.setdefault(group, []).append(str(file.relative_to(ROOT / group)))

    print(f"SELECTED {len(owned)} of {len(selected)} test files (shard {index} of {total})", flush=True)
    for group, files in sorted(groups.items()):
        for file in files:
            print(f"  {group}/{file}", flush=True)
    for name in MANDATORY_TESTS[bool(native)]:
        print(f"MANDATORY {name} -> shard {shard_of(name, total)} of {total}", flush=True)

    failed = False
    commands = []
    if native:
        source = [str(Path(p).relative_to("apps/native")) for p in sorted(paths)
                  if p.startswith("apps/native/") and p.endswith((".ts", ".tsx"))
                  and (ROOT / p).is_file() and (p.startswith("apps/native/src-next/") or p == "apps/native/App.tsx")]
        if source:
            if total == 1 or index == 0:
                commands.append((["npx", "--no-install", "eslint", "--no-eslintrc", "-c", ".eslintrc.hooks.cjs", *source], ROOT / "apps/native"))
            else:
                print("NOTE source lint runs once in shard 0; this shard runs tests only", flush=True)
    for args, cwd in commands:
        try:
            run(args, cwd)
        except subprocess.CalledProcessError as error:
            failed = True
            print(f"FAIL command exited {error.returncode}: {' '.join(args)}", flush=True)
    directory, ephemeral = report_directory(index, total)
    runner = test_watchdog.Runner(
        directory, file_seconds=TEST_FILE_SECONDS, test_timeout_ms=TEST_TIMEOUT_MS,
        exit_grace=TEST_EXIT_GRACE,
        context={"suite": "native-js" if native else "js", "shard": f"{index}/{total}",
                 "selected": len(owned), "selection": len(selected)})
    entries = [(group, ROOT / group, file) for group, files in sorted(groups.items()) for file in files]
    runner.run(entries, lambda group, cwd, file: js_command(group, file))
    if not runner.exit_code:
        print(f"TEST FILES PASS: {len(owned)} files, shard {index} of {total}, {runner.elapsed:.1f}s", flush=True)
    else:
        failed = True
        print(f"TEST FILES FAIL: exit {runner.exit_code}, shard {index} of {total}, {runner.elapsed:.1f}s", flush=True)
    if failed:
        raise SystemExit(1 if not runner.interrupted else runner.exit_code)
    if ephemeral and all(result.ok for result in runner.results):
        shutil.rmtree(directory, ignore_errors=True)


CHECKPOINT_DIR = "apps/native/test"


def checkpoint_selection():
    """Exactly the retired and mounted Native test files the checkpoint runs.

    The checkpoint used to hand both sets to one whole-glob node invocation. The
    same two sets are selected here explicitly — the test directory itself only,
    retired files (not `next-*`) and mounted files (`next-*`) — so the per-file
    supervisor can run them without adding or dropping a file.
    """
    names = [name for name in git("ls-files", "--", CHECKPOINT_DIR)
             if Path(name).parent.as_posix() == CHECKPOINT_DIR
             and name.endswith(".test.ts")]
    retired = sorted(name for name in names if not Path(name).name.startswith("next-"))
    mounted = sorted(name for name in names if Path(name).name.startswith("next-"))
    if not retired or not mounted:
        raise RuntimeError(
            "checkpoint selection is incomplete: "
            f"{len(retired)} retired and {len(mounted)} mounted test files")
    for name in retired + mounted:
        if not (ROOT / name).is_file():
            raise RuntimeError("missing selected checkpoint test: " + name)
    missing = [name for name in MANDATORY_TESTS[True] if name not in mounted]
    if missing:
        raise RuntimeError("missing mandatory security test: " + ", ".join(missing))
    return retired, mounted


def checkpoint_checks():
    """Run the retired and mounted checkpoint files under the same supervisor.

    One process per file, with the per-test limit, the per-file watchdog and the
    exit grace: a hung or leaked checkpoint file is named instead of hiding every
    later file behind one suite-wide timeout. The selection itself is unchanged.
    """
    retired, mounted = checkpoint_selection()
    selected = retired + mounted
    print(f"CHECKPOINT {len(retired)} retired + {len(mounted)} mounted test files", flush=True)
    for name in retired:
        print(f"  retired {name}", flush=True)
    for name in mounted:
        print(f"  mounted {name}", flush=True)
    directory, ephemeral = report_directory(0, 1, "native-checkpoint")
    runner = test_watchdog.Runner(
        directory, file_seconds=TEST_FILE_SECONDS, test_timeout_ms=TEST_TIMEOUT_MS,
        exit_grace=TEST_EXIT_GRACE,
        context={"suite": "native-checkpoint", "retired": len(retired),
                 "mounted": len(mounted), "selected": len(selected)})
    entries = [("apps/native", ROOT / "apps/native",
                str(Path(name).relative_to("apps/native"))) for name in selected]
    runner.run(entries, lambda group, cwd, file: js_command(group, file))
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
