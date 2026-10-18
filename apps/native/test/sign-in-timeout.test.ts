/** NS-08: a direct sign-in that runs out of time or is abandoned stops its new viewer's check at once. */
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {act, createHookHost} from './hook-driver.ts';
import {auth, profileAPI} from './session-hook-stub.mjs';
import {direct} from './session-direct-stub.mjs';
import {selectedViewerRecord} from '../../../packages/client-core/src/viewer-selection.ts';
register(new URL('./session-hook-loader.mjs', import.meta.url));
register(new URL('./session-direct-loader.mjs', import.meta.url));
(globalThis as {__DEV__?: boolean}).__DEV__ = false;
const {SessionProvider, viewer} = await import('../src/app/session.tsx');
const {activeI18n} = await import('../src/app/errors.ts');

const viewerOf = {authority: 'local', accountId: 'account', profileId: 'profile', serverId: 'server', role: 'owner'};
const session = (accessToken: string, sessionFamilyId: string) => ({accessToken, refreshToken: 'r'.repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString(), sessionFamilyId, tokenGeneration: '1', authorizationHorizon: new Date(Date.now() + 1200000).toISOString(), deviceId: 'device', viewer: viewerOf});

/** Mounts the provider with nothing saved and a direct sign-in whose `/v1/me` check never answers by itself. */
async function signingIn(t: TestContext) {
  t.mock.timers.enable({apis: ['setTimeout']});
  viewer.clear();
  auth.saved = null; auth.writes = []; auth.revoked = []; auth.chosen = {viewer: viewerOf};
  const checks: AbortSignal[] = [];
  auth.me = signal => { checks.push(signal!); return new Promise(() => {}); };
  direct.result = {kind: 'signed-in', session: session('fresh-access', 'fresh-family'), accountScoped: false, passwordChangeRequired: false};
  let current: any;
  const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
  await act(() => host.mount());
  await act(() => current.direct.setOrigin('server.test'));
  const signIn = current.direct.signIn('person', 'password') as Promise<void>;
  await act(() => {});
  assert.equal(checks.length, 1, 'the new viewer reached its server check');
  assert.equal(auth.writes.at(-1)?.session.accessToken, 'fresh-access');
  assert.equal(current.busy, true);
  return {checks, signIn, get current() { return current; }, host};
}

async function settled(run: Awaited<ReturnType<typeof signingIn>>) {
  await act(() => {});
  assert.equal(run.checks[0]!.aborted, true, 'the server check was stopped');
  await run.signIn;
  assert.equal(run.current.busy, false, 'Sign in is ready again');
  assert.equal(viewer.getSnapshot().session, undefined, 'nothing was published');
  assert.equal(auth.saved, null, 'the saved selection is what it was');
  assert.ok(auth.revoked.includes('fresh-access'), 'the unused new sign-in is retired');
}

test('running out of time stops the new viewer\'s server check, not just the spinner', async t => {
  const run = await signingIn(t);
  try {
    t.mock.timers.tick(15000);
    await settled(run);
    assert.equal(run.current.error, activeI18n().t('error.timeout'));
  } finally {auth.me = undefined; await act(() => run.host.unmount()); viewer.clear();}
});

test('abandoning the sign-in (an edited detail) stops the check the same way, silently', async t => {
  const run = await signingIn(t);
  try {
    await act(() => run.current.direct.cancel());
    await settled(run);
    assert.equal(run.current.error, '');
  } finally {auth.me = undefined; await act(() => run.host.unmount()); viewer.clear();}
});

test('a saved sign-in being restored keeps its check past the deadline and is never retired', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  viewer.clear();
  const saved = session('saved-access', 'family');
  auth.saved = selectedViewerRecord('http://server.test', saved) as any;
  auth.chosen = saved as any; auth.writes = []; auth.revoked = [];
  const checks: AbortSignal[] = [];
  let answer!: (value: unknown) => void;
  auth.me = signal => { checks.push(signal!); return new Promise(resolve => {answer = resolve;}); };
  const renewed = {...saved, accessToken: 'renewed-access', tokenGeneration: '2'};
  auth.restore = async () => ({api: profileAPI('http://server.test', 'renewed-access'), session: renewed});
  let current: any;
  const host = createHookHost(() => {current = (SessionProvider({children: null}) as any).props.value;});
  try {
    await act(() => host.mount());
    assert.equal(checks.length, 1);
    await act(() => current.direct.cancel());
    t.mock.timers.tick(15000);
    await act(() => {});
    assert.equal(checks[0]!.aborted, false, 'neither the resume deadline nor a direct cancel stops a restore');
    await act(() => answer({viewer: saved.viewer}));
    assert.equal(viewer.getSnapshot().session?.accessToken, 'renewed-access');
    assert.equal((auth.saved as any)?.session.accessToken, 'renewed-access');
    assert.deepEqual(auth.revoked, [], 'the restored family is never revoked');
  } finally {auth.me = undefined; await act(() => {current.signOut(); host.unmount();}); viewer.clear();}
});
