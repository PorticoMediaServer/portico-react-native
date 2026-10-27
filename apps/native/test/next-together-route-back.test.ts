import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {NativeShellNavigation} from '../src-next/shell/routes.ts';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime.ts';

const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};

test('Together route back compares the original opening and only disposes page owners', async () => {
  let controllerDisposed = 0, mediaDisposed = 0;
  class Controller {dispose() {controllerDisposed++;}}
  class Media {dispose() {mediaDisposed++;}}
  const {createNativeTogetherRenderer} = await screenModule(new URL('../src-next/screens/settings-live/TogetherRoute.tsx', import.meta.url), {
    react: {...React, default: React}, '../../shell/route-registry': {nativeShellRoutes: {registerRoute() {}}},
    './lifetime': {NativeScreenLifetime}, './together-controller': {NativeTogetherController: Controller}, './together-media': {NativeTogetherMedia: Media},
    './together-session': {nativeTogetherSession: () => ({})}, './TogetherScreen': {NativeTogetherScreen: 'TogetherScreen'},
  });
  const navigation = new NativeShellNavigation(authority, () => authority), context = {navigation, authority: () => authority,
    current: () => true, subscribeAuthority: navigation.subscribe, api: {}};
  const route = {kind: 'together' as const};
  navigation.open(route, authority);
  const renderer = createNativeTogetherRenderer(context), old = renderer.render(route, {});
  old.props.onBack(); assert.equal(navigation.getSnapshot().route.kind, 'shell');
  navigation.open(route, authority);
  old.props.onBack(); assert.equal(navigation.getSnapshot().route, route, 'old button cannot pop the same descriptor reopened later');
  const next = renderer.render(route, {}); next.props.onBack(); assert.equal(navigation.getSnapshot().route.kind, 'shell');
  renderer.dispose(); assert.equal(controllerDisposed, 1); assert.equal(mediaDisposed, 1);
  navigation.dispose();
});
