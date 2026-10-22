import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkAttemptSource, artworkFrame, boundedCovers, circleArtworkFrames, coverAspect, coverTitleScale, mixColour} from '../src-next/kit/artwork/model.ts';
import {nativeAmbientSource} from '../src-next/kit/artwork/source.ts';
import {bindArtworkPreparation, createArtworkPreparation} from '../src-next/kit/artwork/preparation.ts';
import type {AmbientArtworkSource} from '../../../packages/client-core/src/artwork/index.ts';

test('cover crops preserve actual source dimensions and the requested top edge', () => {
  assert.deepEqual(artworkFrame(150, 200, 600, 1200, 'cover', {x: 0.5, y: 0}), {width: 150, height: 300, left: 0, top: 0});
  assert.deepEqual(artworkFrame(150, 200, 600, 1200, 'cover', {x: 0.5, y: 1}), {width: 150, height: 300, left: 0, top: -100});
  assert.deepEqual(artworkFrame(200, 100, 400, 400, 'contain'), {width: 100, height: 100, left: 50, top: 0});
});

test('episode backdrop treatment crops without manufacturing an episode number', () => {
  const crop = artworkFrame(160, 90, 1600, 900, 'cover', {x: 0.5, y: 0.5}, 2.6);
  assert.equal(crop.width, 416); assert.equal(crop.height, 234);
  assert.equal(crop.left, -128); assert.equal(crop.top, -72);
});

test('retry request identity stays separate from the permission-scoped scheduler key', () => {
  const headers = Object.freeze({Authorization: 'test-only-authority'});
  const source = Object.freeze({uri: 'https://fixture.invalid/art?v=original', cacheKey: 'server/viewer/permission-fence', headers});
  const first = artworkAttemptSource(source, source.uri, 0);
  const retry = artworkAttemptSource(source, source.uri, 2);
  assert.equal(first.uri, source.uri);
  assert.equal(retry.uri, source.uri + '&_artRetry=2');
  assert.deepEqual(retry.headers, headers);
  assert.notEqual(retry.headers, headers);
  assert.ok(!retry.uri.includes(source.cacheKey));
  assert.equal(source.uri, 'https://fixture.invalid/art?v=original');
});

test('ambient binding preserves exact canonical representation and authority identity', () => {
  const source: AmbientArtworkSource = Object.freeze({url: '/selected-art?size=ambient-v1&v=version', cacheKey: 'server/viewer/current-authority', version: 'version', variant: 'ambient-v1', maxEdge: 64});
  const calls: string[] = [];
  const result = nativeAmbientSource(source, url => {calls.push(url); return 'https://fixture.invalid' + url;}, {Authorization: 'test-only-authority'});
  assert.deepEqual(calls, [source.url]);
  assert.equal(result?.url, source.url); assert.equal(result?.cacheKey, source.cacheKey);
  assert.equal(result?.variant, 'ambient-v1'); assert.equal(result?.maxEdge, 64); assert.equal(result?.version, source.version);
  assert.equal(result?.uri, 'https://fixture.invalid' + source.url);
  assert.equal(nativeAmbientSource(undefined, () => {throw new Error('must not resolve absent art');}), undefined);
  assert.equal(nativeAmbientSource(source, () => undefined), undefined);
});

test('bounded supplied cover samples do not scan, reorder or mutate their input', () => {
  const covers = Object.freeze(Array.from({length: 6}, (_, i) => Object.freeze({uri: `fixture:${i}`, cacheKey: `authority:${i}`})));
  assert.deepEqual(boundedCovers(covers, 3), covers.slice(0, 3));
  assert.deepEqual(boundedCovers(covers, 4), covers.slice(0, 4));
  assert.equal(covers.length, 6);
  assert.equal(coverAspect('poster'), 2 / 3); assert.equal(coverAspect('square'), 1); assert.equal(coverAspect('periodical'), 3 / 4);
});

test('sparse covers shrink long words and use stable supplied colour mixing', () => {
  assert.equal(coverTitleScale('Dracula'), 0.155);
  assert.ok(coverTitleScale('The Metamorphosis') < coverTitleScale('Dracula'));
  assert.ok(coverTitleScale('An extraordinarilylongunbrokenword') >= 0.086);
  assert.equal(mixColour('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColour('#28587a', '#071018', 0), '#28587a');
});

test('three newest-first covers fill one half and two quarters, with bounded TV seams', () => {
  const frames = circleArtworkFrames(3, 323, 3);
  assert.deepEqual(frames, [{left: 0, top: 0, width: 160, height: 323}, {left: 163, top: 0, width: 160, height: 160}, {left: 163, top: 163, width: 160, height: 160}]);
  assert.deepEqual(circleArtworkFrames(2, 323, 3), [{left: 163, top: 0, width: 160, height: 323}, {left: 0, top: 0, width: 160, height: 323}]);
  assert.equal(circleArtworkFrames(40, 320, 3).length, 4);
});

test('preparation resolves only from its matching mounted Image boundary and refuses duplicate layers', async () => {
  const source = {uri: 'fixture:sharp', cacheKey: 'authority:sharp'};
  const handle = createArtworkPreparation(source);
  let resolved = false;
  const waiting = handle.wait().then(() => {resolved = true;});
  await Promise.resolve(); assert.equal(resolved, false);
  const boundary = bindArtworkPreparation(handle, source)!;
  assert.throws(() => bindArtworkPreparation(handle, source), /one image layer/);
  await Promise.resolve(); assert.equal(resolved, false);
  boundary.ready(); await waiting; assert.equal(resolved, true);
  boundary.release();
  await assert.rejects(handle.wait(), {name: 'AbortError'});
});

test('preparation cancels stale waits and rejects real decode failures or changed authority', async () => {
  const source = {uri: 'fixture:sharp', cacheKey: 'authority:sharp'};
  const handle = createArtworkPreparation(source);
  const controller = new AbortController();
  const cancelled = handle.wait(controller.signal);
  controller.abort(); await assert.rejects(cancelled, {name: 'AbortError'});
  const failed = handle.wait(); bindArtworkPreparation(handle, source)!.failed();
  await assert.rejects(failed, /did not decode/);
  const changed = createArtworkPreparation(source);
  const waiting = changed.wait();
  assert.equal(bindArtworkPreparation(changed, {...source, cacheKey: 'new-authority'}), undefined);
  await assert.rejects(waiting, /source changed/);
  const removed = createArtworkPreparation(source);
  const detached = removed.wait(); bindArtworkPreparation(removed, source)!.release();
  await assert.rejects(detached, {name: 'AbortError'});
});
