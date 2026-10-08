/**
 * PERF-06: the rail's expansion state, owned outside React state.
 *
 * Opening the rail used to `setState` an `expanded` boolean, which re-rendered every `RailItem`
 * (remounting ~12 label `Text`s and swapping the wordmark) on the same frames as a per-frame Yoga
 * layout of the widening panel. Now expansion lives in a shared value (`{value}` — a Reanimated
 * shared value in the app, a plain object in tests): opening writes it and nothing else. Panel
 * position (`translateX`), label/wordmark opacity and the background crossfade all read it on the
 * UI thread, so no React render is involved.
 *
 * The one thing that still needs React is the accessibility tree: labels that are invisible must
 * be hidden from assistive technology (`accessibilityElementsHidden`). That travels on a separate
 * `subscribeA11y` channel. `RailItem`s never subscribe to anything here — their props are stable
 * across toggles (memoised items, stable callbacks, styles that read `shared`) — so toggling
 * expansion cannot re-render them. The unit test pins exactly that.
 */

export type RailSharedValue = {value: number};

export function createRailExpansion(options: {
  /** 0 collapsed → 1 expanded. Mutated in place; its identity never changes. */
  shared: RailSharedValue;
  collapsedWidth: number;
  expandedWidth: number;
  /** How long after focus/pointer leaves before the rail collapses (hover intent). */
  collapseDelayMs?: number;
}) {
  const {shared, collapsedWidth, expandedWidth} = options;
  const collapseDelayMs = options.collapseDelayMs ?? 140;
  let expanded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const a11yListeners = new Set<() => void>();
  const notifyA11y = () => a11yListeners.forEach(f => f());

  return {
    /** The shared value the animated styles read. Never replaced. */
    shared,
    isExpanded: () => expanded,
    /** `translateX` that leaves exactly `collapsedWidth` of the expanded panel visible. */
    collapsedX: () => -(expandedWidth - collapsedWidth),
    /** Open at once (focus/pointer entering needs no debounce). */
    expand: () => {
      clearTimeout(timer);
      timer = undefined;
      if (expanded) return;
      expanded = true;
      notifyA11y();
    },
    /** Close after `collapseDelayMs`, so stepping between items doesn't flap the rail. */
    collapse: () => {
      clearTimeout(timer);
      timer = undefined;
      if (!expanded) return;
      timer = setTimeout(() => {
        timer = undefined;
        expanded = false;
        notifyA11y();
      }, collapseDelayMs);
    },
    /** Labels and the wordmark subscribe here; rail items must not. */
    subscribeA11y: (fn: () => void) => {
      a11yListeners.add(fn);
      return () => {
        a11yListeners.delete(fn);
      };
    },
  };
}

export type RailExpansion = ReturnType<typeof createRailExpansion>;
