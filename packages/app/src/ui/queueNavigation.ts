export interface QueueIdentity {
  id: string;
}

export interface WatchGroupQueueIdentity {
  mediaId: string;
}

/** A queue may intentionally contain the same media more than once. */
export function queueOccurrenceKey(
  panel: string,
  index: number,
  mediaId: string,
): string {
  return `${panel}-${index}-${mediaId}`;
}

export function promoteQueueItem(
  items: ReadonlyArray<QueueIdentity>,
  index: number,
): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= items.length)
    return items.map(item => item.id);
  const ids = items.map(item => item.id);
  const [selected] = ids.splice(index, 1);
  if (selected) ids.unshift(selected);
  return ids;
}

export function watchGroupUpcomingItems<T extends WatchGroupQueueIdentity>(
  items: ReadonlyArray<T>,
  currentMediaId: string,
  repeatMode: 'none' | 'one' | 'all',
): T[] {
  if (repeatMode === 'one') return [];
  const currentIndex = items.findIndex(item => item.mediaId === currentMediaId);
  if (currentIndex < 0)
    return items.filter(item => item.mediaId !== currentMediaId);
  const after = items.slice(currentIndex + 1);
  return repeatMode === 'all'
    ? [...after, ...items.slice(0, currentIndex)]
    : after;
}

export function promoteWatchGroupItemAfterCurrent(
  items: ReadonlyArray<WatchGroupQueueIdentity>,
  currentMediaId: string,
  selectedMediaId: string,
): string[] {
  const ids = items.map(item => item.mediaId);
  const currentIndex = ids.indexOf(currentMediaId);
  const selectedIndex = ids.indexOf(selectedMediaId);
  if (
    currentIndex < 0 ||
    selectedIndex < 0 ||
    currentMediaId === selectedMediaId
  )
    return ids;
  ids.splice(selectedIndex, 1);
  const nextCurrentIndex = ids.indexOf(currentMediaId);
  ids.splice(nextCurrentIndex + 1, 0, selectedMediaId);
  return ids;
}
