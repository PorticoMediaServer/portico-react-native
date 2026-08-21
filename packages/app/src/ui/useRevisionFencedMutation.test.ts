import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useRevisionFencedMutation} from './useRevisionFencedMutation';

test('prevents a second mutation from composing against unresolved state', async () => {
  let resolve!: () => void;
  const commit = jest.fn(() => new Promise<void>(done => { resolve = done; }));
  let mutation!: ReturnType<typeof useRevisionFencedMutation<string>>;
  function Probe() { mutation = useRevisionFencedMutation(commit); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Probe)); });

  let first!: Promise<boolean>;
  await act(async () => { first = mutation.mutate('first'); });
  await expect(mutation.mutate('stale-second')).resolves.toBe(false);
  expect(commit).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(); await first; });
  expect(mutation.pending).toBe(false);
  act(() => renderer.unmount());
});
