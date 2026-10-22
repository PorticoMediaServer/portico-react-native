import {test} from 'node:test';
import assert from 'node:assert/strict';
import {holdFraction, selectionCircleGeometry, selectionIntent} from '../src-next/kit/selection/selection-geometry.ts';

test('phone and TV circle geometry follows their own selection frames', () => {
  assert.deepEqual(selectionCircleGeometry(false), {diameter: 24, border: 2, check: 16});
  assert.equal(selectionCircleGeometry(true).diameter, 44);
  assert.equal(selectionCircleGeometry(false, 26).diameter, 26);
});
test('semantic intent distinguishes entering, toggling and extending a range', () => {
  assert.deepEqual(selectionIntent(false, false), {intent: 'enter'});
  assert.deepEqual(selectionIntent(false, true), {intent: 'toggle'});
  assert.deepEqual(selectionIntent(true, false), {intent: 'toggle'});
  assert.deepEqual(selectionIntent(false, true, true), {intent: 'range', shiftKey: true});
});
test('hold feedback never fabricates progress when measurement is absent', () => {
  assert.equal(holdFraction(null), null);
  assert.equal(holdFraction(NaN), null);
  assert.equal(holdFraction(.53), .53);
  assert.equal(holdFraction(-1), 0);
  assert.equal(holdFraction(2), 1);
});

import {changeList, changeScalar, deleteSelectionGate, failedSelectionIds, removeFieldChange, setListChange} from '../src-next/kit/selection/presentation.ts';
import type {DeletePreview} from '../../../packages/client-core/src/administration.ts';

const preview: DeletePreview = {
  revision: 7, confirmation: '4', confirmationKind: 'count', totalBytes: 0, totalFiles: 4, totalBytesText: '0 B', blocked: [],
  targets: ['a', 'b', 'c', 'd'].map(itemId => ({itemId, title: itemId, kind: 'movie', libraryId: 'one', libraryName: 'one', allowMediaDeletion: true, titles: 1, bytes: 0, files: [], dependents: []})),
};
const valid = {owner: true, selectionCount: 4, preview, confirmation: '4'};
test('deletion requires an exact preview and confirmation, with one library and no safety blocks', () => {
  assert.equal(deleteSelectionGate(valid), null);
  assert.equal(deleteSelectionGate({...valid, owner: false}), 'owner');
  assert.equal(deleteSelectionGate({...valid, preview: null}), 'preview');
  assert.equal(deleteSelectionGate({...valid, selectionCount: 5}), 'preview');
  assert.equal(deleteSelectionGate({...valid, confirmation: ' 4'}), 'confirmation');
  assert.equal(deleteSelectionGate({...valid, confirmation: ''}), 'confirmation');
  assert.equal(deleteSelectionGate({...valid, pending: true}), 'pending');
  assert.equal(deleteSelectionGate({...valid, selectionCount: 240}), 'limit');
  assert.equal(deleteSelectionGate({...valid, preview: {...preview, blocked: ['one']}}), 'blocked');
  assert.equal(deleteSelectionGate({...valid, preview: {...preview, targets: preview.targets.map((target, index) => index ? target : {...target, libraryId: 'two'})}}), 'libraries');
  assert.equal(deleteSelectionGate({...valid, preview: {...preview, targets: preview.targets.map((target, index) => index ? target : {...target, allowMediaDeletion: false})}}), 'blocked');
});
test('partial retries retain only failed ids, without repeating prior successes', () => {
  assert.deepEqual(failedSelectionIds([{id: 'a', ok: true}, {id: 'b', ok: false}, {id: 'c', ok: true}, {id: 'b', ok: false}]), ['b']);
  assert.deepEqual(failedSelectionIds([{id: 'a', ok: true}]), []);
});
test('editing a scalar never writes untouched Mixed values and reset restores omission', () => {
  const original = {tags: {add: ['night'], remove: []}};
  const changed = changeScalar(original, 'contentRating', 'G');
  assert.deepEqual(changed, {tags: {add: ['night'], remove: []}, contentRating: {value: 'G'}});
  assert.deepEqual(original, {tags: {add: ['night'], remove: []}});
  assert.deepEqual(removeFieldChange(changed, 'contentRating'), original);
});
test('list changes stay incremental and cannot add and remove one value together', () => {
  const added = changeList({}, 'tags', 'night', 'add');
  assert.deepEqual(changeList(added, 'tags', 'night', 'add'), {tags: {add: ['night'], remove: []}});
  assert.deepEqual(changeList(added, 'tags', 'night', 'remove'), {tags: {add: [], remove: ['night']}});
  assert.deepEqual(added, {tags: {add: ['night'], remove: []}});
});

test('undoing the last list change leaves the field entirely untouched', () => {
  assert.deepEqual(setListChange({tags: {add: ['night'], remove: []}}, 'tags', [], []), {});
});

test('a refreshed preview changes the confirmation instead of reusing a prior title', () => {
  const single = {...preview, confirmationKind: 'title' as const, confirmation: 'Current title', targets: preview.targets.slice(0, 1)};
  assert.equal(deleteSelectionGate({owner: true, selectionCount: 1, preview: single, confirmation: 'Old title'}), 'confirmation');
  assert.equal(deleteSelectionGate({owner: true, selectionCount: 1, preview: single, confirmation: 'Current title'}), null);
  assert.equal(deleteSelectionGate({owner: true, selectionCount: 1, preview: single, confirmation: 'Current title', loading: true}), 'preview');
});
