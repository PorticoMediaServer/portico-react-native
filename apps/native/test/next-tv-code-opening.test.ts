import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {ApiError} from '../../../packages/client-core/src/index.ts';
import {SetupCodeService, type SetupCodeJournal, type SetupCodeSnapshot} from '../../../packages/client-core/src/setup-code.ts';
import {defaultI18n} from '../../../packages/i18n/src';
import {createTheme, nativeType} from '../src-next/kit/theme';
import {createTVCodeOpening, type TVCodeOpening, type TVCodeKind} from '../src-next/screens/accounts/tv-code-opening';
import {useTVBusyEntryRevision} from '../src-next/tv/auth/entry-revision';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';
import * as tvCodeOpening from '../src-next/screens/accounts/tv-code-opening';
import * as passwordPolicy from '../../../packages/client-core/src/password-strength';
import * as setupOutcome from '../src-next/platform/setup-outcome';
import * as joinLink from '../../../packages/client-core/src/join-link';
import * as invitationCode from '../../../packages/client-core/src/short-invitation-code';
import * as directoryChooser from '../src-next/screens/accounts/directory-chooser';
import {routeOrigin} from '../../../packages/client-core/src/route-identity';

const deferred = <T,>() => {let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const settle = async () => {for (let i = 0; i < 4; i++) await act(() => {});};
type Grant = {accepted: true};

/** Real durable service + real opening + real presenter. The issuing API/storage
 * are in-memory boundaries; this does not exercise native hosts, crypto or HTTP. */
function fixture() {
  let owner: TVCodeOpening | undefined, stage = 'tv', alive = true, source = {};
  let view: {opening: TVCodeOpening; state: Omit<SetupCodeSnapshot<Grant>, 'grant'>} | undefined;
  let error: unknown, busy = false, ids = 0, failNext = false;
  let holdNext: ReturnType<typeof deferred<void>> | undefined;
  const journals = new Map<string, SetupCodeJournal<Grant>>();
  const services: {service: SetupCodeService<Grant>; callbacks: (() => void)[]; cancels: number}[] = [];
  const calls = {create: 0, poll: 0, cancel: 0, accept: 0, credentials: 0};
  let poll: 'denied' | 'pending' | 'approved' = 'denied';
  let acceptHold: ReturnType<typeof deferred<void>> | undefined;
  function newService(kind: TVCodeKind) {
    const authority = kind === 'local' ? 'local:fixture' : 'https://accounts.example#tv-x25519-v1';
    const service = new SetupCodeService<Grant>(authority, {
      async create() {
        const code = ++calls.create === 1 ? 'ABCD-EFGH' : 'JKMN-PQRS';
        const verificationUri = (kind === 'local' ? 'https://local.example' : 'https://accounts.example') + '/device';
        return {deviceCode: 'd'.repeat(48), userCode: code, verificationUri, verificationUriComplete: verificationUri + '#code=' + code,
          expiresAt: new Date(Date.now() + 600_000).toISOString(), expiresIn: 600, interval: 5};
      },
      async poll() {calls.poll++; if (poll === 'approved') return {accepted: true};
        throw new ApiError(400, poll === 'denied' ? 'access_denied' : 'authorization_pending', 'fixture response', false);},
      async cancel() {calls.cancel++;},
    }, {async change(update) {
      const hold = holdNext; holdNext = undefined; if (hold) await hold.promise;
      if (failNext) {failNext = false; throw new Error('fixture storage unavailable');}
      const next = update(journals.get(authority)); journals.set(authority, next); return next;
    }}, async () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    {requestTimeoutMs: 15_000, tickMs: 1000, replaceBeforeMs: 60_000, random: () => 0});
    const entry = {service, callbacks: [] as (() => void)[], cancels: 0}; services.push(entry);
    const subscribe = service.subscribe, cancel = service.cancel.bind(service);
    service.subscribe = callback => {entry.callbacks.push(callback); return subscribe(callback);};
    service.cancel = async () => {entry.cancels++; await cancel();};
    return service;
  }
  function mount(kind: TVCodeKind, originalSource = source) {
    const service = newService(kind);
    const opening = createTVCodeOpening({kind, service, source: originalSource}, {
      owns: value => owner === value,
      current: original => alive && stage === 'tv' && original.source === source,
      publish: (opening, state) => {view = {opening, state};},
      busy: value => {busy = value;}, error: value => {error = value;},
      replace: async (original, current) => {if (current()) await mount(original.kind, original.source).start();},
      credentials: async (_, current) => {calls.credentials++; if (current()) {opening.retire(); owner = undefined; stage = 'credentials';}},
      accept: async (original, grant, current) => {
        if (!current()) return; calls.accept++; if (acceptHold) await acceptHold.promise;
        if (!current()) return;
        const completed = await original.service.complete(grant);
        if (current() && completed) {opening.retire(); owner = undefined; stage = 'done';}
      },
    });
    owner?.retire(); owner = opening; stage = 'tv'; error = undefined;
    view = {opening, state: {phase: 'idle'}};
    return opening;
  }
  return {mount, newService, calls, services, view: () => view!, error: () => error, busy: () => busy, stage: () => stage,
    poll: (value: typeof poll) => {poll = value;}, failNext: () => {failNext = true;},
    holdNext: () => holdNext = deferred<void>(), holdAccept: () => acceptHold = deferred<void>(),
    changeSource: () => {source = {};},
    back() {owner?.retire(true); owner = undefined; stage = 'welcome'; busy = false;},
    unmount() {owner?.retire(); owner = undefined; alive = false;},
    cleanup() {owner?.retire(); for (const {service} of services) service.pause();},
  };
}

async function presenter(f: ReturnType<typeof fixture>, kind: TVCodeKind) {
  const entries: unknown[] = [];
  const {TVCodePresenter} = await screenModule(new URL('../src-next/tv/auth/TVCodePresenter.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {Text: 'Text', View: 'View'}, 'react-native-qrcode-svg': {default: 'QR'},
    '../../../../../packages/i18n/src': {defaultI18n}, '../../kit/controls': {Button: 'Button'},
    '../../kit/focus': {FocusProvider: 'Provider', FocusRegion: 'Region'}, '../../kit/theme': {nativeType, useTheme: () => createTheme({isTV: true, width: 1920})},
    '../../screens/destinations/useEntryFocus': {useDestinationEntryFocus: (activation: unknown, address: unknown) => {entries.push({activation, address});}},
    '../../platform/native-blur': {BlurView: 'Blur', glassRecipe: () => ({nativeBlur: false})},
    './entry-revision': {useTVBusyEntryRevision}, './TVAuthLayout': {TVAuthLayout: 'Layout'},
  });
  let tree: any;
  const host = createHookHost(() => {
    const {opening, state} = f.view();
    const terminal = state.phase === 'denied' || state.phase === 'error' || f.error();
    const wrapped = TVCodePresenter({mode: kind, serverName: 'Fixture server', body: 'Fixture consent', ...state, busy: f.busy(),
      onNewCode: terminal ? () => {void opening.newCode();} : undefined,
      onTypeCredentials: () => {void opening.credentials();}, onBack: () => {if (opening.current()) f.back();}});
    tree = wrapped.props.children.type(wrapped.props.children.props);
  });
  await act(() => host.mount());
  return {host, entries, tree: () => tree, button: (id: string) => nodes(tree).find(n => n.type === 'Button' && n.props.focusId === id),
    refresh: () => act(() => host.rerender())};
}

async function accountEntry(f: ReturnType<typeof fixture>) {
  let tree: any, completed = 0;
  const back = new Set<() => boolean>();
  class LocalSource {
    static parseInvitationEntry() {return undefined;}
    async inspect() {return {id: 'fixture', name: 'Fixture server', signIn: 'local'};}
    needsIdentityCode() {return false;}
    async inspectLocalIdentity() {return {};}
    async confirmLocal() {}
    serverDescriptor() {return {id: 'fixture', name: 'Fixture server', signIn: 'local'};}
    localTVSignIn() {return f.newService('local');}
    async acceptLocalTVSession() {throw new Error('unexpected grant in denied-entry vector');}
    dispose() {}
  }
  const modules: Record<string, unknown> = {
    react: {...React, default: React},
    'react-native': {Platform: {isTV: true}, AppState: {currentState: 'active', addEventListener: () => ({remove() {}})},
      BackHandler: {addEventListener: (_: string, fn: () => boolean) => {back.add(fn); return {remove: () => back.delete(fn)};}},
      TVEventControl: {enableTVMenuKey() {}, disableTVMenuKey() {}}, View: 'View', Text: 'Text', Image: 'Image', NativeModules: {}},
    'react-native-qrcode-svg': {default: 'QR'}, '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src/route-identity': {routeOrigin},
    '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'Fixture failure', category: 'unavailable'})},
    '../../../../../packages/client-core/src/password-strength': passwordPolicy,
    '../../../../../packages/client-core/src/join-link': joinLink,
    '../../../../../packages/client-core/src/short-invitation-code': invitationCode,
    '../../kit/theme': {useTheme: () => createTheme({isTV: true, width: 1920})}, '../../kit/states': {StateLayout: 'Layout'},
    '../../kit/controls': {Button: 'Button', Focusable: 'Focusable', TextField: 'Field'}, '../../kit/artwork': {ProfilePicker: 'Picker'},
    '../../tv/auth': {TVCodePresenter: 'Code', TVFrontDoor: 'Front', TVCredentialForm: 'Credentials'},
    '../../platform/accounts': {nativeAccounts: {accountCredentials: () => ({synchronize: async () => {}, getSnapshot: () => ({})})}},
    '../../platform/server-sign-in': {NativeServerSignIn: LocalSource}, '../../platform/setup-outcome': setupOutcome,
    '../../platform/portico-sign-in': {NativePorticoSignIn: class {async prepare() {return {};} dispose() {}}},
    '../../platform/server-connections': {browseNearby: async () => []},
    '../../platform/tv-sign-in': {createNativePorticoTVSignIn: () => f.newService('portico')},
    './directory-chooser': directoryChooser, './tv-code-opening': tvCodeOpening,
    './PhoneFrontDoor': {PhoneFrontDoor: 'PhoneFrontDoor'},
  };
  // Unvisited native/credential branches may import names, but an unexpected
  // invocation fails loudly; no omitted guard/service is silently a no-op.
  const strict = new Proxy(modules, {get: (all, module: string) => all[module] ?? new Proxy({}, {
    get: (_, name: string) => function unexpectedBoundary() {throw new Error(`Unvisited fixture boundary: ${module}:${name}`);},
  })});
  const {AccountEntry} = await screenModule(new URL('../src-next/screens/accounts/AccountEntry.tsx', import.meta.url), strict);
  const host = createHookHost(() => {tree = AccountEntry({onComplete: () => {completed++;}});});
  await act(() => host.mount());
  return {host, tree: () => tree, completed: () => completed, back,
    async enter(kind: TVCodeKind) {
      if (kind === 'portico') await act(() => {tree.props.onPortico();});
      else {
        await act(() => {tree.props.onLocal();});
        await act(() => {nodes(tree.props.beforeActions).find(n => n.type === 'Field').props.onChangeText('https://local.example');});
        await act(() => {tree.props.primaryAction.onPress();});
      }
      assert.equal(tree.type, 'Code');
    }};
}

for (const kind of ['local', 'portico'] as const) {
  test(`${kind}: actual AccountEntry owns initial storage settlement after Back, not a stale generic run-finally`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture(), entry = await accountEntry(f);
    try {
      const hold = f.holdNext(); await entry.enter(kind); assert.equal(entry.tree().props.busy, true);
      await act(() => {assert.equal([...entry.back][0](), true);});
      await entry.enter(kind === 'local' ? 'portico' : 'local'); t.mock.timers.tick(0); await settle();
      const successor = entry.tree().props; assert.equal(successor.busy, false);
      hold.reject(new Error('late original initial storage')); await settle();
      assert.equal(entry.tree().props, successor); assert.equal(entry.completed(), 0);
    } finally {entry.host.unmount(); f.cleanup();}
  });

  test(`${kind}: actual AccountEntry action/subscription stay with their rendered opening through Back and successor`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture(); const entry = await accountEntry(f);
    try {
      await entry.enter(kind); t.mock.timers.tick(0); await settle(); t.mock.timers.tick(5000); await settle();
      assert.equal(typeof entry.tree().props.onNewCode, 'function');
      const old = entry.tree().props, hold = f.holdNext(); old.onNewCode(); old.onNewCode(); await settle();
      assert.equal(f.services[0].cancels, 1);
      await act(() => {assert.equal([...entry.back][0](), true);});
      assert.equal(entry.tree().type, 'Front', 'hardware Back leaves the pending original synchronously');
      await entry.enter(kind === 'local' ? 'portico' : 'local'); t.mock.timers.tick(0); await settle();
      const successor = entry.tree().props;
      hold.reject(new Error('late original cancellation')); await settle();
      old.onNewCode(); old.onTypeCredentials(); old.onBack(); await settle();
      assert.equal(entry.tree().props, successor, 'retained handlers do not set busy/error, close or replace successor');
      f.services[0].service.getSnapshot = () => {throw new Error('old AccountEntry source read');};
      f.services[0].callbacks[0](); assert.equal(entry.completed(), 0);
      entry.host.unmount(); const last = f.services.at(-1)!;
      last.service.getSnapshot = () => {throw new Error('unmounted AccountEntry source read');}; last.callbacks[0]();
    } finally {entry.host.unmount(); f.cleanup();}
  });

  test(`${kind}: denied service stays stopped until rendered New code; one cancellation/replacement and fresh QR/poll`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture(); let p: Awaited<ReturnType<typeof presenter>> | undefined;
    try {
      await f.mount(kind).start(); t.mock.timers.tick(0); await settle();
      const firstCode = f.view().state.userCode;
      t.mock.timers.tick(5000); await settle(); assert.equal(f.view().state.phase, 'denied');
      t.mock.timers.tick(60_000); await settle(); assert.equal(f.calls.create, 1); assert.equal(f.calls.poll, 1, 'no automatic retry after denial');
      p = await presenter(f, kind);
      const order = nodes(p.tree()).find(n => n.type === 'Region').props.order;
      assert.deepEqual(order, kind === 'local' ? ['credentials', 'new-code'] : ['credentials', 'new-code', 'back']);
      assert.equal(nodes(p.tree()).find(n => n.type === 'Region').props.entry, 'new-code');
      assert.deepEqual((p.entries.at(-1) as any).address, {regionId: `tv.auth.${kind}.code`, childId: 'new-code'});
      assert.ok(!nodes(p.tree().props.aside).some(n => n.type === 'Text' && n.props.children === defaultI18n.t('activation.codeRefreshes')));
      const oldPress = p.button('new-code').props.onPress;
      oldPress(); oldPress(); await settle(); t.mock.timers.tick(0); await settle();
      assert.equal(f.services[0].cancels, 1, 'double select owns one cancellation'); assert.equal(f.services.length, 2); assert.equal(f.calls.create, 2);
      assert.equal(f.view().state.phase, 'waiting'); assert.notEqual(f.view().state.userCode, firstCode); await p.refresh();
      assert.equal(nodes(p.tree().props.aside).find(n => n.type === 'QR').props.value, f.view().state.verificationUriComplete);
      const before = {...f.calls}; oldPress(); await settle(); assert.deepEqual(f.calls, before, 'retained old action cannot target successor');
      f.services[0].service.getSnapshot = () => {throw new Error('retired source must not be read');};
      for (const oldCallback of f.services[0].callbacks) oldCallback(); assert.deepEqual(f.calls, before);
      f.poll('pending'); t.mock.timers.tick(5000); await settle(); assert.equal(f.calls.poll, 2, 'replacement really resumes polling');
    } finally {p?.host.unmount(); f.cleanup();}
  });

  test(`${kind}: initial durable error offers explicit New code; failed cancellation does not auto-retry`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture(); let p: Awaited<ReturnType<typeof presenter>> | undefined;
    try {
      f.failNext(); await f.mount(kind).start(); assert.equal(f.view().state.phase, 'error');
      p = await presenter(f, kind); assert.ok(p.button('new-code')); t.mock.timers.tick(60_000); await settle(); assert.equal(f.calls.create, 0);
      f.failNext(); p.button('new-code').props.onPress(); await settle();
      assert.equal(f.services.length, 1); assert.equal(f.services[0].cancels, 1); assert.ok(f.error());
      t.mock.timers.tick(60_000); await settle(); assert.equal(f.services[0].cancels, 1); assert.equal(f.calls.create, 0);
      await p.refresh(); p.button('new-code').props.onPress(); await settle(); t.mock.timers.tick(0); await settle();
      assert.equal(f.services[0].cancels, 2, 'only a second explicit press retries failed durable cancellation');
      assert.equal(f.services.length, 2); assert.equal(f.calls.create, 1); assert.equal(f.view().state.phase, 'waiting');
    } finally {p?.host.unmount(); f.cleanup();}
  });

  test(`${kind}: Back during cancellation retires synchronously; late storage refusal cannot alter other-mode successor`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture(); let p: Awaited<ReturnType<typeof presenter>> | undefined;
    try {
      await f.mount(kind).start(); t.mock.timers.tick(0); await settle(); t.mock.timers.tick(5000); await settle();
      p = await presenter(f, kind); const oldPress = p.button('new-code').props.onPress;
      const hold = f.holdNext(); oldPress(); await settle(); f.back();
      const other = kind === 'local' ? 'portico' : 'local'; await f.mount(other).start(); t.mock.timers.tick(0); await settle();
      const successor = f.view(), before = {...f.calls};
      hold.reject(new Error('late original storage error')); await settle(); oldPress(); await settle();
      assert.equal(f.view(), successor); assert.equal(f.error(), undefined); assert.equal(f.busy(), false); assert.equal(f.stage(), 'tv');
      assert.deepEqual(f.calls, before); assert.equal(f.services[0].cancels, 1, 'Back does not cancel an in-flight original twice');
      f.services[0].service.getSnapshot = () => {throw new Error('old callback source');}; f.services[0].callbacks[0]();
    } finally {p?.host.unmount(); f.cleanup();}
  });

  test(`${kind}: source replacement and credentials/unmount refuse retained subscription before read/adopt`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture();
    try {
      const opening = f.mount(kind); await opening.start(); t.mock.timers.tick(0); await settle();
      const old = f.services[0]; f.changeSource(); old.service.getSnapshot = () => {throw new Error('source witness changed');};
      old.callbacks[0](); await opening.newCode(); assert.equal(old.cancels, 0); assert.equal(f.calls.accept, 0);
      const next = f.mount(kind); await next.start(); await next.credentials(); assert.equal(f.stage(), 'credentials');
      const current = f.services[1]; current.service.getSnapshot = () => {throw new Error('credential departure');}; current.callbacks[0]();
      await next.newCode(); assert.equal(current.cancels, 1); assert.equal(f.calls.credentials, 1);
      const last = f.mount(kind); await last.start(); const lastService = f.services.at(-1)!; f.unmount();
      lastService.service.getSnapshot = () => {throw new Error('unmounted source');}; lastService.callbacks[0]();
      await last.newCode(); assert.equal(lastService.cancels, 0, 'unmount pauses without abandoning durable operation'); assert.equal(f.calls.accept, 0);
    } finally {f.cleanup();}
  });

  test(`${kind}: unmount during accepted grant await refuses completion and further publication`, async t => {
    t.mock.timers.enable({apis: ['Date', 'setTimeout']});
    const f = fixture();
    try {
      f.poll('approved'); const hold = f.holdAccept(); await f.mount(kind).start(); t.mock.timers.tick(0); await settle();
      t.mock.timers.tick(5000); await settle(); assert.equal(f.calls.accept, 1);
      const shown = f.view(); f.unmount(); hold.resolve(); await settle();
      assert.equal(f.stage(), 'tv'); assert.equal(f.view(), shown); assert.equal(f.services[0].service.getSnapshot().phase, 'approved', 'retired UI does not complete a grant after its await');
    } finally {f.cleanup();}
  });
}
