import {createContext, useContext, useEffect, useState} from 'react';
import {ArtworkScheduler, artworkWidthBucket, type ArtworkScreenStats} from '../../../../packages/client-core/src/artwork/index';

/**
 * PERF-03 / APL-SYS-11: one queue for every card image on Apple, driven by client-core's
 * `ArtworkScheduler`.
 *
 * React Native's image pipeline does the network, decode and caching (it needs the
 * Authorization header, which a prefetch can't carry), so the scheduler decides *when* an image
 * may start and the `<Image>` itself is the load:
 *
 * - `load(key)` is called by the scheduler when the image's turn comes (visual order: row × 1000
 *   + column, a started row finishes before the next, the hero first). The `<Artwork>` waiting
 *   for that key then mounts its `<Image>`.
 * - `onLoad`/`onError` of that `<Image>` settle the attempt. Failures retry with the scheduler's
 *   backoff, and slow attempts time out without holding a slot.
 * - A card leaving the screen aborts its interest, so off-screen rows never compete with
 *   visible ones.
 *
 * Only a handful of images decode at once. React Native allows 4 network loads and 2 decodes
 * at a time, first come first served, so the scheduler's order is what the viewer sees.
 */
type Attempt = {n: number; settle: (ok: boolean, error?: unknown) => void};
const attempts = new Map<string, Attempt>();
const listeners = new Map<string, Set<() => void>>();
/** Attempts made per image; the first goes to the plain URL, retries add a cache-buster. */
const tries = new Map<string, number>();
/** Images that have decoded this session: shown at once on remount, never faded again. */
export const shown = new Set<string>();

function notify(key: string) {
  const set = listeners.get(key);
  if (set) for (const l of [...set]) l();
}

const scheduler = new ArtworkScheduler<true>({
  load: (key, signal) =>
    new Promise<true>((resolve, reject) => {
      const n = tries.get(key) ?? 0;
      tries.set(key, n + 1);
      if (tries.size > 2000) tries.delete(tries.keys().next().value!);
      const attempt: Attempt = {
        n,
        settle: (ok, error) => {
          if (ok) shown.add(key);
          if (attempts.get(key) === attempt) attempts.delete(key);
          notify(key);
          if (ok) resolve(true);
          else reject(error ?? new Error('Image failed to load.'));
        },
      };
      attempts.set(key, attempt);
      notify(key);
      signal.addEventListener('abort', () => {
        const e = new Error('Aborted');
        e.name = 'AbortError';
        attempt.settle(false, e);
      }, {once: true});
    }),
  // React Native reports no status for a failed image; a busy home server recovers, so retry.
  classify: error => ({retryable: !(error && typeof error === 'object' && (error as {name?: unknown}).name === 'AbortError')}),
  concurrency: 6,
  priorityExtra: 2,
  maxEntries: 800,
  timeoutMs: 12000,
  onScreenSettled: stats => {
    if (__DEV__) console.log(`[artwork] ${describe(stats)}`);
  },
});

function describe(s: ArtworkScreenStats): string {
  return `${s.label}: first image ${s.firstImageMs ?? '—'} ms, all visible ${s.allVisibleMs ?? '—'} ms, ${s.requested} requested, ${s.cached} cached, ${s.failed} failed`;
}

/** Call on navigation, before the new screen's cards ask for artwork. */
export function beginArtworkScreen(label: string) {
  scheduler.beginScreen(label);
  timing = {label, startedAt: Date.now(), loads: 0};
}

/**
 * Dev A/B switch for the before/after timings: `globalThis.__porticoArtworkDirect = true` (from
 * the debugger) loads every image at once at full size, the way it worked before the scheduler.
 */
const direct = () => __DEV__ && (globalThis as {__porticoArtworkDirect?: boolean}).__porticoArtworkDirect === true;

/** Screen timing that works in both modes: first image and last image of a burst, logged in dev. */
let timing: {label: string; startedAt: number; loads: number; first?: number; last?: number; timer?: ReturnType<typeof setTimeout>} = {label: 'launch', startedAt: Date.now(), loads: 0};
function recordLoad() {
  const now = Date.now() - timing.startedAt;
  timing.loads++;
  timing.first ??= now;
  timing.last = now;
  clearTimeout(timing.timer);
  const t = timing;
  if (__DEV__) t.timer = setTimeout(() => console.log(`[artwork${direct() ? ' direct' : ''}] ${t.label}: first ${t.first} ms, last ${t.last} ms, ${t.loads} images`), 3000);
}

export function artworkStats() {
  return scheduler.stats();
}

/** Where a card sits on screen, for visual-order loading. Provided per row by the screens. */
export type ArtworkPlacement = {row: number; group?: string; column?: number; priority?: boolean};
export const ArtworkPlacementContext = createContext<ArtworkPlacement | null>(null);

/** Size-aware URL: exactly one server variant per rendered size (`w=400|800|1920`). */
export function sizedUri(uri: string, pointWidth: number, aspect: number, scale: number): string {
  if (direct() || /[?&](w|size)=/.test(uri)) return uri;
  const bucket = artworkWidthBucket(pointWidth * scale, {aspect});
  // Today's server knows only `size=thumbnail` (≤ 400 px long edge) and ignores `w`. Until lane B
  // ships the 800 variant, anything card-sized takes the thumbnail rather than the 1920 display
  // image (slightly soft on a 3× phone, a twentieth of the bytes). Drop `size` once `w` is served.
  return `${uri}${uri.includes('?') ? '&' : '?'}w=${bucket}${bucket <= 800 ? '&size=thumbnail' : ''}`;
}

/**
 * The state of one image: whether it has loaded before (show at once), whether its turn has come
 * (mount the `<Image>`), which attempt it is on, and how to report the result.
 */
export function useArtworkSlot(key: string, placement: ArtworkPlacement | null, priority: boolean) {
  const [, force] = useState(0);
  const cached = !!key && (shown.has(key) || scheduler.peek(key) === true);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!key) return;
    const set = listeners.get(key) ?? new Set();
    const listener = () => force(v => v + 1);
    set.add(listener);
    listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(key);
    };
  }, [key]);
  const order = placement ? placement.row * 1000 + (placement.column ?? 0) : undefined;
  useEffect(() => {
    if (!key || shown.has(key) || scheduler.peek(key) === true) return;
    setGaveUp(false);
    const controller = new AbortController();
    scheduler
      .load(key, {signal: controller.signal, priority: priority || placement?.priority ? 'high' : 'normal', order, group: placement?.group})
      .then(() => force(v => v + 1), error => {
        if (!controller.signal.aborted && !(error && (error as {name?: string}).name === 'AbortError')) setGaveUp(true);
      });
    return () => controller.abort();
    // Order changes are applied with reorder below; the request itself is keyed by the image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (key && order !== undefined) scheduler.reorder(key, order, placement?.group);
  }, [key, order, placement?.group]);
  const attempt = key ? attempts.get(key) : undefined;
  const bypass = direct();
  return {
    cached,
    /** Mount the image now: it loaded before, or its turn has come. */
    active: cached || !!attempt || bypass,
    attempt: attempt?.n ?? 0,
    gaveUp,
    loaded: () => { recordLoad(); if (bypass) shown.add(key); attempts.get(key)?.settle(true); },
    failed: (error?: unknown) => attempts.get(key)?.settle(false, error),
  };
}

export function useArtworkPlacement() {
  return useContext(ArtworkPlacementContext);
}
