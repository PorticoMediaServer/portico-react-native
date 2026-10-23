import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {NativeLibraryDestination} from '../src-next/screens/library/model.ts';
import {NativeLibraryDirectory} from '../src-next/screens/library/directory.ts';
import {nativeDestinationLifetime} from '../src-next/screens/destinations/lifetime.ts';

test('the Library descriptor requires the actual authorized ID and never supplies a fake selection port', async () => {
  const {createNativeLibraryRenderer} = await screenModule(new URL('../src-next/screens/library/index.tsx', import.meta.url), {
    react: {default: React}, './LibraryScreen': {LibraryScreen: 'LibraryScreen'}, './model': {NativeLibraryDestination}, './directory': {NativeLibraryDirectory},
    '../destinations/lifetime': {nativeDestinationLifetime},
  });
  const viewer = {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', role: 'owner'};
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'session-epoch', viewerFence: 'home-only-fence'};
  let libraries = [{id: 'real-id', name: 'Movies', kind: 'movie'}], current = true;
  const context = {api: {request: async () => {throw new Error('rendering a descriptor must not start a producer');}}, session: () => ({viewer}), authority: () => authority,
    current: () => current, libraries: () => libraries};
  const activation = {subscribe: () => () => {}, getSnapshot: () => ({visible: true, intent: 'enter', revision: 1})};
  const renderer = createNativeLibraryRenderer(context, {activation: () => activation, labels: {}, actions: {}});
  try {
    assert.equal(renderer.render({kind: 'shell', destination: {kind: 'library', libraryId: 'Movies'}}, {}), null, 'a name cannot substitute for the actual ID');
    const element = renderer.render({kind: 'shell', destination: {kind: 'library', libraryId: 'real-id'}}, {});
    assert.equal(element.props.destination.getSnapshot().library.id, 'real-id'); assert.equal(element.props.selection, undefined);
    assert.equal(element.props.activation, activation); assert.equal(element.props.owner, true);
    libraries = []; assert.equal(renderer.render({kind: 'shell', destination: {kind: 'library', libraryId: 'real-id'}}, {}), null);
    assert.equal(element.props.destination.getSnapshot().collection, undefined);
    current = false; assert.equal(renderer.render({kind: 'shell', destination: {kind: 'library', libraryId: 'real-id'}}, {}), null);
  } finally {renderer.dispose();}
});
