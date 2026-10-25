import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';

const authority = {serverId: 'server', accountId: 'account', profileId: 'primary', epoch: 'one', viewerFence: 'fence'};
test('library settings selects the actual owner library and denies secondary/member/admin access', async () => {
  let fallback = 0;
  const {createNativeLibrarySettingsRenderer} = await screenModule(new URL('../src-next/screens/settings-live/owner-libraries/LibrarySettingsRoute.tsx', import.meta.url), {
    react: {...React, default: React}, '../lifetime': {NativeScreenLifetime},
    '../settings-ports': {createNativeSettingsPorts: (context: unknown) => ({context})},
    '../SettingsRoute': {createNativeSettingsRenderer: () => ({render: () => {fallback++; return 'fallback';}, dispose() {}})},
    '../Screen': {Screen: 'Screen'}, './OwnerLibrariesPanel': {NativeOwnerLibrariesPanel: 'Panel'},
  });
  for (const variant of [{role: 'owner', primaryProfileId: 'primary', disabled: false}, {role: 'owner', primaryProfileId: 'other'}, {role: 'member', primaryProfileId: 'primary'}, {role: 'admin', primaryProfileId: 'primary'}, {role: 'owner', primaryProfileId: 'primary', disabled: true}]) {
    const context = {current: () => true, authority: () => authority, subscribeAuthority: () => () => {}, account: {canManage: true, account: variant}};
    const renderer = createNativeLibrarySettingsRenderer(context);
    const node = renderer.render({kind: 'library-settings', libraryId: 'actual-library'}, {});
    if (variant.role === 'owner' && variant.primaryProfileId === 'primary' && !variant.disabled) {
      assert.equal(node.props.children.props.initialLibraryId, 'actual-library');
      assert.equal(node.props.children.type, 'Panel');
    } else assert.equal(node, 'fallback');
    renderer.dispose();
    assert.throws(() => renderer.render({kind: 'library-settings', libraryId: 'actual-library'}, {}), {name: 'AbortError'});
  }
  assert.equal(fallback, 4);
});
