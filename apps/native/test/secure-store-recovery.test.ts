import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('secure store recovery distinguishes lost keys from ambiguous storage failures', () => {
  const native = source('android/app/src/main/java/tv/getportico/portico/native/PorticoRecordStore.kt');
  assert.match(native, /catch \(e: KeyPermanentlyInvalidatedException\)/);
  assert.match(native, /existing == null/);
  assert.match(native, /if \(keystore.containsAlias\(KEY_ALIAS\)\) throw/);
  assert.doesNotMatch(native, /catch \(_?:? ?(?:e: )?Exception\) \{\s*resetLostRecords/);
  assert.doesNotMatch(native, /AEADBadTagException/);
  const reset = native.slice(native.indexOf('private fun resetLostRecords'), native.indexOf('private fun key('));
  assert.ok(reset.indexOf('mark(resetPending)') < reset.indexOf('root.deleteRecursively()'));
  assert.ok(reset.indexOf('root.deleteRecursively()') < reset.indexOf('keystore.deleteEntry(KEY_ALIAS)'));
  assert.match(reset, /mark\(resetNotice\)/);
  assert.match(reset, /check\(resetPending.delete\(\)\)/);
});

test('both runtime contracts prepare secure records before installation identity is used', () => {
  assert.match(source('android/app/src/main/java/tv/getportico/portico/native/PorticoRuntime.kt'), /fun prepareSecureRecords\(promise: Promise\)/);
  assert.match(source('Native/PorticoPlayer.m'), /RCT_REMAP_METHOD\(prepareSecureRecords/);
  const session = source('src/app/session.tsx');
  assert.ok(session.indexOf('await NativeModules.PorticoRuntime.prepareSecureRecords()') < session.indexOf('Promise.all([profileInstallation()'));
  assert.match(session, /secureRecordsRecovered/);
});
