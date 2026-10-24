import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryFailure, directoryOfflineBody, directoryRows} from '../src-next/screens/accounts/directory-chooser';
import {defaultI18n} from '../../../packages/i18n/src';
import type {HostedServer, ServerPresence} from '../../../packages/client-core/src';

const now = Date.parse('2026-10-24T20:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();
const server = (id: string, presence?: ServerPresence): HostedServer => ({id, name: id, baseUrl: `https://${id}.test`, publicKey: 'key', policyRevision: 1, ...(presence ? {presence} : {})});
const unavailable = () => Object.assign(new Error('no route'), {code: 'server_unavailable'});

test('directory rows put online first, then last seen, then unknown, and dim only offline presence', () => {
  const recent = ago(5 * 60_000), stale = ago(2 * 60 * 60_000);
  const rows = directoryRows([
    server('online', {online: true, lastSeenAt: recent}),
    server('recent', {online: false, lastSeenAt: recent}),
    server('stale', {online: false, lastSeenAt: stale}),
    server('never', {online: false, lastSeenAt: null}),
    server('unknown'),
    server('current', {online: true, lastSeenAt: null}),
  ], 'current', now);
  assert.deepEqual(rows.map(row => row.id), ['online', 'current', 'recent', 'stale', 'never', 'unknown']);
  assert.deepEqual(rows.find(row => row.id === 'online')!.subtitle, {key: 'web.servers.online'});
  assert.deepEqual(rows.find(row => row.id === 'current')!.subtitle, {key: 'web.chooser.current'});
  assert.deepEqual(rows.find(row => row.id === 'recent')!.subtitle, {key: 'web.chooser.lastSeen', values: {date: defaultI18n.date(recent, 'dayMonth')}});
  assert.deepEqual(rows.find(row => row.id === 'stale')!.subtitle, {key: 'web.chooser.lastSeen', values: {date: defaultI18n.date(stale, 'dayMonth')}});
  assert.deepEqual(rows.find(row => row.id === 'never')!.subtitle, {key: 'web.chooser.neverSeen'});
  assert.equal(rows.find(row => row.id === 'unknown')!.subtitle, undefined);
  assert.deepEqual(rows.filter(row => row.offline).map(row => row.id), ['recent', 'stale', 'never']);
});

test('a connect attempt is opening only without an error, and only an unreachable failure waits or names an offline server', () => {
  const stale = server('stale', {online: false, lastSeenAt: ago(2 * 60 * 60_000)});
  const recent = server('recent', {online: false, lastSeenAt: ago(5 * 60_000)});
  assert.equal(directoryFailure(undefined, undefined, now), 'other');
  assert.equal(directoryFailure(stale, undefined, now), 'opening');
  assert.equal(directoryFailure(stale, Object.assign(new Error('denied'), {status: 403}), now), 'other');
  assert.equal(directoryFailure(stale, Object.assign(new Error('cancelled'), {name: 'AbortError'}), now), 'other');
  assert.equal(directoryFailure(stale, unavailable(), now), 'unreachable');
  assert.equal(directoryFailure(recent, unavailable(), now), 'waiting');
  assert.equal(directoryFailure(server('online', {online: true, lastSeenAt: ago(60_000)}), unavailable(), now), 'waiting');
  assert.equal(directoryFailure(server('unknown'), unavailable(), now), 'waiting');
});

test('the offline body names the last online date, or says it has never been online', () => {
  const staleAt = ago(2 * 60 * 60_000);
  assert.deepEqual(directoryOfflineBody(server('stale', {online: false, lastSeenAt: staleAt})),
    {key: 'web.chooser.unreachableBody', values: {date: defaultI18n.date(staleAt, 'dayMonth')}});
  assert.deepEqual(directoryOfflineBody(server('never', {online: false, lastSeenAt: null})), {key: 'web.chooser.unreachableBodyNever'});
  assert.deepEqual(directoryOfflineBody(server('unknown')), {key: 'web.chooser.unreachableBodyNever'});
});
