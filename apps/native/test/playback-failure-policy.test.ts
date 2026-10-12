import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// Native SDKs are unavailable here. These guards check the reporting boundary, not device playback.
test('unknown native failures cannot become learned engine incompatibilities', () => {
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
  assert.match(apple, /\[error.domain isEqual:NSURLErrorDomain\]\)network=YES/);
  const classification = apple.slice(apple.indexOf('- (void)publishFailure:'), apple.indexOf('- (void)stalled:'));
  assert.doesNotMatch(classification, /AVErrorContentIsUnavailable/);
  assert.match(android, /fact\["engineCode"\] = if \(network\) "" else engine/);
  assert.match(apple, /@"engineCode":network\?@"":engine/);
});
