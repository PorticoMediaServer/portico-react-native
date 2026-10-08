import {useSyncExternalStore} from 'react';

/**
 * X-02: whether the server can render audio effects for what's playing now, for Settings to say
 * why quietly when it can't (the owner doesn't allow converting audio, a file with several audio
 * streams). The player engine publishes it; undefined when nothing playing tells.
 */
export type AudioRenderAvailability = Readonly<{available: boolean; reason?: string}> | undefined;

let current: AudioRenderAvailability;
const listeners = new Set<() => void>();

export function publishAudioRenderAvailability(next: AudioRenderAvailability) {
  if (current?.available === next?.available && current?.reason === next?.reason) return;
  current = next;
  for (const listener of listeners) listener();
}

export function useAudioRenderAvailability(): AudioRenderAvailability {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
}
