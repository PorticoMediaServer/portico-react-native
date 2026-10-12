import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// Native SDKs are unavailable here. These guards check the reporting boundary, not device playback.
test('generic engine classes are not used to learn native incompatibilities', () => {
  const android = source('android/app/src/main/java/tv/getportico/portico/native/PorticoPlaybackController.kt');
  const apple = source('Native/PorticoPlaybackController.m');
  assert.doesNotMatch(android, /else -> "engine_error"/);
  assert.doesNotMatch(apple, /NSString \*engine=@"engine_error"/);
  assert.doesNotMatch(source('src/player/usePlayer.ts'), /\['decode_error', 'source_not_supported', 'engine_error'\]/);
});

test('transport failures take precedence over decoder evidence on both platforms', () => {
  const android = source('android/app/src/main/java/tv/getportico/portico/native/PorticoPlaybackController.kt');
  for (const code of ['IO_UNSPECIFIED', 'IO_BAD_HTTP_STATUS', 'IO_INVALID_HTTP_CONTENT_TYPE', 'IO_FILE_NOT_FOUND', 'IO_NO_PERMISSION', 'IO_CLEARTEXT_NOT_PERMITTED', 'IO_READ_POSITION_OUT_OF_RANGE']) {
    assert.match(android, new RegExp('PlaybackException.ERROR_CODE_' + code));
  }
  const apple = source('Native/PorticoPlaybackController.m');
  assert.match(apple, /\[error.domain isEqual:NSURLErrorDomain\]\)\{/);
  const classification = apple.slice(apple.indexOf('- (void)publishFailure:'), apple.indexOf('- (void)stalled:'));
  assert.match(classification, /AVErrorContentIsUnavailable\)delivery=YES/);
  assert.match(android, /fact\["engineCode"\] = if \(network \|\| delivery\) "" else engine/);
  assert.match(apple, /@"engineCode":\(network\|\|delivery\)\?@"":engine/);
});

test('native startup and wrapped HTTP evidence reaches the shared failure policy', () => {
  const android = source('android/app/src/main/java/tv/getportico/portico/native/PorticoPlaybackController.kt');
  const apple = source('Native/PorticoPlaybackController.m');
  assert.match(android, /HttpDataSource.InvalidResponseCodeException/);
  assert.match(android, /fact\["hasPlayed"\] = hasPlayed/);
  assert.match(android, /onRenderedFirstFrame\(\) \{ hasPlayed = true/);
  assert.match(apple, /error.code==-12938\)return 404/);
  assert.match(apple, /error.code==-12660\)return 403/);
  assert.match(apple, /PorticoHTTPStatusInComment\(log.errorComment\)/);
  assert.match(apple, /@"hasPlayed":@\(_hasPlayed\)/);
  assert.match(apple, /displayReadyForLease:[^\n]+_hasPlayed=YES/);
  assert.match(source('src/player/usePlayer.ts'), /const failure = classifyPlaybackFailure\(f\)/);
});
