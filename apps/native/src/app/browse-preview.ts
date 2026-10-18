import {useEffect, useMemo} from 'react';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';

/**
 * What a television's browsing preview shows (Home, a library's Discover): the card with focus.
 *
 * The words follow focus at once; they are in the row's own entry. The artwork follows only once
 * focus has rested on a card (`settleMs`), so holding the remote down a row starts no image
 * until it stops. Focus moving to the rail or the library's tabs changes nothing: the last card
 * stays described. One store belongs to one screen for one viewer; a screen that unmounts, or a
 * viewer change, disposes of it, and nothing it had pending happens after.
 */
export type PreviewFocus = Readonly<{entry: ContentEntry; group: string; /** A Continue card, which resumes when pressed. */ resume: boolean}>;
export type BrowsePreviewSnapshot = Readonly<{
  /** The card described: focused, else where browsing starts. */
  focus?: PreviewFocus;
  /** The card whose artwork is shown: `focus` once it has settled. */
  art?: PreviewFocus;
  /** Whether a card has had focus yet (until then the preview describes where browsing starts). */
  touched: boolean;
}>;

export type PreviewTimers = {schedule(run: () => void, ms: number): unknown; cancel(handle: unknown): void};

/** How long focus rests on a card before its artwork is asked for, ms. */
export const PREVIEW_SETTLE_MS = 180;

const same = (a: PreviewFocus | undefined, b: PreviewFocus | undefined) => !!a && !!b && a.group === b.group && a.entry.id === b.entry.id;

export type BrowsePreviewStore = ReturnType<typeof createBrowsePreview>;

export function createBrowsePreview(timers: PreviewTimers, settleMs = PREVIEW_SETTLE_MS) {
  let snapshot: BrowsePreviewSnapshot = {touched: false};
  const listeners = new Set<() => void>();
  let timer: unknown;
  let disposed = false;
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const set = (next: BrowsePreviewSnapshot) => { snapshot = next; emit(); };
  const settle = () => {
    timers.cancel(timer);
    timer = timers.schedule(() => {
      timer = undefined;
      if (disposed || (same(snapshot.art, snapshot.focus) && snapshot.art?.entry === snapshot.focus?.entry)) return;
      set({...snapshot, art: snapshot.focus});
    }, settleMs);
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    /** A card took focus. */
    show(focus: PreviewFocus) {
      if (disposed) return;
      if (same(snapshot.focus, focus)) {
        // The card described already (focus back from the rail or the tabs): at most its entry is fresher.
        if (snapshot.focus!.entry !== focus.entry || focus.resume !== snapshot.focus!.resume) set({...snapshot, focus, art: same(snapshot.art, focus) ? focus : snapshot.art, touched: true});
        else if (!snapshot.touched) set({...snapshot, touched: true});
        return;
      }
      set({...snapshot, focus, touched: true});
      settle();
    },
    /**
     * Where browsing starts, before any card has had focus: shown with its artwork at once (the
     * screen's first picture). Once the viewer has moved, this changes nothing.
     */
    seed(focus: PreviewFocus | undefined) {
      if (disposed || snapshot.touched) return;
      if (same(snapshot.focus, focus) && snapshot.focus!.entry === focus!.entry) return;
      timers.cancel(timer);
      set({touched: false, focus, art: focus});
    },
    /**
     * The rows were read again. The card described keeps its place with its fresh entry (new
     * progress, a new synopsis); a card that has gone hands over to `fallback`.
     */
    reconcile(find: (group: string, entryId: string) => ContentEntry | undefined, fallback: PreviewFocus | undefined) {
      if (disposed) return;
      const current = snapshot.focus;
      if (!current) { if (fallback) set({touched: snapshot.touched, focus: fallback, art: fallback}); return; }
      const fresh = find(current.group, current.entry.id);
      if (fresh === current.entry) return;
      if (fresh) {
        const focus = {...current, entry: fresh};
        set({...snapshot, focus, art: same(snapshot.art, current) ? focus : snapshot.art});
        return;
      }
      timers.cancel(timer);
      set({touched: snapshot.touched, focus: fallback, art: fallback});
    },
    dispose() {
      disposed = true;
      timers.cancel(timer);
      timer = undefined;
      listeners.clear();
    },
  };
}

const realTimers: PreviewTimers = {schedule: (run, ms) => setTimeout(run, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)};

/**
 * One preview store for this screen and viewer (`scope`: the screen and the server, account and
 * profile it shows). A new scope, or the screen going away, disposes of the old store, so nothing
 * it had pending (artwork settling) happens after, and no card of one viewer describes another's screen.
 */
export function useBrowsePreview(scope: string, timers: PreviewTimers = realTimers): BrowsePreviewStore {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createBrowsePreview(timers), [scope]);
  useEffect(() => () => store.dispose(), [store]);
  return store;
}
