import test from 'node:test';
import assert from 'node:assert/strict';
import {useSyncExternalStore} from 'react';
import {act, createHookHost} from './hook-driver.ts';

function store(value: number) {
  const listeners = new Set<() => void>();
  return {listeners, getSnapshot: () => value, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  }, change(next: number) { value = next; for (const listener of listeners) listener(); }};
}

test('replacing an external store replaces its subscription and reacts only to the current one', async () => {
  const first = store(1), second = store(2);
  let selected = first, shown = 0, renders = 0;
  const host = createHookHost(() => { renders++; shown = useSyncExternalStore(selected.subscribe, selected.getSnapshot); });
  host.mount();
  try {
    assert.equal(first.listeners.size, 1);
    selected = second;
    host.rerender();
    assert.equal(first.listeners.size, 0);
    assert.equal(second.listeners.size, 1);
    const before = renders;
    await act(() => first.change(9));
    assert.equal(renders, before);
    await act(() => second.change(3));
    assert.equal(shown, 3);
  } finally { host.unmount(); }
  assert.equal(second.listeners.size, 0);
});
