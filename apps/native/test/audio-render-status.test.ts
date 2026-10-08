/** X-02: the player engine publishes whether the server can render audio effects. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHookHost, act} from './hook-driver.ts';
import {publishAudioRenderAvailability, useAudioRenderAvailability} from '../src/app/audio-render-status.ts';

function mounted() {
  let seen: unknown = 'unset';
  const host = createHookHost(() => {
    seen = useAudioRenderAvailability();
  });
  host.mount();
  return {host, seen: () => seen};
}

test('nothing playing reads undefined until the engine publishes', async () => {
  publishAudioRenderAvailability(undefined);
  const a = mounted();
  assert.equal(a.seen(), undefined);
  await act(async () => {
    publishAudioRenderAvailability({available: false, reason: 'owner-disabled'});
  });
  assert.deepEqual(a.seen(), {available: false, reason: 'owner-disabled'});
  a.host.unmount();
  publishAudioRenderAvailability(undefined);
});

test('an identical republish notifies no one; a changed reason does', async () => {
  publishAudioRenderAvailability(undefined);
  const a = mounted();
  let renders = 0;
  const b = createHookHost(() => {
    renders++;
    useAudioRenderAvailability();
  });
  b.mount();
  const before = renders;
  await act(async () => {
    publishAudioRenderAvailability(undefined);
    publishAudioRenderAvailability(undefined);
  });
  assert.equal(renders, before, 'identical values are deduplicated');
  await act(async () => {
    publishAudioRenderAvailability({available: false, reason: 'multi-stream'});
  });
  assert.ok(renders > before, 'a changed reason re-renders subscribers');
  assert.deepEqual(a.seen(), {available: false, reason: 'multi-stream'});
  await act(async () => {
    publishAudioRenderAvailability({available: true});
  });
  assert.deepEqual(a.seen(), {available: true});
  a.host.unmount();
  b.unmount();
  publishAudioRenderAvailability(undefined);
});
