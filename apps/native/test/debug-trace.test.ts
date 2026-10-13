import test from 'node:test';
import assert from 'node:assert/strict';
import {trace, traceModule, useTrace} from '../src/app/debug.ts';
import {act, createHookHost} from './hook-driver.ts';

(globalThis as {__DEV__?: boolean}).__DEV__ = true;
test('bridge tracing never prints prefixes of string arguments or credential records', async () => {
  let lines: readonly string[] = [];
  const host = createHookHost(() => { lines = useTrace(); });
  host.mount();
  try {
    const module = {save: async (_text: string) => '{"accessToken":"short-secret"}'};
    traceModule('Runtime', module, ['save']);
    await act(async () => { await module.save('password-argument'); trace('failed refreshToken=short-refresh https://media.test/v1/media/short-grant/file'); });
    for (const secret of ['short-secret', 'password-argument', 'short-refresh', 'short-grant']) assert.equal(lines.join('\n').includes(secret), false, secret);
  } finally { host.unmount(); }
});
