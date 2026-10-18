/**
 * TV A–Z landing in a library grid (FRONTEND-REVIEW-R5): the title a letter jumped to belongs to
 * the list it was pressed in, that collection as it was read then. Another pivot's collection can
 * start at the same generation, so the grid's guide destination, a watch still looking and the Left
 * still to come end with the list, not only with a new reading of it. Library's own EngineResults
 * is run (the screen harness, with effects), over real windowed collections and the real focus
 * registry; Android's focus engine is not, so delivery on the device stays root's to confirm.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import * as lists from '../src/ui/focus-lists.ts';
import * as stage from '../src/app/browse-stage.ts';
import {cardFocusKey, focusReturn} from '../src/ui/focus-return.ts';
import {createWindowedCollection} from '../../../packages/client-core/src/collections/index.ts';

const loose = (named: Record<string, unknown> = {}): any => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  for (const value of Object.values((node as {props?: any}).props ?? {})) if (value && typeof value === 'object') all(value, out);
  return out;
}
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => new Promise(resolve => setImmediate(resolve));

/** React's hooks with effects run after each draw (cleanups before a changed effect runs again). */
function effectHooks() {
  const cells: any[] = [];
  let cursor = 0;
  let queued: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react: any = {
    createElement: (type: unknown, props: object, ...children: unknown[]) => ({type, props: {...props, children}}),
    useRef: (value: unknown) => { const n = cursor++; return (cells[n] ??= {current: value}); },
    useState: (value: unknown) => { const n = cursor++; if (!(n in cells)) cells[n] = value; return [cells[n], (next: unknown) => { cells[n] = typeof next === 'function' ? (next as (v: unknown) => unknown)(cells[n]) : next; }]; },
    useMemo: (fn: () => unknown, deps: unknown[]) => { const n = cursor++; if (!cells[n] || !same(cells[n].deps, deps)) cells[n] = {deps, value: fn()}; return cells[n].value; },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => (() => void) | void, deps: unknown[]) => { const n = cursor++; if (!cells[n] || !same(cells[n].deps, deps)) { const old = cells[n]; cells[n] = {deps}; queued.push(() => { old?.cleanup?.(); cells[n].cleanup = fn(); }); } },
    useContext: (context: {value: unknown}) => context.value,
    createContext: (value: unknown) => ({value}),
  };
  react.default = react;
  return {
    react,
    draw<T>(fn: () => T): T { cursor = 0; const tree = fn(); const run = queued; queued = []; run.forEach(f => f()); return tree; },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

/** A copy of a source file with `edit` applied (what the harness cannot load as it is), for `screenModule`. */
async function edited(path: string, edit: (source: string) => string) {
  const file = join(await mkdtemp(join(tmpdir(), 'portico-landing-')), path.split('/').pop()!);
  await writeFile(file, edit(await readFile(new URL(path, import.meta.url), 'utf8')));
  return pathToFileURL(file);
}

async function engineResults(h: ReturnType<typeof effectHooks>) {
  // EngineResults is the screen's own (not exported): the same source, with it exported.
  const file = await edited('../src/screens/Library.tsx', source => source.replace('function EngineResults(', 'export function EngineResults('));
  const theme = {space: {page: 40, md: 16, sm: 8, lg: 24, xs: 4, gutter: 16}, metrics: {posterWidth: 180, squareWidth: 180, controlSmall: 64, focusRing: 4}, isTV: true, window: {width: 1920}};
  const modules: any = new Proxy({
    react: h.react, 'react-native': loose(),
    '../ui': loose({useTheme: () => theme, FocusScopeContext: {value: 'library'}, focusReturn, cardFocusKey}),
    '../ui/focus-lists': lists, '../app/browse-stage': stage,
    './Home': loose({useSectionCards: () => ({width: 180, renderCard: () => null, shape: 'poster', open: () => {}, artwork: () => {}})}),
    '../app/i18n': loose({useI18n: () => ({t: (id: string) => id})}),
    './BrowseStage': loose({useStageTop: () => 40}),
  }, {get: (target, name) => (target as Record<string, unknown>)[name as string] ?? loose()});
  return (await screenModule(file, modules)).EngineResults as (props: object) => unknown;
}

async function collection(prefix: string) {
  const c = createWindowedCollection<{id: string}>({fetchPage: async () => ({items: Array.from({length: 60}, (_, i) => ({id: prefix + i})), total: 60, positionIndex: {A: 0, B: 10, C: 20, D: 30}}), pageSize: 60, maxResidentPages: 5, keyOf: e => e.id});
  c.ensureRange(0, 59);
  await settle();
  return c;
}

async function grid() {
  const h = effectHooks();
  const EngineResults = await engineResults(h);
  let list: any = null;
  let pivot = 'movies';
  let tree: unknown;
  const draw = () => (tree = h.draw(() => EngineResults({window: {list, snapshot: list?.getSnapshot() ?? {generation: 0, status: 'loading'}}, renderHeader: () => null, renderStrip: () => null, sortField: 'title', libraryId: 'films', libraryKind: 'movie', filtered: false, onClearFilters: () => {}, pivot, tab: {shows: 'titles'}})));
  return {
    show(next: unknown, nextPivot = pivot) { list = next; pivot = nextPivot; draw(); draw(); },
    draw,
    destinations: () => all(tree).find(n => n.type === 'FocusGroup' && n.props.destinations)?.props.destinations,
    rail: () => all(tree).find(n => n.type === 'LetterRail')!.props as {onJump: (key: string) => void; onLeave: () => boolean | void},
    unmount: () => h.unmount(),
  };
}

const card = (id: string, node = {nativeTag: id}) => ({node, off: focusReturn.register('library', cardFocusKey('cards', id), {focus: () => {}, node: () => node})});

test('a landing found in one collection is not handed to another pivot\'s collection at the same generation', async () => {
  focusReturn.setOwner('viewer');
  const g = await grid();
  const movies = await collection('movie'), collections = await collection('collection');
  try {
    g.show(movies);
    const jumped = card('movie20');
    g.rail().onJump('C');
    await tick(10);
    g.draw();
    assert.deepEqual(g.destinations(), [jumped.node], 'the guide names the title jumped to');
    // Up to the strip, Collections: the same grid, another collection, the same generation number.
    jumped.off();
    g.show(collections, 'collections');
    assert.equal(movies.getSnapshot().generation, collections.getSnapshot().generation);
    assert.deepEqual(g.destinations(), [], 'no destination from the movies (an explicit empty list, so Android drops it)');
    assert.equal(g.rail().onLeave(), false, 'the movies\' Left has nowhere to go');
    assert.equal(focusReturn.state().returning, undefined, 'and starts no landing in the collections');
  } finally { g.unmount(); movies.dispose(); collections.dispose(); focusReturn.setOwner(''); }
});

test('a landing still being looked for stops with its collection, rather than naming the next one\'s title at that place', async () => {
  focusReturn.setOwner('viewer');
  const g = await grid();
  const movies = await collection('movie'), collections = await collection('collection');
  try {
    g.show(movies);
    g.rail().onJump('C');
    g.show(collections, 'collections');
    const there = card('collection20');
    await tick(150);
    g.draw();
    assert.deepEqual(g.destinations(), [], 'the movies\' C is not collection 20');
    there.off();
    // Through no list at all (a pivot still reading), then the same collection back.
    const jumped = card('collection20');
    g.rail().onJump('C');
    await tick(10);
    g.draw();
    assert.deepEqual(g.destinations(), [jumped.node]);
    g.show(null);
    assert.deepEqual(g.destinations(), undefined, 'no grid guide while nothing can be focused');
    g.show(collections);
    assert.deepEqual(g.destinations(), [], 'the same collection again is a new reading of it');
    assert.equal(g.rail().onLeave(), false);
    jumped.off();
  } finally { g.unmount(); movies.dispose(); collections.dispose(); focusReturn.setOwner(''); }
});

test('within one collection the landing holds until it is read again (a new generation)', async () => {
  focusReturn.setOwner('viewer');
  const g = await grid();
  const movies = await collection('movie');
  try {
    g.show(movies);
    const jumped = card('movie20');
    g.rail().onJump('C');
    await tick(10);
    g.show(movies);
    assert.deepEqual(g.destinations(), [jumped.node], 'redrawn, the same list keeps it');
    assert.equal(g.rail().onLeave(), true, 'Left goes to the title');
    assert.ok(focusReturn.state().returning, 'with the follow as its fallback');
    focusReturn.cancel();
    g.rail().onJump('C');
    await tick(10);
    g.draw();
    assert.deepEqual(g.destinations(), [jumped.node]);
    movies.invalidate();
    await settle();
    g.show(movies);
    assert.ok(movies.getSnapshot().generation > 0);
    assert.deepEqual(g.destinations(), [], 'read again: cleared');
    assert.equal(g.rail().onLeave(), false);
    jumped.off();
  } finally { g.unmount(); movies.dispose(); focusReturn.setOwner(''); }
});

test('TV: a letter\'s row comes to rest with the focus room above it, so the focused card\'s ring is not cut (root\'s S then Left)', async () => {
  for (const isTV of [true, false]) {
    const h = hooks();
    const react = {...h.react, memo: (f: unknown) => f, forwardRef: (f: unknown) => f, useImperativeHandle: (ref: {current: unknown}, make: () => unknown) => { ref.current = make(); }};
    // The harness takes no re-export.
    const m = await screenModule(await edited('../src/ui/Grid.tsx', source => source.replace('export {gridColumns};', '')), {
      react: {...react, default: react}, 'react-native': loose(), './NavBar': loose(),
      'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
      './theme': {useTheme: () => ({space: {page: 40, gutter: 16, lg: 28, xxxl: 80}, window: {width: 1920}, isTV, metrics: {railWidth: 0}})},
      './grid-columns': loose(), './Arriving': loose(), './arrivals': {WindowArrivals: class { reset() {} }},
    });
    const ranges: number[][] = [];
    const list = {ensureRange: (a: number, b: number) => ranges.push([a, b]), slotAt: () => ({kind: 'loading'}), subscribePage: () => () => {}, getPageVersion: () => ''};
    const handle = {current: undefined as undefined | {scrollToIndex: (i: number) => void}};
    const draw = () => h.render(() => m.WindowedGrid({list, total: 600, itemWidth: 200, aspect: 1.5, renderItem: () => null, pinnedAbove: true}, handle));
    let tree: any = draw();
    if (isTV) { tree.props.onLayout({nativeEvent: {layout: {height: 900}}}); tree = draw(); }
    const scroller = all(tree).find(n => n.props?.getItemCount)!;
    const offsets: number[] = [];
    scroller.props.ref.current = {scrollToOffset: ({offset}: {offset: number}) => offsets.push(offset)};
    tree = draw();
    handle.current!.scrollToIndex(0);
    handle.current!.scrollToIndex(80);
    const stride = Math.floor((1920 - 80 - 16 * 7) / 8) * 1.5 + 56 + 28;
    assert.deepEqual(offsets, isTV ? [0, 10 * stride - 28] : [0, 10 * stride], isTV ? 'TV: the room (28) above the row, never above the top' : 'touch: unchanged');
  }
});
