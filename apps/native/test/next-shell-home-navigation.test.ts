import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeShellNavigation, channelRoute, titleRoute} from '../src-next/shell/routes';
import type {ShellAuthority} from '../src-next/shell/model';
import type {HomeChannel} from '../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../packages/client-core/src/library-content';

const authority: ShellAuthority = {serverId: 's', accountId: 'a', profileId: 'p', epoch: 'e', viewerFence: 'v'};

test('title requests preserve actual aggregate identity and authoritative nested navigation', () => {
  const entry: ContentEntry = {id: 'show', libraryId: 'l', kind: 'show', title: 'show', navigation: {view: 'show', entityId: 'show'}, playback: {itemId: 'episode'}};
  const route = titleRoute(entry);
  assert.equal(route.kind, 'title');
  if (route.kind === 'title') assert.strictEqual(route.entry, entry);
});

test('channel routes keep source and channel identity without manufacturing a catalogue library', () => {
  const item = {source: {id: 'source'}, channel: {id: 'channel', sourceId: 'source'}} as HomeChannel;
  assert.deepEqual(channelRoute(item), {kind: 'channel', sourceId: 'source', channelId: 'channel'});
});

test('a stale viewer cannot navigate, back into, or publish a former private route', () => {
  let current = authority;
  const routes = new NativeShellNavigation(authority, () => current);
  let publications = 0;
  routes.subscribe(() => publications++);
  assert.equal(routes.open({kind: 'profiles', profileId: 'p'}, authority), true);
  current = {...authority, viewerFence: 'revoked'};
  assert.equal(routes.open({kind: 'notifications'}, authority), false);
  assert.equal(routes.back(authority), false);
  assert.equal(publications, 1);
  routes.dispose();
});

test('Back returns through actual requests and disposal invalidates subsequent callers', () => {
  const routes = new NativeShellNavigation(authority, () => authority);
  routes.open({kind: 'servers'}, authority);
  routes.open({kind: 'account'}, authority);
  assert.equal(routes.back(authority), true);
  assert.deepEqual(routes.getSnapshot().route, {kind: 'servers'});
  assert.equal(routes.back(authority), true);
  assert.deepEqual(routes.getSnapshot().route, {kind: 'shell', destination: {kind: 'home'}});
  assert.equal(routes.back(authority), false);
  routes.dispose();
  assert.equal(routes.open({kind: 'account'}, authority), false);
});
