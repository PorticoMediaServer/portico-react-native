#!/usr/bin/env python3
"""Run the real app's account-free Apple bridge probe on a disposable simulator.

Bundle apps/native/test/apple-bridge-simulator.js with the React Native CLI first.
This checks the native bridge and private-file cleanup, not device playback or visual fidelity.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import time


def command(*args):
    return subprocess.check_output(['xcrun', 'simctl', *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    platform = parser.add_mutually_exclusive_group()
    platform.add_argument('--tvos', action='store_true')
    platform.add_argument('--ipad', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    app_id = plistlib.loads((args.app / 'Info.plist').read_bytes())['CFBundleIdentifier']
    family = 'tvOS' if args.tvos else 'iOS'
    runtimes = json.loads(command('list', 'runtimes', '--json'))['runtimes']
    runtime = sorted((r for r in runtimes if r.get('isAvailable') and r['name'].startswith(family + ' ')),
                     key=lambda r: tuple(int(v) for v in r['version'].split('.')))[-1]
    types = json.loads(command('list', 'devicetypes', '--json'))['devicetypes']
    parts = [int(part) for part in runtime['version'].split('.')]
    packed = sum(part << shift for part, shift in zip((parts + [0, 0])[:3], (16, 8, 0)))
    if args.ipad:
        device_type = next(t['identifier'] for t in reversed(types) if t.get('productFamily') == 'iPad'
                           and t.get('minRuntimeVersion', 0) <= packed <= t.get('maxRuntimeVersion', 0xffffffff))
    else:
        device_type = next(t['identifier'] for t in types if t['name'] == ('Apple TV 4K (3rd generation)' if args.tvos else 'iPhone 15'))
    device = command('create', 'Portico P2-55 bridge', device_type, runtime['identifier'])
    process = None
    log_path = args.output / 'bridge-console.log'
    try:
        command('boot', device)
        command('bootstatus', device, '-b')
        command('install', device, str(args.app.resolve()))
        container = Path(command('get_app_container', device, app_id, 'data'))
        events = container / 'tmp/portico-journey.jsonl'
        environment = dict(os.environ, SIMCTL_CHILD_PORTICO_TEST_BUNDLE_PATH=str(args.bundle.resolve()))
        with log_path.open('w') as log:
            process = subprocess.Popen(['xcrun', 'simctl', 'launch', '--console', device, app_id],
                                       env=environment, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 120
            result = None
            while time.monotonic() < deadline:
                if events.exists():
                    for line in events.read_text(errors='replace').splitlines():
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue  # a concurrently appended line may still be incomplete
                        if 'appleBridgeResult' in event:
                            result = event['appleBridgeResult']
                            break
                if result is not None or process.poll() is not None:
                    break
                time.sleep(.2)
        if result is None:
            raise RuntimeError('bridge probe did not report a result; see bridge-console.log')
        leftovers = list((container / 'Library/Caches/portico-cover-uploads').glob('*'))
        leftovers += list((container / 'tmp').glob('portico-invitation-*'))
        result['privateFilesRemaining'] = len(leftovers)
        passed = (result.get('failures') == 0 and result.get('assertions') and
                  all(row.get('passed') is True for row in result['assertions']) and not leftovers)
        (args.output / 'bridge-result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'passed': bool(passed), 'assertions': len(result['assertions']),
                          'privateFilesRemaining': len(leftovers), 'result': str(args.output / 'bridge-result.json')}))
        return 0 if passed else 1
    finally:
        subprocess.run(['xcrun', 'simctl', 'terminate', device, app_id], capture_output=True)
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        subprocess.run(['xcrun', 'simctl', 'shutdown', device], capture_output=True)
        subprocess.run(['xcrun', 'simctl', 'delete', device], check=True)


if __name__ == '__main__':
    raise SystemExit(main())
