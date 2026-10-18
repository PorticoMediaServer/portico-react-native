/**
 * TV-PLAYER-03: playback started from an episode's open details (Play/Resume, Play from start,
 * More → Play) when that episode has gone by the time the player closes. The pane's actions are
 * rendered from EpisodeDetails' own source (the screen harness) for their names and place; the
 * return runs on the real registry and binding, EpisodeBrowser's window policy and client-core's
 * real windowed collection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {cardFocusKey, createFocusReturn, withinFocusKey} from '../src/ui/focus-return.ts';
import {useFocusOverlay, useFocusReturnBinding} from '../src/ui/focus-binding.ts';
import {windowResolver} from '../src/ui/focus-lists.ts';
import {createWindowedCollection, type FetchPage} from '../../../packages/client-core/src/collections/index.ts';
import * as episodeOpen from '../src/screens/title/episode-open.ts';

const loose = (named: Record<string, unknown> = {}) => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
const theme = () => ({isTV: true, space: {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, page: 48}, metrics: {radius: {small: 4, control: 8, card: 12}}, colors: {}});
function react() {
  const h = hooks();
  const base = {...h.react, memo: (f: unknown) => f, createContext: (value: unknown) => ({value}), forwardRef: (f: unknown) => f};
  return {...base, default: base};
}
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}

/** The pane's named actions, as EpisodeDetails renders them on TV for `entry` at `index`. */
async function paneActions(entry: {id: string}, index: number | undefined) {
  const episodes = await screenModule(new URL('../src/screens/title/Episodes.tsx', import.meta.url), {
    react: react(), 'react-native-safe-area-context': loose(), 'react-native': loose(), 'react-native-reanimated': loose(), 'react-native-svg': loose(),
    '../../app/content': loose(), '../../app/i18n': loose(), '../../../../../packages/client-core/src/presentation/index': loose(),
    '../../ui': loose({cardFocusKey, useTheme: theme}), '../../ui/ArtworkPipeline': loose(), '../../ui/focus-lists': loose(),
    './facts': loose(), './layout': loose(), './episode-open': episodeOpen,
  });
  const m = await screenModule(new URL('../src/screens/title/EpisodeDetails.tsx', import.meta.url), {
    react: react(), 'react-native': loose(),
    '../../app/content': loose({formatDuration: () => '', useArtwork: () => () => undefined}),
    '../../app/detail': {useDetail: () => ({snapshot: {phase: 'ready'}, mutate: () => {}, retry: () => {}, retryMutation: () => {}})},
    '../../app/errors': loose(), '../../app/i18n': loose({useI18n: () => ({t: (id: string) => id, date: () => '', list: (a: string[]) => a.join(', ')})}),
    '../../app/session': loose({useSession: () => ({api: {}})}),
    '../../ui': loose({useTheme: theme, withinFocusKey, spec: {hero: {facts: {badge: {height: {}, paddingX: {}, border: 'border', role: 'caption'}}}}}),
    './Episodes': episodes, './PlaybackChoices': loose(), '../../app/player-actions': loose({usePlayerActions: () => ({more: () => {}})}),
    './facts': loose({episodeCode: () => '', isActing: () => false, namesIn: () => []}), './episode-open': episodeOpen, './episode-credits': loose(),
  });
  // Partly watched, so Play from start is there too.
  const tree = m.EpisodeDetails({libraryId: 'l', entry: {...entry, title: entry.id, kind: 'episode', playback: {itemId: entry.id}, progressSeconds: 90, watched: false}, index, heading: false, columns: false, onPlay: () => {}, onChanged: () => {}, onPerson: () => {}});
  return all(tree).filter(n => n.type === 'Button' && n.props.focusKey).map(n => ({key: n.props.focusKey as string, place: n.props.focusPlace as {column?: number} | undefined}));
}

test('the pane\'s Play, Play from start and More belong to the episode\'s row, with the row\'s place', async () => {
  const actions = await paneActions({id: 'e2'}, 2);
  const row = cardFocusKey('episodes', 'e2');
  assert.deepEqual(actions, ['play', 'restart', 'more'].map(action => ({key: withinFocusKey(row, action), place: {column: 2}})));
  assert.deepEqual((await paneActions({id: 'e2'}, undefined)).map(a => a.place), [undefined, undefined, undefined], 'no index given: no place made up');
});

type Entry = {id: string};
function clock() {
  const queue = new Map<number, () => void>();
  let seq = 0;
  return {
    timers: {schedule: (run: () => void) => { const id = ++seq; queue.set(id, run); return id; }, cancel: (id: unknown) => { queue.delete(id as number); }},
    async drain(limit = 200) { let n = 0; while (queue.size && n < limit) { const [id, run] = queue.entries().next().value!; queue.delete(id); run(); n++; await settle(); } return n; },
  };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const range = (n: number) => Array.from({length: n}, (_, i) => `e${i}`);

/**
 * A show's TV episode list as EpisodeBrowser wires it: the real collection, its window policy,
 * rows named by episode with their place for the loaded slots in view (`TvEpisodeRow`).
 */
function episodeList(registry: ReturnType<typeof createFocusReturn>, ids: () => readonly string[]) {
  const calls: number[] = [];
  const fetchPage: FetchPage<Entry> = async (start, count) => { calls.push(start); const now = ids(); return {items: now.slice(start, start + count).map(id => ({id})), total: now.length}; };
  const list = createWindowedCollection<Entry>({fetchPage, pageSize: 60, maxResidentPages: 5, keyOf: e => e.id});
  const view = {first: 0};
  const rows = new Map<string, {asked: number; off: () => void}>();
  const layout = () => {
    const shown = new Set<string>();
    for (let i = view.first; i < view.first + 6; i++) {
      const slot = list.slotAt(i);
      if (slot.kind !== 'item') continue;
      const key = cardFocusKey('episodes', slot.item.id);
      shown.add(key);
      if (!rows.has(key)) {
        const row = {asked: 0, off: () => {}};
        row.off = registry.register('show', key, {focus: still => { if (still()) { row.asked++; registry.focused('show', key); } }}, {column: i});
        rows.set(key, row);
      }
    }
    for (const [key, row] of rows) if (!shown.has(key)) { row.off(); rows.delete(key); }
  };
  const scrollTo = (index: number) => { view.first = index; list.ensureRange(index, index + 8); layout(); };
  list.subscribe(layout);
  const total = () => list.getSnapshot().total;
  registry.addResolver('show', windowResolver<Entry>({group: 'episodes', list: () => list, total: () => { const t = total(); return t !== undefined && t > 0 ? t : undefined; }, keyOf: e => e.id, scrollTo}));
  return {list, rows, calls, view, async open(first: number) { view.first = first; list.ensureRange(first, first + 8); await settle(); layout(); }};
}

/** Starts playback from the pane's `action` for the episode at `index`; the pane and its episode then go under the player. */
async function startFromPane(registry: ReturnType<typeof createFocusReturn>, index: number, action: string) {
  const id = `e${index}`;
  const button = (await paneActions({id}, index)).find(a => a.key === withinFocusKey(cardFocusKey('episodes', id), action))!;
  let handlers!: ReturnType<typeof useFocusReturnBinding>;
  const pane = createHookHost(() => { handlers = useFocusReturnBinding({tv: true, scope: 'show', key: button.key, place: button.place, request: () => handlers.onFocus(), registry}); });
  pane.mount();
  handlers.onFocus();
  if (action === 'more') {
    // More opens the menu; Play is chosen there.
    const menu = createHookHost(() => useFocusOverlay(true, registry));
    menu.mount();
    handlers.onBlur();
    assert.equal(registry.capture()?.key, button.key);
    menu.unmount();
  } else {
    assert.equal(registry.capture()?.key, button.key);
  }
  return () => pane.unmount();
}

for (const action of ['play', 'restart', 'more']) {
  test(`${action}: the episode removed from a small list → the episode now in its place`, async () => {
    const c = clock();
    const registry = createFocusReturn(c.timers);
    registry.setOwner('viewer');
    let ids = range(6);
    const l = episodeList(registry, () => ids);
    await l.open(0);
    const closePane = await startFromPane(registry, 2, action);
    ids = ids.filter(id => id !== 'e2');
    closePane();
    l.list.invalidate();
    await settle();
    l.view.first = 0;
    registry.restore();
    await c.drain();
    assert.equal(l.rows.get(cardFocusKey('episodes', 'e3'))?.asked, 1, 'e3 is at its old place now');
    assert.equal(registry.state().returning, undefined);
  });

  test(`${action}: the last episode, the list shorter → the new last episode`, async () => {
    const c = clock();
    const registry = createFocusReturn(c.timers);
    registry.setOwner('viewer');
    let ids = range(6);
    const l = episodeList(registry, () => ids);
    await l.open(0);
    const closePane = await startFromPane(registry, 5, action);
    ids = range(4);
    closePane();
    l.list.invalidate();
    await settle();
    registry.restore();
    await c.drain();
    assert.equal(l.rows.get(cardFocusKey('episodes', 'e3'))?.asked, 1);
  });

  test(`${action}: its neighbourhood no longer held (read again, scrolled away) → read, then the episode now in its place`, async () => {
    const c = clock();
    const registry = createFocusReturn(c.timers);
    registry.setOwner('viewer');
    let ids = range(2000);
    const l = episodeList(registry, () => ids);
    await l.open(1510);
    const closePane = await startFromPane(registry, 1510, action);
    ids = ids.filter(id => id !== 'e1510');
    closePane();
    l.list.invalidate();
    await settle();
    for (const first of [900, 600, 300, 0]) await l.open(first);
    assert.equal(l.list.slotAt(1510).kind, 'placeholder', 'its page was evicted');
    const before = l.calls.length;
    registry.restore();
    await c.drain();
    assert.ok(l.calls.slice(before).some(start => start <= 1510 && 1510 < start + 60), 'its page was read again');
    assert.equal(l.rows.get(cardFocusKey('episodes', 'e1511'))?.asked, 1, 'the episode now at its place');
  });
}
