import test from 'node:test';
import assert from 'node:assert/strict';
import {directEntryFor} from '../src/app/known-server-entry.ts';

const pin = {serverId: 'srv_a', publicKey: 'k', fingerprint: 'f'};
const hosted = {origin: 'https://hosted', accountId: 'acct', key: {keyId: 'id', publicKey: 'p'}};

test('a Portico member’s sign-in is one of “Your servers”, not a second direct entry', () => {
  assert.equal(directEntryFor({pin, hosted}, 'srv_a'), 'portico');
  assert.equal(directEntryFor({pin}, 'srv_a'), 'direct');
  assert.equal(directEntryFor({pin, hosted}, 'srv_other'), 'direct', 'only the server that record is for');
  assert.equal(directEntryFor(undefined, 'srv_a'), 'direct');
});
