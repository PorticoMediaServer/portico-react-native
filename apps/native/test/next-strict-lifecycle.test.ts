import {focusTestID} from '../src-next/kit/focus/registry.ts';
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {heroSpec} from '@portico/design';
import {sameFence, type PlaybackFence} from '../../../packages/player-core/src/index.ts';
import {createRotationClock} from '../src-next/kit/layout/model.ts';
import * as shellModel from '../src-next/shell/model.ts';
import type {DockOccupant} from '../src-next/kit/dock/types.ts';
import type {NativeShellRuntime} from '../src-next/shell/runtime.ts';
import {act, createHookHost} from './hook-driver.ts';
import {screenModule} from './helpers/screen-harness.mjs';
import {currentMorphFence} from '../src-next/kit/dock/morph-fence.ts';
import {releaseDock, validRect} from '../src-next/kit/dock/model.ts';

// Run the actual owned hooks/components with React's hook driver. Native hosts
// and animation delivery are controlled here; this does not prove device motion.
function lifecycle() {
  const effects: {setup: () => void | (() => void); cleanup: void | (() => void)}[] = [];
  const timings: {value: number; duration?: number; complete?: (finished: boolean) => void}[] = [];
  const cancelled: object[] = [], delays: number[] = [];
  let writes = 0;
  const motion = {reduce: false, transforms: true, timing: () => ({duration: 180})};
  const react = {...React, default: React,
    useState: (initial: any) => {
      const [value, set] = React.useState(initial);
      return [value, (next: any) => {writes++; set(next);}];
    },
    useEffect: (setup: () => void | (() => void), deps?: readonly unknown[]) => React.useEffect(() => {
      const cleanup = setup(); effects.push({setup, cleanup}); return cleanup;
    // This harness forwards the component's exact effect dependencies to React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps),
  };
  const animated = {
    default: {View: 'AnimatedView', ScrollView: 'AnimatedScrollView'},
    useSharedValue: (value: number) => React.useRef({value}).current,
    useAnimatedStyle: () => ({}), useAnimatedScrollHandler: (handler: unknown) => handler,
    withTiming: (value: number, config: {duration?: number}, complete?: (finished: boolean) => void) => {timings.push({value, ...config, complete}); return value;},
    withDelay: (delay: number, value: number) => {delays.push(delay); return value;},
    cancelAnimation: (value: object) => {cancelled.push(value);}, runOnJS: (fn: unknown) => fn,
  };
  const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
    AppState: {currentState: 'active', addEventListener: () => ({remove() {}})},
    useWindowDimensions: () => ({width: 390, height: 844}),
  };
  return {react, animated, native, motion, effects, timings, cancelled, delays, get writes() {return writes;}};
}

function mount(component: any, initial: any) {
  let props = initial, tree: any;
  const host = createHookHost(() => {tree = component(props);});
  host.mount();
  return {host, get tree() {return tree;}, update(next: any) {props = next; host.rerender();}};
}
function elements(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<any>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
function timers(t: TestContext) {
  let now = 0;
  const tasks: {run: () => void; ms: number; cancelled: boolean}[] = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (run: () => void, ms = 0) => {
    const task = {run, ms, cancelled: false}; tasks.push(task);
    return task as unknown as ReturnType<typeof setTimeout>;
  });
  t.mock.method(globalThis, 'clearTimeout', (token: unknown) => {
    const task = tasks.find(value => value === token); if (task) task.cancelled = true;
  });
  return {tasks, at(value: number) {now = value;}};
}

const fence: PlaybackFence = {kind: 'queue', playback: {scope: {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane'}, run: 1},
  sessionId: 'session', sourceId: 'source', itemId: 'item', entryId: 'entry', generation: 1};
function occupant(generation = 1, playing = true): DockOccupant {
  const current = {...fence, generation, sourceId: `source-${generation}`};
  return {mode: 'music', playback: {fence: current, kind: 'music', queue: null, positionSeconds: 30, playing, expanded: false}, presentation: {fence: current}} as DockOccupant;
}
async function dockModule(state: ReturnType<typeof lifecycle>) {
  return screenModule(new URL('../src-next/kit/dock/useDockPresence.ts', import.meta.url), {
    react: state.react, 'react-native-reanimated': state.animated,
    '../../../../../packages/player-core/src/index': {sameFence}, '../useMotion': {useMotion: () => state.motion},
  });
}

test('idle PlayerMorph hides the Android surface host without removing its persistent child', async () => {
  const state = lifecycle();
  const {PlayerMorph} = await screenModule(new URL('../src-next/kit/dock/PlayerMorph.tsx', import.meta.url), {
    react: state.react, 'react-native': {...state.native, Platform: {OS: 'android'}},
    'react-native-gesture-handler': {Gesture: {}}, 'react-native-reanimated': {...state.animated, useAnimatedReaction() {}},
    '../../../../../packages/player-core/src/index': {}, '../Icon': {Icon: 'Icon'},
    '../theme': {useTheme: () => ({layers: {player: 30}, colors: {shadow: '#000'}})},
    '../useMotion': {useMotion: () => state.motion}, './morph-fence': {currentMorphFence},
    './model': {releaseDock, validRect}, './visual': {alpha: () => '#000', dockStyles: {fill: {position: 'absolute', inset: 0}}},
  });
  const frame = {x: 0, y: 0, width: 390, height: 844}, child = React.createElement('PersistentNativeSurface');
  const props = {controller: {progress: {value: 0}, velocity: {value: 0}, dragging: {value: false}},
    docked: false, fullFrame: frame, dockFrame: frame, children: child, fence: undefined as PlaybackFence | undefined};
  const morph = mount(PlayerMorph, props);
  const childOf = () => elements(morph.tree).find(element => element.type === 'PersistentNativeSurface');
  try {
    assert.equal(morph.tree.props.style.at(-1).display, 'none');
    assert.equal(morph.tree.props.importantForAccessibility, 'no-hide-descendants');
    assert.strictEqual(childOf(), child);
    morph.update({...props, fence});
    assert.equal(morph.tree.props.style.at(-1).display, 'flex');
    assert.strictEqual(childOf(), child);
    morph.update(props);
    assert.equal(morph.tree.props.style.at(-1).display, 'none');
    assert.strictEqual(childOf(), child);
  } finally {morph.host.unmount();}
});

test('an interrupted dock exit cannot remove a replacement source or invalidate its later exit', async () => {
  const state = lifecycle(), {useDockPresence} = await dockModule(state);
  const first = occupant(), replacement = occupant(2);
  let wanted: DockOccupant | null = first, shown: DockOccupant | null;
  const host = createHookHost(() => {shown = useDockPresence(wanted, false).shown;});
  host.mount();
  try {
    wanted = null; host.rerender();
    const staleExit = state.timings.at(-1)!.complete!, staleCleanup = state.effects.at(-1)!.cleanup!;
    wanted = replacement; await act(() => host.rerender());
    await act(() => staleExit(true));
    assert.equal(shown!, replacement);
    wanted = null; host.rerender();
    const exit = state.timings.at(-1)!.complete!, cancellations = state.cancelled.length;
    staleCleanup();
    assert.equal(state.cancelled.length, cancellations, 'old cleanup must not cancel the current animation');
    await act(() => exit(true));
    assert.equal(shown!, null, 'the current primitive epoch must still be valid');
  } finally {host.unmount();}
});

test('dock exit completion is ignored after unmount and an unfinished exit retains its chrome', async () => {
  const state = lifecycle(), {useDockPresence} = await dockModule(state), first = occupant();
  let wanted: DockOccupant | null = first, shown: DockOccupant | null;
  const host = createHookHost(() => {shown = useDockPresence(wanted, false).shown;});
  host.mount();
  try {
    wanted = null; host.rerender();
    const exit = state.timings.at(-1)!.complete!;
    await act(() => exit(false)); assert.equal(shown!, first);
    host.unmount(); const writes = state.writes;
    exit(true); assert.equal(state.writes, writes);
    assert.ok(state.cancelled.length > 0);
  } finally {host.unmount();}
});

test('returning to the same dock source retargets its interrupted fade toward visible', async () => {
  const state = lifecycle(), {useDockPresence} = await dockModule(state), first = occupant();
  let wanted: DockOccupant | null = first, shown: DockOccupant | null;
  const host = createHookHost(() => {shown = useDockPresence(wanted, false).shown;});
  host.mount();
  try {
    wanted = null; host.rerender(); const exit = state.timings.at(-1)!.complete!;
    wanted = {...first}; await act(() => host.rerender());
    assert.equal(state.timings.at(-1)!.value, 1);
    await act(() => exit(true)); assert.equal(shown!, wanted);
  } finally {host.unmount();}
});

test('paused audio keeps the phone and TV restoration delays', async () => {
  for (const tv of [false, true]) {
    const state = lifecycle(), {useDockPresence} = await dockModule(state);
    let wanted: DockOccupant | null = null;
    const host = createHookHost(() => {useDockPresence(wanted, tv);});
    host.mount();
    try {
      wanted = occupant(2, false); await act(() => host.rerender());
      assert.equal(state.delays.at(-1), tv ? 300 : 200);
    } finally {host.unmount();}
  }
});

async function heroModule(state: ReturnType<typeof lifecycle>) {
  return screenModule(new URL('../src-next/kit/layout/Hero.tsx', import.meta.url), {
    react: state.react, 'react-native': state.native, 'react-native-reanimated': state.animated, '@portico/design': {heroSpec},
    '../theme': {useTheme: () => ({isTV: false, layoutMode: 'phone', platform: 'phone', colors: {text: '#edf5fa'}})}, '../useMotion': {useMotion: () => state.motion},
    './Lockup': {Lockup: 'Lockup'}, './model': {createRotationClock},
    '../controls/Focusable': {Focusable: 'Focusable'}, '../focus/registry': {focusTestID},
  });
}
const heroProps = () => ({candidates: [{id: 'a', title: 'A'}, {id: 'b', title: 'B'}], variant: 'phone-app',
  renderArtwork: () => null, renderActions: () => null, onIndexChange: (_index: number) => {}});

test('hero interruption preserves remaining dwell and rejects a previously queued timeout', async t => {
  const timer = timers(t), state = lifecycle(), {Hero} = await heroModule(state), changes: number[] = [];
  const props = {...heroProps(), onIndexChange: (index: number) => changes.push(index)};
  const hero = mount(Hero, props);
  try {
    assert.equal(timer.tasks.at(-1)!.ms, heroSpec.rotation.intervalMs);
    const old = timer.tasks.at(-1)!, oldCleanup = state.effects.at(-1)!.cleanup!;
    timer.at(3000); hero.update({...props, active: false});
    assert.equal(old.cancelled, true);
    old.run(); assert.deepEqual(changes, []);
    timer.at(20_000); hero.update(props);
    assert.equal(timer.tasks.at(-1)!.ms, heroSpec.rotation.intervalMs - 3000);
    const cancellations = state.cancelled.length;
    oldCleanup(); assert.equal(state.cancelled.length, cancellations);
    await act(() => timer.tasks.at(-1)!.run());
    assert.deepEqual(changes, [1]);
    assert.equal(timer.tasks.at(-1)!.ms, heroSpec.rotation.intervalMs);
  } finally {hero.host.unmount();}
});

test('a new hero source at the same index owns a fresh clock and unmount fences every timeout', async t => {
  const timer = timers(t), state = lifecycle(), {Hero} = await heroModule(state), changes: number[] = [];
  const props = {...heroProps(), onIndexChange: (index: number) => changes.push(index)};
  const hero = mount(Hero, props);
  try {
    const old = timer.tasks.at(-1)!, oldCleanup = state.effects.at(-1)!.cleanup!;
    timer.at(3000);
    const replacement = {...props, candidates: [{id: 'c', title: 'C'}, {id: 'd', title: 'D'}]};
    hero.update(replacement);
    assert.equal(old.cancelled, true);
    assert.equal(timer.tasks.at(-1)!.ms, heroSpec.rotation.intervalMs);
    timer.at(4000); oldCleanup(); old.run(); assert.deepEqual(changes, []);
    timer.at(5000); hero.update({...replacement, active: false});
    timer.at(20_000); hero.update(replacement);
    assert.equal(timer.tasks.at(-1)!.ms, heroSpec.rotation.intervalMs - 2000);
    hero.host.unmount(); const writes = state.writes;
    for (const task of timer.tasks) {assert.equal(task.cancelled, true); task.run();}
    assert.deepEqual(changes, []); assert.equal(state.writes, writes);
  } finally {hero.host.unmount();}
});

const authority: shellModel.ShellAuthority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: '1', viewerFence: 'viewer'};
function shellRuntime() {
  let snapshot: any = {authority, destination: {kind: 'home'}, libraries: [{id: 'movies', kind: 'movie'}], hasLiveTV: false, profile: {}, account: {}};
  const reads: ReturnType<typeof deferred<string | undefined>>[] = [], destinations: unknown[] = [];
  const runtime = {subscribe: () => () => {}, getSnapshot: () => snapshot,
    memory: {read: () => {const read = deferred<string | undefined>(); reads.push(read); return read.promise;}, remember: async () => {}},
    onDestination: (destination: unknown) => {destinations.push(destination); snapshot = {...snapshot, destination};},
    renderRoutes: () => null, renderSelection: () => null, renderDestination: () => null, reportError: (error: unknown) => {throw error;},
  } as unknown as NativeShellRuntime;
  return {runtime, reads, destinations, authority(next: shellModel.ShellAuthority) {snapshot = {...snapshot, authority: next};}};
}
async function shellSession(state: ReturnType<typeof lifecycle>, runtime: NativeShellRuntime) {
  const {NativeShell} = await screenModule(new URL('../src-next/shell/NativeShell.tsx', import.meta.url), {
    react: state.react, 'react-native': state.native, 'react-native-reanimated': state.animated,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
    '../kit/theme': {useTheme: () => ({isTV: false, colors: {ink: '#071018'}})}, '../kit/useMotion': {useMotion: () => state.motion}, './model': shellModel,
    '../kit/overlays': {OverlaysProvider: 'OverlaysProvider'}, '../kit/shell': {AccountMenu: 'AccountMenu'}, '../kit/browse': {},
    '../screens/home/HomeScreen': {HomeScreen: 'HomeScreen'}, './PhoneTabBar': {PhoneTabBar: 'PhoneTabBar'},
    './PhoneHomeHeader': {PhoneHomeHeader: 'PhoneHomeHeader'}, './TVRail': {}, './TVProfileMenu': {}, './NativePlaybackLayer': {}, './DesktopHeader': {},
  });
  const shell = mount(NativeShell, {runtime});
  try {
    const session = elements(shell.tree).find(element => element.type?.name === 'ShellSession')!;
    return mount(session.type, session.props);
  } finally {shell.host.unmount();}
}
const tab = (session: ReturnType<typeof mount>, id: string) => elements(session.tree).find(element => element.type === 'PhoneTabBar')!.props.onSelect(id);

test('shell library-opening epochs reject navigation interrupted by a later destination or unmount', async () => {
  const state = lifecycle(), port = shellRuntime(), session = await shellSession(state, port.runtime);
  try {
    tab(session, 'libraries'); assert.equal(port.reads.length, 2);
    tab(session, 'search');
    await act(() => port.reads[1]!.resolve('movies'));
    assert.deepEqual(port.destinations, [{kind: 'search'}]);
    session.update({runtime: port.runtime, snapshot: port.runtime.getSnapshot()});
    tab(session, 'libraries'); assert.equal(port.reads.length, 3);
    session.host.unmount(); const writes = state.writes;
    await act(() => {port.reads[0]!.resolve('movies'); port.reads[2]!.resolve('movies');});
    assert.deepEqual(port.destinations, [{kind: 'search'}]); assert.equal(state.writes, writes);
  } finally {session.host.unmount();}
});

test('shell lifetime replay keeps the newer opening alive while retiring its previous memory read', async () => {
  const state = lifecycle(), port = shellRuntime(), session = await shellSession(state, port.runtime);
  const lifetime = state.effects[0]!, memory = state.effects[1]!;
  let newLifetime: void | (() => void) = undefined, newMemory: void | (() => void) = undefined;
  try {
    lifetime.cleanup!(); memory.cleanup!();
    newLifetime = lifetime.setup(); newMemory = memory.setup();
    const writes = state.writes;
    await act(() => port.reads[0]!.resolve('removed'));
    assert.equal(state.writes, writes, 'a retired read cannot mark the new session memory-ready');
    tab(session, 'libraries');
    lifetime.cleanup!();
    await act(() => port.reads.at(-1)!.resolve('movies'));
    assert.deepEqual(port.destinations, [{kind: 'library', libraryId: 'movies'}]);
  } finally {if (typeof newMemory === 'function') newMemory(); if (typeof newLifetime === 'function') newLifetime(); session.host.unmount();}
});

test('shell authority replacement rejects a pending library read', async () => {
  const state = lifecycle(), port = shellRuntime(), session = await shellSession(state, port.runtime);
  try {
    tab(session, 'libraries'); port.authority({...authority, epoch: '2'});
    await act(() => {port.reads[0]!.resolve('movies'); port.reads[1]!.resolve('movies');});
    assert.deepEqual(port.destinations, []);
  } finally {session.host.unmount();}
});

test('replacing a shell runtime in the same authority retires its pending opening and memory read', async () => {
  const state = lifecycle(), first = shellRuntime(), second = shellRuntime(), session = await shellSession(state, first.runtime);
  try {
    tab(session, 'libraries');
    session.update({runtime: second.runtime, snapshot: second.runtime.getSnapshot()});
    const writes = state.writes;
    await act(() => {first.reads[0]!.resolve('removed'); first.reads[1]!.resolve('movies');});
    assert.deepEqual(first.destinations, []); assert.deepEqual(second.destinations, []);
    assert.equal(state.writes, writes);
    tab(session, 'libraries');
    await act(() => second.reads.at(-1)!.resolve('movies'));
    assert.deepEqual(second.destinations, [{kind: 'library', libraryId: 'movies'}]);
  } finally {session.host.unmount();}
});

test('Home scroll registration follows the move function and runtime rather than the transient anchor object', async () => {
  const state = lifecycle(), moves: string[] = [], events: string[] = [];
  const a = (offset: number) => moves.push(`a:${offset}`), b = (offset: number) => moves.push(`b:${offset}`);
  let anchor = {move: a};
  function port(id: string) {
    let callback: (() => void) | undefined;
    const runtime = {getSnapshot: () => ({authority, libraries: []}),
      home: {subscribe: () => () => {}, getSnapshot: () => ({phase: 'ready'}), load: async () => {}},
      registerScrollToTop: (_destination: unknown, run: () => void) => {
        events.push(`register:${id}`); callback = run;
        return () => {events.push(`remove:${id}`); if (callback === run) callback = undefined;};
      },
    };
    return {runtime, top() {callback?.();}, get registered() {return !!callback;}};
  }
  const {HomeScreen} = await screenModule(new URL('../src-next/screens/home/HomeScreen.tsx', import.meta.url), {
    react: state.react, 'react-native': state.native, 'react-native-reanimated': state.animated,
    '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}},
    '../../../../../packages/client-core/src/presentation/home-spotlight': {}, '../../../../../packages/client-core/src/home-selection': {},
    '../../../../../packages/client-core/src/presentation/server-text': {}, '../../../../../packages/client-core/src/presentation/kit-model': {},
    '../../platform/ArtworkPipeline': {}, '../../kit/artwork': {}, '../../kit/controls': {}, '../../kit/cards': {}, '../../kit/layout': {}, '../../kit/layout/types': {},
    '../../kit/layout/FocusAnchor': {useFocusAnchor: () => anchor}, '../../kit/states': {HomeSkeleton: 'HomeSkeleton'},
    '../../kit/theme': {useTheme: () => ({isTV: false, layoutMode: 'phone', platform: 'phone', spec: {hero: {homeHeight: {phone: 560}}}})},
    '../../shell/model': shellModel, './HomeHeroFacts': {HomeHeroFacts: 'HomeHeroFacts', HomeRemoteHint: 'HomeRemoteHint'},
    './model': {authorizedHome: () => undefined, initialHomeFocus: () => undefined},
  });
  const first = port('first'), second = port('second'), home = mount(HomeScreen, {runtime: first.runtime, authority});
  try {
    first.top(); anchor = {move: a}; home.update({runtime: first.runtime, authority});
    assert.deepEqual(events, ['register:first']);
    anchor = {move: b}; home.update({runtime: first.runtime, authority}); first.top();
    home.update({runtime: second.runtime, authority}); first.top(); second.top();
    assert.deepEqual(events, ['register:first', 'remove:first', 'register:first', 'remove:first', 'register:second']);
    assert.deepEqual(moves, ['a:0', 'b:0', 'b:0']); assert.equal(first.registered, false);
    home.host.unmount(); assert.equal(second.registered, false);
  } finally {home.host.unmount();}
});
