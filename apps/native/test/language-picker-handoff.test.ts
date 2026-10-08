/**
 * M9: after a language menu closes, the list sheet must come back.
 *
 * The overlay gate below mirrors `afterOverlaysClose` in ui/Sheet (an opening
 * overlay waits for every closing one to finish, with the same never-wait
 * fallback): the tests pin the picker's sequencing through the
 * `closeLanguageMenu` seam, including the effect order that made the old code
 * flaky — in the commit that closes a menu, the list Sheet's `open` effect
 * runs before the menu Sheet's (JSX sibling order), so a synchronous reopen
 * presents the list while the menu is still dismissing and iOS drops it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeLanguageMenu} from '../src/screens/settings/language-picker-handoff.ts';

/** Sheet's overlay gate, verbatim in behaviour: marks, waiters, the fallback. */
function scriptGate() {
  const closing = new Set<string>();
  const waiters = new Set<() => void>();
  return {
    mark(id: string, isClosing: boolean) {
      if (isClosing) { closing.add(id); return; }
      closing.delete(id);
      if (closing.size) return;
      for (const run of [...waiters]) { waiters.delete(run); run(); }
    },
    afterClose(fn: () => void) {
      if (!closing.size) { fn(); return; }
      let done = false;
      const run = () => { if (done) return; done = true; waiters.delete(run); clearTimeout(fallback); fn(); };
      const fallback = setTimeout(run, 400);
      waiters.add(run);
      return () => { done = true; waiters.delete(run); clearTimeout(fallback); };
    },
    get busy() { return closing.size > 0; },
  };
}

test('M9: the old synchronous reopen presents while the menu is still dismissing', () => {
  const gate = scriptGate();
  const events: string[] = [];
  let menuOpen = true;
  let listOpen = false;
  // The old handler: clear the menu and reopen the list in the same tick.
  menuOpen = false;
  listOpen = true;
  // The commit's effects, in sibling order: the list Sheet's `open` effect
  // runs first and sees no closing overlay, so it presents at once …
  if (listOpen) gate.afterClose(() => events.push('present'));
  // … and only then does the menu Sheet's effect mark itself closing.
  if (!menuOpen) { gate.mark('menu', true); events.push('menu-closing'); }
  assert.deepEqual(events, ['present', 'menu-closing'], 'the list presented underneath the still-dismissing menu: iOS drops it');
});

test('M9: closing a menu reopens the list only after the menu has gone', () => {
  const gate = scriptGate();
  const events: string[] = [];
  let menuOpen = true;
  let listOpen = false;
  const deferred: Array<() => void> = [];
  closeLanguageMenu({
    clearMenu: () => { menuOpen = false; },
    defer: fn => { deferred.push(fn); },
    gate: {runAfterClose: fn => { gate.afterClose(fn); }},
    reopenList: () => { listOpen = true; events.push('present'); },
  });
  assert.equal(menuOpen, false, 'the menu hides at once');
  assert.equal(listOpen, false, 'the list must not reopen synchronously');
  // The commit: the menu Sheet marks itself closing (the list is still shut).
  gate.mark('menu', true);
  assert.equal(listOpen, false);
  // A turn later the reopen is sequenced: the menu is closing, so it waits.
  deferred.splice(0).forEach(run => run());
  assert.equal(listOpen, false, 'still waiting: the menu has not finished dismissing');
  // The menu finishes (exit animation, unmount, UIKit grace): the list returns.
  gate.mark('menu', false);
  assert.equal(listOpen, true);
  assert.deepEqual(events, ['present']);
});

test('M9: with nothing closing, the list reopens at once', () => {
  const gate = scriptGate();
  let listOpen = false;
  const deferred: Array<() => void> = [];
  closeLanguageMenu({
    clearMenu: () => {},
    defer: fn => { deferred.push(fn); },
    gate: {runAfterClose: fn => { gate.afterClose(fn); }},
    reopenList: () => { listOpen = true; },
  });
  deferred.splice(0).forEach(run => run());
  assert.equal(listOpen, true);
});
