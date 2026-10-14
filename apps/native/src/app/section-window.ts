import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {createWindowedCollection, type WindowedCollection} from '../../../../packages/client-core/src/collections/index';
import type {ContentEntry, ContentRoute, ContentSection} from '../../../../packages/client-core/src/library-content';
import {SECTION_PAGE, sectionSource} from './section-source';

export {SECTION_PAGE, sectionSource};
import {compatContentApi} from '../../../../packages/client-core/src/presentation/index';
import {viewerScope} from './viewer-scope';
import {useSession} from './session';
import {useFreshness} from './freshness';

/**
 * One collection per entity section, for as long as that section is on screen. When the entity's
 * first page is read again (a quiet read, or a refresh) the same collection takes the new first
 * page behind what is shown and swaps to it whole, at the same place, once every row in view has
 * arrived and the remote or the finger has been still for a moment. Rows keep their keys, so
 * the focused row stays focused and a long list does not jump back to its top.
 */
export function useSectionWindow(route: ContentRoute | null, section: ContentSection | undefined): WindowedCollection<ContentEntry> | null {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const {hub} = useFreshness();
  const seeded = useRef<ContentSection | undefined>(undefined);
  const list = useMemo<WindowedCollection<ContentEntry> | null>(
    () => {
      seeded.current = section;
      return route && section ? createWindowedCollection<ContentEntry>({fetchPage: sectionSource(compatContentApi(api), scope, route, section), pageSize: SECTION_PAGE, maxResidentPages: 5, keyOf: e => e.id}) : null;
    },
    // The route and the section's id are its identity; a new first page of the same section is taken quietly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, scope, route?.libraryId, route?.view, route?.entityId, section?.id],
  );
  useEffect(() => {
    if (!list || !route || !section || seeded.current === section) return;
    seeded.current = section;
    const fetchPage = sectionSource(compatContentApi(api), scope, route, section);
    // A list that has shown nothing yet has nothing to keep: it simply starts from the new first page.
    if (list.getSnapshot().total === undefined) { list.invalidate(fetchPage); return; }
    void list.revalidate({fetchPage, hold: () => hub.settled()}).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, section]);
  useEffect(() => () => list?.dispose(), [list]);
  const subscribe = useMemo(() => (listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list]);
  useSyncExternalStore(subscribe, () => list?.getSnapshot() ?? idle);
  return list;
}
const idle = Object.freeze({generation: 0, total: undefined, totalIsLowerBound: false, status: 'idle' as const, error: undefined as unknown, positionIndex: undefined, refreshing: false});
