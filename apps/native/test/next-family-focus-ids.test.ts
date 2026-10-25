import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import React, {type ReactElement, type ReactNode} from 'react';
import {transformSync} from 'rolldown/utils';
import {createHookHost} from './hook-driver.ts';
import {createTheme, fontFamilies, nativeType} from '../src-next/kit/theme.ts';
import type {DockOccupant} from '../src-next/kit/dock/types.ts';
import type {QueuePlaybackFence, QueueScope} from '../../../packages/player-core/src/index.ts';
import {playbackIdentity} from '../../../packages/client-core/src/presentation/kit-model/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';

// Exercise the actual family, controls and overlay composition. Only native
// hosts, animation/gesture drivers and the theme context are replaced. This
// element/hook harness cannot establish native layout or physical D-pad focus.
const state = {theme: createTheme({isTV: true, width: 1920}), fontFamilies, nativeType};
const stateKey = '__porticoFamilyFocusIDsTest';
Object.assign(globalThis, {[stateKey]: state});
const moduleURL = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const nativeStub = new URL('./react-native-stub.mjs', import.meta.url).href;
const native = moduleURL(`export * from ${JSON.stringify(nativeStub)};
  export const Platform={OS:'android',isTV:true};
  export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable',Modal='Modal',ScrollView='ScrollView',FlatList='FlatList',TVFocusGuideView='TVFocusGuideView',ActivityIndicator='ActivityIndicator';
  export const Image='Image',PixelRatio={get:()=>1},Animated={View:'AnimatedView'};
  export const BackHandler={addEventListener:()=>({remove(){}})};
  export const useWindowDimensions=()=>({width:1920,height:1080,scale:1,fontScale:1});
  const flatten=s=>Array.isArray(s)?Object.assign({},...s.map(flatten)):s??{};
  export const StyleSheet={create:s=>s,flatten,absoluteFill:{position:'absolute',inset:0}};`);
const theme = moduleURL(`const s=globalThis.${stateKey}; export const activeTextScale=()=>s.theme.textScale; export const useTheme=()=>s.theme; export const fontFamilies=s.fontFamilies; export const nativeType=s.nativeType;`);
const reanimated = moduleURL(`import {useRef} from ${JSON.stringify(import.meta.resolve('react'))};
  export const useSharedValue=value=>useRef({value}).current;
  export const useAnimatedStyle=fn=>fn(); export const cancelAnimation=()=>{};
  export const withTiming=value=>value,withSpring=value=>value,runOnJS=fn=>fn;
  export const Easing={bezier:()=>v=>v,linear:v=>v},ReduceMotion={Never:'never'};
  export default {View:'AnimatedView',createAnimatedComponent:c=>c};`);
const gesture = moduleURL(`const pan=()=>new Proxy({}, {get:()=>()=>pan()}); export const Gesture={Pan:pan}; export const GestureDetector='GestureDetector';`);
const svg = moduleURL(`export default 'Svg'; export const Defs='Defs',LinearGradient='LinearGradient',RadialGradient='RadialGradient',Rect='Rect',Stop='Stop',Path='Path',Circle='Circle',Ellipse='Ellipse',Line='Line',Polyline='Polyline',Polygon='Polygon',G='G',ClipPath='ClipPath',Mask='Mask',Use='Use',Text='SvgText';`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@react-native-masked-view/masked-view') return {url: moduleURL(`export default 'MaskedView';`), shortCircuit: true};
    if (specifier === 'react-native') return {url: native, shortCircuit: true};
    if (specifier === 'react-native-reanimated') return {url: reanimated, shortCircuit: true};
    if (specifier === 'react-native-gesture-handler') return {url: gesture, shortCircuit: true};
    if (specifier === 'react-native-svg') return {url: svg, shortCircuit: true};
    if (specifier === '@react-native-community/blur') return {url: moduleURL(`export const BlurView='BlurView';`), shortCircuit: true};
    if (specifier === 'react-native-safe-area-context') return {url: moduleURL(`export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`), shortCircuit: true};
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && /\/kit\/theme(?:\.ts)?$/.test(new URL(specifier, context.parentURL).pathname)) return {url: theme, shortCircuit: true};
    try {return next(specifier, context);} catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error;
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try {return next(specifier + suffix, context);} catch (retry) {if ((retry as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw retry;}
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context);
    const filename = fileURLToPath(url);
    const result = transformSync(filename, readFileSync(filename, 'utf8'), {lang: 'tsx', jsx: {runtime: 'automatic'}, target: 'es2022'});
    if (result.errors.length) throw new AggregateError(result.errors, `Cannot transform ${filename}`);
    return {format: 'module', source: result.code, shortCircuit: true};
  },
});

const {focusTestID} = await import('../src-next/kit/focus/registry.ts');
const {FocusRegion} = await import('../src-next/kit/focus/FocusRegion.tsx');
const {Button} = await import('../src-next/kit/controls/Button.tsx');
const {Focusable} = await import('../src-next/kit/controls/Focusable.tsx');
const {Select} = await import('../src-next/kit/controls/Select.tsx');
const {Menu} = await import('../src-next/kit/overlays/Menu.tsx');
const {StateView} = await import('../src-next/kit/states/StateView.tsx');
const {StateActionButton} = await import('../src-next/kit/states/StateActionButton.tsx');
const {ProfilePicker} = await import('../src-next/kit/artwork/Profiles.tsx');
const {SettingsRow, ChoiceMatrix, LanguageList} = await import('../src-next/kit/shell/SettingsControls.tsx');
const {PersonRow, DeviceRow} = await import('../src-next/kit/shell/Diagnostics.tsx');
const {NowPlayingCard} = await import('../src-next/kit/dock/NowPlayingCard.tsx');
const {AlphabetRail} = await import('../src-next/kit/layout/AlphabetRail.tsx');
const id = (prefix: string, ...parts: readonly string[]) => focusTestID(prefix, JSON.stringify(parts));
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const ofType = (node: ReactNode, type: unknown) => elements(node).filter(element => element.type === type);
function mount(component: any, props: any) {
  let tree: ReactNode;
  const host = createHookHost(() => {tree = typeof component === 'function' ? component(props) : component.render(props, props.ref ?? null);});
  host.mount();
  return {get tree() {return tree;}, update(next: any) {props = next; host.rerender();}, host};
}
function nativeControlID(element: Element): string | undefined {
  const mounted: ReturnType<typeof mount>[] = [];
  try {
    let current = element;
    while (typeof current.type !== 'string') {
      const instance = mount(current.type, current.props); mounted.push(instance);
      current = instance.tree as Element;
    }
    assert.equal(current.type, 'Pressable');
    return current.props.testID;
  } finally {for (const instance of mounted.reverse()) instance.host.unmount();}
}


test('state actions derive semantic host IDs and preserve explicit native IDs, callbacks and refs', () => {
  let pressed = 0;
  const ref = {current: null};
  const view = mount(StateView, {testID: 'tv.authority.error', title: 'Error', primaryAction: {id: 'retry', label: 'Retry', onPress: () => {pressed++;}}, secondaryAction: {id: 'back', label: 'Back', testID: 'tv.authority.explicit-back', ref, onPress() {}}});
  try {
    const actions = ofType(view.tree, StateActionButton);
    const primary = mount(StateActionButton, actions[0]!.props), secondary = mount(StateActionButton, actions[1]!.props);
    try {
      assert.equal(nativeControlID(primary.tree as Element), id('tv.authority.error', 'action', 'retry'));
      assert.equal(nativeControlID(secondary.tree as Element), 'tv.authority.explicit-back');
      assert.equal((secondary.tree as Element).props.ref, ref);
      assert.equal((primary.tree as Element).props.id, undefined);
      (primary.tree as Element).props.onPress(); assert.equal(pressed, 1);
    } finally {primary.host.unmount(); secondary.host.unmount();}
  } finally {view.host.unmount();}
});

test('profile hosts keep entity identity through reorder and honor explicit caller overrides', () => {
  const selected: string[] = [];
  const profiles = [{id: 'one', name: 'Same', initial: 'A'}, {id: 'two', name: 'Same', initial: 'B', unavailableReason: 'restricted'}];
  const props = {testID: 'dev.artwork.profiles', profiles, onSelect: (key: string) => selected.push(key), onAdd() {}, onManage() {}, profileProps: (profile: {id: string}) => profile.id === 'two' ? {testID: 'dev.artwork.explicit-two'} : {}};
  const picker = mount(ProfilePicker, props);
  try {
    const rows = ofType(picker.tree, Focusable);
    const first = rows.map(nativeControlID);
    assert.deepEqual(first, [id(props.testID, 'profile', 'one'), 'dev.artwork.explicit-two', id(props.testID, 'add')]);
    rows[0]!.props.onPress(); assert.deepEqual(selected, ['one']);
    assert.equal(rows[1]!.props.disabled, true);
    assert.equal(nativeControlID(ofType(picker.tree, Button)[0]!), id(props.testID, 'manage'));
    picker.update({...props, profiles: [...profiles].reverse().map(profile => ({...profile, name: 'Translated'}))});
    assert.deepEqual(ofType(picker.tree, Focusable).slice(0, 2).map(nativeControlID), first.slice(0, 2).reverse());
  } finally {picker.host.unmount();}
});

test('settings slots retain a sole native target, entity rows and language menus use caller fences', () => {
  const slot = React.createElement(Select, {testID: 'tv.settings.autoplay', options: [], value: ''});
  const row = mount(SettingsRow, {testID: 'tv.settings.row', label: 'Autoplay', readable: true, control: slot});
  try {assert.equal(ofType(row.tree, Focusable).length, 0); assert.equal(ofType(row.tree, Select)[0], slot);} finally {row.host.unmount();}
  const matrix = mount(ChoiceMatrix, {testID: 'tv.settings.skip', rows: [{id: 'intro', label: 'Intro', value: 'ask'}], options: [{value: 'ask', label: 'Ask'}], onChange() {}});
  try {assert.equal(ofType(matrix.tree, SettingsRow)[0]!.props.control.props.testID, id('tv.settings.skip', 'row', 'intro'));} finally {matrix.host.unmount();}
  for (const [component, props] of [[PersonRow, {id: 'person-one', name: 'Same', role: 'member', face: {initial: 'A'}, facts: []}], [DeviceRow, {id: 'device-one', name: 'Same', icon: 'i-tv', facts: []}]] as const) {
    const entity = mount(component, {...props, testID: 'tv.settings.entities'});
    try {assert.equal(nativeControlID(ofType(entity.tree, Focusable)[0]!), id('tv.settings.entities', 'entity', props.id));} finally {entity.host.unmount();}
  }
  const languages = mount(LanguageList, {testID: 'tv.settings.languages', label: 'Languages', value: [{id: 'en', label: 'English'}], available: [{id: 'fr', label: 'French'}], limit: 4, onChange() {}});
  try {
    const rows = ofType(languages.tree, Focusable), host = {requestTVFocus() {}};
    rows[0]!.props.ref(host); rows[0]!.props.onPress(); languages.host.flush();
    const menu = ofType(languages.tree, Menu)[0]!;
    assert.equal(menu.props.testID, id('tv.settings.languages', 'language-menu', 'en'));
    assert.equal(menu.props.returnFocusRef.current, host);
    assert.equal(nativeControlID(rows[0]!), id('tv.settings.languages', 'language', 'en'));
    assert.equal(ofType(languages.tree, Menu)[1]!.props.testID, id('tv.settings.languages', 'add-menu'));
  } finally {languages.host.unmount();}
});

const scope: QueueScope = {serverId: 'server', authority: 'local', accountId: 'account', profileId: 'profile', controllerId: 'controller', controllerEpoch: 'epoch', commandLaneId: 'lane'};
const fence: QueuePlaybackFence = {kind: 'queue', playback: {scope, run: 1}, sessionId: 'session', sourceId: 'source', itemId: 'song', entryId: 'entry', generation: 1};
const occupant: DockOccupant = {mode: 'music', playback: {fence, kind: 'music', queue: null, positionSeconds: 75, playing: true, expanded: false}, presentation: {fence, identity: playbackIdentity({kind: 'music', item: {id: 'song', kind: 'song', title: 'Song', artist: 'Artist'}}, 'dock', {t: defaultI18n.t}), durationSeconds: 100, skipBackSeconds: 10, capabilities: {play: true, pause: true, seek: true, stop: true, previous: false, next: true, cast: false}}};

test('TV dock holds the shared region, keeps transport identity on pause/play and resolves the remounted opener', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  let restore: (() => void) | undefined;
  globalThis.requestAnimationFrame = callback => {restore = () => callback(0); return 1;};
  globalThis.cancelAnimationFrame = () => {restore = undefined;};
  const calls: unknown[] = [], prefix = 'tv.authority.playback.session';
  const props = {occupant, testID: prefix, expanded: false, onExpandedChange: (expanded: boolean) => calls.push(expanded), onAction: (command: unknown) => calls.push(command)};
  const dock = mount(NowPlayingCard, props);
  try {
    assert.equal(nativeControlID(ofType(dock.tree, Focusable)[0]!), id(prefix, 'open'));
    dock.update({...props, expanded: true});
    const region = ofType(dock.tree, FocusRegion)[0]!;
    assert.equal(region.props.hold, true); assert.equal(region.props.id, prefix); assert.equal(region.props.entry, id(prefix, 'transport'));
    const transport = ofType(dock.tree, Focusable).find(element => element.props.testID === id(prefix, 'transport'))!;
    const hostID = nativeControlID(transport); transport.props.onPress(); assert.equal((calls.at(-1) as {type: string}).type, 'pause');
    dock.update({...props, expanded: true, occupant: {...occupant, playback: {...occupant.playback, playing: false}}});
    const play = ofType(dock.tree, Focusable).find(element => element.props.testID === hostID)!;
    assert.equal(nativeControlID(play), hostID); play.props.onPress(); assert.equal((calls.at(-1) as {type: string}).type, 'play');
    dock.update({...props, expanded: false});
    const quiet = ofType(dock.tree, Focusable)[0]!;
    const focus = mount(Focusable, quiet.props), adapter = mount((focus.tree as Element).type, (focus.tree as Element).props);
    try {(adapter.tree as Element).props.ref({requestTVFocus() {calls.push('remounted-opener'); (adapter.tree as Element).props.onFocus({});}}); restore?.(); assert.equal(calls.at(-1), 'remounted-opener', 'restoration does not immediately re-expand the quiet dock');
      quiet.props.onPress(); assert.equal(calls.at(-1), true, 'explicit OK still expands the restored opener');} finally {adapter.host.unmount(); focus.host.unmount();}
  } finally {dock.host.unmount(); globalThis.requestAnimationFrame = originalRAF; globalThis.cancelAnimationFrame = originalCancel;}
});

test('alphabet host IDs use bucket keys, keep empty buckets disabled and deliver actual jump coordinates', () => {
  const calls: unknown[] = [];
  const rail = mount(AlphabetRail, {testID: 'tv.library.alphabet', positionIndex: {A: 3, B: 10}, total: 20, firstVisible: 3, lastVisible: 6, onJump: (...args: unknown[]) => calls.push(args)});
  try {
    const rows = ofType(rail.tree, Focusable);
    const a = rows.find(row => row.props.testID === id('tv.library.alphabet', 'bucket', 'A'))!;
    assert.equal(nativeControlID(a), id('tv.library.alphabet', 'bucket', 'A')); a.props.onPress(); assert.deepEqual(calls, [[3, 'A']]);
    assert.equal(rows.find(row => row.props.testID === id('tv.library.alphabet', 'bucket', 'C'))!.props.disabled, true);
  } finally {rail.host.unmount();}
});
