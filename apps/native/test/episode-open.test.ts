import test from 'node:test';
import assert from 'node:assert/strict';
import {LANDING_HOLD, LANDING_MS, episodeContext, episodeRowLayout, landingGuess, nextUpChip, plateColors, toggledEpisode} from '../src/screens/title/episode-open.ts';
import {routeForEntry} from '../src/app/entry-route.ts';
import type {ContentEntry} from '../../../packages/client-core/src/library-content.ts';

test('the next-up chip sits on the next-up row only: Continue when in progress, else Next up', () => {
  const nextUp = {id: 'e3', progressSeconds: 0};
  assert.equal(nextUpChip({id: 'e3'}, nextUp), 'title.nextUp');
  assert.equal(nextUpChip({id: 'e4'}, nextUp), undefined);
  assert.equal(nextUpChip({id: 'e3'}, {id: 'e3', progressSeconds: 312}), 'title.continueEpisode');
  // A finished episode is not "in progress" even with a position left over.
  assert.equal(nextUpChip({id: 'e3'}, {id: 'e3', progressSeconds: 312, watched: true}), 'title.nextUp');
  assert.equal(nextUpChip({id: 'e3'}, undefined), undefined);
  assert.equal(nextUpChip(undefined, nextUp), undefined);
});

test('choosing an episode opens it, choosing it again closes it, one open at a time', () => {
  assert.equal(toggledEpisode(undefined, 'e1'), 'e1');
  assert.equal(toggledEpisode('e1', 'e1'), undefined);
  assert.equal(toggledEpisode('e1', 'e2'), 'e2');
});

test('rows after the open one move down by its details; the rest keep their places', () => {
  const g = {row: 100, header: 500, extra: 0};
  assert.deepEqual(episodeRowLayout(3, g), {length: 100, offset: 800, index: 3});
  const open = {row: 100, header: 500, open: 2, extra: 340};
  assert.deepEqual(episodeRowLayout(1, open), {length: 100, offset: 600, index: 1});
  assert.deepEqual(episodeRowLayout(2, open), {length: 440, offset: 700, index: 2});
  assert.deepEqual(episodeRowLayout(3, open), {length: 100, offset: 1140, index: 3});
  // Not yet measured: nothing moves.
  assert.deepEqual(episodeRowLayout(3, {...open, extra: 0}), {length: 100, offset: 800, index: 3});
});

test('a landing episode is looked for near where its number puts it, within the list', () => {
  assert.equal(landingGuess({seasonNumber: 2, episodeNumber: 7}, {seasonNumber: 2, episodeNumber: 1}, 10), 6);
  // Anime numbered across seasons: episode 1043 of a list that starts at 1.
  assert.equal(landingGuess({absoluteNumber: 1043}, {absoluteNumber: 1}, 1100), 1042);
  // Clamped to the list; nothing to go on means the top.
  assert.equal(landingGuess({seasonNumber: 1, episodeNumber: 40}, {seasonNumber: 1, episodeNumber: 1}, 12), 11);
  assert.equal(landingGuess({seasonNumber: 1, episodeNumber: 4}, {seasonNumber: 2, episodeNumber: 1}, 12), 0);
  assert.equal(landingGuess({episodeNumber: 4}, undefined, 12), 0);
  assert.equal(landingGuess({episodeNumber: 4}, {episodeNumber: 1}, 0), 0);
});

test('the context line names the show and the season, or Specials', () => {
  const t = (key: string, values?: {number: number}) => (key === 'title.specials' ? 'Specials' : `Season ${values?.number}`);
  assert.equal(episodeContext(t, 'Breaking Bad', 2), 'Breaking Bad · Season 2');
  assert.equal(episodeContext(t, 'Breaking Bad', 0), 'Breaking Bad · Specials');
  assert.equal(episodeContext(t, undefined, 3), 'Season 3');
  assert.equal(episodeContext(t, 'Breaking Bad', undefined), 'Breaking Bad');
});

test('the plate is opaque, in the show\'s own colour, and stable for a show', () => {
  const a = plateColors('show-1', '#071018', '#edf5fa', '#10212d');
  assert.match(a.plate, /^#[0-9a-f]{6}$/);
  assert.match(a.solid, /^#[0-9a-f]{6}$/);
  assert.match(a.tint, /^#[0-9a-f]{6}$/);
  assert.equal(a.washAlpha, 0.34);
  assert.deepEqual(plateColors('show-1', '#071018', '#edf5fa', '#10212d'), a);
  assert.notEqual(plateColors('show-2', '#071018', '#edf5fa', '#10212d').plate, a.plate);
  // A soft lift over the page, never a bright box.
  const lum = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
  assert.ok(lum(a.plate) > lum('#071018') && lum(a.plate) < 60);
  assert.ok(LANDING_MS >= 2000 && LANDING_HOLD > 0 && LANDING_HOLD < 1);
});

test('an episode from a row elsewhere opens its show at that episode, named by the show until it loads', () => {
  const episode = {id: 'e9', libraryId: 'tv', kind: 'episode', title: 'Ozymandias', subtitle: 'Breaking Bad · S5 E14', navigation: {view: 'item', entityId: 'e9'}} as ContentEntry;
  assert.deepEqual(routeForEntry(episode), {name: 'Show', params: {libraryId: 'tv', episodeId: 'e9', title: 'Breaking Bad'}});
  const movie = {id: 'm1', libraryId: 'films', kind: 'movie', title: 'Heat', navigation: {view: 'item', entityId: 'm1'}} as ContentEntry;
  assert.deepEqual(routeForEntry(movie), {name: 'Detail', params: {libraryId: 'films', itemId: 'm1'}});
  const show = {id: 's1', libraryId: 'tv', kind: 'show', title: 'Breaking Bad', navigation: {view: 'show', entityId: 's1'}} as ContentEntry;
  assert.deepEqual(routeForEntry(show), {name: 'Show', params: {libraryId: 'tv', showId: 's1', title: 'Breaking Bad'}});
  assert.equal(routeForEntry({...movie, navigation: undefined}), null);
});
