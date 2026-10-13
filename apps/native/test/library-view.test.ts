/**
 * A library reopens the way this profile left it: the tab last used there, with that tab's last
 * sort and filters. A link that names a tab, a category or a genre is shown as it is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {LibraryMemory, type LibraryMemoryStorage} from '../../../packages/client-core/src/library-memory.ts';
import {linkedView, offeredFilters, openingView, tabView} from '../src/app/library-view.ts';

const tabs = ['discover', 'browse', 'collections'] as const;
type Tab = (typeof tabs)[number];

function memoryWith(saved: Record<string, string> = {}) {
  const held = new Map(Object.entries(saved));
  const storage: LibraryMemoryStorage = {read: key => held.get(key), write: (key, text) => { held.set(key, text); }, remove: key => { held.delete(key); }};
  return {held, storage, memory: new LibraryMemory(storage, {serverId: 'srv', viewerId: 'me'})};
}

test('a library nobody has chosen anything in opens on its first tab, unsorted and unfiltered', () => {
  const {memory} = memoryWith();
  assert.deepEqual(openingView<Tab>({}, memory.recall('films'), tabs, 'discover'), {tab: 'discover', sort: {}, filters: [], recalled: false});
});

test('a plain visit reopens the tab last used, with that tab’s sort and filters', () => {
  const {memory} = memoryWith();
  memory.rememberTab('films', 'browse');
  memory.rememberSort('films', 'browse', {field: 'year', direction: 'desc'});
  memory.rememberFilters('films', 'browse', [{field: 'genre', operator: 'in', value: ['Drama']}]);
  assert.deepEqual(openingView<Tab>({}, memory.recall('films'), tabs, 'discover'), {tab: 'browse', sort: {sort: 'year', direction: 'desc'}, filters: [{field: 'genre', operator: 'in', value: ['Drama']}], recalled: true});
});

test('a link that names a tab, a category or a genre is followed as it is', () => {
  const {memory} = memoryWith();
  memory.rememberTab('films', 'browse');
  memory.rememberSort('films', 'browse', {field: 'year', direction: 'desc'});
  const remembered = memory.recall('films');
  assert.deepEqual(openingView<Tab>({tab: 'collections'}, remembered, tabs, 'discover'), {tab: 'collections', sort: {}, filters: [], recalled: false});
  assert.deepEqual(openingView<Tab>({tab: 'browse'}, remembered, tabs, 'discover'), {tab: 'browse', sort: {}, filters: [], recalled: false}, 'a link to the remembered tab still shows the tab plainly');
  assert.equal(openingView<Tab>({category: 'genre:drama'}, remembered, tabs, 'discover').tab, 'discover');
  assert.equal(openingView<Tab>({tab: 'browse', genre: 'Drama'}, remembered, tabs, 'discover').recalled, false);
  assert.equal(memory.recall('films')?.tab, 'browse', 'following a link remembers nothing');
});

test('a remembered tab the library no longer has is ignored', () => {
  const {memory} = memoryWith();
  memory.rememberTab('films', 'unmatched');
  memory.rememberSort('films', 'unmatched', {field: 'added', direction: 'desc'});
  assert.deepEqual(openingView<Tab>({}, memory.recall('films'), tabs, 'discover'), {tab: 'discover', sort: {}, filters: [], recalled: false});
});

test('each tab comes back with its own choices, and filters do not follow from one tab to another', () => {
  const {memory} = memoryWith();
  memory.rememberFilters('films', 'browse', [{field: 'genre', operator: 'in', value: ['Drama']}]);
  memory.rememberSort('films', 'collections', {field: 'title', direction: 'desc'});
  assert.deepEqual(tabView<Tab>(memory.recall('films'), 'collections'), {tab: 'collections', sort: {sort: 'title', direction: 'desc'}, filters: [], recalled: false});
  assert.deepEqual(tabView<Tab>(memory.recall('films'), 'browse'), {tab: 'browse', sort: {}, filters: [{field: 'genre', operator: 'in', value: ['Drama']}], recalled: true});
  assert.deepEqual(tabView<Tab>(memory.recall('films'), 'discover'), {tab: 'discover', sort: {}, filters: [], recalled: false});
});

test('clearing the filters is remembered as cleared', () => {
  const {memory} = memoryWith();
  memory.rememberFilters('films', 'browse', [{field: 'genre', operator: 'in', value: ['Drama']}]);
  memory.rememberFilters('films', 'browse', []);
  assert.deepEqual(tabView<Tab>(memory.recall('films'), 'browse').filters, []);
});

test('a remembered filter the library no longer offers is left out; one chosen just now is sent as it is', () => {
  const fields = [{id: 'genre', operators: ['in']}, {id: 'year', operators: ['eq', 'between']}];
  const filters = [{field: 'genre', operator: 'in', value: ['Drama']}, {field: 'studio', operator: 'in', value: ['A24']}, {field: 'year', operator: 'gt', value: 2000}];
  assert.deepEqual(offeredFilters({filters, recalled: true}, fields), [filters[0]]);
  assert.equal(offeredFilters({filters, recalled: false}, fields), filters);
  assert.equal(offeredFilters({filters, recalled: true}, undefined), filters, 'nothing is dropped before the library has said what it offers');
  const kept = [filters[0]!];
  assert.equal(offeredFilters({filters: kept, recalled: true}, fields), kept, 'an unchanged list stays the same list');
});

test('a tab opened by a row or a genre carries only what that names', () => {
  assert.deepEqual(linkedView<Tab>('browse', [{field: 'genre', operator: 'in', value: ['Drama']}]), {tab: 'browse', sort: {}, filters: [{field: 'genre', operator: 'in', value: ['Drama']}], recalled: false});
});

test('another profile on the same device has its own choices, and they survive a restart', async () => {
  const first = memoryWith();
  first.memory.rememberTab('films', 'collections');
  const again = new LibraryMemory(first.storage, {serverId: 'srv', viewerId: 'me'});
  assert.equal(openingView<Tab>({}, again.recall('films'), tabs, 'discover').tab, 'collections');
  const other = new LibraryMemory(first.storage, {serverId: 'srv', viewerId: 'someone-else'});
  assert.equal(openingView<Tab>({}, other.recall('films'), tabs, 'discover').tab, 'discover');
});

test('a device store that answers later is read before it decides, and newer choices win over it', async () => {
  const slow = new Map<string, string>();
  const seed = memoryWith();
  seed.memory.rememberTab('films', 'browse');
  seed.memory.rememberTab('shows', 'collections');
  for (const [key, text] of seed.held) slow.set(key, text);
  const storage: LibraryMemoryStorage = {read: async key => slow.get(key), write: async (key, text) => { slow.set(key, text); }, remove: async key => { slow.delete(key); }};
  const memory = new LibraryMemory(storage, {serverId: 'srv', viewerId: 'me'});
  assert.equal(memory.isReady, false);
  memory.rememberTab('films', 'collections');
  await memory.ready;
  assert.equal(memory.isReady, true);
  assert.equal(memory.recall('films')?.tab, 'collections');
  assert.equal(memory.recall('shows')?.tab, 'collections');
});

// ── A tab's own order is only where it starts; category links are filtered tabs ─────────────────

import {categoryDestination, groupTabOpens, tabDefaultSort} from '../src/app/library-view.ts';
import {libraryTab, libraryTabs} from '../../../packages/client-core/src/presentation/index.ts';

test('Recently aired names an order to open in, whichever name the shared tab list gives it', () => {
  assert.deepEqual(tabDefaultSort(libraryTab('tv', 'aired')), {field: 'latestAired', direction: 'desc'});
  assert.equal(tabDefaultSort(libraryTab('tv', 'browse')), undefined);
  // The shared list after its rename: the same order, read the same way.
  const renamed = {id: 'aired', label: 'library.tab.aired', pivot: 'shows', shows: 'titles', defaultSort: {field: 'latestAired', direction: 'desc'}} as never;
  assert.deepEqual(tabDefaultSort(renamed), {field: 'latestAired', direction: 'desc'});
});

test('a category link is the tab that lists its titles with one ordinary filter', () => {
  assert.deepEqual(categoryDestination('movie', 'genre:Drama'), {tab: 'browse', predicate: {field: 'genre', operator: 'contains-any', value: ['Drama']}});
  assert.deepEqual(categoryDestination('tv', 'decade:1990'), {tab: 'browse', predicate: {field: 'decade', operator: 'in', value: [1990]}});
  assert.deepEqual(categoryDestination('movie', 'studio:A24: Films'), {tab: 'browse', predicate: {field: 'studio', operator: 'in', value: ['A24: Films']}});
  // Music genres open albums, as the Genres tab does; an audiobook series opens books.
  assert.equal(categoryDestination('music', 'genre:Jazz')?.tab, 'releases');
  assert.deepEqual(categoryDestination('audiobook', 'series:Dune'), {tab: 'browse', predicate: {field: 'series', operator: 'in', value: ['Dune']}});
});

test('a category this app does not know keeps the server’s own page', () => {
  for (const category of ['mood:Rainy', 'genre:', ':Drama', 'Drama', 'decade:199x']) assert.equal(categoryDestination('movie', category), undefined, category);
});

test('a tab of groups says where a group’s titles are listed', () => {
  const music = libraryTabs('music'), books = libraryTabs('audiobook');
  assert.deepEqual(groupTabOpens(music.find(t => t.id === 'genres')!, music), {tab: 'releases', field: 'genre'});
  assert.deepEqual(groupTabOpens(books.find(t => t.id === 'series')!, books), {tab: 'browse', field: 'series'});
  assert.equal(groupTabOpens(music.find(t => t.id === 'songs')!, music), undefined);
});
