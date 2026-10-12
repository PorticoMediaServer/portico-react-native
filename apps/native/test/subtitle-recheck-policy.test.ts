import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Android subtitle transport failures retain cues without renewing authorization', () => {
  const native = source('android/app/src/main/java/tv/getportico/portico/native/PorticoSubtitleSelection.kt');
  const transient = native.slice(native.indexOf('if (answer == null'), native.indexOf('// 304'));
  assert.doesNotMatch(transient, /cues = null|authorizedUntil =/);
  assert.match(transient, /tick\(positionUs\)/);
  assert.match(native, /code in 500\.\.599/);
  assert.match(native, /if \(answer.failure != null \|\| answer.body == null\) \{\s*cues = null\s*authorizedUntil = 0/);
  assert.match(native, /SystemClock.elapsedRealtime\(\) > authorizedUntil/);
});

test('Apple subtitle transport failures retain cues only under the existing grant', () => {
  const native = source('Native/PorticoSubtitleSelection.m');
  const completion = native.slice(native.indexOf('- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:'));
  assert.match(completion, /if\(_failed\|\|error\)\{_bytes=nil;\[self tick:_time\]/);
  assert.match(native, /http.statusCode>=500&&http.statusCode<=599/);
  assert.match(native, /_cues=nil;_authorizedUntil=0;\[self setText:@""\]/);
  assert.match(native, /systemUptime>_authorizedUntil/);
});
