import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeBrowseCapabilities, offeredBrowseSort} from '../src/app/browse-options.ts';
import {toolbarModel} from '../../../packages/client-core/src/presentation/browse-toolbar.ts';
import type {BrowseCapabilities} from '../../../packages/client-core/src/browse.ts';

const capabilities: BrowseCapabilities = {
  library: {id: 'music', name: 'Music', kind: 'music', defaultView: 'albums', pinned: true},
  pivots: [
    {id: 'albums', labelKey: 'albums', entityKinds: ['album'], defaultSort: [{field: 'year', direction: 'desc'}], supportedViews: ['grid'], browsable: true, sorts: ['title', 'year'], filters: ['genre', 'favorite']},
    {id: 'genres', labelKey: 'genres', entityKinds: [], defaultSort: [{field: 'title', direction: 'asc'}], supportedViews: ['grid'], browsable: true, sorts: ['title', 'count'], filters: ['genre']},
  ],
  resolvedPivot: null,
  sorts: ['title', 'year', 'count', 'trackNumber'].map(id => ({id, labelKey: id, directions: ['asc', 'desc'], defaultDirection: 'asc', expensive: false, applicableKinds: []})),
  fields: ['genre', 'favorite', 'memberOf'].map(id => ({id, labelKey: id, type: id === 'favorite' ? 'boolean' : 'string', operators: ['equals'], controlHint: 'text', complexity: 'quick', cost: 'indexed', applicableKinds: []})),
  quickFilters: [{id: 'favorites', labelKey: 'favorites', query: {field: 'favorite', operator: 'equals', value: true}}, {id: 'watched', labelKey: 'watched', query: {all: [{field: 'favorite', operator: 'equals', value: true}, {field: 'watched', operator: 'equals', value: true}]}}],
  surfaces: [{id: 'library', endpoint: '/v1/libraries/{id}/browse', paging: 'keyset', sorts: ['title', 'year', 'count'], filters: ['genre', 'favorite']}, {id: 'group-titles', endpoint: '/v1/libraries/{id}/browse', paging: 'keyset', sorts: ['title'], filters: ['genre']}],
  queryLimits: {maximumDepth: 6, maximumClauses: 50, maximumBytes: 8192, maximumSorts: 1, defaultLimit: 60, maximumLimit: 200, cursorTtlMs: 600000},
};

test('the actual toolbar only offers the selected pivot vocabulary', () => {
  const scoped = scopeBrowseCapabilities(capabilities, 'albums');
  const model = toolbarModel(scoped, 'music', [], {field: 'title', direction: 'asc'});
  assert.deepEqual(model.sorts.map(s => s.id), ['title', 'year']);
  assert.deepEqual(scoped.fields.map(f => f.id), ['genre', 'favorite']);
  assert.deepEqual(model.quick.map(q => q.id), ['favorites']);
  assert.equal(scoped.resolvedPivot?.id, 'albums');
  assert.deepEqual(capabilities.sorts.map(s => s.id), ['title', 'year', 'count', 'trackNumber']);
});

test('a title group intersects its surface and pivot and selects a supported default', () => {
  const scoped = scopeBrowseCapabilities(capabilities, 'albums', 'group-titles');
  assert.deepEqual(scoped.sorts.map(s => s.id), ['title']);
  assert.deepEqual(scoped.fields.map(f => f.id), ['genre']);
  assert.deepEqual(scoped.quickFilters, []);
  assert.deepEqual(offeredBrowseSort(scoped, {field: 'year', direction: 'desc'}), {field: 'title', direction: 'asc'});
});

test('aggregates offer their own count order and never track or title-member order', () => {
  const scoped = scopeBrowseCapabilities(capabilities, 'genres');
  assert.deepEqual(scoped.sorts.map(s => s.id), ['title', 'count']);
  assert.deepEqual(scoped.quickFilters, []);
});

test('empty or unreadable pivot lists do not offer the library-wide vocabulary', () => {
  const pivot = {...capabilities.pivots[0]!, sorts: [], filters: []};
  for (const p of [pivot, {...pivot, sorts: undefined, filters: undefined}]) {
    const scoped = scopeBrowseCapabilities({...capabilities, pivots: [p]}, 'albums');
    assert.deepEqual(scoped.sorts, []); assert.deepEqual(scoped.fields, []); assert.deepEqual(scoped.quickFilters, []);
  }
});

test('a still-supported seeded sort keeps its seed and adjusts an unsupported direction', () => {
  const scoped = scopeBrowseCapabilities({...capabilities, sorts: capabilities.sorts.map(s => s.id === 'year' ? {...s, directions: ['desc'], defaultDirection: 'desc'} : s)}, 'albums');
  assert.deepEqual(offeredBrowseSort(scoped, {field: 'year', direction: 'asc', seed: 42}), {field: 'year', direction: 'desc', seed: 42});
});

test('a missing surface advertisement never borrows another surface options', () => {
  const scoped = scopeBrowseCapabilities(capabilities, 'albums', 'container-titles');
  assert.deepEqual(scoped.sorts, []); assert.deepEqual(scoped.fields, []); assert.deepEqual(scoped.quickFilters, []);
});
