/**
 * A device that can no longer read its saved records (the system lost the key that protects
 * them, and cannot say so for certain) removes nothing on its own. The app looks twice, then asks
 * the person; only their confirmation resets the device, and the app starts again afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NativeModules} from './react-native-stub.mjs';
import {SECOND_LOOK_MS, SECURE_RECORDS_KEY_LOST, canResetSecureRecords, isSecureRecordsLost, prepareSecureRecords, resetSecureRecords, restartApp} from '../src/bridge/secure-records.ts';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const lost = () => Object.assign(new Error('lost'), {code: SECURE_RECORDS_KEY_LOST});
const runtime = NativeModules.PorticoRuntime as Record<string, unknown>;
function withRuntime(methods: Record<string, unknown>, run: () => Promise<void>) {
  const before: Record<string, unknown> = {};
  for (const name of ['prepareSecureRecords', 'resetSecureRecords', 'restart']) { before[name] = runtime[name]; delete runtime[name]; }
  Object.assign(runtime, methods);
  return run().finally(() => { for (const name of Object.keys(before)) { if (before[name] === undefined) delete runtime[name]; else runtime[name] = before[name]; } });
}

test('a key that answers on the second look is not reported lost', () => withRuntime({}, async () => {
  let calls = 0;
  const waits: number[] = [];
  runtime.prepareSecureRecords = async () => { if (++calls === 1) throw lost(); return false; };
  assert.equal(await prepareSecureRecords(async ms => { waits.push(ms); }), false);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [SECOND_LOOK_MS]);
}));

test('a key that is still gone on the second look is reported lost', () => withRuntime({}, async () => {
  let calls = 0;
  runtime.prepareSecureRecords = async () => { calls++; throw lost(); };
  await assert.rejects(prepareSecureRecords(async () => {}), error => isSecureRecordsLost(error));
  assert.equal(calls, 2);
}));

test('any other storage failure is not looked at twice and is not a lost key', () => withRuntime({}, async () => {
  let calls = 0;
  runtime.prepareSecureRecords = async () => { calls++; throw Object.assign(new Error('busy'), {code: 'secure_storage'}); };
  await assert.rejects(prepareSecureRecords(async () => { assert.fail('no second look'); }), error => !isSecureRecordsLost(error));
  assert.equal(calls, 1);
}));

test('a store that reset itself says so', () => withRuntime({prepareSecureRecords: async () => true}, async () => {
  assert.equal(await prepareSecureRecords(), true);
}));

test('a runtime with no reset cannot be asked to reset, and nothing is claimed', () => withRuntime({}, async () => {
  assert.equal(canResetSecureRecords(), false);
  await assert.rejects(resetSecureRecords());
  assert.equal(await restartApp(), false);
}));

test('a confirmed reset reports whether anything was removed, and a failed one rejects', () => withRuntime({}, async () => {
  runtime.resetSecureRecords = async () => true;
  assert.equal(canResetSecureRecords(), true);
  assert.equal(await resetSecureRecords(), true);
  runtime.resetSecureRecords = async () => false;
  assert.equal(await resetSecureRecords(), false);
  runtime.resetSecureRecords = async () => { throw Object.assign(new Error('keystore'), {code: 'secure_storage'}); };
  await assert.rejects(resetSecureRecords());
  runtime.restart = async () => true;
  assert.equal(await restartApp(), true);
  runtime.restart = async () => { throw new Error('no host'); };
  assert.equal(await restartApp(), false);
}));

test('Android reports a lost key without removing anything, and resets only when asked', () => {
  const store = source('android/app/src/main/java/tv/getportico/portico/native/PorticoRecordStore.kt');
  // Before Android 12 a missing key with records present is reported, never acted on.
  assert.match(store, /if \(Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.S\) throw RecordKeyLostException\(\)/);
  assert.match(store, /catch \(e: UnrecoverableKeyException\) \{ if \(hasRecords\(\)\) throw RecordKeyLostException\(\) else throw e \}/);
  const confirmed = store.slice(store.indexOf('fun resetAfterConfirmation'), store.indexOf('fun <T> transaction'));
  // The key is looked at again before anything is removed; a key that answers removes nothing.
  assert.ok(confirmed.indexOf('if (!keyLost())') > 0 && confirmed.indexOf('if (!keyLost())') < confirmed.lastIndexOf('resetLostRecords()'));
  assert.match(confirmed, /if \(!keyLost\(\)\) \{ keyChecked = true; return false \}/);
  // Deciding the key is lost never swallows an unknown failure.
  const lostCheck = confirmed.slice(confirmed.indexOf('private fun keyLost'));
  assert.doesNotMatch(lostCheck, /catch \(_?:? ?(?:e: )?Exception\)/);
  const runtimeSource = source('android/app/src/main/java/tv/getportico/portico/native/PorticoRuntime.kt');
  assert.match(runtimeSource, /catch \(_: RecordKeyLostException\) \{ promise\.reject\("secure_records_key_lost"/);
  assert.match(runtimeSource, /fun resetSecureRecords\(promise: Promise\)/);
  assert.match(runtimeSource, /fun restart\(promise: Promise\)/);
});

test('the sign-in screens show the reset in place of sign-in, and only a confirmation resets', () => {
  const flow = source('src/screens/auth/AuthFlow.tsx');
  assert.ok(flow.indexOf('if (session.deviceReset) return <DeviceReset />') < flow.indexOf('if (session.direct.pending) return <DirectProfiles'));
  const screen = source('src/screens/auth/DeviceReset.tsx');
  assert.match(screen, /<ConfirmSheet/);
  // The reset itself is only ever called from the confirmation.
  assert.equal(screen.split('reset.reset()').length - 1, 1);
  assert.ok(screen.indexOf('reset.reset()') > screen.indexOf('onConfirm='));
});
