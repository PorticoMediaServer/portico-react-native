/** Server invitation links open the join screen with the code and the server, and nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJoinLink, isLegacyInvite} from '../src/app/join-link.ts';

const code = 'I'.repeat(43);
test('a join link names the code and the inviting server', () => {
  assert.deepEqual(parseJoinLink(`portico://join#code=${code}&server=https%3A%2F%2Fdemo%2Egetportico%2Etv`), {code, server: 'https://demo.getportico.tv'});
  assert.deepEqual(parseJoinLink(`portico://join#server=http%3A%2F%2F192.168.1.20%3A32500%2F&code=${code}`), {code, server: 'http://192.168.1.20:32500'});
});
test('anything malformed is not a join link', () => {
  assert.equal(parseJoinLink(`portico://join#code=short&server=https%3A%2F%2Fdemo.getportico.tv`), undefined);
  assert.equal(parseJoinLink(`portico://join#code=${code}`), undefined);
  assert.equal(parseJoinLink(`portico://join#code=${code}&server=javascript%3Aalert(1)`), undefined);
  assert.equal(parseJoinLink(`portico://join#code=${code}&server=https%3A%2F%2Fu%3Ap%40demo.getportico.tv`), undefined);
  assert.equal(parseJoinLink(`portico://join#code=${code}&server=https%3A%2F%2Fdemo.getportico.tv&x=1`), undefined);
  assert.equal(isLegacyInvite('portico://invite#invite=abc.def'), true);
});
