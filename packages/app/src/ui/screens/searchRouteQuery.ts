import {useEffect, useRef} from 'react';

interface SearchRouteQuerySetters {
  setSearchQuery(value: string): void;
  setDebouncedQuery(value: string): void;
  setSubmittedQuery(value: string): void;
}

/**
 * Applies navigation-owned search input once per route-parameter identity.
 * Local edits deliberately are not dependencies: after route hydration, the
 * text field remains authoritative until navigation supplies a different
 * query (including clearing a previously supplied query).
 */
export function useSearchRouteQuery(initialQuery: unknown, setters: SearchRouteQuerySetters): void {
  const routeQuery = typeof initialQuery === 'string' ? initialQuery : undefined;
  const hasObservedRoute = useRef(false);
  const previousRouteQuery = useRef<string | undefined>(undefined);
  const {setSearchQuery, setDebouncedQuery, setSubmittedQuery} = setters;

  useEffect(() => {
    const isFirstRoute = !hasObservedRoute.current;
    const routeChanged = !isFirstRoute && previousRouteQuery.current !== routeQuery;
    hasObservedRoute.current = true;
    previousRouteQuery.current = routeQuery;

    if ((isFirstRoute && routeQuery === undefined) || (!isFirstRoute && !routeChanged)) return;

    const nextQuery = routeQuery ?? '';
    const normalizedQuery = nextQuery.trim();
    setSearchQuery(nextQuery);
    setDebouncedQuery(normalizedQuery);
    setSubmittedQuery(normalizedQuery);
  }, [routeQuery, setDebouncedQuery, setSearchQuery, setSubmittedQuery]);
}
