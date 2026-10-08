import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteLink} from '../src/app/invite-link.ts';
import {parseJoinLink} from '../src/app/join-link.ts';

test('an invitation link carries the code and the server in the fragment, and the app reads it back', () => {
  const code = 'C'.repeat(43);
  const link = inviteLink('https://web.getportico.tv', 'http://192.168.1.20:32500/', code);
  assert.equal(link, `https://web.getportico.tv/join#code=${code}&server=http%3A%2F%2F192.168.1.20%3A32500`);
  // What the native route hands the app (the fragment moved to portico://join).
  assert.deepEqual(parseJoinLink('portico://join#' + link.split('#')[1]), {code, server: 'http://192.168.1.20:32500'});
});
