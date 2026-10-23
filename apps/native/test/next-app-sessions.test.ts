import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeModules} from './react-native-stub.mjs';
import type {AppServerSession} from '../../../packages/client-core/src/app-sessions.ts';
import {nativeAppSessions, nativeAppSessionStorage, readNativeSelectedViewer} from '../src-next/platform/app-session-storage.ts';
import {NativeAccounts} from '../src-next/platform/accounts.ts';
import {nativeServerEnvironment} from '../src-next/platform/server-connections.ts';

const fixture = (serverId: string, signIn: 'local' | 'portico' = 'local'): AppServerSession => ({signIn, connection: {
  version: '1', selectionId: serverId.padEnd(32, '_'), logicalOrigin: `https://${serverId}.test`,
  pin: {serverId, publicKey: 'p'.repeat(43), fingerprint: 'f'.repeat(43)}, routes: {paired: [`https://${serverId}.test`]},
  session: {accessToken: `synthetic_${serverId}`, refreshToken: `synthetic_refresh_${serverId}`, installationId: 'native_sessions_0123456789abcdef0123456789',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), authorizationHorizon: new Date(Date.now() + 86400000).toISOString(),
    sessionFamilyId: `family_${serverId}`, tokenGeneration: '1', viewer: {authority: 'local', serverId, accountId: `membership_${serverId}`, profileId: 'main', role: 'member'}},
  ...(signIn === 'portico' ? {hosted: {origin: 'https://web.getportico.tv', accountId: 'one_portico_account', key: {keyId: 'key', publicKey: 'k'.repeat(43)}}} : {}),
}});

function storage() {
  const records = new Map<string, string>();
  let fail = false;
  NativeModules.PorticoRuntime.loadQueueRecord = async (key: string) => records.get(key) ?? null;
  NativeModules.PorticoRuntime.saveQueueRecord = async (key: string, raw: string) => {if (fail) throw new Error('native_locked'); records.set(key, raw);};
  return {records, fail(value: boolean) {fail = value;}};
}
async function seed(...servers: AppServerSession[]) {
  await nativeAppSessionStorage.change(() => ({version: 1, revision: 1, selectedServerId: servers.at(-1)?.connection.pin.serverId, servers}));
}

test('real native store keeps several server families while switching; viewer projection strips refresh', async () => {
  const f = storage(), owner = new NativeAccounts();
  const a = fixture('local_a'), b = fixture('portico_b', 'portico'); await seed(a, b);
  const sent: string[] = [];
  NativeModules.PorticoRuntime.networkRequest = async (_: string, url: string) => {sent.push(url); throw new Error('unexpected network');};
  try {
    await owner.switchServer('local_a');
    assert.deepEqual((await nativeAppSessions.read()).servers, [a, b]);
    assert.equal((await readNativeSelectedViewer())?.session.refreshToken, undefined);
    assert.equal((await readNativeSelectedViewer())?.session.sessionFamilyId, 'family_local_a');
    const publicState = await owner.snapshot();
    assert.equal(publicState.servers[0].labelKey, 'accounts.session.local');
    assert.equal(publicState.servers[1].labelKey, 'accounts.session.portico');
    assert.doesNotMatch(JSON.stringify(publicState), /synthetic_|refreshToken|accessToken/);
    assert.deepEqual(sent, []); assert.equal(f.records.size, 1);
  } finally {owner.dispose();}
});

test('native connection refresh stays on captured server after selection changes', async () => {
  storage(); await seed(fixture('local_a'), fixture('local_b'));
  const old = nativeServerEnvironment('local_a');
  await nativeAppSessions.select('local_b');
  await old.storage.change(value => value && ({...value, session: {...value.session, accessToken: 'rotated_a', tokenGeneration: '2'}}));
  const state = await nativeAppSessions.read();
  assert.equal(state.selectedServerId, 'local_b');
  assert.equal(state.servers.find(v => v.connection.pin.serverId === 'local_a')?.connection.session.accessToken, 'rotated_a');
  assert.equal(state.servers.find(v => v.connection.pin.serverId === 'local_b')?.connection.session.accessToken, 'synthetic_local_b');
});

test('native atomic callback and failed secure write preserve original records', async () => {
  const f = storage(); await seed(fixture('local_a'));
  const original = new Map(f.records);
  await assert.rejects(nativeAppSessionStorage.change(() => {throw new Error('callback_refused');}), /callback_refused/);
  assert.deepEqual(f.records, original);
  f.fail(true); await assert.rejects(nativeAppSessions.select('local_a'), /native_locked/);
  assert.deepEqual(f.records, original);
  f.fail(false);
  await Promise.all(Array.from({length: 8}, () => nativeAppSessions.select('local_a')));
  assert.equal((await nativeAppSessions.read()).revision, 9);
});

test('native one-server sign-out removes only its captured family before failed remote cleanup', async () => {
  storage(); const owner = new NativeAccounts(); await seed(fixture('local_a'), fixture('portico_b', 'portico'));
  try {
    await owner.signOutServer('local_a', 'stale_family');
    assert.equal((await nativeAppSessions.read()).servers.length, 2);
    await assert.rejects(owner.signOutServer('local_a', 'family_local_a'), (error: {code?: string}) => error.code === 'session_revocation_pending');
    assert.deepEqual((await nativeAppSessions.read()).servers.map(v => v.connection.pin.serverId), ['portico_b']);
    const env = nativeServerEnvironment('local_a');
    await assert.rejects(env.storage.change(() => fixture('local_a').connection), (error: {code?: string}) => error.code === 'cancelled');
  } finally {owner.dispose();}
});

test('Portico account removal preserves every Local binding and refuses a stale new admission', async () => {
  storage(); const owner = new NativeAccounts(); await seed(fixture('local_a'), fixture('portico_b', 'portico'));
  try {
    const admission = await owner.admission('portico', {origin: 'https://web.getportico.tv', accountId: 'one_portico_account'});
    const removed = await nativeAppSessions.signOutPorticoAccount({origin: 'https://web.getportico.tv', accountId: 'one_portico_account'});
    assert.deepEqual(removed.map(v => v.connection.pin.serverId), ['portico_b']);
    assert.deepEqual((await nativeAppSessions.read()).servers.map(v => v.connection.pin.serverId), ['local_a']);
    await assert.rejects(nativeServerEnvironment('portico_c', admission).storage.change(() => fixture('portico_c', 'portico').connection), (error: {code?: string}) => error.code === 'cancelled');
  } finally {owner.dispose();}
});

test('native account sign-out uses the Portico account scope, preserves selected Local runtime and durably removes Portico bindings', async () => {
  storage(); const owner = new NativeAccounts(), local = fixture('local_a');
  await seed(fixture('portico_b', 'portico'), fixture('portico_c', 'portico'), local);
  const session = {account: {id: 'one_portico_account', username: 'synthetic', displayName: 'Synthetic'}, accessToken: 'synthetic_account_access',
    refreshToken: 'synthetic_account_refresh', familyId: 'portico_account_family', expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString()};
  let credentials = JSON.stringify({version: 1, revocations: [], active: {session, authority: session.refreshToken, context: {}}});
  const sent: string[] = []; let fences = 0;
  NativeModules.PorticoRuntime.loadCredentials = async () => credentials;
  NativeModules.PorticoRuntime.saveCredentials = async (_origin: string, raw: string) => {credentials = raw;};
  NativeModules.PorticoRuntime.networkRequest = async (_id: string, url: string) => {
    sent.push(url);
    if (url === 'https://web.getportico.tv/v1/sessions/revoke') return {status: 204, headers: {}, body: ''};
    throw Object.assign(new Error('synthetic_server_offline'), {code: 'offline'});
  };
  const off = owner.onFence(() => {fences++;});
  try {
    await assert.rejects(owner.signOutPorticoAccount({accountId: 'one_portico_account', familyId: 'portico_account_family'}), (error: {code?: string}) => error.code === 'session_revocation_pending');
    assert.deepEqual((await nativeAppSessions.read()).servers, [local]);
    assert.equal((await nativeAppSessions.read()).selectedServerId, 'local_a');
    assert.equal(JSON.parse(credentials).active, undefined);
    assert.equal(fences, 0, 'an unrelated Local runtime is never fenced by Portico sign-out');
    assert.ok(sent.includes('https://web.getportico.tv/v1/sessions/revoke'));
    assert.equal(sent.some(url => url.endsWith('/v1/servers')), false, 'captured server cleanup never consults the directory');
  } finally {off(); owner.dispose();}
});

test('stale Portico sign-out always settles the active runtime fence without removing a newer account', async () => {
  storage(); const owner = new NativeAccounts(); await seed(fixture('portico_b', 'portico'));
  const session = {account: {id: 'one_portico_account', username: 'synthetic', displayName: 'Synthetic'}, accessToken: 'synthetic_access', refreshToken: 'synthetic_refresh',
    familyId: 'current_family', expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString()};
  NativeModules.PorticoRuntime.loadCredentials = async () => JSON.stringify({version: 1, revocations: [], active: {session, authority: session.refreshToken, context: {}}});
  let fences = 0, settled = 0; const a = owner.onFence(() => {fences++;}), b = owner.onSettled(() => {settled++;});
  try {
    await assert.rejects(owner.signOutPorticoAccount({accountId: 'one_portico_account', familyId: 'stale_family'}), (error: {code?: string}) => error.code === 'account_changed');
    assert.equal(fences, 1); assert.equal(settled, 1);
    assert.equal((await nativeAppSessions.read()).servers.length, 1);
  } finally {a(); b(); owner.dispose();}
});

test('native cancellation compensates a late Portico password grant and never adopts its family', async () => {
  storage(); const owner = new NativeAccounts(); let credentials: string | null = null;
  let release!: () => void, entered!: () => void; const held = new Promise<void>(resolve => {release = resolve;}), started = new Promise<void>(resolve => {entered = resolve;});
  const sent: string[] = [];
  NativeModules.PorticoRuntime.loadCredentials = async () => credentials;
  NativeModules.PorticoRuntime.saveCredentials = async (_: string, raw: string) => {credentials = raw;};
  NativeModules.PorticoRuntime.newRequestId = async () => '00000000-0000-4000-8000-000000000001';
  NativeModules.PorticoRuntime.networkRequest = async (_: string, url: string) => {
    sent.push(url);
    if (url.endsWith('/v1/sessions')) {
      entered(); await held;
      return {status: 200, headers: {}, body: JSON.stringify({account: {id: 'late_account', username: 'synthetic', displayName: 'Synthetic'}, accessToken: 'late_access',
        refreshToken: 'late_refresh', familyId: 'late_family', expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString()})};
    }
    return {status: 204, headers: {}, body: ''};
  };
  try {
    const pending = owner.signInPorticoAccount('b'.repeat(43), 'synthetic', 'synthetic_password');
    await started; owner.cancel(); release(); await assert.rejects(pending);
    for (let i = 0; i < 12 && !sent.some(url => url.endsWith('/v1/sessions/revoke')); i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(sent.some(url => url.endsWith('/v1/sessions/revoke')));
    assert.equal(owner.accountCredentials().getSnapshot().session, undefined);
    assert.equal((await nativeAppSessions.read()).servers.length, 0);
  } finally {release(); owner.dispose();}
});

test('a recovered Portico TV grant must still belong to its live account before native adoption', async () => {
  storage(); const owner = new NativeAccounts(); let credentials: string | null = null, accountId = 'different_account';
  NativeModules.PorticoRuntime.loadCredentials = async () => credentials;
  NativeModules.PorticoRuntime.saveCredentials = async (_: string, raw: string) => {credentials = raw;};
  NativeModules.PorticoRuntime.networkRequest = async (_: string, url: string, _method: string, headers: Record<string, string>) => {
    if (url.endsWith('/v1/me')) {
      assert.equal(new Headers(headers).get('Authorization'), 'Bearer recovered_access');
      return {status: 200, headers: {}, body: JSON.stringify({account: {id: accountId, username: 'synthetic', displayName: 'Synthetic'}})};
    }
    return {status: 204, headers: {}, body: ''};
  };
  const grant = {account: {id: 'recovered_account', username: 'synthetic', displayName: 'Synthetic'}, accessToken: 'recovered_access', refreshToken: 'recovered_refresh',
    familyId: 'recovered_family', expiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString()};
  try {
    await assert.rejects(owner.adoptPorticoTVSession(grant), (error: {code?: string}) => error.code === 'identity_mismatch');
    assert.equal(owner.accountCredentials().getSnapshot().session, undefined);
    accountId = 'recovered_account'; await owner.adoptPorticoTVSession(grant);
    assert.equal(owner.accountCredentials().getSnapshot().session?.familyId, 'recovered_family');
    await owner.accountCredentials().logout();
  } finally {owner.dispose();}
});
