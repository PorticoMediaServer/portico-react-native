import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import React, {type ReactElement, type ReactNode} from 'react';
import {transformSync} from 'rolldown/utils';
import {createTheme, fontFamilies, nativeType} from '../src-next/kit/theme.ts';
import {createHookHost} from './hook-driver.ts';
import {dispatchMenuKey} from '../src-next/platform/menu-key.ts';

// Native hosts, scheduler admission and animation clocks are controlled here.
// The actual family components, callback closures and lifecycle run unchanged;
// device layout, decoding, gestures and D-pad focus require Android evidence.
const state = {
  theme: createTheme({isTV: false, width: 390}), fontFamilies, nativeType,
  slot: {active: true, recovering: false, gaveUp: false, cached: false, attempt: 0, loaded() {}, failed() {}},
  timings: [] as {toValue: number; duration: number}[],
};
Object.assign(globalThis, {__porticoFamilyRenderTest: state});
const data = (value: string) => `data:text/javascript,${encodeURIComponent(value)}`;
const rnStub = new URL('./react-native-stub.mjs', import.meta.url).href;
const native = data(`export * from ${JSON.stringify(rnStub)};
  export const View='View',Text='Text',Image='Image',TextInput='TextInput',Pressable='Pressable',Modal='Modal',ScrollView='ScrollView',FlatList='FlatList',VirtualizedList='VirtualizedList',TVFocusGuideView='TVFocusGuideView',ActivityIndicator='ActivityIndicator';
  export const Platform={OS:'android',isTV:false},PixelRatio={get:()=>1},Alert={alert(){}},BackHandler={addEventListener:()=>({remove(){}})};
  export const useWindowDimensions=()=>({width:globalThis.__porticoFamilyRenderTest.theme.width,height:globalThis.__porticoFamilyRenderTest.theme.isTV?1080:844,scale:1,fontScale:1});
  const flatten=s=>Array.isArray(s)?Object.assign({},...s.map(flatten)):s??{};
  export const StyleSheet={create:s=>s,flatten,absoluteFill:{position:'absolute',inset:0},absoluteFillObject:{position:'absolute',inset:0}};
  class Value {constructor(value){this.value=value} setValue(value){this.value=value} stopAnimation(){}}
  export const Animated={View:'AnimatedView',Value,timing:(_,config)=>{globalThis.__porticoFamilyRenderTest.timings.push(config);return {start(){}}}};`);
const animated = data(`import {useRef} from ${JSON.stringify(import.meta.resolve('react'))};
  export const useSharedValue=value=>useRef({value}).current,useAnimatedStyle=fn=>fn(),cancelAnimation=()=>{},withTiming=value=>value,withSpring=value=>value,withDelay=(_,value)=>value,runOnJS=fn=>fn,runOnUI=fn=>fn,useAnimatedRef=()=>useRef(null),useAnimatedScrollHandler=()=>{},useAnimatedReaction=()=>{},scrollTo=()=>{};
  export const Easing={bezier:()=>v=>v,linear:v=>v},ReduceMotion={Never:'never'};
  export default {View:'AnimatedView',ScrollView:'AnimatedScrollView',createAnimatedComponent:c=>c};`);
const theme = data(`const s=globalThis.__porticoFamilyRenderTest;export const useTheme=()=>s.theme,fontFamilies=s.fontFamilies,nativeType=s.nativeType,ThemeProvider='ThemeProvider';`);
const pipeline = data(`export const useArtworkPlacement=()=>({row:0,column:0}),useArtworkSlot=()=>globalThis.__porticoFamilyRenderTest.slot,sizedUri=uri=>uri;`);
const gesture = data(`const pan=()=>new Proxy({}, {get:()=>()=>pan()});export const Gesture={Pan:pan,Native:pan,Race:pan,Simultaneous:pan};export const GestureDetector='GestureDetector';`);
const svg = data(`export default 'Svg';export const Defs='Defs',LinearGradient='LinearGradient',RadialGradient='RadialGradient',Rect='Rect',Stop='Stop',Path='Path',Circle='Circle',Ellipse='Ellipse',Line='Line',Polyline='Polyline',Polygon='Polygon',G='G',ClipPath='ClipPath',Mask='Mask',Use='Use',Text='SvgText';`);
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'react-native') return {url: native, shortCircuit: true};
  if (specifier === 'react-native-reanimated') return {url: animated, shortCircuit: true};
  if (specifier === 'react-native-gesture-handler') return {url: gesture, shortCircuit: true};
  if (specifier === 'react-native-svg') return {url: svg, shortCircuit: true};
  if (specifier === '@react-native-community/blur') return {url: data(`export const BlurView='BlurView';`), shortCircuit: true};
  if (specifier === 'react-native-safe-area-context') return {url: data(`export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`), shortCircuit: true};
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const pathname = new URL(specifier, context.parentURL).pathname;
    if (/\/kit\/theme(?:\.ts)?$/.test(pathname)) return {url: theme, shortCircuit: true};
    if (/\/platform\/ArtworkPipeline(?:\.ts)?$/.test(pathname)) return {url: pipeline, shortCircuit: true};
  }
  try {return next(specifier, context);} catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes((error as NodeJS.ErrnoException).code ?? '') || !specifier.startsWith('.')) throw error;
    for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      try {return next(specifier + suffix, context);} catch (retry) {if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes((retry as NodeJS.ErrnoException).code ?? '')) throw retry;}
    }
    throw error;
  }
}, load(url, context, next) {
  if (!url.endsWith('.tsx')) return next(url, context);
  const file = fileURLToPath(url), result = transformSync(file, readFileSync(file, 'utf8'), {lang: 'tsx', jsx: {runtime: 'automatic'}, target: 'es2022'});
  if (result.errors.length) throw new AggregateError(result.errors);
  return {format: 'module', source: result.code, shortCircuit: true};
}});
const {CardFrame} = await import('../src-next/kit/cards/primitives.tsx');
const {Parts} = await import('../src-next/kit/cards/primitives.tsx');
const {WideCard} = await import('../src-next/kit/cards/MediaCards.tsx');
const {SelectionHoldFeedback} = await import('../src-next/kit/selection/SelectionHoldFeedback.tsx');
const {Artwork} = await import('../src-next/kit/artwork/Artwork.tsx');
const {AmbientArt} = await import('../src-next/kit/artwork/Surfaces.tsx');
const {default: browseGalleries} = await import('../src-next/dev/families/browse/browse.gallery.tsx');
const {FilterBuilder, FacetChips} = await import('../src-next/kit/browse/index.ts');
const {TextField, Button} = await import('../src-next/kit/controls/index.ts');
const {OwnerTag} = await import('../src-next/kit/shell/index.ts');
const {Dialog} = await import('../src-next/kit/overlays/index.ts');
type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<Record<string, any>>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function mount(component: any, initial: any) {
  let props = initial, tree: ReactNode;
  const host = createHookHost(() => {tree = typeof component === 'function' ? component(props) : component.render(props, props.ref ?? null);});
  host.mount();
  return {host, get tree() {return tree;}, update(next: any) {props = next; host.rerender();}};
}
const find = (tree: ReactNode, type: unknown) => nodes(tree).find(node => node.type === type)!;

test('a real phone hold measures its point, selects once and cancels all pending animation frames', t => {
  state.theme = createTheme({isTV: false, width: 390});
  const frames = new Map<number, FrameRequestCallback>(), cancelled: number[] = [];
  let sequence = 0, now = 100;
  t.mock.method(performance, 'now', () => now);
  const originalRequest = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const originalCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {frames.set(++sequence, callback); return sequence;},
    cancelAnimationFrame: (id: number) => {cancelled.push(id); frames.delete(id);},
  });
  t.after(() => {
    if (originalRequest) Object.defineProperty(globalThis, 'requestAnimationFrame', originalRequest); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    if (originalCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancel); else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  });
  const actions: string[] = [], touches: unknown[] = [];
  const card = mount(CardFrame, {title: 'Actual title', onNavigate: () => actions.push('navigate'), onMore: () => actions.push('more'),
    selection: {active: false, selected: false, onEnter: () => actions.push('enter'), onToggle: () => actions.push('toggle')},
    onTouchMove: (event: unknown) => touches.push(event), children: () => null});
  try {
    let press = find(card.tree, 'Pressable');
    assert.equal(press.props.delayLongPress, 500);
    press.props.onPressIn({nativeEvent: {locationX: 22, locationY: 40}}); card.host.flush();
    assert.equal(find(card.tree, SelectionHoldFeedback).props.progress, 0);
    now = 350; frames.get(sequence)!(now); card.host.flush();
    assert.equal(find(card.tree, SelectionHoldFeedback).props.progress, .5);
    const moved = {nativeEvent: {locationX: 30, locationY: 50}};
    find(card.tree, 'Pressable').props.onTouchMove(moved); card.host.flush();
    assert.equal(find(card.tree, SelectionHoldFeedback).props.style.left, -12.5); assert.equal(touches[0], moved);
    press = find(card.tree, 'Pressable'); press.props.onLongPress(); card.host.flush(); press.props.onPress();
    assert.deepEqual(actions, ['enter']); assert.equal(find(card.tree, SelectionHoldFeedback), undefined);
    assert.ok(cancelled.length > 0);
    find(card.tree, 'Pressable').props.onPressIn({nativeEvent: {locationX: 1, locationY: 2}}); card.host.flush();
    const pending = sequence; card.host.unmount(); assert.ok(cancelled.includes(pending));
  } finally {card.host.unmount();}
});

test('TV cards retain a sole native target and only the current enabled focused card owns Menu', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const actions: string[] = [];
  const props = {title: 'Actual title', onNavigate: () => actions.push('navigate'), onMore: () => actions.push('more'), children: () => null};
  const a = mount(CardFrame, props), b = mount(CardFrame, {...props, onMore: () => actions.push('second')});
  const menu = () => dispatchMenuKey({eventType: 'menu', eventKeyAction: 1}, 'android', true);
  try {
    assert.equal(nodes(a.tree).filter(node => node.type === 'Pressable').length, 1);
    find(a.tree, 'Pressable').props.onFocus(); a.host.flush(); assert.equal(menu(), true);
    find(b.tree, 'Pressable').props.onFocus(); b.host.flush();
    find(a.tree, 'Pressable').props.onBlur(); a.host.flush(); assert.equal(menu(), true);
    assert.deepEqual(actions, ['more', 'second']);
    b.update({...props, disabled: true}); assert.equal(menu(), false);
    assert.equal(find(b.tree, SelectionHoldFeedback), undefined);
  } finally {a.host.unmount(); b.host.unmount();}
});

test('scheduled native Image callbacks reject an old retry and an unmounted source; visibility mounts no probe', () => {
  state.theme = createTheme({isTV: false, width: 390});
  const calls: string[] = [];
  state.slot = {active: true, recovering: false, gaveUp: false, cached: false, attempt: 0, loaded: () => calls.push('loaded'), failed: () => calls.push('failed')};
  const source = {uri: 'https://current.example/art', cacheKey: 'current-authority'};
  const props = {source, width: 120, height: 180, onReady: () => calls.push('ready'), onError: () => calls.push('error')};
  const frame = mount(Artwork, {...props, visible: false});
  try {
    assert.equal(nodes(frame.tree).filter(node => typeof node.type === 'function').length, 0);
    frame.update({...props, visible: true});
    const scheduled = nodes(frame.tree).find(node => typeof node.type === 'function')!;
    const image = mount(scheduled.type, scheduled.props);
    const original = find(image.tree, 'Image');
    try {
      assert.deepEqual(calls, []);
      state.slot = {...state.slot, attempt: 1}; image.host.rerender();
      original.props.onLoad({nativeEvent: {source: {width: 240, height: 360}}}); assert.deepEqual(calls, []);
      const actual = find(image.tree, 'Image');
      actual.props.onLoad({nativeEvent: {source: {width: 240, height: 360}}}); image.host.flush();
      assert.deepEqual(calls, ['loaded', 'ready']);
      image.host.unmount(); actual.props.onError(); assert.deepEqual(calls, ['loaded', 'ready']);
    } finally {image.host.unmount();}
  } finally {frame.host.unmount();}
});

test('ambient staging forwards visibility independently and only the actual sharp foreground reveals a hero', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const foreground = {uri: 'https://current.example/sharp', cacheKey: 'sharp'}, ambient = {uri: 'https://current.example/tiny', url: '/tiny', cacheKey: 'tiny', variant: 'ambient-v1' as const, version: 'v1', maxEdge: 64 as const};
  const ready: unknown[] = [];
  const surface = mount(AmbientArt, {foreground, source: ambient, visible: false, onReady: (value: unknown) => ready.push(value)});
  try {
    const art = nodes(surface.tree).filter(node => node.type === Artwork);
    assert.equal(art.length, 2); assert.ok(art.every(node => node.props.visible === false));
    assert.equal(art[0]!.props.sized, true); assert.equal(art[0]!.props.blurRadius, undefined);
    art[0]!.props.onReady(ambient); assert.deepEqual(ready, []);
    art[1]!.props.onReady(foreground); assert.deepEqual(ready, [foreground]);
  } finally {surface.host.unmount();}
});

test('registered browse filters use real controlled search/facet actions and preserve excluded values', () => {
  state.theme = createTheme({isTV: false, width: 390});
  assert.equal(new Set(browseGalleries.map(gallery => gallery.id)).size, browseGalleries.length);
  for (const id of ['browse-filters', 'browse-match-modes', 'browse-menu-owner']) assert.ok(browseGalleries.some(gallery => gallery.id === id));
  const owner = (browseGalleries.find(gallery => gallery.id === 'browse-menu-owner')!.render as React.FunctionComponent)({}) as Element;
  assert.equal((owner.props.ownerTag as Element).type, OwnerTag);
  const entry = (browseGalleries.find(gallery => gallery.id === 'browse-filters')!.render as React.FunctionComponent)({}) as Element;
  const filterCase = mount(entry.type, entry.props), toolbarNode = filterCase.tree as Element;
  const toolbar = mount(toolbarNode.type, toolbarNode.props);
  const surfaceNode = nodes(toolbar.tree).find(node => typeof node.type === 'function' && node.props.fields && node.props.renderAllValues)!;
  const surface = mount(surfaceNode.type, surfaceNode.props);
  try {
    const builder = find(surface.tree, FilterBuilder);
    builder.props.onShowAll('genre'); surface.host.flush();
    const pickerNode = nodes(surface.tree).find(node => node.props.label === 'Genre' && node.props.state?.kind === 'values')!;
    const picker = mount(pickerNode.type, pickerNode.props);
    try {
      assert.equal((picker.tree as Element).type, Dialog);
      const all = find(picker.tree, FacetChips).props.values.length;
      find(picker.tree, TextField).props.onChangeText('Family'); picker.host.flush();
      assert.equal(find(picker.tree, FacetChips).props.values.length, 1); assert.ok(all > 1);
      find(picker.tree, FacetChips).props.onValueChange('Family', 'exclude'); toolbar.host.flush();
      const updated = nodes(toolbar.tree).find(node => node.type === surfaceNode.type)!;
      assert.ok(updated.props.fields.genre.excluded.includes('Family'));
      assert.ok(!updated.props.fields.genre.included.includes('Family'));
      assert.ok(updated.props.fields.genre.excluded.includes('Horror'), 'unrelated excluded facts survive');
      assert.deepEqual(updated.props.fields.year.included, ['1980'], 'unrelated fields survive');
      find((picker.tree as Element).props.footer, Button).props.onPress(); surface.host.flush();
      assert.equal(nodes(surface.tree).find(node => node.type === pickerNode.type), undefined);
    } finally {picker.host.unmount();}
  } finally {surface.host.unmount(); toolbar.host.unmount(); filterCase.host.unmount();}
});

test('phone continuation facts stay on one quiet line while TV retains its full episode identity', () => {
  const caption = [{id: 'episode-label', text: 'S1 E1', role: 'context' as const}, {id: 'episode-title', text: 'Actual episode title', role: 'identity' as const}];
  const detail = [{id: 'remaining', text: '1 h 4 min left', role: 'supplement' as const}];
  const props = {title: 'Actual show', onNavigate() {}, caption, detail};
  for (const isTV of [false, true]) {
    state.theme = createTheme({isTV, width: isTV ? 1920 : 390});
    const card = mount(WideCard, props);
    try {
      const content = (card.tree as Element).props.children({focused: false, hovered: false, pressed: false, holding: false});
      const parts = nodes(content).filter(node => node.type === Parts);
      assert.equal(parts.length, 1);
      assert.deepEqual(parts[0]!.props.parts, isTV ? caption : [caption[0], detail[0]]);
      if (!isTV) {
        card.update({...props, caption: [{id: 'year', text: '2015', role: 'context'}]});
        const film = (card.tree as Element).props.children({focused: false, hovered: false, pressed: false, holding: false});
        assert.deepEqual(find(film, Parts).props.parts, detail, 'phone film continuation shows remaining time without a second year line');
      }
    } finally {card.host.unmount();}
  }
});
