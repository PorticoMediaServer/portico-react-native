import type {PlaybackService} from '../../../../packages/client-core/src/index';

/**
 * The Player setting changed and the server now holds it: the title on screen is planned again
 * for it, in place. It stays the same session on the same queue entry, so Up Next, the version,
 * the quality, the audio and subtitle choices, a pause and the position (which the session change
 * carries from the engine's last report) are all kept. A download or a channel has no plan to
 * change: nothing is sent for one.
 */
export function replanEngine(playback: Pick<PlaybackService, 'changesInPlace' | 'changePlayback'>): Promise<void> {
  if (!playback.changesInPlace()) return Promise.resolve();
  return playback.changePlayback({replan: true});
}
