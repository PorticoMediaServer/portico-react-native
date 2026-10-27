import {bindNativeServerPreferences} from '../src-next/platform/server-preferences';
import {PreferencesReader} from '../../../packages/client-core/src/preferences-reader';
import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi} from '../../../packages/client-core/src';
import {parsePreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import {NativeShellNavigation, type NativeShellRoute} from '../src-next/shell/routes';
import {nativeReadingSettingsPreferences, nativeReadingSettingsSection} from '../src-next/screens/settings/reading-preferences';
import {openNativeReadingSettings} from '../src-next/screens/settings/reading-entry';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import * as React from 'react';
import {act, createHookHost} from './hook-driver.ts';

function authorityContext() {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'a'.repeat(64)};
  const fields = [...(nativeReadingSettingsSection.groups ?? []), ...(nativeReadingSettingsSection.advanced?.groups ?? [])].flatMap(group => group.rows).map(row => ({
    key: row.key!, type: typeof row.control.default === 'boolean' ? 'boolean' : typeof row.control.default === 'number' ? 'integer' : 'string',
    default: row.control.default, scopes: ['profile-server'], group: 'reading', labelKey: `preferences.${row.key}`,
    ...(row.control.options ? {allowedValues: row.control.options.map(option => option.value)} : {}),
  }));
  const snapshot = parsePreferenceSnapshot({deviceClass: 'mobile', registryRevision: 'read-unit', registry: {revision: 'read-unit', fields},
    documents: [{scope: 'profile-server', revision: 1, activeRevision: 1, digest: 'a'.repeat(64), values: {}},
      {scope: 'profile-device-class', revision: 1, activeRevision: 1, digest: 'b'.repeat(64), values: {}}],
    effective: Object.fromEntries(fields.map(field => [field.key, field.default])), effectiveSource: Object.fromEntries(fields.map(field => [field.key, 'default'])), clampedFields: []});
  let current = true, requests = 0;
  const authorityListeners = new Set<() => void>(), preferenceListeners = new Set<() => void>();
  const navigation = new NativeShellNavigation(authority, () => authority);
  const context = {navigation, authority: () => authority, current: () => current, preferences: () => snapshot,
    api: new HttpLocalApi('https://read-registration.test', 'synthetic-token', async () => {requests++; throw new Error('registration_must_not_fetch');}),
    subscribeAuthority: (listener: () => void) => {authorityListeners.add(listener); return () => {authorityListeners.delete(listener);};},
    subscribePreferences: (listener: () => void) => {preferenceListeners.add(listener); return () => {preferenceListeners.delete(listener);};},
  };
  const reader = new PreferencesReader(context.api, {serverId: authority.serverId, viewerId: authority.profileId});
  bindNativeServerPreferences(context, {read: deviceClass => reader.preferences(deviceClass),
    apply: (scope, deviceClass, revision, values) => reader.applyPreferences(scope, deviceClass, revision, values), accept: next => next});
  return {context, snapshot, get requests() {return requests;}, close() {current = false; reader.dispose(); for (const listener of [...authorityListeners]) listener();}};
}

test('Read registration retains the original occurrence across Reading Settings history', async () => {
  const f = authorityContext(); let registered: string | undefined, factory: any;
  const {createNativeReadRenderer} = await screenModule(new URL('../src-next/screens/read/ReadRoute.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Platform: {isTV: false}}, './host-component': {nativeReadHost: () => 'TrustedReadHost'},
    './read-route-back': {readRouteBack: (await import('../src-next/screens/read/read-route-back')).readRouteBack},
  });
  await screenModule(new URL('../src-next/screens/read/register.tsx', import.meta.url), {
    react: {...React, default: React}, '../../shell/route-registry': {nativeShellRoutes: {registerRoute: (kind: string, create: any) => {registered = kind; factory = create;}}},
    '../settings/ReadingSettingsRoute': {nativeReadingSettingsPreferences, openNativeReadingSettings}, './ReadRoute': {createNativeReadRenderer},
  });
  assert.equal(registered, 'read'); assert.equal(f.requests, 0);
  const source = nativeReadingSettingsPreferences(f.context), renderer = factory(f.context);
  const library: NativeShellRoute = {kind: 'shell', destination: {kind: 'library', libraryId: 'actual-library'}};
  const read: NativeShellRoute = {kind: 'read', itemId: 'actual-item', sourceId: 'actual-source'};
  f.context.navigation.open(library, f.context.authority()); f.context.navigation.open(read, f.context.authority());
  renderer.render(read, {}); let element = renderer.renderRetained({}), tree: any;
  const residence = createHookHost(() => {tree = element.type(element.props);});
  await act(() => residence.mount());
  const child = () => {const children = tree.props.children; return (Array.isArray(children) ? children : [children]).find((value: any) => value?.type === 'TrustedReadHost');};
  const first = child(); assert.equal(first.props.target, read); assert.equal(first.props.active, true);
  assert.equal(first.props.preferences.getSnapshot(), source.getPreferenceSnapshot());
  first.props.onOpenSettings(); element = renderer.renderRetained({}); await act(() => residence.rerender());
  assert.equal(child().props.active, false); assert.equal(child().props.target, read); assert.equal(child().key, first.key);
  assert.equal(f.context.navigation.back(f.context.authority()), true); element = renderer.renderRetained({}); await act(() => residence.rerender());
  assert.equal(child().props.active, true); child().props.onBack(); assert.equal(f.context.navigation.getSnapshot().route, library);
  assert.equal(renderer.renderRetained({}), null); residence.unmount(); renderer.dispose();
  assert.equal(source.current(), true); assert.equal(f.requests, 0); f.close(); assert.equal(source.current(), false);
});

test('the actual Read renderer refuses creation on TV before mounting a WebView', async () => {
  const host = hooks();
  const {createNativeReadRenderer} = await screenModule(new URL('../src-next/screens/read/ReadRoute.tsx', import.meta.url), {
    react: host.react, 'react-native': {Platform: {isTV: true}}, './host-component': {nativeReadHost: () => {throw new Error('TV must not resolve a WebView host');}}, './read-route-back': {readRouteBack: () => () => {}},
  });
  assert.throws(() => createNativeReadRenderer({}, {}, () => {}), /native_read_unavailable/);
});

test('the actual lazy host module is safe to evaluate on TV without evaluating a WebView package', async () => {
  const host = hooks();
  const {nativeReadHost} = await screenModule(new URL('../src-next/screens/read/host-component.ts', import.meta.url), {
    react: host.react, 'react-native': {Platform: {isTV: true}},
  });
  assert.throws(nativeReadHost, /native_read_unavailable/);
});

test('twenty visited Reading occurrences project at most two guest slots while preserving original routes', async () => {
  const f = authorityContext();
  const {createNativeReadRenderer} = await screenModule(new URL('../src-next/screens/read/ReadRoute.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Platform: {isTV: false}}, './host-component': {nativeReadHost: () => 'TrustedReadHost'},
    './read-route-back': {readRouteBack: (await import('../src-next/screens/read/read-route-back')).readRouteBack},
  });
  const renderer = createNativeReadRenderer(f.context, {getSnapshot: () => f.snapshot, subscribe: () => () => {}}, () => {});
  const original: NativeShellRoute[] = [];
  let element: any, tree: any, residence: ReturnType<typeof createHookHost> | undefined;
  const children = () => {const values = tree.props.children; return (Array.isArray(values) ? values : [values]).filter((value: any) => value?.type === 'TrustedReadHost');};
  for (let index = 0; index < 20; index++) {
    if (index) {f.context.navigation.open({kind: 'search-reading', query: `book ${index}`}, f.context.authority()); renderer.renderRetained();}
    const route: NativeShellRoute = {kind: 'read', itemId: `item-${index}`, sourceId: `source-${index}`}; original.push(route);
    f.context.navigation.open(route, f.context.authority()); renderer.render(route); element = renderer.renderRetained();
    if (!residence) {residence = createHookHost(() => {tree = element.type(element.props);}); await act(() => residence!.mount());}
    else await act(() => residence!.rerender());
    const rows = children(); assert.equal(rows.length, index + 1);
    assert.ok(rows.filter((row: any) => row.props.resident).length <= 2);
    assert.equal(rows.filter((row: any) => row.props.active).length, 1);
    assert.equal(rows.at(-1).props.target, route);
  }
  for (let index = 19; index >= 0; index--) {
    assert.equal(f.context.navigation.getSnapshot().route, original[index]);
    if (index) {assert.equal(f.context.navigation.back(f.context.authority()), true); assert.equal(f.context.navigation.back(f.context.authority()), true);}
  }
  residence?.unmount(); renderer.dispose(); f.close();
});
