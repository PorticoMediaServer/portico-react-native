import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

// Synthetic native module boundary; every production parser, signed proof, transport and store runs.
test('current native local sign-in probes before credentials, verifies the pin and selects a server profile', async t => {
  let kind = 'local', suffix = '', held: (() => void) | undefined;
  const app = await standardHomeApp({setup: true, setupResponse: async (request: any, f: any) => {
    if (request.path === '/v1/system') return {status: 200, body: {id: f.pin.serverId, name: 'Synthetic local server', signIn: kind,
      version: '1', setupRequired: false, hostedConfigured: false, hostedAttached: false}};
    const snapshot = {authority: 'local', serverId: f.pin.serverId, canManage: true,
      capabilities: {manageAccount: true, managePeople: false, manageServer: false, manageSignIn: false},
      account: {id: 'account', username: 'synthetic_user', primaryProfileId: 'profile', role: 'member', revision: 1, disabled: false, allowedLibraries: []},
      profiles: [{id: 'profile', name: 'Actual server profile', primary: true, position: 0, art: 'mint', revision: 1, pinRevision: 1, pinRequired: true}]};
    if (request.path === '/v1/direct/sign-in') {
      if (request.body.password !== 'synthetic_password') return {status: 401, body: {error: {code: 'invalid_credentials'}}};
      return {status: 200, body: {...snapshot, session: {...f.session, accessToken: 'account_access' + suffix, sessionFamilyId: 'current_account' + suffix, viewer: {...f.viewer, role: 'account'}}}};
    }
    if (request.path === '/v1/direct/profiles/profile/select') {
      assert.equal(request.body.installationId, f.installationId);
      if (request.body.pin !== '1234') return {status: 401, body: {error: {code: 'profile_pin_invalid'}}};
      return {status: 200, body: {session: {...f.session, accessToken: 'viewer_access' + suffix, sessionFamilyId: 'current_viewer' + suffix}}};
    }
    if (request.path === '/v1/me') {
      if (held) await new Promise<void>(resolve => {held = resolve;});
      return {status: 200, body: {viewer: f.viewer}};
    }
    if (request.path === '/v1/sessions/current') return {status: 204};
    return undefined;
  }});
  const {NativeServerSignIn} = await import('../src-next/platform/server-sign-in.ts');
  const {nativeAppSessions, readNativeSelectedViewer} = await import('../src-next/platform/app-session-storage.ts');
  try {
    await t.test('Portico destination never exposes a local credential command', async () => {
      kind = 'portico'; const signIn = new NativeServerSignIn(), before = app.requests.length;
      try {
        assert.equal((await signIn.inspect('https://standard-home.test')).signIn, 'portico');
        await assert.rejects(signIn.inspectLocalIdentity(), (error: {code?: string}) => error.code === 'sign_in_kind_portico');
        await assert.rejects(signIn.signInLocal('person', 'secret'));
        assert.deepEqual(app.requests.slice(before).map((request: any) => request.path), ['/v1/system']);
      } finally {signIn.dispose();}
    });
    await t.test('local profile and PIN use the server session without Hosted IO', async () => {
      kind = 'local'; const signIn = new NativeServerSignIn(), before = app.requests.length;
      try {
        await signIn.inspect('https://standard-home.test');
        const pin = await signIn.inspectLocalIdentity(); await signIn.confirmLocal(pin);
        await assert.rejects(signIn.signInLocal('synthetic_user', 'wrong'));
        const result = await signIn.signInLocal('synthetic_user', 'synthetic_password');
        assert.equal(result.kind, 'profiles');
        if (result.kind === 'profiles') assert.equal(result.profiles[0].name, 'Actual server profile');
        assert.equal((await nativeAppSessions.read()).servers.length, 0);
        await assert.rejects(signIn.chooseProfile('profile', '0000'));
        await signIn.chooseProfile('profile', '1234');
        const saved = await readNativeSelectedViewer();
        assert.equal(saved?.session.sessionFamilyId, 'current_viewer');
        assert.equal(saved?.session.refreshToken, undefined);
        assert.equal((await nativeAppSessions.selected())?.connection.session.refreshToken, 'fixture_refresh_only');
        assert.equal(app.requests.slice(before).filter((r: any) => r.path === '/v1/sessions/current').length, 1, 'temporary account family retired once');
      } finally {signIn.dispose(); await app.settle();}
      assert.equal((await nativeAppSessions.selected())?.connection.session.sessionFamilyId, 'current_viewer', 'disposal preserves published viewer');
    });
    await t.test('a new sign-in on the same server retires only the exact previous viewer and temporary account', async () => {
      suffix = '_replacement'; const signIn = new NativeServerSignIn(), before = app.requests.length;
      try {
        await signIn.inspect('https://standard-home.test'); await signIn.confirmLocal(await signIn.inspectLocalIdentity());
        await signIn.signInLocal('synthetic_user', 'synthetic_password'); await signIn.chooseProfile('profile', '1234');
        assert.equal((await nativeAppSessions.selected())?.connection.session.sessionFamilyId, 'current_viewer_replacement');
        const retired = app.requests.slice(before).filter((request: any) => request.path === '/v1/sessions/current').map((request: any) => new Headers(request.headers).get('Authorization'));
        assert.deepEqual(retired.sort(), ['Bearer account_access_replacement', 'Bearer viewer_access']);
      } finally {signIn.dispose(); await app.settle();}
      assert.equal((await nativeAppSessions.read()).servers.length, 1);
    });
  } finally {held?.(); await app.unmount(); app.disposeLoader();}
});
