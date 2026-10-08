import {useCallback, useEffect, useState} from 'react';
import {containerCarries, getContainerState, setContainerFlag, setContainerState, type ContainerFlag, type ContainerKind, type ContainerState, type ContainerStateApi} from '../../../../packages/client-core/src/container-state';

/** Kinds with title-level personal state: a watched default (show, season, album, book) or a Favorite (those and artists). */
export function containerKindFor(kind: string | undefined): ContainerKind | undefined {
  return kind === 'show' || kind === 'season' || kind === 'album' || kind === 'book' || kind === 'artist' ? kind : undefined;
}

export type ContainerPersonal = Readonly<{
  /** The current state, once read. */
  state: ContainerState | null;
  saving: boolean;
  refresh: () => void;
  /** Whether this kind carries the flag (Watchlist: shows; Favorite: shows, albums, books, artists). */
  carries: (flag: ContainerFlag | 'watched') => boolean;
  /** Writes the watched default; rereads once on a stale revision. Rejects with the server's error. */
  setWatched: (watched: boolean) => Promise<ContainerState>;
  /** Puts the title on, or takes it off, the Watchlist or Favorites: shown at once, put back if the write fails. */
  setFlag: (flag: ContainerFlag, value: boolean) => Promise<void>;
}>;

/**
 * One title's own personal state (a show, season, album, book or artist): the watched default
 * with the viewer's visible-member counts, and its Watchlist and Favorite flags, so a show's
 * action row is a movie's. The same hook the web uses, over the same client-core calls.
 */
export function useContainerState(api: ContainerStateApi, kind: ContainerKind | undefined, id: string | undefined): ContainerPersonal {
  const [state, setState] = useState<ContainerState | null>(null);
  const [saving, setSaving] = useState(false);
  const [ticket, setTicket] = useState(0);
  useEffect(() => {
    setState(null);
    if (!kind || !id) return;
    const controller = new AbortController();
    getContainerState(api, kind, id, controller.signal).then(setState, () => {});
    return () => controller.abort();
  }, [api, kind, id, ticket]);
  const refresh = useCallback(() => setTicket(t => t + 1), []);
  const carries = useCallback((flag: ContainerFlag | 'watched') => containerCarries(kind, flag), [kind]);
  const setWatched = useCallback(async (watched: boolean) => {
    if (!kind || !id) throw new Error('No title to mark.');
    setSaving(true);
    try {
      const base = state ?? await getContainerState(api, kind, id);
      let next: ContainerState;
      try {
        next = await setContainerState(api, kind, id, {expectedRevision: base.revision, watched});
      } catch (e) {
        // A 409 rereads before authoring the intent again, exactly once.
        if ((e as {code?: string})?.code !== 'revision_mismatch') throw e;
        const current = await getContainerState(api, kind, id);
        next = await setContainerState(api, kind, id, {expectedRevision: current.revision, watched});
      }
      setState(current => ({...next, ...(current?.watchedCount !== undefined ? {watchedCount: current.watchedCount, unwatchedCount: current.unwatchedCount} : {})}));
      return next;
    } finally {
      setSaving(false);
    }
  }, [api, kind, id, state]);
  const setFlag = useCallback(async (flag: ContainerFlag, value: boolean) => {
    if (!kind || !id || !containerCarries(kind, flag)) return;
    const before = state;
    if (before) setState({...before, [flag]: value});
    try {
      const next = await setContainerFlag(api, kind, id, flag, value);
      // The write's answer has no counts; keep the ones already read.
      setState(current => ({...next, ...(current?.watchedCount !== undefined ? {watchedCount: current.watchedCount, unwatchedCount: current.unwatchedCount} : {})}));
    } catch (e) {
      setState(before);
      throw e;
    }
  }, [api, kind, id, state]);
  return {state, saving, refresh, carries, setWatched, setFlag};
}
