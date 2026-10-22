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
const state = {theme: createTheme({isTV: true, width: 1920}), fontFamilies, nativeType};
const stateKey = '__porticoSelectionRenderTest';
Object.assign(globalThis, {[stateKey]: state});
const moduleURL = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const nativeStub = new URL('./react-native-stub.mjs', import.meta.url).href;
const native = moduleURL(`export * from ${JSON.stringify(nativeStub)};
  export const Platform={OS:'android',isTV:true};
  export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable',Modal='Modal',ScrollView='ScrollView',FlatList='FlatList',TVFocusGuideView='TVFocusGuideView',ActivityIndicator='ActivityIndicator';
  export const BackHandler={addEventListener:()=>({remove(){}})};
  export const useWindowDimensions=()=>({width:1920,height:1080,scale:1,fontScale:1});
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
const {selectionControlID: controlID} = await import('../src-next/kit/selection/focus-ids.ts');
const {PlaylistPicker} = await import('../src-next/kit/selection/Picker.tsx');
const {BulkEditor} = await import('../src-next/kit/selection/BulkEditor.tsx');
const {DeleteMediaDialog} = await import('../src-next/kit/selection/DeleteMediaDialog.tsx');
const {MixedEditExplainer} = await import('../src-next/kit/selection/MixedEditExplainer.tsx');
const {SelectionBar} = await import('../src-next/kit/selection/SelectionBar.tsx');
const {SelectionSurface, SelectionText} = await import('../src-next/kit/selection/surface.tsx');
const {BottomSheet} = await import('../src-next/kit/overlays/BottomSheet.tsx');
const {Dialog, FocusBoundary} = await import('../src-next/kit/overlays/surface.tsx');
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
        const nativeInput = elements(control.tree).find(element => element.type === 'TextInput')!;
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
    assert.match(text(surface), /Changed while you were editing/);
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
      const shared = mount(Menu, (menu.tree as Element).props);
      try {assert.deepEqual(ofType(shared.tree, MenuRow).map(nativeControlID), ['playNext', 'playLater'].map(action => `${controlID(prefix, 'menu', 'queue')}-item-${action}`));} finally {shared.host.unmount();}
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
    try {assert.equal(elements(input.tree).find(element => element.type === 'TextInput')!.props.testID, controlID(prefix, 'find'));} finally {input.host.unmount();}
    picker.update({...props, kind: 'playlist', entries: [...props.entries].reverse().map(entry => ({...entry, title: 'Translated'}))});
    assert.deepEqual(rowIDs().map((entry: {id: string}) => entry.id), rows.map((entry: {id: string}) => entry.id).reverse());
    picker.update({...props, kind: 'playlist', creating: true});
    const name = mount(TextField, ofType(picker.tree, TextField)[0]!.props);
    try {assert.equal(elements(name.tree).find(element => element.type === 'TextInput')!.props.testID, controlID(prefix, 'name'));} finally {name.host.unmount();}
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
      try {assert.equal(elements(input.tree).find(element => element.type === 'TextInput')!.props.testID, controlID(prefix, 'field', 'year', 'input'));} finally {input.host.unmount();}
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
