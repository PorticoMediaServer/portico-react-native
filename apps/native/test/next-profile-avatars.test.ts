import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HttpLocalApi, IdentityClient, type ProfileAvatar} from '../../../packages/client-core/src/index.ts';
import {RouteConnection} from '../../../packages/client-core/src/route-connection.ts';
import {RouteError} from '../../../packages/client-core/src/route-identity.ts';
import {profileAvatarUpload, profilePictureSource, useAvatarRoute} from '../src-next/platform/profile-avatars.ts';
import {nativeNetworkFetch} from '../src-next/platform/server-connections.ts';
import {profileAPI} from '../src-next/platform/profile-transport.ts';
import {NativeModules} from './react-native-stub.mjs';
import {createHookHost, act} from './hook-driver.ts';

const logical = 'https://logical.test', lan = 'https://192.168.1.20:32500';
const path = '/v1/direct/profiles/p1/avatar';
const avatar: ProfileAvatar = {profileId: 'p1', version: 1, updatedAt: '2026-10-18T12:00:00Z', sourceMime: 'image/png', url: '/v1/profiles/p1/avatar?v=1'};
const bytes = new Uint8Array([0, 128, 255, 13, 10, 1]);
type Wire = {url: string; method: string; headers: Record<string, string>; body: string | null; transport: string};
function runtime(answer: (wire: Wire) => {status: number; body?: unknown}) {
  const sent: Wire[] = []; let seq = 0;
  Object.assign(NativeModules.PorticoRuntime, {playbackRequestId: () => `avatar-${++seq}`, cancelQueueRequest: () => {}});
  for (const transport of ['networkRequest', 'profileRequest']) {
    NativeModules.PorticoRuntime[transport] = async (_id: string, url: string, method: string, headers: Record<string, string>, body: string | null) => {
      const wire = {url, method, headers, body, transport}; sent.push(wire);
      const reply = answer(wire);
      return {status: reply.status, headers: {'content-type': 'application/json'}, body: reply.body === undefined ? '' : JSON.stringify(reply.body)};
    };
  }
  return sent;
}
function routed(api: HttpLocalApi, t: {after: (fn: () => void) => void}, probe: (origin: string) => Promise<unknown> = async () => ({})) {
  const connection = new RouteConnection({logicalOrigin: logical, pin: {serverId: 'server', publicKey: 'key', fingerprint: 'fingerprint'}, memory: {paired: [lan]}, fetcher: nativeNetworkFetch, probe: probe as never});
  t.after(() => connection.dispose()); api.useRoutes(connection); return connection;
}
function noRawFetch(t: {after: (fn: () => void) => void}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Raw fetch must not carry avatar credentials.'); };
  t.after(() => { globalThis.fetch = original; });
}

test('upload uses the verified LAN route and renews once after 401 with identical bytes and type', async t => {
  noRawFetch(t);
  const sent = runtime(wire => wire.headers.authorization === 'Bearer old' ? {status: 401} : {status: 200, body: avatar});
  const api = new HttpLocalApi(logical, 'old', nativeNetworkFetch); routed(api, t);
  const rejected: string[] = [];
  api.setAuthRecovery({token: async current => current, recover: async token => { rejected.push(token); api.setAccessToken('new'); return 'new'; }});
  assert.deepEqual(await new IdentityClient(api, profileAvatarUpload(api)).uploadAvatar('p1', bytes, 'image/png'), avatar);
  assert.deepEqual(rejected, ['old']);
  assert.deepEqual(sent.map(w => [w.url, w.method, w.headers.authorization]), [[lan + path, 'POST', 'Bearer old'], [lan + path, 'POST', 'Bearer new']]);
  for (const wire of sent) {
    assert.equal(wire.headers['content-type'], 'image/png');
    assert.deepEqual(Buffer.from(JSON.parse(wire.body!).nativeAvatarBase64, 'base64'), Buffer.from(bytes));
  }
});

test('proactive renewal and profile removal share the API; repeated 401 cannot loop', async t => {
  const sent = runtime(wire => wire.method === 'DELETE' ? {status: 204} : {status: 401});
  const api = new HttpLocalApi(logical, 'old', nativeNetworkFetch); routed(api, t); let recoveries = 0;
  api.setAuthRecovery({token: async () => { api.setAccessToken('fresh'); return 'fresh'; }, recover: async () => { recoveries++; api.setAccessToken('newer'); return 'newer'; }});
  const client = new IdentityClient(api, profileAvatarUpload(api));
  await assert.rejects(client.uploadAvatar('p1', bytes, 'image/png'), (e: {status?: number}) => e.status === 401);
  assert.equal(recoveries, 1);
  assert.deepEqual(sent.map(w => w.headers.authorization), ['Bearer fresh', 'Bearer newer']);
  await client.removeAvatar('p1');
  assert.equal(sent.at(-1)!.method, 'DELETE'); assert.equal(sent.at(-1)!.url, lan + path);
});

test('the secure profile transport carries the envelope and preserves upload refusals', async t => {
  noRawFetch(t);
  const sent = runtime(() => ({status: 415, body: {error: {code: 'invalid_avatar', message: 'Unsupported picture.'}}}));
  const api = profileAPI(logical, 'token');
  await assert.rejects(new IdentityClient(api, profileAvatarUpload(api)).uploadAvatar('p1', bytes, 'image/webp'), (e: {status?: number; code?: string}) => e.status === 415 && e.code === 'invalid_avatar');
  assert.equal(sent[0]!.transport, 'profileRequest'); assert.equal(sent[0]!.headers['content-type'], 'image/webp');
  assert.deepEqual(Buffer.from(JSON.parse(sent[0]!.body!).nativeAvatarBase64, 'base64'), Buffer.from(bytes));
});

test('identity refusal sends no bearer; a network failure never replays an upload', async t => {
  const sent = runtime(() => { throw new Error('socket closed'); });
  const api = new HttpLocalApi(logical, 'token', nativeNetworkFetch);
  const connection = routed(api, t, async () => { throw new RouteError('identity_mismatch', 'Wrong server'); });
  await assert.rejects(profileAvatarUpload(api)(path, bytes, 'image/png')); assert.equal(sent.length, 0); connection.dispose();
  const working = new HttpLocalApi(logical, 'token-2', nativeNetworkFetch); routed(working, t);
  await assert.rejects(profileAvatarUpload(working)(path, bytes, 'image/png'), /socket closed/); assert.equal(sent.length, 1);
});

test('picture sources follow a changed verified route and stay absent during its probe', async t => {
  const alternate = 'https://192.168.1.21:32500';
  let allowed = lan, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = new HttpLocalApi(logical, 'token', nativeNetworkFetch);
  const connection = routed(api, t, async origin => {
    if (origin !== allowed) throw new Error('Route offline');
    if (origin === alternate) await gate;
    return {};
  });
  let source: unknown;
  const host = createHookHost(() => { useAvatarRoute(api); source = profilePictureSource(api, 'token', avatar, 160); });
  t.after(() => host.unmount()); host.mount(); assert.equal(source, undefined);
  await act(async () => { await connection.resolve(); });
  assert.deepEqual(source, {uri: lan + avatar.url + '&size=160', headers: {Authorization: 'Bearer token'}});
  assert.equal(profilePictureSource(api, 'token', {...avatar, url: 'https://elsewhere.test/picture'}, 160), undefined);
  assert.equal(profilePictureSource(api, undefined, avatar, 160), undefined);
  connection.rememberPaired(alternate); allowed = alternate;
  await act(async () => { connection.networkChanged('wifi-2'); });
  assert.equal(source, undefined, 'no bearer-bearing image while the next route is unverified');
  await act(async () => { release(); await connection.resolve(); });
  assert.deepEqual(source, {uri: alternate + avatar.url + '&size=160', headers: {Authorization: 'Bearer token'}});
});

test('upload rejects invalid sizes and paths before sending; full-size binary data survives encoding', async () => {
  const calls: unknown[] = [];
  const upload = profileAvatarUpload({requestRaw: async (_path, _method, options) => { calls.push(options); return {status: 200, headers: {}, body: avatar}; }});
  await assert.rejects(upload('https://elsewhere.test' + path, bytes, 'image/png'), /path/);
  await assert.rejects(upload(path, new Uint8Array(0), 'image/png'), /size/);
  await assert.rejects(upload(path, new Uint8Array(4194305), 'image/png'), /size/); assert.equal(calls.length, 0);
  const full = new Uint8Array(4194304).fill(255); await upload(path, full, 'image/png');
  assert.deepEqual(Buffer.from((calls[0] as {body: {nativeAvatarBase64: string}}).body.nativeAvatarBase64, 'base64'), Buffer.from(full));
});

test('both screens use routed helpers; native byte decoding is limited to bounded avatar POSTs', () => {
  const profiles = readFileSync(new URL('../src/screens/Profiles.tsx', import.meta.url), 'utf8');
  const chooser = readFileSync(new URL('../src/screens/auth/ProfileAvatar.tsx', import.meta.url), 'utf8');
  for (const source of [profiles, chooser]) {
    assert.match(source, /profilePictureSource\(/); assert.match(source, /useAvatarRoute\(api\)/); assert.doesNotMatch(source, /api!?\.baseUrl\s*\+/);
  }
  assert.match(profiles, /profileAvatarUpload\(api!\)/); assert.doesNotMatch(profiles, /await fetch\(/);
  const apple = readFileSync(new URL('../Native/PorticoPlayer.m', import.meta.url), 'utf8');
  const android = readFileSync(new URL('../android/app/src/main/java/tv/getportico/portico/native/PorticoRuntime.kt', import.meta.url), 'utf8');
  assert.equal(apple.match(/BOOL avatar=PorticoAvatarUploadPath\(target.path,method\)/g)?.length, 2); assert.match(apple, /data.length>0&&data.length<=4194304/);
  assert.equal(android.match(/val avatar = avatarUploadPath\(/g)?.length, 2); assert.match(android, /it.isNotEmpty\(\) && it.size <= 4194304/);
});
