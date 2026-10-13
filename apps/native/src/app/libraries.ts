import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {HttpLocalApi, Library} from '../../../../packages/client-core/src/index';
import {say} from './errors';

export type LibrariesState = {items: readonly Library[]; loading: boolean; error?: string; reload: () => void};

/** Authorized libraries for the selected viewer. Refetched on session change. */
export function useLibraries(api: HttpLocalApi, sessionKey: string | undefined): LibrariesState {
  const [items, setItems] = useState<readonly Library[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const readFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!sessionKey) {
      readFor.current = undefined;
      setItems([]);
      return;
    }
    let active = true;
    // Only the first read for this viewer shows as loading; a later one keeps the list on screen.
    if (readFor.current !== sessionKey) setLoading(true);
    setError(undefined);
    api
      .libraries()
      .then(result => {
        if (active) { readFor.current = sessionKey; setItems(result.items); }
      })
      .catch(e => {
        // Once the list has been read, a later read that fails leaves it as it is and says nothing.
        if (active && readFor.current !== sessionKey) setError(say(e, 'library', 'load'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, sessionKey, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  // One object per change, so the context provider above does not re-render
  // every consumer on each shell render.
  return useMemo(() => ({items, loading, error, reload}), [items, loading, error, reload]);
}

/** Human label for a library kind. */
export function libraryKindLabel(kind: string): string {
  switch (kind) {
    case 'movie':
      return 'Movies';
    case 'tv':
      return 'TV Shows';
    case 'anime':
      return 'Anime';
    case 'music':
      return 'Music';
    case 'audiobook':
      return 'Audiobooks';
    default:
      return 'Library';
  }
}
