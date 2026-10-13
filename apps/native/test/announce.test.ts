/**
 * A screen reader hears the name of the screen it has arrived at once, and a card's spoken name
 * says what its artwork shows (watched, how far in).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DestinationAnnouncer} from '../src/ui/announce.ts';
import {cardName} from '../src/ui/card-name.ts';

test('a destination is named once, when it is current and its name is known', () => {
  const a = new DestinationAnnouncer();
  assert.equal(a.next('detail-1', undefined, true), null, 'still loading: nothing to say yet');
  assert.equal(a.next('detail-1', 'Dune', true), 'Dune');
  assert.equal(a.next('detail-1', 'Dune', true), null, 'a refresh says nothing');
  assert.equal(a.next('detail-1', ' Dune ', true), null);
});

test('a covered screen says nothing, and coming back to it names it again', () => {
  const a = new DestinationAnnouncer();
  assert.equal(a.next('home', 'Home', true), 'Home');
  assert.equal(a.next('home', 'Home', false), null);
  assert.equal(a.next('home', 'Something else', false), null, 'not the current screen');
  assert.equal(a.next('home', 'Home', true), 'Home');
});

test('the same screen under a new name is a new destination; a new screen with the same name too', () => {
  const a = new DestinationAnnouncer();
  assert.equal(a.next('library', 'Movies', true), 'Movies');
  assert.equal(a.next('library', 'TV Shows', true), 'TV Shows');
  assert.equal(a.next('library-2', 'TV Shows', true), 'TV Shows');
});

test('a card says its caption, then watched or how far in, never both', () => {
  assert.equal(cardName('Dune'), 'Dune');
  assert.equal(cardName('Dune', {subtitle: '2021'}), 'Dune, 2021');
  assert.equal(cardName('Dune', {subtitle: '2021', watched: true}), 'Dune, 2021, Watched');
  assert.equal(cardName('Dune', {progress: 0.42}), 'Dune, 42% played');
  assert.equal(cardName('Dune', {watched: true, progress: 0.42}), 'Dune, Watched');
  assert.equal(cardName('Dune', {progress: 0}), 'Dune');
  assert.equal(cardName('Dune', {progress: 7}), 'Dune, 100% played');
});

test('a badge is spoken, and a Watched badge is not said twice', () => {
  assert.equal(cardName('Dune', {badge: 'New'}), 'Dune, New');
  assert.equal(cardName('Dune', {badge: 'Watched'}), 'Dune, Watched');
  assert.equal(cardName('Dune', {badge: 'Watched', watched: true}), 'Dune, Watched');
});

test('nothing is spoken for empty text', async () => {
  const {spoken} = await import('./react-native-stub.mjs');
  const {announce} = await import('../src/ui/announce.ts');
  spoken.length = 0;
  announce('  ');
  announce(undefined);
  announce(null);
  announce(' Dune ');
  assert.deepEqual(spoken, ['Dune']);
});
