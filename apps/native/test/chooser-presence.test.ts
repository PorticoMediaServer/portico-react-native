/** X-13 (client): an offline server's failed connect shows the specific dialog, not the generic notice. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooserFailureView} from '../src/screens/auth/chooser-presence.ts';
import type {ServerPresence} from '../../../packages/client-core/src/index.ts';

const now = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const offline = (lastSeenAt: string | null): ServerPresence => ({online: false, lastSeenAt});

test('a stale offline server gets the specific dialog; recent, unknown and online servers keep waiting', () => {
  assert.equal(chooserFailureView(offline(iso(now - 8 * 86_400_000)), true, now), 'offline-dialog');
  assert.equal(chooserFailureView(offline(null), true, now), 'offline-dialog', 'never seen');
  assert.equal(chooserFailureView(offline(iso(now - 30 * 60_000)), true, now), 'waiting', 'seen half an hour ago: the keep-trying copy');
  assert.equal(chooserFailureView(undefined, true, now), 'waiting', 'unknown presence renders normally');
  assert.equal(chooserFailureView({online: true, lastSeenAt: iso(now - 30 * 60_000)}, true, now), 'waiting');
  assert.equal(chooserFailureView(offline(iso(now - 8 * 86_400_000)), false, now), 'other');
});

test('both choosers branch on the decision: offline dialog copy, never the waiting copy for a stale server', () => {
  for (const file of ['HostedChooser.tsx', 'PorticoLanding.tsx']) {
    const source = readFileSync(new URL('../src/screens/auth/' + file, import.meta.url), 'utf8');
    assert.match(source, /chooserFailureView\(.*\) === 'offline-dialog'/, file);
    assert.match(source, /web\.chooser\.unreachableTitle/, file);
    assert.match(source, /web\.chooser\.signInDirectly/, file);
    assert.match(source, /sortServersByPresence\(servers\)/, file);
    assert.match(source, /web\.chooser\.lastSeen/, file);
    assert.match(source, /web\.chooser\.neverSeen/, file);
  }
  const chooser = readFileSync(new URL('../src/screens/auth/HostedChooser.tsx', import.meta.url), 'utf8');
  assert.match(chooser, /session\.direct\.setOrigin\(target\.baseUrl\); onDirect\(target\.baseUrl\)/, 'the address is prefilled for direct sign-in');
  const landing = readFileSync(new URL('../src/screens/auth/PorticoLanding.tsx', import.meta.url), 'utf8');
  assert.match(landing, /session\.direct\.setOrigin\(server\.baseUrl\); onDirect\(\)/, 'the address is prefilled for direct sign-in');
});
