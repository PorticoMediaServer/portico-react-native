import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';

const react = {...React, default: React};
const all = (node: any): any[] => Array.isArray(node) ? node.flatMap(all)
  // The phone sheet frame receives its authored header as a prop (SUP-001).
  : React.isValidElement<any>(node) ? [node, ...all(node.props.header), ...all(node.props.children)] : [];
const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
const native = {View: 'View', Text: 'Text', ScrollView: 'ScrollView', StyleSheet: {absoluteFill: {}, create: (value: unknown) => value}};
const theme = {platform: 'phone', isTV: false, fontScale: 1, textScale: 1, gutter: 24,
  type: {tab: {}, button: {}}, colors: {ink: '#071018', raised: '#10212d', raisedBright: '#1d3848', text: '#edf5fa', textSecondary: '#bdccd6', lineStrong: '#3b5668'}};
const i18n = {t: (key: string) => key, has: () => true, number: String, relativeTime: () => 'Yesterday'};
const shellType = (fontSize: number, weight = 600) => ({fontSize, fontWeight: String(weight)});

test('notification sections use a count slot, intra-section separators and the approved server outline', async () => {
  const {NativeNotificationsScreen} = await screenModule(new URL('../src-next/screens/notifications/NotificationsScreen.tsx', import.meta.url), {
    react, 'react-native': native, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
    '../../../../../packages/i18n/src': {defaultI18n: i18n},
    '../../../../../packages/client-core/src/notifications': {noticeWords: (notice: any) => ({title: notice.id, body: 'Notice'})},
    '../../kit/controls': {Button: 'Button', Tabs: 'Tabs'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/overlays': {Menu: 'Menu'}, '../../kit/shell': {NotificationItem: 'NotificationItem'},
    '../../kit/states': {StateView: 'StateView'}, '../../kit/shell/visual': {shellType},
    '../../kit/theme': {useTheme: () => theme}, '../../shell/account': {nativeMenuRouteAvailable: () => true},
    '../../shell/model': {sameAuthority: (a: any, b: any) => a.serverId === b.serverId},
  });
  const item = (id: string, audience: string) => ({id, audience, read: false, archived: false, severity: 'info', revision: '1', source: 'downloads', actions: [], createdAt: '2026-10-01T00:00:00Z'});
  const service = (audience: string, items: unknown[]) => {
    const state = {phase: 'ready', audiences: [audience], counts: {unread: items.length}, items, view: 'unread', more: false, busy: false};
    return {subscribe: () => () => {}, getSnapshot: () => state, load: async () => {}, readAll: async () => {}};
  };
  const profileService = service('profile', [item('one', 'profile'), item('two', 'profile')]);
  const adminService = service('account-admin', [item('server', 'account-admin')]);
  const authority = {serverId: 'server'}, route = {kind: 'notifications'};
  const navigation = {route, revision: 1, destination: {kind: 'settings'}};
  const context = {authority: () => authority, account: {account: {role: 'owner'}},
    navigation: {getSnapshot: () => navigation}, events: {on: () => () => {}, onResync: () => () => {}}};
  const runtime = {getSnapshot: () => ({hasLiveTV: false}), text: i18n};
  const retirement = {subscribe: () => () => {}, getSnapshot: () => undefined};
  let tree: any;
  const host = createHookHost(() => {tree = NativeNotificationsScreen({context, route, runtime, profileService, adminService, retirement});});
  host.mount(); host.flush();
  try {
    const tabs = all(tree).find(node => node.type === 'Tabs');
    assert.equal(tabs.props.items[0].label, 'notifications.view.unread');
    assert.equal(tabs.props.items[0].count, '3');
    const rows = all(tree).filter(node => node.type === 'NotificationItem');
    assert.deepEqual(rows.map(node => [node.props.notification.id, node.props.separator]), [['one', false], ['two', true], ['server', false]]);
    const profile = all(tree).find(node => node.props.testID === 'notifications-section-profile');
    const admin = all(tree).find(node => node.props.testID === 'notifications-section-admin');
    const outlines = (node: any) => all(node).filter(child => flatten(child.props.style).borderColor === 'rgba(92,179,226,.28)');
    assert.equal(outlines(profile).length, 0);
    assert.equal(outlines(admin).length, 1);
    assert.equal(flatten(outlines(admin)[0].props.style).borderWidth, 1);
    assert.equal(outlines(admin)[0].props.pointerEvents, 'none');
    assert.equal(flatten(all(tree).find(node => node.props.testID === 'notifications-mark-all').props.textStyle).fontSize, 15);
  } finally {host.unmount();}
});

test('a notification row omits its top rule unless the caller supplies a preceding row', async () => {
  const {NotificationItem} = await screenModule(new URL('../src-next/kit/shell/AccountShell.tsx', import.meta.url), {
    react, 'react-native': native, '../../../../../packages/i18n/src/index': {defaultI18n: i18n},
    '../artwork/Profiles': {ProfileFace: 'ProfileFace'}, '../controls/Focusable': {Focusable: 'Focusable'},
    '../overlays/Menu': {Popover: 'Popover'}, '../../platform/native-blur': {BlurView: 'BlurView', glassRecipe: () => ({nativeBlur: false})},
    '../Icon': {Icon: 'Icon'}, '../theme': {useTheme: () => theme}, '../focus/registry': {focusTestID: (...parts: string[]) => parts.join(':')},
    './visual': {shellType, alpha: (color: string, opacity: number) => `${color}:${opacity}`},
  });
  const props = {notification: {id: 'one', read: false, archived: false, severity: 'info'}, title: 'Title', body: 'Notice', when: 'Yesterday',
    subject: null, actions: [], onMenu() {}, menuLabel: 'More'};
  assert.equal(flatten(NotificationItem(props).props.style).borderTopWidth, 0);
  assert.equal(flatten(NotificationItem({...props, separator: true}).props.style).borderTopWidth, 1);
});

test('Tabs draws the count as a distinct pill while retaining tab semantics and large-text growth', async () => {
  let fontScale = 1;
  const {Tabs, Segmented} = await screenModule(new URL('../src-next/kit/controls/Tabs.tsx', import.meta.url), {
    react, 'react-native': native,
    '@portico/design': {tabsSpec: {gap: {phone: 34}, paddingTop: {phone: 16}, paddingBottom: {phone: 14}, underline: {phone: 3}}},
    '../focus': {focusTestID: (...parts: string[]) => parts.join(':')}, '../theme': {useTheme: () => ({...theme, fontScale})},
    './Focusable': {Focusable: 'Focusable'}, './control-model': {colorAlpha: () => 'transparent', enabledChoice: (items: any[]) => items[0]?.value, minimumHitSlop: () => 0},
    './useControlValue': {useControlValue: (value: unknown, initial: unknown, change: unknown) => [value ?? initial, change]},
  });
  const items = [{value: 'unread', label: 'Unread', count: '12'}, {value: 'all', label: 'All'}];
  let tree: any;
  const host = createHookHost(() => {tree = Tabs({items, value: 'unread', onValueChange() {}, testID: 'tabs'});});
  host.mount();
  try {
    const tab = all(tree).find(node => node.props.testID === 'tabs-item-unread');
    assert.equal(tab.props.accessibilityRole, 'tab');
    assert.equal(tab.props.accessibilityLabel, 'Unread, 12');
    const choice = all(tab).find(node => typeof node.type === 'function');
    const label = choice.type(choice.props), texts = all(label).filter(node => node.type === 'Text');
    assert.deepEqual(texts.map(node => node.props.children), ['Unread', '12']);
    const pill = flatten(texts[1].props.style);
    assert.equal(pill.fontSize, 12); assert.equal(pill.borderRadius, 9); assert.equal(pill.marginLeft, 6);
    assert.equal(pill.paddingHorizontal, 7); assert.equal(pill.paddingVertical, 1);
    fontScale = 2; host.rerender();
    const enlarged = all(tree).find(node => node.props.testID === 'tabs-item-unread');
    const enlargedChoice = all(enlarged).find(node => typeof node.type === 'function');
    assert.equal(all(enlargedChoice.type(enlargedChoice.props)).find(node => node.type === 'Text').props.numberOfLines, undefined);
  } finally {host.unmount();}
  const segmented = createHookHost(() => {tree = Segmented({items, value: 'unread', onValueChange() {}, variant: 'phone'});});
  segmented.mount();
  try {
    const choice = all(tree).find(node => node.type === 'Focusable'), style = flatten(choice.props.style({focused: false}));
    assert.equal(style.minHeight, 28); assert.equal(style.height, undefined);
  } finally {segmented.unmount();}
});
