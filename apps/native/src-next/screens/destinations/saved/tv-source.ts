import type {NativeSavedSelectionSource} from '../../saved/selection';
import type {NativeTVSavedController} from './model';

/** The TV Saved landing already reads the two authorized projections, one per shape, for the
 * tab it shows. This adapter presents them to the same Saved selection owner the phone hub
 * uses — posters as My List's projection and squares as Favorites', both from the current tab
 * — so the selection's view identity, membership and per-leaf grants come from the real
 * server projection rather than a copy. It owns no state and adds no store. */
export function nativeTVSavedSelectionSource(controller: NativeTVSavedController): NativeSavedSelectionSource {
  const read = (): ReturnType<NativeSavedSelectionSource['getSnapshot']> => {
    const state = controller.getSnapshot();
    const route = Object.freeze({view: state.tab});
    return Object.freeze({
      phase: state.phase,
      myList: Object.freeze({route, ...(state.posters ? {projection: state.posters} : {})}),
      favorites: Object.freeze({route, ...(state.squares ? {projection: state.squares} : {})}),
    });
  };
  return Object.freeze({
    getSnapshot: read,
    subscribe: controller.subscribe,
    // The TV landing reports no hub-wide busy flag; the selection's own work is tracked inside it.
    snapshot: () => Object.freeze({busy: false}),
  });
}
