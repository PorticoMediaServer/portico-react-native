export const NAVIGATION_ACTIVATION_RETRY_DELAYS = [0, 1_000, 3_000, 10_000] as const;

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Navigation activation cancelled.'));
    }, {once: true});
  });
}

/** Bounded, cancellation-aware contract activation for one viewer generation. */
export async function runBoundedNavigationActivation(
  activate: () => Promise<void>,
  options: {signal: AbortSignal; delays?: readonly number[]},
): Promise<void> {
  const delays = options.delays ?? NAVIGATION_ACTIVATION_RETRY_DELAYS;
  let lastFailure: unknown;
  for (const delay of delays) {
  if (options.signal.aborted) throw new Error('Navigation activation cancelled.');
    await waitForRetry(delay, options.signal);
    if (options.signal.aborted) throw new Error('Navigation activation cancelled.');
    try {
      await activate();
      if (options.signal.aborted) throw new Error('Navigation activation cancelled.');
      return;
    } catch (cause) {
      if (options.signal.aborted) throw new Error('Navigation activation cancelled.');
      lastFailure = cause;
    }
  }
  throw lastFailure ?? new Error('Navigation contract activation failed.');
}
