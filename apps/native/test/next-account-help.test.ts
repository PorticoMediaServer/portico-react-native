import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme} from '../src-next/kit/theme';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const button = (tree: any, label: string) => nodes(tree).find(node => node.type === 'Button' && node.props.children === label);

test('phone Portico sign-in offers account help and returns to its form', async () => {
  const forgotten: unknown[][] = [];
  class Portico {
    async prepare() {return {password: true, registration: true, recovery: true, providers: []};}
    async forgot(username: string, email: string) {forgotten.push([username, email]);}
    async password() {throw new Error('not used');}
    dispose() {}
  }
  const account = {synchronize: async () => {}, getSnapshot: () => ({session: undefined})};
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), {
    react: {...React, default: React},
    'react-native': {BackHandler: {addEventListener: () => ({remove() {}})}, Platform: {isTV: false},
      NativeModules: {PorticoAccountAuth: {canOpenBrowser: false, canSignInApple: false, bundleId: 'com.example', newRequestId: async () => 'request'}},
      View: 'View', Text: 'Text', ScrollView: 'ScrollView'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src': {HttpHostedApi: class {}},
    '../../../../../packages/client-core/src/sign-in': {}, '../../../../../packages/client-core/src/route-identity': {routeOrigin: (value: string) => value},
    '../../../../../packages/client-core/src/hosted-security': {MFARequiredError: class extends Error {}},
    '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'failed'})},
    '../../kit/theme': {useTheme: () => createTheme({isTV: false, width: 390})},
    '../../kit/states': {StateLayout: 'Layout'}, '../../kit/controls': {Button: 'Button', TextField: 'Field'}, '../../kit/artwork': {ProfilePicker: 'Picker'},
    '../../platform/accounts': {nativeAccounts: {accountCredentials: () => account}},
    '../../platform/server-sign-in': {NativeServerSignIn: class {}}, '../../platform/portico-sign-in': {NativePorticoSignIn: Portico},
    '../../platform/server-connections': {browseNearby: async () => [], nativeNetworkFetch: async () => {}},
    '../../platform/tv-sign-in': {}, '../../platform/account-authority': {hostedUrl: 'https://web.example'},
    '../../tv/auth': {TVCredentialForm: 'TVCredentials', TVCodePresenter: 'TVCode', TVVerificationForm: 'TVFactor', TVRequiredSetupHandoff: 'TVRequired',
      TVFrontDoor: 'TVFrontDoor', TVProfilePINForm: 'TVPIN', TVForgotPINHandoff: 'TVForgot'},
    './PhoneFrontDoor': {PhoneFrontDoor: 'PhoneFrontDoor'}, 'react-native-qrcode-svg': {default: 'QR'},
  });
  let tree: any;
  const host = createHookHost(() => {tree = AccountEntry({onComplete: () => {}});});
  await act(() => host.mount());
  try {
    assert.equal(tree.type, 'PhoneFrontDoor');
    await act(() => tree.props.onPortico());
    assert.equal(tree.props.title, defaultI18n.t('accounts.signIn.portico'));
    await act(() => button(tree, defaultI18n.t('auth.forgotPassword'))!.props.onPress());
    assert.equal(tree.props.title, defaultI18n.t('auth.forgotPasswordTitle'));
    const fields = nodes(tree.props.beforeActions).filter(node => node.type === 'Field');
    await act(() => {fields[0].props.onChangeText('nana_r'); fields[1].props.onChangeText('nana@example.com');});
    await act(() => tree.props.primaryAction.onPress());
    assert.deepEqual(forgotten, [['nana_r', 'nana@example.com']]);
    assert.equal(tree.props.title, defaultI18n.t('auth.checkEmail'));
    assert.equal(tree.props.body, defaultI18n.t('auth.resetLinkSent'));
    await act(() => tree.props.primaryAction.onPress());
    assert.equal(tree.props.title, defaultI18n.t('accounts.signIn.portico'));
    await act(() => button(tree, defaultI18n.t('accounts.signIn.local'))!.props.onPress());
    assert.equal(tree.props.title, defaultI18n.t('accounts.signIn.local'));
  } finally {host.unmount();}
});
