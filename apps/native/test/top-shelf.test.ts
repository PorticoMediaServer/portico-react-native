/** The home-screen shelf is fed by a token the app renews when two-thirds used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeModules} from 'react-native';

const calls: {name: string; args: unknown[]}[] = [];
let held: {baseUrl: string; expiresAt: string} | null = null;
(NativeModules as Record<string, unknown>).PorticoTopShelf = {
  configure: async (...args: unknown[]) => {
    calls.push({name: 'configure', args});
  },
  expiresAt: async () => held,
  clear: async () => {
    calls.push({name: 'clear', args: []});
  },
  changed: () => {
    calls.push({name: 'changed', args: []});
  },
};

const {refreshTopShelf, clearTopShelf, topShelfChanged} = await import('../src/app/top-shelf.ts');

const api = (token: unknown) => ({
  request: async () => token,
  mediaUrl: (path: string) => 'https://server.example' + path,
});

test('a fresh shelf costs no request', async () => {
  calls.length = 0;
  held = {baseUrl: 'https://server.example', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()};
  await refreshTopShelf(api({token: 'new', expiresAt: new Date().toISOString()}) as never, 'inst-1');
  assert.equal(calls.length, 0);
});

test('a stale shelf is renewed with the installation id', async () => {
  calls.length = 0;
  held = {baseUrl: 'https://server.example', expiresAt: new Date(Date.now() + 1000).toISOString()};
  let body: unknown;
  await refreshTopShelf(
    {
      request: async (_p: string, _m?: string, b?: unknown) => {
        body = b;
        return {token: 'tok', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()};
      },
      mediaUrl: (p: string) => 'https://server.example' + p,
    } as never,
    'inst-9',
  );
  assert.deepEqual(body, {installationId: 'inst-9'});
  assert.equal(calls[0].name, 'configure');
  assert.equal((calls[0].args as string[])[0], 'https://server.example');
  assert.equal((calls[0].args as string[])[1], 'tok');
});

test('a token without both fields configures nothing; a failure keeps the old shelf', async () => {
  calls.length = 0;
  held = null;
  await refreshTopShelf(api({token: 'only-token'}) as never, 'inst-1');
  assert.equal(calls.length, 0);
  await refreshTopShelf(
    {
      request: async () => {
        throw new TypeError('Failed to fetch');
      },
      mediaUrl: (p: string) => 'https://server.example' + p,
    } as never,
    'inst-1',
  );
  assert.equal(calls.length, 0);
  clearTopShelf();
  topShelfChanged();
  assert.deepEqual(calls.map((c) => c.name), ['clear', 'changed']);
});
