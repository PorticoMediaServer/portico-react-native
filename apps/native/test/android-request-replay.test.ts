import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Android writes disable connection replay and mark every body as one-shot', () => {
  const native = readFileSync(new URL('../android/app/src/main/java/tv/getportico/portico/native/PorticoTransport.kt', import.meta.url), 'utf8');
  assert.match(native, /retryOnConnectionFailure\(false\)/);
  assert.match(native, /request.method in setOf\("GET", "HEAD"\) && request.body == null/);
  assert.match(native, /override fun isOneShot\(\): Boolean = true/);
  assert.match(native, /override fun contentLength\(\): Long = data.size.toLong\(\)/);
  assert.match(native, /sink.write\(data\)/);
  assert.doesNotMatch(native, /toRequestBody/);
  assert.match(native, /"GET", "HEAD" -> null\s*else -> body \?: ByteArray\(0\)/, 'even an empty mutation gets a one-shot body');
});
