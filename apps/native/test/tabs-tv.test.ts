/**
 * The tab strip's focus on television (Justin, 18 Oct 2026: the bright focused tab was "ugly as
 * sin"), rendered from its own source (the screen harness: React and native modules stubbed): a
 * focused tab is a quiet raised plate with primary text inside the app's focus ring, the accent
 * underline stays the selected tab's alone, and the strip is no taller for the ring's room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const loose = (named: Record<string, unknown> = {}): any => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}
const colors = {focus: 'FOCUS', ink: 'INK', raisedHigh: 'RAISED_HIGH', text: 'TEXT', textSecondary: 'TEXT2', textTertiary: 'TEXT3', accent: 'ACCENT', lineSoft: 'LINE'};

async function strip(isTV: boolean) {
  const h = hooks();
  const m = await screenModule(new URL('../src/ui/Tabs.tsx', import.meta.url), {
    react: h.react, 'react-native': loose(),
    'react-native-reanimated': loose({useSharedValue: (value: number) => ({value}), useAnimatedStyle: () => ({})}),
    './Focusable': {Focusable: 'Focusable'}, './Text': {Text: 'Text'},
    './theme': loose({useTheme: () => ({colors, isTV, space: {xs: 8, sm: 12, md: 20, page: 80}, motion: {reduce: true, standard: 0}, metrics: {focusRing: 4, radius: {control: 12}}}), useInitialFocus: () => false}),
  });
  const tree = all(h.render(() => m.Tabs({items: [{id: 'discover', label: 'Discover'}, {id: 'movies', label: 'Movies'}, {id: 'collections', label: 'Collections'}], selected: 'movies', onSelect: () => {}, rule: false})));
  const tabs = tree.filter(n => n.type === 'Focusable');
  /** A tab as drawn in a state: its plate and its label. */
  const drawn = (index: number, state: {focused?: boolean; hovered?: boolean} = {}) => {
    const plate = [tabs[index]!.props.children].flat()[0]({focused: false, hovered: false, pressed: false, ...state});
    return {plate: plate.props.style, text: all(plate).find(n => n.type === 'Text')!.props.style.color};
  };
  return {tree, tabs, drawn};
}

test('TV: a focused tab is a raised plate with primary text in the focus ring, never a bright block; the underline is selection\'s', async () => {
  const {tree, tabs, drawn} = await strip(true);
  assert.deepEqual(tabs.map(t => [t.props.ring, t.props.scale]), [[true, 1], [true, 1], [true, 1]], 'the app\'s focus ring, no growth past the strip');
  const focused = drawn(0, {focused: true});
  assert.equal(focused.plate.backgroundColor, 'RAISED_HIGH');
  assert.equal(focused.text, 'TEXT');
  assert.ok(![drawn(0, {focused: true}), drawn(1, {focused: true})].some(d => d.plate.backgroundColor === 'FOCUS' || d.text === 'INK'), 'no focus-coloured fill or ink text');
  // Selection and focus stay distinct: the selected tab at rest has primary text and no plate;
  // the others are tertiary until focused.
  assert.deepEqual([drawn(1).plate.backgroundColor, drawn(1).text], ['transparent', 'TEXT'], 'selected, not focused');
  assert.deepEqual([drawn(2).plate.backgroundColor, drawn(2).text], ['transparent', 'TEXT3'], 'neither');
  assert.equal(drawn(1, {focused: true}).plate.backgroundColor, 'RAISED_HIGH', 'the selected tab focused is the same plate');
  assert.ok(tree.some(n => n.props?.style?.[0]?.backgroundColor === 'ACCENT'), 'the accent underline');
  // The ring (4 + 2 outside the plate) has its room inside the strip's scroller, taken from the
  // plate's own padding: the strip is as tall as before.
  const scroller = tree.find(n => n.props?.horizontal)!;
  assert.equal(scroller.props.contentContainerStyle.paddingVertical, 6);
  assert.equal(focused.plate.paddingVertical + scroller.props.contentContainerStyle.paddingVertical, 20);
});

test('touch: tabs unchanged (no ring, no plate; text alone shows the state)', async () => {
  const {tree, tabs, drawn} = await strip(false);
  assert.deepEqual(tabs.map(t => t.props.ring), [false, false, false]);
  assert.deepEqual([drawn(0, {focused: true}).plate.backgroundColor, drawn(0, {focused: true}).text], ['transparent', 'TEXT2']);
  assert.deepEqual([drawn(1).text, drawn(2).text], ['TEXT', 'TEXT3']);
  assert.equal(tree.find(n => n.props?.horizontal)!.props.contentContainerStyle.paddingVertical, 0);
});
