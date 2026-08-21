export interface PlayerQueueHistoryEntry {
  mediaId: string;
  title: string;
}

/** Session-local item history. Seek-to-start is deliberately not a previous-item fallback. */
export class PlayerQueueHistory {
  private entries: PlayerQueueHistoryEntry[] = [];

  get canPrevious(): boolean { return this.entries.length > 0; }

  peek(): PlayerQueueHistoryEntry | undefined { return this.entries[this.entries.length - 1]; }

  push(entry: PlayerQueueHistoryEntry): void {
    if (!entry.mediaId || this.peek()?.mediaId === entry.mediaId) return;
    this.entries.push(entry);
  }

  commitPrevious(expectedMediaId: string): PlayerQueueHistoryEntry | undefined {
    if (this.peek()?.mediaId !== expectedMediaId) return undefined;
    return this.entries.pop();
  }

  clear(): void { this.entries = []; }
}

export function queueAfterReturningToPrevious(currentMediaId: string, upcomingIds: readonly string[]): string[] {
  return [currentMediaId, ...upcomingIds.filter(id => id !== currentMediaId)];
}
