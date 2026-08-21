import {runBoundedNavigationActivation} from './navigationContractActivation';

describe('navigation contract activation', () => {
  it('retries transient failures within the bounded attempt budget', async () => {
    const activate = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('gateway'))
      .mockResolvedValue(undefined);
    await runBoundedNavigationActivation(activate, {
      signal: new AbortController().signal,
      delays: [0, 0, 0],
    });
    expect(activate).toHaveBeenCalledTimes(3);
  });

  it('generation-fences a late activation result', async () => {
    const controller = new AbortController();
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const result = runBoundedNavigationActivation(() => pending, {signal: controller.signal, delays: [0]});
    controller.abort();
    resolve();
    await expect(result).rejects.toThrow('cancelled');
  });
});
