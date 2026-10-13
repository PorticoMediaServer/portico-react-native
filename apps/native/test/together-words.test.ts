/** Watch Together: what the room says, and who may take the host's place. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {currentTitle, groupEndedReason, groupStateLabel, mayBeMadeHost, mayClaimHost, memberName, memberStatus, readinessLine} from '../src/app/together-words.ts';

const t = defaultI18n.t;
const member = (o: Partial<{state: 'joined' | 'left'; presence: 'connected' | 'away' | 'disconnected'; readiness: 'ready' | 'buffering' | 'lagging'; role: 'host' | 'member'}> = {}) => ({state: 'joined' as const, presence: 'connected' as const, readiness: 'ready' as const, role: 'member' as const, ...o});
const group = (o: {isHost?: boolean; presence?: 'connected' | 'reconnecting' | 'absent'; pauseAt?: string | null} = {}) => ({permissions: {isHost: !!o.isHost, canControl: false, canManageQueue: false}, host: {presence: o.presence ?? 'absent', lastSeenAt: '2026-10-13T10:00:00Z', pauseAt: o.pauseAt === undefined ? '2026-10-13T10:02:00Z' : o.pauseAt, endAt: null}});
const at = (iso: string) => Date.parse(iso);

test('a group holding for everyone after a seek or a new title says it is waiting', () => {
  assert.equal(groupStateLabel(t, 'waiting'), 'Waiting for everyone');
  assert.equal(groupStateLabel(t, 'playing'), 'Playing');
  assert.equal(groupStateLabel(t, 'degraded'), 'Playing');
  assert.equal(groupStateLabel(t, 'paused'), 'Paused');
  assert.equal(groupStateLabel(t, 'host-reconnecting-paused'), 'Host reconnecting');
  assert.equal(groupStateLabel(t, 'failed'), 'Ended');
});

test('a title this viewer may not see is a hidden title, never "nothing chosen"', () => {
  assert.equal(currentTitle({itemId: 'itm_1', currentEntryId: 'e1'}), 'chosen');
  assert.equal(currentTitle({itemId: '', currentEntryId: 'e1'}), 'hidden');
  assert.equal(currentTitle({itemId: '', currentEntryId: ''}), 'none');
});

test('readiness and endings are said in the catalogue’s words', () => {
  assert.equal(readinessLine(t, {aggregate: 'ready', ready: 3, buffering: 0, lagging: 0, stale: 0, memberCount: 3}), 'Everyone is ready.');
  assert.equal(readinessLine(t, {aggregate: 'ready', ready: 1, buffering: 0, lagging: 0, stale: 0, memberCount: 1}), 'Ready');
  assert.equal(readinessLine(t, {aggregate: 'buffering', ready: 2, buffering: 1, lagging: 0, stale: 0, memberCount: 3}), '2 of 3 ready · waiting for one person');
  assert.equal(readinessLine(t, {aggregate: 'lagging', ready: 1, buffering: 1, lagging: 1, stale: 1, memberCount: 4}), '1 of 4 ready · waiting for 3 people');
  assert.equal(groupEndedReason(t, 'host-ended'), 'The host ended the group.');
  assert.equal(groupEndedReason(t, 'something-new'), 'The group is over.');
  assert.equal(memberStatus(t, {presence: 'away', readiness: 'ready'}), 'Away');
  assert.equal(memberStatus(t, {presence: 'connected', readiness: 'lagging'}), 'Catching up');
});

test('someone who keeps their activity private is listed without a name', () => {
  assert.equal(memberName(t, {private: true, displayName: 'Viewer'}), 'Private viewer');
  assert.equal(memberName(t, {private: false, displayName: 'Sam'}), 'Sam');
});

test('the host role goes only to someone connected and in step', () => {
  assert.equal(mayBeMadeHost(member()), true);
  assert.equal(mayBeMadeHost(member({presence: 'away'})), false);
  assert.equal(mayBeMadeHost(member({readiness: 'buffering'})), false);
  assert.equal(mayBeMadeHost(member({state: 'left'})), false);
  assert.equal(mayBeMadeHost(member({role: 'host'})), false);
});

test('a member may take the host’s place only after the host has been silent for the whole wait', () => {
  assert.equal(mayClaimHost(group(), member(), at('2026-10-13T10:00:30Z')), false, 'thirty seconds is too soon');
  assert.equal(mayClaimHost(group(), member(), at('2026-10-13T10:02:00Z')), true);
  assert.equal(mayClaimHost(group(), member({readiness: 'lagging'}), at('2026-10-13T10:03:00Z')), false);
  assert.equal(mayClaimHost(group({presence: 'connected'}), member(), at('2026-10-13T10:03:00Z')), false, 'the host is back');
  assert.equal(mayClaimHost(group({isHost: true}), member({role: 'host'}), at('2026-10-13T10:03:00Z')), false);
  assert.equal(mayClaimHost(group({pauseAt: null}), member(), at('2026-10-13T10:03:00Z')), false, 'with no deadline from the server nothing is offered');
  assert.equal(mayClaimHost(group(), undefined, at('2026-10-13T10:03:00Z')), false);
});
