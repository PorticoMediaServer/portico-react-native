/** TV-PLAYER-03 / NAV-10.8: focus goes back to the named control playback was started from. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFocusKey, createFocusReturn, parseCardFocusKey, type FocusResolver} from '../src/ui/focus-return.ts';

/** Manual timers: `run()` advances to the next scheduled step. */
function clock() {
  let seq = 0;
  const queue = new Map<number, {run: () => void; ms: number}>();
  return {
    timers: {schedule: (run: () => void, ms: number) => { const id = ++seq; queue.set(id, {run, ms}); return id; }, cancel: (id: unknown) => { queue.delete(id as number); }},
    pending: () => queue.size,
    /** Runs every step until none is left (or `limit`), returning how many ran. */
    drain(limit = 100) {
      let n = 0;
      while (queue.size && n < limit) {
        const [id, step] = queue.entries().next().value!;
        queue.delete(id);
        step.run();
        n++;
      }
      return n;
    },
    next() {
      const first = queue.entries().next().value;
      if (!first) return false;
      queue.delete(first[0]);
      first[1].run();
      return true;
    },
  };
}

/** A control the registry can focus: it reports focus back the way `Focusable` does, unless `refuses`. */
function control(registry: ReturnType<typeof createFocusReturn>, scope: string, key: string, options: {refuses?: number; place?: {row?: number; column?: number}} = {}) {
  let refusals = options.refuses ?? 0;
  const handle = {asked: 0, unregister: () => {}};
  handle.unregister = registry.register(scope, key, {focus: () => {
    handle.asked++;
    if (refusals > 0) { refusals--; return; }
    registry.focused(scope, key);
  }}, options.place);
  return handle;
}

test('focus goes back to the named control playback started from, and only once', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer-a');
  const card = control(registry, 'home', cardFocusKey('continue', 'm1'));
  registry.focused('home', cardFocusKey('continue', 'm1'));
  assert.equal(registry.capture()?.key, cardFocusKey('continue', 'm1'));
  // The player covers the screen: focus leaves the card for the player.
  registry.blurred('home', cardFocusKey('continue', 'm1'));
  registry.restore();
  assert.equal(card.asked, 0, 'nothing happens until the screen is back');
  c.drain();
  assert.equal(card.asked, 1, 'asked once, and it reported focus');
  assert.equal(c.pending(), 0, 'confirmed: no more asks');
  // The origin was used: a second close does nothing.
  registry.restore();
  c.drain();
  assert.equal(card.asked, 1);
});

test('a refused request is asked again until focus is observed, a bounded number of times', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers, {attempts: 5});
  registry.setOwner('viewer');
  const play = control(registry, 'detail', 'action:primary', {refuses: 2});
  registry.focused('detail', 'action:primary');
  registry.capture();
  registry.restore();
  c.drain();
  assert.equal(play.asked, 3, 'two refusals, then focus is observed and the asking stops');
  const stubborn = control(registry, 'detail', 'action:primary', {refuses: 99});
  registry.focused('detail', 'action:primary');
  registry.capture();
  registry.restore();
  assert.equal(c.drain(), 5, 'gives up after its attempts');
  assert.equal(stubborn.asked, 5);
});

test('focus that the system put back on the control by itself is not asked for again', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const card = control(registry, 'home', cardFocusKey('row', 'a'));
  registry.focused('home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.restore();
  // The screen's focus guide remembered the card and returned focus before the first ask.
  registry.focused('home', cardFocusKey('row', 'a'));
  c.drain();
  assert.equal(card.asked, 0);
});

test('nothing is captured from an unnamed control, so an older origin is never reused', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const card = control(registry, 'home', cardFocusKey('row', 'a'));
  registry.focused('home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.restore();
  c.drain();
  assert.equal(card.asked, 1);
  // Focus moves to the rail (no name), and playback starts from a deep link.
  registry.blurred('home', cardFocusKey('row', 'a'));
  assert.equal(registry.capture(), undefined);
  registry.restore();
  c.drain();
  assert.equal(card.asked, 1, 'the card is not pulled back');
});

test('started from a sheet or menu, the origin is the control the sheet was opened from', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const card = control(registry, 'home', cardFocusKey('row', 'b'));
  registry.focused('home', cardFocusKey('row', 'b'));
  // Long press: the menu opens and takes focus; its rows have no names.
  registry.overlay(true);
  registry.blurred('home', cardFocusKey('row', 'b'));
  assert.equal(registry.capture()?.key, cardFocusKey('row', 'b'));
  registry.overlay(false);
  registry.restore();
  c.drain();
  assert.equal(card.asked, 1);
});

test('the origin belongs to its viewer: a profile change forgets it and stops a return under way', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('server\naccount\nprofile-a');
  const card = control(registry, 'home', cardFocusKey('row', 'a'), {refuses: 99});
  registry.focused('home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.setOwner('server\naccount\nprofile-b');
  registry.restore();
  assert.equal(c.drain(), 0, 'nothing to return to for the new viewer');
  // A return under way stops when the viewer changes.
  registry.focused('home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.restore();
  c.next();
  c.next();
  assert.equal(card.asked, 2, 'two asks, both refused');
  registry.setOwner('server\naccount\nprofile-c');
  assert.equal(c.drain(), 0);
  assert.equal(card.asked, 2, 'no ask after the viewer changed');
  // Signed out: nothing is captured at all.
  registry.setOwner('');
  registry.focused('home', cardFocusKey('row', 'a'));
  assert.equal(registry.capture(), undefined);
});

test('the same name on two screens: focus returns on the screen it was captured on', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const below = control(registry, 'detail-1', 'action:primary');
  const above = control(registry, 'detail-2', 'action:primary');
  registry.focused('detail-2', 'action:primary');
  registry.capture();
  registry.restore();
  c.drain();
  assert.deepEqual([below.asked, above.asked], [0, 1]);
});

test('a card the list no longer mounts is brought back into the list, then focused', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const key = cardFocusKey('continue', 'm9');
  const first = control(registry, 'home', key, {place: {row: 1, column: 9}});
  registry.focused('home', key);
  assert.deepEqual(registry.capture()?.place, {row: 1, column: 9});
  // The list dropped the card while the player was up.
  first.unregister();
  let card: ReturnType<typeof control> | undefined;
  const revealed: string[] = [];
  const row: FocusResolver = {
    reveal: (asked, place) => {
      revealed.push(`${parseCardFocusKey(asked)?.entryId}@${place.column}`);
      card ??= control(registry, 'home', key);
      return true;
    },
    fallback: () => undefined,
  };
  const remove = registry.addResolver('home', row);
  registry.restore();
  c.drain();
  assert.deepEqual(revealed, ['m9@9'], 'scrolled to once');
  assert.equal(card?.asked, 1);
  remove();
});

test('a title that has gone hands focus to its neighbour; a row that has gone to the row in its place', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  // Finished: the title left Continue Watching. Its neighbour now holds its place in the row.
  const gone = control(registry, 'home', cardFocusKey('continue', 'done'), {place: {row: 1, column: 2}});
  registry.focused('home', cardFocusKey('continue', 'done'));
  registry.capture();
  gone.unregister();
  const neighbour = control(registry, 'home', cardFocusKey('continue', 'next'));
  const resolver: FocusResolver = {
    reveal: () => false,
    fallback: (key, place) => (parseCardFocusKey(key)?.group === 'continue' && place.column === 2 ? cardFocusKey('continue', 'next') : undefined),
  };
  const remove = registry.addResolver('home', resolver);
  registry.restore();
  c.drain();
  assert.equal(neighbour.asked, 1);
  remove();
  // The whole row went (its last title finished): the row now in its place takes focus.
  const lone = control(registry, 'home', cardFocusKey('continue', 'last'), {place: {row: 1, column: 0}});
  registry.focused('home', cardFocusKey('continue', 'last'));
  registry.capture();
  lone.unregister();
  const added = control(registry, 'home', cardFocusKey('recently_added', 'r1'));
  const rows: FocusResolver = {reveal: () => false, fallback: key => (parseCardFocusKey(key)?.group === 'continue' ? cardFocusKey('recently_added', 'r1') : undefined)};
  const removeRows = registry.addResolver('home', rows);
  registry.restore();
  c.drain();
  assert.equal(added.asked, 1);
  removeRows();
});

test('with nowhere to go, the return gives up quietly', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers, {attempts: 4});
  registry.setOwner('viewer');
  const card = control(registry, 'home', cardFocusKey('row', 'x'));
  registry.focused('home', cardFocusKey('row', 'x'));
  registry.capture();
  card.unregister();
  registry.restore();
  assert.equal(c.drain(), 4);
  assert.equal(registry.state().returning, undefined);
});

test('a control that registers again under the same name is not removed by the old one leaving', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const old = control(registry, 'home', 'action:customise');
  const fresh = control(registry, 'home', 'action:customise');
  old.unregister();
  registry.focused('home', 'action:customise');
  registry.capture();
  registry.restore();
  c.drain();
  assert.deepEqual([old.asked, fresh.asked], [0, 1]);
});

test('card keys survive any characters in a row id', () => {
  assert.deepEqual(parseCardFocusKey(cardFocusKey('for_you:drama:2', 'e:1')), {group: 'for_you:drama:2', entryId: 'e:1'});
  assert.equal(parseCardFocusKey('action:play'), undefined);
});
