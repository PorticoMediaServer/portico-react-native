import type {ApplePlaybackState} from '@portico-react-native/player';

type RequestedPlaybackStart = {startSeconds?: number; versionId?: string};

const requestedPlaybackStarts = new Map<string, RequestedPlaybackStart>();
export const PLAYBACK_START_TIMEOUT_MS = 30_000;

export function playbackRequestId(operation: string): string {
  return `rn-${operation}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function playerChromeMustRemainVisible(input: {
  ended: boolean;
  hasError: boolean;
  panelOpen: boolean;
  state: ApplePlaybackState;
}): boolean {
  return input.ended || input.hasError || input.panelOpen || input.state !== 'playing';
}

export function requestPlaybackStart(mediaId: string, request?: number | RequestedPlaybackStart): void {
  if (request === undefined) requestedPlaybackStarts.delete(mediaId);
  else {
    const normalized = typeof request === 'number'
      ? {startSeconds: Math.max(0, request)}
      : {
          ...(request.startSeconds === undefined ? {} : {startSeconds: Math.max(0, request.startSeconds)}),
          ...(request.versionId?.trim() ? {versionId: request.versionId.trim()} : {}),
        };
    requestedPlaybackStarts.set(mediaId, normalized);
    setTimeout(() => {
      if (requestedPlaybackStarts.get(mediaId) === normalized) requestedPlaybackStarts.delete(mediaId);
    }, 30_000);
  }
}

export function takeRequestedPlaybackStart(mediaId: string): RequestedPlaybackStart | undefined {
  const value = requestedPlaybackStarts.get(mediaId);
  requestedPlaybackStarts.delete(mediaId);
  return value;
}

export function shuffledQueueMediaIds(
  items: ReadonlyArray<{id: string}>,
  random: () => number = Math.random,
): string[] {
  const original = items.map(item => item.id);
  const shuffled = [...original];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  if (shuffled.length > 1 && shuffled.every((mediaId, index) => mediaId === original[index])) {
    shuffled.push(shuffled.shift()!);
  }
  return shuffled;
}
