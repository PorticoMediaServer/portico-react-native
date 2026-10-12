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

test('the Apple classifier lets the outermost evidence decide and treats a socket error as the connection', () => {
  const apple = source('Native/PorticoPlaybackController.m');
  const classification = apple.slice(apple.indexOf('- (void)publishFailure:'), apple.indexOf('- (void)stalled:'));
  // The walk down the chain stops at the first error that says anything; nothing deeper overrides it.
  assert.match(classification, /i<4&&!network&&!delivery;/);
  assert.doesNotMatch(classification, /else if\(delivery\)network=NO/);
  // Only a missing or forbidden file is delivery; every other socket-level code is the connection.
  assert.match(classification, /error\.code==ENOENT\|\|error\.code==EACCES\|\|error\.code==EPERM\|\|error\.code==EISDIR\)delivery=YES;else network=YES;/);
  // A bad server response with no status is a failing server, not a permanent refusal.
  const permanent = apple.slice(apple.indexOf('static BOOL PorticoURLErrorIsPermanent'), apple.indexOf('static NSInteger PorticoErrorHTTPStatus'));
  assert.ok(permanent.length > 0);
  assert.doesNotMatch(permanent, /NSURLErrorBadServerResponse\)/);
  assert.match(permanent, /NSURLErrorFileDoesNotExist/);
});

test('the Apple error log is evidence only when fresh and when the engine named no fault', () => {
  const apple = source('Native/PorticoPlaybackController.m');
  const classification = apple.slice(apple.indexOf('- (void)publishFailure:'), apple.indexOf('- (void)stalled:'));
  assert.match(classification, /BOOL fresh=log!=nil&&!engine\.length&&log\.date!=nil&&fabs\(log\.date\.timeIntervalSinceNow\)<=15;/);
  assert.match(classification, /if\(!httpStatus&&fresh\)httpStatus=PorticoHTTPStatusInComment\(log.errorComment\)/);
  assert.match(classification, /fresh&&\[log\.errorDomain isEqual:NSURLErrorDomain\]/);
  assert.ok(classification.indexOf('NSString *engine=@""') < classification.indexOf('BOOL fresh='), 'the engine verdict is known before the log is consulted');
});

test('both runtimes mark a failure that is not about the media, so start-up does not report it', () => {
  const android = source('android/app/src/main/java/tv/getportico/portico/native/PorticoPlaybackController.kt');
  assert.match(android, /fact\["uncertain"\] = !network && !delivery && engine\.isEmpty\(\) && error\.errorCode in UNCERTAIN_ERRORS/);
  assert.match(android, /UNCERTAIN_ERRORS = setOf\(PlaybackException\.ERROR_CODE_TIMEOUT, PlaybackException\.ERROR_CODE_REMOTE_ERROR\)/);
  const apple = source('Native/PorticoPlaybackController.m');
  const classification = apple.slice(apple.indexOf('- (void)publishFailure:'), apple.indexOf('- (void)stalled:'));
  assert.match(classification, /BOOL uncertain=!network&&!delivery&&!httpStatus&&!engine\.length&&\(interrupted\|\|fresh\);/);
  assert.match(classification, /@"uncertain":@\(uncertain\)/);
  assert.match(source('src/player/playback-failure.ts'), /fact\.uncertain !== true/);
});
