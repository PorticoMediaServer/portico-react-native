export interface CursorPageState {
  hasMore: boolean;
  nextCursor?: string;
}

export function cursorPageState(pageInfo: {hasMore: boolean; nextCursor?: string | null}): CursorPageState {
  return {
    hasMore: pageInfo.hasMore && Boolean(pageInfo.nextCursor),
    nextCursor: pageInfo.nextCursor ?? undefined,
  };
}

export function mergeUniqueById<T extends {id: string}>(...pages: readonly T[][]): T[] {
  const merged = new Map<string, T>();
  for (const page of pages) {
    for (const item of page) {
      if (!merged.has(item.id)) merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}
