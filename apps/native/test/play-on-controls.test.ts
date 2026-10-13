import test from 'node:test';
import assert from 'node:assert/strict';
import {newerReport, remoteAllows, remoteReport, remoteSkipTarget} from '../src/app/play-on-controls.ts';

const item = (over: Record<string, unknown> = {}) => ({sessionId: 's1', revision: '12', state: 'playing', positionMs: 754_500, actions: ['pause', 'seek', 'stop'], device: {id: 'd', name: 'Living room'}, kind: 'vod', item: {id: 'i1', title: 'Heat'}, ...over}) as never;

test('the report is the playing device’s own position, state and allowed actions', () => {
  const report = remoteReport([item({sessionId: 'other', positionMs: 5}), item()], 's1')!;
  assert.equal(report.positionSeconds, 754.5);
  assert.equal(report.state, 'playing');
  assert.equal(report.revision, '12');
  assert.deepEqual(report.actions, ['pause', 'seek', 'stop']);
  assert.equal(report.title, 'Heat');
  assert.equal(report.itemId, 'i1');
});

test('nothing is reported for a session the profile is not playing', () => {
  assert.equal(remoteReport([item()], 'gone'), undefined);
  assert.equal(remoteReport([item()], undefined), undefined);
  assert.equal(remoteReport([], 's1'), undefined);
});

test('an action the server does not list is not offered; before any report the handoff’s own controls stay', () => {
  const paused = remoteReport([item({state: 'paused', actions: ['resume', 'stop']})], 's1');
  assert.equal(remoteAllows(paused, 'resume'), true);
  assert.equal(remoteAllows(paused, 'pause'), false);
  assert.equal(remoteAllows(paused, 'seek'), false);
  assert.equal(remoteAllows(undefined, 'seek'), true);
});

test('an answer that arrives out of order never moves the position back', () => {
  const before = remoteReport([item({revision: '12', positionMs: 10_000})], 's1')!;
  const after = remoteReport([item({revision: '13', positionMs: 600_000})], 's1')!;
  assert.equal(newerReport(after, before), after);
  assert.equal(newerReport(before, after), after);
  // Another session, or none, is simply what was read.
  assert.equal(newerReport(after, undefined), undefined);
  const other = remoteReport([item({sessionId: 's2', revision: '1'})], 's2')!;
  assert.equal(newerReport(after, other), other);
});

test('a skip is measured from the playing device’s position and stays inside the title', () => {
  const report = remoteReport([item({positionMs: 20_000})], 's1');
  assert.equal(remoteSkipTarget(report, -30, 7200), 0);
  assert.equal(remoteSkipTarget(report, 30, 7200), 50);
  assert.equal(remoteSkipTarget(report, 30, 40), 40);
  assert.equal(remoteSkipTarget(report, 30, 0), 50);
  assert.equal(remoteSkipTarget(undefined, 30, 7200), undefined, 'no reported position, no skip');
});
