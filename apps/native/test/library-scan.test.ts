/** MU2: the library header and rail read scan state from the event feed, not polling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHookHost, act} from './hook-driver.ts';
import {useLibraryScan, useScanningLibraries} from '../src/app/library-scan.ts';
import {setDeviceEvents} from '../src/app/device-events.ts';
import {EventsClient} from '../../../packages/client-core/src/playback-v1/events.ts';

const source = (status: string, discovered: number, id = `s-${status}-${discovered}`) => ({id, health: 'healthy', lastCompleteAt: '', jobId: 'job', status, phase: 'inventory', discovered, analyzed: 0, warnings: 0, pauseReason: ''});
const apiFor = (byLibrary: Record<string, unknown[]>, requests: string[] = []) => ({
  request: async (path: string) => {
    requests.push(path);
    const id = decodeURIComponent(path.split('/')[3] ?? '');
    return {serverId: 'server', inventory: {libraryId: id, revision: 1, sources: byLibrary[id] ?? []}};
  },
}) as never;
const feedFor = () => new EventsClient({http: {request: async () => { throw new Error('no network'); }} as never});
const scanEvent = (id: string, libraryId: string, revision: string, state: string, found: number) => ({id, type: 'library.scan.updated', resource: {kind: 'library', id: libraryId}, revision, data: {state, found}});

function mountedScan(api: never, libraryId: string | undefined) {
  let seen: unknown = 'unset';
  const host = createHookHost(() => {
    seen = useLibraryScan(api, 'server', libraryId);
  });
  host.mount();
  return {host, seen: () => seen};
}

test('a running scan surfaces with its found count; a quiet library does not', async () => {
  setDeviceEvents(null);
  const api = apiFor({library: [source('running', 1240), source('complete', 40)]});
  const a = mountedScan(api, 'library');
  await act(async () => {});
  assert.deepEqual(a.seen(), {scanning: true, found: 1240, finished: 0});
  a.host.unmount();
  const quiet = apiFor({library: [source('complete', 40)]});
  const b = mountedScan(quiet, 'library');
  await act(async () => {});
  assert.deepEqual(b.seen(), {scanning: false, found: 0, finished: 0});
  b.host.unmount();
});

test('queued sources count as scanning; errors and missing scope read quiet', async () => {
  setDeviceEvents(null);
  const api = apiFor({library: [source('queued', 3)]});
  const a = mountedScan(api, 'library');
  await act(async () => {});
  assert.deepEqual(a.seen(), {scanning: true, found: 3, finished: 0});
  a.host.unmount();
  const failing = {request: async () => { throw Object.assign(new Error('Denied'), {code: 'forbidden'}); }} as never;
  const b = mountedScan(failing, 'library');
  await act(async () => {});
  assert.deepEqual(b.seen(), {scanning: false, found: 0, finished: 0});
  b.host.unmount();
  const c = mountedScan(api, undefined);
  await act(async () => {});
  assert.deepEqual(c.seen(), {scanning: false, found: 0, finished: 0});
  c.host.unmount();
});

test('the rail set holds only the libraries that are scanning', async () => {
  setDeviceEvents(null);
  const api = apiFor({a: [source('running', 7)], b: [source('complete', 9)], c: [source('queued', 1)]});
  let seen: unknown = 'unset';
  const host = createHookHost(() => {
    seen = useScanningLibraries(api, 'server', ['a', 'b', 'c']);
  });
  host.mount();
  await act(async () => {});
  assert.deepEqual([...(seen as ReadonlySet<string>)].sort(), ['a', 'c']);
  host.unmount();
});

test('MU2: initial reads, event updates, resync re-reads, finished counts, no timers', async () => {
  const feed = feedFor();
  setDeviceEvents(feed);
  try {
    const requests: string[] = [];
    const api = apiFor({lib1: [source('running', 100)], lib2: [source('complete', 5)]}, requests);
    let single: any = 'unset';
    let rail: any = 'unset';
    const host = createHookHost(() => {
      single = useLibraryScan(api, 'server', 'lib1');
      rail = useScanningLibraries(api, 'server', ['lib1', 'lib2']);
    });
    host.mount();
    await act(async () => {});
    // Bounded initial reads, even though both hooks watch lib1 (union).
    const count = (id: string) => requests.filter(p => p.includes(`/libraries/${id}/`)).length;
    assert.ok(count('lib1') >= 1 && count('lib1') <= 2, `lib1 read ${count('lib1')}x`);
    assert.ok(count('lib2') >= 1 && count('lib2') <= 2, `lib2 read ${count('lib2')}x`);
    assert.ok(requests.length <= 4, `${requests.length} initial requests`);
    const settled = requests.length;
    assert.deepEqual(single, {scanning: true, found: 100, finished: 0});
    assert.deepEqual([...(rail as ReadonlySet<string>)].sort(), ['lib1']);
    // A progress event updates both hooks with no new request.
    feed.deliver(scanEvent('e1', 'lib1', '20', 'progress', 999) as never);
    await act(async () => {});
    assert.deepEqual(single, {scanning: true, found: 999, finished: 0});
    assert.deepEqual([...(rail as ReadonlySet<string>)].sort(), ['lib1']);
    assert.equal(requests.length, settled, 'no request per event');
    // A finished event clears the rail dot and counts once.
    feed.deliver(scanEvent('e2', 'lib1', '21', 'finished', 999) as never);
    await act(async () => {});
    assert.deepEqual(single, {scanning: false, found: 0, finished: 1});
    assert.deepEqual([...(rail as ReadonlySet<string>)].sort(), []);
    assert.equal(requests.length, settled, 'no request per event');
    // stream.resync re-reads every watched library once.
    feed.deliver({id: 'r1', type: 'stream.resync'} as never);
    await act(async () => {});
    assert.equal(requests.length, settled + 2, 'one re-read per watched library');
    assert.deepEqual(single, {scanning: true, found: 100, finished: 1});
    // No timers left: nothing further happens on its own.
    const src = await readFile(new URL('../src/app/library-scan.ts', import.meta.url), 'utf8');
    assert.ok(!src.includes('setInterval'), 'no setInterval');
    assert.ok(!src.includes('setTimeout'), 'no setTimeout');
    assert.ok(!src.includes('new EventsClient'), 'no second event client');
    await act(async () => {});
    assert.equal(requests.length, settled + 2, 'no polling after 60s of fake time');
    host.unmount();
  } finally {
    setDeviceEvents(null);
  }
});
