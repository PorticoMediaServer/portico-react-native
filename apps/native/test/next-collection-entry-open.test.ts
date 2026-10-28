import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {NativeShellNavigation} from '../src-next/shell/routes.ts';
import {authorityKey, sameAuthority} from '../src-next/shell/model.ts';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime.ts';
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};

test('actual collection presenter sends its current member through the fenced primary playback', async () => {
  const song = {id: 'song', libraryId: 'library', kind: 'song', title: 'Song', playback: {itemId: 'song'}};
  let entries: any[] = [song]; const listeners = new Set<() => void>(), starts: any[] = [];
  class Controller {
    subscribe = (fn: () => void) => {listeners.add(fn); return () => listeners.delete(fn);};
    getSnapshot = () => ({entries}); open = async () => {}; dispose() {};
  }
  const {createNativeEntryActions} = await screenModule(new URL('../src-next/screens/destinations/entry-actions.ts', import.meta.url), {
    react: {...React, default: React}, './lifetime': {nativeDestinationLifetime}, '../read/reading-books-open': {openNativeReadingBookEntry: async () => false},
    '../native-screen-services': {nativeScreenServices: () => ({navigate() {assert.fail('song cannot route to title');}, reportError: assert.fail})},
    '../watch': {nativeWatchEntryMenu: () => undefined},
  });
  const {createNativeCollectionRenderer} = await screenModule(new URL('../src-next/screens/collections/register.tsx', import.meta.url), {
    react: {...React, default: React}, '../../shell/route-registry': {nativeShellRoutes: {registerRoute() {}}}, '../../shell/model': {authorityKey, sameAuthority},
    '../saved/selection': {createNativeCatalogueSelection: () => ({dispose() {}})},
    '../destinations/entry-actions': {createNativeEntryActions}, './controller': {NativeCollectionController: Controller}, './CollectionScreen': {NativeCollectionScreen: 'CollectionScreen'},
  });
  const navigation = new NativeShellNavigation(authority, () => authority);
  const route = {kind: 'collection' as const, libraryId: 'library', collectionId: 'collection', title: 'Collection'};
  navigation.open(route, authority);
  let resolve!: () => void;
  const context = {navigation, authority: () => authority, current: () => true, subscribeAuthority: navigation.subscribe,
    session: () => ({viewer: {...authority, authority: 'local'}}), api: {}, playback: {start: (input: any) => {starts.push(input); return new Promise<void>(done => {resolve = done;});}}};
  const renderer = createNativeCollectionRenderer(context), element = renderer.render(route, {reportError: assert.fail});
  let tree: any; const host = createHookHost(() => {tree = element.type(element.props);}); host.mount();
  try {
    tree.props.onOpen(song); assert.equal(starts.length, 1); assert.equal(starts[0].target, song.playback);
    entries = []; for (const notify of listeners) notify();
    assert.equal(starts[0].lifetime.signal.aborted, true);
    tree.props.onOpen(song); assert.equal(starts.length, 1);
  } finally {resolve(); host.unmount(); navigation.dispose();}
});
