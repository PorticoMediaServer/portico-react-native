import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';
import * as policy from '../../../packages/client-core/src/server-admin/recording-policy';
import * as model from '../src-next/screens/settings-live/recording-owner-model';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme} from '../src-next/kit/theme';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.pickerContext)] : [];
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};};
const owner = (id: string) => ({owner: {authority: 'local' as const, accountId: 'a', profileId: id}, accountName: 'A', profileName: id});

async function loadPresenter() {
  return screenModule(new URL('../src-next/screens/settings-live/LiveOwnerRecording.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Text: 'Text', View: 'View'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../../../../packages/client-core/src/server-admin/recording-policy': policy,
    '../../../../../packages/client-core/src/server-admin/live-words': {tunerStatus: () => ({}), tunerUseLine: () => ''},
    '../../kit/controls': {Button: 'Button', Focusable: 'Focusable', Select: 'Select', Switch: 'Switch', TextField: 'TextField'},
    '../../kit/overlays': {Dialog: 'Dialog', Menu: 'Menu'}, '../../kit/states': {StateView: 'StateView'},
    '../../kit/shell/visual': {shellType: () => ({})}, '../../kit/theme': {useTheme: () => createTheme({isTV: true, width: 1280})},
    './recording-owner-model': model,
  });
}

async function presenter() {
  const {NewRuleSheet} = await loadPresenter();
  const pending = deferred<any>(); const calls: string[] = [];
  const first = {owners: [owner('p1')], grants: [], nextCursor: 'c1'};
  const controller = {lifetime: {current: () => true}, policy: async (cursor = '') => {calls.push(cursor); return cursor ? pending.promise : first;}, load: async () => {}, getSnapshot: () => ({list: {sources: []}}), guideSeries: async () => [], createRule: async () => {}};
  const runtime = {navigation: {getSnapshot: () => ({revision: 7})}, getSnapshot: () => ({contentVisible: true}), text: {t: (key: string) => key}, error: () => ({})};
  let props: any = {controller, runtime, open: true, onOpenChange: () => {}, onSaved: () => {}}; let tree: any;
  const host = createHookHost(() => {tree = NewRuleSheet(props);});
  await act(() => host.mount());
  const select = () => nodes(tree).find(row => row.props.testID === 'live-owner-new-rule-owner');
  const change = async (next: any) => {props = {...props, ...next}; await act(() => host.rerender());};
  return {host, select, change, pending, calls};
}

test('cached owner picker retires old More across close and reopen', async () => {
  const f = await presenter();
  try {
    const oldMore = f.select().props.pickerContext.props.onPress;
    await act(() => {oldMore();}); assert.deepEqual(f.calls, ['', 'c1']);
    await f.change({open: false}); await f.change({open: true});
    await act(() => {oldMore();}); assert.deepEqual(f.calls, ['', 'c1']);
    await act(() => {f.pending.resolve({owners: [owner('old')], grants: [], nextCursor: ''});});
    assert.equal(f.select().props.options.some((option: any) => String(option.value).includes('old')), false);
  } finally {f.host.unmount();}
});

test('owner and rule presenters follow their own three-page cursors and retry the failed cursor', async () => {
  const {NativeRecordingOwner, NewRuleSheet} = await loadPresenter(); const calls: string[] = []; let refreshed = false;
  const rules = (n: number) => ({id: `r${n}`, revision: 1, owner: owner('p1').owner, status: '', kind: 'series', name: `Rule ${n}`, match: `m${n}`, sourceId: 's', enabled: false, options: {prePaddingMs: 0, postPaddingMs: 0, keepPolicy: null, newEpisodesOnly: false, priority: 0, folderTemplate: ''}});
  let fail = true;
  const controller = {lifetime: {current: () => true}, tuners: async () => ({sources: [], upcomingWindowHours: 0}),
    policy: async (cursor = '') => {calls.push(`o:${cursor}`); if (refreshed && cursor === '') return {owners: [owner('new')], grants: [{owner: owner('new').owner, enabled: false, inheritProfiles: false, revision: 2}], nextCursor: 'fresh-owner'}; if (cursor === 'o2' && fail) {fail = false; throw Error('temporary');} return {owners: [owner(cursor === '' ? 'p1' : cursor === 'o1' ? 'p201' : 'p301')], grants: [], nextCursor: cursor === '' ? 'o1' : cursor === 'o1' ? 'o2' : ''};},
    rules: async (cursor = '') => {calls.push(`r:${cursor}`); if (refreshed && cursor === '') return {items: [rules(10)], nextCursor: 'fresh-rule'}; return {items: [rules(cursor === '' ? 1 : cursor === 'r1' ? 101 : 201)], nextCursor: cursor === '' ? 'r1' : cursor === 'r1' ? 'r2' : ''};},
    dvrSettings: async () => ({revision: 1, settings: {}, enumerations: {}})};
  const recordings = {storage: async () => ({policy: {}, measurement: {usedBytes: 0, freeBytes: 0, reservedBytes: 0, writeHealthy: true}, forecastHours: 0})};
  const runtime = {navigation: {getSnapshot: () => ({revision: 7})}, getSnapshot: () => ({contentVisible: true}), text: {t: (key: string) => key}, error: () => ({})};
  let tree: any; const host = createHookHost(() => {tree = NativeRecordingOwner({controller, recordings, runtime, sources: []});});
  const find = (id: string) => nodes(tree).find(row => row.props.testID === id);
  try {
    await act(() => host.mount());
    await act(() => {find('live-owner-owners-more').props.onPress();});
    assert.ok(nodes(tree).some(row => row.props.policy?.owners?.some((choice: any) => choice.owner.profileId === 'p201')));
    await act(() => {find('live-owner-owners-more').props.onPress();});
    assert.ok(find('live-owner-page-retry'));
    await act(() => {find('live-owner-page-retry').props.onPress();});
    await act(() => {find('live-owner-rules-more').props.onPress();});
    assert.ok(find('live-owner-rule-r101'));
    await act(() => {find('live-owner-rules-more').props.onPress();});
    assert.ok(find('live-owner-rule-r201'));
    assert.deepEqual(calls, ['o:', 'r:', 'o:o1', 'o:o2', 'o:o2', 'r:r1', 'r:r2']);
    refreshed = true;
    await act(() => {find('live-owner-new-rule').props.onPress();});
    const sheet = nodes(tree).find(row => row.type === NewRuleSheet);
    await act(() => {sheet.props.onSaved();});
    assert.ok(find('live-owner-rule-r10')); assert.equal(find('live-owner-rule-r101'), undefined);
    assert.ok(nodes(tree).some(row => row.props.policy?.grants?.some((grant: any) => grant.owner.profileId === 'new' && !grant.enabled)));
    assert.equal(nodes(tree).some(row => row.props.policy?.owners?.some((choice: any) => choice.owner.profileId === 'p201')), false);
    await act(() => {find('live-owner-rules-more').props.onPress();});
    assert.ok(calls.includes('r:fresh-rule'));
  } finally {host.unmount();}
});

test('actual sheet Select submits one minute and an old Save cannot settle a reopened sheet', async () => {
  const {NewRuleSheet} = await loadPresenter();
  const pending = deferred<void>(); const bodies: any[] = []; let saved = 0;
  const selected = owner('p1'), grants = [{owner: selected.owner, enabled: true, inheritProfiles: false, revision: 1}];
  const {NativeLiveOwnerController} = await import('../src-next/screens/settings-live/live-owner-controller');
  const {NativeScreenLifetime} = await import('../src-next/screens/settings-live/lifetime');
  const authority = {authority: () => ({serverId: 'server', accountId: 'a', profileId: 'p1', epoch: 'e', viewerFence: 'v'}), current: () => true, subscribeAuthority: () => () => {}};
  const api = {request: async <T,>(path: string, method?: string, body?: unknown) => {
    if (method === 'POST') {bodies.push(body); await pending.promise; return {} as T;}
    if (path.startsWith('/v1/guide?')) {const q = new URLSearchParams(path.split('?')[1]); const start = q.get('start')!, end = q.get('end')!; const at = new Date(Date.parse(start) + 3600000).toISOString(), until = new Date(Date.parse(start) + 7200000).toISOString(); return {protocolVersion: '1.0', serverId: 'server', guide: {viewerFence: 'v', start, end, timezone: 'UTC', observedAt: start, nextCursor: '', sources: [{id: 's', name: 'Source', generation: 'g', publishedAt: start, availableStart: start, availableEnd: end, provenance: 'live-source', refreshState: ''}], channels: [{id: 'c', sourceId: 's', provenance: 'live-source', name: 'Channel', generation: 'g', preferenceRevision: 0, recordAvailable: true, programmes: [{id: 'p', channelId: 'c', title: 'A title', start: at, end: until, seriesId: ''}]}]}} as T;}
    return {protocolVersion: '1.0', serverId: 'server', sources: [], refresh: []} as T;
  }};
  const controller = new NativeLiveOwnerController(new NativeScreenLifetime(authority), api, () => 'op1');
  const runtime = {navigation: {getSnapshot: () => ({revision: 7})}, getSnapshot: () => ({contentVisible: true}), text: {t: (key: string) => key}, error: () => ({})};
  let props: any = {controller, runtime, policy: {owners: [selected], grants}, sources: [{id: 's', name: 'Source'}], open: true, onOpenChange: () => {}, onSaved: () => {saved++;}}; let tree: any;
  const host = createHookHost(() => {tree = NewRuleSheet(props);});
  const find = (id: string) => nodes(tree).find(row => row.props.testID === id);
  try {
    await act(() => host.mount());
    await act(() => {find('live-owner-new-rule-series').props.onValueChange(JSON.stringify(['s', 'c', 'g', 'p']));});
    await act(() => {find('live-owner-new-rule-before').props.onValueChange('60');});
    const save = nodes(tree.props.footer).find(row => row.type === 'Button' && row.props.children === 'action.save').props.onPress;
    await act(() => {save();});
    assert.equal(bodies.length, 1); assert.equal(bodies[0].kind, 'title'); assert.equal(bodies[0].match, 'A title'); assert.equal(bodies[0].options.prePaddingMs, 60000);
    props = {...props, open: false}; await act(() => host.rerender());
    props = {...props, open: true}; await act(() => host.rerender());
    await act(() => {save();}); assert.equal(bodies.length, 1);
    await act(() => {pending.resolve();}); assert.equal(saved, 0);
  } finally {host.unmount();}
});

test('owner picker continuation registers in a strict focus region', async () => {
  const registry = await import('../src-next/kit/focus/registry');
  const hostRefs = await import('../src-next/kit/focus/useHostRef');
  const contexts: {current: unknown}[] = [];
  const focus = await screenModule(new URL('../src-next/kit/focus/FocusRegion.tsx', import.meta.url), {
    react: {...React, default: React, createContext: (current: unknown) => {const value = {current}; contexts.push(value); return value;}, useContext: (context: {current: unknown}) => context.current},
    'react-native': {findNodeHandle: () => null, TVFocusGuideView: 'Guide', View: 'View'},
    '../theme': {useTheme: () => ({isTV: true}), nativeType: () => ({})}, './registry': registry, './useHostRef': hostRefs,
  });
  const f = await presenter();
  try {
    const button = f.select().props.pickerContext;
    const focusRegistry = registry.createFocusRegistry(); focusRegistry.configure({id: 'dvr-picker', orientation: 'vertical'});
    contexts[0]!.current = focusRegistry; contexts[1]!.current = 'dvr-picker';
    const target = createHookHost(() => {focus.useFocusTarget({focusId: button.props.focusId, testID: button.props.testID, disabled: button.props.disabled});});
    target.mount(); target.unmount();
    assert.equal(button.props.focusId, 'live-owner-picker-more');
  } finally {f.host.unmount();}
});

test('cached picker retires More on unmount even while its controller remains live', async () => {
  const f = await presenter();
  await f.change({open: false}); await f.change({open: true});
  const more = f.select().props.pickerContext.props.onPress;
  await act(() => {more();}); assert.deepEqual(f.calls, ['', 'c1']);
  f.host.unmount();
  await act(() => {more(); f.pending.resolve({owners: [owner('old')], grants: [], nextCursor: ''});});
  assert.deepEqual(f.calls, ['', 'c1']);
});

test('old page handler cannot send its cursor through a replacement controller', async () => {
  const {NativeRecordingOwner} = await loadPresenter(); const calls: string[] = [];
  const make = (name: string) => ({lifetime: {current: () => true}, tuners: async () => ({sources: [], upcomingWindowHours: 0}),
    policy: async (cursor = '') => {calls.push(`${name}:${cursor}`); return {owners: [owner(name)], grants: [], nextCursor: `${name}-cursor`};},
    rules: async () => ({items: [], nextCursor: ''}), dvrSettings: async () => ({revision: 1, settings: {}, enumerations: {}})});
  let controller = make('a'); const replacement = make('b');
  const recordings = {storage: async () => ({policy: {}, measurement: {usedBytes: 0, freeBytes: 0, reservedBytes: 0, writeHealthy: true}, forecastHours: 0})};
  const runtime = {navigation: {getSnapshot: () => ({revision: 7})}, getSnapshot: () => ({contentVisible: true}), text: {t: (key: string) => key}, error: () => ({})};
  let tree: any; const host = createHookHost(() => {tree = NativeRecordingOwner({controller, recordings, runtime, sources: []});});
  try {
    await act(() => host.mount());
    const old = nodes(tree).find(row => row.props.testID === 'live-owner-owners-more').props.onPress;
    controller = replacement; await act(() => host.rerender());
    await act(() => {old();});
    assert.deepEqual(calls, ['a:', 'b:']);
    assert.ok(nodes(tree).some(row => row.props.policy?.owners?.some((choice: any) => choice.owner.profileId === 'b')));
  } finally {host.unmount();}
});
