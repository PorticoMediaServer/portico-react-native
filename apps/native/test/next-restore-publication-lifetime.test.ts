import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

type Deferred = {promise: Promise<undefined>; resolve: () => void};

function modules(state: {
  reads: () => unknown; hints: (listener: () => void) => () => void; restores: Deferred[]; deferred: boolean;
}) {
  return {
    react: {...React, default: React},
    '../kit/states': {HomeSkeleton: 'HomeSkeleton', StateView: 'StateView'},
    '../../../../packages/client-core/src/presentation/errors': {presentError: () => ({title: 'failed', body: 'failed'})},
    './assembly': {createNativeShellBindings: () => ({})},
    './bootstrap': {restoreNativeShellRuntime: () => {
      let resolve: () => void = () => {};
      const promise = new Promise<undefined>(done => {resolve = () => done(undefined);});
      state.restores.push({promise, resolve});
      return state.deferred ? promise : Promise.resolve(undefined);
    }},
    './NativeShell': {NativeShell: 'NativeShell'},
    '../platform/accounts': {nativeAccounts: {snapshot: async () => ({servers: []}), onSettled: () => () => {}, onFence: () => () => {}}},
    '../platform/app-session-storage': {readNativeSelectedViewer: state.reads, subscribeNativeAppSessions: state.hints},
    '../screens/accounts/AccountEntry': {AccountEntry: 'AccountEntry'},
    '../screens/accounts/AccountRoutes': {ServersRoute: 'ServersRoute'},
    '../../../../packages/i18n/src': {defaultI18n},
    '../platform/identity-failure': {NativeIdentityFailure: class extends Error {}},
    '../screens/accounts/ServerIdentityFailure': {ServerIdentityFailure: 'ServerIdentityFailure'},
    '../screens/settings/NativeSettingsAppearance': {NativeSettingsAppearance: 'NativeSettingsAppearance'},
  };
}

const viewer = {serverUrl: 'https://server.test', session: {sessionFamilyId: 'family', viewer: {serverId: 'server', accountId: 'account', profileId: 'profile'}}};

test('a storage hint before the entry completes does not unmount a settled entry; its onComplete restores once', async () => {
  let stored: unknown = undefined, hint: (() => void) | undefined;
  const restores: Deferred[] = [];
  const {RestoredShell} = await screenModule(new URL('../src-next/shell/RestoredShell.tsx', import.meta.url), modules({
    reads: async () => stored, hints: listener => {hint = listener; return () => {};}, restores, deferred: false,
  }));
  let tree: any;
  const host = createHookHost(() => {tree = RestoredShell({});});
  await act(() => host.mount());
  try {
    assert.equal(tree.type, 'AccountEntry');
    // rememberNativeSession writes the selected record before NativeAccounts.remember returns.
    stored = viewer;
    await act(() => hint!());
    assert.equal(tree.type, 'AccountEntry', 'the same entry stays mounted');
    const restoresBefore = restores.length;
    await act(() => tree.props.onComplete());
    assert.equal(restores.length, restoresBefore + 1, 'the entry completion starts the one restore');
  } finally {host.unmount();}
});

test('a storage hint while a restore is pending still fences and restarts it', async () => {
  let stored: unknown = undefined, hint: (() => void) | undefined;
  const restores: Deferred[] = [];
  const {RestoredShell} = await screenModule(new URL('../src-next/shell/RestoredShell.tsx', import.meta.url), modules({
    reads: async () => stored, hints: listener => {hint = listener; return () => {};}, restores, deferred: true,
  }));
  let tree: any;
  const host = createHookHost(() => {tree = RestoredShell({});});
  await act(() => host.mount());
  try {
    assert.equal(restores.length, 1, 'the first restore is pending');
    stored = viewer;
    await act(() => hint!());
    assert.equal(restores.length, 2, 'a pending restore is fenced and restarted');
    await act(() => restores.forEach(item => item.resolve()));
    assert.equal(tree.type, 'AccountEntry');
  } finally {host.unmount();}
});
