import * as accountWork from '../src-next/platform/account-work';
import {presentError} from '../../../packages/client-core/src/presentation/errors';
import * as joinLink from '../../../packages/client-core/src/join-link';
import * as invitationCode from '../../../packages/client-core/src/short-invitation-code';
import * as tvCodeOpening from '../src-next/screens/accounts/tv-code-opening';
import * as setupOutcome from '../src-next/platform/setup-outcome';
import * as passwordPolicy from '../../../packages/client-core/src/password-strength';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme} from '../src-next/kit/theme';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';
import * as directoryChooser from '../src-next/screens/accounts/directory-chooser';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];

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
    '../../platform/tv-menu': {useTVMenuCapture() {}},
    './tv-code-opening': tvCodeOpening,
    '../../../../../packages/client-core/src/join-link': joinLink,
    '../../../../../packages/client-core/src/short-invitation-code': invitationCode,
    '../../platform/qr-scanner': {qrScannerAvailable: () => false, scanQRCode: async () => undefined},
    './LegalAgreement': {LegalAgreement: 'LegalAgreement'}, './PhoneAccountForm': {PhoneAccountForm: 'Layout'}, './PasswordStrengthMeter': {PasswordStrengthMeter: 'PasswordStrengthMeter'}, './PhoneAccountSignIn': {PhoneAccountSignIn: 'PhoneAccountSignIn'},
    './tv-approval-finalization': {}, './tv-approval-credentials': {},
    react: {...React, default: React},
    'react-native': {AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, BackHandler: {addEventListener: () => ({remove() {}})}, Linking: {openURL: async () => {}}, Platform: {isTV: false},
      NativeModules: {PorticoAccountAuth: {canOpenBrowser: false, canSignInApple: false, bundleId: 'com.example', newRequestId: async () => 'request'}},
      View: 'View', Text: 'Text', ScrollView: 'ScrollView'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src': {HttpHostedApi: class {}},
    '../../../../../packages/client-core/src/sign-in': {}, '../../../../../packages/client-core/src/route-identity': {routeOrigin: (value: string) => value},
    '../../../../../packages/client-core/src/hosted-security': {MFARequiredError: class extends Error {}},
    '../../../../../packages/client-core/src/presentation/errors': {presentError},
    '../../kit/theme': {useTheme: () => createTheme({isTV: false, width: 390})},
    '../../../../../packages/client-core/src/password-strength': passwordPolicy,
    '../../platform/setup-outcome': setupOutcome,
    './PhoneOwnerReset': {PhoneOwnerReset: 'PhoneOwnerReset'},
    './PhoneSetupApproval': {PhoneSetupApproval: 'PhoneSetupApproval'},
    './directory-chooser': directoryChooser,
    '../../kit/states': {StateLayout: 'Layout'}, '../../kit/controls': {Button: 'Button', TextField: 'Field'}, '../../kit/Icon': {Icon: 'Icon'}, '../../kit/artwork': {ProfilePicker: 'Picker'},
    '../../platform/account-work': accountWork, '../../platform/accounts': {nativeAccounts: {accountCredentials: () => account}},
    '../../platform/server-sign-in': {NativeServerSignIn: class {}}, '../../platform/portico-sign-in': {NativePorticoSignIn: Portico},
    '../../platform/server-connections': {browseNearby: async () => [], nativeNetworkFetch: async () => {}},
    '../../platform/tv-sign-in': {}, '../../platform/account-authority': {hostedUrl: 'https://web.example'},
    '../../tv/auth': {TVCredentialForm: 'TVCredentials', TVCodePresenter: 'TVCode', TVVerificationForm: 'TVFactor', TVRequiredSetupHandoff: 'TVRequired',
      TVFrontDoor: 'TVFrontDoor', TVProfilePINForm: 'TVPIN', TVForgotPINHandoff: 'TVForgot'},
    './PhonePINEntry': {PhonePINEntry: 'PhonePIN'}, './PhoneAccountMoveNotice': {PhoneAccountMoveNotice: 'MoveNotice'}, './PhoneMovePassword': {PhoneMovePassword: 'MovePassword'}, './PhoneMoveCode': {PhoneMoveCode: 'MoveCode'}, './PhoneProfileRecovery': {PhoneProfileRecovery: 'Recovery'}, '../../tv/auth/TVIdentityCodeForm': {TVIdentityCodeForm: 'IdentityCode'}, './DirectoryAccessRefused': {DirectoryAccessRefused: 'Refused'}, '../../platform/hosted-sign-in-unavailable': {HostedSignInUnavailable: class extends Error {}}, './directory-refusal': {directoryAccessRefused: () => false, directoryClockSkew: () => false, directoryIdentityUnconfirmed: () => false}, './PhoneAccountWorkspace': {PhoneAccountWorkspace: 'PhoneAccountWorkspace'}, '../../platform/account-workspace': {NativeAccountWorkspace: class {constructor() {throw new Error('unexpected_account_workspace');}}}, './PhoneNoServers': {PhoneNoServers: 'PhoneNoServers'}, './TVNoServers': {TVNoServers: 'TVNoServers'}, './EndedMoveCodeAction': {EndedMoveCodeAction: 'EndedMoveCodeAction'}, './TVOfflineServers': {TVOfflineServers: 'TVOfflineServers'}, './PhoneFrontDoor': {PhoneFrontDoor: 'PhoneFrontDoor'}, 'react-native-qrcode-svg': {default: 'QR'},
  });
  let tree: any;
  const host = createHookHost(() => {tree = AccountEntry({onComplete: () => {}});});
  await act(() => host.mount());
  try {
    assert.equal(tree.type, 'PhoneFrontDoor'); await act(() => tree.props.onPortico());
    assert.equal(tree.type, 'PhoneAccountSignIn'); assert.equal(tree.props.passwordEnabled, true); assert.equal(tree.props.recovery, true);
    await act(() => tree.props.onForgot());
    assert.equal(tree.props.title, defaultI18n.t('auth.forgotPasswordTitle'));
    const fields = nodes(tree.props.beforeActions).filter(node => node.type === 'Field');
    await act(() => {fields[0].props.onChangeText('nana_r'); fields[1].props.onChangeText('nana@example.com');});
    await act(() => tree.props.primaryAction.onPress());
    assert.deepEqual(forgotten, [['nana_r', 'nana@example.com']]);
    assert.equal(tree.props.title, defaultI18n.t('auth.checkEmail'));
    assert.equal(tree.props.body, defaultI18n.t('auth.resetLinkSent'));
    await act(() => tree.props.primaryAction.onPress());
    assert.equal(tree.type, 'PhoneAccountSignIn'); assert.equal(tree.props.recovery, true);
    await act(() => tree.props.onLocal());
    assert.equal(tree.props.title, defaultI18n.t('accounts.signIn.local'));
  } finally {host.unmount();}
});
