/**
 * Television entry into a screen from the rail (FRONTEND-REVIEW-R4 §1 and root's Android runs on
 * bb0f281): what can receive focus below a library's strip, and which memory Right from the rail
 * goes back to. Rendered from the components' own source (the screen harness: React and native
 * modules stubbed); Android's focus engine itself is not run here, so delivery on the device stays
 * root's to confirm.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {gridReachable, stageContentless} from '../src/app/browse-stage.ts';

const loose = (named: Record<string, unknown> = {}) => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}

test('a Discover with nothing to focus below its strip: loading, an empty library, every row filtered out; a failure and any title keep the rows\' region', () => {
  const row = (n: number) => ({entries: Array.from({length: n}, (_, i) => i)});
  assert.equal(stageContentless({body: true, phase: 'loading', rows: []}), true, 'loading');
  assert.equal(stageContentless({body: true, phase: 'ready', rows: []}), true, 'an empty library (no action in its state)');
  assert.equal(stageContentless({body: false, phase: 'ready', rows: [row(0), row(0)]}), true, 'every row filtered out');
  assert.equal(stageContentless({body: true, phase: 'error', rows: []}), false, 'a failure: Try again');
  assert.equal(stageContentless({body: false, phase: 'ready', rows: [row(0), row(3)]}), false, 'a title');
});

test('a TV grid with nothing to focus in its place: loading, an empty library; a title, Try again, Clear filters or the header\'s notice keep it', () => {
  const none = {total: undefined, failed: false, hasList: true, empty: false, filtered: false, headerActions: false};
  assert.equal(gridReachable(none), false, 'loading');
  assert.equal(gridReachable({...none, total: 0, empty: true}), false, 'an empty library');
  assert.equal(gridReachable({...none, total: 0, empty: true, filtered: true}), true, 'nothing matches: Clear filters');
  assert.equal(gridReachable({...none, failed: true}), true, 'Try again');
  assert.equal(gridReachable({...none, total: 40}), true, 'titles');
  assert.equal(gridReachable({...none, hasList: false, headerActions: true}), true, 'the filters\' notice');
});

test('the stage: a contentless lower part is drawn as it is, with no focus region or scroller to take focus; a stage with rows keeps its guide', async () => {
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value})};
  const m = await screenModule(new URL('../src/screens/BrowseStage.tsx', import.meta.url), {
    react: {...base, default: base}, 'react-native': loose(), 'react-native-safe-area-context': loose({useSafeAreaInsets: () => ({top: 0})}),
    '../../../../packages/client-core/src/presentation/index': loose(), '../app/browse-preview': loose(), '../app/browse-stage': loose(),
    '../app/content': loose(), '../app/i18n': loose(), '../ui': loose({useTheme: () => ({space: {}, metrics: {}, type: {}, window: {}})}),
    '../ui/focus-lists': loose(), '../ui/ArtworkPipeline': loose(),
  });
  const layout = {top: 40, hero: 300, viewport: 500, tail: 100};
  const props = {store: {}, layout, identity: {title: 'Movies'}, rows: [], keyExtractor: () => '', renderRow: () => null, strip: {type: 'Strip', props: {}}};
  const empty = all(h.render(() => m.BrowseStage({...props, body: {type: 'StateView', props: {}}, contentless: true})));
  assert.equal(empty.some(n => n.type === 'FocusGroup'), false, 'no guide with nothing to hand focus to');
  assert.equal(empty.some(n => n.type === 'ScrollView' || n.type === 'FlatList'), false, 'no scroller to take focus itself');
  assert.ok(empty.some(n => n.type === 'StateView'), 'the empty state is still shown');
  assert.ok(empty.some(n => n.type === 'Strip'), 'the strip, the way in');
  const failed = all(h.render(() => m.BrowseStage({...props, body: {type: 'StateView', props: {}}})));
  assert.ok(failed.some(n => n.type === 'FocusGroup'), 'a failure\'s Try again is reached through the rows\' guide');
  const rows = all(h.render(() => m.BrowseStage({...props, rows: [{id: 'r'}]})));
  assert.ok(rows.some(n => n.type === 'FocusGroup') && rows.some(n => n.type === 'FlatList'), 'rows of cards keep their guide (card entry)');
});

test('the library: its tabs take the entry focus only while nothing below them can; Right from the rail into an empty grid reaches the strip and toolbar', () => {
  const library = readFileSync(new URL('../src/screens/Library.tsx', import.meta.url), 'utf8');
  assert.match(library, /strip\(contentless\)/, 'a contentless Discover gives its tabs the entry');
  assert.match(library, /contentless=\{contentless\}/);
  assert.match(library, /entryFocus=\{entry\}/);
  assert.match(library, /reachable\s*\n?\s*\? <FocusGroup/, 'an empty grid\'s place is no focus region');
  assert.match(library, /scrollable=\{!pinned \|\| reachable\}/, 'nor its scroller');
});

test('each kept-alive destination is its own focus guide: Right from the rail goes back to the control last used in the one showing, never into one hidden', async () => {
  // Root's run: Home → Movies → rail → Home → Right left nothing focused. One guide around every
  // destination remembered a Movies card, hidden (`display: none`) but mounted, and Android gives
  // focus to a view whose own visibility allows it whatever its ancestors'.
  const h = hooks();
  const base = {...h.react, createContext: (value: unknown) => ({value})};
  const state = {index: 1, routes: [{key: 'home', name: 'HomeRoot'}, {key: 'movies', name: 'LibraryRoot'}]};
  const m = await screenModule(new URL('../src/shell/Roots.tsx', import.meta.url), {
    react: {...base, default: base, Suspense: 'Suspense'},
    'react-native': {Platform: {isTV: true}, StyleSheet: {create: (s: object) => s, absoluteFill: {position: 'absolute'}, absoluteFillObject: {position: 'absolute'}}, TVFocusGuideView: 'TVFocusGuideView', View: 'View'},
    '@react-navigation/native': {createNavigatorFactory: (navigator: unknown) => navigator, TabRouter: {}, useNavigationBuilder: () => ({state, descriptors: {home: {render: () => 'home'}, movies: {render: () => 'movies'}}, NavigationContent: 'NavigationContent'})},
  });
  h.render(() => m.createRootsNavigator({children: null}));
  // Back on Home from the rail: Movies stays mounted, hidden.
  state.index = 0;
  const tree = h.render(() => m.createRootsNavigator({children: null}));
  const roots = all(tree).filter(n => n.type === 'View' && n.props.style && ('display' in n.props.style || n.props.style.position === 'absolute') && n.props.children);
  assert.equal(roots.length, 2, 'both destinations mounted (Movies was used before)');
  for (const root of roots) {
    const guide = [root.props.children].flat()[0] as {type: (p: object) => unknown; props: object};
    const drawn = all(guide.type(guide.props));
    assert.equal(drawn[0]?.type, 'TVFocusGuideView', 'the destination\'s own guide');
    assert.equal(drawn[0]?.props.autoFocus, true, 'remembering its own last control');
  }
  const shell = readFileSync(new URL('../src/shell/Shell.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /<TVFocusGuideView autoFocus[^>]*>\s*\{\/\*[^]*?\*\/\}\s*<CustodyPrompt/, 'no single guide around every destination');
});
