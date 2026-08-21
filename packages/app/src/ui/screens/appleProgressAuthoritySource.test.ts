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

test('Apple native continuation is the sole periodic progress authority', () => {
  const periodic = source.slice(
    source.indexOf('const reportProgress = useCallback('),
    source.indexOf('const changeNativeState = useCallback('),
  );
  expect(periodic).toContain("AVPlayer's continuation mailbox is the sole periodic progress");
  expect(periodic).not.toContain('client.touchPlayback');
});

test('terminal and shutdown writes retry stale sequence acknowledgements', () => {
  const completion = source.slice(
    source.indexOf('const commitPlaybackCompletion = useCallback('),
    source.indexOf('const handoffPreparedNext = useCallback('),
  );
  const shutdown = source.slice(
    source.indexOf('const shutdownPlayback = useCallback('),
    source.indexOf("viewerRuntime.register('playback'"),
  );
  expect(completion).toContain('if (!acknowledgement.stale) return false');
  expect(shutdown).toContain('if (!acknowledgement.stale) break');
  expect(completion).not.toContain('acknowledgement.stale\n        )');
});
