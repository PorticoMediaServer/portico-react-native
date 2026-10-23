import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

test('normal product entry signs in locally through actual React/native bridges and restores its canonical selected profile', async () => {
  let kind = 'portico';
  const app = await standardHomeApp({mountUI: false, nativeResponse: async (request: any, f: any) => {
    if (request.path === '/v1/system') return {status: 200, body: {id: f.pin.serverId, name: 'Synthetic living room', version: '1', move: null, signIn: kind,
      setupRequired: false, hostedConfigured: kind === 'portico', hostedAttached: kind === 'portico'}};
    if (request.path === '/v1/direct/sign-in') {
      assert.equal(kind, 'local'); assert.equal(request.body.username, 'synthetic_user');
      assert.equal(request.body.password, 'synthetic_password');
      return {status: 200, body: {authority: 'local', serverId: f.pin.serverId, canManage: true,
        capabilities: {manageAccount: true, managePeople: true, manageServer: true, manageSignIn: true},
        account: {id: 'account', username: 'synthetic_user', primaryProfileId: 'profile', role: 'owner', revision: 1, disabled: false, allowedLibraries: ['movies']},
        profiles: [{id: 'profile', name: 'Synthetic viewer', primary: true, position: 0, art: 'mint', revision: 1, pinRevision: 1, pinRequired: true}],
        session: {...f.session, sessionFamilyId: 'temporary_account', viewer: {...f.viewer, role: 'account'}}}};
    }
    if (request.path === '/v1/direct/profiles/profile/select') {
      assert.equal(request.body.pin, '1234'); assert.equal(request.body.installationId, f.installationId);
      return {status: 200, body: {session: {...f.session, sessionFamilyId: 'new_selected_family'}}};
    }
    if (request.path === '/v1/sessions/current') return {status: 204};
    return undefined;
  }});
  try {
    app.resetSyntheticStorage(); await app.mount();
    assert.equal(app.requests.length, 0, 'empty local startup never synchronizes Portico credentials or contacts Hosted');
    await app.tapLabel('Use a local server'); await app.fill('Server address', 'https://standard-home.test'); await app.tapLabel('Continue');
    assert.ok(app.hosts().some((host: any) => app.nativeLabel(host) === 'Synthetic living room uses Portico Accounts'));
    assert.equal(app.hosts().some((host: any) => host.name === 'TextInput' && host.props.accessibilityLabel === 'Password'), false);
    assert.deepEqual(app.requests.map((request: any) => request.path), ['/v1/system']);
    await app.tapLabel('Back'); kind = 'local';
    await app.tapLabel('Use a local server'); await app.fill('Server address', 'https://standard-home.test'); await app.tapLabel('Continue');
    assert.ok(app.hosts().some((host: any) => app.nativeLabel(host) === 'Use an account that lives on this server.'));
    assert.ok(app.hosts().some((host: any) => app.nativeLabel(host) === 'Sign in to'));
    await app.fill('Username', 'synthetic_user'); await app.fill('Password', 'synthetic_password'); await app.tapLabel('Sign in');
    assert.ok(app.hosts().some((host: any) => host.name === 'Text' && app.nativeLabel(host) === 'Who’s watching on Synthetic living room?'));
    await app.tapLabel('Synthetic viewer'); await app.fill('Four-digit PIN', '1234'); await app.tapLabel('Continue');
    const {nativeAppSessions} = await import('../src-next/platform/app-session-storage.ts');
    const saved = await nativeAppSessions.selected();
    assert.equal(saved?.connection.session.sessionFamilyId, 'new_selected_family');
    assert.equal(saved?.signIn, 'local');
    assert.ok(app.card(), 'genuine normal Home restored after durable publication');
    assert.ok(app.requests.every((request: any) => request.url.startsWith('https://standard-home.test')));
    assert.equal(app.requests.filter((request: any) => request.path === '/v1/sessions/current').length, 1, 'temporary account family is retired once, viewer stays');
  } finally {await app.unmount(); app.disposeLoader();}
});


test('the identity-code prompt keeps the complete address as typed and cannot display a claimed server name', async () => {
  const {hooks, screenModule} = await import('./helpers/screen-harness.mjs');
  const {defaultI18n} = await import('../../../packages/i18n/src');
  const {createTheme} = await import('../src-next/kit/theme');
  const {routeOrigin} = await import('../../../packages/client-core/src/route-identity');
  const h = hooks(), typed = 'https://Media.Example.com:8443/';
  const inspected: string[] = [];
  class SignIn {
    async inspect(address: string) {inspected.push(address); return undefined;}
    needsIdentityCode() {return true;}
    dispose() {}
  }
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), {
    react: h.react, 'react-native': {BackHandler: {}, NativeModules: {}, Platform: {isTV: false}, Text: 'Text', View: 'View'},
    'react-native-qrcode-svg': {default: 'QR'}, '../../../../../packages/client-core/src': {},
    '../../../../../packages/client-core/src/sign-in': {}, '../../../../../packages/client-core/src/route-identity': {routeOrigin},
    '../../../../../packages/client-core/src/hosted-security': {}, '../../../../../packages/client-core/src/presentation/errors': {},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/states': {StateLayout: 'StateLayout'},
    '../../kit/controls': {Button: 'Button', TextField: 'TextField'}, '../../kit/artwork': {}, '../../kit/theme': {useTheme: () => createTheme({isTV: false, width: 390})},
    '../../platform/accounts': {}, '../../platform/server-sign-in': {NativeServerSignIn: SignIn}, '../../platform/portico-sign-in': {},
    '../../platform/server-connections': {}, '../../platform/tv-sign-in': {}, '../../platform/account-authority': {},
  });
  const render = () => h.render(() => AccountEntry({onComplete() {throw new Error('code has not matched');}, initialStage: 'address', initialAddress: typed}));
  render().props.primaryAction.onPress();
  await new Promise<void>(resolve => setImmediate(resolve));
  const prompt = render();
  assert.deepEqual(inspected, [typed]);
  assert.equal(prompt.props.testID, 'accounts-identity-code');
  assert.equal(prompt.props.title, `Check this is ${typed}`);
});

test('local TV consent names the verified server and the issuing service verification address', async () => {
  const {hooks, screenModule} = await import('./helpers/screen-harness.mjs');
  const {defaultI18n} = await import('../../../packages/i18n/src');
  const {createTheme} = await import('../src-next/kit/theme');
  const h = hooks(), server = {id: 'synthetic-server', name: 'Verified synthetic server', signIn: 'local'};
  const verificationUri = 'https://verified.example/device';
  let notify = () => {};
  const service = {subscribe: (listener: () => void) => {notify = listener; return () => {};},
    getSnapshot: () => ({phase: 'waiting', userCode: 'ABCD-EFGH', verificationUri, verificationUriComplete: verificationUri + '?code=ABCD-EFGH'}),
    start: async () => {notify();}};
  class SignIn {
    async inspect() {return server;}
    needsIdentityCode() {return false;}
    async inspectLocalIdentity() {}
    async confirmLocal() {}
    serverDescriptor() {return server;}
    localTVSignIn() {return service;}
    dispose() {}
  }
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), {
    react: h.react, 'react-native': {BackHandler: {}, NativeModules: {}, Platform: {isTV: true}, Text: 'Text', View: 'View'},
    'react-native-qrcode-svg': {default: 'QR'}, '../../../../../packages/client-core/src': {},
    '../../../../../packages/client-core/src/sign-in': {}, '../../../../../packages/client-core/src/route-identity': {},
    '../../../../../packages/client-core/src/hosted-security': {}, '../../../../../packages/client-core/src/presentation/errors': {},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/states': {StateLayout: 'StateLayout'},
    '../../kit/controls': {Button: 'Button', TextField: 'TextField'}, '../../kit/artwork': {}, '../../kit/theme': {useTheme: () => createTheme({isTV: true, width: 1920})},
    '../../platform/accounts': {}, '../../platform/server-sign-in': {NativeServerSignIn: SignIn}, '../../platform/portico-sign-in': {},
    '../../platform/server-connections': {}, '../../platform/tv-sign-in': {}, '../../platform/account-authority': {},
  });
  const render = () => h.render(() => AccountEntry({onComplete() {throw new Error('consent is still pending');}, initialStage: 'address', initialAddress: 'https://verified.example'}));
  render().props.primaryAction.onPress();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(render().props.body, `On a phone signed in to ${server.name}, open Portico › Settings › Link a TV, or on a computer open ${verificationUri}.`);
});
