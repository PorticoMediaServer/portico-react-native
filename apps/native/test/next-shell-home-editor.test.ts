import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeBulkChanges, nativeBulkDraft, nativeBulkValues} from '../src-next/shell/selection-editor';
import type {BulkMetadataPreview} from '../../../packages/client-core/src/home-selection/metadata-preview';

test('Mixed uses the authoritative distinct count rather than its truncated example window', () => {
  const preview: BulkMetadataPreview = {serverId: 's', viewerFence: 'v', contentKind: 'movie', kind: 'item', total: 100, targets: [], singleItemFields: [], excludedFields: [],
    schema: [{field: 'year', label: 'year', group: 'numbers', type: 'integer', bulk: true}],
    fields: {year: {state: 'mixed', distinctCount: 90, values: Array.from({length: 64}, (_, index) => ({value: String(index), count: 1})), entries: [], locked: 0, truncated: true}}};
  assert.deepEqual(nativeBulkValues(preview).year, {state: 'mixed', distinctCount: 90, truncated: true, values: preview.fields.year.values, entries: []});
  assert.deepEqual(nativeBulkDraft({}, true), {lockEdited: true});
});

test('bulk adaptation preserves list add/remove and explicit blank scalar without replacing Mixed values', () => {
  const changes = {studio: {value: ''}, tags: {add: ['tag-a'], remove: ['tag-b']}, genres: {add: ['genre-a'], remove: []}};
  const draft = nativeBulkDraft(changes, true);
  assert.deepEqual(draft, {fields: {studio: {value: ''}}, lists: {tags: {add: ['tag-a'], remove: ['tag-b']}}, genres: {add: ['genre-a'], remove: []}, lockEdited: true});
  assert.deepEqual(nativeBulkChanges(draft), changes);
});

test('a list without a lawful add/remove contract cannot become an aggregate replacement', () => {
  assert.throws(() => nativeBulkDraft({unknown: {add: ['a'], remove: []}}, true), /unsupported_bulk_list_change/);
});
