import type {LocalSession, PlaybackApi, PlaybackSession} from '../../../../../packages/client-core/src/index';
import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import {localPlaybackFence, type LocalPlaybackFence} from '../../../../../packages/player-core/src';
import {isLocalSession, LocalPlayback, type LocalMedia, type LocalProgress} from '../../../platform/local-playback';
import type {OfflineDownloads, OfflineEntry} from '../../../platform/offline-downloads';

/** Captured from the genuine installation session, never a server queue/controller scope. */
export type NativeOfflineOwner = Readonly<Pick<LocalSession['viewer'], 'authority' | 'serverId' | 'accountId' | 'profileId'> & {sessionFamilyId: string}>;
export type NativeOfflineSource = Readonly<{
  owner: NativeOfflineOwner; entryId: string; itemId: string; preparationId: string;
  artifact: Readonly<{sha256: string; bytes: number}>; media: LocalMedia;
  session: () => PlaybackSession;
  /** Owner, artifact and receipt validity, independent of the screen that opened the file. */
  current: () => boolean;
}>;
type Device = Pick<OfflineDownloads, 'getSnapshot' | 'localMedia' | 'playabilityReason' | 'recordProgress'>;
const ownerKey = (owner: NativeOfflineOwner) => JSON.stringify([owner.authority, owner.serverId, owner.accountId, owner.profileId, owner.sessionFamilyId]);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const unavailable = () => new Error(serviceText('downloads.offline.notPlayableHere'));

/** Admission and journal routing for the existing local playback path. This creates neither
 * another player nor another store. Only a verified current-owner artifact can supply a file. */
export class NativeOfflinePlayback {
  private readonly local: LocalPlayback;
  private readonly session: () => LocalSession | undefined;
  private readonly device: Device;
  private readonly sessions = new Map<string, {source: NativeOfflineSource; media: LocalMedia; sessionId: string; generation: number; sequence: number}>();
  private disposed = false;
  constructor(session: () => LocalSession | undefined, device: Device) {
    this.session = session;
    this.device = device;
    this.local = new LocalPlayback(progress => this.progress(progress));
  }
  owner(): NativeOfflineOwner | undefined {
    const session = this.session(), viewer = session?.viewer;
    if (!session || !viewer || !['local', 'hosted'].includes(viewer.authority)
      || ![viewer.serverId, viewer.accountId, viewer.profileId, session.sessionFamilyId].every(text)) return;
    return Object.freeze({authority: viewer.authority, serverId: viewer.serverId, accountId: viewer.accountId, profileId: viewer.profileId, sessionFamilyId: session.sessionFamilyId});
  }
  wrap(api: PlaybackApi): PlaybackApi {
    const wrapped = this.local.wrap(api);
    return {...wrapped, progressPlayback: (id, payload) => {
      // A retry keeps one journal play but creates a new real local session.
      // Its retired session must not overwrite the new session's observation.
      if (isLocalSession(id)) {
        const held = [...this.sessions.values()].find(value => value.sessionId === id && value.generation === payload.generation);
        if (!held || !held.source.current() || !Number.isSafeInteger(payload.sequence) || payload.sequence <= held.sequence) return Promise.resolve();
        held.sequence = payload.sequence;
      }
      return wrapped.progressPlayback(id, payload);
    }};
  }
  /** Only an actual admitted session can publish the local identity used by the
   * existing dock and controls. Paths and receipt payloads stay app-private. */
  fence(session: PlaybackSession, run: number): LocalPlaybackFence | undefined {
    const held = [...this.sessions.values()].find(value => value.sessionId === session.id && value.generation === session.generation);
    if (!held || session.mode !== 'local' || session.streamUrl !== held.media.fileUrl || !held.source.current()) return;
    const {source, media} = held;
    try {
      return localPlaybackFence({kind: 'local', playback: {kind: 'local', scope: source.owner, run},
        sessionId: session.id, generation: session.generation, itemId: source.itemId,
        entryId: source.entryId, playId: media.playId, artifact: source.artifact});
    } catch { return; }
  }
  async prepare(entry: OfflineEntry, isCurrent: () => boolean): Promise<NativeOfflineSource> {
    const owner = this.owner(), claims = entry.receipt?.claims;
    if (!owner || !claims || !text(entry.id) || !text(entry.itemId) || claims.itemId !== entry.itemId
      || !text(claims.preparationId) || !/^[a-f0-9]{64}$/.test(claims.artifact.sha256)
      || !Number.isSafeInteger(claims.artifact.bytes) || claims.artifact.bytes < 1) throw unavailable();
    const artifact = Object.freeze({...claims.artifact}), preparationId = claims.preparationId;
    const currentEntry = (): OfflineEntry | undefined => {
      const currentOwner = this.owner();
      if (this.disposed || !currentOwner || ownerKey(currentOwner) !== ownerKey(owner)) return;
      const matches = this.device.getSnapshot().entries.filter(value => value.id === entry.id);
      if (matches.length !== 1) return;
      const live = matches[0]!, receipt = live.receipt?.claims;
      if (!receipt || live.itemId !== entry.itemId || receipt.itemId !== entry.itemId || receipt.preparationId !== preparationId
        || receipt.artifact.sha256 !== artifact.sha256 || receipt.artifact.bytes !== artifact.bytes
        || (['authority', 'serverId', 'accountId', 'profileId'] as const).some(key => receipt.viewer[key] !== owner[key])
        || this.device.playabilityReason(live) !== null) return;
      return live;
    };
    const before = currentEntry();
    if (!isCurrent() || !before) throw unavailable();
    const media = await this.device.localMedia(before);
    if (!isCurrent() || !currentEntry() || media.entryId !== entry.id || media.itemId !== entry.itemId || !text(media.playId)
      || !Number.isFinite(media.durationSeconds) || media.durationSeconds < 0 || !Number.isFinite(media.startSeconds) || media.startSeconds < 0) throw unavailable();
    let url: URL;
    try { url = new URL(media.fileUrl); } catch { throw unavailable(); }
    if (url.protocol !== 'file:' || url.hostname !== '' || !url.pathname.startsWith('/') || url.search || url.hash) throw unavailable();
    const make = this.local.session(media);
    const source: NativeOfflineSource = Object.freeze({owner, entryId: entry.id, itemId: entry.itemId, preparationId, artifact, media,
      current: () => !!currentEntry(),
      session: () => {
        if (!isCurrent() || !currentEntry()) throw unavailable();
        const session = make();
        this.sessions.set(media.playId, {source, media, sessionId: session.id, generation: session.generation, sequence: 0});
        while (this.sessions.size > 16) this.sessions.delete(this.sessions.keys().next().value!);
        return session;
      },
    });
    return source;
  }
  private progress(progress: LocalProgress): void {
    const held = this.sessions.get(progress.playId);
    if (!held || held.media.entryId !== progress.entryId || held.media.itemId !== progress.itemId || !held.source.current()) return;
    this.device.recordProgress(progress);
  }
  dispose(): void { this.disposed = true; this.sessions.clear(); }
}
