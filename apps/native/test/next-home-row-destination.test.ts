import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {NativeShellNavigation, titleRoute} from '../src-next/shell/routes';
import {NativeHomeRowController} from '../src-next/screens/home/row-controller';
import {NativeShellRouteRegistry} from '../src-next/shell/route-registry';

const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'home-fence'};

test('real row outlet retains its exact controller through a title and cancels only pending navigation work', async () => {
  const navigation = new NativeShellNavigation(authority, () => authority), starts: any[] = [];
  const {createNativeHomeRows} = await screenModule(new URL('../src-next/screens/home/SeeAllRoute.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {View: 'View'}, '../../kit/focus': {},
    './HomeSeeAll': {}, './HomeRowFilters': {},
    './row-controller': {NativeHomeRowController}, '../../platform/server-connections': {}, '../../shell/routes': {titleRoute},
    '../../shell/route-registry': {nativeShellRoutes: new NativeShellRouteRegistry()}, '../../shell/model': {}, '../../kit/theme': {},
  });
  let resolve!: () => void;
  const pending = new Promise<void>(done => {resolve = done;});
  const context = {navigation, current: () => true, authority: () => authority, api: {request() {throw new Error('unexpected eager request');}},
    libraries: () => [{id: 'movies', name: 'Actual Movies', kind: 'movie'}], playback: {runtime: {startGroup: async (input: unknown) => {starts.push(input); await pending;}}}};
  const rows = createNativeHomeRows(context, (error: unknown) => {throw error;});
  const route = {kind: 'home-see-all' as const, destination: {type: 'row' as const, rowId: 'continue'}};
  try {
    navigation.open(route, authority); rows.reconcile();
    const initial = rows.render({})[0], source = initial.props.source;
    assert.ok(source.controller instanceof NativeHomeRowController);
    assert.equal(source.controller.rowId, 'continue');
    const query = {libraryId: '*', pivot: 'items', query: {field: 'homeRow', operator: 'equals', value: 'continue'}, sort: [{field: 'groupOrder', direction: 'asc'}]};
    source.controller.wholeGroup = () => query;
    initial.props.onPlay(true);
    assert.equal(starts.length, 1); assert.strictEqual(starts[0].query, query); assert.equal(starts[0].shuffle, true);
    assert.equal(starts[0].signal.aborted, false);
    navigation.open(titleRoute({id: 'movie', kind: 'movie', title: 'Actual Movie', libraryId: 'movies'}), authority); rows.reconcile();
    const hidden = rows.render({})[0];
    assert.strictEqual(hidden.props.source, source); assert.equal(hidden.props.active, false);
    assert.equal(starts[0].signal.aborted, true, 'navigation aborts an unfinished queue preparation');
    hidden.props.onPlay(false); assert.equal(starts.length, 1, 'hidden retained callbacks cannot dispatch');
    navigation.back(authority); rows.reconcile();
    const restored = rows.render({})[0];
    assert.strictEqual(restored.props.source.controller, source.controller); assert.equal(restored.props.active, true);
    assert.equal(restored.props.kindLabel('movies'), 'Actual Movies');
    navigation.back(authority); rows.reconcile();
    assert.deepEqual(rows.render({}), []); assert.equal(source.abort.signal.aborted, true);
    initial.props.onPlay(false); assert.equal(starts.length, 1, 'retired opener cannot recreate private work');
  } finally {resolve(); rows.dispose(); navigation.dispose();}
});
