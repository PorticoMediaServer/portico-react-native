import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeRowFilterChange, nativeRowFilterField, nativeRowFilterValues} from '../src-next/screens/home/row-filters';
import type {BrowseFieldCapability, BrowseNode} from '../../../packages/client-core/src/browse';
const field: BrowseFieldCapability = {id: 'genre', labelKey: 'browse.field.genre', type: 'enum', operators: ['contains-any', 'contains-all'], controlHint: 'facet-multi-select', complexity: 'quick', cost: 'indexed', applicableKinds: ['movie']};
const now = new Date('2026-10-23T00:00:00Z');
test('changing a row facet preserves other-field compounds and makes exact inclusion/exclusion predicates', () => {
  const compound: BrowseNode = {any: [{field: 'year', operator: 'equals', value: 2026}, {field: 'genre', operator: 'contains-any', value: ['Drama']}]};
  const filters: BrowseNode[] = [compound, {field: 'genre', operator: 'contains-any', value: ['Comedy']}];
  assert.equal(nativeRowFilterField(compound), undefined);
  assert.deepEqual(nativeRowFilterChange(field, {kind: 'values', included: ['Action'], excluded: ['Horror'], mode: 'all'}, filters, now),
    [compound, {field: 'genre', operator: 'contains-all', value: ['Action']}, {not: {field: 'genre', operator: 'contains-any', value: ['Horror']}}]);
  assert.deepEqual(filters[1], {field: 'genre', operator: 'contains-any', value: ['Comedy']});
  assert.throws(() => nativeRowFilterChange({...field, operators: ['contains-any']}, {kind: 'values', included: ['Action'], excluded: [], mode: 'all'}, [], now), /not_offered/);
});
test('clearing a row control removes only its own predicates, including its negative group', () => {
  const other: BrowseNode = {field: 'homeRow', operator: 'equals', value: 'actual-row'};
  assert.deepEqual(nativeRowFilterChange(field, {kind: 'values', included: [], excluded: [], mode: 'any'}, [other, {not: {field: 'genre', operator: 'contains-any', value: ['Horror']}}], now), [other]);
  assert.throws(() => nativeRowFilterChange({...field, id: 'durationMs', type: 'number'}, {kind: 'range', value: 'invented'}, [], now), /not_offered/);
});


test('editing a negative-only genre keeps every selected genre excluded', () => {
  const filters: BrowseNode[] = [{not: {field: 'genre', operator: 'contains-any', value: ['Horror']}}];
  const control = nativeRowFilterValues(field, filters);
  assert.deepEqual(control, {kind: 'values', included: ['Horror'], excluded: [], mode: 'none'});
  const next = nativeRowFilterChange(field, {...control, included: [...control.included, 'Thriller']}, filters, now);
  assert.deepEqual(next, [{not: {field: 'genre', operator: 'contains-any', value: ['Horror', 'Thriller']}}]);
  assert.deepEqual(filters, [{not: {field: 'genre', operator: 'contains-any', value: ['Horror']}}]);
});
