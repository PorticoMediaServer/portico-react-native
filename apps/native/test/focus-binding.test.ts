/**
 * TV-PLAYER-03: a control's side of focus coming back, as `Focusable` runs it (`focus-binding.ts`),
 * through the hook driver: registration while mounted, every control reporting focus, names that
 * change under focus, sheets and menus, and unmounting without a blur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost} from './hook-driver.ts';
import {cardFocusKey, createFocusReturn} from '../src/ui/focus-return.ts';
import {nativeFocusRequest, useFocusOverlay, useFocusReturnBinding} from '../src/ui/focus-binding.ts';
import {arrayResolver} from '../src/ui/focus-lists.ts';

const timers = () => ({schedule: (run: () => void) => setImmediate(run), cancel: (h: unknown) => clearImmediate(h as NodeJS.Immediate)});

/** One mounted control: `props` are what Focusable passes; `focus`/`blur` are its native events. */
function mount(registry: ReturnType<typeof createFocusReturn>, props: {key?: string; place?: {row?: number; column?: number}; overlay?: boolean; scope?: string; tv?: boolean}) {
  const now = {...props};
  let handlers!: ReturnType<typeof useFocusReturnBinding>;
  const host = createHookHost(() => { handlers = useFocusReturnBinding({tv: now.tv ?? true, scope: now.scope ?? 'home', key: now.key, place: now.place, overlay: now.overlay, request: () => handlers.onFocus(), registry}); });
  host.mount();
  return {host, set(next: Partial<typeof props>) { Object.assign(now, next); host.rerender(); }, focus: () => handlers.onFocus(), blur: () => handlers.onBlur()};
}

test('a named control is registered while mounted and is captured with its place as it is now', () => {
  const registry = createFocusReturn(timers());
  registry.setOwner('viewer');
  const key = cardFocusKey('continue', 'm1');
  const c = mount(registry, {key, place: {row: 1, column: 4}});
  c.focus();
  // The card moved in its row (a refresh): one registration, read when needed.
  c.set({place: {row: 1, column: 2}});
  assert.deepEqual(registry.capture(), {owner: 'viewer', scope: 'home', key, place: {row: 1, column: 2}});
  c.host.unmount();
});

test('unmounted while it has focus (no blur): nothing is captured from it', () => {
  const registry = createFocusReturn(timers());
  registry.setOwner('viewer');
  const c = mount(registry, {key: cardFocusKey('row', 'a')});
  c.focus();
  c.host.unmount();
  assert.equal(registry.capture(), undefined);
});

test('a windowed row whose entry changes under focus is the focused control under its new name', () => {
  const registry = createFocusReturn(timers());
  registry.setOwner('viewer');
  const c = mount(registry, {key: cardFocusKey('episodes', 'e1'), place: {column: 0}});
  c.focus();
  c.set({key: cardFocusKey('episodes', 'e9')});
  assert.equal(registry.capture()?.key, cardFocusKey('episodes', 'e9'));
  c.host.unmount();
});

test('focus on an unnamed control ends the named one: playback from it never revives an older name', () => {
  const registry = createFocusReturn(timers());
  registry.setOwner('viewer');
  const named = mount(registry, {key: 'action:primary'});
  const unnamed = mount(registry, {key: undefined});
  named.focus();
  named.blur();
  unnamed.focus();
  assert.equal(registry.capture(), undefined);
  // Its More menu opens (a sheet), and Play is chosen there: still nothing.
  const menu = createHookHost(() => useFocusOverlay(true, registry));
  menu.mount();
  const play = mount(registry, {key: 'action:play', overlay: true});
  play.focus();
  assert.equal(registry.capture(), undefined);
  menu.unmount();
  for (const c of [named, unnamed, play]) c.host.unmount();
});

test('inside a sheet controls are never named; the control it was opened from is captured', () => {
  const registry = createFocusReturn(timers());
  registry.setOwner('viewer');
  const key = cardFocusKey('tracks', 't3');
  const row = mount(registry, {key, place: {column: 3}});
  row.focus();
  const menu = createHookHost(() => useFocusOverlay(true, registry));
  menu.mount();
  assert.equal(registry.state().overlays, 1);
  row.blur();
  // A menu row with a name of its own (a Button with focusKey inside a sheet) is not registered.
  const inside = mount(registry, {key: 'action:play', overlay: true});
  inside.focus();
  assert.deepEqual(registry.capture(), {owner: 'viewer', scope: 'home', key, place: {row: undefined, column: 3}});
  menu.unmount();
  assert.equal(registry.state().overlays, 0);
  row.host.unmount();
  inside.host.unmount();
});

test('off television nothing registers or reports', () => {
  const registry = createFocusReturn(timers());
  registry.setOwner('viewer');
  const c = mount(registry, {key: 'action:primary', tv: false});
  c.focus();
  assert.equal(registry.capture(), undefined);
  assert.equal(registry.state().current, null);
  c.host.unmount();
});

// ── The request a frame later, and the menu's own invoker (R2 review findings 1 and 2) ──────

/** Manual timers for the registry: `next()` runs one step. */
function clock() {
  const queue = new Map<number, () => void>();
  let seq = 0;
  return {
    timers: {schedule: (run: () => void) => { const id = ++seq; queue.set(id, run); return id; }, cancel: (id: unknown) => { queue.delete(id as number); }},
    next() { const first = queue.entries().next().value; if (!first) return false; queue.delete(first[0]); first[1](); return true; },
    drain(limit = 100) { let n = 0; while (queue.size && n < limit) { this.next(); n++; } return n; },
  };
}
/** Animation frames held until `run()`, as requestAnimationFrame holds them. */
function frames() {
  const queue: (() => void)[] = [];
  return {frame: (run: () => void) => { queue.push(run); }, size: () => queue.length, run() { const now = queue.splice(0); now.forEach(f => f()); return now.length; }};
}
/** A control as Focusable mounts it: the real binding and its real deferred request, over a native view that takes focus when asked. */
function nativeControl(registry: ReturnType<typeof createFocusReturn>, f: ReturnType<typeof frames>, props: {key?: string; place?: {row?: number; column?: number}; scope?: string}) {
  const now = {...props};
  let handlers!: ReturnType<typeof useFocusReturnBinding>;
  const view = {asked: 0, requestTVFocus() { view.asked++; handlers.onFocus(); }};
  const host = createHookHost(() => { handlers = useFocusReturnBinding({tv: true, scope: now.scope ?? 'home', key: now.key, place: now.place, request: nativeFocusRequest(() => view, f.frame), registry}); });
  host.mount();
  return {host, view, set(next: Partial<typeof props>) { Object.assign(now, next); host.rerender(); }, focus: () => handlers.onFocus(), blur: () => handlers.onBlur()};
}

test('the native request runs a frame later and lands when the return still wants it', () => {
  const c = clock(), f = frames();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const row = nativeControl(registry, f, {key: cardFocusKey('tracks', 't2'), place: {column: 2}});
  row.focus();
  registry.capture();
  row.blur();
  registry.restore();
  c.next();
  assert.equal(row.view.asked, 0, 'queued for the next frame, not yet sent');
  assert.equal(f.run(), 1);
  assert.equal(row.view.asked, 1);
  assert.equal(registry.state().returning, undefined, 'focus observed: the return is over');
  row.host.unmount();
});

test('a return ended after its request was queued, before the frame ran: the old request does nothing', () => {
  const key = cardFocusKey('tracks', 't2');
  const endings: [string, (r: ReturnType<typeof createFocusReturn>, row: ReturnType<typeof nativeControl>) => void][] = [
    ['a remote key', r => r.intent()],
    ['the screen covered or left', r => r.setScopeActive('home', false)],
    ['the player host gone (owner cleared)', r => r.setOwner('')],
    ['another viewer', r => r.setOwner('other')],
    ['the screen disposed', r => r.disposeScope('home')],
    ['the row reused for another entry', (_, row) => row.set({key: cardFocusKey('tracks', 't7')})],
    ['the row unmounted', (_, row) => row.host.unmount()],
  ];
  for (const [name, end] of endings) {
    const c = clock(), f = frames();
    const registry = createFocusReturn(c.timers);
    registry.setOwner('viewer');
    const row = nativeControl(registry, f, {key, place: {column: 2}});
    row.focus();
    registry.capture();
    row.blur();
    registry.restore();
    // The first ask (and, for a refusing view, a retry) queues the native request.
    c.next();
    assert.equal(f.size(), 1, name);
    end(registry, row);
    f.run();
    assert.equal(row.view.asked, 0, `${name}: no native request after it`);
    row.host.unmount();
  }
});

test('the row reused under a queued request: the control now holding that entry is asked instead, never the reused row', () => {
  const c = clock(), f = frames();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  const key = cardFocusKey('tracks', 't2');
  const first = nativeControl(registry, f, {key, place: {column: 2}});
  first.focus();
  registry.capture();
  first.blur();
  registry.restore();
  c.next();
  // The list redraws: this row now shows t7; another row shows t2.
  first.set({key: cardFocusKey('tracks', 't7')});
  const moved = nativeControl(registry, f, {key, place: {column: 3}});
  f.run();
  assert.equal(first.view.asked, 0, 'the reused row is not focused');
  c.next();
  f.run();
  assert.equal(moved.view.asked, 1, 'the row with the entry is');
  assert.equal(registry.state().returning, undefined);
  first.host.unmount();
  moved.host.unmount();
});

test('More, then the row under the open menu is redrawn for another entry or unmounted: Play still comes from the row it was opened from', () => {
  for (const change of ['renamed after blur', 'renamed before blur', 'unmounted'] as const) {
    const registry = createFocusReturn(clock().timers);
    registry.setOwner('viewer');
    const t1 = cardFocusKey('tracks', 't1');
    const row = mount(registry, {key: t1, place: {column: 10}});
    row.focus();
    const menu = createHookHost(() => useFocusOverlay(true, registry));
    menu.mount();
    const inside = mount(registry, {key: 'action:play', overlay: true});
    if (change === 'renamed before blur') row.set({key: cardFocusKey('tracks', 't9')});
    row.blur();
    inside.focus();
    if (change === 'renamed after blur') row.set({key: cardFocusKey('tracks', 't9')});
    if (change === 'unmounted') row.host.unmount();
    assert.deepEqual(registry.capture(), {owner: 'viewer', scope: 'home', key: t1, place: {row: undefined, column: 10}}, change);
    menu.unmount();
    row.host.unmount();
    inside.host.unmount();
  }
});

test('a menu\'s invoker lasts through a nested sheet, and never outlives the menus: a later menu has its own', () => {
  const registry = createFocusReturn(clock().timers);
  registry.setOwner('viewer');
  const t1 = cardFocusKey('tracks', 't1');
  const row = mount(registry, {key: t1, place: {column: 1}});
  row.focus();
  const menu = createHookHost(() => useFocusOverlay(true, registry));
  menu.mount();
  row.blur();
  const nested = createHookHost(() => useFocusOverlay(true, registry));
  nested.mount();
  row.host.unmount();
  nested.unmount();
  assert.equal(registry.capture()?.key, t1, 'still the first menu\'s');
  menu.unmount();
  assert.equal(registry.state().invoker, null);
  // Reopened from an unnamed control: nothing, not the earlier menu's row.
  const unnamed = mount(registry, {key: undefined});
  unnamed.focus();
  const again = createHookHost(() => useFocusOverlay(true, registry));
  again.mount();
  assert.equal(registry.capture(), undefined);
  again.unmount();
  // From another named control: that one.
  const other = mount(registry, {key: 'action:primary'});
  other.focus();
  const third = createHookHost(() => useFocusOverlay(true, registry));
  third.mount();
  other.blur();
  assert.equal(registry.capture()?.key, 'action:primary');
  // A viewer change or the screen going while the menu is open forgets it.
  registry.setOwner('other');
  registry.setOwner('viewer');
  assert.equal(registry.capture(), undefined, 'after a viewer change');
  third.unmount();
  other.focus();
  const fourth = createHookHost(() => useFocusOverlay(true, registry));
  fourth.mount();
  registry.disposeScope('home');
  assert.equal(registry.capture(), undefined, 'after its screen went');
  fourth.unmount();
  for (const c of [unnamed, other]) c.host.unmount();
});

test('More → the list refreshes under the menu (its entry removed, its row reused) → Play → close: its neighbour takes focus', () => {
  const c = clock(), f = frames();
  const registry = createFocusReturn(c.timers);
  registry.setOwner('viewer');
  let ids = ['t0', 't1', 't2'];
  registry.addResolver('home', arrayResolver({group: 'tracks', items: () => ids, keyOf: id => id, scrollTo: () => {}}));
  const rows = ids.map((id, column) => nativeControl(registry, f, {key: cardFocusKey('tracks', id), place: {column}}));
  rows[1]!.focus();
  const menu = createHookHost(() => useFocusOverlay(true, registry));
  menu.mount();
  rows[1]!.blur();
  // t1 is removed; the row in its place now shows t9.
  ids = ['t0', 't9', 't2'];
  rows[1]!.set({key: cardFocusKey('tracks', 't9')});
  assert.equal(registry.capture()?.key, cardFocusKey('tracks', 't1'));
  menu.unmount();
  registry.restore();
  for (let i = 0; i < 6 && registry.state().returning; i++) { c.next(); f.run(); }
  assert.deepEqual(rows.map(r => r.view.asked), [0, 1, 0], 'the entry now at its place');
  assert.equal(registry.state().returning, undefined);
  for (const r of rows) r.host.unmount();
});
