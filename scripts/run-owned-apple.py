#!/usr/bin/env python3
"""Runs the owned Apple suites on a Mac and writes their exact-revision receipts (C03).

  python3 scripts/run-owned-apple.py --output DIR [--device UDID] [--fixtures DIR] [--plan]

Every `owned-apple` entry of scripts/platform-tests.json is built and run by the recipe of the same
source in scripts/owned-apple-recipes.json, on a disposable iOS simulator unless the recipe says
macOS. A suite without a runnable recipe, or whose fixtures were not supplied, is reported and gets
no passing receipt, so `platform-tests.py owned-receipts` refuses the set. The receipt names the
checked-out commit, which must be clean.

A suite passes when it exits 0 and its last JSON line on stdout reports no failure: an integer
`assertions` with `failures` 0, or (older suites) boolean results that are all true, counted as its
assertions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts/platform-tests.json'
RECIPES = ROOT / 'scripts/owned-apple-recipes.json'
SIMULATOR_TARGET = 'arm64-apple-ios15.1-simulator'


def owned_sources(manifest=MANIFEST):
    return [entry['source'] for entry in json.loads(manifest.read_text())['apple'] if entry['execution'] == 'owned-apple']


def outcome(stdout, exit_code):
    """(passed, assertions) from a suite's exit status and the last JSON object it printed."""
    document = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith('{') and line.endswith('}'):
            try:
                document = json.loads(line)
            except ValueError:
                continue
            break
    if exit_code != 0 or not isinstance(document, dict):
        return False, 0
    if 'assertions' in document:
        count = document['assertions']
        if not isinstance(count, int) or isinstance(count, bool):
            return False, 0
        return count >= 1 and document.get('failures', 0) == 0, count
    results = [value for value in document.values() if isinstance(value, bool)]
    return bool(results) and all(results), len(results)


def substitute(value, places):
    for key, path in places.items():
        value = value.replace('{' + key + '}', str(path))
    return value


def plan(source, recipe, work, fixtures):
    """The build and run commands for one suite, or the reason it cannot run."""
    if not recipe or not recipe.get('runnable'):
        return None, (recipe or {}).get('reason', 'no recipe')
    if recipe.get('fixtures') and fixtures is None:
        return None, 'needs --fixtures: ' + recipe['fixtures']
    places = {'tmp': work, 'fixtures': fixtures or '', 'root': ROOT}
    binary = work / Path(source).stem
    simulator = recipe.get('sdk', 'iphonesimulator') == 'iphonesimulator'
    if source.endswith('.swift'):
        build = ['xcrun', '--sdk', recipe.get('sdk', 'iphonesimulator'), 'swiftc', '-O']
        if simulator:
            build += ['-target', SIMULATOR_TARGET]
    else:
        build = ['xcrun', '--sdk', recipe.get('sdk', 'iphonesimulator'), 'clang', '-fobjc-arc', '-fblocks', '-fmodules']
        if simulator:
            build += ['-target', SIMULATOR_TARGET]
    for framework in recipe.get('frameworks', []):
        build += ['-framework', framework]
    build += [str(ROOT / item) for item in recipe.get('sources', [])] + [str(ROOT / source), '-o', str(binary)]
    runs = []
    for run in recipe.get('runs', [{}]):
        arguments = [substitute(argument, places) for argument in run.get('args', [])]
        environment = {key: substitute(value, places) for key, value in run.get('env', {}).items()}
        runs.append((arguments, environment))
    return {'build': build, 'binary': binary, 'simulator': simulator, 'runs': runs}, None


def execute(command, arguments, environment, device, timeout):
    if command['simulator']:
        # simctl passes SIMCTL_CHILD_-prefixed variables to the spawned process.
        env = dict(os.environ, **{'SIMCTL_CHILD_' + key: value for key, value in environment.items()})
        argv = ['xcrun', 'simctl', 'spawn', device, str(command['binary']), *arguments]
    else:
        env = dict(os.environ, **environment)
        argv = [str(command['binary']), *arguments]
    return subprocess.run(argv, env=env, capture_output=True, text=True, timeout=timeout)


def run_suite(source, recipe, work, fixtures, device, log):
    command, reason = plan(source, recipe, work, fixtures)
    if command is None:
        log.write(f'SKIP {source}: {reason}\n')
        return {'status': 'not-run', 'reason': reason, 'assertions': 0}
    built = subprocess.run(command['build'], capture_output=True, text=True, timeout=300)
    log.write(' '.join(command['build']) + '\n' + built.stdout + built.stderr)
    if built.returncode != 0:
        return {'status': 'build-failed', 'assertions': 0}
    total, passed = 0, True
    for arguments, environment in command['runs']:
        try:
            result = execute(command, arguments, environment, device, recipe.get('timeoutSeconds', 120))
        except subprocess.TimeoutExpired:
            log.write(f'TIMEOUT {source}\n')
            return {'status': 'timed-out', 'assertions': 0}
        log.write(result.stdout + result.stderr)
        ok, count = outcome(result.stdout, result.returncode)
        passed, total = passed and ok, total + count
    return {'status': 'passed' if passed and total >= 1 else 'failed', 'assertions': total}


def receipt(revision, results, platform, device_set, artifact, root=ROOT):
    """The document `platform-tests.py owned-receipts` checks. Only passed suites are listed."""
    tests = []
    for source, result in sorted(results.items()):
        if result['status'] != 'passed':
            continue
        tests.append({'source': source, 'status': 'passed', 'assertions': result['assertions'], 'platform': platform,
                      'deviceOrSimulatorSet': device_set, 'resultArtifact': artifact,
                      'testSha256': hashlib.sha256((root / source).read_bytes()).hexdigest()})
    return {'revision': revision, 'tests': tests}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--device', help='an existing disposable simulator; one is created (and deleted) if omitted')
    parser.add_argument('--runtime', default=None, help='simctl runtime for a created simulator (default: newest iOS)')
    parser.add_argument('--fixtures', type=Path)
    parser.add_argument('--plan', action='store_true', help='print what would be built and run, and stop')
    args = parser.parse_args()
    recipes = json.loads(RECIPES.read_text())
    sources = owned_sources()
    unknown = sorted(set(recipes) - set(sources))
    if unknown:
        raise SystemExit(f'recipes for sources that are not owned suites: {unknown}')
    args.output.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='portico-owned-apple-'))
    if args.plan:
        for source in sources:
            command, reason = plan(source, recipes.get(source), work, args.fixtures)
            print(f'{source}: ' + (reason if command is None else ' '.join(command['build'])))
        shutil.rmtree(work, ignore_errors=True)
        return 0
    if subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        raise SystemExit('the checkout has uncommitted changes; a receipt names an exact commit')
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    created = None
    device = args.device
    if device is None:
        runtimes = json.loads(subprocess.run(['xcrun', 'simctl', 'list', 'runtimes', '--json'], capture_output=True, text=True, check=True).stdout)['runtimes']
        runtime = args.runtime or [r['identifier'] for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS')][-1]
        device = created = subprocess.run(['xcrun', 'simctl', 'create', 'Portico owned tests', 'com.apple.CoreSimulator.SimDeviceType.iPhone-15', runtime],
                                          capture_output=True, text=True, check=True).stdout.strip()
        subprocess.run(['xcrun', 'simctl', 'boot', device], check=True)
    results = {}
    try:
        with (args.output / 'owned-apple.log').open('w') as log:
            for source in sources:
                results[source] = run_suite(source, recipes.get(source), work, args.fixtures, device, log)
                print(f"{results[source]['status'].upper()} {source} ({results[source]['assertions']} assertions)", flush=True)
    finally:
        if created:
            subprocess.run(['xcrun', 'simctl', 'delete', created])
        shutil.rmtree(work, ignore_errors=True)
    platform = subprocess.run(['sw_vers', '-productVersion'], capture_output=True, text=True).stdout.strip()
    document = receipt(revision, results, f'macOS {platform}; iOS simulator', created and 'created disposable simulator' or device, 'owned-apple.log')
    (args.output / 'owned-apple-receipts.json').write_text(json.dumps(document, indent=2) + '\n')
    (args.output / 'owned-apple-results.json').write_text(json.dumps(results, indent=2) + '\n')
    check = subprocess.run([sys.executable, str(ROOT / 'scripts/platform-tests.py'), 'owned-receipts',
                            '--receipts', str(args.output / 'owned-apple-receipts.json'), '--revision', revision])
    return check.returncode


if __name__ == '__main__':
    sys.exit(main())
