/**
 * The saved server connection on this device. A read fails in two different ways: the store
 * cannot be read right now (locked, busy), which keeps the sign-in and is tried again; or the
 * record is there but can never be read (the native store says its bytes are not a record, or its
 * text is not JSON), which ends the sign-in at once. A damaged record is left where it is until
 * a new sign-in saves over it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NativeModules} from './react-native-stub.mjs';
import {savedConnectionDamaged, ACCESS_REFUSED} from '../../../packages/client-core/src/server-connections.ts';
import {NativeQueueStore} from '../src/bridge/queue-storage.ts';
import {nativeConnectionEnvironment} from '../src/bridge/server-connections.ts';
import {resumeEnding} from '../src/app/sign-in-ended.ts';

const KEY = 'network.selected.v1';
const storage = nativeConnectionEnvironment.storage;

/** The native record store: text per key, or a rejection with the native module's code. */
function device(initial: Record<string, string | {code: string}> = {}) {
  const records = new Map(Object.entries(initial));
  const saves: [string, string][] = [];
  Object.assign(NativeModules.PorticoRuntime, {
    async loadQueueRecord(key: string) {
      const found = records.get(key);
      if (found && typeof found === 'object') throw Object.assign(new Error('Queue recovery could not be read.'), found);
      return found ?? null;
    },
    async saveQueueRecord(key: string, json: string) { saves.push([key, json]); records.set(key, json); return true; },
  });
  return {records, saves};
}
const code = (e: unknown) => (e as {code?: unknown} | null)?.code;
const record = {version: '1', logicalOrigin: 'https://portico.test'};

test('a saved connection whose text is not JSON is reported as damaged, and nothing is written', async () => {
  const {saves} = device({[KEY]: '{"version":"1","logicalOri'});
  const failure = await storage.read().then(() => undefined, e => e);
  assert.equal(code(failure), 'invalid_saved_connection');
  assert.equal(savedConnectionDamaged(failure), true);
  assert.deepEqual(saves, []);
});

test('a saved connection the native store calls damaged is reported as damaged', async () => {
  const {saves} = device({[KEY]: {code: 'secure_record_damaged'}});
  const failure = await storage.read().then(() => undefined, e => e);
  assert.equal(savedConnectionDamaged(failure), true);
  assert.deepEqual(saves, []);
});

test('a store that cannot be read right now is not damage: the failure passes through and nothing is written', async () => {
  const {saves} = device({[KEY]: {code: 'secure_storage'}});
  const failure = await storage.read().then(() => undefined, e => e);
  assert.equal(code(failure), 'secure_storage');
  assert.equal(savedConnectionDamaged(failure), false);
  await assert.rejects(storage.change(() => record as never), e => code(e) === 'secure_storage');
  assert.deepEqual(saves, []);
});

test('a new sign-in saves over a damaged connection', async () => {
  for (const damaged of ['not json', {code: 'secure_record_damaged'}]) {
    const {records, saves} = device({[KEY]: damaged});
    let seen: unknown = 'unset';
    await storage.change(current => { seen = current; return record as never; });
    assert.equal(seen, undefined, 'the damaged record reads as absent');
    assert.deepEqual(saves, [[KEY, JSON.stringify(record)]]);
    assert.deepEqual(await storage.read(), record);
    assert.equal(records.get(KEY), JSON.stringify(record));
  }
});

test('a change that saves nothing leaves a damaged connection exactly as it is', async () => {
  const {records, saves} = device({[KEY]: 'not json'});
  await storage.change(current => current);
  await storage.change(() => undefined);
  assert.deepEqual(saves, []);
  assert.equal(records.get(KEY), 'not json');
  assert.equal(savedConnectionDamaged(await storage.read().then(() => undefined, e => e)), true);
});

test('a readable connection still reads, updates and clears as before', async () => {
  const {records, saves} = device({[KEY]: JSON.stringify(record)});
  assert.deepEqual(await storage.read(), record);
  await storage.change(current => current);
  assert.deepEqual(saves, [], 'an unchanged record is not rewritten');
  await storage.change(current => ({...current!, logicalOrigin: 'https://other.test'}) as never);
  assert.equal(records.get(KEY), JSON.stringify({...record, logicalOrigin: 'https://other.test'}));
  await storage.change(() => undefined);
  assert.equal(records.get(KEY), 'null');
  assert.equal(await storage.read(), undefined);
});

test('other records in the same store keep their own failures', async () => {
  device({'setup:hosted': 'not json', 'queue.id': {code: 'secure_record_damaged'}});
  const store = new NativeQueueStore();
  await assert.rejects(store.change('setup:hosted', raw => ({record: raw, value: raw})), SyntaxError);
  await assert.rejects(store.change('queue.id', raw => ({record: raw, value: raw})), e => code(e) === 'secure_record_damaged');
});

test('a damaged saved connection ends the sign-in when the app resumes it; an unreadable store does not', () => {
  assert.equal(resumeEnding(Object.assign(new Error('damaged'), {code: 'invalid_saved_connection'}), false, ACCESS_REFUSED), 'ended');
  assert.equal(resumeEnding(Object.assign(new Error('locked'), {code: 'secure_storage'}), false, ACCESS_REFUSED), undefined);
});

test('both native stores answer a damaged record with the same code, apart from one they cannot read now', () => {
  const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const android = source('android/app/src/main/java/tv/getportico/portico/native/PorticoRuntime.kt');
  const load = android.slice(android.indexOf('fun loadQueueRecord'), android.indexOf('fun saveQueueRecord'));
  assert.match(load, /store\.damaged\(PorticoRecordStore\.QUEUES, key\)\) promise\.reject\("secure_record_damaged"/);
  const records = source('android/app/src/main/java/tv/getportico/portico/native/PorticoRecordStore.kt');
  const damaged = records.slice(records.indexOf('fun damaged('), records.indexOf('/** Saves [bytes]'));
  assert.ok(damaged.length > 0);
  // Decided from the file alone: the Keystore, which can fail for a while, is never asked.
  assert.doesNotMatch(damaged, /key\(|Cipher|recoverLostKey|delete/);
  const apple = source('Native/PorticoPlayer.m');
  const appleLoad = apple.slice(apple.indexOf('RCT_REMAP_METHOD(loadQueueRecord'), apple.indexOf('RCT_REMAP_METHOD(saveQueueRecord'));
  assert.match(appleLoad, /status==errSecSuccess&&[^;]*reject\(@"secure_record_damaged"/);
});
