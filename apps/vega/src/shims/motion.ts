import {useEffect, useReducer, useRef} from 'react';

/**
 * Whether the app moves: focus scaling, the rail opening, sheets and toasts sliding, the loading
 * ring turning. It does unless `portico.animations` is false in `app.json`, which makes every
 * transition arrive at once (a switch for hardware that cannot keep up; nothing else changes).
 *
 * The values behind the transitions the shared screens write with the Reanimated API live here
 * (`reanimated.tsx` serves that API); the library itself is not in this app. With Amazon's build
 * of it (4.1.3 for Vega OS 1.2), styles it drove were applied late or to the wrong control: the
 * focus ring stayed on the card focus had left while the scale moved on. Its values are stepped
 * here on the JavaScript thread instead, a frame at a time, and only the component that shows a
 * value renders again. React Native's own `Animated` is the SDK's, untouched.
 */
const settings = require('../../app.json') as {portico?: {animations?: boolean}};
export const animations = settings.portico?.animations !== false;

type Listener = () => void;
type Stop = () => void;

/** A way of getting somewhere: what `withTiming` and its relatives return in place of a value. */
export type Motion = {
  readonly motion: true;
  /** Starts moving `cell`; calls `done` once, when it arrives or is stopped. Returns how to stop it. */
  run(cell: Cell<number>, done: (finished: boolean) => void): Stop;
};

export const isMotion = (value: unknown): value is Motion => typeof value === 'object' && value !== null && (value as Motion).motion === true;

let reading: Set<Cell<any>> | null = null;

/** A value that can be read, set, or sent somewhere over time, and tells whoever read it. */
export class Cell<T> {
  private current: T;
  private stop: Stop | undefined;
  private readonly listeners = new Set<Listener>();
  /** Counts changes, so a reader that subscribed late can tell it missed one. */
  version = 0;

  constructor(initial: T) { this.current = initial; }

  get value(): T {
    reading?.add(this);
    return this.current;
  }

  set value(next: T) {
    const stop = this.stop;
    this.stop = undefined;
    stop?.();
    if (!isMotion(next)) { this.put(next); return; }
    // A motion may arrive before `run` returns (nothing to cover, or animations off).
    let over = false;
    let halt: Stop | undefined;
    halt = next.run(this as unknown as Cell<number>, () => { over = true; if (halt && this.stop === halt) this.stop = undefined; });
    if (!over) this.stop = halt;
  }

  /** The value as it is, without being counted as a reader. */
  peek(): T { return this.current; }

  /** Stops whatever is moving the value, leaving it where it stands. */
  halt(): void {
    const stop = this.stop;
    this.stop = undefined;
    stop?.();
  }

  /** Sets the value without disturbing whatever is moving it. */
  put(next: T): void {
    if (Object.is(next, this.current)) return;
    this.current = next;
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }

  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/**
 * Runs `compute` during render, and renders the calling component again whenever a cell it read
 * has changed.
 */
export function useComputed<R>(compute: () => R): R {
  const [, again] = useReducer((count: number) => count + 1, 0);
  const seen = new Set<Cell<any>>();
  const outer = reading;
  reading = seen;
  let result: R;
  try { result = compute(); } finally { reading = outer; }
  const versions = new Map<Cell<any>, number>();
  for (const cell of seen) versions.set(cell, cell.version);
  const watched = useRef(new Map<Cell<any>, () => void>());
  useEffect(() => {
    const map = watched.current;
    for (const [cell, off] of map) if (!seen.has(cell)) { off(); map.delete(cell); }
    let missed = false;
    for (const cell of seen) {
      if (!map.has(cell)) map.set(cell, cell.listen(again));
      // Changed between this render and now (an effect that ran first): render with it.
      if (cell.version !== versions.get(cell)) missed = true;
    }
    if (missed) again();
  });
  useEffect(() => {
    const map = watched.current;
    return () => { for (const off of map.values()) off(); map.clear(); };
  }, []);
  return result;
}

// One frame callback steps everything that is moving, so every change of a frame is one render.
const moving = new Set<(now: number) => void>();
let frame: ReturnType<typeof requestAnimationFrame> | undefined;

function tick(now: number): void {
  frame = undefined;
  for (const step of [...moving]) step(now);
  if (moving.size && frame === undefined) frame = requestAnimationFrame(tick);
}

function onFrames(step: (now: number) => void): Stop {
  moving.add(step);
  if (frame === undefined) frame = requestAnimationFrame(tick);
  return () => { moving.delete(step); };
}

export type Curve = (progress: number) => number;

/** From where the cell is to `to`, over `duration` milliseconds along `curve`. */
export function timed(to: number, duration: number, curve: Curve, callback?: (finished: boolean) => void): Motion {
  return {
    motion: true,
    run(cell, done) {
      const from = cell.peek();
      let ended = false;
      const end = (finished: boolean) => {
        if (ended) return;
        ended = true;
        callback?.(finished);
        done(finished);
      };
      if (!animations || !(duration > 0) || typeof from !== 'number' || from === to) {
        cell.put(to);
        end(true);
        return () => {};
      }
      let started: number | undefined;
      const halt = onFrames(now => {
        started ??= now;
        const progress = Math.min(1, (now - started) / duration);
        cell.put(progress >= 1 ? to : from + (to - from) * curve(progress));
        if (progress >= 1) { halt(); end(true); }
      });
      return () => { halt(); end(false); };
    },
  };
}

/** One after another; a plain number among them is set at once. Stopping one stops the rest. */
export function inTurn(steps: readonly (Motion | number)[]): Motion {
  return {
    motion: true,
    run(cell, done) {
      let index = 0, ended = false;
      let halt: Stop = () => {};
      const end = (finished: boolean) => { if (!ended) { ended = true; done(finished); } };
      const next = () => {
        while (!ended && index < steps.length) {
          const step = steps[index++];
          if (typeof step === 'number') { cell.put(step); continue; }
          let over = false, continues = false;
          halt = step.run(cell, finished => {
            over = true;
            if (!finished) end(false);
            else if (continues) next();
          });
          if (!over) { continues = true; return; }
        }
        end(true);
      };
      next();
      return () => { if (!ended) { halt(); end(false); } };
    },
  };
}
