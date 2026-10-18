/**
 * TV-PLAYER-03: the television rows playback is started from carry their focus names, rendered
 * from their own source (the screen harness: React and native modules stubbed, the component's
 * own code run): an episode row in the TV episode list, and every windowed track row (an album's
 * or artist's songs, a book's chapters or parts, sorted or not, and a sorted playlist's rows).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {cardFocusKey} from '../src/ui/focus-return.ts';
import * as episodeOpen from '../src/screens/title/episode-open.ts';

/** Any name a module is asked for: a component stands in as its name; a hook or helper as a function returning nothing. */
const loose = (named: Record<string, unknown> = {}) => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
const theme = () => ({isTV: true, space: {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, page: 48}, metrics: {radius: {control: 8, card: 12}}, colors: {text: '#fff', ink: '#000', raised: '#111', textSecondary: '#aaa', textTertiary: '#888'}});
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
/** A windowed list holding `entries` from index 0. */
const windowOf = (entries: {id: string; title: string}[]) => ({pageOf: () => 0, subscribePage: () => () => {}, getPageVersion: () => '1', slotAt: (i: number) => (entries[i] ? {kind: 'item', item: entries[i]} : {kind: 'placeholder'})});

test('a TV episode row is named by its episode, with its place in the season', async () => {
  const m = await screenModule(new URL('../src/screens/title/Episodes.tsx', import.meta.url), {
    react: react(), 'react-native-safe-area-context': loose(), 'react-native': loose(), 'react-native-reanimated': loose(), 'react-native-svg': loose(),
    '../../app/content': loose({progressFor: () => 0, formatDuration: () => ''}), '../../app/i18n': loose({useI18n: () => ({t: (id: string) => id})}),
    '../../../../../packages/client-core/src/presentation/index': loose(),
    '../../ui': loose({cardFocusKey, useTheme: theme}), '../../ui/ArtworkPipeline': loose(), '../../ui/focus-lists': loose(),
    './facts': loose({episodeCode: () => ''}), './layout': loose(), './episode-open': episodeOpen,
  });
  const list = windowOf([{id: 'e1', title: 'Pilot'}, {id: 'e2', title: 'Two'}, {id: 'e3', title: 'Three'}]);
  const row = m.TvEpisodeRow({list, index: 2, marks: {}, handlers: {onPlay: () => {}, onDetails: () => {}}, onFocused: () => {}});
  const control = all(row).find(n => n.type === 'Focusable');
  assert.equal(control?.props.focusKey, cardFocusKey('episodes', 'e3'));
  assert.deepEqual(control?.props.focusPlace, {column: 2});
  assert.equal(m.episodeFocusKey({id: 'e3'}), cardFocusKey('episodes', 'e3'), 'the name its details\' Play belongs to');
  // A row whose page has not arrived has no name (nothing to return to there yet).
  const waiting = m.TvEpisodeRow({list, index: 7, marks: {}, handlers: {onPlay: () => {}, onDetails: () => {}}, onFocused: () => {}});
  assert.equal(all(waiting).find(n => n.type === 'Focusable')?.props.focusKey, undefined);
});

test('a windowed track row is named by its entry in its list\'s group: tracks by default, sorted rows their own', async () => {
  const entries = [{id: 's1', title: 'One', kind: 'song', playback: {itemId: 's1'}}, {id: 's2', title: 'Two', kind: 'song', playback: {itemId: 's2'}}];
  const m = await screenModule(new URL('../src/screens/title/TrackWindow.tsx', import.meta.url), {
    react: react(), 'react-native': loose(), 'react-native-safe-area-context': loose(),
    '../../app/content': loose(), '../../app/player-actions': loose(),
    '../../ui': loose({cardFocusKey, useTheme: theme}), '../../ui/focus-lists': loose(),
    './Episodes': {useSlot: (list: ReturnType<typeof windowOf>, index: number) => { const slot = list.slotAt(index); return slot.kind === 'item' ? slot.item : undefined; }},
  });
  const list = windowOf(entries);
  const rowOf = (row: object, index: number) => all(m.TrackRow({list, index, height: 64, row: {onPlay: () => {}, ...row}})).find(n => n.type === 'ListRow')?.props;
  assert.equal(rowOf({}, 1).focusKey, cardFocusKey('tracks', 's2'), 'an album\'s, an artist\'s or a book\'s rows');
  assert.deepEqual(rowOf({}, 1).focusPlace, {column: 1});
  assert.equal(rowOf({focusGroup: 'sorted'}, 0).focusKey, cardFocusKey('sorted', 's1'), 'a sorted playlist\'s rows');
  assert.equal(m.trackFocusGroup({}), 'tracks');
});
