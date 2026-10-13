import {useEffect, useMemo, useSyncExternalStore} from 'react';
import {createWindowedCollection, type WindowedCollection} from '../../../../packages/client-core/src/collections/index';
import type {ContentEntry, ContentRoute, ContentSection} from '../../../../packages/client-core/src/library-content';
import {SECTION_PAGE, sectionSource} from './section-source';

export {SECTION_PAGE, sectionSource};
import {compatContentApi} from '../../../../packages/client-core/src/presentation/index';
import {viewerScope} from './viewer-scope';
import {useSession} from './session';

/** One collection per entity section (reseeded when the entity's first page is read again). */
export function useSectionWindow(route: ContentRoute | null, section: ContentSection | undefined): WindowedCollection<ContentEntry> | null {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const list = useMemo<WindowedCollection<ContentEntry> | null>(
    () => (route && section ? createWindowedCollection<ContentEntry>({fetchPage: sectionSource(compatContentApi(api), scope, route, section), pageSize: SECTION_PAGE, maxResidentPages: 5, keyOf: e => e.id}) : null),
    // A new first page (refresh) brings a new section object; the route is part of its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, scope, route?.libraryId, route?.view, route?.entityId, section],
  );
  useEffect(() => () => list?.dispose(), [list]);
  const subscribe = useMemo(() => (listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list]);
  useSyncExternalStore(subscribe, () => list?.getSnapshot() ?? idle);
  return list;
}
const idle = Object.freeze({generation: 0, total: undefined, status: 'idle' as const, error: undefined as unknown, positionIndex: undefined, refreshing: false});
