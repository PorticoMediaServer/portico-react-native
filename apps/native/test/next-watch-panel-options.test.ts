import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import {playbackFence} from '../../../packages/player-core/src/index.ts';
import {parseOptions} from '../../../packages/client-core/src/playback-v1/types.ts';
import {NativeWatchPanelOptions} from '../src-next/screens/watch/panel-options.ts';
import {nativeWatchPanelRows, type NativeWatchPanelNames} from '../src-next/screens/watch/panel-model.ts';

const fence = playbackFence({kind: 'queue', playback: {scope: {serverId: 's', accountId: 'a', profileId: 'p', controllerId: 'c', controllerEpoch: 'e', commandLaneId: 'l', authority: 'local'}, run: 1}, sessionId: 'session', itemId: 'item', sourceId: 'v2', entryId: 'entry', generation: 3});
const offers = {itemId: 'item', versions: [{id: 'v1'}, {id: 'v2', audio: [{id: 'first', default: true}, {id: 'chosen'}], subtitles: [{id: 'first', default: true}, {id: 'chosen'}]}], qualities: [{mode: 'original'}, {mode: 'automatic'}, {mode: 'fixed', id: '720p-high'}]};
const source = () => ({retired: false, fence, dock: {local: {fence, expanded: true}}, options: parseOptions(offers), session: {id: 'session', itemId: 'item', versionId: 'v2', queue: {entryId: 'entry'}, presentation: {generation: 3, audioTrackId: 'chosen', subtitle: {trackId: 'chosen'}, quality: {mode: 'automatic', id: '720p-high'}}}} as any);
const names: NativeWatchPanelNames = {audio: track => ({primary: track.id, secondary: track.codec}), subtitle: track => ({primary: track.id, secondary: track.format}),
  quality: choice => ({primary: choice.id ?? choice.mode}), audioFooter: () => [], qualityFooter: () => []};

test('fresh panel rows preserve actual offered order and exact current selections rather than defaults or previews', () => {
  const current = source(), rows = nativeWatchPanelRows(current, parseOptions(offers), names);
  assert.deepEqual(rows.audio.map(row => [row.id, row.selected]), [['first', false], ['chosen', true]]);
  assert.deepEqual(rows.subtitles.map(row => [row.id, row.selected]), [['first', false], ['chosen', true]]);
  assert.deepEqual(rows.qualities.map(row => [row.id, row.selected]), [['original', false], ['automatic', true], ['720p-high', false]]);
  current.session.presentation.audioTrackId = undefined;
  assert.ok(nativeWatchPanelRows(current, parseOptions(offers), names).audio.every(row => !row.selected));
  current.session.presentation.generation++;
  assert.deepEqual(nativeWatchPanelRows(current, parseOptions(offers), names), {audio: [], subtitles: [], qualities: []});
});
test('actual panel HTTP request previews the exact current version and rejects late source/closed panel results', async () => {
  let current = source(), finish!: (body: unknown) => void;
  const listeners = new Set<() => void>(), requests: {url: URL; signal?: AbortSignal | null}[] = [];
  const api = new HttpLocalApi('https://portico.test', '', async (input, init) => {requests.push({url: new URL(String(input)), signal: init?.signal}); return new Response(JSON.stringify(await new Promise(resolve => {finish = resolve;})), {status: 200});});
  const adapter = {getSnapshot: () => current, subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};}};
  const panel = new NativeWatchPanelOptions(api, adapter);
  try {
    const first = panel.load(fence); await Promise.resolve();
    assert.equal(requests[0]!.url.pathname, '/v1/items/item/playback-options');
    assert.equal(requests[0]!.url.searchParams.get('versionId'), 'v2');
    panel.clear(); assert.equal(requests[0]!.signal!.aborted, true); finish(offers); await first;
    assert.equal(panel.getSnapshot().phase, 'idle');
    const second = panel.load(fence); await Promise.resolve();
    current = {...current, fence: {...fence, generation: 4}}; for (const listener of listeners) listener();
    assert.equal(requests[1]!.signal!.aborted, true); finish(offers); await second;
    assert.equal(panel.getSnapshot().phase, 'idle');
  } finally {panel.dispose();}
  assert.equal(listeners.size, 0);
});
test('failed actual request exposes retry state and can recover without changing playback', async () => {
  const current = source(); let fail = true;
  const api = new HttpLocalApi('https://portico.test', '', async () => new Response(JSON.stringify(fail ? {code: 'unavailable'} : offers), {status: fail ? 503 : 200}));
  const panel = new NativeWatchPanelOptions(api, {getSnapshot: () => current, subscribe: () => () => {}});
  try {await panel.load(fence); assert.equal(panel.getSnapshot().phase, 'failed'); fail = false; await panel.load(fence);
    assert.equal(panel.getSnapshot().phase, 'ready'); assert.equal(current.session.presentation.audioTrackId, 'chosen');
  } finally {panel.dispose();}
});
