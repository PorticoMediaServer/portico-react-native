import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {routeOrigin} from '../../../packages/client-core/src/route-identity';
import {createTheme} from '../src-next/kit/theme';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const profile = {id: 'locked', name: 'Actual locked profile', art: 'mint', primary: false, pinRequired: true};
const theme = createTheme({isTV: true, width: 1920});
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
function backOwner() {
  const listeners = new Set<() => boolean>();
  return {listeners, api: {addEventListener: (_: string, handler: () => boolean) => {listeners.add(handler); return {remove: () => listeners.delete(handler)};}}};
}
const shared = (back: ReturnType<typeof backOwner>) => ({
  react: {...React, default: React},
  'react-native': {BackHandler: back.api, Platform: {isTV: true}, NativeModules: {}, View: 'View', Text: 'Text', ScrollView: 'ScrollView'},
  '../../../../../packages/i18n/src': {defaultI18n},
  '../../../../../packages/client-core/src/route-identity': {routeOrigin},
  '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'PIN refused'})},
  '../../kit/theme': {useTheme: () => theme}, '../../kit/states': {StateLayout: 'Layout'},
  '../../kit/controls': {Button: 'Button', TextField: 'Field'}, '../../kit/artwork': {ProfilePicker: 'Picker'},
  '../../tv/auth': {TVProfilePINForm: 'PIN', TVForgotPINHandoff: 'Forgot', TVFrontDoor: 'Front', TVCodePresenter: 'Code',
    TVCredentialForm: 'Credentials', TVVerificationForm: 'Factor', TVRequiredSetupHandoff: 'Required'},
});

test('TV entry Forgot PIN keeps the same account operation and returns to the same pad with empty boxes', async () => {
  const back = backOwner(), calls: string[] = [];
  const service = {subscribe: () => () => {}, getSnapshot: () => ({phase: 'pending'}), start: async () => {},
    cancel: async () => {calls.push('cancel-code');}, pause: () => {calls.push('pause-code');}};
  class SignIn {
    constructor() {calls.push('create');}
    async inspect() {return {id: 'server', name: 'Verified server', signIn: 'local'};}
    needsIdentityCode() {return false;}
    async inspectLocalIdentity() {return {};}
    async confirmLocal() {}
    serverDescriptor() {return {id: 'server', name: 'Verified server', signIn: 'local'};}
    serverOrigin() {return 'https://verified.example';}
    localTVSignIn() {return service;}
    async signInLocal() {calls.push('credentials'); return {kind: 'profiles', profiles: [profile]};}
    async chooseProfile() {calls.push('select');}
    dispose() {calls.push('dispose');}
  }
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), {
    ...shared(back), '../../../../../packages/client-core/src': {},
    '../../../../../packages/client-core/src/sign-in': {},
    '../../../../../packages/client-core/src/hosted-security': {MFARequiredError: class extends Error {}},
    '../../platform/accounts': {nativeAccounts: {}}, '../../platform/server-sign-in': {NativeServerSignIn: SignIn},
    '../../platform/portico-sign-in': {}, '../../platform/server-connections': {browseNearby: async () => []},
    '../../platform/tv-sign-in': {}, '../../platform/account-authority': {}, 'react-native-qrcode-svg': {default: 'QR'},
    './PhoneFrontDoor': {PhoneFrontDoor: 'Phone'},
  });
  let tree: any;
  const host = createHookHost(() => {tree = AccountEntry({onComplete: () => {calls.push('complete');}});});
  await act(() => host.mount());
  try {
    await act(() => tree.props.onLocal());
    await act(() => nodes(tree.props.beforeActions).find(n => n.type === 'Field').props.onChangeText('https://verified.example'));
    await act(() => tree.props.primaryAction.onPress());
    assert.equal(tree.type, 'Code');
    await act(() => tree.props.onTypeCredentials());
    assert.equal(tree.type, 'Credentials');
    await act(() => {tree.props.onUsernameChange('person'); tree.props.onPasswordChange('test password');});
    await act(() => tree.props.onSubmit());
    await act(() => nodes(tree.props.beforeActions).find(n => n.type === 'Picker').props.onSelect(profile.id));
    assert.equal(tree.type, 'PIN');
    await act(() => tree.props.onCodeChange('12'));
    const baseline = [...calls];
    await act(() => tree.props.onForgotPIN());
    assert.equal(tree.type, 'Forgot');
    assert.equal(tree.props.profileName, profile.name);
    assert.equal(tree.props.url, 'https://verified.example/settings/profile');
    assert.equal(tree.props.body, 'next.auth.tv.forgotPINBody');
    assert.deepEqual(calls, baseline, 'opening the public hand-off has no sign-out, selection, polling or operation retirement');
    await act(() => tree.props.onBack());
    assert.equal(tree.type, 'PIN'); assert.equal(tree.props.profile.id, profile.id); assert.equal(tree.props.code, '');
    await act(() => tree.props.onForgotPIN());
    await act(() => {assert.equal([...back.listeners][0]!(), true);});
    assert.equal(tree.type, 'PIN'); assert.equal(tree.props.code, '');
    assert.deepEqual(calls, baseline);
  } finally {host.unmount();}
  assert.equal(calls.filter(c => c === 'dispose').length, 1, 'the operation retires only at actual entry unmount');
});

test('TV profile-switch hand-off preserves its current family, selection controller and server PIN attempts', async () => {
  const back = backOwner(), attempts: unknown[][] = [];
  let created = 0, disposed = 0, exited = 0;
  const current = {sessionFamilyId: 'current-family', viewer: {serverId: 'server', profileId: 'current'}};
  const {AccountRoute} = await screenModule(new URL('../src-next/screens/accounts/AccountRoutes.tsx', import.meta.url), {
    ...shared(back), '../../platform/accounts': {nativeAccounts: {}}, '../../platform/app-session-storage': {},
    '../../platform/profile-selection': {nativeProfileSelection: (server: string, family: string) => {
      assert.equal(server, 'server'); assert.equal(family, current.sessionFamilyId); created++;
      return {select: async (...args: unknown[]) => {attempts.push(args); throw new Error('refused');}, dispose: () => {disposed++;}};
    }}, '../../shell/route-registry': {nativeShellRoutes: {registerRoute() {}}}, './AccountEntry': {AccountEntry: 'Entry'},
  });
  const context = {session: () => current, current: () => true, serverName: 'Verified server', api: {baseUrl: 'https://verified.example'},
    account: {profiles: [profile]}, authority: () => ({}), navigation: {back: () => {exited++;}}};
  let tree: any;
  const host = createHookHost(() => {const route = AccountRoute({route: {kind: 'profiles'}, context}); tree = route.type(route.props);});
  await act(() => host.mount());
  try {
    await act(() => nodes(tree.props.beforeActions).find(n => n.type === 'Picker').props.onSelect(profile.id));
    await act(() => tree.props.onSubmit('1234'));
    assert.deepEqual(attempts, [[profile.id, '1234']]); assert.equal(tree.props.code, '');
    await act(() => tree.props.onCodeChange('99'));
    await act(() => tree.props.onForgotPIN());
    assert.equal(tree.type, 'Forgot'); assert.equal(tree.props.url, 'https://verified.example/settings/profile');
    await act(() => tree.props.onBack());
    assert.equal(tree.type, 'PIN'); assert.equal(tree.props.code, '');
    assert.equal(context.session(), current); assert.equal(created, 1); assert.equal(disposed, 0); assert.equal(exited, 0);
    assert.deepEqual(attempts, [[profile.id, '1234']], 'public hand-off neither selects a profile nor retries/resets server attempts');
    await act(() => tree.props.onSubmit('5678'));
    assert.deepEqual(attempts, [[profile.id, '1234'], [profile.id, '5678']]);
  } finally {host.unmount();}
  assert.equal(disposed, 1);
});
