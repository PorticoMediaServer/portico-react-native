/**
 * TV-PLAYER-03 / NAV-10.8: when the player closes, focus goes back to the control that started it.
 *
 * The control is named, not held: a card is `card(group, entry id)` within its screen, a button
 * by what it does (`action:play`). Every focusable that has a name tells this registry when it is
 * mounted and when it takes or loses focus, so the player can capture the origin at the moment it
 * is asked to start, wherever that was asked from, and give focus back to the same control when it
 * closes, even if the list has redrawn or moved it meanwhile:
 *
 * - The origin belongs to the viewer (server, account, profile) and the screen it was captured on.
 *   It is used once, then forgotten; a viewer change forgets it at once.
 * - A control a list no longer mounts is first brought back into its list (`reveal`), then asked
 *   for focus. Focus counts as returned only once the control reports that it has it; until then
 *   it is asked again, a bounded number of times.
 * - A title that has gone (finished and left Continue Watching) hands over to its neighbour in the
 *   row, and a row that has gone to the row now in its place (`fallback`).
 *
 * Nothing here is React: the screens' controls and lists plug in through `Focusable` and the rows.
 */

export type FocusTarget = {focus(): void};
/** Where the control sat when it registered: its row on the screen and its place in the row. */
export type FocusPlace = Readonly<{row?: number; column?: number}>;
export type FocusOrigin = Readonly<{owner: string; scope: string; key: string; place: FocusPlace}>;

/** A list that can bring one of its controls back into composition. */
export type FocusResolver = {
  /** True when `key` is this list's, and it has scrolled it into the list's window. */
  reveal(key: string, place: FocusPlace): boolean;
  /** When `key` was this list's and is gone: the control to go to instead (its neighbour), else undefined. */
  fallback(key: string, place: FocusPlace): string | undefined;
};

export type FocusReturnTimers = {
  schedule(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
};

export type FocusReturnOptions = Readonly<{
  /** Asks made before giving up. */
  attempts?: number;
  /** Between asks, ms. */
  interval?: number;
  /** Before the first ask: the screen comes back from under the player first. */
  delay?: number;
}>;

/** The key of a card: its row (or section) and its entry. */
export function cardFocusKey(group: string, entryId: string): string {
  return `card\u001f${group}\u001f${entryId}`;
}

/** The row and entry of a card's key, or undefined for any other control. */
export function parseCardFocusKey(key: string): {group: string; entryId: string} | undefined {
  const parts = key.split('\u001f');
  return parts.length === 3 && parts[0] === 'card' ? {group: parts[1]!, entryId: parts[2]!} : undefined;
}

type Registered = {target: FocusTarget; place: FocusPlace};
type Pending = {origin: FocusOrigin; key: string; place: FocusPlace; attempt: number; fallbacks: number; timer: unknown};

export type FocusReturn = ReturnType<typeof createFocusReturn>;

export function createFocusReturn(timers: FocusReturnTimers, options: FocusReturnOptions = {}) {
  const attempts = options.attempts ?? 12;
  const interval = options.interval ?? 120;
  const delay = options.delay ?? 60;
  let owner = '';
  const scopes = new Map<string, Map<string, Registered>>();
  const resolvers = new Map<string, Set<FocusResolver>>();
  /** The named control that last took focus, and whether it still has it. */
  let current: {scope: string; key: string} | undefined;
  let holding = false;
  /** Sheets and menus open over the screens: focus is in one, and the control under it opened it. */
  let overlays = 0;
  let origin: FocusOrigin | undefined;
  let pending: Pending | undefined;

  const stop = () => {
    if (pending) timers.cancel(pending.timer);
    pending = undefined;
  };

  const step = () => {
    const p = pending;
    if (!p) return;
    if (p.origin.owner !== owner) { stop(); return; }
    p.attempt++;
    const found = scopes.get(p.origin.scope)?.get(p.key);
    if (found) found.target.focus();
    else {
      let revealed = false;
      for (const resolver of resolvers.get(p.origin.scope) ?? []) if (resolver.reveal(p.key, p.place)) revealed = true;
      if (!revealed && p.fallbacks < 2) {
        for (const resolver of resolvers.get(p.origin.scope) ?? []) {
          const next = resolver.fallback(p.key, p.place);
          if (next && next !== p.key) { p.key = next; p.fallbacks++; break; }
        }
      }
    }
    if (p.attempt >= attempts) { stop(); return; }
    p.timer = timers.schedule(step, interval);
  };

  return {
    /** The viewer the screens belong to. A change forgets the origin and any return under way. */
    setOwner(next: string) {
      if (next === owner) return;
      owner = next;
      origin = undefined;
      current = undefined;
      holding = false;
      stop();
    },
    register(scope: string, key: string, target: FocusTarget, place: FocusPlace = {}): () => void {
      let map = scopes.get(scope);
      if (!map) { map = new Map(); scopes.set(scope, map); }
      const entry: Registered = {target, place};
      map.set(key, entry);
      return () => {
        const now = scopes.get(scope);
        if (now?.get(key) !== entry) return;
        now.delete(key);
        if (!now.size) scopes.delete(scope);
      };
    },
    addResolver(scope: string, resolver: FocusResolver): () => void {
      let set = resolvers.get(scope);
      if (!set) { set = new Set(); resolvers.set(scope, set); }
      set.add(resolver);
      return () => {
        const now = resolvers.get(scope);
        now?.delete(resolver);
        if (now && !now.size) resolvers.delete(scope);
      };
    },
    /** A named control took focus. Ends a return once it is the control being returned to. */
    focused(scope: string, key: string) {
      current = {scope, key};
      holding = true;
      if (pending && pending.origin.scope === scope && pending.key === key) stop();
    },
    blurred(scope: string, key: string) {
      if (current && current.scope === scope && current.key === key) holding = false;
    },
    /** A sheet or menu opened (`true`) or closed. */
    overlay(open: boolean) {
      overlays = Math.max(0, overlays + (open ? 1 : -1));
    },
    /**
     * Playback is starting: remember the control it was started from. That is the named control
     * with focus, or the one under the sheet or menu it was started from. Nothing is remembered
     * when focus is on no named control (the rail, a deep link), so an older origin never returns.
     */
    capture(): FocusOrigin | undefined {
      stop();
      origin = owner && current && (holding || overlays > 0) ? {owner, scope: current.scope, key: current.key, place: scopes.get(current.scope)?.get(current.key)?.place ?? {}} : undefined;
      return origin;
    },
    /** The player has closed: give focus back to the origin, once. */
    restore() {
      const taken = origin;
      origin = undefined;
      stop();
      if (!taken || taken.owner !== owner) return;
      pending = {origin: taken, key: taken.key, place: taken.place, attempt: 0, fallbacks: 0, timer: undefined};
      pending.timer = timers.schedule(step, delay);
    },
    /** Stop a return under way (the screen has gone). */
    cancel: stop,
    /** For tests and diagnostics. */
    state() {
      return {owner, origin, returning: pending ? {key: pending.key, attempt: pending.attempt} : undefined, overlays};
    },
  };
}

/** The app's one registry: on timers. */
export const focusReturn = createFocusReturn({schedule: (run, ms) => setTimeout(run, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)});
