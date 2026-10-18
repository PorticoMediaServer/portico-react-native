/**
 * TV-PLAYER-03 / NAV-10.8: when the player closes, focus goes back to the control that started it.
 *
 * The control is named, not held: a card is `card(group, entry id)` within its screen, a button
 * by what it does (`action:play`), and a button that belongs to one card or row (an episode's
 * Play in its details) by what it does within that row (`withinFocusKey`). Every focusable that
 * has a name tells this registry when it is mounted and when it takes or loses focus; every other
 * focusable says only that focus is now on something unnamed. So the player can capture the
 * origin at the moment it is asked to start, wherever that was asked from, and give focus back to
 * the same control when it closes, even if the list has redrawn or moved it meanwhile:
 *
 * - The origin belongs to the viewer (server, account, profile) and the screen it was captured on.
 *   It is used once, then forgotten; a viewer change forgets it at once, and so does its screen
 *   going away. A screen that is not the one showing (another was pushed over it, another tab
 *   was chosen) is never given focus.
 * - Focus counts as returned only once the control reports that it has it; until then it is asked
 *   again, a bounded number of times. Before each ask, the lists it is in bring it into view
 *   (`resolve`), outermost first, whether or not it is mounted: a mounted card can still be off
 *   screen, and the focus engine may refuse it there.
 * - A title that has gone (finished and left Continue Watching) hands over to its neighbour in the
 *   row, and a row that has gone to the row now in its place. A list that is still reading where
 *   the title was says so, and is waited for (a bounded time) rather than taken as "gone".
 * - The person comes first: a key pressed on the remote while focus is still on its way back
 *   (`intent`) ends the return there. Focus moving by itself (the screen coming back from under
 *   the player, the return's own request) does not.
 * - A sheet or menu belongs to the control focus was on when it opened (the card whose More
 *   menu it is). Starting from inside one captures that control, and nothing if it was unnamed.
 *   It is remembered as it was when the first sheet opened, so a list redrawing or dropping that
 *   control under the menu does not change what the menu's Play comes from.
 * - A request for focus is answered by the native focus engine a frame later. By then the return
 *   may have ended (a key, the screen leaving, another viewer), or the control may have been
 *   reused for another entry; the request asks `still()` first and does nothing then.
 *
 * Nothing here is React: the screens' controls and lists plug in through `Focusable` and the
 * resolvers in `focus-lists.ts`.
 */

/**
 * A control the registry can focus. `still` says, when the request finally reaches the native
 * focus engine (a frame later), whether this return still wants this control: false once the
 * return has ended, moved to another control, or this control has left or been renamed.
 */
export type FocusTarget = {focus(still: () => boolean): void};
/** Where the control sat when it registered: its row on the screen and its place in the row. */
export type FocusPlace = Readonly<{row?: number; column?: number}>;
export type FocusOrigin = Readonly<{owner: string; scope: string; key: string; place: FocusPlace}>;

/**
 * What a list knows about one control while focus is coming back to it.
 *
 * - `unknown`: not this list's control.
 * - `container`: this list holds the list the control is in (a row of cards) and has brought that
 *   list into view. That inner list decides whether the control itself is there.
 * - `found`: this list has the control and has brought it into view.
 * - `loading`: this list may have it, and is reading the part where it was.
 * - `gone`: this list had it, and it has gone. `next` is the control to go to instead (its
 *   neighbour); none when there is nothing left to go to.
 */
export type FocusLookup =
  | Readonly<{kind: 'unknown'}>
  | Readonly<{kind: 'container'}>
  | Readonly<{kind: 'found'}>
  | Readonly<{kind: 'loading'}>
  | Readonly<{kind: 'gone'; next?: string}>;

export const LOOKUP_UNKNOWN: FocusLookup = Object.freeze({kind: 'unknown'});
export const LOOKUP_CONTAINER: FocusLookup = Object.freeze({kind: 'container'});
export const LOOKUP_FOUND: FocusLookup = Object.freeze({kind: 'found'});
export const LOOKUP_LOADING: FocusLookup = Object.freeze({kind: 'loading'});
export const lookupGone = (next?: string): FocusLookup => ({kind: 'gone', next});

/** A list that can bring one of its controls into view, or say where it went. */
export type FocusResolver = {
  /** Called on every ask: brings `key` (or the list holding it) into view and says what it found. */
  resolve(key: string, place: FocusPlace): FocusLookup;
};

/**
 * What a return does next, from what every list in the screen said about the control:
 * - `wait`: ask the control (when it is mounted) and look again after the interval;
 *   `loading` when a list is still reading (a longer, separate budget).
 * - `switch`: the control has gone; go to `next` instead.
 * - `abandon`: it has gone and there is nothing to go to.
 *
 * The control itself decides over any container, and a list that has it, or is still reading
 * where it was, decides over one that says it has gone.
 */
export type FocusDecision = Readonly<{kind: 'wait'; loading: boolean}> | Readonly<{kind: 'switch'; next: string}> | Readonly<{kind: 'abandon'}>;

export function decideFocusReturn(lookups: readonly FocusLookup[]): FocusDecision {
  if (lookups.some(l => l.kind === 'found')) return {kind: 'wait', loading: false};
  if (lookups.some(l => l.kind === 'loading')) return {kind: 'wait', loading: true};
  const gone = lookups.filter((l): l is Extract<FocusLookup, {kind: 'gone'}> => l.kind === 'gone');
  const next = gone.find(l => l.next !== undefined)?.next;
  if (next !== undefined) return {kind: 'switch', next};
  if (gone.length) return {kind: 'abandon'};
  return {kind: 'wait', loading: false};
}

export type FocusReturnTimers = {
  schedule(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
};

export type FocusReturnOptions = Readonly<{
  /** Asks made before giving up. */
  attempts?: number;
  /** Further looks allowed while a list is still reading where the control was. */
  loadingAttempts?: number;
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

/**
 * A control that belongs to another (an episode's Play in that episode's open details): when it
 * has gone, focus goes to the control it belongs to.
 */
export function withinFocusKey(parent: string, action: string): string {
  return `within\u001e${action}\u001e${parent}`;
}

/** The control a `withinFocusKey` control belongs to, or undefined. */
export function parentFocusKey(key: string): string | undefined {
  const parts = key.split('\u001e');
  return parts.length === 3 && parts[0] === 'within' ? parts[2] : undefined;
}

/**
 * A remote key that is the person moving or choosing (not focus moving by itself): a direction,
 * Select, Menu/Back, a page or swipe. A key's release (`eventKeyAction` 1) is the end of a press
 * already counted, or of the press that closed the player, so it is not counted again.
 */
export function isFocusIntent(event: {eventType?: string; eventKeyAction?: number} | null | undefined): boolean {
  if (!event || typeof event.eventType !== 'string' || event.eventKeyAction === 1) return false;
  return INTENT_KEYS.has(event.eventType);
}
const INTENT_KEYS = new Set(['up', 'down', 'left', 'right', 'select', 'longSelect', 'longUp', 'longDown', 'longLeft', 'longRight', 'menu', 'pageUp', 'pageDown', 'swipeUp', 'swipeDown', 'swipeLeft', 'swipeRight', 'channelUp', 'channelDown']);

type Registered = {target: FocusTarget; place: () => FocusPlace};
type Named = {scope: string; key: string};
type Invoker = Named & {place: FocusPlace};
type Pending = {origin: FocusOrigin; key: string; place: FocusPlace; asks: number; looks: number; fallbacks: number; timer: unknown; locate?: () => string | 'loading' | 'gone'};

export type FocusReturn = ReturnType<typeof createFocusReturn>;

export function createFocusReturn(timers: FocusReturnTimers, options: FocusReturnOptions = {}) {
  const attempts = options.attempts ?? 12;
  const loadingAttempts = options.loadingAttempts ?? 25;
  const interval = options.interval ?? 120;
  const delay = options.delay ?? 60;
  let owner = '';
  const scopes = new Map<string, Map<string, Registered>>();
  const resolvers = new Map<string, Set<FocusResolver>>();
  /** Screens that are not the one showing (covered by another, or in another tab). */
  const inactive = new Set<string>();
  /**
   * The control focus was last on outside any sheet or menu: named, or `null` for an unnamed one.
   * `holding` is whether it still has focus; `inOverlay` whether focus is in a sheet or menu now.
   */
  let current: Named | null = null;
  let holding = false;
  let inOverlay = false;
  /** Sheets and menus open over the screens. */
  let overlays = 0;
  /**
   * The control the first open sheet or menu was opened from, as it was then (`null`: an unnamed
   * one, or forgotten since); kept while any is open, whatever happens to the control under it.
   */
  let invoker: Invoker | null = null;
  let origin: FocusOrigin | undefined;
  let pending: Pending | undefined;

  const stop = () => {
    if (pending) timers.cancel(pending.timer);
    pending = undefined;
  };
  const active = (scope: string) => !inactive.has(scope);
  const placeOf = (scope: string, key: string): FocusPlace => scopes.get(scope)?.get(key)?.place() ?? {};

  const step = () => {
    const p = pending;
    if (!p) return;
    if (p.origin.owner !== owner || !active(p.origin.scope)) { stop(); return; }
    const scope = p.origin.scope;
    if (p.locate) {
      // A list's own move (`follow`): the list says which control is there now, or that it is still reading.
      const where = p.locate();
      if (where === 'gone') { stop(); return; }
      if (where === 'loading') p.looks++;
      else {
        p.key = where;
        p.asks++;
        const target = scopes.get(scope)?.get(where);
        target?.target.focus(() => pending === p && p.key === where && p.origin.owner === owner && active(scope) && scopes.get(scope)?.get(where) === target);
      }
      if (p.asks >= attempts || p.looks >= loadingAttempts) { stop(); return; }
      p.timer = timers.schedule(step, interval);
      return;
    }
    // The lists bring the control (and the row holding it) into view first, even when it is
    // mounted, then the control is asked.
    const lookups = [...(resolvers.get(scope) ?? [])].map(resolver => resolver.resolve(p.key, p.place));
    const decision = decideFocusReturn(lookups);
    const key = p.key;
    const found = scopes.get(scope)?.get(key);
    if (found) {
      p.asks++;
      // Answered a frame later: only if this return still wants this very registration then.
      found.target.focus(() => pending === p && p.key === key && p.origin.owner === owner && active(scope) && scopes.get(scope)?.get(key) === found);
    } else if (decision.kind === 'switch' && p.fallbacks < 2) {
      p.key = decision.next;
      p.fallbacks++;
      p.asks++;
    } else if (decision.kind === 'abandon') {
      stop();
      return;
    } else if (decision.kind === 'wait' && decision.loading) {
      p.looks++;
    } else {
      p.asks++;
      // A control that belongs to another and is no longer mounted (its details have closed):
      // after one more look, the control it belongs to.
      const parent = parentFocusKey(p.key);
      if (parent !== undefined && p.asks >= 2 && p.fallbacks < 2 && !lookups.some(l => l.kind === 'found')) { p.key = parent; p.fallbacks++; }
    }
    if (p.asks >= attempts || p.looks >= loadingAttempts) { stop(); return; }
    p.timer = timers.schedule(step, interval);
  };

  const forgetScope = (scope: string) => {
    if (origin?.scope === scope) origin = undefined;
    if (pending?.origin.scope === scope) stop();
    if (current?.scope === scope) { current = null; holding = false; }
    if (invoker?.scope === scope) invoker = null;
  };

  return {
    /** The viewer the screens belong to. A change forgets the origin and any return under way. */
    setOwner(next: string) {
      if (next === owner) return;
      owner = next;
      origin = undefined;
      current = null;
      holding = false;
      inOverlay = false;
      invoker = null;
      stop();
    },
    /**
     * A named control is mounted. `place` is read when it is needed, so a control that moves in
     * its list keeps one registration. Unregistering the control that has focus forgets it (an
     * open menu's invoker is kept: the menu still belongs to it).
     */
    register(scope: string, key: string, target: FocusTarget, place: FocusPlace | (() => FocusPlace) = {}): () => void {
      let map = scopes.get(scope);
      if (!map) { map = new Map(); scopes.set(scope, map); }
      const entry: Registered = {target, place: typeof place === 'function' ? place : () => place};
      map.set(key, entry);
      return () => {
        const now = scopes.get(scope);
        if (now?.get(key) !== entry) return;
        now.delete(key);
        if (!now.size) scopes.delete(scope);
        if (current && current.scope === scope && current.key === key) { current = null; holding = false; }
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
      inOverlay = false;
      if (pending && pending.origin.scope === scope && pending.key === key) stop();
    },
    blurred(scope: string, key: string) {
      if (current && current.scope === scope && current.key === key) holding = false;
    },
    /**
     * A control without a name took focus: outside a sheet or menu, it is now the control focus is
     * on (so nothing is captured from it); inside one, the control the sheet was opened from stays.
     */
    focusedUnnamed(overlay = false) {
      if (overlay) { inOverlay = true; return; }
      current = null;
      holding = false;
      inOverlay = false;
    },
    /**
     * A sheet or menu opened (`true`) or closed. The first to open remembers the control focus was
     * on (named, with its place, or none); nested ones keep it; the last to close forgets it.
     */
    overlay(open: boolean) {
      if (open && !overlays) invoker = current ? {scope: current.scope, key: current.key, place: placeOf(current.scope, current.key)} : null;
      overlays = Math.max(0, overlays + (open ? 1 : -1));
      if (!overlays) { inOverlay = false; invoker = null; }
    },
    /** The person pressed a key on the remote: a return still under way stops where it is. */
    intent() {
      stop();
    },
    /** A screen became the one showing (`true`), or another was pushed over it or chosen instead. */
    setScopeActive(scope: string, isActive: boolean) {
      if (isActive) { inactive.delete(scope); return; }
      inactive.add(scope);
      if (pending?.origin.scope === scope) stop();
    },
    /** A screen has gone: its origin, its return and its focused control are forgotten. */
    disposeScope(scope: string) {
      inactive.delete(scope);
      scopes.delete(scope);
      resolvers.delete(scope);
      forgetScope(scope);
    },
    /**
     * Playback is starting: remember the control it was started from. That is the named control
     * with focus, or, from inside a sheet or menu, the control focus was on when the first one
     * opened (its place now, if it is still there; else where it was then). Nothing is remembered
     * when that is an unnamed control (the rail, a deep link), so an older origin never returns.
     */
    capture(): FocusOrigin | undefined {
      stop();
      let from: Invoker | null = null;
      if (overlays > 0) from = invoker && (scopes.get(invoker.scope)?.has(invoker.key) ? {...invoker, place: placeOf(invoker.scope, invoker.key)} : invoker);
      else if (current && (holding || inOverlay)) from = {...current, place: placeOf(current.scope, current.key)};
      origin = owner && from ? {owner, scope: from.scope, key: from.key, place: from.place} : undefined;
      return origin;
    },
    /** The player has closed: give focus back to the origin, once, if its screen is the one showing. */
    restore() {
      const taken = origin;
      origin = undefined;
      stop();
      if (!taken || taken.owner !== owner || !active(taken.scope)) return;
      pending = {origin: taken, key: taken.key, place: taken.place, asks: 0, looks: 0, fallbacks: 0, timer: undefined};
      pending.timer = timers.schedule(step, delay);
    },
    /** Stop a return under way. */
    cancel: stop,
    /**
     * A list's own move (a TV letter jumped to): focus goes to the control `locate` names, on this
     * showing screen, for this viewer. `locate` is asked on every look: the control's name once the
     * list holds it there (and it is asked for focus until it is mounted and takes it), `loading`
     * while the list is still reading that part, `gone` to stop. It is a return like any other: the
     * same bounded looks, and ended by a key, the screen leaving, another viewer, the screen going,
     * or another return or move.
     */
    follow(scope: string, locate: () => string | 'loading' | 'gone') {
      stop();
      if (!owner || !active(scope)) return;
      pending = {origin: {owner, scope, key: '', place: {}}, key: '', place: {}, asks: 0, looks: 0, fallbacks: 0, timer: undefined, locate};
      step();
    },
    /** For tests and diagnostics. */
    state() {
      return {owner, origin, returning: pending ? {key: pending.key, asks: pending.asks, looks: pending.looks} : undefined, overlays, invoker, current: current ? {...current, holding} : null, inOverlay};
    },
  };
}

/** The app's one registry: on timers. */
export const focusReturn = createFocusReturn({schedule: (run, ms) => setTimeout(run, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)});
