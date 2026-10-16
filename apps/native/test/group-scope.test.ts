/** A group of a library's titles as something the common browse route can sort and filter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistPivot, savedViewScope, collectionScope, containerScope, groupBrowsable, groupEngaged, groupKey, groupPredicates, listScope, namedGroupScope, noGroupChoice, personScope, titlePivot} from '../src/app/group-scope.ts';

const field = (id: string, operators: string[]) => ({id, labelKey: 'browse.field.' + id, type: 'string', operators, controlHint: 'text', complexity: 'standard', cost: 'indexed', applicableKinds: ['movie']});
const sort = (id: string) => ({id, labelKey: 'sort.' + id, directions: ['asc', 'desc'], defaultDirection: 'asc', expensive: false, applicableKinds: ['movie']});
const pivot = (id: string, more: Record<string, unknown> = {}) => ({id, labelKey: 'library.' + id, entityKinds: ['movie'], defaultSort: [{field: 'title', direction: 'asc'}], supportedViews: ['grid'], browsable: true, ...more});
const surfaces = [{id: 'library', endpoint: '/v1/libraries/{id}/browse', sorts: ['title'], filters: [], paging: 'keyset'}, {id: 'collection-titles', endpoint: '/v1/libraries/{id}/browse', membershipField: 'collection', sorts: ['title'], filters: ['collection'], paging: 'keyset'}, {id: 'container-titles', endpoint: '/v1/libraries/{id}/browse', membershipField: 'memberOf', sorts: ['title'], filters: ['memberOf'], paging: 'keyset'}];
const capabilities = (over: Record<string, unknown> = {}) => ({library: {id: 'lib', name: 'Films', kind: 'movie', defaultView: 'movies', pinned: false}, pivots: [pivot('movies')], resolvedPivot: pivot('movies'), fields: [field('collection', ['equals', 'in']), field('memberOf', ['equals', 'in']), field('genre', ['contains-any'])], sorts: [sort('title'), sort('year')], quickFilters: [], queryLimits: {maximumDepth: 4, maximumClauses: 32, maximumBytes: 8192, maximumSorts: 1, defaultLimit: 60, maximumLimit: 200, cursorTtlMs: 600000}, surfaces, ...over}) as never;

test('each kind of library has the pivot its titles are browsed as', () => {
  assert.deepEqual(['movie', 'tv', 'anime', 'music', 'audiobook', 'recordings', undefined].map(titlePivot), ['movies', 'shows', 'shows', 'albums', 'books', undefined, undefined]);
});

test('a scope names the group by one condition, and nothing without a library, a pivot and an id', () => {
  assert.deepEqual(collectionScope('lib', 'movie', 'c1'), {libraryId: 'lib', pivot: 'movies', surface: 'collection-titles', base: [{field: 'collection', operator: 'equals', value: 'c1'}], always: true}, 'a collection lists in its own order from the start');
  assert.deepEqual(containerScope('lib', 'episodes', 'season1'), {libraryId: 'lib', pivot: 'episodes', surface: 'container-titles', base: [{field: 'memberOf', operator: 'equals', value: 'season1'}]});
  assert.deepEqual(personScope('lib', 'tv', 'p1')?.base, [{field: 'person', operator: 'equals', value: 'p1'}]);
  assert.deepEqual(listScope('lib', 'songs', 'pl1')?.surface, 'list-titles');
  assert.deepEqual(namedGroupScope('lib', 'books', {field: 'series', operator: 'in', value: ['Dune']})?.surface, 'group-titles');
  assert.equal(collectionScope('lib', 'recordings', 'c1'), undefined);
  assert.equal(containerScope('lib', 'songs', undefined), undefined);
  assert.equal(personScope('', 'movie', 'p1'), undefined);
});

test('the group’s condition always leads what is asked, whatever the viewer chooses or clears', () => {
  const scope = collectionScope('lib', 'movie', 'c1')!;
  const genre = {field: 'genre', operator: 'contains-any', value: ['Drama']} as const;
  assert.deepEqual(groupPredicates(scope, [genre]), [scope.base[0], genre]);
  assert.deepEqual(groupPredicates(scope, []), scope.base, 'clearing every filter leaves the group, never the library');
});

test('a group is sorted and filtered only when the server’s vocabulary covers it', () => {
  const scope = collectionScope('lib', 'movie', 'c1')!;
  assert.equal(groupBrowsable(capabilities(), scope), true);
  assert.equal(groupBrowsable(undefined, scope), false);
  assert.equal(groupBrowsable(capabilities(), undefined), false);
  // The surface is not one this server names, or its membership field is another.
  assert.equal(groupBrowsable(capabilities({surfaces: [surfaces[0]]}), scope), false);
  assert.equal(groupBrowsable(capabilities(), {...scope, surface: 'container-titles'}), false);
  // The condition's field or operator is not accepted.
  assert.equal(groupBrowsable(capabilities({fields: [field('genre', ['contains-any'])]}), scope), false);
  assert.equal(groupBrowsable(capabilities({fields: [field('collection', ['in'])]}), scope), false);
  // Another pivot answered, a pivot of groups, or nothing to sort by.
  assert.equal(groupBrowsable(capabilities({resolvedPivot: pivot('shows')}), scope), false);
  assert.equal(groupBrowsable(capabilities({resolvedPivot: pivot('movies', {aggregate: 'genre'})}), scope), false);
  assert.equal(groupBrowsable(capabilities({sorts: []}), scope), false);
  // A server that names no surfaces at all is judged by its fields.
  assert.equal(groupBrowsable(capabilities({surfaces: undefined}), scope), true);
});

test('a group is its own page until the viewer chooses a sort or a filter', () => {
  assert.equal(groupEngaged(noGroupChoice), false);
  assert.equal(groupEngaged({sort: {field: 'year', direction: 'desc'}, predicates: []}), true);
  assert.equal(groupEngaged({predicates: [{field: 'genre', operator: 'contains-any', value: ['Drama']}]}), true);
});

test('another group is another identity', () => {
  assert.notEqual(groupKey(collectionScope('lib', 'movie', 'c1')), groupKey(collectionScope('lib', 'movie', 'c2')));
  assert.equal(groupKey(collectionScope('lib', 'movie', 'c1')), groupKey(collectionScope('lib', 'movie', 'c1')));
  assert.equal(groupKey(undefined), '');
});

test('a saved view is browsed as it was saved, and narrowed, never widened', () => {
  const query = {all: [{field: 'genre', operator: 'contains-any', value: ['Drama']}, {not: {field: 'playState', operator: 'equals', value: 'watched'}}]} as never;
  const scope = savedViewScope({libraryId: 'lib', pivot: 'movies', query})!;
  assert.deepEqual(scope, {libraryId: 'lib', pivot: 'movies', surface: 'saved-view', base: [query]});
  const year = {field: 'year', operator: 'at-least', value: 2000} as const;
  assert.deepEqual(groupPredicates(scope, [year]), [query, year]);
  // A view that keeps the whole pivot has no condition of its own; one that was never readable is no group.
  assert.deepEqual(savedViewScope({libraryId: 'lib', pivot: 'movies', query: null})!.base, []);
  assert.equal(savedViewScope(undefined), undefined);
  assert.equal(groupBrowsable(capabilities({surfaces: [...surfaces, {id: 'saved-view', endpoint: '/v1/libraries/{id}/browse', sorts: ['title'], filters: [], paging: 'keyset'}]}), scope), true);
});

test('a playlist is browsed as the things it holds', () => {
  assert.deepEqual(['movie', 'tv', 'anime', 'music', 'audiobook'].map(playlistPivot), ['movies', 'episodes', 'episodes', 'songs', undefined]);
});

test('lists that span libraries are one scope across them; flat-show groups and discs are named to the server', async () => {
  const {acrossScope, episodeGroupScope, discScope, groupKeepsOwnOrder} = await import('../src/app/group-scope.ts');
  assert.deepEqual(acrossScope('watchlist'), {libraryId: '*', pivot: 'titles', surface: 'watchlist', base: [{field: 'watchlisted', operator: 'equals', value: true}]});
  assert.deepEqual(acrossScope('list', 'p1'), {libraryId: '*', pivot: 'items', surface: 'list-titles', base: [{field: 'list', operator: 'equals', value: 'p1'}]});
  assert.equal(acrossScope('crew', 'x').surface, 'crew-titles');
  assert.deepEqual(episodeGroupScope('tv', 's1', 'range:100'), {libraryId: 'tv', pivot: 'episodes', surface: 'episode-group', base: [{field: 'episodeGroup', operator: 'equals', value: 's1/range:100'}]});
  assert.equal(episodeGroupScope('tv', undefined, 'all'), undefined);
  assert.deepEqual(discScope('m', 'alb:disc:2')?.base, [{field: 'memberOf', operator: 'equals', value: 'alb'}, {field: 'discNumber', operator: 'equals', value: 2}]);
  assert.equal(discScope('m', 'alb'), undefined);
  assert.equal(groupKeepsOwnOrder(acrossScope('list', 'p1')), true);
  assert.equal(groupKeepsOwnOrder(acrossScope('watchlist')), false);
});
