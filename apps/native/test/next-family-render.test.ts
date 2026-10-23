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
  workletTargets: [] as number[],
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
  export const useSharedValue=value=>useRef({value}).current,useAnimatedStyle=fn=>fn(),cancelAnimation=()=>{},withTiming=value=>{globalThis.__porticoFamilyRenderTest.workletTargets.push(value);return value;},withSpring=value=>value,withDelay=(_,value)=>value,runOnJS=fn=>fn,runOnUI=fn=>fn,useAnimatedRef=()=>useRef(null),useAnimatedScrollHandler=()=>{},useAnimatedReaction=()=>{},scrollTo=()=>{};
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
  if (specifier === '@react-native-masked-view/masked-view') return {url: data(`export default 'MaskedView';`), shortCircuit: true};
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
const {CardFrame, ArtFrame} = await import('../src-next/kit/cards/primitives.tsx');
const {Row} = await import('../src-next/kit/layout/Row.tsx');
const {Parts} = await import('../src-next/kit/cards/primitives.tsx');
const {WideCard} = await import('../src-next/kit/cards/MediaCards.tsx');
const {SelectionHoldFeedback} = await import('../src-next/kit/selection/SelectionHoldFeedback.tsx');
const {Artwork} = await import('../src-next/kit/artwork/Artwork.tsx');
const {AmbientArt} = await import('../src-next/kit/artwork/Surfaces.tsx');
const {ArtworkAlphaMask} = await import('../src-next/platform/ArtworkAlphaMask.tsx');
const {default: browseGalleries} = await import('../src-next/dev/families/browse/browse.gallery.tsx');
const {FilterBuilder, FacetChips} = await import('../src-next/kit/browse/index.ts');
const {Focusable, Tabs, Segmented} = await import('../src-next/kit/controls/index.ts');
const {FocusProvider, FocusRegion} = await import('../src-next/kit/focus/index.ts');
const {Menu, MenuRow, Popover} = await import('../src-next/kit/overlays/Menu.tsx');
const {LibrarySwitcher, LibraryMenu} = await import('../src-next/kit/browse/Library.tsx');
const {TextField, Button} = await import('../src-next/kit/controls/index.ts');
const {OwnerTag} = await import('../src-next/kit/shell/index.ts');
const {default: stateGalleries} = await import('../src-next/dev/families/states/states.gallery.tsx');
const {StateLayout} = await import('../src-next/kit/states/StateLayout.tsx');
const {PanelBackground} = await import('../src-next/kit/overlays/surface.tsx');
const {Dialog, OverlaysProvider} = await import('../src-next/kit/overlays/index.ts');
const {default: selectionGalleries} = await import('../src-next/dev/families/selection/selection.gallery.tsx');
const {BulkEditor} = await import('../src-next/kit/selection/BulkEditor.tsx');
const {default: overlayGalleries} = await import('../src-next/dev/families/overlays/overlays.gallery.tsx');
type Element = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<Record<string, any>>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function mount(component: any, initial: any, contexts: [any, unknown][] = []) {
  let props = initial, tree: ReactNode, focusRegistry: any;
  const host = createHookHost(() => {
    const savedContexts = contexts.map(([context, value]) => {const previous = context._currentValue; context._currentValue = value; return [context, previous];});
    try {
    if (component === Row) {
      const wrapper: any = Row(props), provider = wrapper.type(wrapper.props), context = provider.type;
      const previous = context._currentValue;
      focusRegistry = provider.props.value;
      context._currentValue = provider.props.value;
      try {tree = provider.props.children.type(provider.props.children.props);} finally {context._currentValue = previous;}
    } else tree = typeof component === 'function' ? component(props) : component.render(props, props.ref ?? null);
    } finally {for (const [context, value] of savedContexts) context._currentValue = value;}
  });
  host.mount();
  return {host, get tree() {return tree;}, get focusRegistry() {return focusRegistry;}, update(next: any) {props = next; host.rerender();}};
}
const find = (tree: ReactNode, type: unknown) => nodes(tree).find(node => node.type === type)!;

test('Q6 a real touch hold opens More once, suppresses release, and cancels on scrolling', t => {
  state.theme = createTheme({isTV: false, width: 390});
  t.mock.timers.enable({apis: ['setTimeout']});
  const actions: string[] = [], touches: unknown[] = [];
  const props = {title: 'Actual title', onNavigate: () => actions.push('navigate'), onMore: () => actions.push('more'),
    selection: {active: false, selected: false, onEnter: () => actions.push('enter'), onToggle: () => actions.push('toggle')},
    onTouchMove: (event: unknown) => touches.push(event), children: () => null};
  const card = mount(CardFrame, props);
  const point = (x: number, y: number) => ({nativeEvent: {pageX: x, pageY: y, touches: [{}]}});
  try {
    let press = find(card.tree, 'Pressable');
    assert.equal(press.props.onLongPress, undefined);
    press.props.onTouchStart(point(20, 30)); card.host.flush();
    assert.equal(find(card.tree, SelectionHoldFeedback).props.active, true);
    assert.equal(find(card.tree, SelectionHoldFeedback).props.progress, 0);
    t.mock.timers.tick(499); assert.deepEqual(actions, []);
    t.mock.timers.tick(1); card.host.flush();
    assert.deepEqual(actions, ['more']); assert.equal(find(card.tree, SelectionHoldFeedback).props.progress, 1);
    press = find(card.tree, 'Pressable'); press.props.onTouchEnd(point(20, 30)); press.props.onPressOut(); press.props.onPress();
    assert.deepEqual(actions, ['more']);
    press.props.onTouchStart(point(20, 30)); const moved = point(31, 30); press.props.onTouchMove(moved); card.host.flush();
    assert.equal(touches[0], moved); t.mock.timers.tick(500); press.props.onPress();
    assert.deepEqual(actions, ['more']); assert.equal(find(card.tree, SelectionHoldFeedback).props.active, false);
    card.update({...props, selection: {...props.selection, active: true}});
    find(card.tree, 'Pressable').props.onTouchStart(point(20, 30)); t.mock.timers.tick(500); card.host.flush();
    assert.deepEqual(actions, ['more', 'toggle']);
    find(card.tree, 'Pressable').props.onTouchStart(point(0, 0)); card.host.unmount(); t.mock.timers.tick(500);
    assert.deepEqual(actions, ['more', 'toggle']);
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
  const ready: unknown[] = [], errors: unknown[] = [], statuses: unknown[] = [];
  const authenticated = {...foreground, headers: {Authorization: 'Bearer fixture_only'}};
  const onError = (value: unknown) => errors.push(value), onStatusChange = (value: unknown) => statuses.push(value);
  const surface = mount(AmbientArt, {foreground: authenticated, source: ambient, visible: false, priority: true, arrivalDurationMs: 240, onError, onStatusChange, onReady: (value: unknown) => ready.push(value)});
  try {
    const art = nodes(surface.tree).filter(node => node.type === Artwork);
    assert.equal(art.length, 2); assert.ok(art.every(node => node.props.visible === false));
    assert.equal(art[0]!.props.sized, true); assert.equal(art[0]!.props.blurRadius, undefined);
    art[0]!.props.onReady(ambient); assert.deepEqual(ready, []);
    assert.equal(art[1]!.props.source, authenticated, 'mask wraps the actual authenticated Artwork; no URI/header copy or SVG image');
    assert.equal(art[1]!.props.onError, onError); assert.equal(art[1]!.props.onStatusChange, onStatusChange);
    assert.equal(art[1]!.props.priority, true); assert.equal(art[1]!.props.arrivalDurationMs, 240);
    art[1]!.props.onReady(authenticated); assert.deepEqual(ready, [authenticated]);
  } finally {surface.host.unmount();}
});

test('TV Home uses an alpha mask at the fixed sharp frame and the authored scrim over the whole canvas', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const surface = mount(AmbientArt, {foreground: {uri: 'https://current.example/sharp', cacheKey: 'sharp'}, treatment: 'hero', width: 1920, height: 900});
  try {
    const mask = nodes(surface.tree).find(node => node.props.leftOpaqueAt !== undefined);
    assert.ok(mask, 'sharp artwork must reveal ambient at its left edge instead of painting opaque ink at x420');
    assert.equal(mask.props.leftOpaqueAt, state.theme.spec.hero.mask.leftOpaqueAt);
    assert.equal(mask.props.bottomOpaqueAt, state.theme.spec.hero.mask.bottomOpaqueAt);
    const frame = nodes(surface.tree).find(node => node.props.style?.[0]?.width === '78.125%');
    assert.equal(frame!.props.style[0].right, 0); assert.equal(frame!.props.style[0].height, '100%');
    const scrim = nodes(surface.tree).find(node => node.props.tvSide === true);
    assert.ok(scrim, 'TV left scrim spans the full canvas after the foreground frame');
    const actualScrim = mount(scrim.type, scrim.props);
    try {
      const gradient = nodes(actualScrim.tree).find(node => node.props.id === 'art-tv-side');
      assert.deepEqual(nodes(gradient!.props.children).map(stop => [stop.props.offset, stop.props.stopOpacity]), [[0, .86], [.3, .62], [.56, .12], [.7, 0]]);
    } finally {actualScrim.host.unmount();}
  } finally {surface.host.unmount();}
});

test('actual maskElement intersects exact left/bottom alpha ramps, stationary outside foreground drift', () => {
  const child = React.createElement('ActualAuthenticatedArtwork', {headers: {Authorization: 'Bearer fixture_only'}});
  const mask = mount(ArtworkAlphaMask, {leftOpaqueAt: .38, bottomOpaqueAt: .42, children: child});
  try {
    const native = mask.tree as Element;
    assert.equal(native.type, 'MaskedView'); assert.equal(native.props.androidRenderingMode, 'hardware');
    assert.equal(native.props.children, child); assert.equal(native.props.style.transform, undefined);
    const svg = native.props.maskElement;
    assert.equal(svg.type, 'Svg'); assert.equal(svg.props.preserveAspectRatio, 'none');
    const gradients = nodes(svg).filter(node => node.type === 'LinearGradient');
    assert.deepEqual(gradients.map(gradient => nodes(gradient.props.children).map(stop => [stop.props.offset, stop.props.stopOpacity])), [[[0, 0], [.38, 1]], [[0, 0], [.42, 1]]]);
    assert.equal(gradients[0]!.props.x2, '100%'); assert.equal(gradients[1]!.props.y1, '100%'); assert.equal(gradients[1]!.props.y2, '0%');
    const intersection = nodes(svg).find(node => node.type === 'Mask')!;
    assert.equal(intersection.props.maskType, 'alpha');
    assert.equal(nodes(intersection.props.children)[0]!.props.fill, 'url(#alpha-left)');
    const final = nodes(svg).find(node => node.props.mask === 'url(#alpha-intersection)')!;
    assert.equal(final.props.fill, 'url(#alpha-bottom)', 'applying one ramp as a mask to the other multiplies alpha instead of stacking opaque scrims');
    assert.equal(nodes(svg).some(node => node.type === 'Image'), false);
  } finally {mask.host.unmount();}
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

test('TV shelves reserve focus overflow without shifting the card edge and preserve all native actions', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  state.workletTargets = [];
  const items = [{id: 'first'}, {id: 'second'}], focused: string[] = [], ranges: number[][] = [];
  let seeAll = 0;
  const row = mount(Row, {title: 'Continue Watching', items, getKey: (item: {id: string}) => item.id,
    itemWidth: 400, itemHeight: 225, selection: {active: false, isSelected: () => false, onToggle() {}, onEnter() {}},
    onSeeAll: () => seeAll++, onVisibleRange: (first: number, last: number) => ranges.push([first, last]),
    onItemFocus: (item: {id: string}) => focused.push(item.id),
    renderItem: (item: {id: string}, context: any) => React.createElement('View', {key: item.id, testID: item.id, onFocus: context.onFocus})});
  try {
    let scroll = find(row.tree, 'AnimatedScrollView');
    nodes(scroll).find(node => node.props.testID === 'first')!.props.onFocus(); row.host.flush();
    assert.deepEqual(state.workletTargets, [], 'preferred native focus can arrive before viewport measurement without scrolling against zero width');
    scroll.props.onLayout({nativeEvent: {layout: {width: 1920}}}); row.host.flush();
    assert.deepEqual(state.workletTargets, [0], 'the measured viewport re-anchors the already focused first card at its200px safe edge');
    scroll = find(row.tree, 'AnimatedScrollView');
    const first = nodes(scroll).find(node => node.props.testID === 'first')!;
    const placed = nodes(scroll).find(node => node.props.style?.position === 'absolute')!;
    assert.equal(placed.props.style.left, 200);
    assert.equal(placed.props.style.top + scroll.props.style.marginTop, 0, 'ring clearance does not add space below the heading');
    assert.ok(placed.props.style.top >= 18, 'the 1.08 scale and 8px outer ring fit above the track');
    first.props.onFocus(); row.host.flush(); assert.deepEqual(focused, ['first', 'first']);
    assert.deepEqual(ranges.at(-1), [0, 1]);
    assert.equal(find(row.tree, 'Pressable'), undefined, 'DESIGN.md TV focus: row headings and See all are not TV stops');
    assert.equal(seeAll, 0, 'See all is supplied by the card hold menu, never a second heading target');
  } finally {row.host.unmount();}
});

test('TV art focus paints an outer ring and soft shadow without an elevated interior surface', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const art = mount(ArtFrame, {height: 225, focused: true, children: null});
  try {
    const ring = nodes(art.tree).find(node => Array.isArray(node.props.style) && node.props.style[0]?.boxShadow)!;
    assert.ok(ring);
    assert.equal(ring.props.style[0].elevation, undefined);
    assert.equal(ring.props.style[0].backgroundColor, undefined);
    assert.equal(ring.props.style[0].top, -8);
    assert.equal(ring.props.style[0].boxShadow[0].spreadDistance, -12);
    assert.equal(ring.props.style[0].boxShadow[0].blurRadius, 64);
  } finally {art.host.unmount();}
});


test('the real overlay gallery lets an initially open surface own its window and Cancel retains the opener', () => {
  for (const isTV of [false, true]) {
    state.theme = createTheme({isTV, width: isTV ? 1920 : 390});
    const gallery = mount(overlayGalleries.find(value => value.id === 'overlays-dialog')!.render, {});
    const sceneElement = gallery.tree as Element;
    const scene = mount(sceneElement.type, sceneElement.props);
    try {
      assert.equal((scene.tree as Element).type, 'View');
      assert.ok(find(scene.tree, OverlaysProvider));
      assert.equal(nodes(scene.tree).some(node => node.type === 'Modal'), false);
      const dialog = find(scene.tree, Dialog);
      assert.equal(dialog.props.open, true);
      const opener = find(scene.tree, Button);
      assert.ok(opener.props.ref);
      assert.equal(dialog.props.returnFocusRef, opener.props.ref);
      const cancel = nodes(dialog.props.footer).find(node => node.type === Button)!;
      cancel.props.onPress(); gallery.host.flush();
      const updated = (gallery.tree as Element).props;
      scene.update(updated);
      assert.equal(find(scene.tree, Dialog).props.open, false);
      assert.ok(find(scene.tree, Button));
    } finally {scene.host.unmount(); gallery.host.unmount();}
  }
});


test('actual selection galleries render list changes when native Intl.ListFormat is unavailable', t => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'ListFormat')!;
  Object.defineProperty(Intl, 'ListFormat', {...descriptor, value: undefined});
  t.after(() => Object.defineProperty(Intl, 'ListFormat', descriptor));
  for (const isTV of [false, true]) {
    state.theme = createTheme({isTV, width: isTV ? 1920 : 390});
    for (const id of ['selection-circles', 'selection-playlist', 'selection-editor', 'selection-deleteOne']) {
      const gallery = mount(selectionGalleries.find(value => value.id === id)!.render, {});
      const exampleElement = (gallery.tree as Element).props.children as Element;
      const example = mount(exampleElement.type, exampleElement.props);
      try {
        assert.ok(example.tree);
        if (id === 'selection-editor') {
          const editor = find(example.tree, BulkEditor);
          assert.ok(editor.props.summary.some((part: {id: string; text: string}) => part.id === 'tags-add' && part.text.length > 0));
        }
      } finally {example.host.unmount(); gallery.host.unmount();}
    }
  }
});


test('TV panel artwork gets a full unpadded frame independent of the controls padding', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const panel = mount(PanelBackground, {});
  try {
    const root = panel.tree as Element;
    assert.equal(root.type, 'View');
    assert.equal(root.props.pointerEvents, 'none');
    assert.equal(root.props.accessible, false);
    assert.equal(root.props.style.position, 'absolute');
    assert.equal(root.props.style.width, undefined);
    const svg = root.props.children as Element;
    assert.equal(svg.type, 'Svg');
    assert.equal(svg.props.width, '100%');
    assert.equal(svg.props.height, '100%');
    assert.equal(svg.props.style, undefined);
  } finally {panel.host.unmount();}
});


test('real state galleries request initial TV focus only on TV, preserving the native phone state', () => {
  for (const isTV of [false, true]) {
    state.theme = createTheme({isTV, width: isTV ? 1920 : 390});
    for (const id of ['states-connection', 'states-page-failure']) {
      const gallery = mount(stateGalleries.find(value => value.id === id)!.render, {});
      try {assert.equal(find(gallery.tree, StateLayout).props.primaryAction.hasTVPreferredFocus, isTV);}
      finally {gallery.host.unmount();}
    }
  }
});

function nativeFocusable(tree: ReactNode): Element {
  const element = tree as any;
  return element.type.render(element.props, element.props.ref);
}

function actualRegion(id: string) {
  const provider = mount(FocusProvider, {children: null}), providerElement = provider.tree as any;
  const registryContext: [any, unknown] = [providerElement.type, providerElement.props.value];
  const outer = mount(FocusRegion, {id, children: null}, [registryContext]);
  const element = outer.tree as any, region = mount(element.type, element.props, [registryContext]);
  const guide = region.tree as any, childContext: [any, unknown] = [guide.props.children.type, id];
  return {registry: providerElement.props.value, contexts: [registryContext, childContext],
    unmount() {region.host.unmount(); outer.host.unmount(); provider.host.unmount();}};
}

test('F06 CardFrame and TextField attach exactly the hosts native props make eligible', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const scope = actualRegion('eligibility');
  const cardProps = {title: 'Actual card', focusId: 'card', primaryAction: 'navigate', onNavigate() {}, children: () => null};
  const card = mount(CardFrame, {...cardProps, disabled: true}, scope.contexts);
  const host = {nativeTag: 301, requestTVFocus() {}};
  try {
    let native = find(card.tree, 'Pressable'); native.props.ref(host); assert.equal(native.props.focusable, false);
    assert.equal(scope.registry.child({regionId: 'eligibility', childId: 'card'}), undefined);
    card.update({...cardProps, focusable: false}); assert.equal(find(card.tree, 'Pressable').props.focusable, false);
    assert.equal(scope.registry.child({regionId: 'eligibility', childId: 'card'}), undefined);
    card.update(cardProps); native = find(card.tree, 'Pressable'); assert.equal(native.props.focusable, true);
    assert.equal(scope.registry.child({regionId: 'eligibility', childId: 'card'}), host);
    const input = mount(TextField, {focusId: 'input', focusable: false}, scope.contexts);
    try {
      const inputHost = {nativeTag: 302, focus() {}}; find(input.tree, 'TextInput').props.ref(inputHost);
      assert.equal(find(input.tree, 'TextInput').props.focusable, false); assert.equal(scope.registry.child({regionId: 'eligibility', childId: 'input'}), undefined);
      input.update({focusId: 'input', editable: false}); assert.equal(find(input.tree, 'TextInput').props.focusable, false);
      input.update({focusId: 'input'}); assert.equal(find(input.tree, 'TextInput').props.focusable, true);
      assert.equal(scope.registry.child({regionId: 'eligibility', childId: 'input'}), inputHost);
    } finally {input.host.unmount();}
  } finally {card.host.unmount(); scope.unmount();}
});

test('F01 Library composites forward caller-fenced surface and semantic inner identities', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const switcher = mount(LibrarySwitcher, {testID: 'actual-libraries', libraries: [{id: 'one/source', name: 'First'}, {id: 'second', name: 'Second'}], value: 'second', onValueChange() {}, open: true});
  const menu = mount(LibraryMenu, {testID: 'actual-library-options', owner: false, open: true, onSaveView() {}, onMarkAll() {}, onEditPins() {}});
  try {
    const surface = find(switcher.tree, Popover); assert.equal(surface.props.testID, 'actual-libraries-surface');
    const choices = nodes(surface).filter(node => node.type === MenuRow);
    assert.deepEqual(choices.map(node => node.props.focusId), ['one/source', 'second']);
    assert.deepEqual(choices.map(node => node.props.testID), ['actual-libraries-library-one%2Fsource', 'actual-libraries-library-second']);
    const menuSurface = find(menu.tree, Popover); assert.equal(menuSurface.props.testID, 'actual-library-options-surface');
    assert.deepEqual(nodes(menuSurface).filter(node => node.type === MenuRow).map(node => node.props.focusId), ['save-view', 'mark-all', 'edit-pins']);
    const scope = actualRegion(surface.props.testID), choice = mount(MenuRow, choices[0]!.props, scope.contexts);
    try {
      const target = find(choice.tree, Focusable), control = mount(Focusable, target.props, scope.contexts);
      try {nativeFocusable(control.tree).props.ref({nativeTag: 303, requestTVFocus() {}}); assert.ok(scope.registry.child({regionId: surface.props.testID, childId: 'one/source'}));}
      finally {control.host.unmount();}
    } finally {choice.host.unmount(); scope.unmount();}
  } finally {menu.host.unmount(); switcher.host.unmount();}
});

test('F09 explicitly anchored TV Menu holds its in-window native focus guide', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const menu = mount(Menu, {testID: 'anchored-menu', open: true, onOpenChange() {}, presentation: 'anchored', anchorRef: {current: {measureInWindow: (run: any) => run(300, 200, 100, 60)}}, items: [{id: 'action', label: 'Actual action', onSelect() {}}]});
  try {
    const popover = menu.tree as any; assert.equal(popover.type, Popover); assert.equal(popover.props.holdFocus, true); assert.equal(popover.props.modal, undefined);
    const surface = mount(Popover, popover.props);
    try {
      surface.host.flush(); const boundary = nodes(surface.tree).find(node => (node.type as any)?.name === 'FocusBoundary')!;
      assert.ok(boundary); assert.equal(boundary.props.modal, true, 'containment is independent of the native window modality');
    } finally {surface.host.unmount();}
  } finally {menu.host.unmount();}
});

test('F10 standalone Row owns one provider and reports actual raw viewport keys across retained holes', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const seen: (readonly string[])[] = [], items = ['a', 'b', 'c', 'd'].map(id => ({id}));
  const props = {title: 'Actual row', items, getKey: (item: {id: string}) => item.id, getFocusId: (item: {id: string}) => `source/${item.id}`,
    initialViewportWidth: 200, itemWidth: 100, itemHeight: 150, gap: 0, gutter: 0, rightGutter: 0, focus: {id: 'standalone'},
    selection: {active: false, isSelected: () => false, onToggle() {}, onEnter() {}},
    onVisibleKeys: (keys: readonly string[]) => seen.push(keys),
    renderItem: (item: {id: string}, context: any) => React.createElement('View', {testID: `actual-${item.id}`, context})};
  const row = mount(Row, props);
  try {
    assert.deepEqual(seen.at(-1), ['a', 'b']); const registry = row.focusRegistry;
    registry.didFocus({regionId: 'standalone', childId: 'source/b'}); row.host.flush();
    row.update({...props, items: [items[3], items[2], items[0]]});
    const rendered = nodes(row.tree).filter(node => node.props.context);
    assert.deepEqual(rendered.map(node => [node.props.context.id, node.props.context.index]), [['a', 0], ['c', 2], ['d', 3]]);
    assert.deepEqual(seen.at(-1), ['a'], 'physical hole at position1 does not enroll items[1]');
    assert.equal(row.focusRegistry, registry);
  } finally {row.host.unmount();}
});

test('F13 separate Tabs and Segmented groups fence shared semantic values and preserve explicit IDs', () => {
  state.theme = createTheme({isTV: true, width: 1920});
  const items = [{value: 'all', label: 'Actual all'}], scope = actualRegion('choices');
  const a = mount(Tabs, {testID: 'group-a', items}), b = mount(Segmented, {testID: 'group-b', items}), explicit = mount(Tabs, {testID: 'group-c', items, itemProps: () => ({focusId: 'explicit-child', testID: 'explicit-host'})});
  try {
    const first = find(a.tree, Focusable), second = find(b.tree, Focusable), override = find(explicit.tree, Focusable);
    assert.notEqual(first.props.focusId, second.props.focusId); assert.equal(override.props.focusId, 'explicit-child'); assert.equal(override.props.testID, 'explicit-host');
    const firstTarget = mount(Focusable, first.props, scope.contexts), secondTarget = mount(Focusable, second.props, scope.contexts);
    try {
      const one = {nativeTag: 304, requestTVFocus() {}}, two = {nativeTag: 305, requestTVFocus() {}};
      nativeFocusable(firstTarget.tree).props.ref(one); nativeFocusable(secondTarget.tree).props.ref(two);
      assert.equal(scope.registry.child({regionId: 'choices', childId: first.props.focusId}), one); assert.equal(scope.registry.child({regionId: 'choices', childId: second.props.focusId}), two);
      firstTarget.host.unmount(); assert.equal(scope.registry.child({regionId: 'choices', childId: second.props.focusId}), two);
    } finally {firstTarget.host.unmount(); secondTarget.host.unmount();}
  } finally {a.host.unmount(); b.host.unmount(); explicit.host.unmount(); scope.unmount();}
});


test('Q6 touch menus opt into compact sheets or anchored 300pt popovers without changing account defaults', () => {
  const props = {title: 'Actual title', open: true, onOpenChange() {}, anchorRef: {current: {measureInWindow(run: any) {run(100, 100, 150, 225);}}}, items: [{id: 'play', label: 'Play', onSelect() {}}]};
  state.theme = createTheme({isTV: false, width: 820});
  const touch = mount(Menu, {...props, touchContext: true});
  try {
    const surface = find(touch.tree, Popover);
    assert.equal(surface.props.touchContext, true); assert.equal(surface.props.modal, true); assert.equal(surface.props.backdropOpacity, .58);
  } finally {touch.host.unmount();}
  const account = mount(Menu, props);
  try {assert.equal(find(account.tree, Popover).props.touchContext, false);} finally {account.host.unmount();}
  state.theme = createTheme({isTV: false, width: 390});
  const compact = mount(Menu, {...props, touchContext: true});
  try {
    const sheet = nodes(compact.tree).find(node => node.props.fitContent === true)!;
    assert.equal(sheet.props.backdropOpacity, .58);
  } finally {compact.host.unmount();}
});
