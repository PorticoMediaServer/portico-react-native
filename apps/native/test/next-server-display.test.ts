import test from 'node:test';
import assert from 'node:assert/strict';
import type {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import type {AppServerSession} from '../../../packages/client-core/src/app-sessions.ts';
import {NativeModules} from './react-native-stub.mjs';
import {readNativeServerDisplays, rememberNativeServerDisplay} from '../src-next/platform/server-display.ts';

const fingerprint = 'f'.repeat(43);
const saved = (serverId: string, pin = fingerprint) => ({signIn: 'local', connection: {pin: {serverId, fingerprint: pin}}}) as AppServerSession;
function fixture() {
  const records = new Map<string, string>(), requests: string[] = [];
  let name = 'Synthetic family room', serverId = 'server', current = true, fail = false;
  NativeModules.PorticoRuntime.loadQueueRecord = async (key: string) => records.get(key) ?? null;
  NativeModules.PorticoRuntime.saveQueueRecord = async (key: string, value: string) => {if (fail) throw new Error('native_locked'); records.set(key, value);};
  const route = {pin: {serverId: 'server', fingerprint}, getSnapshot: () => ({phase: 'ready'})};
  const api = {getRouteConnection: () => route, request: async (path: string) => {
    requests.push(path);
    return {id: serverId, name, version: '1', signIn: 'local', setupRequired: false, hostedConfigured: false, hostedAttached: false};
  }} as unknown as HttpLocalApi;
  const remember = () => rememberNativeServerDisplay(api, {serverId: 'server', signIn: 'local', isCurrent: () => current});
  return {records, requests, remember, name(value: string) {name = value;}, server(value: string) {serverId = value;},
    current(value: boolean) {current = value;}, fail(value: boolean) {fail = value;}};
}

test('native display names survive a new reader without address or credential fallbacks', async () => {
  const f = fixture(); await f.remember();
  assert.deepEqual(await readNativeServerDisplays([saved('server')]), [{serverId: 'server', fingerprint, name: 'Synthetic family room'}]);
  assert.deepEqual(f.requests, ['/v1/system']);
  assert.doesNotMatch([...f.records.values()].join(''), /https?:|accessToken|refreshToken|sessionFamilyId/);
  await assert.rejects(readNativeServerDisplays([saved('server', 'x'.repeat(43))]), {code: 'invalid_saved_connection'});
  await assert.rejects(readNativeServerDisplays([saved('uncached')]), {code: 'invalid_saved_connection'});
});

test('verified server mismatch and cancelled scope cannot publish another name', async () => {
  const f = fixture(); await f.remember(); const before = new Map(f.records);
  f.server('different_server'); f.name('Different server');
  await assert.rejects(f.remember(), {code: 'invalid_saved_connection'});
  assert.deepEqual(f.records, before);
  f.server('server'); f.current(false);
  await assert.rejects(f.remember(), {name: 'AbortError'});
  assert.deepEqual(f.records, before);
});

test('failed native name replacement retains the last exact server name', async () => {
  const f = fixture(); await f.remember(); const before = new Map(f.records);
  f.name('Renamed synthetic room'); f.fail(true);
  await assert.rejects(f.remember(), /native_locked/);
  assert.deepEqual(f.records, before);
  f.fail(false); await f.remember();
  assert.equal((await readNativeServerDisplays([saved('server')]))[0].name, 'Renamed synthetic room');
});

test('corrupt native display metadata is refused without reinterpreting it as a server address', async () => {
  const f = fixture(); f.records.set('accounts.server-names.v1', '{');
  await assert.rejects(readNativeServerDisplays([saved('server')]), {code: 'invalid_saved_connection'});
  assert.equal(f.records.get('accounts.server-names.v1'), '{');
  assert.deepEqual(f.requests, []);
});
