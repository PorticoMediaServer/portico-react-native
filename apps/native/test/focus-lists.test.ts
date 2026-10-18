/**
 * TV-PLAYER-03: the lists' own policy for focus coming back after playback (`focus-lists.ts`),
 * composed the way the screens compose it (a stage of rows over rows of cards, a grid over a
 * windowed collection, a playlist's entries) with the real registry. The windowed cases run on
 * client-core's real `createWindowedCollection` with a synthetic server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFocusKey, createFocusReturn, type FocusResolver} from '../src/ui/focus-return.ts';
import {arrayResolver, landingDestination, locateInWindow, rowsResolver, windowLanding, windowResolver} from '../src/ui/focus-lists.ts';
import {createWindowedCollection, type FetchPage} from '../../../packages/client-core/src/collections/index.ts';

function clock() {
  const queue = new Map<number, () => void>();
  let seq = 0;
  return {
    timers: {schedule: (run: () => void) => { const id = ++seq; queue.set(id, run); return id; }, cancel: (id: unknown) => { queue.delete(id as number); }},
    next() { const first = queue.entries().next().value; if (!first) return false; queue.delete(first[0]); first[1](); return true; },
    async drainAsync(limit = 200) { let n = 0; while (queue.size && n < limit) { this.next(); n++; await settle(); } return n; },
    drain(limit = 200) { let n = 0; while (queue.size && n < limit) { this.next(); n++; } return n; },
  };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };

type Registry = ReturnType<typeof createFocusReturn>;
/** A card as `Focusable` reports it; `asked` counts requests, and focus is taken unless `refuse()` says no. */
function card(registry: Registry, scope: string, key: string, place: {row?: number; column?: number} = {}, refuse: () => boolean = () => false) {
  const handle = {asked: 0, unregister: () => {}};
  handle.unregister = registry.register(scope, key, {focus: () => { handle.asked++; if (!refuse()) registry.focused(scope, key); }}, place);
  return handle;
}

type Row = {id: string; entries: {id: string}[]};
/**
 * A stage of rows as BrowseStage and Shelf build it: the stage's own resolver, and a resolver per
 * row once that row is mounted. `window` is how many rows the list mounts from `top`.
 */
function stage(registry: Registry, scope: string, rows: () => Row[], options: {window?: number; top?: number} = {}) {
  const state = {top: options.top ?? 0, window: options.window ?? 99, rowScrolls: [] as number[], cardScrolls: [] as string[]};
  const shelves = new Map<string, () => void>();
  const cards = new Map<string, ReturnType<typeof card>>();
  const shelf = (row: Row): FocusResolver => arrayResolver({group: row.id, items: () => rows().find(r => r.id === row.id)?.entries ?? [], keyOf: e => e.id, scrollTo: index => state.cardScrolls.push(`${row.id}:${index}`)});
  /** Mount the rows and cards the list's window holds now, as the lists' renderers would. */
  const layout = () => {
    const now = rows();
    const mounted = new Set(now.slice(state.top, state.top + state.window).map(r => r.id));
    for (const [id, off] of shelves) if (!mounted.has(id)) { off(); shelves.delete(id); }
    for (const [key, c] of cards) { const [, group, entry] = key.split('\u001f'); if (!mounted.has(group!) || !now.find(r => r.id === group)?.entries.some(e => e.id === entry)) { c.unregister(); cards.delete(key); } }
    now.forEach((row, r) => {
      if (!mounted.has(row.id)) return;
      if (!shelves.has(row.id)) shelves.set(row.id, registry.addResolver(scope, shelf(row)));
      row.entries.forEach((e, column) => { const key = cardFocusKey(row.id, e.id); if (!cards.has(key)) cards.set(key, card(registry, scope, key, {row: r, column})); });
    });
  };
  registry.addResolver(scope, rowsResolver<Row>({rows, group: r => r.id, first: r => r.entries[0]?.id, base: 0, scrollTo: index => { state.rowScrolls.push(index); state.top = index; layout(); }}));
  layout();
  return {state, cards, layout};
}

test('a card that finished and left its row, the row still there: its neighbour takes focus (the stage does not veto it)', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let rows: Row[] = [{id: 'continue', entries: [{id: 'a'}, {id: 'b'}, {id: 'c'}]}, {id: 'recent', entries: [{id: 'r1'}]}];
  const s = stage(registry, 'home', () => rows);
  registry.focused('home', cardFocusKey('continue', 'b'));
  registry.capture();
  // Finished under the player: a playback refresh drops it from the row; the row stays.
  rows = [{id: 'continue', entries: [{id: 'a'}, {id: 'c'}]}, rows[1]!];
  s.layout();
  registry.restore();
  c.drain();
  assert.equal(s.cards.get(cardFocusKey('continue', 'c'))?.asked, 1, 'the card now in its place (column 1)');
  assert.equal(s.cards.get(cardFocusKey('continue', 'a'))?.asked, 0);
  assert.equal(registry.state().returning, undefined, 'confirmed, finished');
});

test('the same, with the row virtualised away: the stage brings the row back, then the row hands over', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let rows: Row[] = Array.from({length: 8}, (_, i) => ({id: `row${i}`, entries: [{id: `${i}a`}, {id: `${i}b`}, {id: `${i}c`}]}));
  const s = stage(registry, 'home', () => rows, {window: 2, top: 6});
  registry.focused('home', cardFocusKey('row6', '6c'));
  registry.capture();
  // Under the player the list re-windows to the top, and the title finishes: row 6 loses 6c.
  s.state.top = 0;
  rows = rows.map(r => (r.id === 'row6' ? {...r, entries: r.entries.slice(0, 2)} : r));
  s.layout();
  assert.equal(s.cards.has(cardFocusKey('row6', '6a')), false, 'row 6 is not mounted');
  registry.restore();
  c.drain();
  assert.deepEqual(s.state.rowScrolls.slice(0, 1), [6], 'the stage scrolled to the row');
  assert.equal(s.cards.get(cardFocusKey('row6', '6b'))?.asked, 1, 'the last card of the shortened row');
});

test('a whole row that has gone hands over to the row now in its place', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let rows: Row[] = [{id: 'continue', entries: [{id: 'last'}]}, {id: 'recent', entries: [{id: 'r1'}, {id: 'r2'}]}];
  const s = stage(registry, 'home', () => rows);
  registry.focused('home', cardFocusKey('continue', 'last'));
  registry.capture();
  rows = [rows[1]!];
  s.layout();
  registry.restore();
  c.drain();
  assert.equal(s.cards.get(cardFocusKey('recent', 'r1'))?.asked, 1);
});

test('a mounted card scrolled out of view is revealed (row, then card) before it is asked', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const rows: Row[] = [{id: 'r0', entries: [{id: 'x'}]}, {id: 'r1', entries: Array.from({length: 20}, (_, i) => ({id: `e${i}`}))}];
  const s = stage(registry, 'home', () => rows);
  registry.focused('home', cardFocusKey('r1', 'e15'));
  registry.capture();
  // Still mounted, but the row is scrolled away: the focus engine refuses it until it is revealed.
  const key = cardFocusKey('r1', 'e15');
  s.cards.get(key)!.unregister();
  let revealed = false;
  const target = card(registry, 'home', key, {row: 1, column: 15}, () => !revealed);
  registry.addResolver('home', {resolve: () => { revealed = s.state.rowScrolls.includes(1) && s.state.cardScrolls.includes('r1:15'); return {kind: 'unknown'}; }});
  registry.restore();
  c.drain();
  assert.equal(target.asked, 1, 'one ask, after the row and the card were brought into view');
});

// ── Windowed lists ────────────────────────────────────────────────────────────

type Entry = {id: string};
function serverOf(ids: () => readonly string[]) {
  const calls: number[] = [];
  const fetchPage: FetchPage<Entry> = async (start, count) => { calls.push(start); const now = ids(); return {items: now.slice(start, start + count).map(id => ({id})), total: now.length}; };
  return {fetchPage, calls};
}
/** A grid as Library's EngineResults wires it: the real collection, the grid's scroll (`ensureRange` for three rows), its cards mounted for the loaded slots in view. */
function grid(registry: Registry, ids: () => readonly string[], options: {columns?: number} = {}) {
  const columns = options.columns ?? 6;
  const server = serverOf(ids);
  const list = createWindowedCollection<Entry>({fetchPage: server.fetchPage, pageSize: 60, maxResidentPages: 5, keyOf: e => e.id});
  const view = {first: 0, scrolls: [] as number[]};
  const cards = new Map<string, ReturnType<typeof card>>();
  const layout = () => {
    const shown = new Set<string>();
    for (let i = view.first; i < view.first + columns * 3; i++) {
      const slot = list.slotAt(i);
      if (slot.kind !== 'item') continue;
      const key = cardFocusKey('cards', slot.item.id);
      shown.add(key);
      if (!cards.has(key)) cards.set(key, card(registry, 'library', key, {column: i}));
    }
    for (const [key, c] of cards) if (!shown.has(key)) { c.unregister(); cards.delete(key); }
  };
  const scrollToIndex = (index: number) => {
    const row = Math.floor(index / columns);
    view.scrolls.push(index);
    view.first = row * columns;
    list.ensureRange(row * columns, (row + 3) * columns - 1);
    layout();
  };
  list.subscribe(layout);
  registry.addResolver('library', windowResolver<Entry>({group: 'cards', list: () => list, total: () => list.getSnapshot().total, keyOf: e => e.id, scrollTo: scrollToIndex}));
  return {list, view, cards, layout, scrollToIndex, server, async open(first: number) { view.first = first; list.ensureRange(first, first + columns * 3 - 1); await settle(); layout(); }};
}
const range = (n: number, prefix = 't') => Array.from({length: n}, (_, i) => `${prefix}${i}`);

test('grid: a title that moved in the list is found where it is now, not replaced by whatever took its old place', async () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let ids = range(600);
  const g = grid(registry, () => ids);
  await g.open(300);
  registry.focused('library', cardFocusKey('cards', 't310'));
  assert.equal(registry.capture()?.place.column, 310);
  // Re-read under the player: two titles were added before it, so it is now at 312 and t308 holds 310.
  ids = ['n1', 'n2', ...range(600)];
  g.list.invalidate();
  await settle();
  // A new generation scrolls the grid back to its top (WindowedGrid), so the card is unmounted.
  g.view.first = 0;
  g.layout();
  assert.equal(g.cards.has(cardFocusKey('cards', 't310')), false);
  assert.equal(g.list.slotAt(310).kind === 'item' && (g.list.slotAt(310) as {item: Entry}).item.id, 't308');
  registry.restore();
  await c.drainAsync();
  assert.equal(g.cards.get(cardFocusKey('cards', 't310'))?.asked, 1, 'the same title');
  assert.equal(g.cards.get(cardFocusKey('cards', 't308'))?.asked ?? 0, 0, 'not the one now at its old place');
});

test('grid: a title that moved far but is on a page still held is found there', async () => {
  const ids = range(600);
  const server = serverOf(() => ids);
  const list = createWindowedCollection<Entry>({fetchPage: server.fetchPage, pageSize: 60, maxResidentPages: 5, keyOf: e => e.id});
  list.ensureRange(0, 200);
  await settle();
  assert.deepEqual(locateInWindow(list, 600, 't190', 10, e => e.id), {kind: 'found', index: 190}, 'far from its old place, resident');
  assert.deepEqual(locateInWindow(list, 600, 't12', 10, e => e.id), {kind: 'found', index: 12}, 'close by');
  assert.deepEqual(locateInWindow(list, 600, 'missing', 10, e => e.id), {kind: 'gone', index: 10, next: 't10'}, 'loaded around its place and in no page held: gone');
  assert.deepEqual(locateInWindow(list, 600, 't10', 500, e => e.id), {kind: 'found', index: 10});
  assert.equal(locateInWindow(list, 600, 'missing', 500, e => e.id).kind, 'loading', 'its old place is not loaded: not taken as gone');
  list.dispose();
});

test('grid: an old place no longer loaded (the list was read again) is asked for, waited for, then focused', async () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const ids = range(2000);
  const g = grid(registry, () => ids);
  await g.open(1500);
  registry.focused('library', cardFocusKey('cards', 't1510'));
  registry.capture();
  // Under the player: a new reading (generation), and the grid went back to the top.
  g.list.invalidate();
  await settle();
  for (const first of [900, 600, 300, 0]) await g.open(first);
  assert.equal(g.list.slotAt(1510).kind, 'placeholder', 'its page was evicted');
  assert.equal(g.cards.has(cardFocusKey('cards', 't1510')), false, 'and its card unmounted');
  const before = g.server.calls.length;
  registry.restore();
  await c.drainAsync();
  assert.ok(g.view.scrolls.includes(1510), 'the grid scrolled to its old place');
  assert.ok(g.server.calls.slice(before).some(start => start <= 1510 && 1510 < start + 60), 'its page was requested');
  assert.equal(g.cards.get(cardFocusKey('cards', 't1510'))?.asked, 1, 'and it was focused once it arrived');
});

test('grid: the last title removed from a shorter list hands over to the new last one; an empty list gives up', async () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let ids = range(40);
  const g = grid(registry, () => ids);
  await g.open(24);
  registry.focused('library', cardFocusKey('cards', 't39'));
  registry.capture();
  ids = range(38);
  g.list.invalidate();
  await settle();
  g.layout();
  registry.restore();
  await c.drainAsync();
  assert.equal(g.cards.get(cardFocusKey('cards', 't37'))?.asked, 1, 'clamped to the end of the list');
  // Everything was removed: nothing to go to, and the return stops at once.
  registry.focused('library', cardFocusKey('cards', 't37'));
  registry.capture();
  ids = [];
  g.list.invalidate();
  await settle();
  registry.restore();
  await c.drainAsync();
  assert.equal(registry.state().returning, undefined);
});

// ── A playlist's own entries ──────────────────────────────────────────────────

type Occurrence = {id: string; media: {id: string}; hidden?: boolean};
function playlist(registry: Registry, occurrences: () => readonly Occurrence[], more: () => boolean = () => false) {
  const cards = new Map<string, ReturnType<typeof card>>();
  const scrolls: number[] = [];
  // As SavedPages names them: by occurrence, with their place.
  const layout = () => {
    const now = occurrences();
    const keys = new Set(now.filter(o => !o.hidden).map(o => cardFocusKey('list', o.id)));
    for (const [key, c] of cards) if (!keys.has(key)) { c.unregister(); cards.delete(key); }
    now.forEach((o, index) => { const key = cardFocusKey('list', o.id); if (!o.hidden && !cards.has(key)) cards.set(key, card(registry, 'playlist', key, {column: index})); });
  };
  registry.addResolver('playlist', arrayResolver<Occurrence>({group: 'list', items: occurrences, keyOf: o => o.id, usable: o => !o.hidden, more, scrollTo: index => scrolls.push(index)}));
  layout();
  return {cards, layout, scrolls};
}

test('the same song twice in a playlist: focus goes back to the occurrence it was started from', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let entries: Occurrence[] = [{id: 'o1', media: {id: 'song'}}, {id: 'o2', media: {id: 'other'}}, {id: 'o3', media: {id: 'song'}}];
  const p = playlist(registry, () => entries);
  assert.equal(p.cards.size, 3, 'two occurrences of one song are two controls');
  registry.focused('playlist', cardFocusKey('list', 'o1'));
  assert.equal(registry.capture()?.key, cardFocusKey('list', 'o1'));
  registry.restore();
  c.drain();
  assert.deepEqual([...p.cards.values()].map(x => x.asked), [1, 0, 0], 'the first occurrence, though the second registered last');
  // The first occurrence is removed under the player: the entry now in its place, not the other occurrence.
  registry.focused('playlist', cardFocusKey('list', 'o1'));
  registry.capture();
  entries = entries.slice(1);
  p.layout();
  registry.restore();
  c.drain();
  assert.equal(p.cards.get(cardFocusKey('list', 'o2'))?.asked, 1);
  assert.equal(p.cards.get(cardFocusKey('list', 'o3'))?.asked, 0);
  // Removing one occurrence leaves the other registered (its own name).
  assert.ok(p.cards.has(cardFocusKey('list', 'o3')));
});

test('a playlist entry past what has been read is read on to rather than taken as gone; a hidden neighbour is skipped', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const all: Occurrence[] = [{id: 'o0', media: {id: 'a'}}, {id: 'o1', media: {id: 'b'}, hidden: true}, {id: 'o2', media: {id: 'c'}}, {id: 'o3', media: {id: 'd'}}];
  let read = all;
  let asks = 0;
  const p = playlist(registry, () => read, () => { asks++; if (asks === 2) { read = all; p.layout(); } return read.length < all.length || asks < 2; });
  registry.focused('playlist', cardFocusKey('list', 'o3'));
  registry.capture();
  // Read again from the start under the player: only the first page is back.
  read = all.slice(0, 2);
  p.layout();
  registry.restore();
  c.drain();
  assert.ok(asks >= 1, 'the next page was asked for');
  assert.equal(p.cards.get(cardFocusKey('list', 'o3'))?.asked, 1);
  // Gone from a list read whole: its neighbour, skipping a hidden entry.
  registry.focused('playlist', cardFocusKey('list', 'o0'));
  registry.capture();
  read = all.filter(o => o.id !== 'o0');
  p.layout();
  registry.restore();
  c.drain();
  assert.equal(p.cards.get(cardFocusKey('list', 'o2'))?.asked, 1, 'o1 is hidden, so o2');
});

test('a playlist entry that became hidden under the player is gone: its nearest visible entry, or nothing when none is', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let entries: Occurrence[] = [{id: 'o1', media: {id: 'a'}}, {id: 'o2', media: {id: 'b'}}, {id: 'o3', media: {id: 'c'}}];
  const p = playlist(registry, () => entries);
  registry.focused('playlist', cardFocusKey('list', 'o1'));
  registry.capture();
  // The title is no longer visible to this profile: the occurrence stays, hidden (a disabled, unnamed row).
  entries = [{id: 'o1', media: {id: 'a'}, hidden: true}, ...entries.slice(1)];
  p.layout();
  registry.restore();
  c.drain();
  assert.equal(p.cards.get(cardFocusKey('list', 'o2'))?.asked, 1, 'the visible neighbour');
  assert.ok(!p.scrolls.includes(0), 'never scrolled to the hidden row');
  assert.equal(registry.state().returning, undefined);
  // Everything left is hidden: the return gives up at once rather than asking twelve times.
  registry.focused('playlist', cardFocusKey('list', 'o2'));
  registry.capture();
  entries = entries.map(o => ({...o, hidden: true}));
  p.layout();
  registry.restore();
  assert.equal(c.drain(), 1, 'one look, then stop');
  assert.equal(registry.state().returning, undefined);
});

test('the same song twice, one occurrence hidden: the hidden one hands over to its nearest visible entry; the visible one is still found', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let entries: Occurrence[] = [{id: 'o1', media: {id: 'song'}}, {id: 'o2', media: {id: 'other'}}, {id: 'o3', media: {id: 'x'}}, {id: 'o4', media: {id: 'song'}}];
  const p = playlist(registry, () => entries);
  registry.focused('playlist', cardFocusKey('list', 'o4'));
  registry.capture();
  entries = entries.map(o => (o.id === 'o4' ? {...o, hidden: true} : o));
  p.layout();
  registry.restore();
  c.drain();
  assert.equal(p.cards.get(cardFocusKey('list', 'o3'))?.asked, 1, 'its nearest visible entry');
  assert.equal(p.cards.get(cardFocusKey('list', 'o1'))?.asked, 0, 'not the other occurrence of the same song');
  // Started from the visible occurrence: found, though the other is hidden.
  registry.focused('playlist', cardFocusKey('list', 'o1'));
  registry.capture();
  registry.restore();
  c.drain();
  assert.equal(p.cards.get(cardFocusKey('list', 'o1'))?.asked, 1);
});

test('a TV letter jumped far, Left pressed before its page arrived: the page is read, its card drawn, then focused; a key on the way ends it', async () => {
  for (const interrupt of [false, true]) {
    const c = clock();
    const registry = createFocusReturn(c.timers);
    registry.setOwner('viewer');
    let release!: () => void;
    const slow = new Promise<void>(r => { release = r; });
    const ids = range(2000);
    const calls: number[] = [];
    // A slow server: the jumped-to page answers only when released.
    const fetchPage: FetchPage<Entry> = async (start, count) => { calls.push(start); if (start >= 1500) await slow; return {items: ids.slice(start, start + count).map(id => ({id})), total: ids.length}; };
    const list = createWindowedCollection<Entry>({fetchPage, pageSize: 60, maxResidentPages: 5, keyOf: e => e.id});
    list.ensureRange(0, 17);
    await settle();
    const cards = new Map<string, ReturnType<typeof card>>();
    let first = 0;
    const layout = () => { for (let i = first; i < first + 18; i++) { const slot = list.slotAt(i); if (slot.kind === 'item' && !cards.has(slot.item.id)) cards.set(slot.item.id, card(registry, 'library', cardFocusKey('cards', slot.item.id), {column: i})); } };
    list.subscribe(layout);
    const scrollToIndex = (index: number) => { first = index; list.ensureRange(index, index + 17); layout(); };
    // Select on "T": the grid jumps to 1530; Left at once.
    scrollToIndex(1530);
    registry.follow('library', windowLanding<Entry>({list: () => list, index: 1530, group: () => 'cards', keyOf: e => e.id, ensure: scrollToIndex}));
    assert.equal(list.slotAt(1530).kind, 'placeholder');
    c.next(); c.next();
    assert.ok(registry.state().returning, 'waiting for its page, not given up and not forgotten');
    if (interrupt) registry.intent();
    release();
    await settle();
    c.drain();
    assert.ok(calls.some(start => start <= 1530 && 1530 < start + 60), 'its page was asked for');
    assert.equal(cards.get('t1530')?.asked ?? 0, interrupt ? 0 : 1, interrupt ? 'a key on the way ends it' : 'the title jumped to');
    assert.equal(registry.state().returning, undefined);
    list.dispose();
  }
});

test('a TV letter landing whose card is loaded but not drawn yet is asked again until it is', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const list = {slotAt: (i: number) => ({kind: 'item' as const, item: {id: `t${i}`}}), ensureRange: () => {}};
  registry.follow('library', windowLanding<Entry>({list: () => list, index: 7, group: () => 'cards', keyOf: e => e.id, ensure: () => {}}));
  c.next(); c.next();
  const drawn = card(registry, 'library', cardFocusKey('cards', 't7'), {column: 7});
  c.drain();
  assert.equal(drawn.asked, 1);
  assert.equal(registry.state().returning, undefined);
});

test('a TV letter landing on a title that is loaded but was scrolled away and unmounted (the grid restored its old card) brings it back, then focuses it', () => {
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const list = {slotAt: (i: number) => ({kind: 'item' as const, item: {id: `t${i}`}}), ensureRange: () => {}};
  const cards = new Map<string, ReturnType<typeof card>>();
  let first = 0;
  // The grid mounts the cards of three rows of six from `first`.
  const layout = () => {
    for (const [id, c] of cards) { const i = Number(id.slice(1)); if (i < first || i >= first + 18) { c.unregister(); cards.delete(id); } }
    for (let i = first; i < first + 18; i++) if (!cards.has(`t${i}`)) cards.set(`t${i}`, card(registry, 'library', cardFocusKey('cards', `t${i}`), {column: i}));
  };
  const scrollToIndex = (index: number) => { first = index - (index % 6); layout(); };
  scrollToIndex(600);
  let generation = 1;
  registry.follow('library', windowLanding<Entry>({list: () => list, index: 603, group: () => 'cards', keyOf: e => e.id, ensure: scrollToIndex, current: () => generation === 1}));
  // Left: the grid's focus memory puts focus back on the first row's card and scrolls back there.
  scrollToIndex(0);
  assert.equal(cards.has('t603'), false, 'scrolled away, unmounted');
  c.drain();
  assert.equal(cards.get('t603')?.asked, 1, 'brought back into view, then focused');
  // A new list read after the jump: the landing ends rather than focusing whatever is there now.
  registry.follow('library', windowLanding<Entry>({list: () => list, index: 9, group: () => 'cards', keyOf: e => e.id, ensure: scrollToIndex, current: () => generation === 1}));
  generation = 2;
  c.drain();
  assert.equal(cards.get('t9')?.asked ?? 0, 0);
  assert.equal(registry.state().returning, undefined);
});

test('Android: the grid\'s guide names the title a letter jumped to once its card is drawn, and the landing that follows the Left finds focus already there', () => {
  // On the device the focus engine moves focus for Left before the app hears of it (the release),
  // and the grid's guide put it back on the card last used: the guide is told the title instead.
  const c = clock();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let loaded = false;
  const list = {slotAt: (i: number) => (loaded ? {kind: 'item' as const, item: {id: `t${i}`}} : {kind: 'placeholder' as const}), ensureRange: () => {}};
  const nodes = new Map<string, object>();
  const told: unknown[] = [];
  const locate = windowLanding<Entry>({list: () => list as never, index: 42, group: () => 'cards', keyOf: e => e.id, ensure: () => {}});
  landingDestination({locate, nodeOf: key => registry.nodeOf('library', key), found: node => told.push(node), timers: c.timers});
  c.next(); c.next();
  assert.deepEqual(told, [], 'still reading its page');
  loaded = true;
  c.next();
  assert.deepEqual(told, [], 'loaded, not drawn: no view to name yet');
  const view = {tag: 't42'};
  nodes.set('t42', view);
  let asked = 0;
  registry.register('library', cardFocusKey('cards', 't42'), {focus: () => { asked++; }, node: () => nodes.get('t42')}, {column: 42});
  c.next();
  assert.deepEqual(told, [view], 'its view, once');
  assert.equal(c.drain(), 0, 'and it stops looking');
  // The guide took the Left there; the landing started by the same Left sees it and ends without asking.
  registry.focused('library', cardFocusKey('cards', 't42'));
  registry.follow('library', windowLanding<Entry>({list: () => list as never, index: 42, group: () => 'cards', keyOf: e => e.id, ensure: () => {}}));
  registry.intent();
  c.drain();
  assert.equal(asked, 0, 'never asked again (a key pressed meanwhile would have been pulled back)');
  assert.equal(registry.state().returning, undefined);
});

test('a landing destination stops when told to, when the list is gone, and after its bounded looks', () => {
  const c = clock();
  let stop = landingDestination({locate: () => 'loading', nodeOf: () => undefined, found: () => assert.fail('nothing to find'), timers: c.timers, attempts: 5});
  assert.equal(c.drain(), 5, 'five looks, then it gives up');
  stop = landingDestination({locate: () => 'loading', nodeOf: () => undefined, found: () => assert.fail('stopped'), timers: c.timers});
  c.next();
  stop();
  assert.equal(c.drain(), 0);
  landingDestination({locate: () => 'gone', nodeOf: () => ({}), found: () => assert.fail('gone'), timers: c.timers});
  assert.equal(c.drain(), 1);
});
