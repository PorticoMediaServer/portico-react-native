/**
 * A hero's backdrop never ends on an edge (Justin, 18 Oct 2026, every platform): the art's scrim
 * reaches the ink at the foot of the art, and below it a fade takes the ink away into the page.
 * Rendered from Canvas.tsx's own source (the screen harness: React and native modules stubbed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const loose = (named: Record<string, unknown> = {}) => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
const space = {xxxl: 80};
function react() {
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f};
  return {...base, default: base};
}
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}
const scrim = {bottom: [{at: 0, alpha: 0.35}, {at: 1, alpha: 1}], left: [{at: 0, alpha: 0.8}], phoneBottom: [{at: 1, alpha: 1}], phoneOverlay: [{at: 1, alpha: 1}]};

test('the art ends where its scrim is ink, and the fade below it ends transparent: no edge', async () => {
  const svg = loose({default: 'Svg'});
  const m = await screenModule(new URL('../src/ui/Canvas.tsx', import.meta.url), {
    react: react(), 'react-native': loose({StyleSheet: {absoluteFill: {}}}), 'react-native-svg': svg, 'react-native-reanimated': loose(),
    './Artwork': {sourceKey: () => undefined}, './theme': {alpha: () => '', useTheme: () => ({colors: {ink: '#071018'}, motion: {reduce: true, slow: 0}, space})},
    '../../../../packages/design/src/index': {heroSpec: {scrim}},
  });
  const tree = m.Backdrop({height: 500, blur: 40, tint: '#000'});
  const box = tree.props.style.find((s: any) => s && 'height' in s);
  assert.equal(box.height, 500 + space.xxxl * 2, 'the art, then the fade below it');
  const [art, fade] = tree.props.children;
  assert.equal(art.props.style.bottom, space.xxxl * 2, 'the art stops above the fade');
  assert.equal(art.props.style.backgroundColor, '#000', 'a tint fades with the art');
  const stops = all(fade.type(fade.props)).filter(n => n.type === 'Stop').map(n => n.props.stopOpacity);
  assert.deepEqual([stops[0], stops.at(-1)], [1, 0], 'from the scrim\'s ink at the foot of the art to nothing');
});
