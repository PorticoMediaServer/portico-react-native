/**
 * A renewed sign-in publishes a new session object for the same person. A screen's services are
 * keyed on the viewer scope, so the scope must stay the same object across a renewal and change
 * only when the person, the profile or the server does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerScope} from '../src/app/viewer-scope.ts';

const api = {baseUrl: 'https://server.test'};
const session = (profileId: string, serverId = 'server-1', accessToken = 'a') => ({accessToken, viewer: {authority: 'local', accountId: 'account', profileId, serverId}});

test('a renewed sign-in keeps the same scope object', () => {
  const before = viewerScope(session('p1', 'server-1', 'first'), api);
  const after = viewerScope(session('p1', 'server-1', 'second'), api);
  assert.equal(after, before);
  assert.deepEqual(after, {viewerId: JSON.stringify(['local', 'account', 'p1']), serverId: 'server-1'});
});

test('another profile or another server is another scope', () => {
  const one = viewerScope(session('p1'), api);
  assert.notEqual(viewerScope(session('p2'), api), one);
  assert.notEqual(viewerScope(session('p1', 'server-2'), api), one);
  assert.equal(viewerScope(session('p1'), api), one);
});

test('nobody signed in is scoped to the address', () => {
  const none = viewerScope(undefined, api);
  assert.deepEqual(none, {viewerId: 'signed-out', serverId: 'https://server.test'});
  assert.equal(viewerScope(undefined, {baseUrl: 'https://server.test'}), none);
  assert.notEqual(viewerScope(undefined, {baseUrl: 'https://other.test'}), none);
});

test('the remembered scopes stay bounded', () => {
  const first = viewerScope(session('bound-0'), api);
  for (let i = 1; i < 200; i++) viewerScope(session(`bound-${i}`), api);
  // An evicted scope is rebuilt equal by value; nothing grows without limit.
  const again = viewerScope(session('bound-0'), api);
  assert.deepEqual(again, first);
});

test('the viewer key survives a renewed sign-in and is empty when signed out', async () => {
  const {viewerKey} = await import('../src/app/viewer-scope.ts');
  assert.equal(viewerKey(undefined, api), '');
  const before = viewerKey(session('p1', 'server-1', 'first'), api);
  assert.ok(before);
  assert.equal(viewerKey(session('p1', 'server-1', 'second'), api), before);
  assert.notEqual(viewerKey(session('p2'), api), before);
  assert.notEqual(viewerKey(session('p1', 'server-2'), api), before);
});
