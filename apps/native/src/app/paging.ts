import {useCallback, useMemo, useRef} from 'react';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';

/**
 * APL-SYS-08: continuous scrolling over a cursor-paged service.
 *
 * The client-core services hold one page at a time (`cursor` names it; `null` is the first).
 * This keeps every page the viewer has scrolled through, in order, so a list grows as they
 * scroll and nothing ever pages backwards. A page is stored under its cursor, so a page that
 * changes in place (a removal, a refresh of the same page) replaces its own segment. The first
 * page, or a new `scope` (tab, sort, route), starts over.
 */
export function useAppendedPages<T>(scope: string, cursor: string | null, page: readonly T[], keyOf: (item: T) => string): readonly T[] {
  const segments = useRef<{scope: string; pages: Map<string, readonly T[]>}>({scope: '', pages: new Map()});
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;
  return useMemo(() => {
    const store = segments.current;
    if (store.scope !== scope || cursor === null) {
      store.scope = scope;
      store.pages = new Map();
    }
    store.pages.set(cursor ?? '', page);
    const seen = new Set<string>();
    const out: T[] = [];
    for (const items of store.pages.values()) {
      for (const item of items) {
        const key = keyRef.current(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }, [scope, cursor, page]);
}

/**
 * Calls `onEnd` when the scroller comes within about a screen and a half of its end: by touch
 * scrolling, or on television as focus moves the page down. The caller guards against loading
 * twice (its service knows whether a page is already on the way).
 */
export function useEndReached(onEnd: () => void) {
  const latest = useRef(onEnd);
  latest.current = onEnd;
  return useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {layoutMeasurement, contentOffset, contentSize} = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - layoutMeasurement.height * 1.5) latest.current();
  }, []);
}
