/**
 * The shell's failure mode for a server it can't use (MU1, web parity).
 *
 * When the server can't be reached for more than a moment, the page fails once: one centered
 * "Reconnecting" status replaces the page's content while the shell stays usable, and the page
 * comes back by itself, reloading its data, when the route is ready again. Never a card-by-card
 * wall of errors, and never a banner.
 *
 * Pure TypeScript: no React Native imports, so Node tests can exercise it directly. The shell
 * feeds the store from `session.saved` and the route's own subscription (`api.subscribeRoute`);
 * no polling is added. `ScreenBoundary`'s `guarded()` reads the snapshot and swaps the screen
 * content for `ReconnectingStatus` while `shown` is true.
 */
export type ConnectionStatus = Readonly<{
  /** The centered status is showing (the problem has lasted the settle delay). */
  shown: boolean;
  /** Why: 'checking' = the remembered server is still being confirmed at launch; 'unreachable' = the remembered server couldn't be reached at launch; 'replaced' = something else answers at its address; 'outsideHours' = the server does not let this account in at this time of day; 'lost' = a working route dropped. */
  reason: 'checking' | 'unreachable' | 'replaced' | 'outsideHours' | 'lost' | null;
  /** Increments each time `shown` goes false → true. Screens compare it to know they must reload. */
  generation: number;
}>;

/** How long a problem must last before the status shows, so a blip never flashes. */
export const SETTLE_MS = 2500;

type Reason = Exclude<ConnectionStatus['reason'], null>;

export type ConnectionStatusInput = {
  saved?: 'checking' | 'offline' | 'replaced' | 'outsideHours';
  routePhase?: string;
};

function reasonFor(input: ConnectionStatusInput): Reason | null {
  // The remembered server at launch wins over the route: it is what the viewer is waiting on.
  if (input.saved === 'checking') return 'checking';
  if (input.saved === 'offline') return 'unreachable';
  // Something else answers at the saved address. The sign-in is kept and retried; only the person can decide their server really was set up again.
  if (input.saved === 'replaced') return 'replaced';
  if (input.saved === 'outsideHours') return 'outsideHours';
  // A live route that proves a different identity reads as can't reach (as on web): it may be a
  // network pointing somewhere else for a while. A sign-in that has really ended goes back to
  // sign-in instead (`app/session.tsx`, untouched here).
  if (input.routePhase === 'offline' || input.routePhase === 'identity_mismatch' || input.routePhase === 'probing') return 'lost';
  return null;
}

export class ConnectionStatusStore {
  private readonly settleMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private snapshot: ConnectionStatus = {shown: false, reason: null, generation: 0};
  /** The problem that currently exists, if any (set even before the settle timer fires). */
  private problem: Reason | null = null;
  private timer: unknown = undefined;
  private readonly listeners = new Set<() => void>();

  constructor(o?: {settleMs?: number; setTimer?: (callback: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void}) {
    this.settleMs = o?.settleMs ?? SETTLE_MS;
    // The injected fakes in tests return their own ids; the real pair is only the default.
    this.setTimer = o?.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = o?.clearTimer ?? (id => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** Called by the shell with the current inputs whenever they change. */
  update(input: ConnectionStatusInput): void {
    const next = reasonFor(input);
    if (next === null) {
      this.problem = null;
      if (this.timer !== undefined) {
        this.clearTimer(this.timer);
        this.timer = undefined;
      }
      // A blip that ends before the timer fires never shows: the snapshot never changed, so
      // nobody is notified.
      if (!this.snapshot.shown) return;
      this.snapshot = {shown: false, reason: null, generation: this.snapshot.generation};
      this.emit();
      return;
    }
    if (this.problem === null) {
      // A problem starts: arm one timer. It shows only if the problem still exists when it fires.
      this.problem = next;
      if (this.timer !== undefined) {
        this.clearTimer(this.timer);
        this.timer = undefined;
      }
      this.timer = this.setTimer(() => {
        this.timer = undefined;
        if (this.problem === null || this.snapshot.shown) return;
        this.snapshot = {shown: true, reason: this.problem, generation: this.snapshot.generation + 1};
        this.emit();
      }, this.settleMs);
      return;
    }
    // The problem persists. A changed reason doesn't re-arm the timer and doesn't bump the
    // generation; it updates the reason if already shown.
    this.problem = next;
    if (this.snapshot.shown && this.snapshot.reason !== next) {
      this.snapshot = {...this.snapshot, reason: next};
      this.emit();
    }
  }

  /** Stable object identity between changes (useSyncExternalStore). */
  getSnapshot = (): ConnectionStatus => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Clears the settle timer. */
  dispose(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Screens that keep rendering normally whatever the connection does: they work without the
 * server or are how the viewer switches away from it.
 */
export const CONNECTION_EXEMPT_SCREENS: ReadonlySet<string> = new Set([
  'Settings',
  'SettingsPage',
  'Servers',
  'Account',
  'About',
  'Downloads',
  'Gallery',
]);

export type ConnectionView = 'status' | 'screen' | 'remount' | 'screen-stale';

/**
 * The pure render decision for `guarded()` in `shell/ScreenBoundary.tsx`: which body a screen
 * shows for the current connection status. `status` is only for the focused screen. `remount` means the status cleared while this screen
 * was focused, so it remounts its content (reloading its data); `screen-stale` means it cleared
 * while covered, so it keeps its old content until it is focused again (recovery cost stays
 * O(visible), never O(library)).
 */
export function connectionView(o: {
  name: string;
  status: ConnectionStatus;
  mountedGeneration: number;
  focused: boolean;
}): ConnectionView {
  if (CONNECTION_EXEMPT_SCREENS.has(o.name)) return 'screen';
  // Only the screen on show swaps to the status; covered and kept-alive screens keep their
  // content (nobody sees it) and remount when they're next focused, so recovery reloads only
  // what is visible.
  if (o.status.shown) return o.focused ? 'status' : 'screen-stale';
  if (o.status.generation !== o.mountedGeneration) return o.focused ? 'remount' : 'screen-stale';
  return 'screen';
}
