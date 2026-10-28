/** Completion for device-only delete-watched/auto-next rules. A near-end stop
 * may count as finished, but only an actual ended event resets its resume point. */
export function offlineCompletion(kind: string | undefined, positionSeconds: number, durationSeconds: number, ended: boolean): Readonly<{finished: boolean; resumeSeconds: number}> {
  let finished = ended;
  if (!finished && Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(positionSeconds)) {
    if (kind === 'song' || kind === 'track' || kind === 'audiobook_file' || kind === 'audiobook') {
      finished = positionSeconds >= durationSeconds - Math.min(30, durationSeconds / 20);
    } else if (kind === 'movie' || kind === 'episode' || kind === 'extra') {
      finished = positionSeconds / durationSeconds >= 0.92;
    }
  }
  return {finished, resumeSeconds: ended ? 0 : positionSeconds};
}
