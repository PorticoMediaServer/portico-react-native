import test from 'node:test';
import {libraryTabForPivot} from '../../../packages/client-core/src/presentation/library-tabs.ts';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import * as home from '../../../packages/client-core/src/home.ts';
import {serverTextLabel} from '../../../packages/client-core/src/presentation/server-text.ts';
import {screenModule} from './helpers/screen-harness.mjs';

// Recommendations P7 on Apple: Customize Home (Picks for you once; saved views added and removed),
// section titles from titleText, and a Discover section's See all into browse.

const ui = new Proxy({}, {get: (_, name) => (name === 'useTheme' ? () => ({space: {}}) : String(name))});
const customise = await screenModule(new URL('../src/screens/HomeCustomise.tsx', import.meta.url), {
  react: {default: {}}, 'react-native': {View: 'View'}, '../../../../packages/client-core/src/home': home,
  '../../../../packages/client-core/src/presentation/server-text': {serverTextLabel}, '../../../../packages/client-core/src/personal-saved': {PersonalSavedService: class {}},
  '../app/content': {}, '../app/detail': {}, '../app/session': {}, '../ui': ui, '../app/i18n': {}, '../app/errors': {},
});

const layout: any = {revision: 4, rowOrder: [], hiddenRowIds: ['for_you'], rows: [
  {id: 'continue', title: 'Continue Watching', kind: 'continue', artworkShape: 'landscape', required: true, hideable: false, reorderable: true, hidden: false},
  {id: 'for_you', title: 'Picks for you', titleText: {code: 'home.row.picksForYou', fallback: 'Picks for you'}, kind: 'family', artworkShape: 'poster', required: false, hideable: true, reorderable: true, hidden: true},
  {id: 'for_you:genre:drama', title: 'Drama for you', kind: 'recommendation', artworkShape: 'poster', required: false, hideable: true, reorderable: true, hidden: false},
  {id: 'view:v1', title: 'Eighties action', kind: 'saved_view', artworkShape: 'poster', required: false, hideable: true, reorderable: true, hidden: false},
]};

test('Customize lists Picks for you once and every saved view, never a generator', () => {
  const lists = customise.customiseLists(layout);
  assert.deepEqual(lists.order, ['continue', 'for_you', 'view:v1']);
  assert.deepEqual(lists.hidden, ['for_you']);
  assert.equal(serverTextLabel(defaultI18n, layout.rows[1].titleText, 'x'), 'Picks for you');
});

test('a saved view is added last, once, and removed by dropping its id', () => {
  const order = customise.addViewRow(['continue', 'for_you'], 'v2');
  assert.deepEqual(order, ['continue', 'for_you', 'view:v2']);
  assert.deepEqual(customise.addViewRow(order, 'v2'), order);
  const removed = customise.removeViewRow(['continue', 'view:v1'], new Set(['view:v1']), 'view:v1');
  assert.deepEqual(removed.order, ['continue']);
  assert.equal(removed.hidden.size, 0);
  const payload = customise.customiseSavePayload(layout, ['for_you', 'continue', 'view:v2'], ['for_you', 'view:gone']);
  assert.deepEqual(payload, {rowOrder: ['for_you', 'continue', 'view:v2'], hiddenRowIds: ['for_you'], expectedRevision: 4});
  assert.equal(home.homeViewResourceId('view:v2'), 'v2');
  assert.equal(home.homeViewResourceId('recommended'), undefined);
});

test('Home and Discover rows are named by their title code and params', () => {
  const heading = home.homeRowHeading({id: 'for_you:person:tmdb:1', title: 'More with Ada', titleText: {code: 'home.row.moreWith', params: {name: 'Ada Lovelace'}, fallback: 'More with Ada'}});
  assert.equal(serverTextLabel(defaultI18n, heading, heading.fallback), 'More with Ada Lovelace');
  assert.deepEqual(home.homeRowHeading({id: 'recent_x', title: 'Recently added'}), {key: 'recent_x', fallback: 'Recently added'});
});

test('Discover See all targets only pivots the library can browse', () => {
  // The tabs are authored in client-core (`library-tabs.ts`); a row's See all names a pivot.
  assert.equal(libraryTabForPivot('movie', 'movies')?.id, 'browse');
  assert.equal(libraryTabForPivot('anime', 'shows')?.id, 'browse');
  assert.equal(libraryTabForPivot('music', 'albums')?.id, 'releases');
  assert.equal(libraryTabForPivot('movie', 'albums'), undefined);
  // Recently aired reads the episodes pivot in its own order: a See all never lands there.
  assert.equal(libraryTabForPivot('tv', 'episodes'), undefined);
});
