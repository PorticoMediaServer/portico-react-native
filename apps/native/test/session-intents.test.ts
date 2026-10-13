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
    auth.writes = []; auth.revoked = [];
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
  auth.revoked = [];
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
