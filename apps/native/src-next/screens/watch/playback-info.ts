import {playbackInfoProjection, type PlaybackComparisonProjection, type PlaybackInfoWords} from '../../../../../packages/client-core/src/playback-info-projection';
import {playbackFence, sameFence, type PlaybackFence, type QueuePlaybackFence} from '../../../../../packages/player-core/src';
import type {NativePlaybackAdapter, NativePlaybackReadLifetime} from '../../platform/playback/types';

export type NativePlaybackInfo = Readonly<{
  fence: QueuePlaybackFence;
  revision: string;
  comparison: PlaybackComparisonProjection;
}>;

/** A data read for the existing player. It owns no panel state, cache, clock or
 * renderer; committed and observed facts remain separate canonical inputs. */
export async function readNativePlaybackInfo(
  playback: Pick<NativePlaybackAdapter, 'getSnapshot' | 'readSession'>,
  fence: PlaybackFence,
  words: PlaybackInfoWords,
  lifetime: NativePlaybackReadLifetime,
): Promise<NativePlaybackInfo | undefined> {
  const read = playback.readSession;
  if (!read || fence.kind !== 'queue') return;
  const captured = playbackFence(fence);
  if (captured.kind !== 'queue') return;
  const current = () => {
    const source = playback.getSnapshot();
    return !lifetime.signal.aborted && lifetime.isCurrent() && !source.retired
      && sameFence(source.fence, captured) && sameFence(source.dock.local?.fence, captured);
  };
  if (!current()) return;
  try {
    const session = await read(captured, lifetime);
    if (!current() || !session?.playbackInfo || session.kind !== 'vod' || session.role !== 'local' || session.end || session.state === 'ended'
      || session.id !== captured.sessionId || session.itemId !== captured.itemId || session.versionId !== captured.sourceId
      || session.presentation.generation !== captured.generation || session.queue?.entryId !== captured.entryId) return;
    const comparison = playbackInfoProjection(session.playbackInfo, session.observedPlayback, words);
    if (!current()) return;
    return Object.freeze({fence: captured, revision: session.revision, comparison});
  } catch (error) {
    if (!current()) return;
    throw error;
  }
}
