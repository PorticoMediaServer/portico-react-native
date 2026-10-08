import type { LibraryNavigationService, MediaItem, ViewerService, ViewerSnapshot } from '../../../../packages/client-core/src/index.ts';
import type { DetailService, DetailTarget } from '../../../../packages/client-core/src/detail.ts';

export type NativeDetailOpen = {
  target: DetailTarget;
  title: string;
  originId: string;
  originRoute: string;
  viewerOwner: string;
  startSeconds?: number;
};

/** Private in-memory identity stamp; never presentation or diagnostic data. */
export function detailViewerOwner(snapshot: ViewerSnapshot): string {
  const session = snapshot.session;
  return snapshot.phase === 'ready' && session
    ? JSON.stringify([snapshot.generation, snapshot.serverUrl, session.accessToken,
        session.viewer.authority, session.viewer.accountId,
        session.viewer.profileId, session.viewer.serverId])
    : '';
}

export function detailBackLabel(routeKind: string): string {
  return routeKind === 'search' ? 'Back to search'
    : routeKind === 'saved' || routeKind === 'playlist' ? 'Back to Saved'
    : 'Back to library';
}

/** Shared DetailService owns HTTP, DTO validation, deadlines, and read fencing. */
export async function readNativeDetail({ service, target, retry, current, onReady, onStartError }: {
  service: DetailService;
  target: DetailTarget;
  retry: boolean;
  current: () => boolean;
  onReady: (item: MediaItem) => void;
  onStartError: (message: string) => void;
}): Promise<void> {
  if (!current()) return;
  try {
    if (retry) {
      const selected = service.getSnapshot().target;
      if (selected?.itemId !== target.itemId || selected.libraryId !== target.libraryId) {
        onStartError('These details are no longer selected. Go back and open the item again.');
        return;
      }
    }
    const pending = retry ? service.retryRead() : service.select(target);
    const generation = service.getSnapshot().generation;
    await pending;
    if (!current()) return;
    const state = service.getSnapshot();
    if (state.generation === generation && state.phase === 'ready' &&
        state.target?.itemId === target.itemId && state.target.libraryId === target.libraryId &&
        state.data?.item.id === target.itemId) onReady(state.data.item);
  } catch {
    if (current()) onStartError('Details could not be opened. Go back and try this item again.');
  }
}

/** Cancel a pending open synchronously when its origin or actual viewer changes. */
export function observeNativeDetailOpen({ navigation, viewer, getOpen, onCancel }: {
  navigation: Pick<LibraryNavigationService, 'subscribe' | 'getSnapshot'>;
  viewer: Pick<ViewerService, 'subscribe' | 'getSnapshot'>;
  getOpen: () => NativeDetailOpen | null;
  onCancel: () => void;
}): () => void {
  const changed = () => {
    const pending = getOpen();
    if (pending && (pending.viewerOwner !== detailViewerOwner(viewer.getSnapshot()) ||
      pending.originRoute !== JSON.stringify(navigation.getSnapshot().route))) onCancel();
  };
  const stopNavigation = navigation.subscribe(changed);
  const stopViewer = viewer.subscribe(changed);
  return () => { stopNavigation(); stopViewer(); };
}
