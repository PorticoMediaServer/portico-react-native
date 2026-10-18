/** TV browsing (Justin, 18 Oct 2026): a passive preview that follows focus, words at once, artwork once focus settles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost} from './hook-driver.ts';
import {createBrowsePreview, useBrowsePreview, PREVIEW_SETTLE_MS, type BrowsePreviewStore, type PreviewFocus} from '../src/app/browse-preview.ts';
import {heroText, shelfHeight, stageLayout} from '../src/app/browse-stage.ts';
import type {ContentEntry} from '../../../packages/client-core/src/library-content.ts';

const entry = (id: string, extra: Partial<ContentEntry> = {}): ContentEntry => ({id, kind: 'movie', title: id, overview: `About ${id}`, backdropUrl: `/b/${id}`, ...extra});
const focus = (id: string, group = 'row', extra: Partial<ContentEntry> = {}): PreviewFocus => ({entry: entry(id, extra), group, resume: false});

function timers() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, {at: number; run: () => void}>();
  return {
    timers: {schedule: (run: () => void, ms: number) => { const id = ++seq; due.set(id, {at: now + ms, run}); return id; }, cancel: (id: unknown) => { due.delete(id as number); }},
    advance(ms: number) {
      now += ms;
      for (const [id, item] of [...due].sort((a, b) => a[1].at - b[1].at)) if (item.at <= now) { due.delete(id); item.run(); }
    },
    pending: () => due.size,
  };
}

const watch = (store: BrowsePreviewStore) => {
  let emits = 0;
  store.subscribe(() => emits++);
  return () => emits;
};

test('the words follow focus at once; the artwork only once focus has rested', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  store.show(focus('a'));
  assert.equal(store.getSnapshot().focus?.entry.id, 'a');
  assert.equal(store.getSnapshot().art, undefined, 'no artwork yet');
  t.advance(PREVIEW_SETTLE_MS - 1);
  assert.equal(store.getSnapshot().art, undefined);
  t.advance(1);
  assert.equal(store.getSnapshot().art?.entry.id, 'a');
});

test('holding the remote down a row asks for one image, the last card\'s, when it stops', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  const arts: (string | undefined)[] = [];
  store.subscribe(() => arts.push(store.getSnapshot().art?.entry.id));
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    store.show(focus(id));
    assert.equal(store.getSnapshot().focus?.entry.id, id, 'the words keep up with every card');
    t.advance(90);
  }
  assert.equal(store.getSnapshot().art, undefined, 'nothing settled while moving');
  t.advance(PREVIEW_SETTLE_MS);
  assert.equal(store.getSnapshot().art?.entry.id, 'f');
  assert.deepEqual([...new Set(arts.filter(Boolean))], ['f'], 'artwork for one card only');
  assert.equal(t.pending(), 0);
});

test('the same card taking focus again changes nothing; the rail and tabs leave the last card described', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  const card = focus('a');
  store.show(card);
  t.advance(PREVIEW_SETTLE_MS);
  const emits = watch(store);
  // Focus goes to the rail and comes back to the same card: nothing has changed.
  store.show(card);
  assert.equal(emits(), 0);
  assert.equal(t.pending(), 0, 'no image asked for again');
  // The same card after the row was read again: its fresh words, and its settled artwork kept.
  store.show(focus('a'));
  assert.equal(emits(), 1);
  assert.equal(t.pending(), 0);
  assert.equal(store.getSnapshot().art, store.getSnapshot().focus);
});

test('the same title in two rows is two cards', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  store.show(focus('a', 'continue'));
  t.advance(PREVIEW_SETTLE_MS);
  store.show(focus('a', 'recently_added'));
  assert.equal(store.getSnapshot().focus?.group, 'recently_added');
  assert.equal(store.getSnapshot().art?.group, 'continue', 'the new card settles like any other');
});

test('where browsing starts is described with its artwork at once, until the viewer moves', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  store.seed({...focus('c1', 'continue'), resume: true});
  assert.equal(store.getSnapshot().art?.entry.id, 'c1', 'the first picture needs no wait');
  assert.equal(store.getSnapshot().touched, false);
  store.show(focus('r2', 'recently_added'));
  store.seed(focus('other'));
  assert.equal(store.getSnapshot().focus?.entry.id, 'r2', 'a later start never pulls the preview back');
});

test('rows read again: the described card takes its fresh entry, and a card that has gone hands over', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  store.show(focus('a'));
  t.advance(PREVIEW_SETTLE_MS);
  const fresh = entry('a', {progressSeconds: 600, duration: 1200});
  store.reconcile((group, id) => (group === 'row' && id === 'a' ? fresh : undefined), focus('z'));
  assert.equal(store.getSnapshot().focus?.entry, fresh);
  assert.equal(store.getSnapshot().art?.entry, fresh, 'its artwork stays settled');
  store.reconcile(() => undefined, focus('z'));
  assert.equal(store.getSnapshot().focus?.entry.id, 'z');
  assert.equal(store.getSnapshot().art?.entry.id, 'z');
  // An unchanged read changes nothing.
  const emits = watch(store);
  const same = store.getSnapshot().focus!.entry;
  store.reconcile(() => same, focus('y'));
  assert.equal(emits(), 0);
});

test('a disposed preview does nothing it had pending', () => {
  const t = timers();
  const store = createBrowsePreview(t.timers);
  store.show(focus('a'));
  store.dispose();
  t.advance(PREVIEW_SETTLE_MS * 2);
  assert.equal(store.getSnapshot().art, undefined);
  store.show(focus('b'));
  assert.equal(store.getSnapshot().focus?.entry.id, 'a', 'and takes nothing new');
});

test('one preview per screen and viewer: a new viewer starts afresh and the old one\'s artwork never lands', () => {
  const t = timers();
  let scope = 'home\nserver\naccount\nprofile-a';
  let store!: BrowsePreviewStore;
  const host = createHookHost(() => { store = useBrowsePreview(scope, t.timers); });
  host.mount();
  const first = store;
  first.show(focus('kids-title'));
  scope = 'home\nserver\naccount\nprofile-b';
  host.rerender();
  assert.notEqual(store, first);
  assert.equal(store.getSnapshot().focus, undefined, 'nothing of the other profile shows');
  t.advance(PREVIEW_SETTLE_MS);
  assert.equal(first.getSnapshot().art, undefined, 'the old store was disposed before it settled');
  const second = store;
  host.unmount();
  second.show(focus('x'));
  assert.equal(second.getSnapshot().focus, undefined, 'leaving the screen disposes of it too');
});

// The stage at 1920×1080, with Portico's television sizes (theme.ts): a poster row is about 530 high.
const row = shelfHeight({header: 64, headerGap: 20, art: 214 * 1.5, caption: 84, below: 40});

test('Home: one whole row and a glimpse of the next under a large preview', () => {
  assert.equal(row, 529);
  const layout = stageLayout({height: 1080, top: 32, strip: 0, row, peek: 100, minHero: Math.round(1080 * 0.34), minPeek: 56});
  assert.equal(layout.viewport, 629, 'the row and a 100 px glimpse');
  assert.equal(layout.hero, 419);
  assert.equal(32 + layout.hero + layout.viewport, 1080);
  assert.equal(layout.tail, 100, 'the last row can come to rest at the top too');
});

test('a library: its tabs come first and the preview gives way to them, never the row', () => {
  const layout = stageLayout({height: 1080, top: 32, strip: 95, row, peek: 80, minHero: Math.round(1080 * 0.26), minPeek: 56});
  assert.ok(layout.viewport >= row, 'the focused row is whole');
  assert.equal(32 + 95 + layout.hero + layout.viewport, 1080);
  assert.ok(layout.hero >= 280);
});

test('larger cards: the glimpse gives way first, then the preview down to its least; only then is the row cut', () => {
  const room = 1080 - 32 - 95;
  const larger = shelfHeight({header: 64, headerGap: 20, art: 214 * 1.3 * 1.5, caption: 84, below: 40});
  const fits = stageLayout({height: 1080, top: 32, strip: 95, row: larger, peek: 80, minHero: 281, minPeek: 56});
  assert.equal(fits.hero, 281, 'the preview at its least');
  assert.ok(fits.viewport >= larger && fits.viewport - larger < 56, 'the row whole, the glimpse smaller');
  const largest = shelfHeight({header: 64, headerGap: 20, art: 214 * 1.5 * 1.5, caption: 84, below: 40});
  const cut = stageLayout({height: 1080, top: 32, strip: 95, row: largest, peek: 80, minHero: 281, minPeek: 56});
  assert.equal(cut.hero, 281);
  assert.equal(cut.viewport, room - 281);
  assert.ok(cut.viewport < largest, 'only now is the row itself cut');
  // A small window still has a preview and a viewport, never negative space.
  const tiny = stageLayout({height: 400, top: 32, strip: 95, row, peek: 80, minHero: 120, minPeek: 56});
  assert.ok(tiny.hero >= 0 && tiny.viewport >= 0 && tiny.tail >= 0);
});

test('the preview says what it has room for: a second title line and the synopsis only where they fit', () => {
  const sizes = {padding: 68, title: 68, line: 40, meta: 33, overview: 33, gap: 8, resume: 0};
  assert.deepEqual(heroText(419, sizes), {titleLines: 2, overviewLines: 3});
  assert.deepEqual(heroText(300, sizes), {titleLines: 1, overviewLines: 2});
  assert.deepEqual(heroText(230, sizes), {titleLines: 1, overviewLines: 0});
});
