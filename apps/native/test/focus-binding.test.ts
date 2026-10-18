/**
 * TV-PLAYER-03: a control's side of focus coming back, as `Focusable` runs it (`focus-binding.ts`),
 * through the hook driver: registration while mounted, every control reporting focus, names that
 * change under focus, sheets and menus, and unmounting without a blur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost} from './hook-driver.ts';
import {cardFocusKey, createFocusReturn} from '../src/ui/focus-return.ts';
import {useFocusOverlay, useFocusReturnBinding} from '../src/ui/focus-binding.ts';

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
