/** Read-only Android window posture. Size classes continue to use live window width. */
export type PlatformPostureBounds = Readonly<{left: number; top: number; right: number; bottom: number}>;
export type PlatformFold = Readonly<{
  bounds: PlatformPostureBounds;
  state: 'flat' | 'half-opened';
  orientation: 'horizontal' | 'vertical';
  isSeparating: boolean;
  occlusion: 'none' | 'full';
}>;
export type PlatformPostureSnapshot = Readonly<{
  status: 'unavailable' | 'pending' | 'available';
  /** Logical window DP including insets; folds use the same window-local (0,0) origin. */
  window: Readonly<{width: number; height: number}> | null;
  folds: readonly PlatformFold[];
}>;
export type PlatformPostureTransport = Readonly<{
  getSnapshot(): Promise<unknown>;
  subscribe(listener: (value: unknown) => void): () => void;
}>;

const noFolds: readonly PlatformFold[] = Object.freeze([]);
const unavailable: PlatformPostureSnapshot = Object.freeze({status: 'unavailable', window: null, folds: noFolds});
const pending: PlatformPostureSnapshot = Object.freeze({status: 'pending', window: null, folds: noFolds});
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function decode(value: unknown): {revision: number; snapshot: PlatformPostureSnapshot} | null {
  const raw = record(value);
  if (!raw || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || !Array.isArray(raw.folds)) return null;
  if (raw.status !== 'unavailable' && raw.status !== 'pending' && raw.status !== 'available') return null;
  const window = record(raw.window);
  if (raw.window !== null && (!window || !finite(window.width) || window.width <= 0 || !finite(window.height) || window.height <= 0)) return null;
  if (raw.status === 'available' && !window) return null;
  if (raw.status === 'unavailable' && window) return null;
  if (raw.status !== 'available' && raw.folds.length) return null;
  const folds: PlatformFold[] = [];
  for (const valueFold of raw.folds) {
    const fold = record(valueFold), bounds = record(fold?.bounds);
    if (!fold || !bounds || !finite(bounds.left) || !finite(bounds.top) || !finite(bounds.right) || !finite(bounds.bottom) ||
        bounds.right < bounds.left || bounds.bottom < bounds.top ||
        (fold.state !== 'flat' && fold.state !== 'half-opened') ||
        (fold.orientation !== 'horizontal' && fold.orientation !== 'vertical') ||
        typeof fold.isSeparating !== 'boolean' || (fold.occlusion !== 'none' && fold.occlusion !== 'full')) return null;
    folds.push(Object.freeze({
      bounds: Object.freeze({left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom}),
      state: fold.state, orientation: fold.orientation, isSeparating: fold.isSeparating, occlusion: fold.occlusion,
    }));
  }
  return {revision: raw.revision as number, snapshot: Object.freeze({
    status: raw.status,
    window: window ? Object.freeze({width: window.width as number, height: window.height as number}) : null,
    folds: folds.length ? Object.freeze(folds) : noFolds,
  })};
}

export function createPlatformPostureStore(transport: PlatformPostureTransport | null) {
  let snapshot = transport ? pending : unavailable;
  let revision = -1;
  let generation = 0;
  let remove: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PlatformPostureSnapshot) => {
    // Native revision is transport ordering only; equal content retains useSyncExternalStore identity.
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const start = () => {
    if (!transport) return;
    const current = ++generation;
    revision = -1;
    publish(pending);
    const receive = (value: unknown) => {
      if (current !== generation) return;
      const next = decode(value);
      if (!next || next.revision <= revision) return;
      revision = next.revision;
      publish(next.snapshot);
    };
    try {
      // Observe first: an asynchronous initial read cannot race a newer posture event backwards.
      remove = transport.subscribe(receive);
      transport.getSnapshot().then(receive, () => {
        if (current === generation && revision < 0) publish(unavailable);
      });
    } catch {
      remove?.();
      remove = undefined;
      if (current === generation) publish(unavailable);
    }
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      // Each subscription has its own identity, even if two consumers pass the same callback.
      const entry = () => listener();
      listeners.add(entry);
      if (listeners.size === 1) start();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(entry);
        if (!listeners.size) {
          generation++;
          remove?.();
          remove = undefined;
        }
      };
    },
  });
}
