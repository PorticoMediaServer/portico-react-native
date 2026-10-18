/** TV-PLAYER-03 / NAV-10.8: focus goes back to the named control playback was started from. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {LOOKUP_CONTAINER, LOOKUP_FOUND, LOOKUP_LOADING, LOOKUP_UNKNOWN, cardFocusKey, createFocusReturn, decideFocusReturn, isFocusIntent, lookupGone, parentFocusKey, parseCardFocusKey, withinFocusKey, type FocusResolver} from '../src/ui/focus-return.ts';

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
    resolve: (asked, place) => {
      revealed.push(`${parseCardFocusKey(asked)?.entryId}@${place.column}`);
      card ??= control(registry, 'home', key);
      return LOOKUP_FOUND;
    },
  };
  const remove = registry.addResolver('home', row);
  registry.restore();
  c.drain();
  assert.deepEqual(revealed, ['m9@9'], 'brought back into the list, then asked in the same look');
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
    resolve: (key, place) => (key === cardFocusKey('continue', 'done') && place.column === 2 ? lookupGone(cardFocusKey('continue', 'next')) : LOOKUP_FOUND),
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
  const rows: FocusResolver = {resolve: key => (parseCardFocusKey(key)?.group === 'continue' ? lookupGone(cardFocusKey('recently_added', 'r1')) : LOOKUP_CONTAINER)};
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

test('a list that has the control, or is still reading where it was, decides over one that says it has gone', () => {
  const gone = lookupGone(cardFocusKey('row', 'next'));
  assert.deepEqual(decideFocusReturn([LOOKUP_CONTAINER, gone]), {kind: 'switch', next: cardFocusKey('row', 'next')}, 'the row says the card has gone; the stage only holds the row');
  assert.deepEqual(decideFocusReturn([LOOKUP_FOUND, gone]), {kind: 'wait', loading: false});
  assert.deepEqual(decideFocusReturn([LOOKUP_LOADING, gone]), {kind: 'wait', loading: true});
  assert.deepEqual(decideFocusReturn([LOOKUP_CONTAINER]), {kind: 'wait', loading: false}, 'the row is in view but not yet mounted: wait for it');
  assert.deepEqual(decideFocusReturn([LOOKUP_CONTAINER, lookupGone()]), {kind: 'abandon'});
  assert.deepEqual(decideFocusReturn([LOOKUP_UNKNOWN]), {kind: 'wait', loading: false});
  assert.deepEqual(decideFocusReturn([]), {kind: 'wait', loading: false});
});

test('a mounted card off screen is brought into view before it is asked for focus', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const key = cardFocusKey('row', 'far');
  // Mounted (an overscan cell) but scrolled out of view: the focus engine refuses it there.
  let inView = false;
  const order: string[] = [];
  let asked = 0;
  registry.register('home', key, {focus: () => { order.push('focus'); asked++; if (inView) registry.focused('home', key); }}, {row: 3, column: 14});
  registry.addResolver('home', {resolve: () => { order.push('reveal'); inView = true; return LOOKUP_FOUND; }});
  registry.focused('home', key);
  registry.capture();
  registry.blurred('home', key);
  registry.restore();
  c.drain();
  assert.deepEqual(order, ['reveal', 'focus'], 'revealed first, then asked once, and it took focus');
  assert.equal(asked, 1);
});

test('a key pressed on the remote ends a return under way; focus moving by itself does not', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const card = control(registry, 'home', cardFocusKey('row', 'a'), {refuses: 99});
  registry.focused('home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.restore();
  c.next();
  // The screen came back and the focus engine put focus on the rail by itself: still returning.
  registry.focusedUnnamed();
  registry.focused('home', 'action:customise');
  c.next();
  assert.equal(card.asked, 2);
  // The person presses Down before the card has taken focus: the return stops there.
  registry.intent();
  assert.equal(c.drain(), 0);
  assert.equal(card.asked, 2);
  assert.equal(registry.state().returning, undefined);
});

test('what counts as the person pressing a key: directions, Select and Menu as pressed, never their release', () => {
  for (const eventType of ['up', 'down', 'left', 'right', 'select', 'longSelect', 'menu', 'swipeLeft', 'pageDown']) {
    assert.equal(isFocusIntent({eventType, eventKeyAction: 0}), true, eventType);
    assert.equal(isFocusIntent({eventType}), true, `${eventType} (one event for the press: tvOS, Vega)`);
    assert.equal(isFocusIntent({eventType, eventKeyAction: 1}), false, `${eventType} released`);
  }
  for (const eventType of ['focus', 'blur', 'playPause', 'pan', 'rewind']) assert.equal(isFocusIntent({eventType, eventKeyAction: 0}), false, eventType);
  assert.equal(isFocusIntent(null), false);
});

test('Android TV reports an ordinary press only by its release, and a held key once as it starts to repeat', () => {
  // react-native-tvos with key-down events off: `left` arrives once, as eventKeyAction 1, after the
  // focus engine has moved. Counting only presses (0) heard no key on Android at all.
  for (const eventType of ['up', 'down', 'left', 'right', 'select', 'menu']) {
    assert.equal(isFocusIntent({eventType, eventKeyAction: 1}, 'release'), true, `${eventType} released`);
    assert.equal(isFocusIntent({eventType, eventKeyAction: 0}, 'release'), false, `${eventType} down (key-down events on): its release counts instead`);
  }
  for (const eventType of ['longLeft', 'longSelect']) {
    assert.equal(isFocusIntent({eventType, eventKeyAction: 0}, 'release'), true, `${eventType} starts`);
    assert.equal(isFocusIntent({eventType, eventKeyAction: 1}, 'release'), false, `${eventType} let go: already counted`);
  }
  assert.equal(isFocusIntent({eventType: 'left'}, 'release'), true, 'no action: one event for the press');
  assert.equal(isFocusIntent({eventType: 'playPause', eventKeyAction: 1}, 'release'), false);
  assert.equal(isFocusIntent({eventType: 'blur', eventKeyAction: 1}, 'release'), false);
});

test('a screen that is not the one showing is never given focus, and a screen that has gone forgets its origin', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const card = control(registry, 'route-home', cardFocusKey('row', 'a'), {refuses: 99});
  registry.focused('route-home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.restore();
  c.next();
  assert.equal(card.asked, 1);
  // Another screen is pushed (or another tab chosen) while focus is on its way back: it stops.
  registry.setScopeActive('route-home', false);
  assert.equal(c.drain(), 0);
  assert.equal(card.asked, 1);
  // Captured, then the screen is covered before the player closes: nothing is pulled from under it.
  registry.focused('route-home', cardFocusKey('row', 'a'));
  registry.capture();
  registry.restore();
  assert.equal(c.drain(), 0);
  // Shown again, then it goes away (popped) while the player is up: its origin goes with it.
  registry.setScopeActive('route-home', true);
  registry.focused('route-home', cardFocusKey('row', 'a'));
  assert.ok(registry.capture());
  registry.disposeScope('route-home');
  assert.equal(registry.state().origin, undefined);
  assert.equal(registry.state().current, null);
  registry.restore();
  assert.equal(c.drain(), 0);
  assert.equal(card.asked, 1);
});

test('a control unmounted while it has focus (no blur) is not the place playback comes from', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const card = control(registry, 'home', cardFocusKey('row', 'a'));
  registry.focused('home', cardFocusKey('row', 'a'));
  card.unregister();
  assert.equal(registry.capture(), undefined);
});

test('a sheet belongs to the control focus was on when it opened, never to an older named one', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  control(registry, 'album', 'action:primary');
  // Focus was on the hero's Play, then moved down to an unnamed control, whose More opens a menu.
  registry.focused('album', 'action:primary');
  registry.blurred('album', 'action:primary');
  registry.focusedUnnamed();
  registry.overlay(true);
  registry.focusedUnnamed(true);
  assert.equal(registry.capture(), undefined, 'the menu is not the hero Play\'s');
  registry.overlay(false);
  // From a named card: its menu, then a second sheet opened from inside it (Play version…).
  const card = control(registry, 'album', cardFocusKey('tracks', 't3'), {place: {column: 3}});
  registry.focused('album', cardFocusKey('tracks', 't3'));
  registry.overlay(true);
  registry.blurred('album', cardFocusKey('tracks', 't3'));
  registry.focusedUnnamed(true);
  registry.overlay(true);
  registry.overlay(false);
  registry.focusedUnnamed(true);
  assert.deepEqual(registry.capture(), {owner: 'viewer', scope: 'album', key: cardFocusKey('tracks', 't3'), place: {column: 3}});
  registry.overlay(false);
  registry.restore();
  c.drain();
  assert.equal(card.asked, 1);
});

test('a control that belongs to a row goes back to the row when it is no longer there', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const row = cardFocusKey('episodes', 'e4');
  const play = withinFocusKey(row, 'play');
  assert.equal(parentFocusKey(play), row);
  assert.equal(parentFocusKey(row), undefined);
  const button = control(registry, 'show', play);
  registry.focused('show', play);
  registry.capture();
  // The details closed under the player (a refresh): the button is gone, the row is there.
  button.unregister();
  const episode = control(registry, 'show', row);
  registry.restore();
  c.drain();
  assert.equal(episode.asked, 1);
});

test('a list\'s own move (a TV letter jumped to) belongs to its viewer and its screen, from the press on, and a key or another move ends it', () => {
  const key = cardFocusKey('cards', 'm1');
  const setup = () => {
    const c = clock();
    const registry = createFocusReturn(c.timers);
    registry.setOwner('viewer-a');
    const queued: (() => boolean)[] = [];
    registry.register('library', key, {focus: still => { queued.push(still); }});
    registry.follow('library', () => key);
    return {c, registry, queued};
  };
  const ends: [string, (r: ReturnType<typeof createFocusReturn>) => void][] = [
    ['another viewer', r => r.setOwner('viewer-b')],
    ['the screen covered', r => r.setScopeActive('library', false)],
    ['the screen gone', r => r.disposeScope('library')],
    ['another move', r => r.follow('library', () => 'loading')],
    ['a playback return', r => r.restore()],
  ];
  // Ended before its first look (the frame after the press): it never asks, and nothing it would have asked lands.
  for (const [why, end] of ends) {
    const {c, registry, queued} = setup();
    assert.equal(queued.length, 0, `${why}: not asked during the press itself`);
    end(registry);
    c.drain();
    assert.equal(queued.filter(still => still()).length, 0, `${why}, before it began`);
  }
  // Ended after it asked: the queued request no longer lands.
  for (const [why, end] of [...ends, ['a key', (r: ReturnType<typeof createFocusReturn>) => r.intent()]] as typeof ends) {
    const {c, registry, queued} = setup();
    c.next();
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!(), true, `${why}: wanted until it ends`);
    end(registry);
    assert.equal(queued[0]!(), false, `${why}: the queued request no longer lands`);
  }
  // The press that started it is its own (its intent may be heard after it began); a second key ends it.
  {
    const {c, registry, queued} = setup();
    registry.intent();
    c.next();
    assert.equal(queued.length, 1, 'the starting press does not end it');
    const again = setup();
    again.registry.intent();
    again.registry.intent();
    again.c.drain();
    assert.equal(again.queued.length, 0, 'another key before it began does');
  }
  // Without a viewer, or on a screen that is not showing, nothing is followed.
  const {registry} = setup();
  registry.setOwner('');
  registry.follow('library', () => key);
  assert.equal(registry.state().returning, undefined);
});
