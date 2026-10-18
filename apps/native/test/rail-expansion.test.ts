/**
 * PERF-06: toggling the rail's expansion must not re-render `RailItem`s.
 *
 * The app has no component renderer under `node:test` (see `hook-driver.ts`), so this test pins
 * the contract `Rail.tsx` relies on, through the same seam (`createRailExpansion`):
 * - expansion state lives in the shared value, never in React state;
 * - labels and the wordmark update through the a11y channel (counted here with wrappers);
 * - rail items have no subscription channel at all — structurally, toggling expansion cannot
 *   reach them. `Rail.tsx` additionally keeps every `RailItem` prop stable across toggles
 *   (memoised items, stable callbacks, animated styles reading the shared value), so a toggle
 *   performs zero `RailItem` renders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRailExpansion} from '../src/shell/rail-expansion.ts';

const settle = async (ms = 20) => new Promise(r => setTimeout(r, ms));

test('toggling expansion updates labels/a11y but offers no channel that could re-render rail items', async () => {
  const shared = {value: 0};
  const rail = createRailExpansion({shared, collapsedWidth: 112, expandedWidth: 340, collapseDelayMs: 5});
  // Wrappers counting label/a11y renders, the way the labels subscribe in the app.
  let labelRenders = 0;
  const stopLabels = rail.subscribeA11y(() => labelRenders++);

  assert.equal(rail.isExpanded(), false);
  assert.equal(rail.shared, shared, 'the shared value keeps its identity (styles read it, no React state)');
  assert.equal(rail.collapsedX(), -(340 - 112), 'collapsed panel leaves exactly the collapsed width visible');
  assert.ok(!('subscribeItems' in rail), 'rail items have no subscription: a toggle cannot re-render them');

  // Open: immediate, like focus/pointer entering.
  rail.expand();
  assert.equal(rail.isExpanded(), true);
  // Close, then re-enter before the delay: the collapse is cancelled.
  rail.collapse();
  rail.expand();
  await settle();
  assert.equal(rail.isExpanded(), true);
  // A real close: the delay elapses and labels/a11y are notified.
  rail.collapse();
  await settle();
  assert.equal(rail.isExpanded(), false);

  assert.ok(labelRenders >= 2, `labels/a11y updated on open and close (saw ${labelRenders})`);
  stopLabels();
});

test('expand is idempotent and collapse when already closed does nothing', async () => {
  const rail = createRailExpansion({shared: {value: 0}, collapsedWidth: 60, expandedWidth: 212, collapseDelayMs: 5});
  let notes = 0;
  const stop = rail.subscribeA11y(() => notes++);
  rail.expand();
  rail.expand();
  assert.equal(notes, 1);
  rail.collapse();
  await settle();
  assert.equal(notes, 2);
  rail.collapse();
  await settle();
  assert.equal(notes, 2, 'no extra notification when nothing changed');
  stop();
});

test('collapseNow closes at once for a caller that already waited out its debounce, and cancels a pending collapse', async () => {
  const shared = {value: 0};
  const rail = createRailExpansion({shared, collapsedWidth: 112, expandedWidth: 340, collapseDelayMs: 5});
  let notified = 0;
  const stop = rail.subscribeA11y(() => notified++);
  rail.expand();
  rail.collapse();
  rail.collapseNow();
  assert.equal(rail.isExpanded(), false, 'closed without waiting');
  const after = notified;
  await settle();
  assert.equal(notified, after, 'the earlier delayed collapse does not notify a second time');
  rail.collapseNow();
  assert.equal(notified, after, 'closing when already closed does nothing');
  stop();
});
