import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createHookHost} from './hook-driver.ts';
import {useAccountDirectory} from '../src/bridge/useAccountDirectory.ts';
import {NativeModules} from './react-native-stub.mjs';

test('a directory lookup cannot send another account\'s credential after ownership changes', async () => {
  NativeModules.PorticoRuntime.loadQueueRecord = async () => null;
  NativeModules.PorticoRuntime.saveQueueRecord = async () => {};
  let resolve!: (value: any) => void;
  const held = new Promise<any>(done => {resolve = done;});
  const credentials = {accessSession: () => held, getSnapshot: () => ({}), subscribe: () => () => {}};
  let account = 'first', enabled = true;
  const sent: string[] = [];
  const fetcher: typeof fetch = async (_input, options) => {
    sent.push(new Headers(options?.headers).get('Authorization') ?? '');
    return new Response(JSON.stringify({items: [], version: '1', watch: 'hint'}), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  const host = createHookHost(() => {useAccountDirectory({credentials: credentials as never, snapshot: {phase: 'signedIn', session: {account: {id: account}}} as never, origin: 'https://account.test', enabled, fetcher});});
  try {
    await act(() => host.mount());
    account = 'second'; enabled = false;
    await act(() => host.rerender());
    await act(() => resolve({accessToken: 'replacement-token', account: {id: 'second'}}));
    assert.deepEqual(sent, [], 'the retired directory never dispatches the replacement bearer');
  } finally {host.unmount();}
});
