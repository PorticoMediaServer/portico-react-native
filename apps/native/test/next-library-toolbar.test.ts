import test from 'node:test';
import assert from 'node:assert/strict';
import {createTheme} from '../src-next/kit/theme.ts';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

type Element = {type: unknown; props: Record<string, any>};
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === 'object' && 'props' in node ? [node, ...elements(node.props.children)] : [];
}
async function fixture(width: number, isTV = false) {
  const host = hooks(), calls: unknown[] = [], theme = createTheme({width, isTV});
  const {LibraryToolbar} = await screenModule(new URL('../src-next/screens/library/LibraryToolbar.tsx', import.meta.url), {
    react: host.react, 'react-native': {View: 'View', ScrollView: 'ScrollView', useWindowDimensions: () => ({width})},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (id: string) => id}},
    '../../kit/controls': {Button: 'Button', Chip: 'Chip'}, '../../kit/focus': {FocusItem: 'FocusItem'},
    '../../kit/browse': {FiltersButton: 'FiltersButton', QuickToggle: 'QuickToggle', SaveViewButton: 'SaveViewButton'},
    '../../kit/theme': {useTheme: () => theme}, './LibrarySortMenu': {LibrarySortMenu: 'LibrarySortMenu'},
  });
  const start = () => calls.push('actual-library-context');
  const props = {model: {sorts: [], sort: {field: 'title', direction: 'asc'}, quick: []}, labels: {}, filterCount: 1, filtersOpen: true,
    onFilters: () => calls.push('filters'), onSort: () => {}, onReshuffle: () => {}, onQuick: () => {}, onSave: () => {},
    onJump: () => {}, jumpEnabled: false, jumpAnchor: {current: null}, onSelect: start, selecting: false};
  return {calls, start, render: (patch = {}) => host.render(() => LibraryToolbar({...props, ...patch}))};
}

test('Library tablet Select uses the actual supplied context and compact/TV add no button', async () => {
  for (const width of [390, 599, 600, 820, 1180]) {
    const f = await fixture(width), tree = f.render(), nodes = elements(tree);
    const button = nodes.find(node => node.props.testID === 'library-select');
    assert.equal(!!button, width >= 600);
    if (button) {assert.equal(button.props.onPress, f.start); button.props.onPress(); assert.deepEqual(f.calls, ['actual-library-context']);}
    assert.equal(nodes.find(node => node.type === 'FiltersButton')?.props.open, true, 'actual draft open state reaches the control');
    assert.equal(tree.type, 'ScrollView', 'touch controls remain reachable horizontally');
    const controls = nodes.filter(node => ['Button', 'FiltersButton', 'LibrarySortMenu'].includes(node.type as string)).map(node => node.type);
    assert.deepEqual(controls, width >= 600 ? ['Button', 'FiltersButton', 'LibrarySortMenu'] : ['FiltersButton', 'LibrarySortMenu']);
    assert.equal(elements(f.render({onSelect: undefined})).some(node => node.props.testID === 'library-select'), false, 'a missing real port never creates a dummy action');
    assert.equal(elements(f.render({selecting: true})).some(node => node.props.testID === 'library-select'), false);
  }
  const tv = await fixture(1920, true), nodes = elements(tv.render());
  assert.equal(nodes.some(node => node.props.testID === 'library-select'), false);
  assert.deepEqual(nodes.filter(node => ['LibrarySortMenu', 'FiltersButton', 'Chip'].includes(node.type as string)).map(node => node.type), ['LibrarySortMenu', 'FiltersButton', 'Chip']);
});
