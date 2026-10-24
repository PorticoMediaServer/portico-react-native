import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {HttpLocalApi, createReadingHost, connectReadingHost} from '../../../packages/client-core/src';
import {parsePreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import {routeBase64} from '../../../packages/client-core/src/route-identity';
import {defaultI18n} from '../../../packages/i18n/src';
import {nativeReadingSettingsSection} from '../src-next/screens/settings/reading-preferences';
import {readerAssetEntry, readerNavigationAllowed, readerDelivery, appleReaderEntry} from '../src-next/screens/read/asset-origin';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const rows = [...(nativeReadingSettingsSection.groups ?? []), ...(nativeReadingSettingsSection.advanced?.groups ?? [])].flatMap(group => group.rows);
const fields = rows.map(row => ({key: row.key!, type: typeof row.control.default === 'boolean' ? 'boolean' : typeof row.control.default === 'number' ? 'integer' : 'string',
  default: row.control.default, scopes: ['profile-server'], group: 'reading', labelKey: `preferences.${row.key}`,
  ...(row.control.options ? {allowedValues: row.control.options.map(option => option.value)} : {})}));
const preferences = parsePreferenceSnapshot({deviceClass: 'mobile', registryRevision: 'fixture', registry: {revision: 'fixture', fields},
  documents: [{scope: 'profile-server', revision: 1, activeRevision: 1, digest: 'a'.repeat(64), values: {}},
    {scope: 'profile-device-class', revision: 1, activeRevision: 1, digest: 'b'.repeat(64), values: {}}],
  effective: Object.fromEntries(fields.map(field => [field.key, field.default])),
  effectiveSource: Object.fromEntries(fields.map(field => [field.key, 'default'])), clampedFields: []});
async function until(check: () => boolean) {for (let n = 0; n < 30 && !check(); n++) await new Promise<void>(resolve => setImmediate(resolve)); assert.ok(check());}

test('the actual native host forwards credentialless retirement after its authority ends, while core still fences ordinary data', async t => {
  const base = hooks(), effects: (() => void | (() => void))[] = [], refs: {current: unknown}[] = [];
  const react = {...base.react, useEffect(effect: () => void | (() => void)) {effects.push(effect);},
    useRef(value: unknown) {const ref = base.react.useRef(value); refs.push(ref); return ref;}};
  let current = true, host: ReturnType<typeof createReadingHost> | undefined, input: ((message: string) => void) | undefined;
  const authority = new Set<() => void>(), calls: string[] = [], packets: Record<string, unknown>[] = [];
  const revision = 'a'.repeat(64), api = new HttpLocalApi('http://127.0.0.1:39141', 'reader-fixture-token', async (_url, init = {}) => {
    const method = init.method ?? 'GET'; calls.push(method);
    const data = method === 'POST' ? {sessionId: 'session', itemId: 'item', sourceId: 'source', revision, size: 100, format: 'pdf', metadata: {title: 'Stored title'}}
      : String(_url).endsWith('/versions') ? {versions: [{sourceId: 'source', inventoryAvailable: true, size: 100, format: 'pdf'}]} : {progress: null};
    return method === 'DELETE' ? new Response(null, {status: 204}) : new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json', ETag: `"${revision}"`}});
  });
  const context = {api, current: () => current, session: () => ({sessionFamilyId: 'family', viewer: {authority: 'local', serverId: 'server', accountId: 'account', profileId: 'profile', role: 'member'}}),
    subscribeAuthority(listener: () => void) {authority.add(listener); return () => {authority.delete(listener);};}};
  const file = process.env.PORTICO_READ_HOST_SOURCE ? pathToFileURL(process.env.PORTICO_READ_HOST_SOURCE) : new URL('../src-next/screens/read/ReadNativeHost.tsx', import.meta.url);
  const {ReadNativeHost} = await screenModule(file, {
    react, 'react-native': {View: 'View', NativeModules: {PorticoReaderAssets: {bundle: async () => ({url: appleReaderEntry})}}},
    'react-native-webview': {default: 'NativeWebViewBoundary'},
    '../../../../../packages/client-core/src': {createReadingHost(options: Parameters<typeof createReadingHost>[0]) {host = createReadingHost(options); return host;}},
    '../../../../../packages/client-core/src/route-identity': {routeBase64}, '../../../../../packages/i18n/src': {defaultI18n},
    '../../platform/server-connections': {nativeRouteCrypto: {random: () => new Uint8Array(24).fill(7)}},
    '../../kit/states': {StateView: 'StateView', SkeletonBlock: 'SkeletonBlock'}, '../../kit/theme': {useTheme: () => ({colors: {ink: '#000'}})},
    './asset-origin': {readerAssetEntry, readerNavigationAllowed, readerDelivery},
  });
  base.render(() => ReadNativeHost({context, target: {itemId: 'item', sourceId: 'source'}, active: true,
    preferences: {getSnapshot: () => preferences, subscribe: () => () => {}}, onBack() {}, onOpenSettings() {}}));
  const view = refs.find(ref => ref.current === null); assert.ok(view);
  view.current = {injectJavaScript(script: string) {
    const prefix = 'window.PorticoReader&&window.PorticoReader.receive(', suffix = ');true;';
    assert.ok(script.startsWith(prefix) && script.endsWith(suffix)); assert.ok(!script.includes('reader-fixture-token'));
    const message = JSON.parse(script.slice(prefix.length, -suffix.length)); packets.push(JSON.parse(message)); input?.(message);
  }};
  const cleanup = effects[0]!();
  t.after(() => {if (typeof cleanup === 'function') cleanup(); host?.dispose();});
  await until(() => !!host);
  const connection = connectReadingHost({send: message => host!.receive(message), subscribe(listener) {input = listener; return () => {input = undefined;};}});
  t.after(() => connection.dispose()); const guest = await connection.ready;
  assert.equal(guest.session.signal.aborted, false); const before = calls.length;
  current = false; for (const listener of [...authority]) listener();
  assert.equal(guest.session.signal.aborted, true, 'the native wrapper must not discard the core retirement packet');
  const retired = packets.filter(packet => packet.kind === 'retired'); assert.equal(retired.length, 1);
  const count = packets.length; host!.confirm(); assert.equal(packets.length, count, 'ordinary data remains fenced by the core');
  assert.equal(calls.length, before, 'retirement never sends cleanup as another viewer');
});
