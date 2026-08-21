import {useSyncExternalStore} from 'react';
import type {ProductMessageId} from '@portico/client-core';

export interface RuntimeNotice {
  id: string;
  messageId: ProductMessageId;
  createdAt: string;
  severity: 'info' | 'warning' | 'error';
}

const notices = new Map<string, RuntimeNotice>();
const listeners = new Set<() => void>();
let snapshot: readonly RuntimeNotice[] = [];

function publishSnapshot() {
  snapshot = [...notices.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  for (const listener of listeners) listener();
}

/**
 * Records a recoverable device/runtime event without interrupting the active
 * viewer surface. The stable id is also its deduplication key, so a retry loop
 * updates one notice instead of flooding the inbox.
 */
export function publishRuntimeNotice(
  id: string,
  messageId: ProductMessageId,
  severity: RuntimeNotice['severity'] = 'warning',
): void {
  notices.set(id, {
    id,
    messageId,
    severity,
    createdAt: new Date().toISOString(),
  });
  publishSnapshot();
}

export function dismissRuntimeNotice(id: string): void {
  if (!notices.delete(id)) return;
  publishSnapshot();
}

export function clearRuntimeNotice(id: string): void {
  dismissRuntimeNotice(id);
}

export function useRuntimeNotices(): readonly RuntimeNotice[] {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export const runtimeNoticeTestHooks = {
  clear() {
    notices.clear();
    publishSnapshot();
  },
  snapshot: () => snapshot,
};
