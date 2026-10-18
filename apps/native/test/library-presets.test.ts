/**
 * A library's presets through the real hook (`useLibraryPresets`, the hook driver): one service per
 * viewer, library and pivot, so switching between two libraries of the same pivot reads the new
 * one's and a late answer for the old never shows; a save with no answer is sent again as itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost} from './hook-driver.ts';
import {useLibraryPresets} from '../src/app/library-presets.ts';

const scope = {serverId: 'server', viewerId: '["local","account","profile"]'};
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const definition = (libraryId: string) => ({libraryId, pivot: 'shows', query: null, sort: [{field: 'title', direction: 'asc'}], presentation: 'grid'});
const view = (id: string, libraryId: string) => ({serverId: 'server', viewerFence: 'fence', id, kind: 'view', name: id, summary: '', visibility: 'private', revision: 1, role: 'owner', entryCount: 0, actions: ['pin', 'update', 'delete'], status: 'ready', invalidComponents: [], pinned: false, pinRevision: 0, shares: [], definition: definition(libraryId)});
const page = (resources: unknown[]) => ({serverId: 'server', viewerFence: 'fence', revision: 1, resources, nextCursor: ''});

test('two libraries of the same pivot: switching reads the new library\'s with a service of its own; a late answer for the old never shows', async () => {
  const waiting = new Map<string, (v: unknown) => void>();
  const paths: string[] = [];
  const api = {request: (path: string) => { paths.push(path); return new Promise(resolve => { waiting.set(new URL('http://x' + path).searchParams.get('libraryId')!, resolve); }); }};
  let n = 0;
  const requestId = async () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const now = {libraryId: 'anime'};
  let out!: ReturnType<typeof useLibraryPresets>;
  const host = createHookHost(() => { out = useLibraryPresets({api: api as never, scope, requestId, libraryId: now.libraryId, pivot: 'shows', enabled: true}); });
  host.mount();
  await settle();
  const first = out.service;
  now.libraryId = 'tv';
  host.rerender();
  await settle();
  assert.notEqual(out.service, first, 'a service of its own');
  assert.ok(paths.some(p => p.includes('libraryId=tv')), 'the new library\'s presets asked for');
  waiting.get('tv')!(page([view('tv-1', 'tv')]));
  await settle();
  waiting.get('anime')!(page([view('anime-1', 'anime')]));
  await settle();
  host.rerender();
  assert.deepEqual(out.snapshot?.resources.map(r => r.id), ['tv-1']);
  host.unmount();
});

test('a save with no answer is offered again as it was sent, as the same operation; setting it aside allows a new one', async () => {
  const bodies: {operationId: string; name: string}[] = [];
  let answer: 'none' | 'ok' = 'none';
  const api = {request: async (path: string, method = 'GET', body?: {operationId: string; name: string}) => {
    if (method === 'GET') return page([]);
    bodies.push(body!);
    if (answer === 'none') throw Object.assign(new Error('The server took too long.'), {code: 'timeout'});
    return {serverId: 'server', viewerFence: 'fence', receipt: {operationId: body!.operationId, resourceId: 'new', revision: 1, deleted: false}};
  }};
  let n = 0;
  let out!: ReturnType<typeof useLibraryPresets>;
  const host = createHookHost(() => { out = useLibraryPresets({api: api as never, scope, requestId: async () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, libraryId: 'tv', pivot: 'shows', enabled: true}); });
  host.mount();
  await settle();
  await assert.rejects(() => out.save('Nineties', definition('tv') as never), /too long/);
  host.rerender();
  assert.equal(out.unconfirmed?.intent.action === 'create' && out.unconfirmed.intent.name, 'Nineties', 'the form holds the name it was sent with');
  answer = 'ok';
  await out.save('Nineties', definition('tv') as never);
  assert.equal(bodies[1]!.operationId, bodies[0]!.operationId, 'the same operation: made once');
  host.rerender();
  assert.equal(out.unconfirmed, undefined);
  // Unanswered again, then set aside (the form closed): the next save is a new operation.
  answer = 'none';
  await assert.rejects(() => out.save('Eighties', definition('tv') as never));
  host.rerender();
  await assert.rejects(() => out.save('Changed', definition('tv') as never), (e: {code?: string}) => e.code === 'unconfirmed', 'not replaced by another');
  out.discard();
  await settle();
  host.rerender();
  assert.equal(out.unconfirmed, undefined);
  answer = 'ok';
  await out.save('Changed', definition('tv') as never);
  assert.notEqual(bodies.at(-1)!.operationId, bodies.at(-2)!.operationId);
  assert.equal(bodies.at(-1)!.name, 'Changed');
  host.unmount();
});

test('a picker that read none shows a view another device saved once it is opened again (read quietly, in place)', async () => {
  let rows: unknown[] = [];
  const api = {request: async () => page(rows)};
  let out!: ReturnType<typeof useLibraryPresets>;
  const host = createHookHost(() => { out = useLibraryPresets({api: api as never, scope, requestId: async () => '00000000-0000-4000-8000-000000000001', libraryId: 'tv', pivot: 'shows', enabled: true}); });
  host.mount();
  await settle();
  host.rerender();
  assert.equal(out.snapshot?.resources.length, 0);
  // Saved on the phone.
  rows = [view('from-phone', 'tv')];
  await out.refresh();
  host.rerender();
  assert.deepEqual(out.snapshot?.resources.map(r => r.id), ['from-phone']);
  assert.equal(out.snapshot?.loading, false, 'no loading state for a quiet read');
  host.unmount();
});

// ---- R4: an unconfirmed change held as itself, retried exactly, shown wherever the list is ------

/** The scoped list as the server serves it: 40 a page, cursors bound to the list's revision; writes answered or timed out. */
function presetApi(count: number) {
  const s = {rev: 1, deleted: new Set<string>(), writes: [] as {method: string; path: string; body: any}[], answer: 'ok' as 'ok' | 'timeout'};
  const request = async (path: string, method = 'GET', body?: any) => {
    if (method === 'GET') {
      const cursor = new URL('http://x' + path).searchParams.get('cursor');
      let at = 0; if (cursor) { const [rev, offset] = cursor.split(':').map(Number); if (rev !== s.rev) throw Object.assign(new Error('changed'), {code: 'stale_continuation'}); at = offset!; }
      const all = Array.from({length: count}, (_, i) => ({...view(`p${i}`, 'tv'), name: `View ${i}`})).filter(r => !s.deleted.has(r.id));
      return {serverId: 'server', viewerFence: 'fence', revision: s.rev, resources: all.slice(at, at + 40), nextCursor: at + 40 < all.length ? `${s.rev}:${at + 40}` : ''};
    }
    s.writes.push({method, path, body});
    const id = decodeURIComponent(path.split('/').at(-1)!);
    if (method === 'DELETE') s.deleted.add(id);
    s.rev++;
    if (s.answer === 'timeout') throw Object.assign(new Error('The server took too long.'), {code: 'timeout'});
    return {serverId: 'server', viewerFence: 'fence', receipt: {operationId: body.operationId, resourceId: method === 'POST' ? 'new' : id, revision: s.rev, deleted: method === 'DELETE'}};
  };
  return Object.assign(s, {request});
}
function presetHost(api: ReturnType<typeof presetApi>) {
  let n = 0;
  const box = {out: undefined as unknown as ReturnType<typeof useLibraryPresets>};
  const host = createHookHost(() => { box.out = useLibraryPresets({api: api as never, scope, requestId: async () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, libraryId: 'tv', pivot: 'shows', enabled: true}); });
  return {host, box};
}

test('a held save is sent again as the definition it was sent with, though the filters and sort on screen changed since', async () => {
  const api = presetApi(0);
  const {host, box} = presetHost(api);
  host.mount();
  await settle();
  api.answer = 'timeout';
  await assert.rejects(() => box.out.save('Nineties', {...definition('tv'), query: {field: 'genre', operator: 'in', value: ['Drama']}} as never));
  host.rerender();
  // What the screen's own save would build now (another filter and sort): a different change, refused before sending.
  await assert.rejects(() => box.out.save('Nineties', {...definition('tv'), sort: [{field: 'year', direction: 'desc'}]} as never), (e: {code?: string}) => e.code === 'unconfirmed');
  assert.equal(api.writes.length, 1);
  api.answer = 'ok';
  await box.out.retryHeld();
  assert.deepEqual(api.writes[1]!.body, api.writes[0]!.body, 'the held save itself');
  host.rerender();
  assert.equal(box.out.unconfirmed, undefined);
  host.unmount();
});

test('the toolbar\'s save form, holding an unconfirmed save, sends that save again rather than building one from the screen', async () => {
  const {hooks, screenModule} = await import('./helpers/screen-harness.mjs');
  const loose = (named: Record<string, unknown> = {}): any => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value})};
  const m = await screenModule(new URL('../src/screens/BrowseFilters.tsx', import.meta.url), {
    react: {...base, default: base}, 'react-native': loose(), '../../../../packages/client-core/src/browse': loose(),
    '../../../../packages/client-core/src/presentation/index': loose({toolbarModel: () => ({sorts: [], quick: [], promoted: [], groups: [], applied: [], sort: {flippable: false}})}),
    '../app/browse': loose({fieldLabel: (id: string) => id}), '../ui': loose({useTheme: () => ({isTV: false, window: {compact: false}, space: {}})}), '../app/errors': {say: () => 'failed'},
    '../app/browse-count': loose(), '../app/i18n': loose({useI18n: () => ({t: (id: string) => id})}), './title/RowGuide': loose(),
  }) as any;
  const sent: string[] = [];
  const props = {inline: true, libraryId: 'lib', capabilities: {library: {kind: 'movie'}, sorts: [], resolvedPivot: {id: 'movies'}}, predicates: [{field: 'genre', operator: 'in', value: ['Drama']}], onChange: () => {}, sort: {field: 'title', direction: 'asc'}, onSort: () => {},
    onSaveView: async (name: string) => { sent.push(`built:${name}`); }, saveHeld: 'Nineties', onSaveRetry: async () => { sent.push('held'); }};
  const walk = (node: any, out: any[] = []): any[] => { if (!node || typeof node !== 'object') return out; if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return out; } out.push(node); walk(node.props?.children, out); return out; };
  const draw = () => walk(h.render(() => m.BrowseBar(props)));
  draw().find(n => n.type === 'Button' && n.props.label === 'lib.saveView')!.props.onPress();
  const sheet = draw().find(n => n.type === 'Sheet' && n.props.title === 'lib.saveViewTitle')!;
  assert.equal(draw().find(n => n.type === 'Field')!.props.editable, false, 'the held name, read-only');
  sheet.props.primary.onPress();
  await settle();
  assert.deepEqual(sent, ['held']);
});

test('Manage on a phone or TV: a delete with no answer is shown above the rows on any page, also once its row has gone; Try again sends that same delete; Set aside forgets one', async () => {
  const api = presetApi(90);
  const {host, box} = presetHost(api);
  host.mount();
  await settle();
  await box.out.service!.next(); await box.out.service!.next();
  host.rerender();
  const {hooks, screenModule} = await import('./helpers/screen-harness.mjs');
  const loose = (named: Record<string, unknown> = {}): any => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value})};
  const t = (id: string, values?: object) => (values ? `${id}:${JSON.stringify(values)}` : id);
  const m = await screenModule(new URL('../src/screens/LibraryPresets.tsx', import.meta.url), {
    react: {...base, default: base}, 'react-native': loose(), '../../../../packages/client-core/src/personal-saved': await import('../../../packages/client-core/src/personal-saved.ts'),
    '../app/library-presets': loose({isUnconfirmed: (e: any) => e?.code === 'unconfirmed'}), '../app/content': loose(), '../app/detail': loose(), '../app/errors': {say: (e: any) => e?.message ?? 'failed'},
    '../app/i18n': {useI18n: () => ({t})}, '../app/session': loose(), '../app/freshness': loose(), '../../../../packages/client-core/src/freshness-hub': {titlesWithPersonalState: () => []},
    '../ui': loose({useTheme: () => ({space: {}})}),
  }) as any;
  const walk = (node: any, out: any[] = []): any[] => { if (!node || typeof node !== 'object') return out; if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return out; } out.push(node); walk(node.props?.children, out); return out; };
  const draw = () => { host.rerender(); return walk(h.render(() => m.ManageSavedViews({open: true, onClose: () => {}, presets: box.out}))); };
  const held = () => draw().find(n => n.type === 'Notice' && n.props.tone === 'warning');
  const rowOf = (tree: any[], name: string) => tree.findIndex(n => n.type === 'Text' && [n.props.children].flat().join('') === name);
  let tree = draw();
  tree.find((n, i) => n.type === 'Button' && n.props.label === 'lib.delete' && i > rowOf(tree, 'View 85'))!.props.onPress();
  api.answer = 'timeout';
  draw().find(n => n.type === 'Button' && n.props.variant === 'destructive')!.props.onPress();
  await settle(); await settle();
  assert.equal(held()?.props.message, 'lib.savedViewHeldDelete:{"name":"View 85"}');
  assert.equal(draw().some(n => n.type === 'Text' && String([n.props.children].flat()[0]).startsWith('lib.deleteSavedView')), false, 'no confirmation left in a row');
  assert.ok(draw().filter(n => n.type === 'Button' && (n.props.label === 'lib.rename' || n.props.label === 'lib.delete')).every(n => n.props.disabled), 'nothing else offered meanwhile');
  await box.out.service!.first();
  assert.ok(held(), 'on the first page too, where its row is not');
  api.answer = 'ok';
  draw().find(n => n.type === 'Button' && n.props.label === 'action.tryAgain')!.props.onPress();
  await settle(); await settle();
  assert.deepEqual(api.writes[1], api.writes[0], 'the same delete, the same operation');
  assert.equal(held(), undefined);
  // Another with no answer, set aside.
  api.answer = 'timeout';
  await assert.rejects(() => box.out.rename(box.out.snapshot!.resources[0]!, 'Renamed'));
  assert.equal(held()?.props.message, 'lib.savedViewHeldRename:{"name":"View 0","to":"Renamed"}');
  draw().find(n => n.type === 'Button' && n.props.label === 'lib.savedViewSetAside')!.props.onPress();
  await settle();
  assert.equal(held(), undefined, 'set aside');
  host.unmount();
});
