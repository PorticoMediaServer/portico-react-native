/**
 * The TV library strip's compact toolbar (BrowseBar, inline) still saves a filtered view: rendered
 * from its own source (the screen harness: React and native modules stubbed, its own code run).
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
test('TV library strip: with a filter on, Save view is offered and keeps its form, its error and its submit', async () => {
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
