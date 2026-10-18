/**
 * BrowseBar on television, rendered from its own source (the screen harness: React and native
 * modules stubbed, its own code run): a TV library grid's row under the tabs has the web's
 * controls (Sort, the quick and promoted filters, Filter, Save view, the count at its end), and
 * the compact form (a group's page) still saves a filtered view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const loose = (named: Record<string, unknown> = {}) => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
const theme = () => ({isTV: true, space: {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, page: 48}});
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}
test('compact form: with a filter on, Save view is offered and keeps its form, its error and its submit', async () => {
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value})};
  const m = await screenModule(new URL('../src/screens/BrowseFilters.tsx', import.meta.url), {
    react: {...base, default: base}, 'react-native': loose(),
    '../../../../packages/client-core/src/browse': loose(),
    '../../../../packages/client-core/src/presentation/index': loose({toolbarModel: () => ({sorts: [], quick: [], promoted: [], groups: [], applied: [], sort: {flippable: false}})}),
    '../app/browse': loose({fieldLabel: (id: string) => id}), '../ui': loose({useTheme: theme}), '../app/errors': {say: () => 'That view couldn’t be saved.'},
    '../app/browse-count': loose(), '../app/i18n': loose({useI18n: () => ({t: (id: string) => id})}), './title/RowGuide': loose(),
  });
  const saved: string[] = [];
  let fail = true;
  const props = {inline: true, libraryId: 'lib', capabilities: {library: {kind: 'movie'}, sorts: [], resolvedPivot: {id: 'movies'}}, predicates: [{field: 'genre', operator: 'in', value: ['Drama']}], onChange: () => {}, sort: {field: 'title', direction: 'asc'}, onSort: () => {},
    onSaveView: async (name: string) => { saved.push(name); if (fail) throw new Error('no'); }};
  const draw = (extra: object = {}) => all(h.render(() => m.BrowseBar({...props, ...extra})));
  const save = () => draw().find(n => n.type === 'Button' && n.props.label === 'lib.saveView');
  const sheet = () => draw().find(n => n.type === 'Sheet' && n.props.title === 'lib.saveViewTitle');
  assert.ok(save(), 'offered beside Sort and Filter');
  assert.equal(draw({predicates: []}).some(n => n.type === 'Button' && n.props.label === 'lib.saveView'), false, 'nothing to save without a filter');
  assert.equal(draw({onSaveView: undefined}).some(n => n.type === 'Button' && n.props.label === 'lib.saveView'), false, 'a group tab saves nothing');
  assert.equal(sheet()?.props.open, false);
  save()!.props.onPress();
  assert.equal(sheet()?.props.open, true, 'the form opens');
  assert.equal(sheet()?.props.primary.disabled, true, 'no name yet');
  draw().find(n => n.type === 'Field')!.props.onChangeText('Eighties');
  sheet()!.props.primary.onPress();
  await new Promise(setImmediate);
  assert.deepEqual(saved, ['Eighties']);
  assert.equal(sheet()?.props.open, true, 'a failure keeps the form open');
  assert.ok(draw().some(n => n.type === 'Notice' && n.props.message === 'That view couldn’t be saved.'), 'and says so');
  fail = false;
  sheet()!.props.primary.onPress();
  await new Promise(setImmediate);
  assert.equal(sheet()?.props.open, false, 'saved: the form closes');
});

test('TV library grid: the row under the tabs has the web\'s quick and promoted filters, Filter, Save view and the count at its end', async () => {
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value})};
  const model = {sorts: [{id: 'title'}], quick: [{id: 'unwatched', labelKey: 'quick.unwatched', query: {field: 'watched', operator: 'equals', value: false}}], promoted: [{id: 'genre', labelKey: 'genre'}, {id: 'year', labelKey: 'year'}], groups: [], applied: [], sort: {flippable: true}};
  const m = await screenModule(new URL('../src/screens/BrowseFilters.tsx', import.meta.url), {
    react: {...base, default: base}, 'react-native': loose(),
    '../../../../packages/client-core/src/browse': loose(),
    '../../../../packages/client-core/src/presentation/index': loose({toolbarModel: () => model, fieldSelectionSummary: () => ''}),
    '../app/browse': loose({fieldLabel: (id: string) => id, quickFilterLabel: (id: string) => id}), '../ui': loose({useTheme: theme}), '../app/errors': loose(),
    '../app/browse-count': {browseCountLabel: (_t: unknown, total: number) => `${total} shows`}, '../app/i18n': loose({useI18n: () => ({t: (id: string) => id})}), './title/RowGuide': loose(),
  });
  const tree = all(h.render(() => m.BrowseBar({libraryId: 'lib', capabilities: {library: {kind: 'show'}, sorts: [{id: 'title', defaultDirection: 'asc'}], resolvedPivot: {id: 'shows'}}, predicates: [{field: 'genre', operator: 'in', value: ['Drama']}], onChange: () => {}, sort: {field: 'title', direction: 'asc'}, onSort: () => {}, total: 24, onSaveView: async () => {}})));
  const scroll = tree.find(n => n.type === 'ScrollView' && n.props.horizontal)!;
  const row = all(scroll.props.children);
  const labels = row.filter(n => n.type === 'Button').map(n => n.props.label);
  assert.ok(labels.includes('quick.unwatched'), `a quick filter: ${labels}`);
  assert.ok(labels.some(l => String(l).startsWith('genre')) && labels.some(l => String(l).startsWith('year')), 'the promoted filters');
  assert.ok(labels.includes('filter.add') && labels.includes('lib.saveView'));
  assert.deepEqual(row.filter(n => n.type === 'Text').at(-1)?.props.children, ['24 shows'], 'the count ends the row');
});

test('TV letters: ten-foot keys down the grid\'s right; Select jumps, Left from them goes back into the grid', async () => {
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value})};
  let tvEvent: ((e: {eventType: string; eventKeyAction?: number}) => void) | undefined;
  const m = await screenModule(new URL('../src/screens/BrowseFilters.tsx', import.meta.url), {
    react: {...base, default: base}, 'react-native': loose({useTVEventHandler: (f: typeof tvEvent) => { tvEvent = f; }}),
    '../../../../packages/client-core/src/browse': loose({formatBrowseAnchor: (key: string) => key}),
    '../../../../packages/client-core/src/presentation/index': loose(),
    '../app/browse': loose(), '../ui': loose({useTheme: () => ({...theme(), metrics: {controlSmall: 64, radius: {control: 8}}, colors: {}, type: {bodyStrong: {}}}), isFocusIntent: (e: {eventKeyAction?: number}) => e.eventKeyAction !== 1, alpha: () => ''}),
    '../app/errors': loose(), '../app/browse-count': loose(), '../app/i18n': loose({useI18n: () => ({t: (id: string) => id})}), './title/RowGuide': loose(),
  });
  const jumped: string[] = [];
  let left = 0;
  const index = ['A', 'B', 'C', 'D', 'E'].map((key, i) => ({key, index: i * 10}));
  const keys = all(h.render(() => m.LetterRail({index, onJump: (k: string) => jumped.push(k), onLeave: () => left++}))).filter(n => n.type === 'Focusable');
  assert.equal(keys.length, 5);
  assert.deepEqual([keys[0]!.props.style.width, keys[0]!.props.style.height], [64, 64], 'the ten-foot minimum, not phone-sized letters');
  keys[2]!.props.onPress();
  assert.deepEqual(jumped, ['C']);
  tvEvent!({eventType: 'left'});
  assert.equal(left, 0, 'Left elsewhere on the screen is not the rail\'s');
  keys[2]!.props.onFocus();
  tvEvent!({eventType: 'left', eventKeyAction: 1});
  assert.equal(left, 0, 'a release is not a press');
  // The key's blur can arrive before the press it came from.
  keys[2]!.props.onBlur();
  tvEvent!({eventType: 'left', eventKeyAction: 0});
  assert.equal(left, 1);
  assert.equal(all(h.render(() => m.LetterRail({index: index.slice(0, 3), onJump: () => {}}))).length, 0, 'too few letters: no rail');
});
