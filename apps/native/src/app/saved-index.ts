import {useEffect, useMemo, useState} from 'react';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {SavedService} from '../../../../packages/client-core/src/saved';
import {indexesTitles, type ActivityTitle} from '../bridge/NativeActivity';
import {captionFor, viewerScope} from './content';
import {requestId} from './detail';
import {hasRealOrigin, useSession} from './session';

/**
 * The viewer's My List, for the device's own search and Siri (OS-02). Home has no My List row
 * by design, so this reads the list itself: its first page, whenever `refresh` changes (Home
 * passes its document, so the two stay in step). Undefined until a read has answered; a read
 * that fails keeps the last answer, so the device's index is never emptied by a bad connection.
 * Nothing is read on a device that has no such index.
 */
export function useSavedTitles(refresh: unknown): readonly ActivityTitle[] | undefined {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const [titles, setTitles] = useState<{scope: unknown; list: readonly ActivityTitle[]}>();
  const ready = indexesTitles && !!session && hasRealOrigin(api);
  useEffect(() => {
    if (!ready || !refresh) return;
    let active = true;
    const service = new SavedService({api, scope, requestId});
    Promise.resolve()
      .then(() => service.select({view: 'watchlist'}))
      .then(() => {
        const snapshot = service.getSnapshot();
        if (!active || snapshot.phase !== 'ready' || !snapshot.projection) return;
        const entries = snapshot.projection.sections.flatMap(s => s.entries).filter((e): e is ContentEntry => e.kind !== 'playlist' && e.kind !== 'playlist_entry');
        setTitles({scope, list: entries.filter(e => e.playback || e.kind === 'movie' || e.kind === 'episode').map(e => ({itemId: e.playback?.itemId ?? e.id, title: e.title, subtitle: captionFor(e)}))});
      })
      .catch(() => {})
      .finally(() => service.dispose());
    return () => { active = false; };
  }, [ready, api, scope, refresh]);
  // Another viewer's list is never handed on.
  return titles && titles.scope === scope ? titles.list : undefined;
}
