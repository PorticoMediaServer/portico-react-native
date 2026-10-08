import {useSyncExternalStore} from 'react';
import type {EventsClient} from '../../../../packages/client-core/src/playback-v1/events';

/**
 * MU2: this device's one event feed, reachable from anywhere. The native
 * playback stack publishes it (`bridge/useNativePlayback`); the rail reads it
 * through `app/library-scan`. Never create a second `EventsClient`.
 */
let current: EventsClient | null = null;
const listeners = new Set<() => void>();

export function setDeviceEvents(events: EventsClient | null): void {
  if (current === events) return;
  current = events;
  for (const listener of [...listeners]) listener();
}

/** The feed for the cleanup guard in `bridge/useNativePlayback`. */
export function getDeviceEvents(): EventsClient | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EventsClient | null {
  return current;
}

export function useDeviceEvents(): EventsClient | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
