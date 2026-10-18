import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {act, createHookHost} from './hook-driver.ts';
import {auth, profileAPI} from './session-hook-stub.mjs';
import {selectedViewerRecord} from '../../../packages/client-core/src/viewer-selection.ts';
register(new URL('./session-hook-loader.mjs', import.meta.url));
(globalThis as {__DEV__?: boolean}).__DEV__ = false;
const {SessionProvider, viewer} = await import('../src/app/session.tsx');
const session = {accessToken: 'access', refreshToken: 'r'.repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString(), sessionFamilyId: 'family', tokenGeneration: '1', authorizationHorizon: new Date(Date.now() + 1200000).toISOString(), deviceId: 'device', viewer: {authority: 'local', accountId: 'account', profileId: 'profile', serverId: 'server', role: 'owner'}};
for (const exit of ['signOut', 'useAnother', 'forgetSaved', 'signInAgain', 'unmount'] as const) {
  test(`a saved-session restore answering after ${exit} cannot select its viewer`, async () => {
    viewer.clear();
    auth.saved = selectedViewerRecord('http://server.test', session) as any;
    auth.chosen = session as any;
    auth.writes = []; auth.revoked = []; auth.me = undefined;
    let resolve!: (value: any) => void;
    const held = new Promise(resolveTask => {resolve = resolveTask;});
    auth.restore = () => held;
    let current: any;
    const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
    try {
      await act(() => host.mount());
      assert.equal(current.saved.state, 'checking');
      await act(() => { if (exit === 'unmount') host.unmount(); else if (exit === 'signOut') current.signOut(); else if (exit !== 'forgetSaved') current.saved?.[exit === 'useAnother' ? 'useAnother' : 'signInAgain']?.(); if (exit === 'forgetSaved') current.forgetSaved(); });
      await act(() => resolve({api: profileAPI('http://server.test', 'restored-access'), session: {...session, accessToken: 'restored-access', tokenGeneration: '2'}}));
      assert.notEqual(viewer.getSnapshot().session?.accessToken, 'restored-access');
      if (exit === 'useAnother') assert.ok(auth.saved, 'the remembered sign-in stays available');
      if (exit === 'signOut') assert.equal(auth.saved, null);
    } finally {await act(() => {current?.signOut(); host.unmount();}); viewer.clear();}
  });
}

test('a current saved-session restore is still verified, stored and published', async () => {
  viewer.clear();
  auth.saved = selectedViewerRecord('http://server.test', session) as any;
  auth.chosen = session as any;
  auth.revoked = []; auth.me = undefined;
  const refreshed = {...session, accessToken: 'current-access', tokenGeneration: '2'};
  auth.restore = async () => ({api: profileAPI('http://server.test', 'current-access'), session: refreshed});
  let current: any;
  const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
  try {
    await act(() => host.mount());
    assert.equal(viewer.getSnapshot().session?.accessToken, 'current-access');
    assert.equal((auth.saved as any).session.accessToken, 'current-access');
    assert.deepEqual(auth.revoked, [], 'a rotation within the established family is never a logout');
  } finally {await act(() => {current.signOut(); host.unmount();}); viewer.clear();}
});

for (const exit of ['signOut', 'useAnother'] as const) {
  test(`verification answering after ${exit} cannot publish or restore a viewer`, async () => {
    viewer.clear();
    const original = selectedViewerRecord('http://server.test', session);
    auth.saved = original as any; auth.chosen = session as any; auth.revoked = []; auth.writes = [];
    let resolve!: (value: any) => void;
    auth.me = () => new Promise(done => {resolve = done;});
    auth.restore = async () => ({api: profileAPI('http://server.test', 'verified-late'), session: {...session, accessToken: 'verified-late', tokenGeneration: '2'}});
    let current: any;
    const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
    try {
      await act(() => host.mount());
      assert.equal(auth.writes.at(-1)?.session.accessToken, 'verified-late', 'the candidate reached durable verification');
      await act(() => {if (exit === 'signOut') current.signOut(); else current.saved.useAnother();});
      await act(() => resolve({viewer: session.viewer}));
      assert.equal(viewer.getSnapshot().session, undefined);
      if (exit === 'useAnother') assert.equal(auth.saved?.session.accessToken, original.session.accessToken);
      else assert.equal(auth.saved, null);
      assert.equal(auth.revoked.includes('verified-late'), false, 'the retained family was not revoked');
    } finally {auth.me = undefined; await act(() => {current.signOut(); host.unmount();}); viewer.clear();}
  });
}

for (const late of [false, true]) {
  test(`Vega exposure ends the live sign-in and fences ${late ? 'a delayed restore' : 'the selected viewer'}`, async () => {
    const {NativeModules} = await import('./react-native-stub.mjs');
    const runtime = NativeModules.PorticoRuntime as any;
    let exposed: ((event: {origin: string}) => void) | undefined;
    runtime.onCredentialExposure = (listener: typeof exposed) => {exposed = listener; return () => {exposed = undefined;};};
    runtime.credentialExposureMessage = () => 'The connection disclosed sign-in details.';
    viewer.clear();
    auth.saved = selectedViewerRecord('http://server.test', session) as any;
    auth.chosen = session as any; auth.me = undefined;
    let resolve!: (value: any) => void;
    auth.restore = late ? () => new Promise(done => {resolve = done;}) : async () => ({api: profileAPI('http://server.test', session.accessToken), session});
    let current: any;
    const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
    try {
      await act(() => host.mount());
      assert.ok(exposed, 'the provider subscribes to platform exposure containment');
      await act(() => exposed!({origin: 'http://server.test'}));
      if (late) await act(() => resolve({api: profileAPI('http://server.test', 'late-exposed'), session: {...session, accessToken: 'late-exposed'}}));
      assert.equal(viewer.getSnapshot().session, undefined);
      assert.equal(auth.saved, null);
      assert.equal(current.signInNote, 'The connection disclosed sign-in details.');
    } finally {
      await act(() => host.unmount()); viewer.clear();
      delete runtime.onCredentialExposure; delete runtime.credentialExposureMessage;
    }
  });
}

test('Android and Apple report no exposure (their transports refuse redirects): without the hook nothing is ended', async () => {
  const {NativeModules} = await import('./react-native-stub.mjs');
  const runtime = NativeModules.PorticoRuntime as any;
  assert.equal(runtime.onCredentialExposure, undefined);
  viewer.clear();
  auth.saved = selectedViewerRecord('http://server.test', session) as any;
  auth.chosen = session as any; auth.me = undefined; auth.revoked = [];
  auth.restore = async () => ({api: profileAPI('http://server.test', session.accessToken), session});
  let current: any;
  const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
  try {
    await act(() => host.mount());
    assert.equal(viewer.getSnapshot().session?.accessToken, session.accessToken);
    assert.equal(current.signInNote, undefined);
    assert.deepEqual(auth.revoked, []);
  } finally {await act(() => {current.signOut(); host.unmount();}); viewer.clear();}
});
