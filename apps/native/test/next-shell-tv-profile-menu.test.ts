import assert from 'node:assert/strict';
import test from 'node:test';
import type {DirectSnapshot} from '../../../packages/client-core/src/profile-management';
import {nativeAccountMenu} from '../src-next/shell/account';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme, nativeType} from '../src-next/kit/theme';
import {tvFocusIds} from '../src-next/shell/tv-focus';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const profile = {id: 'profile', name: 'Demo', primary: true, position: 0, art: 'blue' as const, revision: 1, pinRevision: 1, pinRequired: false};
const account: DirectSnapshot = {authority: 'local', serverId: 'server', account: {id: 'account', username: 'demo', primaryProfileId: profile.id,
  role: 'owner', revision: 1, disabled: false, allowedLibraries: []}, profiles: [profile], canManage: true,
  capabilities: {manageAccount: true, managePeople: true, manageServer: true, manageSignIn: true}};
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};

test('actual TV profile menu has ordered safe actions, member gating and no extra Settings stop', async () => {
  const routes: unknown[] = [], open = (route: unknown) => {routes.push(route);};
  const one = nativeAccountMenu(account, open, true);
  assert.deepEqual(one.actions.map(action => action.id), ['servers', 'notifications', 'together']);
  const two = nativeAccountMenu({...account, profiles: [profile, {...profile, id: 'other', primary: false}]}, open, true);
  assert.deepEqual(two.actions.map(action => action.id), ['profiles', 'servers', 'notifications', 'together']);
  assert.equal(nativeAccountMenu({...account, account: {...account.account, role: 'member'}, canManage: false,
    capabilities: {manageAccount: false, managePeople: false, manageServer: false, manageSignIn: false}}, open, true).serverAction, undefined);
  assert.deepEqual(nativeAccountMenu(account, open).actions.map(action => action.id), ['profiles', 'servers', 'notifications', 'together', 'settings'], 'phone action contract stays unchanged');
  const h = hooks();
  const {TVProfileMenu} = await screenModule(new URL('../src-next/shell/TVProfileMenu.tsx', import.meta.url), {
    react: h.react, 'react-native': {View: 'View', Text: 'Text'}, '../../../../packages/i18n/src': {defaultI18n}, '../kit/artwork': {ProfileFace: 'ProfileFace'}, '../kit/theme': {useTheme: () => createTheme({isTV: true, width: 1920}), nativeType}, '../kit/overlays': {Menu: 'Menu'}, './tv-focus': {tvFocusIds},
  });
  const ref = {current: null};
  const tree = TVProfileMenu({snapshot: {authority, account: two, serverName: 'Actual verified server', profile: {id: 'profile', name: 'Demo'}}, open: true, onOpenChange() {}, returnFocusRef: ref});
  assert.equal(tree.props.testID, tvFocusIds(authority).profileMenu);
  assert.equal(tree.props.returnFocusRef, ref, 'the genuine rail profile ref is handed to the shared hold');
  assert.deepEqual(tree.props.items.map((item: any) => item.id), ['profiles', 'servers', 'notifications', 'together', 'server-separator', 'server']);
  assert.equal(tree.props.presentation, 'anchored');
  assert.equal(tree.props.anchorRef, ref);
  assert.equal(tree.props.placement, 'right-end');
  assert.equal(tree.props.width, 640);
  assert.equal(tree.props.offset, 168);
  assert.equal(tree.props.alignOffset, -8);
  assert.deepEqual(routes, [], 'rendering or native traversal never navigates');
  tree.props.items[0].onSelect();
  assert.deepEqual(routes, [{kind: 'profiles'}]);
});
