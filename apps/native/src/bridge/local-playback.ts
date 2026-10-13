import type {PlaybackApi, PlaybackSession} from '../../../../packages/client-core/src/index';
import type {OfflineExtras} from './offline-downloads';

export type LocalMedia = Readonly<{
  /** The download entry, for the offline journal. */
  entryId: string;
  itemId: string;
  /** Names this play in the offline journal: one id for as long as the file stays open. */
  playId: string;
  /** What came with the download: its description, chapters, skip markers and audio tracks, and
   * its subtitle tracks as files on this device. */
  extras?: OfflineExtras;
  /** `file://` URL of the downloaded file. */
  fileUrl: string;
  durationSeconds: number;
  startSeconds: number;
}>;
export type LocalProgress = Readonly<{entryId: string; itemId: string; playId: string; positionSeconds: number; durationSeconds: number; state: 'playing' | 'paused' | 'ended'; ended: boolean}>;

export const LOCAL_SESSION_PREFIX = 'local:';
export const isLocalSession = (id: string | undefined): boolean => !!id && id.startsWith(LOCAL_SESSION_PREFIX);
export const isLocalSource = (url: string | undefined): boolean => !!url && url.startsWith('file://');

/**
 * OS-07: a downloaded title plays in Portico's own player. `PlaybackService.playLocal` takes the
 * session this makes (a file inside the app's Downloads folder, which the native controller
 * accepts) instead of asking the server for one; the API wrapper keeps that session's progress and
 * stop on the device: no queue, no server session, no network. Everything else passes through to
 * the server API unchanged.
 */
export class LocalPlayback {
  private sessions = new Map<string, LocalMedia>();
  private seq = 0;
  private readonly sink: (progress: LocalProgress) => void;
  constructor(sink: (progress: LocalProgress) => void) { this.sink = sink; }

  /** A maker of local sessions for `media` (a fresh id each call: a retry is a new session). */
  session(media: LocalMedia): () => PlaybackSession {
    if (!isLocalSource(media.fileUrl)) throw new Error('A local title needs a file on this device.');
    return () => {
      const id = `${LOCAL_SESSION_PREFIX}${media.entryId}:${++this.seq}`;
      this.sessions.set(id, media);
      while (this.sessions.size > 16) this.sessions.delete(this.sessions.keys().next().value!);
      return {id, generation: 1, streamUrl: media.fileUrl, mode: 'local', duration: media.durationSeconds, resumeSeconds: media.startSeconds};
    };
  }

  wrap(inner: PlaybackApi): PlaybackApi {
    const local = (id: string) => this.sessions.get(id);
    return {
      createPlayback: (itemId, requestId, signal) => inner.createPlayback(itemId, requestId, signal),
      progressPlayback: (id, payload) => {
        if (!isLocalSession(id)) return inner.progressPlayback(id, payload);
        // A local id never reaches the server, even one replayed from the journal after a restart
        // (its file mapping is gone then, and the offline journal already holds its position).
        const media = local(id);
        if (!media) return Promise.resolve();
        this.sink({entryId: media.entryId, itemId: media.itemId, playId: media.playId, positionSeconds: Math.max(0, payload.positionSeconds), durationSeconds: media.durationSeconds, state: payload.state, ended: payload.state === 'ended'});
        return Promise.resolve();
      },
      stopPlayback: (id, signal) => {
        // The mapping stays (bounded) so a checkpoint flushed after the stop is still recorded.
        return isLocalSession(id) ? Promise.resolve() : inner.stopPlayback(id, signal);
      },
      ...(inner.reportRouteFailure ? {reportRouteFailure: (id: string, code: Parameters<NonNullable<PlaybackApi['reportRouteFailure']>>[1], detail: string) => (isLocalSession(id) ? Promise.resolve(null) : inner.reportRouteFailure!(id, code, detail))} : {}),
      ...(inner.onServerEnded ? {onServerEnded: (listener: Parameters<NonNullable<PlaybackApi['onServerEnded']>>[0]) => inner.onServerEnded!(listener)} : {}),
    };
  }
}
