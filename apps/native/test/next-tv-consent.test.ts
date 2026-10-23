import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeModules} from './react-native-stub.mjs';
import {HttpLocalApi, type LocalSession} from '../../../packages/client-core/src';
import {nativeNetworkFetch} from '../src-next/platform/server-connections.ts';
import {nativeAppSessionStorage} from '../src-next/platform/app-session-storage.ts';
import {NativeAccounts} from '../src-next/platform/accounts.ts';

const origin = 'https://local-tv.test';
const session: LocalSession = {accessToken: 'synthetic_tv_access', refreshToken: 'synthetic_tv_refresh', installationId: 'native_tv_0123456789abcdef0123456789',
  expiresAt: new Date(Date.now() + 3600000).toISOString(), authorizationHorizon: new Date(Date.now() + 86400000).toISOString(),
  sessionFamilyId: 'local_tv_family', tokenGeneration: '1', viewer: {authority: 'local', serverId: 'local_tv', accountId: 'local_person', profileId: 'kids', role: 'member'}};

test('native Quick Connect consent uses the same selected local account even on a non-main profile', async () => {
  let record: string | null = null;
  const calls: {url: string; body: Record<string, string>; headers: Record<string, string>}[] = [];
  NativeModules.PorticoRuntime.loadQueueRecord = async () => record;
  NativeModules.PorticoRuntime.saveQueueRecord = async (_key: string, raw: string) => {record = raw;};
  NativeModules.PorticoRuntime.networkRequest = async (_id: string, url: string, _method: string, headers: Record<string, string>, body: string) => {
    calls.push({url, body: JSON.parse(body), headers});
    return {status: url.endsWith('/review') ? 200 : 204, headers: {}, body: url.endsWith('/review') ? JSON.stringify({requestId: 'request_tv', userCode: 'ABCD-EFGH',
      deviceName: 'Synthetic TV', platform: 'androidtv', appVersion: '1', expiresAt: new Date(Date.now() + 60000).toISOString()}) : ''};
  };
  await nativeAppSessionStorage.change(() => ({version: 1, revision: 1, selectedServerId: 'local_tv', servers: [{signIn: 'local', connection: {
    version: '1', logicalOrigin: origin, session, pin: {serverId: 'local_tv', publicKey: 'p'.repeat(43), fingerprint: 'f'.repeat(43)}, routes: {paired: [origin]},
  }}]}));
  const api = new HttpLocalApi(origin, session.accessToken, nativeNetworkFetch);
  api.getRouteConnection = () => ({pin: {serverId: 'local_tv'}} as ReturnType<HttpLocalApi['getRouteConnection']>);
  const owner = new NativeAccounts(); let current: LocalSession | undefined = session;
  const consent = await owner.localTVConsent(api, () => current);
  try {
    const preview = await consent.review('abcd efgh');
    await consent.decide(preview, 'approve');
    assert.deepEqual(calls.map(value => value.url), [origin + '/v1/quick-connect/review', origin + '/v1/quick-connect/decision']);
    assert.equal(calls[1].body.decision, 'approve');
    assert.equal(calls[1].headers.authorization, 'Bearer synthetic_tv_access');
    const stale = await consent.review('ABCD-EFGH');
    current = {...session, viewer: {...session.viewer, accountId: 'another_person'}};
    await assert.rejects(consent.decide(stale, 'approve'), (error: {code?: string}) => error.code === 'consent_retired');
    assert.equal(calls.length, 3, 'a changed account never sends a decision');
  } finally {consent.dispose(); owner.dispose();}
});
