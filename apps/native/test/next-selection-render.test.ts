import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import React, {type ReactElement, type ReactNode} from 'react';
import {transformSync} from 'rolldown/utils';
import {createHookHost} from './hook-driver.ts';
import {createTheme, fontFamilies, nativeType} from '../src-next/kit/theme.ts';
import type {BulkEditorProps, DeleteMediaDialogProps, SelectionBarProps} from '../src-next/kit/selection/types.ts';

// Exercise the actual family, controls and overlay composition. Only native
// hosts, animation/gesture drivers and the theme context are replaced. This
// element/hook harness cannot establish native layout or physical D-pad focus.
const keyboardListeners = new Map<string, (event?: any) => void>();
Object.assign(globalThis, {__porticoSelectionKeyboard: keyboardListeners});
const state = {viewport: {width: 1920, height: 1080, scale: 1, fontScale: 1}, theme: createTheme({isTV: true, width: 1920}), fontFamilies, nativeType};
const stateKey = '__porticoSelectionRenderTest';
Object.assign(globalThis, {[stateKey]: state});
const moduleURL = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const nativeStub = new URL('./react-native-stub.mjs', import.meta.url).href;
const native = moduleURL(`export * from ${JSON.stringify(nativeStub)};
  export const Platform={OS:'android',isTV:true};
  export const View='View',Text='Text',Pressable='Pressable',Modal='Modal',ScrollView='ScrollView',FlatList='FlatList',TVFocusGuideView='TVFocusGuideView',ActivityIndicator='ActivityIndicator';
  export const Image='Image', ImageBackground='ImageBackground', PixelRatio={get:()=>1,getFontScale:()=>1,roundToNearestPixel:n=>n};
  export const Animated={View:'NativeAnimatedView',createAnimatedComponent:c=>c,Value:class{constructor(value){this.value=value}}};
  export const TextInput=Object.assign(()=>null,{State:{currentlyFocusedInput:()=>globalThis.__porticoSelectionFocusedInput}});
  export const Keyboard={addListener:(name,callback)=>{const m=globalThis.__porticoSelectionKeyboard;m.set(name,callback);return {remove(){m.delete(name);}};}};
  export const BackHandler={addEventListener:()=>({remove(){}})};
  export const useWindowDimensions=()=>globalThis.__porticoSelectionRenderTest.viewport;
  const flatten=s=>Array.isArray(s)?Object.assign({},...s.map(flatten)):s??{};
  export const StyleSheet={create:s=>s,flatten,absoluteFill:{position:'absolute',inset:0}};`);
const theme = moduleURL(`const s=globalThis.${stateKey}; export const useTheme=()=>s.theme; export const fontFamilies=s.fontFamilies; export const nativeType=s.nativeType;`);
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
    if (specifier === 'react-native') return {url: native, shortCircuit: true};
    if (specifier === 'react-native-reanimated') return {url: reanimated, shortCircuit: true};
    if (specifier === 'react-native-gesture-handler') return {url: gesture, shortCircuit: true};
    if (specifier === '@react-native-masked-view/masked-view') return {url: moduleURL(`export default 'MaskedView';`), shortCircuit: true};
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
const NativeInput = (await import('react-native')).TextInput;
const {selectionControlID: controlID} = await import('../src-next/kit/selection/focus-ids.ts');
const {PlaylistPicker} = await import('../src-next/kit/selection/Picker.tsx');
const {BulkEditor} = await import('../src-next/kit/selection/BulkEditor.tsx');
const {DeleteMediaDialog} = await import('../src-next/kit/selection/DeleteMediaDialog.tsx');
const {MixedEditExplainer} = await import('../src-next/kit/selection/MixedEditExplainer.tsx');
const {SelectionBar} = await import('../src-next/kit/selection/SelectionBar.tsx');
const {Icon} = await import('../src-next/kit/Icon.tsx');
const {SelectionActionRow} = await import('../src-next/kit/selection/SelectionActionRow.tsx');
const {StateLayout} = await import('../src-next/kit/states/StateLayout.tsx');
const {StateView} = await import('../src-next/kit/states/StateView.tsx');
const {SelectionSurface, SelectionText} = await import('../src-next/kit/selection/surface.tsx');
const {BottomSheet} = await import('../src-next/kit/overlays/BottomSheet.tsx');
const {Dialog, FocusBoundary, SurfaceHeader, SidePanel} = await import('../src-next/kit/overlays/surface.tsx');
const {Menu, MenuRow} = await import('../src-next/kit/overlays/Menu.tsx');
const {Button} = await import('../src-next/kit/controls/Button.tsx');
const {Focusable} = await import('../src-next/kit/controls/Focusable.tsx');
const {SelectionCircle} = await import('../src-next/kit/selection/SelectionCircle.tsx');
const {TextField} = await import('../src-next/kit/controls/TextField.tsx');
const {Select} = await import('../src-next/kit/controls/Select.tsx');
const {Switch} = await import('../src-next/kit/controls/Switch.tsx');

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const ofType = (node: ReactNode, type: unknown) => elements(node).filter(element => element.type === type);
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join(' ') : React.isValidElement<Record<string, any>>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
function mount(component: any, props: any) {
  let tree: ReactNode;
  const host = createHookHost(() => {tree = typeof component === 'function' ? component(props) : component.render(props, props.ref ?? null);});
  host.mount();
  return {get tree() {return tree;}, update(next: any) {props = next; host.rerender();}, host};
}
function bulk(overrides: Partial<BulkEditorProps> = {}): BulkEditorProps {
  return {open: true, onOpenChange() {}, title: 'Edit actual movies', count: 4, saveLabel: 'Save actual movies',
    schema: [{field: 'year', label: 'Year', group: 'numbers', type: 'integer', min: 0, max: 9999, bulk: true}, {field: 'tags', label: 'Tags', group: 'general', type: 'list', maxLength: 128, max: 64, bulk: true}],
    singleItemFields: [{field: 'title', label: 'Title', group: 'general', type: 'text', bulk: false}],
    values: {year: {state: 'mixed', distinctCount: 4, truncated: true, values: [{value: '1995', count: 1}], entries: []}, tags: {state: 'mixed', distinctCount: 2, truncated: false, values: [], entries: [{value: 'Existing', count: 3}]}},
    changes: {}, onChangesChange() {}, lockEdited: true, onLockEditedChange() {}, onSave() {}, onRetry() {}, resultEntries: [{id: 'a', title: 'Actual saved title'}, {id: 'b', title: 'Actual failed title'}], ownerHeader: null, fieldLabel: field => field.label, summary: [], ...overrides};
}

test('TV BulkEditor binds real schema fields to native controls without writing untouched Mixed or locks', () => {
  const calls: unknown[] = [];
  const props = bulk({onChangesChange: changes => calls.push(changes), onLockEditedChange: value => calls.push(value), onSave: () => calls.push('save')});
  const editor = mount(BulkEditor, props);
  try {
    const surface = editor.tree as Element;
    assert.equal(surface.type, SelectionSurface);
    assert.equal(surface.props.returnFocusRef, props.returnFocusRef);
    assert.equal(ofType(surface.props.footer, Button).at(-1)!.props.disabled, true);
    const scalar = elements(surface).find(element => element.props.field?.field === 'year')!;
    const input = mount(scalar.type, scalar.props);
    try {
      const field = ofType(input.tree, TextField)[0]!;
      assert.equal(field.props.value, ''); assert.equal(field.props.keyboardType, 'numbers-and-punctuation');
      assert.equal(field.props.fieldStyle.height, 64); assert.equal(field.props.fieldStyle.borderRadius, 14);
      assert.match(text(input.tree), /Mixed/); assert.match(text(input.tree), /4 values/);
      assert.deepEqual(calls, []);
      const focus = {focus() {}}; field.props.ref(focus);
      assert.equal(surface.props.initialFocusRef.current, focus, 'initial focus targets the actual first TextField');
      const control = mount(TextField, field.props);
      try {
        const nativeInput = elements(control.tree).find(element => element.type === NativeInput)!;
        assert.ok(nativeInput); assert.equal(nativeInput.props.keyboardType, 'numbers-and-punctuation');
        nativeInput.props.ref(focus);
        assert.equal(surface.props.initialFocusRef.current, focus, 'registry binding forwards the actual TextInput host');
        nativeInput.props.onChangeText('2020');
        assert.deepEqual(calls, [{year: {value: '2020'}}]);
        nativeInput.props.ref(null);
        assert.equal(surface.props.initialFocusRef.current, null, 'unmount clears the forwarded native host');
      } finally {control.host.unmount();}
      assert.deepEqual(calls, [{year: {value: '2020'}}]);
    } finally {input.host.unmount();}
    ofType(surface, Switch)[0]!.props.onCheckedChange(false);
    assert.deepEqual(calls.at(-1), false);
    const changed = {...props, changes: {year: {value: '2020'}}};
    editor.update(changed);
    const save = ofType((editor.tree as Element).props.footer, Button).at(-1)!;
    assert.equal(save.props.disabled, false); save.props.onPress(); assert.equal(calls.at(-1), 'save');
  } finally {editor.host.unmount();}
});

test('TV list controls use incremental callbacks and an actual keyboard TextField', () => {
  const calls: unknown[] = [];
  const editor = mount(BulkEditor, bulk({onChangesChange: changes => calls.push(changes)}));
  const listNode = elements(editor.tree).find(element => element.props.field?.field === 'tags')!;
  const list = mount(listNode.type, listNode.props);
  try {
    const chip = ofType(list.tree, Focusable)[0]!;
    assert.equal(chip.props.focusKind, 'chip'); assert.equal(chip.props.style.height, 56);
    chip.props.onPress(); assert.deepEqual(calls, [{tags: {add: [], remove: ['Existing']}}]);
    ofType(list.tree, TextField)[0]!.props.onChangeText('New value'); list.host.flush();
    ofType(list.tree, TextField)[0]!.props.onSubmitEditing();
    assert.deepEqual(calls.at(-1), {tags: {add: ['New value'], remove: []}});
  } finally {list.host.unmount(); editor.host.unmount();}
});

test('TV choice fields stay on the shared Select and no-fields remains its own truthful explanation', () => {
  const props = bulk({fieldOptions: {year: [{value: '2020', label: '2020'}]}});
  const editor = mount(BulkEditor, props);
  try {
    const scalar = elements(editor.tree).find(element => element.props.field?.field === 'year')!;
    const choice = mount(scalar.type, scalar.props);
    try {
      assert.equal((choice.tree as Element).type, Select); assert.equal((choice.tree as Element).props.description, '4 values');
      const select = mount(Select, (choice.tree as Element).props);
      try {
        const implementation = select.tree as Element;
        const control = mount(implementation.type, implementation.props);
        try {
          const trigger = ofType(control.tree, Focusable)[0]!;
          assert.equal(trigger.props.focusRadius, 14); trigger.props.onPress({}); control.host.flush();
          const picker = ofType(control.tree, Dialog)[0]!;
          assert.equal(picker.props.open, true); assert.equal(picker.props.placement, 'side'); assert.equal(picker.props.width, 640);
        } finally {control.host.unmount();}
      } finally {select.host.unmount();}
    } finally {choice.host.unmount();}
    editor.update({...props, schema: []});
    assert.match(text(editor.tree), /These fields are edited one title at a time/);
    assert.doesNotMatch(text(editor.tree), /Edit works on one type/);
    assert.equal(ofType((editor.tree as Element).props.footer, Button).at(-1)!.props.disabled, true);
  } finally {editor.host.unmount();}
});

test('TV partial receipts retain actual rows and retry only actual failures, including row retry and focus', () => {
  const calls: unknown[] = [];
  const returnFocusRef = {current: {requestTVFocus() {calls.push('return');}}};
  const props = bulk({returnFocusRef, onRetry: ids => calls.push(ids)});
  const editor = mount(BulkEditor, props);
  try {
    const result = {updated: 1, failed: 1, results: [{kind: 'item', id: 'a', ok: true}, {kind: 'item', id: 'b', ok: false, code: 'metadata_conflict'}]};
    editor.update({...props, result});
    const surface = editor.tree as Element;
    assert.equal(surface.props.returnFocusRef, returnFocusRef);
    assert.match(text(surface), /Actual saved title/); assert.match(text(surface), /Actual failed title/);
    assert.match(text(surface), /Someone else changed this title while you were editing/);
    ofType(surface, Button).find(button => text(button.props.children) === 'Try again')!.props.onPress();
    const footerRetry = ofType(surface.props.footer, Button).at(-1)!;
    footerRetry.props.onPress(); assert.deepEqual(calls, [['b'], ['b']]);
    assert.equal(surface.props.initialFocusRef, footerRetry.props.ref);
    footerRetry.props.ref.current = {requestTVFocus() {calls.push(['retry-focus']);}};
    editor.update({...props, result, pending: true}); editor.update({...props, result, pending: false});
    editor.update({...props, result: {...result, updated: 0, failed: 2, results: result.results.map(row => ({...row, ok: false}))}});
    assert.deepEqual(calls.at(-1), ['retry-focus']);
  } finally {editor.host.unmount();}
});

test('the genuine TV surface retains the existing side-sheet recipe, initial/return refs and modal focus boundary', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const focused: string[] = [];
  const ref = {current: {requestTVFocus() {focused.push('initial');}}};
  const restore = {current: {requestTVFocus() {focused.push('return');}}};
  const surface = mount(SelectionSurface, {open: true, onOpenChange() {}, title: 'Actual editor', children: null, fullHeight: true, initialFocusRef: ref, returnFocusRef: restore});
  try {
    const sheet = surface.tree as Element;
    assert.equal(sheet.type, BottomSheet); assert.equal(sheet.props.width, 680);
    assert.equal(sheet.props.initialFocusRef, ref); assert.equal(sheet.props.returnFocusRef, restore);
    const body = mount(BottomSheet, sheet.props);
    try {
      const boundary = ofType(body.tree, FocusBoundary)[0]!;
      assert.equal(boundary.props.modal, true);
      const panel = elements(body.tree).find(node => Array.isArray(node.props.style) && node.props.style.some((value: any) => value?.paddingRight === 96))!;
      assert.ok(panel); assert.equal(panel.props.style[1].paddingLeft, 56);
      t.mock.timers.tick(320); assert.deepEqual(focused, ['initial']);
    } finally {body.host.unmount();}
    assert.deepEqual(focused, ['initial', 'return']);
    const copy = mount(SelectionText, {children: 'Actual message'});
    try {assert.equal((copy.tree as Element).props.style[0].fontSize, 24);} finally {copy.host.unmount();}
  } finally {surface.host.unmount();}
});

test('TV More presents only supplied owner commands and preserves denial explanations and callbacks', () => {
  const calls: unknown[] = [];
  const props: SelectionBarProps = {count: 4, selectAllLabel: 'Select all', onSelectAll() {}, onCancel() {}, actions: [{id: 'more'}, {id: 'edit'}, {id: 'refresh'}, {id: 'delete', disabled: true, reason: 'One library required'}, {id: 'download'}], onAction: action => calls.push(action), menu: 'more', onMenuChange() {}};
  const bar = mount(SelectionBar, props);
  try {
    const menus = elements(bar.tree).find(element => element.props.menu === 'more' && element.type !== SelectionBar)!;
    const menu = mount(menus.type, menus.props);
    try {
      const element = menu.tree as Element; assert.equal(element.type, Menu); assert.equal(element.props.presentation, 'sideSheet');
      assert.equal(element.props.returnFocusRef, ofType(bar.tree, Button).find(button => button.props.accessibilityLabel === 'More')!.props.ref);
      const items = element.props.items.filter((entry: any) => entry.onSelect);
      assert.deepEqual(items.map((entry: any) => entry.id), ['edit', 'refresh', 'delete']);
      assert.equal(items[2].disabled, true); assert.equal(items[2].description, 'One library required');
      items[0].onSelect(); items[1].onSelect(); assert.deepEqual(calls, ['edit', 'refresh']);
      menu.update({...menus.props, actions: []}); assert.deepEqual((menu.tree as Element).props.items, []);
    } finally {menu.host.unmount();}
  } finally {bar.host.unmount();}
});

test('TV mixed Edit offers genuine Keep-only callbacks and an actual initial focus row', () => {
  const calls: unknown[] = [];
  const props = {open: true, onOpenChange: (...args: unknown[]) => calls.push(args), total: 2, description: 'Actual mixed-type reason', groups: [{kind: 'movie', label: 'Movies', count: 1, icon: 'i-film'}, {kind: 'episode', label: 'Episodes', count: 1, icon: 'i-tv'}], onKeepOnly: (kind: string) => calls.push(kind)};
  const mixed = mount(MixedEditExplainer, props);
  try {
    const surface = mixed.tree as Element; assert.equal(surface.type, SelectionSurface); assert.equal(surface.props.description, 'Actual mixed-type reason');
    const rows = ofType(surface, Focusable); assert.equal(rows.length, 2); assert.equal(rows[0]!.props.ref, surface.props.initialFocusRef);
    rows[1]!.props.onPress(); assert.deepEqual(calls, ['episode', [false, 'action']]);
    mixed.update({...props, groups: [{kind: 'season', label: 'Seasons', count: 2, icon: 'i-tv'}], description: 'Actual no-fields reason'});
    const single = mixed.tree as Element;
    assert.equal(single.props.title, 'These fields are edited one title at a time.');
    assert.equal(single.props.description, 'Actual no-fields reason'); assert.equal(ofType(single, Focusable).length, 0);
    assert.equal(single.props.initialFocusRef, single.props.footer.props.ref);
  } finally {mixed.host.unmount();}
});

test('TV Delete keeps the owner, preview, exact confirmation and restriction gates on the real dialog', () => {
  const calls: unknown[] = [];
  const preview = {revision: 7, confirmation: '1', confirmationKind: 'count' as const, totalBytes: 0, totalFiles: 1, totalBytesText: '0 B', blocked: [], targets: [{itemId: 'a', title: 'Actual title', kind: 'movie', libraryId: 'one', libraryName: 'Actual library', allowMediaDeletion: true, titles: 1, bytes: 0, files: [], dependents: []}]};
  const props: DeleteMediaDialogProps = {testID: 'tv.authority.delete', open: true, onOpenChange() {}, ownerHeader: null, owner: true, selectionCount: 1, preview, confirmation: '', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete: (...args) => calls.push(args)};
  const dialog = mount(DeleteMediaDialog, props);
  try {
    let surface = dialog.tree as Element; assert.equal(surface.type, SelectionSurface);
    assert.equal(surface.props.initialFocusRef, ofType(surface.props.footer, Button)[0]!.props.ref);
    assert.equal(nativeControlID(ofType(surface.props.footer, Button)[0]!), controlID(props.testID, 'dismiss'));
    assert.equal(ofType(surface, TextField)[0]!.props.testID, controlID(props.testID, 'confirmation'));
    assert.equal(ofType(surface, Switch)[0]!.props.testID, controlID(props.testID, 'remove-files'));
    let remove = ofType(surface.props.footer, Button)[1]!; assert.equal(remove.props.disabled, true); remove.props.onPress(); assert.deepEqual(calls, []);
    dialog.update({...props, confirmation: '1'}); surface = dialog.tree as Element;
    remove = ofType(surface.props.footer, Button)[1]!; assert.equal(remove.props.disabled, false); remove.props.onPress(); assert.deepEqual(calls, [[preview, '1', true]]);
    dialog.update({...props, selectionCount: 201}); assert.match(text(dialog.tree), /Delete at most 200/);
    dialog.update({...props, preview: {...preview, blocked: ['Actual library']}}); assert.match(text(dialog.tree), /Deleting is turned off/);
    dialog.update({...props, owner: false}); assert.equal(dialog.tree, null);
  } finally {dialog.host.unmount();}
});

test('a decorative circle gets its full native style state from Pressable without becoming a focus target', () => {
  const nativeState = {pressed: false, focused: false};
  let received: unknown;
  let presses = 0;
  const circle = mount(SelectionCircle, {selected: true, interactive: false, accessibilityLabel: 'Selected title',
    onPress: () => {presses++;}, style: (value: typeof nativeState) => {received = value; return {opacity: .5};}});
  try {
    const host = circle.tree as Element;
    assert.equal(host.type, 'Pressable');
    assert.equal(host.props.disabled, true); assert.equal(host.props.focusable, false);
    assert.equal(host.props.pointerEvents, 'none'); assert.equal(host.props.accessible, false);
    assert.equal(host.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(host.props.onPress, undefined); assert.equal(host.props.accessibilityLabel, undefined);
    host.props.style(nativeState);
    assert.equal(received, nativeState); assert.equal(presses, 0);
  } finally {circle.host.unmount();}
});

// Follow each receiving seam through the real controls to the native host.
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

test('selection actions and their internal menu carry the authority fence to actual Pressables', () => {
  const prefix = 'tv.[server,account,profile,epoch,viewer].selection-bar';
  const props: SelectionBarProps = {testID: prefix, count: 4, selectAllLabel: 'All', onSelectAll() {}, onCancel() {}, onAction() {}, menu: 'queue', onMenuChange() {}, actions: [{id: 'play'}, {id: 'queue'}, {id: 'watched'}, {id: 'more'}, {id: 'playNext'}, {id: 'playLater'}]};
  const bar = mount(SelectionBar, props);
  try {
    const buttons = ofType(bar.tree, Button);
    assert.deepEqual(buttons.map(nativeControlID), ['play', 'queue', 'watched', 'more'].map(id => controlID(prefix, 'action', id)).concat([controlID(prefix, 'select-all'), controlID(prefix, 'dismiss')]));
    const menuNode = elements(bar.tree).find(element => element.props.menu === 'queue' && element.type !== SelectionBar)!;
    const menu = mount(menuNode.type, menuNode.props);
    try {
      assert.equal((menu.tree as Element).props.testID, controlID(prefix, 'menu', 'queue'));
      const shared = mount((menu.tree as Element).type, (menu.tree as Element).props);
      try {assert.deepEqual(ofType((menu.tree as Element).props.children, MenuRow).map(nativeControlID), ['playNext', 'playLater'].map(action => `${controlID(prefix, 'menu', 'queue')}-item-${action}`));} finally {shared.host.unmount();}
      assert.equal((menu.tree as Element).props.returnFocusRef, buttons[1]!.props.ref);
      menu.update({...menuNode.props, menu: null, returnFocusRef: undefined});
      assert.equal((menu.tree as Element).props.testID, controlID(prefix, 'menu', 'queue'), 'closing animation retains its semantic surface identity');
      assert.equal((menu.tree as Element).props.returnFocusRef, buttons[1]!.props.ref, 'closing animation retains the real opener ref');
    } finally {menu.host.unmount();}
    bar.update({...props, count: 99, selectAllLabel: 'Translated copy'});
    assert.deepEqual(ofType(bar.tree, Button).map(nativeControlID), buttons.map(nativeControlID));
  } finally {bar.host.unmount();}
});

test('picker destination identity survives translation/reorder and find/name IDs reach TextInputs', () => {
  const calls: unknown[] = [], prefix = 'tv.authority.picker.playlist';
  const props = {testID: prefix, open: true, onOpenChange() {}, count: 2, selectionLabel: 'Selected', entries: [{id: 'one/two', title: 'Same', size: 1, canAdd: true}, {id: 'one.two', title: 'Same', size: 2, canAdd: false}], creating: false, onCreatingChange() {}, name: '', onNameChange() {}, onCreateAndAdd() {}, onAdd: (id: string) => calls.push(id), query: '', onQueryChange() {}, showFind: true, onRetry() {}, onViewDestination() {}, onResultDismiss() {}};
  const wrapper = mount(PlaylistPicker, props), picker = mount((wrapper.tree as Element).type, (wrapper.tree as Element).props);
  const rowIDs = () => {
    const list = elements(picker.tree).find(element => element.type === 'FlatList')!;
    return list.props.data.map((item: unknown) => {const row = list.props.renderItem({item}); return {id: nativeControlID(row), row};});
  };
  try {
    const rows = rowIDs();
    assert.notEqual(rows[0].id, rows[1].id);
    assert.equal(rows[0].id, controlID(prefix, 'destination', 'playlist', 'one/two'));
    rows[0].row.props.onPress(); rows[1].row.props.onPress(); assert.deepEqual(calls, ['one/two']);
    const find = ofType(picker.tree, TextField)[0]!;
    const input = mount(TextField, find.props);
    try {assert.equal(elements(input.tree).find(element => element.type === NativeInput)!.props.testID, controlID(prefix, 'find'));} finally {input.host.unmount();}
    picker.update({...props, kind: 'playlist', entries: [...props.entries].reverse().map(entry => ({...entry, title: 'Translated'}))});
    assert.deepEqual(rowIDs().map((entry: {id: string}) => entry.id), rows.map((entry: {id: string}) => entry.id).reverse());
    picker.update({...props, kind: 'playlist', creating: true});
    const name = mount(TextField, ofType(picker.tree, TextField)[0]!.props);
    try {assert.equal(elements(name.tree).find(element => element.type === NativeInput)!.props.testID, controlID(prefix, 'name'));} finally {name.host.unmount();}
    picker.update({...props, kind: 'playlist', entries: []});
    const surface = ofType(picker.tree, SelectionSurface)[0]!;
    const create = ofType(surface, Focusable).find(element => element.props.testID === controlID(prefix, 'new'))!;
    assert.equal(surface.props.initialFocusRef, create.props.ref, 'empty picker enters the actual New control');
  } finally {picker.host.unmount(); wrapper.host.unmount();}
});

test('bulk field/value/result IDs use schema and entity keys while native lock/save controls stay fenced', () => {
  const prefix = 'tv.authority.editor';
  const editor = mount(BulkEditor, bulk({testID: prefix, changes: {year: {value: '2020'}}}));
  try {
    const scalarNode = elements(editor.tree).find(element => element.props.field?.field === 'year')!;
    const scalar = mount(scalarNode.type, scalarNode.props);
    try {
      const field = ofType(scalar.tree, TextField)[0]!, input = mount(TextField, field.props);
      try {assert.equal(elements(input.tree).find(element => element.type === NativeInput)!.props.testID, controlID(prefix, 'field', 'year', 'input'));} finally {input.host.unmount();}
    } finally {scalar.host.unmount();}
    const listNode = elements(editor.tree).find(element => element.props.field?.field === 'tags')!;
    const list = mount(listNode.type, listNode.props);
    try {assert.equal(nativeControlID(ofType(list.tree, Focusable)[0]!), controlID(prefix, 'field', 'tags', 'value-toggle', 'Existing'));} finally {list.host.unmount();}
    const lock = mount(Switch, ofType(editor.tree, Switch)[0]!.props);
    try {assert.equal(nativeControlID(lock.tree as Element), controlID(prefix, 'lock-edited'));} finally {lock.host.unmount();}
    const surface = editor.tree as Element;
    assert.deepEqual(ofType(surface.props.footer, Button).map(nativeControlID), [controlID(prefix, 'dismiss'), controlID(prefix, 'save')]);
    editor.update(bulk({testID: prefix, result: {updated: 0, failed: 2, results: [{kind: 'item', id: 'same', ok: false}, {kind: 'person', id: 'same', ok: false}]}}));
    const retries = ofType(editor.tree, Button).filter(button => button.props.testID?.includes('result'));
    assert.deepEqual(retries.map(nativeControlID), [controlID(prefix, 'result', 'item', 'same', 'retry'), controlID(prefix, 'result', 'person', 'same', 'retry')]);
  } finally {editor.host.unmount();}
});


test('phone text-entry sheet moves body and footer together for keyboard events and restores refs', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const previousTheme = state.theme, previousViewport = state.viewport;
  state.theme = createTheme({isTV: false, width: 390});
  state.viewport = {width: 390, height: 844, scale: 1, fontScale: 1};
  const calls: string[] = [];
  const initial = {current: {focus() {calls.push('input');}}};
  const returning = {current: {focus() {calls.push('opener');}}};
  const props = {open: true, onOpenChange() {}, title: 'Actual entry', children: React.createElement('TextInput', {testID: 'actual-input'}), footer: React.createElement('Button', {testID: 'actual-footer'}), initialFocusRef: initial, returnFocusRef: returning, testID: 'phone.entry', detents: [800], keyboardAvoiding: true};
  const sheet = mount(BottomSheet, props);
  try {
    const boundary = () => elements(sheet.tree).find(element => element.props.testID === 'phone.entry-keyboard-boundary')!;
    const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
    const getSheet = () => elements(sheet.tree).find(element => element.props.testID === 'phone.entry')!;
    t.mock.timers.tick(500);
    assert.deepEqual(calls, ['input']);
    assert.equal(flatten(boundary().props.style).marginBottom, 0);
    keyboardListeners.get('keyboardDidShow')!({endCoordinates: {screenY: 544, height: 300}}); sheet.host.rerender();
    assert.equal(flatten(boundary().props.style).marginBottom, 300);
    assert.ok(elements(boundary()).some(element => element.props.testID === 'actual-footer'));
    assert.ok(elements(boundary()).some(element => element.props.testID === 'actual-input'));
    assert.ok(flatten(getSheet().props.style).height <= 544);
    assert.deepEqual(calls, ['input'], 'keyboard movement must not steal focus');
    const outer = sheet.tree as Element;
    const measured = elements(outer).find(element => typeof element.props.onLayout === 'function' && element.type === 'View')!;
    measured.props.onLayout({nativeEvent: {layout: {height: 544}}}); sheet.host.rerender();
    assert.equal(flatten(boundary().props.style).marginBottom, 0, 'Android resize must not subtract the keyboard twice');
    assert.ok(flatten(getSheet().props.style).height <= 544);
    measured.props.onLayout({nativeEvent: {layout: {height: 844}}}); sheet.host.rerender();
    keyboardListeners.get('keyboardDidHide')!(); sheet.host.rerender();
    assert.equal(flatten(boundary().props.style).marginBottom, 0);
    assert.equal(flatten(getSheet().props.style).height, 800);
    sheet.host.unmount();
    assert.deepEqual(calls, ['input', 'opener']);
    assert.equal(keyboardListeners.size, 0);
    const regular = mount(BottomSheet, {...props, keyboardAvoiding: false});
    try {assert.equal(keyboardListeners.size, 0, 'default sheets do not opt into keyboard handling');} finally {regular.host.unmount();}
  } finally {state.theme = previousTheme; state.viewport = previousViewport; sheet.host.unmount();}
});


test('phone queue uses the supplied kind, unboxed rows, denial copy and original authority IDs', () => {
  const previousTheme = state.theme;
  state.theme = createTheme({isTV: false, width: 390});
  const calls: unknown[] = [];
  const props: SelectionBarProps = {testID: 'phone.authority.queue', count: 3, selectionLabel: '3 episodes', selectAllLabel: 'All', onSelectAll() {}, onCancel() {}, onAction: action => calls.push(action), menu: 'queue', onMenuChange: menu => calls.push(menu), actions: [{id: 'playNext'}, {id: 'playLater', disabled: true, reason: 'Actual unavailable reason'}]};
  const bar = mount(SelectionBar, props);
  try {
    const node = elements(bar.tree).find(element => element.props.menu === 'queue' && element.type !== SelectionBar)!;
    const menu = mount(node.type, node.props);
    try {
      const surface = menu.tree as Element;
      assert.equal(surface.type, SelectionSurface); assert.equal(surface.props.title, 'Add 3 episodes to the queue');
      assert.equal(surface.props.description, 'In the order you picked them');
      const rows = ofType(surface, SelectionActionRow);
      assert.equal(rows[0].props.description, 'After what’s playing now');
      assert.equal(rows[1].props.description, 'Actual unavailable reason'); assert.equal(rows[1].props.disabled, true);
      assert.equal(nativeControlID(rows[0]), `${controlID('phone.authority.queue', 'menu', 'queue')}-item-playNext`);
      rows[0].props.onPress(); assert.deepEqual(calls, ['playNext', null]);
    } finally {menu.host.unmount();}
  } finally {bar.host.unmount(); state.theme = previousTheme;}
});


test('content-fit Selection surfaces do not reserve an empty footer or default Done control', () => {
  const surface = mount(SelectionSurface, {open: true, onOpenChange() {}, title: 'Actual queue', children: null});
  try {const sheet = surface.tree as Element; assert.equal(sheet.props.footer, undefined); assert.equal(sheet.props.showClose, false); assert.equal(sheet.props.fitContent, true);} finally {surface.host.unmount();}
});


test('a real deletion preview error stays unavailable and cannot invoke the destructive callback', () => {
  const calls: unknown[] = [];
  const props: DeleteMediaDialogProps = {open: true, onOpenChange() {}, ownerHeader: null, owner: true, selectionCount: 4, preview: null, error: 'Actual preview unavailable', confirmation: '4', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete: (...args) => calls.push(args)};
  const dialog = mount(DeleteMediaDialog, props);
  try {
    assert.match(text(dialog.tree), /Actual preview unavailable/);
    assert.doesNotMatch(text(dialog.tree), /Checking what would be removed/);
    const button = ofType((dialog.tree as Element).props.footer, Button).at(-1)!;
    assert.equal(button.props.disabled, true); button.props.onPress(); assert.deepEqual(calls, []);
  } finally {dialog.host.unmount();}
});

test('Selection input uses real native focus/blur/ref and keeps default and TV fields unchanged', () => {
  const previous = state.theme; state.theme = createTheme({isTV: false, width: 390});
  const forwarded = {current: null as any}; const calls: string[] = [];
  const field = mount(TextField, {appearance: 'selection', label: 'Confirmation', value: '', fieldStyle: {height: 46}, ref: forwarded, onFocus: () => calls.push('focus'), onBlur: () => calls.push('blur')});
  const flatten = (s: any): any => Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : s ?? {};
  try {
    let input = elements(field.tree).find(n => n.type === NativeInput)!;
    const host = {focus() {calls.push('native-focus');}}; input.props.ref(host); assert.equal(forwarded.current, host); forwarded.current.focus();
    input.props.onFocus({}); field.host.rerender();
    input = elements(field.tree).find(n => n.type === NativeInput)!;
    const face = elements(field.tree).find(n => flatten(n.props.style).borderWidth === 2)!;
    assert.equal(flatten(face.props.style).borderColor, state.theme.colors.focus); assert.equal(flatten(face.props.style).backgroundColor, state.theme.colors.ink);
    assert.equal(flatten(input.props.style).minHeight, 42); assert.equal(elements(field.tree).filter(n => flatten(n.props.style).inset === -4).length, 0);
    input.props.onBlur({}); field.host.rerender(); assert.deepEqual(calls, ['native-focus', 'focus', 'blur']);
    field.update({appearance: 'selection', value: '', error: 'Actual error', editable: false, multiline: true, ref: forwarded});
    input = elements(field.tree).find(n => n.type === NativeInput)!; assert.equal(input.props.editable, false); assert.equal(input.props.multiline, true); assert.equal(input.props.accessibilityState.disabled, true); assert.match(text(field.tree), /Actual error/);
    field.update({value: ''}); input = elements(field.tree).find(n => n.type === NativeInput)!; input.props.onFocus({}); field.host.rerender(); assert.ok(elements(field.tree).some(n => flatten(n.props.style).inset === -4), 'default retains existing ring');
    state.theme = createTheme({isTV: true, width: 1920}); field.update({appearance: 'selection', value: ''}); assert.ok(elements(field.tree).some(n => flatten(n.props.style).inset === -4), 'TV retains existing ring');
  } finally {field.host.unmount(); state.theme = previous;}
  assert.equal(forwarded.current, null);
});

test('phone More uses real selected-kind/offer descriptions and cannot invent download facts or owner commands', () => {
  const previous = state.theme; state.theme = createTheme({isTV: false, width: 390}); const calls: unknown[] = [];
  const props: SelectionBarProps = {testID: 'actual.more', count: 2, selectionLabel: '2 tracks', selectAllLabel: 'All', onSelectAll() {}, onCancel() {}, onAction: id => calls.push(id), menu: 'more', onMenuChange: id => calls.push(id), actions: [{id: 'download'}, {id: 'edit', disabled: true, reason: 'Actual denial', description: 'Actual shared field information'}]};
  const bar = mount(SelectionBar, props);
  try {
    const node = elements(bar.tree).find(n => n.props.menu === 'more' && n.type !== SelectionBar)!; const menu = mount(node.type, node.props);
    try {
      assert.equal((menu.tree as Element).props.title, '2 tracks selected'); assert.ok(elements(menu.tree).filter(n => n.type === 'Stop').every(n => typeof n.props.offset === 'number' || /^\d+(?:\.\d+)?%?$/.test(n.props.offset)), 'native SVG stops must use supported numeric or percentage values'); let rows = ofType(menu.tree, SelectionActionRow); assert.equal(rows[0].props.description, undefined); assert.equal(rows[1].props.description, 'Actual denial');
      rows[1].props.onPress(); assert.deepEqual(calls, []); rows[0].props.onPress(); assert.deepEqual(calls, ['download', null]);
      menu.update({...node.props, actions: [{id: 'download', description: 'Actual 42 MB estimate at actual quality'}]}); rows = ofType(menu.tree, SelectionActionRow); assert.equal(rows.length, 1); assert.equal(rows[0].props.description, 'Actual 42 MB estimate at actual quality'); assert.doesNotMatch(text(menu.tree), /Owner/);
    } finally {menu.host.unmount();}
  } finally {bar.host.unmount(); state.theme = previous;}
});

test('phone destinations highlight only real focus state or supplied operation receipt', () => {
  const previous = state.theme; state.theme = createTheme({isTV: false, width: 390}); const calls: string[] = [];
  const props = {open: true, onOpenChange() {}, count: 1, selectionLabel: '1 movie', entries: [{id: 'actual', title: 'Actual destination', size: 2, canAdd: true}], query: '', onQueryChange() {}, creating: false, onCreatingChange() {}, name: '', onNameChange() {}, onCreateAndAdd() {}, onAdd: (id: string) => calls.push(id), onRetry() {}, onViewDestination() {}, onResultDismiss() {}};
  const wrapper = PlaylistPicker(props); const picker = mount(wrapper.type, wrapper.props);
  try {
    const list = elements(picker.tree).find(n => n.type === 'FlatList')!; const row = list.props.renderItem({item: props.entries[0]}) as Element;
    assert.equal(row.props.children({focused: false, hovered: false, pressed: false}).props.style[1].backgroundColor, 'transparent');
    assert.equal(row.props.children({focused: true, hovered: false, pressed: false}).props.style[1].backgroundColor, 'rgba(237,245,250,.06)'); assert.deepEqual(calls, []);
    row.props.onPress(); assert.deepEqual(calls, ['actual']);
    picker.update({...wrapper.props, result: {destination: props.entries[0], inserted: 0, failures: [{id:'failed', title:'Actual failed title', reason:'Actual reason'}], complete:true}});
    assert.match(text(picker.tree), /0 added/); assert.match(text(picker.tree), /Actual reason/);
  } finally {picker.host.unmount(); state.theme = previous;}
});

test('phone partial edit keeps only failed footer retry without narrowing reason into a duplicate control', () => {
  const previous = state.theme; state.theme = createTheme({isTV: false, width: 390}); const calls: unknown[] = [];
  const editor = mount(BulkEditor, bulk({result: {updated:1,failed:1,results:[{kind:'item',id:'a',ok:true},{kind:'item',id:'b',ok:false,code:'metadata_conflict'}]}, onRetry: ids => calls.push(ids)}));
  try {
    assert.equal(ofType(editor.tree, Button).filter(n => n.props.testID?.includes('result')).length, 0);
    const footer = (editor.tree as Element).props.footer; ofType(footer, Button).at(-1)!.props.onPress(); assert.deepEqual(calls, [['b']]); assert.match(text(editor.tree), /Someone else changed this title/);
  } finally {editor.host.unmount(); state.theme = previous;}
});

test('States link and inline recipes retain real actions and avoid inventing surrounding pages', () => {
  const previous = state.theme; state.theme = createTheme({isTV:false,width:390}); const calls: string[]=[];
  const layout=mount(StateLayout,{title:'Actual member state',detailsPresentation:'link',detailsAction:{id:'switch',label:'Switch server',icon:'i-server',onPress:()=>calls.push('switch')}});
  const inline=mount(StateView,{variant:'search',title:'Actual no matches',body:'Actual query explanation',icon:'i-clock'});
  try {
    const action=elements(layout.tree).find(n=>n.props.action?.id==='switch')!; assert.equal(action.props.action.trailingIcon,undefined); assert.equal(action.props.style.alignSelf,'center'); action.props.action.onPress(); assert.deepEqual(calls,['switch']);
    assert.equal(ofType(inline.tree,Icon).length,0); assert.match(text(inline.tree),/Actual query explanation/); assert.doesNotMatch(text(inline.tree),/Recent searches/);
  } finally {layout.host.unmount();inline.host.unmount();state.theme=previous;}
});

test('Selection keyboard layout reveals the actual native input above the measured footer and preserves default inset recipe', () => {
  const previous=state.theme, viewport=state.viewport; state.theme=createTheme({isTV:false,width:390}); state.viewport={width:390,height:844,scale:1,fontScale:1}; const calls:unknown[]=[];
  let inputTop=700;
  const input={measureInWindow(callback:any){callback(20,inputTop,350,42);}}; Object.assign(globalThis,{__porticoSelectionFocusedInput:input});
  const sheet=mount(BottomSheet,{open:true,onOpenChange(){},title:'Actual confirmation',children:null,footer:React.createElement('Button'),keyboardAvoiding:true,footerPadding:{top:10,bottom:30,keyboardBottom:12}});
  const flatten=(s:any):any=>Array.isArray(s)?Object.assign({},...s.map(flatten)):s??{};
  try {
    let scroll=elements(sheet.tree).find(n=>n.type==='ScrollView')!; scroll.props.ref.current={getNativeScrollRef:()=>({measureInWindow(callback:any){callback(0,140,390,404);}}),scrollTo:(value:unknown)=>calls.push(value)};
    scroll.props.onLayout({}); assert.deepEqual(calls,[]);
    const footer=elements(sheet.tree).find(n=>flatten(n.props.style).paddingTop===10 && n.props.onLayout)!; footer.props.onLayout({nativeEvent:{layout:{height:100}}});
    keyboardListeners.get('keyboardDidShow')!({endCoordinates:{screenY:544,height:300}}); sheet.host.rerender();
    scroll=elements(sheet.tree).find(n=>n.type==='ScrollView')!; scroll.props.onLayout({}); assert.deepEqual(calls,[{y:314,animated:true}], 'native input bottom742 must clear measured footer at444 plus16 breathing room');
    scroll.props.onScroll({nativeEvent:{contentOffset:{y:314}}}); inputTop=386; scroll.props.onLayout({}); assert.equal(calls.length,1,'already visible focus must not jump or lose its scroll position');
    inputTop=460; scroll.props.onLayout({}); assert.deepEqual(calls.at(-1),{y:388,animated:true},'a later resize adds only the newly obscured distance to actual native offset');
    assert.ok(elements(sheet.tree).some(n=>flatten(n.props.style).paddingBottom===12));
    keyboardListeners.get('keyboardDidHide')!(); sheet.host.rerender(); assert.ok(elements(sheet.tree).some(n=>flatten(n.props.style).paddingBottom===30));
  } finally {sheet.host.unmount(); state.theme=previous;state.viewport=viewport;Object.assign(globalThis,{__porticoSelectionFocusedInput:undefined});}
});


test('phone deletion receipt fitted height keeps the measured notice above its fixed footer', () => {
  const previousTheme = state.theme, previousViewport = state.viewport;
  state.theme = createTheme({isTV: false, width: 390, reduceMotion: true});
  state.viewport = {width: 390, height: 844, scale: 1, fontScale: 1};
  const calls: string[] = [];
  const props: DeleteMediaDialogProps = {testID: 'phone.receipt.geometry', open: true, onOpenChange() {calls.push('close');}, ownerHeader: null, owner: true,
    selectionCount: 4, preview: null, confirmation: '', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete() {calls.push('delete');},
    result: {revision: 2, removed: 3, failed: 1, bytesDeleted: 0, filesRetained: true, receipts: [{itemId: 'kept', title: 'Actual kept title', removed: false, filesDeleted: 0, filesKept: 1, bytes: 0, code: 'file_not_removed'}]}};
  const dialog = mount(DeleteMediaDialog, props);
  const surface = mount(SelectionSurface, (dialog.tree as Element).props);
  const sheet = mount(BottomSheet, (surface.tree as Element).props);
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  const panel = () => elements(sheet.tree).find(n => n.props.testID === props.testID)!;
  const scroll = () => ofType(sheet.tree, 'ScrollView')[0]!;
  const header = () => ofType(sheet.tree, 'GestureDetector')[0]!.props.children;
  const footer = () => elements(sheet.tree).find(n => n.props.onLayout && flatten(n.props.style).position === 'absolute' && flatten(n.props.style).borderTopColor)!;
  // Retained Android native measurements: header86, receipt125, footer87.
  // Exercise real measurement callbacks and evaluate rendered viewport geometry;
  // do not calculate the component's expected natural-height formula.
  const measure = (footerHeight: number) => {
    header().props.onLayout({nativeEvent: {layout: {height: 86}}});
    footer().props.onLayout({nativeEvent: {layout: {height: footerHeight}}}); sheet.host.rerender();
    scroll().props.onContentSizeChange(350, 125 + flatten(scroll().props.contentContainerStyle).paddingBottom); sheet.host.rerender();
  };
  const clearance = (viewportBottom: number, footerHeight: number) => {
    const style = flatten(panel().props.style);
    const receiptBottom = viewportBottom - style.height + style.borderTopWidth + style.paddingTop + 86 + 125;
    return viewportBottom - footerHeight - receiptBottom;
  };
  try {
    const actualSurface = dialog.tree as Element, close = ofType(actualSurface.props.footer, Button)[0]!;
    assert.deepEqual(actualSurface.props.footerPadding, {top: 0, bottom: 34, keyboardBottom: 12});
    assert.equal(actualSurface.props.showFooterSeparator, false);
    assert.equal(flatten(footer().props.style).borderTopWidth, 0, 'the phone deletion frame has no divider above its actions');
    assert.equal(actualSurface.props.initialFocusRef, close.props.ref);
    assert.equal(nativeControlID(close), controlID(props.testID, 'dismiss'));
    assert.match(text(dialog.tree), /Actual kept title/); assert.match(text(dialog.tree), /Kept, because/);
    assert.equal(scroll().props.focusable, undefined, 'native scrolling/focus must not be disabled to hide backing');
    measure(87);
    assert.equal(clearance(844, 87), 16, 'complete notice must clear the measured fixed footer by16px');
    keyboardListeners.get('keyboardDidShow')!({endCoordinates: {screenY: 589, height: 255}}); sheet.host.rerender(); measure(58);
    assert.equal(clearance(589, 58), 16, 'fitted content and footer retain the same clearance above actual IME coordinates');
    assert.equal(elements(sheet.tree).find(n => n.props.testID === `${props.testID}-keyboard-boundary`)!.props.accessibilityViewIsModal, true);
    assert.deepEqual(calls, [], 'geometry measurement must not invoke any dialog operation');
  } finally {sheet.host.unmount(); surface.host.unmount(); dialog.host.unmount(); state.theme = previousTheme; state.viewport = previousViewport;}
});

test('phone Delete applies its authored context gap and text flow without changing other Selection footer recipes', () => {
  const previous = state.theme;
  const ownerHeader = React.createElement('View', {testID: 'actual.owner.context'});
  const props: DeleteMediaDialogProps = {open: true, onOpenChange() {}, ownerHeader, owner: true, selectionCount: 1,
    preview: {revision: 7, confirmation: 'Actual title', confirmationKind: 'title', totalBytes: 0, totalFiles: 1, totalBytesText: '0 B', blocked: [], targets: [{itemId: 'a', title: 'Actual title', kind: 'movie', libraryId: 'one', libraryName: 'Actual library', allowMediaDeletion: true, titles: 1, bytes: 0, files: [], dependents: []}]},
    confirmation: '', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete() {}};
  try {
    for (const [isTV, width] of [[false, 390], [false, 820], [true, 1920]] as const) {
      state.theme = createTheme({isTV, width, textScale: 1.2});
      const phone = width === 390;
      const dialog = mount(DeleteMediaDialog, props);
      const ordinary = mount(SelectionSurface, {open: true, onOpenChange() {}, title: 'Actual selection surface', children: null});
      const surface = mount(SelectionSurface, (dialog.tree as Element).props);
      try {
        const deletion = dialog.tree as Element, sheet = surface.tree as Element;
        assert.deepEqual((ordinary.tree as Element).props.footerPadding, isTV ? undefined : {top: 10, bottom: 30, keyboardBottom: 12});
        assert.equal((ordinary.tree as Element).props.showFooterSeparator, undefined, 'ordinary Selection retains the BottomSheet divider default');
        assert.deepEqual(sheet.props.footerPadding, phone ? {top: 0, bottom: 34, keyboardBottom: 12} : isTV ? undefined : {top: 10, bottom: 30, keyboardBottom: 12});
        assert.equal(sheet.props.showFooterSeparator, phone ? false : undefined);
        if (phone) {
          assert.equal(deletion.props.headerContext.props.style.paddingBottom, 10);
          assert.equal(deletion.props.headerContext.props.children, ownerHeader, 'the actual caller-owned identity remains intact');
          assert.equal(deletion.props.titleTextStyle.includeFontPadding, false);
        } else assert.equal(deletion.props.headerContext, ownerHeader);
        const facts = ofType(dialog.tree, SelectionText).find(node => text(node).includes('0 B'))!;
        const copy = mount(SelectionText, facts.props);
        try {
          assert.equal((copy.tree as Element).props.style[0].fontFamily, fontFamilies[phone ? 400 : 500]);
          assert.equal(facts.props.style.lineHeight, isTV ? undefined : phone ? 25.2 : 21);
          if (phone) assert.equal(facts.props.style.color, state.theme.colors.textSecondary);
          assert.equal(ofType(facts, SelectionText)[1].props.weight, 700, 'actual file facts retain their drawn emphasis');
        } finally {copy.host.unmount();}
        if (phone) {
          const help = ofType(dialog.tree, SelectionText).find(node => text(node).startsWith('The files are deleted'))!;
          assert.equal(help.props.weight, 400); assert.equal(help.props.style.lineHeight, 18 * state.theme.textScale);
        }
      } finally {surface.host.unmount(); ordinary.host.unmount(); dialog.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('fitted footer accounting preserves no-footer, explicit detent, long-content and side-panel behavior', () => {
  const previousTheme = state.theme, previousViewport = state.viewport;
  state.viewport = {width: 390, height: 844, scale: 1, fontScale: 1};
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  try {
    for (const options of [{fitContent: true}, {fitContent: false, detents: [500]}, {fitContent: true, long: true}, {fitContent: true, side: 'tv'}, {fitContent: true, side: 'tablet'}]) {
      state.theme = createTheme({isTV: options.side === 'tv', width: options.side === 'tv' ? 1920 : options.side ? 820 : 390, reduceMotion: true});
      const props = {testID: 'accounting.regression', open: true, onOpenChange() {}, title: 'Actual content', children: null, showClose: false,
        fitContent: options.fitContent, detents: options.detents, footer: options.detents || options.long || options.side ? React.createElement('Button') : undefined};
      const sheet = mount(BottomSheet, props);
      try {
        const scroll = () => ofType(sheet.tree, 'ScrollView')[0]!;
        if (!options.side) ofType(sheet.tree, 'GestureDetector')[0]!.props.children.props.onLayout({nativeEvent: {layout: {height: 86}}});
        const footer = elements(sheet.tree).find(n => n.props.onLayout && flatten(n.props.style).position === 'absolute' && flatten(n.props.style).borderTopColor);
        footer?.props.onLayout({nativeEvent: {layout: {height: 87}}}); sheet.host.rerender();
        scroll().props.onContentSizeChange(350, (options.long ? 1200 : 125) + flatten(scroll().props.contentContainerStyle).paddingBottom); sheet.host.rerender();
        if (options.side) {
          const side = elements(sheet.tree).find(n => flatten(n.props.style).width === (options.side === 'tv' ? 640 : 440))!;
          assert.equal(flatten(side.props.style).top, 0); assert.equal(flatten(side.props.style).bottom, 0);
          assert.equal(ofType(sheet.tree, FocusBoundary)[0]!.props.modal, true);
        } else {
          const style = flatten(elements(sheet.tree).find(n => n.props.testID === props.testID)!.props.style);
          assert.equal(style.height, options.long ? 820 : options.detents ? 500 : 219);
          if (options.long) assert.ok(flatten(scroll().props.contentContainerStyle).paddingBottom >= 87 + 16, 'clipped long content keeps its scrollable footer clearance');
        }
      } finally {sheet.host.unmount();}
    }
  } finally {state.theme = previousTheme; state.viewport = previousViewport;}
});

const flattenStyle = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : style ?? {};

test('SidePanel can omit its standard close action while retaining supplied content, geometry and escape', () => {
  const previousTheme = state.theme;
  state.theme = createTheme({isTV: true, width: 1920});
  const calls: unknown[] = [];
  const context = React.createElement('View', {testID: 'actual-context'});
  const children = React.createElement('View', {testID: 'actual-rows'});
  const footer = React.createElement('View', {testID: 'actual-footer'});
  const props = {open: true, title: 'Actual customization', headerContext: context, children, footer, width: 860, topInset: 0,
    initialFocusRef: {current: null}, returnFocusRef: {current: null}, onOpenChange: (...args: unknown[]) => calls.push(args), testID: 'actual-side'};
  const panel = mount(SidePanel, props);
  try {
    const heading = () => ofType(panel.tree, SurfaceHeader)[0]!;
    assert.equal((heading().props.action as Element).type, Button);
    panel.update({...props, showClose: false});
    assert.equal(heading().props.action, undefined);
    assert.equal((panel.tree as Element).props.rect.width, 860);
    assert.equal((panel.tree as Element).props.rect.y, 0);
    assert.equal((panel.tree as Element).props.onOutsidePress, undefined);
    assert.equal(ofType(panel.tree, FocusBoundary)[0]!.props.modal, true);
    for (const node of [context, children, footer]) assert.ok(elements(panel.tree).includes(node));
    const host = () => elements(panel.tree).find(element => element.props.testID === props.testID)!;
    host().props.onAccessibilityEscape();
    assert.deepEqual(calls, [[false, 'escape']]);
    panel.update({...props, showClose: false, dismissOnBack: false});
    host().props.onAccessibilityEscape();
    assert.equal(calls.length, 1);
    panel.update(props);
    (heading().props.action as Element).props.onPress();
    assert.deepEqual(calls.at(-1), [false, 'close-button']);
  } finally {panel.host.unmount(); state.theme = previousTheme;}
});

test('a supplied BottomSheet heading replaces the standard row while retaining context and measured sheet anatomy', () => {
  const previousTheme = state.theme;
  const context = React.createElement('View', {testID: 'actual-owner-context'});
  const custom = React.createElement('View', {testID: 'actual-member-header'});
  const props = {open: true, title: 'Actual member', description: 'Actual kind and year', onOpenChange() {}, headerContext: context, children: React.createElement('View', {testID: 'actual-menu-rows'}), fitContent: true, testID: 'actual-sheet'};
  try {
    for (const screen of [{isTV: false, width: 390}, {isTV: false, width: 900}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(screen);
      const sheet = mount(BottomSheet, props);
      try {
        assert.equal(ofType(sheet.tree, SurfaceHeader).length, 1);
        sheet.update({...props, headerContent: custom});
        assert.equal(ofType(sheet.tree, SurfaceHeader).length, 0);
        assert.equal(elements(sheet.tree).filter(element => element === custom).length, 1);
        assert.equal(elements(sheet.tree).filter(element => element === context).length, 1);
        assert.ok(ofType(sheet.tree, 'ScrollView').length);
        if (state.theme.platform === 'phone') {
          const header = ofType(sheet.tree, 'GestureDetector')[0]!.props.children;
          assert.equal(typeof header.props.onLayout, 'function');
          header.props.onLayout({nativeEvent: {layout: {height: 110}}});
          sheet.host.rerender();
          const grabber = elements(header).find(element => element.props.accessibilityRole === 'adjustable')!;
          assert.ok(grabber.props.accessibilityActions.some((action: {name: string}) => action.name === 'dismiss'));
        } else assert.equal(ofType(sheet.tree, FocusBoundary)[0]!.props.modal, true);
        sheet.update({...props, headerContent: null});
        assert.equal(ofType(sheet.tree, SurfaceHeader).length, 0);
        sheet.update(props);
        assert.equal(ofType(sheet.tree, SurfaceHeader).length, 1);
      } finally {sheet.host.unmount();}
    }
  } finally {state.theme = previousTheme;}
});

test('a BottomSheet composition can opt into its backdrop alpha without changing dismissal', () => {
  const previousTheme = state.theme;
  try {
    for (const screen of [{isTV: false, width: 390}, {isTV: false, width: 1024}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(screen);
      const calls: unknown[] = [];
      const props = {open: true, title: 'Actual menu', children: null, onOpenChange: (...args: unknown[]) => calls.push(args)};
      const sheet = mount(BottomSheet, props);
      try {
        const scrim = () => elements(sheet.tree).find(element => element.props.pointerEvents === 'none' && flattenStyle(element.props.style).backgroundColor)!;
        const color = state.theme.isTV ? state.theme.colors.ink : '#03080c';
        assert.equal(flattenStyle(scrim().props.style).backgroundColor, `${color}a3`);
        sheet.update({...props, backdropOpacity: 0.58});
        assert.equal(flattenStyle(scrim().props.style).backgroundColor, `${color}94`);
        const outside = elements(sheet.tree).find(element => element.props.onResponderRelease)!;
        assert.equal(outside.props.accessible, false);
        outside.props.onResponderRelease();
        (sheet.tree as Element).props.onRequestClose();
        assert.deepEqual(calls, [[false, 'outside'], [false, 'back']]);
        sheet.update(props);
        assert.equal(flattenStyle(scrim().props.style).backgroundColor, `${color}a3`);
      } finally {sheet.host.unmount();}
    }
  } finally {state.theme = previousTheme;}
});

function withNativeControl(element: Element, inspect: (host: Element) => void) {
  const mounted: ReturnType<typeof mount>[] = [];
  try {
    let current = element;
    while (typeof current.type !== 'string') {
      const instance = mount(current.type, current.props); mounted.push(instance); current = instance.tree as Element;
    }
    assert.equal(current.type, 'Pressable');
    inspect(current);
  } finally {for (const instance of mounted.reverse()) instance.host.unmount();}
}

test('Selection footer recipes reach actual buttons without changing other size classes or losing identity', () => {
  const previous = state.theme;
  try {
    for (const options of [{isTV: false, width: 390, textScale: 1.25}, {isTV: false, width: 820}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      const instances: ReturnType<typeof mount>[] = [];
      try {
        instances.push(mount(BulkEditor, bulk({testID: 'footer.bulk'})));
        instances.push(mount(DeleteMediaDialog, {testID: 'footer.delete', open: true, onOpenChange() {}, ownerHeader: null, owner: true, selectionCount: 1, preview: null, confirmation: '', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete() {}}));
        instances.push(mount(MixedEditExplainer, {testID: 'footer.mixed', open: true, onOpenChange() {}, total: 0, groups: [], description: 'Actual explanation', onKeepOnly() {}}));
        const wrapper = mount(PlaylistPicker, {testID: 'footer.picker', open: true, onOpenChange() {}, count: 1, selectionLabel: 'Actual selection', entries: [], creating: true, onCreatingChange() {}, name: '', onNameChange() {}, onCreateAndAdd() {}, onAdd() {}, query: '', onQueryChange() {}, onRetry() {}, onViewDestination() {}, onResultDismiss() {}});
        instances.push(wrapper, mount((wrapper.tree as Element).type, (wrapper.tree as Element).props));
        const phone = state.theme.platform === 'phone', tv = state.theme.isTV;
        for (const instance of instances.filter(item => item !== wrapper)) {
          const surface = ofType(instance.tree, SelectionSurface)[0]!;
          for (const button of ofType(surface.props.footer, Button)) withNativeControl(button, host => {
            const style = flattenStyle(host.props.style({pressed: false}));
            assert.equal(host.props.testID, button.props.testID);
            assert.equal(host.props.accessibilityRole, 'button');
            assert.equal(!!host.props.disabled, !!button.props.disabled || !!button.props.loading);
            assert.equal(style.height, phone ? 48 : tv ? 64 : 46);
            assert.equal(style.paddingHorizontal, phone ? 20 : 26);
            assert.equal(style.borderRadius, phone ? 10 : tv ? 14 : 12);
            const content = host.props.children({pressed: false});
            const label = ofType(content, 'Text')[0]!;
            assert.equal(flattenStyle(label.props.style).fontSize, (phone ? 15.5 : tv ? 22 : 15) * state.theme.textScale);
            assert.equal(text(label), text(button.props.children));
          });
        }
      } finally {for (const instance of instances.reverse()) instance.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('phone receipt rows stay contiguous while retaining every outcome and the failed-only retry', () => {
  const previous = state.theme;
  try {
    for (const options of [{isTV: false, width: 390}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      const calls: unknown[] = [];
      const editor = mount(BulkEditor, bulk({result: {updated: 1, failed: 1, results: [{kind: 'item', id: 'a', ok: true}, {kind: 'item', id: 'b', ok: false, code: 'metadata_conflict'}]}, onRetry: ids => calls.push(ids)}));
      try {
        const rows = elements(editor.tree).find(node => Array.isArray(node.props.children) && node.props.children.length === 2 && node.props.children.every((child: any) => React.isValidElement<Record<string, any>>(child) && flattenStyle(child.props.style).paddingVertical === 9))!;
        assert.ok(rows);
        assert.equal(flattenStyle(rows.props.style).gap, state.theme.isTV ? 6 : 0);
        assert.match(text(rows), /Actual saved title/); assert.match(text(rows), /Actual failed title/);
        assert.match(text(rows), /Someone else changed this title/);
        ofType((editor.tree as Element).props.footer, Button).at(-1)!.props.onPress();
        assert.deepEqual(calls, [['b']]);
      } finally {editor.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('phone Delete separates full-width helper copy while preserving the real switch and confirmation gate', () => {
  const previous = state.theme; state.theme = createTheme({isTV: false, width: 390});
  const calls: unknown[] = [];
  const preview = {revision: 7, confirmation: 'Actual title', confirmationKind: 'title' as const, totalBytes: 0, totalFiles: 1, totalBytesText: '0 B', blocked: [], targets: [{itemId: 'a', title: 'Actual title', kind: 'movie', libraryId: 'one', libraryName: 'Actual library', allowMediaDeletion: true, titles: 1, bytes: 0, files: [], dependents: []}]};
  const props: DeleteMediaDialogProps = {testID: 'phone.delete.helper', open: true, onOpenChange() {}, ownerHeader: null, owner: true, selectionCount: 1, preview, confirmation: '', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange: value => calls.push(value), onDelete: (...args) => calls.push(args)};
  const dialog = mount(DeleteMediaDialog, props);
  try {
    const toggle = ofType(dialog.tree, Switch)[0]!;
    assert.equal(toggle.props.description, undefined);
    const help = ofType(dialog.tree, SelectionText).find(node => node.props.size === 12 && text(node) === toggle.props.accessibilityHint)!;
    assert.ok(help, 'helper remains outside the switch copy column');
    assert.equal(toggle.props.accessibilityLabel, text(toggle.props.children));
    assert.equal(toggle.props.style.minHeight, 26); assert.equal(toggle.props.style.paddingVertical, 0);
    assert.equal(flattenStyle((dialog.tree as Element).props.footer.props.style).paddingHorizontal, 4);
    const control = mount(Switch, toggle.props);
    try {withNativeControl(control.tree as Element, host => {
      assert.equal(host.props.testID, controlID(props.testID, 'remove-files'));
      assert.equal(host.props.accessibilityRole, 'switch');
      assert.equal(host.props.accessibilityState.checked, true);
      assert.equal(host.props.accessibilityHint, text(help));
      host.props.onPress({});
    });} finally {control.host.unmount();}
    assert.deepEqual(calls, [false]);
    let remove = ofType((dialog.tree as Element).props.footer, Button).at(-1)!;
    assert.equal(remove.props.disabled, true); remove.props.onPress(); assert.deepEqual(calls, [false]);
    dialog.update({...props, confirmation: preview.confirmation, removeFiles: false});
    assert.match(text(dialog.tree), /The next scan finds the files again/);
    remove = ofType((dialog.tree as Element).props.footer, Button).at(-1)!;
    assert.equal(remove.props.disabled, false); remove.props.onPress(); assert.deepEqual(calls, [false, [preview, preview.confirmation, false]]);
    dialog.update({...props, pending: true}); assert.equal(ofType(dialog.tree, Switch)[0]!.props.disabled, true);
    dialog.update({...props, owner: false}); assert.equal(dialog.tree, null);
  } finally {dialog.host.unmount(); state.theme = previous;}
});

test('phone multi-delete shows the drawn aggregate while retaining the complete preview and real count gate', () => {
  const previous = state.theme;
  const targets = Array.from({length: 6}, (_, index) => ({itemId: `actual-${index}`, title: `Actual target ${index}`, kind: 'movie', libraryId: 'one', libraryName: 'Actual library', allowMediaDeletion: true, titles: 1, bytes: 1024, files: [], dependents: [{kind: 'playlist', count: 2, description: 'playlist entries'}, {kind: 'progress', count: 1, description: 'saved places'}]}));
  const preview: NonNullable<DeleteMediaDialogProps['preview']> = {revision: 7, confirmation: '6', confirmationKind: 'count', totalBytes: 6144, totalFiles: 6, totalBytesText: '6 KB', blocked: [], targets};
  try {
    for (const options of [{isTV: false, width: 390}, {isTV: false, width: 820}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      const phone = state.theme.platform === 'phone', calls: unknown[] = [];
      const props: DeleteMediaDialogProps = {open: true, onOpenChange() {}, ownerHeader: null, owner: true, selectionCount: 6, preview, confirmation: '5', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete: (...args) => calls.push(args), renderArtwork: id => `Artwork ${id}`};
      const dialog = mount(DeleteMediaDialog, props);
      try {
        const content = text(dialog.tree);
        assert.match(content, /6 files, 6 KB\./);
        if (phone) {
          assert.match(content, /Playlist and collection entries and saved places go too\./);
          assert.doesNotMatch(content, /Actual target|Artwork actual-|12 playlists/);
        } else {
          assert.match(content, /Actual target 0/);
          assert.match(content, /Actual target 4/);
          assert.doesNotMatch(content, /Actual target 5/);
          assert.match(content, /and 1 more/);
          assert.match(content, /12 playlists/);
        }
        let remove = ofType((dialog.tree as Element).props.footer, Button).at(-1)!;
        assert.equal(remove.props.disabled, true); remove.props.onPress(); assert.deepEqual(calls, []);
        dialog.update({...props, confirmation: preview.confirmation});
        remove = ofType((dialog.tree as Element).props.footer, Button).at(-1)!;
        assert.equal(remove.props.disabled, false); remove.props.onPress();
        assert.deepEqual(calls, [[preview, '6', true]], 'complete preview and all targets reach the existing guarded mutation');
        if (phone) {
          const other = {...preview, targets: [{...targets[0]!, dependents: [{kind: 'library-channel', count: 2, description: 'scheduled library channel slots'}]}, targets[1]!]};
          dialog.update({...props, preview: other});
          assert.match(text(dialog.tree), /2 scheduled library channel slots/);
          assert.doesNotMatch(text(dialog.tree), /Playlist and collection entries and saved places go too/);
        }
      } finally {dialog.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('phone Delete result keeps the drawn warning insets and type while preserving receipts and close focus', () => {
  const previous = state.theme;
  try {
    for (const options of [{isTV: false, width: 390, textScale: 1.25}, {isTV: false, width: 820}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      const calls: unknown[] = [];
      const props: DeleteMediaDialogProps = {open: true, onOpenChange: (...args) => calls.push(args), ownerHeader: null, owner: true, selectionCount: 2, preview: null,
        result: {revision: 7, removed: 1, failed: 1, bytesDeleted: 0, filesRetained: true, receipts: [{itemId: 'removed', title: 'Actual removed title', removed: true, filesDeleted: 1, filesKept: 0, bytes: 0, code: ''}, {itemId: 'kept', title: 'Actual kept title', removed: false, filesDeleted: 0, filesKept: 1, bytes: 0, code: 'file_not_removed'}]},
        confirmation: '', onConfirmationChange() {}, removeFiles: true, onRemoveFilesChange() {}, onDelete: () => calls.push('delete')};
      const dialog = mount(DeleteMediaDialog, props);
      try {
        const surface = dialog.tree as Element, phone = state.theme.platform === 'phone';
        const warning = elements(surface).find(node => node.key === 'kept')!;
        assert.ok(warning); assert.equal(elements(surface).some(node => node.key === 'removed'), false);
        const box = flattenStyle(warning.props.style);
        assert.equal(box.borderWidth, 1); assert.equal(box.gap, 10);
        assert.equal(box.paddingVertical ?? box.padding, phone ? 10 : 12);
        assert.equal(box.paddingHorizontal ?? box.padding, phone ? 11 : 12);
        const copy = elements(warning).find(node => flattenStyle(node.props.style).flex === 1)!;
        assert.equal(flattenStyle(copy.props.style).gap, phone ? 0 : 3);
        const [title, helper] = ofType(warning, SelectionText);
        assert.equal(text(title), 'Actual kept title'); assert.match(text(helper), /Kept, because the file could not be deleted/);
        const titleHost = mount(SelectionText, title!.props), helperHost = mount(SelectionText, helper!.props);
        try {
          const titleStyle = flattenStyle((titleHost.tree as Element).props.style), helperStyle = flattenStyle((helperHost.tree as Element).props.style);
          assert.equal(titleStyle.lineHeight, phone ? 20.3 * state.theme.textScale : undefined);
          assert.equal(helperStyle.lineHeight, phone ? 19.575 * state.theme.textScale : state.theme.isTV ? 29 : 19.575);
          assert.equal(helperStyle.color, phone ? state.theme.colors.textSecondary : state.theme.colors.textTertiary);
        } finally {helperHost.host.unmount(); titleHost.host.unmount();}
        const close = ofType(surface.props.footer, Button);
        assert.equal(close.length, 1); assert.equal(close[0]!.props.ref, surface.props.initialFocusRef);
        assert.equal(ofType(surface, Switch).length, 0); assert.equal(ofType(surface, TextField).length, 0);
        close[0]!.props.onPress(); assert.deepEqual(calls, [[false, 'action']]);
      } finally {dialog.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('phone Search uses the pinned heading and helper line boxes without changing other StateView recipes', () => {
  const previous = state.theme;
  try {
    for (const options of [{isTV: false, width: 390, textScale: 1.25}, {isTV: false, width: 820}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      const view = mount(StateView, {variant: 'search', title: 'Actual no matches', body: 'Actual query explanation', icon: 'i-clock'});
      try {
        const [title, body] = ofType(view.tree, 'Text'), phone = state.theme.platform === 'phone', tv = state.theme.isTV, scale = state.theme.textScale;
        const heading = flattenStyle(title!.props.style), helper = flattenStyle(body!.props.style);
        assert.equal(heading.fontSize, (phone ? 24 : tv ? 44 : 22) * scale);
        assert.ok(Math.abs(heading.lineHeight - (phone ? 27.6 : tv ? 47.52 : 26.4) * scale) < .0001);
        assert.equal(helper.fontSize, (phone ? 14.5 : tv ? 24 : 14) * scale);
        if (phone) {
          assert.equal(helper.lineHeight, 21.75 * scale); assert.equal(helper.marginBottom, 0);
          assert.equal(heading.includeFontPadding, false); assert.equal(helper.includeFontPadding, false);
          assert.equal(heading.marginBottom, 6); assert.equal(heading.textAlign, 'left');
        } else {assert.equal(heading.includeFontPadding, undefined); assert.equal(helper.includeFontPadding, undefined);}
        assert.match(text(view.tree), /Actual no matches/); assert.match(text(view.tree), /Actual query explanation/);
        assert.equal(ofType(view.tree, Icon).length, tv ? 1 : 0);
      } finally {view.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('partial picker receipts show the actual count without an undrawn check and retry only failures', () => {
  const previous = state.theme;
  try {
    for (const options of [{isTV: false, width: 390}, {isTV: false, width: 820}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      const calls: unknown[] = [];
      const props = {open: true, onOpenChange: (...args: unknown[]) => calls.push(args), count: 4, selectionLabel: 'Actual selection', entries: [], creating: false, onCreatingChange() {}, name: '', onNameChange() {}, onCreateAndAdd() {}, onAdd: () => calls.push('add'), query: '', onQueryChange() {},
        result: {destination: {id: 'actual-playlist', title: 'Actual playlist', size: 15}, inserted: 3, failed: 1, total: 4, failures: [{id: 'actual-failure', title: 'Actual failed title'}], complete: true},
        onRetry: (ids: readonly string[]) => calls.push(ids), onViewDestination() {}, onResultDismiss() {}};
      const wrapper = mount(PlaylistPicker, props);
      const picker = mount((wrapper.tree as Element).type, (wrapper.tree as Element).props);
      try {
        const surface = ofType(picker.tree, SelectionSurface)[0]!;
        assert.match(text(surface), /Actual playlist/); assert.match(text(surface), /15 titles/);
        assert.ok(ofType(surface, SelectionText).some(node => text(node) === '3 added'));
        assert.equal(ofType(surface, Icon).filter(node => node.props.name === 'i-check').length, 0);
        assert.equal(ofType(surface, Icon).filter(node => node.props.name === 'i-warn').length, 1);
        const retry = ofType(surface.props.footer, Button).at(-1)!;
        assert.equal(surface.props.initialFocusRef, retry.props.ref);
        retry.props.onPress(); assert.deepEqual(calls, [['actual-failure']]);
        ofType(surface.props.footer, Button)[0]!.props.onPress();
        assert.deepEqual(calls, [['actual-failure'], [false, 'action']]);
      } finally {picker.host.unmount(); wrapper.host.unmount();}
    }
  } finally {state.theme = previous;}
});

test('drawn list-field prompts use singular catalogue copy and retain real validated edits', () => {
  const previous = state.theme;
  try {
    for (const options of [{isTV: false, width: 390}, {isTV: false, width: 820}, {isTV: true, width: 1920}]) {
      state.theme = createTheme(options);
      for (const fieldName of ['genres', 'tags', 'labels']) for (const empty of [false, true]) {
        const calls: unknown[] = [];
        const field = {field: fieldName, label: fieldName, group: 'general' as const, type: 'list' as const, maxLength: 128, max: 64, bulk: true};
        const editor = mount(BulkEditor, bulk({schema: [field], values: {[fieldName]: {state: 'mixed', distinctCount: empty ? 0 : 1, truncated: false, values: [], entries: empty ? [] : [{value: 'Existing', count: 4}]}}, changes: {}, onChangesChange: changes => calls.push(changes)}));
        const listNode = elements(editor.tree).find(node => node.props.field?.field === fieldName)!;
        const list = mount(listNode.type, listNode.props);
        try {
          const input = ofType(list.tree, TextField)[0]!;
          const expected = fieldName === 'genres' ? 'Add a genre' : fieldName === 'tags' ? empty ? 'None yet. Add a tag' : 'Add a tag' : empty ? 'None yet. Add a label' : 'Add a label';
          assert.equal(input.props.placeholder, expected); assert.equal(input.props.accessibilityLabel, expected);
          input.props.onChangeText('Fresh');
          list.host.rerender();
          ofType(list.tree, TextField)[0]!.props.onSubmitEditing();
          assert.deepEqual(calls, [{[fieldName]: {add: ['Fresh'], remove: []}}]);
        } finally {list.host.unmount(); editor.host.unmount();}
      }
    }
  } finally {state.theme = previous;}
});
