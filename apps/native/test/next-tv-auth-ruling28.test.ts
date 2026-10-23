import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {act, createHookHost} from './hook-driver';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme, nativeType} from '../src-next/kit/theme';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const theme = createTheme({isTV: true, width: 1920});
const inScope = (component: (props: any) => any, props: any) => {
  const scope = component(props);
  assert.equal(scope.type, 'Provider', 'pre-sign-in entry supplies its own focus scope');
  const child = [scope.props.children].flat()[0];
  return child.type(child.props);
};
const common = {'../../../../../packages/i18n/src': {defaultI18n}, '../../kit/theme': {nativeType, useTheme: () => theme},
  '../../kit/controls': {Button: 'Button', Focusable: 'Focusable'}, './TVAuthLayout': {TVAuthLayout: 'Layout'},
  '../../screens/destinations/useEntryFocus': {useDestinationEntryFocus() {}}};

for (const kind of ['portico', 'local'] as const) test(`${kind} credentials use secure platform fields/autofill and only the owner's Submit/Back callbacks`, async () => {
  const h = hooks(), focused: unknown[] = [], events: string[] = [];
  const {TVCredentialForm} = await screenModule(new URL('../src-next/tv/auth/TVCredentialForm.tsx', import.meta.url), {
    ...common, react: h.react, 'react-native': {Text: 'Text', TextInput: 'TextInput', View: 'View'},
    '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region', useFocusRegistry: () => ({focus: (address: unknown) => focused.push(address)}),
      useFocusTarget: () => ({onFocus() {}, onBlur() {}})},
  });
  const props = {kind, serverName: 'Actual local server', username: 'actual-user', password: 'in-memory-only', busy: false,
    usernamePlaceholder: 'auth.email', onUsernameChange() {}, onPasswordChange() {}, onSubmit: () => events.push('submit'), onBack: () => events.push('back')};
  const tree = h.render(() => inScope(TVCredentialForm, props));
  const fields = nodes(tree).filter(node => typeof node.type === 'function');
  const username = h.render(() => fields[0].type(fields[0].props)), password = h.render(() => fields[1].type(fields[1].props));
  const input = (node: unknown) => nodes(node).find(value => value.type === 'TextInput');
  assert.equal(input(username).props.textContentType, 'username');
  assert.equal(input(username).props.autoComplete, 'username');
  assert.equal(input(password).props.secureTextEntry, true);
  assert.equal(input(password).props.textContentType, 'password');
  assert.equal(input(password).props.autoComplete, 'current-password');
  assert.equal(input(password).props.autoCorrect, false);
  assert.equal(input(password).props.showSoftInputOnFocus, undefined, 'the platform keyboard is not suppressed');
  input(username).props.onSubmitEditing(); input(password).props.onSubmitEditing();
  assert.deepEqual(focused, [{regionId: `tv.auth.${kind}.credentials`, childId: 'password'}, {regionId: `tv.auth.${kind}.credentials`, childId: 'submit'}]);
  const buttons = nodes(tree).filter(node => node.type === 'Button');
  assert.equal(buttons.length, 2, 'no provider/signup/forgot-password controls are added');
  buttons[0].props.onPress(); buttons[1].props.onPress();
  assert.deepEqual(events, ['submit', 'back']);
  assert.equal(tree.props.portico, kind === 'portico', 'only Portico Account renders legal terms');
  assert.equal(tree.props.body, defaultI18n.t(kind === 'local' ? 'auth.direct.lead' : 'auth.accountLead'));
  props.busy = true;
  const blocked = h.render(() => inScope(TVCredentialForm, props));
  nodes(blocked).find(node => node.type === 'Button' && node.props.focusId === 'submit').props.onPress();
  assert.deepEqual(events, ['submit', 'back']);
});

test('both actual TV code modes expose the drawn credential route without starting a transaction', async () => {
  const h = hooks(), calls: string[] = [];
  const {TVCodePresenter} = await screenModule(new URL('../src-next/tv/auth/TVCodePresenter.tsx', import.meta.url), {
    ...common, react: h.react, 'react-native': {Text: 'Text', View: 'View'}, 'react-native-qrcode-svg': {default: 'QR'}, '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'},
    '../../platform/native-blur': {BlurView: 'Blur', glassRecipe: () => ({nativeBlur: true})},
  });
  for (const mode of ['portico', 'local'] as const) {
    const tree = h.render(() => inScope(TVCodePresenter, {mode, serverName: 'Actual server', body: 'actual owner copy', userCode: 'ACTUAL-CODE',
      verificationUri: 'https://account.example/device', verificationUriComplete: 'https://account.example/device?user_code=ACTUAL-CODE', busy: false,
      onTypeCredentials: () => calls.push(mode), onBack: () => calls.push('back')}));
    const buttons = nodes(tree).filter(node => node.type === 'Button');
    assert.equal(buttons[0].props.children.flat().join(''), defaultI18n.t(mode === 'portico' ? 'accounts.signIn.onTV' : 'quickConnect.usePassword'));
    buttons[0].props.onPress(); if (mode === 'portico') buttons[1].props.onPress();
    else assert.equal(buttons.length, 1, 'local code frame9 has one drawn password button; hardware Back is owned by AccountEntry');
    assert.equal(nodes(tree.props.aside).find(node => node.type === 'QR').props.value, 'https://account.example/device?user_code=ACTUAL-CODE');
    assert.equal(tree.props.portico, mode === 'portico');
  }
  assert.deepEqual(calls, ['portico', 'back', 'local']);
});

test('sixth MFA digit submits once, rejected controlled state can retry, and Play/Pause deletes without a system input', async () => {
  let tree: any, remote: (event: any) => void = () => {};
  const submitted: string[] = [];
  const props = {kind: 'local', code: '', recovery: false, recoveryCode: '', busy: false,
    onCodeChange: (value: string) => {props.code = value;}, onRecoveryCodeChange() {}, onRecoveryChange() {},
    onSubmit: (value: string) => submitted.push(value), onBack() {}};
  const {TVVerificationForm} = await screenModule(new URL('../src-next/tv/auth/TVVerificationForm.tsx', import.meta.url), {
    ...common, react: {...React, default: React}, 'react-native': {Text: 'Text', View: 'View', useTVEventHandler: (fn: typeof remote) => {remote = fn;}},
    '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'}, '../../kit/Icon': {Icon: 'Icon'},
  });
  const host = createHookHost(() => {tree = inScope(TVVerificationForm, props);});
  const press = (digit: string) => nodes(tree.props.aside).find(node => node.props.testID === `tv.auth.local.factor-pad-${digit}`).props.onPress();
  try {
    await act(() => host.mount());
    for (const digit of '123456') await act(() => {press(digit); host.rerender();});
    assert.deepEqual(submitted, ['123456']);
    await act(() => {press('6'); host.rerender();});
    assert.deepEqual(submitted, ['123456']);
    await act(() => {props.code = ''; host.rerender();});
    for (const digit of '123456') await act(() => {press(digit); host.rerender();});
    assert.deepEqual(submitted, ['123456', '123456']);
    await act(() => {remote({eventType: 'playPause', eventKeyAction: 0}); host.rerender();});
    assert.equal(props.code, '12345');
    remote({eventType: 'playPause', eventKeyAction: 1});
    assert.equal(props.code, '12345', 'key release does not delete twice');
    await act(() => {props.busy = true; host.rerender(); remote({eventType: 'playPause', eventKeyAction: 0}); press('9');});
    assert.equal(props.code, '12345');
    assert.ok(!nodes(tree).some(node => node.type === 'TextInput'));
  } finally {host.unmount();}
});

test('recovery uses the authored uppercase/digit/dash keyboard and submits the exact controlled value', async () => {
  const h = hooks(), values: string[] = [], submits: string[] = [];
  const {TVVerificationForm} = await screenModule(new URL('../src-next/tv/auth/TVVerificationForm.tsx', import.meta.url), {
    ...common, react: h.react, 'react-native': {Text: 'Text', View: 'View', useTVEventHandler() {}}, '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'}, '../../kit/Icon': {Icon: 'Icon'},
  });
  const props = {kind: 'portico', code: '', recovery: true, recoveryCode: 'R7-', busy: false, onCodeChange() {}, onRecoveryChange() {},
    onRecoveryCodeChange: (value: string) => values.push(value), onSubmit: (value: string) => submits.push(value), onBack() {}};
  const tree = h.render(() => inScope(TVVerificationForm, props));
  assert.ok(!nodes(tree).some(node => node.type === 'TextInput'), 'recovery does not invoke the platform keyboard');
  for (const key of ['A', '0', '-']) nodes(tree).find(node => node.props.testID === `tv.auth.portico.factor-keyboard-${key}`).props.onPress();
  assert.deepEqual(values, ['R7-A', 'R7-0', 'R7--']);
  nodes(tree).find(node => node.type === 'Button' && node.props.focusId === 'submit').props.onPress();
  assert.deepEqual(submits, ['R7-']);
});
