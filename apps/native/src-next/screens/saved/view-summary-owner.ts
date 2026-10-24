import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import type {SavedViewSummaryText} from '../../../../../packages/client-core/src/presentation/saved-view-summary';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {NativeHomeSavedViewSummaries} from '../home/saved-view-summaries';
import {createNativeSavedViewSummaryBinding, type NativeSavedViewSummarySource} from './view-summaries';

/** One Saved-owned reader and its binding for one real retained views-directory
 * source. The reader stays private: callers only start, read the existing
 * binding ports, or dispose the whole owner. */
export type NativeSavedViewSummaryOwner = Readonly<{
  start: () => Promise<void>;
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
  line: (resource: PersonalResource, text: SavedViewSummaryText) => string | undefined;
  dispose: () => void;
}>;

/** Construction is inert: no request, library enumeration or subscription
 * happens until start(). The owner retires the reader with the same captured
 * owner lifetime; disposal retires the binding before the reader and never
 * touches the borrowed Saved source. */
export function createNativeSavedViewSummaryOwner(
  context: NativeShellBootstrapContext,
  source: NativeSavedViewSummarySource,
  ownerCurrent: () => boolean,
): NativeSavedViewSummaryOwner {
  const lifetime = nativeDestinationLifetime(context);
  let disposed = false;
  const current = () => !disposed && lifetime.current() && ownerCurrent();
  const reader = new NativeHomeSavedViewSummaries({api: context.api, serverId: lifetime.scope.serverId, current,
    libraryIds: () => context.libraries().map(library => library.id)});
  const binding = createNativeSavedViewSummaryBinding(context, source, ownerCurrent, reader);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    binding.dispose();
    reader.dispose();
  };
  return Object.freeze({start: binding.start, getSnapshot: binding.getSnapshot, subscribe: binding.subscribe, line: binding.line, dispose});
}
