import test from 'node:test';
import assert from 'node:assert/strict';
import type {DirectSnapshot} from '../../../packages/client-core/src/profile-management';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {PeoplePagesController, type PeoplePages} from '../src-next/screens/settings-live/server/people-pages';

const authority = {serverId: 'server', accountId: 'account', profileId: 'primary', epoch: 'one', viewerFence: 'fence'};
const account = {canManage: true, account: {role: 'admin', primaryProfileId: 'primary', disabled: false}} as DirectSnapshot;
const device = (id: string) => ({id, accountId: 'account', profileId: 'primary', username: 'a', name: id, platform: 'tv', app: '', appVersion: '', lastNetwork: '', liveState: 'idle', firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z', revision: 1});

test('People continuation coalesces, retains rows on failure, retries the offered cursor and fences retirement', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let state!: PeoplePages, calls = 0, resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const api = {request: <T,>(path: string) => {
    assert.match(path, /\/devices\?limit=50/); calls++;
    return new Promise<unknown>((ok, fail) => {resolve = ok; reject = fail;}) as Promise<T>;
  }};
  const pages = new PeoplePagesController({account, api}, lifetime, next => {state = next;});
  const first = pages.load('devices');
  resolve({items: [device('one')], limit: 50, nextCursor: 'next'}); await first;
  const second = pages.load('devices'); await pages.load('devices'); assert.equal(calls, 2);
  reject(new Error('offline')); await second;
  assert.deepEqual(state.devices.items.map(row => row.id), ['one']); assert.equal(state.devices.cursor, 'next');
  const retry = pages.load('devices'); resolve({items: [device('one'), device('two')], limit: 50, nextCursor: 'next'}); await retry;
  assert.deepEqual(state.devices.items.map(row => row.id), ['one', 'two']); assert.equal(state.devices.cursor, '');
  await pages.load('devices'); assert.equal(calls, 3);
  pages.dispose(); lifetime.dispose();
});

test('retired People continuation cannot publish a late page', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let resolve!: (value: unknown) => void, updates = 0;
  const pages = new PeoplePagesController({account, api: {request: <T,>() => new Promise<unknown>(ok => {resolve = ok;}) as Promise<T>}}, lifetime, () => {updates++;});
  const pending = pages.load('devices'); lifetime.dispose(); resolve({items: [device('late')], limit: 50, nextCursor: ''}); await pending;
  assert.equal(updates, 1); pages.dispose();
});

const member = (id: string) => ({accountId: id, username: id, profileId: 'primary', role: 'member', disabled: false, revision: 1, allowedLibraries: [], limitsRevision: 1, serverMaxStreams: null, effectiveMaxStreams: null, limits: {accessTokens: false, maxProfiles: 1, allowRemote: false, conversion: 'none', maxStreams: 0, maxStreamsMode: 'inherit'}});
const invitation = (id: string) => ({id, revision: 1, role: 'member', state: 'pending', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', allowedLibraries: []});

test('owner and administrator follow each real People section cursor and request pending invitations', async () => {
  for (const role of ['owner', 'admin'] as const) {
    const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
    let state!: PeoplePages;
    const calls: string[] = [];
    const pages = new PeoplePagesController({account: {...account, account: {...account.account, role}}, api: {request: async <T,>(path: string) => {
      calls.push(path);
      const [base, query] = path.split('?'), params = new URLSearchParams(query);
      const cursor = params.get('cursor');
      assert.equal(params.get('limit'), '50');
      const ordinal = cursor === 'second' ? 2 : cursor === 'third' ? 3 : 1;
      const nextCursor = ordinal === 1 ? 'second' : ordinal === 2 ? 'third' : '';
      if (base.endsWith('/members')) return {items: [member(`m${ordinal}`)], limit: 50, nextCursor} as T;
      if (base.endsWith('/devices')) return {items: [device(`d${ordinal}`)], limit: 50, nextCursor} as T;
      assert.equal(params.get('state'), 'pending');
      // The only pending record is outside the server's first unfiltered page;
      // filtering at the producer yields it in this first pending page.
      return {items: ordinal === 1 ? [invitation('pending')] : [], limit: 50, nextCursor, totalCount: 60, matchedCount: 1} as T;
    }}}, lifetime, next => {state = next;});
    for (const section of ['members', 'invitations', 'devices'] as const) {
      await pages.load(section); await pages.load(section); await pages.load(section); await pages.load(section);
    }
    assert.deepEqual(state.members.items.map(row => row.accountId), ['m1', 'm2', 'm3']);
    assert.deepEqual(state.devices.items.map(row => row.id), ['d1', 'd2', 'd3']);
    assert.deepEqual(state.invitations.items.map(row => row.id), ['pending']);
    assert.equal(calls.length, 9);
    pages.dispose(); lifetime.dispose();
  }
});

test('TV People binds final device focus and the scoped retry to its real page controller', async () => {
  const {hooks, screenModule} = await import('./helpers/screen-harness.mjs');
  const peopleModule = await import('../src-next/screens/settings-live/server/people-pages');
  const host = hooks();
  const effects: Array<() => void | (() => void)> = [];
  host.react.useLayoutEffect = (next: () => void | (() => void)) => {if (!effects.length) effects.push(next);};
  const module = await screenModule(new URL('../src-next/screens/settings-live/server/TVPeoplePanel.tsx', import.meta.url), {
    react: host.react, 'react-native': {Text: 'Text', View: 'View'},
    '../../../kit/controls': {Focusable: 'Focusable'}, '../../../kit/shell/visual': {shellType: () => ({})},
    '../../../kit/states': {StateView: 'StateView'}, '../../../kit/theme': {useTheme: () => ({colors: {raised: '', accent: '', accentStrong: '', text: '', textSecondary: ''}})},
    './people-pages': peopleModule,
  });
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let deviceCalls = 0;
  const ports = {context: {account, api: {request: async <T,>(path: string) => {
    const [base] = path.split('?');
    if (base.endsWith('/members')) return {items: [], limit: 50, nextCursor: ''} as T;
    if (base.endsWith('/invitations')) return {items: [], limit: 50, nextCursor: '', totalCount: 0, matchedCount: 0} as T;
    deviceCalls++;
    if (deviceCalls === 2) throw new Error('offline');
    return {items: [device(deviceCalls === 1 ? 'first' : 'last')], limit: 50, nextCursor: deviceCalls === 1 ? 'next' : ''} as T;
  }}}};
  const runtime = {text: {t: (id: string) => id, locale: 'en-US'}, error: (_error: unknown, retry: () => void) => ({title: 'error', retry})};
  const render = () => host.render(() => module.TVPeoplePanel({ports, runtime, lifetime}));
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  render(); const cleanup = effects[0](); await flush();
  let first = nodes(render()).find(node => node.props.focusId === 'tv-people:device:first');
  assert.ok(first); first.props.onFocus(); await flush();
  const failed = nodes(render()).find(node => node.props.testID === 'tv-people-devices-error');
  assert.ok(failed); assert.ok(nodes(render()).find(node => node.props.focusId === 'tv-people:device:first'));
  failed.props.retry(); await flush();
  assert.ok(nodes(render()).find(node => node.props.focusId === 'tv-people:device:last'));
  assert.equal(deviceCalls, 3); if (typeof cleanup === 'function') cleanup(); lifetime.dispose();
});

test('a stale People row cannot start a successor cursor', async () => {
  const lifetime = new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});
  let state!: PeoplePages, calls = 0;
  const pages = new PeoplePagesController({account, api: {request: async <T,>() => {
    calls++;
    return {items: [device(String(calls))], limit: 50, nextCursor: calls === 1 ? 'first' : calls === 2 ? 'second' : ''} as T;
  }}}, lifetime, next => {state = next;});
  await pages.load('devices');
  const oldCursor = state.devices.cursor;
  await pages.load('devices', oldCursor);
  await pages.load('devices', oldCursor);
  assert.equal(calls, 2);
  assert.equal(state.devices.cursor, 'second');
  pages.dispose(); lifetime.dispose();
});
