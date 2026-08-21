export {};
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: string): string;
  resolve(...paths: string[]): string;
};
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const source = readFileSync(
  resolve(__dirname, '../player/PlayerScreen.tsx'),
  'utf8',
);

test('route replacement keeps the player mounted and resumes at its live position', () => {
  expect(source).toContain('subscribeServerRouteChanges(change =>');
  expect(source).toContain('progressRef.current.positionSeconds');
  expect(source).toContain('value.resumePositionSeconds = positionSeconds');
  expect(source).toContain('isPlaying: progressRef.current.isPlaying');
  expect(source).toContain("productTitle('playback.reconnecting')");
});

test('native player failures request route recovery before becoming terminal', () => {
  const errorHandler = source.slice(
    source.indexOf('onError={failure => {'),
    source.indexOf('onInterruption={event =>'),
  );
  expect(errorHandler).toContain(
    "requestServerRouteRefresh({reason: 'route-failure'})",
  );
  const routeFailureBranch = errorHandler.slice(
    errorHandler.indexOf('const routeRecoveryEpoch'),
  );
  expect(routeFailureBranch.indexOf('requestServerRouteRefresh')).toBeLessThan(
    routeFailureBranch.indexOf('setPlaybackFailure'),
  );
});
