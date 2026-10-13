/**
 * History, playlists and saved views grow as the viewer scrolls. They are handed to one
 * virtualised list as rows, so the rows have to be stable as pages arrive and correct per day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardRows, gridColumns, historyRows} from '../src/app/list-rows.ts';

const entry = (id: string, day: string, o: {hidden?: boolean; media?: string | null} = {}) => ({id, hidden: o.hidden ?? false, ...(o.media === null ? {} : {media: {id: o.media ?? `m-${id}`}}), updatedAt: day});
const dayOf = (iso: string | undefined) => iso ?? 'Earlier';

test('cards fill the width in whole columns', () => {
  assert.deepEqual(gridColumns(1000, 200, 20), {columns: 4, columnWidth: 235});
  assert.deepEqual(gridColumns(100, 200, 20), {columns: 1, columnWidth: 100});
});

test('rows are keyed by their first card, so earlier rows keep their identity as pages arrive', () => {
  const ids = (n: number) => Array.from({length: n}, (_, i) => ({id: `e${i}`}));
  const before = cardRows(ids(7), 3, e => e.id);
  const after = cardRows(ids(11), 3, e => e.id);
  assert.deepEqual(before.map(r => r.key), ['cards:e0', 'cards:e3', 'cards:e6']);
  assert.deepEqual(after.slice(0, 3).map(r => r.key), before.map(r => r.key));
  assert.deepEqual(after.map(r => r.items.length), [3, 3, 3, 2]);
  assert.deepEqual(after.map(r => r.first), [0, 3, 6, 9]);
});

test('history is one card per title under a heading per day', () => {
  const entries = [entry('a', 'Today'), entry('b', 'Today'), entry('c', 'Today', {media: 'm-a'}), entry('d', 'Yesterday'), entry('e', 'Yesterday', {hidden: true}), entry('f', 'Yesterday', {media: null}), entry('g', 'Yesterday')];
  const {rows, shown} = historyRows(entries, dayOf, () => 2);
  assert.equal(shown, 4);
  assert.deepEqual(rows.map(r => (r.kind === 'day' ? `# ${r.label}` : r.items.map(e => e.id).join(','))), ['# Today', 'a,b', '# Yesterday', 'd,g']);
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length);
});

test('each day takes its own number of columns', () => {
  const entries = [...Array.from({length: 5}, (_, i) => entry(`t${i}`, 'Today')), ...Array.from({length: 5}, (_, i) => entry(`y${i}`, 'Yesterday'))];
  const {rows} = historyRows(entries, dayOf, day => (day[0]!.id.startsWith('t') ? 5 : 2));
  assert.deepEqual(rows.map(r => (r.kind === 'day' ? r.label : r.items.length)), ['Today', 5, 'Yesterday', 2, 2, 1]);
});

test('a later page extends the last day without renaming what is listed', () => {
  const first = [entry('a', 'Today'), entry('b', 'Today')];
  const more = [...first, entry('c', 'Today'), entry('d', 'Monday')];
  const before = historyRows(first, dayOf, () => 2).rows.map(r => r.key);
  const after = historyRows(more, dayOf, () => 2).rows.map(r => r.key);
  assert.deepEqual(after.slice(0, before.length), before);
});
