import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {cardCaption, continueCaption, formatClock, formatDuration} from '../../../../packages/client-core/src/presentation/index';
import type {ImageSourcePropType} from 'react-native';
import {LibraryContentService, type ContentRoute, type LibraryContentSnapshot} from '../../../../packages/client-core/src/library-content';
import {compatContentApi} from '../../../../packages/client-core/src/presentation/index';
import {viewerScope} from './viewer-scope';
import {hasRealOrigin, useSession} from './session';
import {activeI18n} from './errors';

/**
 * One server-authored content projection (Home, a library tab, an entity
 * page). The service owns fetching, paging, fences and stale detection; this
 * hook only binds it to React and the current viewer.
 */
export function useContent(route: ContentRoute | null) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new LibraryContentService({api: compatContentApi(api), scope}), [api, scope]);
  const [snapshot, setSnapshot] = useState<LibraryContentSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  const key = route ? JSON.stringify(route) : '';
  const last = useRef<{key: string; service: unknown}>({key: '', service: null});
  useEffect(() => {
    if (!route) return;
    if (last.current.key === key && last.current.service === service) return;
    last.current = {key, service};
    // select validates synchronously; a route the server authored but the
    // core refuses must become an error state, never a render crash.
    try {
      void service.select(route).catch(() => {});
    } catch (e) {
      const message = e instanceof Error ? e.message : activeI18n().t('content.openFailed');
      if (__DEV__) console.warn('[content] refused route', JSON.stringify(route), message);
      setSnapshot(prev => ({...prev, phase: 'error', error: {code: 'invalid_route', message, retryable: false}}));
    }
  }, [service, key, route]);
  const refresh = useCallback(() => service.refresh().catch(() => {}), [service]);
  const retry = useCallback(() => void service.retry().catch(() => {}), [service]);
  const next = useCallback((sectionId: string) => void service.next(sectionId).catch(() => {}), [service]);
  const select = useCallback((next: ContentRoute) => void service.select(next).catch(() => {}), [service]);
  return {snapshot, refresh, retry, next, select};
}

const noRoute = () => () => {};

/** Authorised artwork source for an entry path. */
export function useArtwork() {
  const {api, session} = useSession();
  const token = session?.accessToken ?? '';
  // A server reached through a verified route has no media address until that route is ready, and
  // a remembered sign-in is on screen before then. The sources follow the route: none while it
  // is being verified, and asked for again the moment it is.
  const route = api.getRouteConnection();
  const origin = useSyncExternalStore(route?.subscribe ?? noRoute, useCallback(() => route?.getSnapshot().origin ?? null, [route]));
  // A new server, token or route starts a fresh cache (the sources carry all three).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => new Map<string, ImageSourcePropType>(), [api, token, origin]);
  return useCallback(
    (path?: string): ImageSourcePropType | undefined => {
      // Bug (c): before the session resolves the API points at a placeholder origin; an image
      // request then would go nowhere (and without a token). Show the placeholder art instead.
      if (!path || !token || !hasRealOrigin(api)) return undefined;
      const hit = cache.get(path);
      if (hit) return hit;
      try {
        const uri = api.mediaUrl(path);
        // No verified address yet: placeholder art for now, and nothing remembered.
        if (!uri) return undefined;
        const source = {uri, headers: {Authorization: `Bearer ${token}`}};
        cache.set(path, source);
        return source;
      } catch {
        return undefined;
      }
    },
    [api, token, cache],
  );
}

/** The pure helpers live in client-core's shared presentation layer (X-05); re-exported for the screens. */
export {viewerScope};
export {shapeFor, iconFor, progressFor, formatDuration, formatClock, formatBytes, friendlyHost} from '../../../../packages/client-core/src/presentation/index';

/** A card's caption: client-core's one rule (an album names its artist, a book its author, an episode its show and number). */
export function captionFor(entry: Parameters<typeof cardCaption>[0]): string | undefined {
  const i18n = activeI18n();
  return cardCaption(entry, i18n.t, {locale: i18n.locale});
}

/** A row's length: a song by the clock ("3:42"), anything longer in words ("1 hr 52 min"). */
export function lengthFor(entry: {kind: string; duration?: number}): string | undefined {
  if (!entry.duration) return undefined;
  return entry.kind === 'song' ? formatClock(entry.duration) : formatDuration(entry.duration) || undefined;
}

/** A Continue Watching card's caption ("S1 E3 · 24 min left"). */
export function continueCaptionFor(entry: Parameters<typeof continueCaption>[0]): string | undefined {
  return continueCaption(entry, activeI18n().t);
}
