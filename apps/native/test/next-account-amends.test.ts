import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {defaultI18n} from '../../../packages/i18n/src';
import {porticoPublicLinks} from '../../../packages/client-core/src/public-links';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props
  ? [node, ...nodes(node.props.children), ...nodes(node.props.footer)] : [];
const words = (node: any): string => Array.isArray(node) ? node.map(words).join('') : node?.props ? words(node.props.children) : typeof node === 'string' ? node : '';

async function legalModule(i18n = defaultI18n) {
  return screenModule(new URL('../src-next/screens/accounts/LegalAgreement.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Text: 'Text'},
    '../../../../../packages/i18n/src': {defaultI18n: i18n},
    '../../../../../packages/client-core/src/public-links': {porticoPublicLinks},
  });
}

test('legal agreement uses the catalogue sentence and canonical destinations with caller-owned styles', async () => {
  const {LegalAgreement} = await legalModule(), links: string[] = [];
  const style = {textAlign: 'center'}, linkStyle = {color: '#409fd4'};
  const tree = LegalAgreement({style, linkStyle, onOpenLink: (url: string) => links.push(url)});
  assert.equal(words(tree), defaultI18n.t('services.signup.agreement', {
    terms: defaultI18n.t('auth.terms'), privacy: defaultI18n.t('auth.privacyPolicy'),
  }));
  assert.equal(tree.props.style, style);
  const anchors = nodes(tree).filter(node => node.props.accessibilityRole === 'link');
  assert.equal(anchors.length, 2);
  for (const anchor of anchors) {assert.equal(anchor.props.style, linkStyle); anchor.props.onPress();}
  assert.deepEqual(links, [porticoPublicLinks.terms, porticoPublicLinks.privacy]);
});

test('legal agreement follows translated link order and passes failures to its caller', async () => {
  const t = (key: string) => key === 'services.signup.agreement' ? '{privacy} / {terms}' : key;
  const {LegalAgreement} = await legalModule({...defaultI18n, t});
  const failure = new Error('browser unavailable'), links: string[] = [];
  const tree = LegalAgreement({onOpenLink: (url: string) => {links.push(url); throw failure;}});
  const anchors = nodes(tree).filter(node => node.props.accessibilityRole === 'link');
  assert.deepEqual(anchors.map(node => node.props.children), ['auth.privacyPolicy', 'auth.terms']);
  assert.throws(() => anchors[0].props.onPress(), error => error === failure);
  assert.deepEqual(links, [porticoPublicLinks.privacy]);
});

async function securityFixture(context: import('node:test').TestContext) {
  const failure = new Error('controller construction failed'), presented: unknown[][] = [];
  let rejection: Error | undefined = failure, tree: any;
  let state: any = {step: 'form', busy: false};
  const controller = {current: () => true, subscribe: () => () => {}, getSnapshot: () => state, dispose() {}};
  let workspace = {current: () => true, securityActions: () => {if (rejection) throw rejection; return controller;}};
  const security = {hasPassword: true, mfaEnabled: false, providers: [], recoveryCodesRemaining: 0};
  const {PhoneAccountSecurity} = await screenModule(new URL('../src-next/screens/accounts/PhoneAccountSecurity.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Text: 'Text', View: 'View'},
    '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src/presentation/errors': {presentError: (...args: unknown[]) => {presented.push(args); return {body: 'Security could not be opened.'};}},
    '../../kit/controls': {Button: 'Button', TextField: 'TextField'}, '../../kit/overlays': {BottomSheet: 'BottomSheet'},
    '../../kit/theme': {useTheme: () => ({type: {body: {}, captionStrong: {}}, colors: {danger: '#f00'}})},
    '../../platform/clipboard': {copyText: async () => {}}, './PasswordStrengthMeter': {PasswordStrengthMeter: 'PasswordStrengthMeter'},
  });
  const host = createHookHost(() => {tree = PhoneAccountSecurity({workspace, security});});
  context.after(() => host.unmount()); await act(() => host.mount());
  return {tree: () => tree, failure, presented,
    recover: async () => {rejection = undefined; workspace = {...workspace}; await act(() => host.rerender());},
    state: async (value: any) => {state = value; await act(() => host.rerender());}};
}

test('security controller failures reach presentError and the alert while unavailable actions stay disabled', async context => {
  const f = await securityFixture(context);
  assert.deepEqual(f.presented, [[f.failure, 'portico-account']]);
  assert.ok(nodes(f.tree()).some(node => node.props.accessibilityRole === 'alert' && node.props.children === 'Security could not be opened.'));
  const deletion = () => nodes(f.tree()).find(node => node.props.testID === 'account-security-delete');
  assert.equal(deletion().props.disabled, true);
  await f.recover();
  assert.equal(deletion().props.disabled, false);
  assert.equal(nodes(f.tree()).some(node => node.props.accessibilityRole === 'alert'), false);
});

test('security deletion help preserves profiles and history and names affected and blocking servers', async context => {
  const f = await securityFixture(context); await f.recover();
  assert.ok(words(f.tree()).includes(defaultI18n.t('web.deleteAccount.help')));
  await f.state({kind: 'delete', step: 'deletion', busy: false, preview: {
    canDelete: false, ownedServers: [{id: 'own', name: 'Owned server'}], affectedServers: [{id: 'member', name: 'Shared server'}],
  }});
  assert.ok(words(f.tree()).includes(defaultI18n.t('account.delete.ownsServers', {servers: 'Owned server'})));
  assert.ok(words(f.tree()).includes(defaultI18n.t('web.hostedAccount.leaveBody', {server: 'Shared server'})));
  const sheet = nodes(f.tree()).find(node => node.props.testID === 'account-security-sheet');
  assert.equal(nodes(sheet.props.footer).find(node => node.type === 'Button').props.disabled, true);
  assert.equal(nodes(sheet).some(node => node.type === 'TextField'), false, 'blocked deletion cannot enter account confirmation');
});
