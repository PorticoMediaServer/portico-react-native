import {PlayerGenerationFence} from './playerGenerationFence';

test('generation fence invalidates stale async playback work deterministically', () => {
  const fence = new PlayerGenerationFence();
  const first = fence.capture();
  expect(fence.accepts(first)).toBe(true);
  expect(fence.advance()).toBe(1);
  expect(fence.accepts(first)).toBe(false);
  expect(fence.accepts(fence.capture())).toBe(true);
});
