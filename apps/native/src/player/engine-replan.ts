import type {PlaybackService} from '../../../../packages/client-core/src/index';

/** Reopen the current queue entry with the newly published engine preference. check() retains
 * the queue and position; play() would create a new queue containing only this title. Pause
 * immediately after the new intent starts so adoption keeps it, while a later viewer resume
 * remains authoritative. */
export async function replanEngine(
  playback: Pick<PlaybackService, 'getSnapshot' | 'pause'>,
  queue: Readonly<{check(retryUnknown?: boolean): Promise<void>}>,
): Promise<void> {
  const paused = playback.getSnapshot().intent === 'paused';
  const pending = queue.check(true);
  if (paused) playback.pause();
  await pending;
}
