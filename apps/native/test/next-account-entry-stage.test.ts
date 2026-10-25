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
import type {NativeAccountEntryStage} from '../src-next/screens/accounts/AccountEntry';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];

async function fixture(initialStage: 'welcome' | 'address' = 'welcome') {
  const events: string[] = [], stages: NativeAccountEntryStage[] = [], back = new Set<() => boolean>();
  let tree: any, phase = 'render', complete = 0, observed = true;
  class SignIn {
    constructor() {events.push('create-command');}
    async inspect() {events.push('inspect'); return {id: 'public-server', name: 'Public fixture', signIn: 'local'};}
    needsIdentityCode() {return false;}
    async inspectLocalIdentity() {return {};}
    async confirmLocal() {events.push('confirm-identity');}
    serverDescriptor() {return {id: 'public-server', name: 'Public fixture', signIn: 'local'};}
    dispose() {events.push('dispose-command');}
  }
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), {
    react: {...React, default: React,
      useLayoutEffect: (create: () => void | (() => void), deps: readonly unknown[]) => React.useLayoutEffect(() => {phase = 'layout'; try {return create();} finally {phase = 'render';}}, deps),
      useEffect: (create: () => void | (() => void), deps: readonly unknown[]) => React.useEffect(() => {phase = 'passive'; try {return create();} finally {phase = 'render';}}, deps)},
    'react-native': {AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, BackHandler: {addEventListener: (_: string, handler: () => boolean) => {back.add(handler); return {remove: () => back.delete(handler)};}}, Platform: {isTV: false}, NativeModules: {}, View: 'View', Text: 'Text'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src': {},
    '../../../../../packages/client-core/src/sign-in': {}, '../../../../../packages/client-core/src/route-identity': {},
    '../../../../../packages/client-core/src/hosted-security': {MFARequiredError: class extends Error {}},
    '../../../../../packages/client-core/src/presentation/errors': {}, '../../kit/theme': {useTheme: () => createTheme({isTV: false, width: 390})},
    '../../../../../packages/client-core/src/password-strength': passwordPolicy,
    '../../platform/setup-outcome': setupOutcome,
    './PhoneOwnerReset': {PhoneOwnerReset: 'PhoneOwnerReset'},
    './PhoneSetupApproval': {PhoneSetupApproval: 'PhoneSetupApproval'},
    './directory-chooser': directoryChooser,
    '../../kit/states': {StateLayout: 'Layout'}, '../../kit/controls': {Button: 'Button', TextField: 'Field'}, '../../kit/Icon': {Icon: 'Icon'}, '../../kit/artwork': {ProfilePicker: 'Picker'},
    '../../platform/accounts': {nativeAccounts: {}}, '../../platform/server-sign-in': {NativeServerSignIn: SignIn}, '../../platform/portico-sign-in': {},
    '../../platform/server-connections': {browseNearby: async () => {events.push('discovery'); return [];}}, '../../platform/tv-sign-in': {}, '../../platform/account-authority': {},
    '../../tv/auth': {}, './PhonePINEntry': {PhonePINEntry: 'PhonePIN'}, './PhoneAccountMoveNotice': {PhoneAccountMoveNotice: 'MoveNotice'}, './PhoneMovePassword': {PhoneMovePassword: 'MovePassword'}, './PhoneMoveCode': {PhoneMoveCode: 'MoveCode'}, './EndedMoveCodeAction': {EndedMoveCodeAction: 'EndedMoveCodeAction'}, './PhoneProfileRecovery': {PhoneProfileRecovery: 'Recovery'}, '../../tv/auth/TVIdentityCodeForm': {TVIdentityCodeForm: 'IdentityCode'}, './DirectoryAccessRefused': {DirectoryAccessRefused: 'Refused'}, '../../platform/hosted-sign-in-unavailable': {HostedSignInUnavailable: class extends Error {}}, './directory-refusal': {directoryAccessRefused: () => false, directoryClockSkew: () => false, directoryIdentityUnconfirmed: () => false}, './PhoneNoServers': {PhoneNoServers: 'PhoneNoServers'}, './TVNoServers': {TVNoServers: 'TVNoServers'}, './PhoneFrontDoor': {PhoneFrontDoor: 'PhoneFrontDoor'}, 'react-native-qrcode-svg': {default: 'QR'},
  });
  const onStageChange = (...args: NativeAccountEntryStage[]) => {
    assert.equal(phase, 'layout'); assert.equal(args.length, 1, 'the observer receives only the stage, never fields or authority');
    stages.push(args[0]!); events.push('stage:' + args[0]);
  };
  const host = createHookHost(() => {tree = AccountEntry({initialStage, onComplete: () => {complete++;}, onStageChange: observed ? onStageChange : undefined});});
  await act(() => host.mount());
  return {host, stages, events, back, tree: () => tree, complete: () => complete, omitObserver: () => {observed = false; host.rerender();}};
}

test('AccountEntry reports initial/current stages in layout before discovery, preserving real commands and reporting Back without reopening policy', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.stages, ['welcome']); assert.deepEqual(f.events, ['stage:welcome']); assert.equal(f.tree().type, 'PhoneFrontDoor');
    await act(() => f.tree().props.onLocal());
    assert.deepEqual(f.stages, ['welcome', 'address']);
    assert.ok(f.events.indexOf('stage:address') < f.events.indexOf('discovery'), 'capture retirement precedes address-stage passive work');
    await act(() => nodes(f.tree().props.beforeActions).find(node => node.type === 'Field').props.onChangeText('https://public.example'));
    assert.deepEqual(f.stages, ['welcome', 'address'], 'field changes are not observer events');
    await act(() => f.tree().props.primaryAction.onPress());
    assert.deepEqual(f.stages, ['welcome', 'address', 'local']); assert.ok(f.events.includes('inspect')); assert.ok(f.events.includes('confirm-identity'));
    const fields = nodes(f.tree().props.beforeActions).filter(node => node.type === 'Field');
    await act(() => {fields[0].props.onChangeText('fixture-user'); fields[1].props.onChangeText('fixture-password');});
    assert.deepEqual(f.stages, ['welcome', 'address', 'local']);
    await act(() => {assert.equal([...f.back][0]!(), true);});
    assert.deepEqual(f.stages, ['welcome', 'address', 'local', 'welcome'], 'the observer reports genuine Back; the public-launch gate owns its monotonic retirement');
    assert.equal(f.complete(), 0);
    f.omitObserver(); await act(() => f.tree().props.onLocal());
    assert.deepEqual(f.stages, ['welcome', 'address', 'local', 'welcome'], 'the optional observer does not alter navigation when absent');
    assert.equal(f.tree().type, 'Layout');
  } finally {f.host.unmount();}
  assert.equal(f.back.size, 0);
});

test('an entry starting at address reports address only, never a synthetic welcome', async () => {
  const f = await fixture('address');
  try {assert.deepEqual(f.stages, ['address']); assert.ok(f.events.indexOf('stage:address') < f.events.indexOf('discovery'));}
  finally {f.host.unmount();}
});
