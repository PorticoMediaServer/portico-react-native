import type {NativeSavedSelectionSource} from '../../saved/selection';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import type {SavedEntry, SavedProjection} from '../../../../../../packages/client-core/src/saved';
import type {NativeTVSavedController} from './model';

/** The TV Saved landing already reads the two authorized projections, one per shape, for the
 * tab it shows. This adapter presents them to the same Saved selection owner the phone hub
 * uses — posters as My List's projection and squares as Favorites', both from the current tab
 * — so the selection's view identity, membership and per-leaf grants come from the real
 * server projection rather than a copy. It owns no state and adds no store. */
export function nativeTVSavedSelectionSource(controller: NativeTVSavedController): NativeSavedSelectionSource {
  /** The saved projection also carries rows that are not titles: a reading-group marker,
   * a playlist card and a playlist entry. They cannot be picked and are not content
   * entries, so the selection view sees only the real titles, in their own order. */
  const titles = (projection: SavedProjection): Pick<SavedProjection, 'scope' | 'revision'> & Readonly<{sections: readonly Readonly<{id: string; entries: readonly ContentEntry[]}>[]}> =>
    Object.freeze({scope: projection.scope, revision: projection.revision,
      sections: projection.sections.map(section => Object.freeze({id: section.id,
        entries: section.entries.filter((entry: SavedEntry): entry is ContentEntry =>
          entry.kind !== 'reading_group' && entry.kind !== 'playlist' && entry.kind !== 'playlist_entry')}))});
  const read = (): ReturnType<NativeSavedSelectionSource['getSnapshot']> => {
    const state = controller.getSnapshot();
    const route = Object.freeze({view: state.tab});
    return Object.freeze({
      phase: state.phase,
      myList: Object.freeze({route, ...(state.posters ? {projection: titles(state.posters)} : {})}),
      favorites: Object.freeze({route, ...(state.squares ? {projection: titles(state.squares)} : {})}),
    });
  };
  return Object.freeze({
    getSnapshot: read,
    subscribe: controller.subscribe,
    // The TV landing reports no hub-wide busy flag; the selection's own work is tracked inside it.
    snapshot: () => Object.freeze({busy: false}),
  });
}
