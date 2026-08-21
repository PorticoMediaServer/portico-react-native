export type PlayerTimelineRemoteEvent = 'left' | 'right' | string;

export function boundedPlayerPosition(position: number, duration: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, position));
}

export function playerTimelineRemoteDelta(eventType: PlayerTimelineRemoteEvent, intervalSeconds: number): number | undefined {
  const interval = Math.max(1, Math.abs(intervalSeconds));
  if (eventType === 'left') return -interval;
  if (eventType === 'right') return interval;
  return undefined;
}

export function playerTimelinePressTarget(locationX: number, width: number, duration: number): number | undefined {
  if (!(width > 0) || !(duration > 0) || !Number.isFinite(locationX)) return undefined;
  return boundedPlayerPosition((locationX / width) * duration, duration);
}
