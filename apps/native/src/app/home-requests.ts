/** Home summaries and row pages have a bounded lifetime; playback never uses this deadline. */
export const HOME_READ_TIMEOUT_MS = 15000;
export const HOME_QUICK_RETRIES = 3;

/** Preserve quick recovery, then reduce pressure during sustained outages. Jitter never shortens Retry-After. */
export function homeRetryDelay(attempt: number, error: unknown, random = Math.random): number {
  const quick = [1000, 3000, 8000];
  const base = attempt < quick.length ? quick[attempt] : Math.min(60000, 15000 * 2 ** Math.min(2, attempt - quick.length));
  const after = (error as {retryAfterSeconds?: unknown} | null)?.retryAfterSeconds;
  const floor = typeof after === 'number' && Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 2147480000) : 0;
  const minimum = Math.max(base, floor);
  return Math.min(2147483647, minimum + Math.max(1, Math.ceil(base * .2 * random())));
}

const cancelled = () => Object.assign(new Error('Home request cancelled.'), {name: 'AbortError'});

/** Cancels obsolete reads, including transports that fail to reject when their signal is aborted. */
export class HomeReads {
  private readonly requests = new Map<string, {cancel: () => void; promise?: Promise<unknown>}>();
  private readonly timeoutMs: number;
  constructor(timeoutMs = HOME_READ_TIMEOUT_MS) { this.timeoutMs = timeoutMs; }
  has(key: string) { return this.requests.has(key); }
  get size() { return this.requests.size; }
  settled(key: string): Promise<void> | undefined {
    return this.requests.get(key)?.promise?.then(() => {}, () => {});
  }
  async read<T>(key: string, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.requests.get(key)?.cancel();
    const controller = new AbortController();
    let reject!: (error: unknown) => void;
    const interrupted = new Promise<never>((_resolve, fail) => { reject = fail; });
    const held: {cancel: () => void; promise?: Promise<T>} = {cancel: () => { controller.abort(); reject(cancelled()); }};
    this.requests.set(key, held);
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Home request timed out.'), {code: 'timeout'}));
      controller.abort();
    }, this.timeoutMs);
    try {
      held.promise = Promise.race([request(controller.signal), interrupted]);
      return await held.promise;
    } finally {
      clearTimeout(timer);
      if (this.requests.get(key) === held) this.requests.delete(key);
    }
  }
  cancel() {
    for (const held of this.requests.values()) held.cancel();
    this.requests.clear();
  }
}

/** Pause scheduled retries without discarding the server's not-before time. */
export class HomeRetry {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private next: {at: number; task: () => void} | undefined;
  private active: boolean;
  constructor(active: boolean) { this.active = active; }
  get pending() { return this.next !== undefined; }
  schedule(delay: number, task: () => void) {
    this.cancel();
    this.next = {at: Date.now() + delay, task};
    this.arm();
  }
  setActive(active: boolean) {
    this.active = active;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (active) this.arm();
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.next = undefined;
  }
  private arm() {
    if (!this.active || !this.next) return;
    this.timer = setTimeout(() => {
      const next = this.next;
      this.next = undefined;
      this.timer = undefined;
      next?.task();
    }, Math.max(0, this.next.at - Date.now()));
  }
}
