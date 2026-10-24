import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme} from '../src-next/kit/theme';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const theme = createTheme({isTV: false, width: 390});
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const directory = [
  {id: 'one', name: 'One', baseUrl: 'https://one.test', publicKey: 'key', policyRevision: 0, presence: {online: true, lastSeenAt: null}},
  {id: 'two', name: 'Two', baseUrl: 'https://two.test', publicKey: 'key', policyRevision: 0, presence: {online: true, lastSeenAt: null}},
];

test('a directory connect is fenced to its attempt: Choose another and a successor ignore its late result or error', async () => {
  const pending: {server: {id: string; name: string}; resolve: (value: unknown) => void; reject: (error: unknown) => void}[] = [];
  class SignIn {
    connectPortico(server: {id: string; name: string}) {
      return new Promise((resolve, reject) => {pending.push({server, resolve, reject});});
    }
    serverDescriptor() {return {id: 'server', name: 'Server', signIn: 'portico'};}
    dispose() {}
  }
  class HostedApi {
    async servers() {return {items: directory};}
  }
  const account = {account: {id: 'account'}, familyId: 'family', accessToken: 'token'};
  const nativeAccounts = {accountCredentials: () => ({
    synchronize: async () => {}, getSnapshot: () => ({session: account}), accessSession: async () => account,
  })};
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), {
    react: {...React, default: React},
    'react-native': {BackHandler: {addEventListener: () => ({remove() {}})}, Platform: {isTV: false}, Dimensions: {get: () => ({width: 390, height: 844})},
      NativeModules: {}, View: 'View', Text: 'Text', ScrollView: 'ScrollView', Linking: {openURL: async () => {}}},
    'react-native-qrcode-svg': {default: 'QR'},
    '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src': {HttpHostedApi: HostedApi},
    '../../../../../packages/client-core/src/sign-in': {ServerSignInProbe: class {}},
    '../../../../../packages/client-core/src/route-identity': {routeOrigin: (value: string) => value},
    '../../../../../packages/client-core/src/hosted-security': {MFARequiredError: class extends Error {}},
    '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'error', silent: false})},
    '../../kit/states': {StateLayout: 'Layout'}, '../../kit/controls': {Button: 'Button', Focusable: 'Focusable', TextField: 'Field'},
    '../../kit/Icon': {Icon: 'Icon'}, '../../kit/artwork': {ProfilePicker: 'Picker'}, '../../kit/theme': {useTheme: () => theme},
    '../../platform/accounts': {nativeAccounts}, '../../platform/server-sign-in': {NativeServerSignIn: SignIn},
    '../../platform/portico-sign-in': {NativePorticoSignIn: class {dispose() {}}},
    '../../platform/server-connections': {browseNearby: async () => [], nativeNetworkFetch: async () => ({})},
    '../../platform/tv-sign-in': {createNativePorticoTVSignIn: () => ({subscribe: () => () => {}, getSnapshot: () => ({phase: 'idle'}), start: async () => {}, cancel: async () => {}})},
    '../../platform/account-authority': {hostedUrl: 'https://hosted.test'},
    '../../tv/auth': {TVProfilePINForm: 'PIN', TVForgotPINHandoff: 'Forgot', TVFrontDoor: 'Front', TVCodePresenter: 'Code',
      TVCredentialForm: 'Credentials', TVVerificationForm: 'Factor', TVRequiredSetupHandoff: 'Required'},
    './PhoneFrontDoor': {PhoneFrontDoor: 'Phone'},
    './directory-chooser': {directoryRows: (servers: readonly {id: string; name: string}[]) => servers.map(server => ({id: server.id, name: server.name, offline: false})),
      directoryFailure: (server: unknown, error: unknown) => !server ? 'other' : error === undefined ? 'opening' : 'waiting',
      directoryOfflineBody: () => ({key: 'web.chooser.unreachableBodyNever'})},
  });
  let tree: any, completed = 0;
  const host = createHookHost(() => {tree = AccountEntry({onComplete: () => {completed++;}});});
  await act(() => host.mount());
  try {
    await act(() => {tree.props.onPortico();});
    await act(() => host.rerender());
    assert.equal(tree.type, 'Layout'); assert.equal(tree.props.title, defaultI18n.t('portico.landing.pickTitle'));
    const rows = () => nodes(tree.props.beforeActions).filter(node => node.type === 'Focusable');
    assert.equal(rows().length, 2);

    await act(() => {rows()[0].props.onPress(); host.rerender();});
    assert.equal(tree.props.testID, 'accounts-server-opening');
    await act(() => {tree.props.primaryAction.onPress(); host.rerender();});
    assert.equal(tree.type, 'Layout'); assert.equal(tree.props.title, defaultI18n.t('portico.landing.pickTitle'));
    await act(async () => {pending[0]!.resolve({kind: 'profiles', profiles: [{id: 'p'}]}); await Promise.resolve(); host.rerender();});
    assert.equal(completed, 0); assert.equal(tree.type, 'Layout');

    await act(() => {rows()[0].props.onPress(); host.rerender();});
    assert.equal(tree.props.testID, 'accounts-server-opening');
    await act(() => {tree.props.primaryAction.onPress(); host.rerender();});
    await act(async () => {pending[1]!.reject(Object.assign(new Error('connection'), {code: 'server_unavailable'})); await Promise.resolve(); host.rerender();});
    assert.equal(tree.type, 'Layout'); assert.notEqual(tree.props.testID, 'accounts-server-waiting'); assert.equal(completed, 0);

    await act(() => {rows()[0].props.onPress(); host.rerender();});
    assert.equal(tree.props.testID, 'accounts-server-opening');
    await act(() => {tree.props.primaryAction.onPress(); host.rerender();});
    await act(() => {rows()[1].props.onPress(); host.rerender();});
    assert.equal(tree.props.testID, 'accounts-server-opening');
    const successorTitle = tree.props.title;
    await act(async () => {pending[2]!.resolve({kind: 'profiles', profiles: [{id: 'p'}]}); await Promise.resolve(); host.rerender();});
    assert.equal(tree.props.testID, 'accounts-server-opening'); assert.equal(tree.props.title, successorTitle); assert.equal(completed, 0);
    await act(async () => {pending[3]!.reject(Object.assign(new Error('connection'), {code: 'server_unavailable'})); await Promise.resolve(); host.rerender();});
    assert.equal(tree.props.testID, 'accounts-server-waiting');
    assert.equal(tree.props.title, defaultI18n.t('web.chooser.waitingTitle', {server: 'Two'}));
    assert.equal(completed, 0);
  } finally {host.unmount();}
});
