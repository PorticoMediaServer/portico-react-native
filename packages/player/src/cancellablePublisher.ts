export function createCancellablePublisher<T>(listener: (value: T) => void): {
  cancel(): void;
  publish(value: T): void;
} {
  let cancelled = false;
  return {
    cancel: () => { cancelled = true; },
    publish: value => { if (!cancelled) listener(value); },
  };
}
