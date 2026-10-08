import test from 'node:test';
import assert from 'node:assert/strict';
import {listedServers} from '../src/bridge/server-list-cache.ts';

test('the Apple chooser retains every valid server beyond row 500', () => {
  const rows = Array.from({length: 551}, (_, i) => ({id: `server-${i}`, name: `Server ${i}`, baseUrl: 'https://server.test', publicKey: 'key'}));
  const listed = listedServers(rows);
  assert.equal(listed.length, 551);
  assert.equal(listed[550]?.id, 'server-550');
});
