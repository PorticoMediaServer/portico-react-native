import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeShellNavigation, channelRoute, nativeRailDestination, titleRoute} from '../src-next/shell/routes';
import type {ShellAuthority} from '../src-next/shell/model';
import type {HomeChannel} from '../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../packages/client-core/src/library-content';

const authority: ShellAuthority = {serverId: 's', accountId: 'a', profileId: 'p', epoch: 'e', viewerFence: 'v'};

test('navigation starts on Home with the same destination used by the initial shell route', () => {
  const routes = new NativeShellNavigation(authority, () => authority);
  const initial = routes.getSnapshot();
  assert.deepEqual(initial, {authority, route: {kind: 'shell', destination: {kind: 'home'}}, destination: {kind: 'home'}, revision: 0});
  assert.equal(initial.route.kind, 'shell');
  if (initial.route.kind === 'shell') assert.strictEqual(initial.route.destination, initial.destination);
  assert.equal(routes.back(authority), false);
  assert.strictEqual(routes.getSnapshot(), initial);
});

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

test('a Home title highlights its own authorized library while Back retains the mounted Home destination', () => {
  const routes = new NativeShellNavigation(authority, () => authority);
  const origin = routes.getSnapshot().destination;
  const entry: ContentEntry = {id: 'film', libraryId: 'movies', kind: 'movie', title: 'Film'};
  routes.open(titleRoute(entry), authority);
  assert.deepEqual(nativeRailDestination(routes.getSnapshot(), [{id: 'movies'}]), {kind: 'library', libraryId: 'movies'});
  assert.strictEqual(routes.getSnapshot().destination, origin, 'highlighting does not replace/unmount Home');
  assert.strictEqual(nativeRailDestination(routes.getSnapshot(), [{id: 'another-library'}]), origin, 'an unauthorized library is never inferred');
  assert.equal(routes.back(authority), true);
  assert.strictEqual(routes.getSnapshot().destination, origin);
  assert.strictEqual(nativeRailDestination(routes.getSnapshot(), [{id: 'movies'}]), origin);
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
