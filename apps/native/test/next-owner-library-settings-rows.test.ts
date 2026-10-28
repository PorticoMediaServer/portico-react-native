import test from 'node:test';
import assert from 'node:assert/strict';
import type {LibraryAdminDocument} from '../../../packages/client-core/src/administration';
import type {SettingsRow} from '../../../packages/client-core/src/presentation/settings-spec';
import {libraryListState, libraryNumberValue, libraryRowOptions, libraryRowVisible} from '../src-next/screens/settings-live/owner-libraries/library-settings-model.ts';

test('empty libraries is shown only after a successful directory read', () => {
  assert.equal(libraryListState('loading', 0), 'loading');
  assert.equal(libraryListState('idle', 0), 'loading');
  assert.equal(libraryListState('error', 0), 'none');
  assert.equal(libraryListState('ready', 0), 'empty');
  assert.equal(libraryListState('loading', 3), 'rows');
});

test('kind filters cannot grant a library control absent from producer eligibility', () => {
  assert.equal(libraryRowVisible('libraries.collections', {libraryKind: 'movie', eligibleControls: []}), false);
  const eligibleControls = ['libraries.collections', 'libraries.lyrics', 'libraries.acoustid', 'libraries.episodeNumbering'];
  assert.equal(libraryRowVisible('libraries.collections', {libraryKind: 'movie', eligibleControls}), true);
  assert.equal(libraryRowVisible('libraries.collections', {libraryKind: 'tv', eligibleControls}), false);
  assert.equal(libraryRowVisible('libraries.lyrics', {libraryKind: 'music', eligibleControls}), true);
  assert.equal(libraryRowVisible('libraries.acoustid', {libraryKind: 'audiobook', eligibleControls}), false);
  assert.equal(libraryRowVisible('libraries.episodeNumbering', {libraryKind: 'anime', eligibleControls}), true);
});

test('provider choices respect the actual media-kind capabilities and local-tag vocabulary', () => {
  const document = {libraryKind: 'anime', availableProviders: [{id: 'tmdb', mediaKinds: ['movie']}, {id: 'anilist', mediaKinds: ['show']}]} as LibraryAdminDocument;
  const providers = {id: 'libraries.titlesFrom', control: {type: 'select', options: [{value: 'tmdb'}, {value: 'anilist'}, {value: 'local'}]}} as SettingsRow;
  assert.deepEqual(libraryRowOptions(providers, document).map(option => option.value), ['anilist']);
  const local = {id: 'libraries.localTags', control: {type: 'select', options: [{value: 'prefer'}, {value: 'supplement'}, {value: 'off'}]}} as SettingsRow;
  assert.deepEqual(libraryRowOptions(local, document).map(option => option.value), ['prefer', 'off']);
  assert.equal(libraryRowOptions(local, {...document, libraryKind: 'music'}).length, 3);
});

test('preview values reject blanks, fractional steps, overflow and out-of-range input', () => {
  const width = {control: {type: 'number', min: 120, max: 640, step: 40}} as SettingsRow;
  for (const value of ['', '121', '-1', '641', '200.5', '1e3', 'Infinity']) assert.equal(libraryNumberValue(value, width), undefined, value);
  assert.equal(libraryNumberValue('320', width), 320);
  assert.equal(libraryNumberValue(' 640 ', width), 640);
});
