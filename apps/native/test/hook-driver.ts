/**
 * A dependency-free driver for exercising this app's React hooks under
 * `node:test`.
 *
 * The Apple app has no renderer installed: `react-test-renderer` is deprecated
 * in React 19, and adding it forces a peer-dependency override across the whole
 * app tree. React 19's public hook exports are thin wrappers that delegate to
 * `resolveDispatcher()`, so installing a dispatcher runs the real, unmodified
 * hook implementation without a reconciler.
 *
 * What this driver reproduces faithfully, because the hooks under test depend
 * on it: hook identity by call order, refs surviving renders, state updates
 * scheduling a re-render, external-store listeners firing in subscription order
 * before any re-render, and the effect contract — an effect's cleanup runs
 * before its replacement and again at unmount, after the render that scheduled
 * it has finished.
 *
 * What it deliberately does not reproduce: concurrent rendering, suspense,
 * transitions, priority or partial re-render. A result here is evidence about
 * the hook's own ownership and fencing logic, not about React's scheduler.
 */

import * as React from 'react';

const internals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {H: unknown};
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

if (!internals || !Object.hasOwn(internals, 'H')) {
  throw new Error('The hook driver does not support this React version. Update the driver before running hook tests.');
}

type Deps = readonly unknown[] | undefined;
type Destructor = (() => void) | void;

type StateCell = {kind: 'state'; value: unknown};
type RefCell = {kind: 'ref'; ref: {current: unknown}};
type MemoCell = {kind: 'memo'; deps: Deps; value: unknown};
type EffectCell = {kind: 'effect'; deps: Deps; destroy: Destructor};
type StoreCell = {kind: 'store'; unsubscribe: (() => void) | null; subscribe?: (onChange: () => void) => () => void};
type Cell = StateCell | RefCell | MemoCell | EffectCell | StoreCell;

const sameDeps = (a: Deps, b: Deps) =>
  !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/** Live hosts, so the exported `act` can flush whatever a test has mounted. */
const hosts = new Set<HookHost>();

class HookHost {
  private cells: Cell[] = [];
  private cursor = 0;
  private pending: {cell: EffectCell; create: () => Destructor}[] = [];
  private scheduled = false;
  private mounted = false;
  private rendering = false;

  private body: () => void;

  constructor(body: () => void) {
    this.body = body;
  }

  private dispatcher = {
    useState: <S,>(initial: S | (() => S)) => {
      const cell = this.cell<StateCell>(() => ({
        kind: 'state',
        value: typeof initial === 'function' ? (initial as () => S)() : initial,
      }));
      const set = (next: S | ((previous: S) => S)) => {
        const value =
          typeof next === 'function' ? (next as (p: S) => S)(cell.value as S) : next;
        if (Object.is(value, cell.value)) return;
        cell.value = value;
        this.schedule();
      };
      return [cell.value as S, set] as const;
    },
    useReducer: <S, A>(reducer: (state: S, action: A) => S, initial: S) => {
      const cell = this.cell<StateCell>(() => ({kind: 'state', value: initial}));
      const dispatch = (action: A) => {
        const value = reducer(cell.value as S, action);
        if (Object.is(value, cell.value)) return;
        cell.value = value;
        this.schedule();
      };
      return [cell.value as S, dispatch] as const;
    },
    useRef: <S,>(initial: S) =>
      this.cell<RefCell>(() => ({kind: 'ref', ref: {current: initial}})).ref as {current: S},
    useMemo: <S,>(create: () => S, deps: Deps) => {
      const cell = this.cell<MemoCell>(() => ({kind: 'memo', deps: undefined, value: undefined}));
      if (!cell.deps || !sameDeps(cell.deps, deps)) {
        cell.value = create();
        cell.deps = deps;
      }
      return cell.value as S;
    },
    useCallback: <S,>(fn: S, deps: Deps) => this.dispatcher.useMemo(() => fn, deps),
    useEffect: (create: () => Destructor, deps: Deps) => {
      const cell = this.cell<EffectCell>(() => ({kind: 'effect', deps: undefined, destroy: undefined}));
      if (!this.seen.has(cell) || !sameDeps(cell.deps, deps)) {
        cell.deps = deps;
        this.pending.push({cell, create});
      }
      return undefined;
    },
    useLayoutEffect: (create: () => Destructor, deps: Deps) =>
      this.dispatcher.useEffect(create, deps),
    useInsertionEffect: () => undefined,
    // No reconciler: unprovided contexts expose their default value.
    useContext: <T,>(context: {_currentValue: T}) => context._currentValue,
    useDebugValue: () => undefined,
    useId: () => 'driver-id',
    useSyncExternalStore: <S,>(
      subscribe: (onChange: () => void) => () => void,
      getSnapshot: () => S,
    ) => {
      const cell = this.cell<StoreCell>(() => ({kind: 'store', unsubscribe: null}));
      if (cell.subscribe !== subscribe) {
        cell.unsubscribe?.();
        cell.subscribe = subscribe;
        cell.unsubscribe = subscribe(() => this.schedule());
      }
      return getSnapshot();
    },
  };

  /** Effect cells that have already run at least once. */
  private seen = new WeakSet<EffectCell>();

  private cell<T extends Cell>(create: () => T): T {
    const existing = this.cells[this.cursor];
    if (existing) {
      this.cursor++;
      return existing as T;
    }
    const made = create();
    this.cells[this.cursor] = made;
    this.cursor++;
    return made;
  }

  private schedule() {
    this.scheduled = true;
  }

  private render() {
    const previous = internals.H;
    internals.H = this.dispatcher;
    this.cursor = 0;
    this.rendering = true;
    try {
      this.body();
    } finally {
      this.rendering = false;
      internals.H = previous;
    }
    this.scheduled = false;
  }

  /** Commit: run each scheduled effect's previous cleanup, then the effect. */
  private commit() {
    const queued = this.pending;
    this.pending = [];
    for (const {cell, create} of queued) {
      if (this.seen.has(cell) && typeof cell.destroy === 'function') cell.destroy();
      cell.destroy = create();
      this.seen.add(cell);
    }
  }

  mount() {
    if (this.mounted) throw new Error('hook-driver: already mounted');
    this.mounted = true;
    hosts.add(this);
    this.render();
    this.commit();
  }

  rerender() {
    if (!this.mounted) throw new Error('hook-driver: not mounted');
    this.render();
    this.commit();
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    hosts.delete(this);
    for (const cell of this.cells) {
      if (cell.kind === 'effect' && typeof cell.destroy === 'function') cell.destroy();
      if (cell.kind === 'store') cell.unsubscribe?.();
    }
    this.cells = [];
    this.pending = [];
  }

  /** One settle pass: render if something scheduled one, then run its effects. */
  flush() {
    if (!this.mounted) return false;
    if (this.rendering) throw new Error('hook-driver: flush during render');
    if (!this.scheduled && !this.pending.length) return false;
    if (this.scheduled) this.render();
    this.commit();
    return true;
  }
}

export function createHookHost(body: () => void) {
  return new HookHost(body);
}

/**
 * Runs `work`, then settles every mounted host: repeatedly drains the
 * microtask queue and re-renders until no host has pending work. Matching
 * React's `act`, nothing is asserted until the tree is quiet.
 */
export async function act(work: () => void | Promise<void>): Promise<void> {
  await work();
  for (let pass = 0; pass < 200; pass++) {
    await Promise.resolve();
    await new Promise<void>(done => setImmediate(done));
    let moved = false;
    for (const host of [...hosts]) if (host.flush()) moved = true;
    if (!moved) return;
  }
  throw new Error('hook-driver: act did not settle');
}
