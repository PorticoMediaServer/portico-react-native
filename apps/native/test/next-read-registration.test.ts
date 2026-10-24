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

test('Read self-registration borrows the confirmed source and retains the same view across actual Reading Settings history', async () => {
  const host = hooks(), f = authorityContext();
  let registered: string | undefined, factory: any;
  const {createNativeReadRenderer} = await screenModule(new URL('../src-next/screens/read/ReadRoute.tsx', import.meta.url), {
    react: host.react, 'react-native': {Platform: {isTV: false}}, './host-component': {nativeReadHost: () => 'TrustedReadHost'},
  });
  await screenModule(new URL('../src-next/screens/read/register.tsx', import.meta.url), {
    react: host.react, '../../shell/route-registry': {nativeShellRoutes: {registerRoute: (kind: string, create: any) => {registered = kind; factory = create;}}},
    '../settings/ReadingSettingsRoute': {nativeReadingSettingsPreferences, openNativeReadingSettings}, './ReadRoute': {createNativeReadRenderer},
  });
  assert.equal(registered, 'read'); assert.equal(f.requests, 0, 'module import starts no API work');
  const source = nativeReadingSettingsPreferences(f.context), renderer = factory(f.context);
  assert.equal(f.requests, 0, 'factory borrows seeded confirmed preferences without fetching');
  const library: NativeShellRoute = {kind: 'shell', destination: {kind: 'library', libraryId: 'actual-library'}};
  const read: NativeShellRoute = {kind: 'read', itemId: 'actual-item', sourceId: 'actual-source'};
  f.context.navigation.open(library, f.context.authority()); f.context.navigation.open(read, f.context.authority());
  renderer.render(read, {}); const first = renderer.renderRetained({});
  assert.equal(first.type, 'TrustedReadHost'); assert.equal(first.props.target, read); assert.equal(first.props.active, true);
  assert.equal(first.props.preferences.getSnapshot(), source.getPreferenceSnapshot(), 'full confirmed snapshot, never Reading projection');
  assert.equal(first.props.preferences.getSnapshot(), f.snapshot);
  first.props.onOpenSettings();
  assert.deepEqual(f.context.navigation.getSnapshot().route, {kind: 'settings-page', scope: 'account', page: 'reading'});
  const hidden = renderer.renderRetained({});
  assert.equal(hidden.props.active, false); assert.equal(hidden.props.target, read);
  assert.equal(hidden.props.preferences, first.props.preferences); assert.equal(hidden.props.key, first.props.key);
  assert.equal(f.context.navigation.back(f.context.authority()), true); assert.equal(f.context.navigation.getSnapshot().route, read);
  const restored = renderer.renderRetained({}); assert.equal(restored.props.target, read); assert.equal(restored.props.active, true);
  restored.props.onBack(); assert.equal(f.context.navigation.getSnapshot().route, library);
  assert.equal(renderer.renderRetained({}), null);
  renderer.dispose(); assert.equal(source.current(), true, 'a Read borrower never disposes the Settings authority source');
  assert.equal(nativeReadingSettingsPreferences(f.context), source); assert.equal(f.requests, 0);
  f.close(); assert.equal(source.current(), false);
});

test('the actual Read renderer refuses creation on TV before mounting a WebView', async () => {
  const host = hooks();
  const {createNativeReadRenderer} = await screenModule(new URL('../src-next/screens/read/ReadRoute.tsx', import.meta.url), {
    react: host.react, 'react-native': {Platform: {isTV: true}}, './host-component': {nativeReadHost: () => {throw new Error('TV must not resolve a WebView host');}},
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
