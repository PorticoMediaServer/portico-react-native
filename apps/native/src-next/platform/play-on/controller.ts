import {playbackControlsService} from '../../../../../packages/client-core/src/playback-controls';
import {HandoffController, type HandoffPhase, type HandoffSnapshot, type Receiver} from '../../../../../packages/client-core/src/remote-playback';
import type {LocalSession} from '../../../../../packages/client-core/src/index';
import {sameFence, type DockPlayback, type PlaybackFence, type RemoteDock} from '../../../../../packages/player-core/src';
import type {NativePlaybackAdapter} from '../playback/types';

/** Play on, natively: the Portico devices this profile may send to, the handoff that
 * moves this phone's playback to one of them, and the remote that follows it after.
 *
 * Every fact is the server's or the receiving device's own: the directory comes from
 * `GET /v1/receivers`, the takeover only counts once the television proves it is
 * playing, and the position and controls the remote shows are read from the playing
 * device through `GET /v1/playback/controls`. AirPlay and Google Cast need platform
 * transports this app does not install, so they are not offered.
 *
 * One send is one attempt with its own connection id: the initiating dock playback,
 * fence, authority and session are captured before any await and checked again before
 * every write and after every answer. A control from a retained attempt can never act
 * on a later one, and a late poll can never publish over a successor. */

export type PlayOnRemote = Readonly<{
  id: string;
  device: string;
  title?: string;
  positionSeconds: number;
  durationSeconds: number;
  playing: boolean;
  stopped: boolean;
  /** Only what the playing device's own report allows; nothing before the first report. */
  allows: Readonly<Record<'pause' | 'resume' | 'seek' | 'stop', boolean>>;
}>;

export type PlayOnSnapshot = Readonly<{
  open: boolean;
  receivers: readonly Receiver[];
  directoryPhase: HandoffSnapshot['directoryPhase'];
  directoryError?: string;
  phase: HandoffPhase;
  message?: string;
  target?: Receiver;
  sending: boolean;
  remote?: PlayOnRemote;
  /** The full remote is open (the dock's bar opened it). */
  remoteOpen: boolean;
  /** A failed attempt's text stays on the sheet until the next one. */
  error?: string;
}>;

type Options = Readonly<{
  api: Readonly<{request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}>;
  session: () => LocalSession | undefined;
  deviceName: () => string;
  playback: () => NativePlaybackAdapter | undefined;
  current: () => boolean;
  reportError: (error: unknown) => void;
}>;

const POLL_MS = 5000;
const STOPPED_CLEAR_MS = 15_000;
const wire = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
const cancelled = () => Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});
const NONE = Object.freeze({pause: false, resume: false, seek: false, stop: false});

export class NativePlayOn {
  private readonly options: Options;
  private readonly listeners = new Set<() => void>();
  private controller?: HandoffController;
  private timer?: ReturnType<typeof setInterval>;
  private sequence = 0;
  private attempt = 0;
  private connection?: string;
  private fence?: PlaybackFence;
  private local?: DockPlayback;
  private receiverPlaybackId?: string;
  private polling = false;
  private disposed = false;
  private state: PlayOnSnapshot = Object.freeze({open: false, receivers: [], directoryPhase: 'idle', phase: 'idle', sending: false, remoteOpen: false});

  private off?: () => void;
  constructor(options: Options) {
    this.options = options;
    // Another surface may end the remote first (Continue here on the bar, Dismiss,
    // or the dock's own expiry); the controller follows the dock, never the reverse.
    this.off = options.playback()?.subscribe(() => {
      const remote = options.playback()?.getSnapshot().dock.remote;
      if (this.state.remote && (!remote || remote.id !== this.state.remote.id)) this.clearRemote();
    });
  }

  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = (): PlayOnSnapshot => this.state;
  private publish(patch: Partial<PlayOnSnapshot>): void {
    if (this.disposed) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  /** True only for the attempt that is still the one on screen. */
  private bound(attempt: number, connection?: string, receiverPlaybackId?: string): boolean {
    return !this.disposed && this.attempt === attempt && this.options.current()
      && (connection === undefined || this.connection === connection)
      && (receiverPlaybackId === undefined || this.receiverPlaybackId === receiverPlaybackId);
  }

  private handoff(): HandoffController | undefined {
    if (this.disposed || !this.options.current()) return undefined;
    return this.controller;
  }

  /** The directory belongs to the app, not to one attempt: its answers always fill the sheet. */
  private follow(snapshot: HandoffSnapshot): void {
    const patch: Partial<PlayOnSnapshot> = {receivers: snapshot.receivers, directoryPhase: snapshot.directoryPhase,
      ...(snapshot.directoryError ? {directoryError: snapshot.directoryError} : {}), phase: snapshot.phase,
      ...(snapshot.message ? {message: snapshot.message} : {}), ...(snapshot.target ? {target: snapshot.target} : {})};
    this.publish(patch);
  }

  open = (): boolean => {
    if (this.disposed || !this.options.current()) return false;
    const session = this.options.session();
    if (!this.controller && session?.deviceId) {
      const controller = new HandoffController({
        api: {request: (path, method, body, signal) => this.request(path, method, body, signal)},
        device: {deviceId: session.deviceId, displayName: this.options.deviceName()},
        requestId: () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      });
      const stop = controller.subscribe(() => this.follow(controller.getSnapshot()));
      this.controller = controller;
      this.offController = stop;
    }
    if (!this.controller) return false;
    this.publish({open: true, error: undefined});
    void this.controller.refresh().catch(error => {if (this.options.current()) this.options.reportError(error);});
    return true;
  };
  private offController?: () => void;

  close = (): void => {
    if (!this.state.open) return;
    this.publish({open: false});
    if (this.state.phase !== 'done') this.controller?.cancel();
  };

  /** A request from the attempt that started it: the identity captured at send is checked
   * before and after every call, so a replaced authority/session cannot continue one. */
  private async request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const attempt = this.attempt, connection = this.connection, session = this.options.session();
    const authority = this.options.playback()?.getSnapshot().authority;
    const same = () => this.bound(attempt, connection) && this.options.session() === session
      && sameAuthority(this.options.playback()?.getSnapshot().authority, authority);
    if (!same()) throw cancelled();
    const value = await this.options.api.request<T>(path, method, body, signal);
    if (!same()) throw cancelled();
    return value;
  }

  /** Moves this phone's playback to the receiver. The statement of what is playing is
   * this device's own, captured before the handoff starts; a replacement dock playback
   * is never stopped and its title is never restored. */
  send = async (receiver: Receiver): Promise<void> => {
    const playback = this.options.playback(), session = this.options.session();
    if (!playback || !session) return;
    const snapshot = playback.getSnapshot(), fence = snapshot.fence, local = snapshot.dock.local;
    if (!fence || fence.kind !== 'queue' || snapshot.playback.phase !== 'ready' || !local || !sameFence(local.fence, fence)) return;
    if (!this.open()) return;
    const attempt = ++this.attempt;
    const connection = `playon_${wire(receiver.id)}_${attempt.toString(36)}${Date.now().toString(36)}`;
    this.stopPolling();
    this.connection = connection; this.fence = fence; this.local = Object.freeze({...local, playing: false, expanded: false});
    this.receiverPlaybackId = undefined;
    this.publish({sending: true, message: undefined, error: undefined, phase: 'asking', target: receiver});
    const playing = await this.controller!.send(receiver, {playbackId: fence.sessionId, positionSeconds: snapshot.playback.positionSeconds}).catch(error => {
      if (this.bound(attempt, connection)) this.options.reportError(error);
      return false;
    });
    // A stale predecessor belongs to an older attempt; it must not cancel the new one.
    if (!this.bound(attempt, connection)) return;
    const now = playback.getSnapshot(), stillLocal = now.dock.local;
    if (!playing || !stillLocal || !sameFence(stillLocal.fence, fence)) {
      this.publish({sending: false, phase: playing ? 'idle' : 'failed', open: true,
        error: playing ? undefined : this.state.message ?? 'playOn.notReachable'});
      return;
    }
    this.receiverPlaybackId = this.controller!.getSnapshot().receiverPlaybackId;
    const entry = now.entry;
    this.publish({open: false, sending: false, message: this.controller!.getSnapshot().message, target: receiver, error: undefined,
      remote: {id: connection, device: receiver.displayName, title: entry?.displayTitle ?? entry?.title,
        positionSeconds: snapshot.playback.positionSeconds, durationSeconds: snapshot.playback.duration,
        playing: true, stopped: false, allows: NONE}});
    await this.push('playing', true, attempt, connection);
    this.startPolling(attempt, connection);
  };

  /** The dock's bar for this attempt only. The captured initiating playback is the
   * occupant's identity; nothing here reads a later dock.local. */
  private async push(phase: RemoteDock['phase'], initial: boolean, attempt = this.attempt, connection = this.connection): Promise<void> {
    const adapter = this.options.playback(), fence = this.fence, local = this.local, remote = this.state.remote;
    if (!adapter || !fence || !local || !remote || !this.bound(attempt, connection)) return;
    const value: RemoteDock = Object.freeze({id: remote.id, kind: 'play-on', phase, sequence: String(++this.sequence),
      positionSeconds: Math.max(0, remote.positionSeconds), playback: Object.freeze({...local, positionSeconds: Math.max(0, remote.positionSeconds), playing: remote.playing, expanded: false})});
    try {
      if (initial) await adapter.beginRemote?.(value);
      else await adapter.updateRemote?.(value);
    } catch (error) {if (this.bound(attempt, connection)) this.options.reportError(error);}
  }

  private startPolling(attempt: number, connection: string): void {
    this.stopPolling();
    this.timer = setInterval(() => {void this.poll(attempt, connection);}, POLL_MS);
    void this.poll(attempt, connection);
  }
  private stopPolling(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer); this.timer = undefined;
  }

  /** The playing device's own account of itself. One poll at a time, fenced by the
   * attempt and the receiver playback id it started with. */
  private async poll(attempt: number, connection: string): Promise<void> {
    const controller = this.controller, sessionId = this.receiverPlaybackId;
    if (this.polling || !controller || !sessionId || !this.bound(attempt, connection, sessionId)) return;
    this.polling = true;
    try {
      const session = await controller.refreshRemote();
      if (!this.bound(attempt, connection, sessionId)) return;
      const page = await playbackControlsService(<T,>(path: string, method?: string, body?: unknown) => this.options.api.request<T>(path, method, body)).remote();
      if (!this.bound(attempt, connection, sessionId)) return;
      const report = page.items.find(item => item.sessionId === sessionId);
      const current = this.state.remote;
      if (!report || !current) {
        // No report is not a grant: every control stays off until the device answers.
        if (current) this.publish({remote: {...current, allows: NONE}});
        return;
      }
      const stopped = !session || report.state === 'ended';
      const allows = {pause: report.actions.includes('pause'), resume: report.actions.includes('resume'),
        seek: report.actions.includes('seek'), stop: report.actions.includes('stop')};
      this.publish({remote: {...current, positionSeconds: Math.max(0, report.positionMs / 1000),
        durationSeconds: report.durationMs ? report.durationMs / 1000 : current.durationSeconds, playing: report.state === 'playing' && !stopped,
        stopped, allows, ...(report.item?.title ? {title: report.item.title} : {}), ...(report.device.name ? {device: report.device.name} : {})}});
      if (stopped) {this.stopPolling(); await this.push('stopped', false, attempt, connection);}
      else await this.push('playing', false, attempt, connection);
    } catch (error) {
      const current = this.state.remote;
      if (this.bound(attempt, connection, sessionId)) {
        if (current) this.publish({remote: {...current, allows: NONE}});
        this.options.reportError(error);
      }
    } finally {this.polling = false;}
  }

  private remoteBound(remoteId?: string): boolean {
    return !!remoteId && remoteId === this.connection && !this.disposed && this.options.current();
  }
  pause = async (remoteId?: string): Promise<void> => {const controller = this.controller; if (!controller || !this.remoteBound(remoteId)) return;
    const attempt = this.attempt, connection = this.connection, sessionId = this.receiverPlaybackId;
    await controller.pause().catch(() => {});
    if (this.bound(attempt, connection, sessionId)) await this.poll(attempt, connection);};
  resume = async (remoteId?: string): Promise<void> => {const controller = this.controller; if (!controller || !this.remoteBound(remoteId)) return;
    const attempt = this.attempt, connection = this.connection, sessionId = this.receiverPlaybackId;
    await controller.play().catch(() => {});
    if (this.bound(attempt, connection, sessionId)) await this.poll(attempt, connection);};
  startOver = async (remoteId?: string): Promise<void> => {const controller = this.controller; if (!controller || !this.remoteBound(remoteId)) return;
    const attempt = this.attempt, connection = this.connection, sessionId = this.receiverPlaybackId;
    await controller.seek(0).catch(() => {});
    if (this.bound(attempt, connection, sessionId)) await this.poll(attempt, connection);};
  skip = async (deltaSeconds: number, remoteId?: string): Promise<void> => {
    const controller = this.controller, remote = this.state.remote;
    if (!controller || !remote || !this.remoteBound(remoteId) || !Number.isFinite(deltaSeconds)) return;
    const attempt = this.attempt, connection = this.connection, sessionId = this.receiverPlaybackId;
    const target = Math.max(0, Math.min(remote.durationSeconds || Number.POSITIVE_INFINITY, remote.positionSeconds + deltaSeconds));
    await controller.seek(target).catch(() => {});
    if (this.bound(attempt, connection, sessionId)) await this.poll(attempt, connection);
  };
  stop = async (remoteId?: string): Promise<void> => {
    const controller = this.controller;
    if (!controller || !this.remoteBound(remoteId)) return;
    // While it is still asking or preparing, Stop cancels the request: nothing has moved.
    if (controller.getSnapshot().phase !== 'done') {this.attempt++; controller.cancel(); this.publish({sending: false, phase: 'idle', message: undefined}); return;}
    const attempt = this.attempt, connection = this.connection, sessionId = this.receiverPlaybackId;
    const accepted = await controller.stop().catch(() => false);
    if (!this.bound(attempt, connection, sessionId)) return;
    // A refused stop leaves the title where it is: no stopped bar and no Continue here.
    if (!accepted) return;
    this.stopPolling();
    const current = this.state.remote;
    if (current) this.publish({remote: {...current, playing: false, stopped: true, allows: NONE}});
    await this.push('stopped', false, attempt, connection);
    setTimeout(() => {if (this.bound(attempt, connection) && this.state.remote?.stopped) void this.dismiss(connection);}, STOPPED_CLEAR_MS);
  };
  /** Brings the title back to this phone where the television stopped. */
  continueHere = async (remoteId?: string): Promise<void> => {
    const adapter = this.options.playback(), current = this.state.remote;
    if (!adapter || !current || !this.remoteBound(remoteId)) return;
    const attempt = this.attempt, connection = this.connection;
    try {await adapter.continueHere?.(current.id);} catch (error) {if (this.options.current()) this.options.reportError(error);}
    // A later send while the restore was in flight keeps its own remote.
    if (this.bound(attempt, connection) && this.state.remote?.id === current.id) this.clearRemote();
  };
  dismiss = async (remoteId?: string): Promise<void> => {
    const adapter = this.options.playback(), current = this.state.remote;
    if (!current || !this.remoteBound(remoteId ?? current.id)) return;
    this.clearRemote();
    if (adapter) {try {await adapter.dismissRemote?.(current.id);} catch (error) {if (this.options.current()) this.options.reportError(error);}}
  };
  openRemote = (): void => {if (this.state.remote) this.publish({remoteOpen: true});};
  closeRemote = (): void => {if (this.state.remoteOpen) this.publish({remoteOpen: false});};
  private clearRemote(): void {
    this.attempt++;
    this.stopPolling();
    this.connection = undefined; this.receiverPlaybackId = undefined; this.fence = undefined; this.local = undefined;
    if (this.state.remoteOpen) this.publish({remoteOpen: false});
    if (this.state.remote) this.publish({remote: undefined});
  }
  /** The dock's remote commands, always bound to the bar's own remote id. */
  command = async (type: string, positionSeconds?: number, remoteId?: string): Promise<void> => {
    switch (type) {
      case 'pause': return this.pause(remoteId);
      case 'play': case 'resume': return this.resume(remoteId);
      case 'seek': {
        const controller = this.controller;
        if (controller && this.remoteBound(remoteId) && positionSeconds !== undefined && Number.isFinite(positionSeconds)) {
          const attempt = this.attempt, connection = this.connection, sessionId = this.receiverPlaybackId;
          await controller.seek(Math.max(0, positionSeconds)).catch(() => {});
          if (this.bound(attempt, connection, sessionId)) await this.poll(attempt, connection);
        }
        return;
      }
      case 'open-remote': return this.openRemote();
      case 'stop': return this.stop(remoteId);
      case 'continue-here': return this.continueHere(remoteId);
      case 'dismiss-remote': return this.dismiss(remoteId);
      default: return;
    }
  };
  dispose(): void {
    this.disposed = true;
    this.stopPolling();
    this.off?.(); this.off = undefined;
    this.offController?.(); this.offController = undefined;
    this.controller?.dispose(); this.controller = undefined;
    this.listeners.clear();
  }
}

const sameAuthority = (a: Readonly<{serverId: string; accountId: string; profileId: string; epoch: string}> | undefined,
  b: Readonly<{serverId: string; accountId: string; profileId: string; epoch: string}> | undefined): boolean =>
  !!a && !!b && a.serverId === b.serverId && a.accountId === b.accountId && a.profileId === b.profileId && a.epoch === b.epoch;
