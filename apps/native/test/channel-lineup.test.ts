import test from 'node:test';
import assert from 'node:assert/strict';
import type {GuideChannel} from '../../../packages/client-core/src/channel-guide.ts';
import {canStepChannel, channelStep, channelTuned, type Lineup} from '../src/player/channel-lineup.ts';

const channel = (id: string, over: Partial<GuideChannel> = {}): GuideChannel => ({
  id, sourceId: 'antenna', provenance: 'live-source', name: id, number: id, group: '',
  generation: 'one', programmes: [], tuneAvailable: true, recordAvailable: false,
  tuneUnavailableReason: '', recordUnavailableReason: '', favorite: false, hidden: false,
  preferenceRevision: 0, ...over,
});
const a = channel('a');
const b = channel('b');
const c = channel('c');
function bounded(step: NonNullable<Lineup['step']>): Lineup & {fullCalls: number} {
  const lineup = Object.assign(async () => {
    lineup.fullCalls++;
    assert.fail('bounded stepping must not load the full lineup');
    return [] as readonly GuideChannel[];
  }, {step, fullCalls: 0});
  return lineup;
}

test('next/previous, including end wrapping, delegate the current channel and direction to bounded step', async () => {
  const cases: readonly [GuideChannel, 1 | -1, GuideChannel][] = [[a, 1, b], [b, -1, a], [c, 1, a], [a, -1, c]];
  for (const [current, delta, neighbour] of cases) {
    let calls = 0;
    const lineup = bounded(async (at, direction) => {
      calls++;
      assert.equal(at, current);
      assert.equal(direction, delta);
      return neighbour;
    });
    channelTuned(current, lineup);
    assert.equal(canStepChannel(), true);
    const next = await channelStep(delta);
    assert.equal(next?.channel, neighbour);
    assert.equal(next?.lineup, lineup);
    assert.equal(calls, 1);
    assert.equal(lineup.fullCalls, 0);
  }
});

test('a channel tuned without a lineup cannot step', async () => {
  channelTuned(a);
  assert.equal(canStepChannel(), false);
  assert.equal(await channelStep(1), undefined);
  assert.equal(await channelStep(-1), undefined);
});

test('bounded stepping safely handles absent neighbours, a single current channel, and unavailable neighbours', async () => {
  for (const next of [undefined, a, channel('b', {tuneAvailable: false})]) {
    const lineup = bounded(async () => next);
    channelTuned(a, lineup);
    assert.equal(await channelStep(1), undefined);
    assert.equal(await channelStep(-1), undefined);
    assert.equal(lineup.fullCalls, 0);
  }
});

test('bounded transport failures do not fall back to an expensive full lineup read', async () => {
  const lineup = bounded(async () => { throw new Error('unavailable'); });
  channelTuned(a, lineup);
  assert.equal(await channelStep(1), undefined);
  assert.equal(lineup.fullCalls, 0);
});

test('channel identity includes its source, so the same id on another source is a valid neighbour', async () => {
  const another = channel('a', {sourceId: 'satellite'});
  channelTuned(a, bounded(async () => another));
  assert.equal((await channelStep(1))?.channel, another);
});

test('a different tune while a bounded step is awaiting discards its stale result', async () => {
  let resolve!: (next: GuideChannel) => void;
  const lineup = bounded(() => new Promise<GuideChannel>(done => { resolve = done; }));
  channelTuned(a, lineup);
  const pending = channelStep(1);
  channelTuned(c, lineup);
  resolve(b);
  assert.equal(await pending, undefined);
});

test('retuning the same channel while a bounded step is awaiting also fences the old result', async () => {
  let resolve!: (next: GuideChannel) => void;
  const lineup = bounded(() => new Promise<GuideChannel>(done => { resolve = done; }));
  channelTuned(a, lineup);
  const pending = channelStep(1);
  channelTuned(a, lineup);
  resolve(b);
  assert.equal(await pending, undefined);
});

test('legacy lineups preserve watchable filtering, ordering and wrapping', async () => {
  const unavailable = channel('unavailable', {tuneAvailable: false});
  const lineup: Lineup = async () => [a, unavailable, b, c];
  for (const [current, delta, next] of [[a, 1, b], [b, -1, a], [c, 1, a], [a, -1, c]] as const) {
    channelTuned(current, lineup);
    const result = await channelStep(delta);
    assert.equal(result?.channel, next);
    assert.equal(result?.lineup, lineup);
  }
});

test('legacy lineups preserve first/last fallback when the current channel is absent', async () => {
  const lineup: Lineup = async () => [a, b, c];
  channelTuned(channel('gone'), lineup);
  assert.equal((await channelStep(1))?.channel, a);
  assert.equal((await channelStep(-1))?.channel, c);
});

test('legacy empty, single watchable channel and failing lineups still cannot step', async () => {
  for (const lineup of [async () => [], async () => [a], async () => [a, channel('off', {tuneAvailable: false})], async () => { throw new Error('unavailable'); }] as Lineup[]) {
    channelTuned(a, lineup);
    assert.equal(await channelStep(1), undefined);
  }
});

test('legacy awaited reads keep their existing tune fence', async () => {
  let resolve!: (rows: readonly GuideChannel[]) => void;
  const lineup: Lineup = () => new Promise(done => { resolve = done; });
  channelTuned(a, lineup);
  const pending = channelStep(1);
  channelTuned(c, lineup);
  resolve([a, b, c]);
  assert.equal(await pending, undefined);
});
