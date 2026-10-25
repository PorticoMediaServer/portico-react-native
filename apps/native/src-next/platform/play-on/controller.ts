import type {RemotePlaybackControls} from '../../../../../packages/client-core/src/playback-controls';
import {playbackControlsService} from '../../../../../packages/client-core/src/playback-controls';
import {HandoffController, type HandoffPhase, type HandoffSnapshot, type Receiver} from '../../../../../packages/client-core/src/remote-playback';
import type {LocalSession} from '../../../../../packages/client-core/src/index';
import type {PlaybackFence, RemoteDock} from '../../../../../packages/player-core/src';
import type {NativePlaybackAdapter} from '../playback/types';

/** Play on, natively: the Portico devices this profile may send to, the handoff that
 * moves this phone's playback to one of them, and the remote that follows it after.
 *
 * Every fact is the server's or the receiving device's own: the directory comes from
 * `GET /v1/receivers`, the takeover only counts once the television proves it is
 * playing, and the position the remote shows is read from the playing device through
 * `GET /v1/playback/controls`. AirPlay and Google Cast need platform transports this
 * app does not install, so they are not offered. */

export type PlayOnRemote = Readonly<{
  id: string;
  device: string;
  title?: string;
  positionSeconds: number;
  durationSeconds: number;
  playing: boolean;
  stopped: boolean;
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
const wire = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

export class NativePlayOn {
  private readonly options: Options;
  private readonly listeners = new Set<() => void>();
  private controller?: HandoffController;
  private timer?: ReturnType<typeof setInterval>;
  private sequence = 0;
  private fence?: PlaybackFence;
  private remoteSessionId?: string;
  private report?: RemotePlaybackControls;
  private state: PlayOnSnapshot = Object.freeze({open: false, receivers: [], directoryPhase: 'idle', phase: 'idle', sending: false, remoteOpen: false});
  private disposed = false;

  private off?: () => void;
  constructor(options: Options) {
    this.options = options;
    // Another surface may end the remote first (Continue here on the bar, Dismiss,
    // or the dock's own expiry); the controller follows the dock, never the reverse.
    this.off = options.playback()?.subscribe(() => {
      const remote = options.playback()?.getSnapshot().dock.remote;
      if (this.state.remote && !remote) this.clearRemote();
      else if (this.state.remote && remote && remote.id !== this.state.remote.id) this.clearRemote();
    });
  }

  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = (): PlayOnSnapshot => this.state;
  private publish(patch: Partial<PlayOnSnapshot>): void {
    if (this.disposed) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }

  /** One controller per signed-in device; its directory survives sheet openings. */
  private handoff(): HandoffController | undefined {
    if (this.disposed || !this.options.current()) return undefined;
    if (this.controller) return this.controller;
    const session = this.options.session();
    if (!session?.deviceId) return undefined;
    const controller = new HandoffController({
      api: {request: (path, method, body, signal) => this.options.api.request(path, method, body, signal)},
      device: {deviceId: session.deviceId, displayName: this.options.deviceName()},
      requestId: () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    });
    controller.subscribe(() => this.follow(controller.getSnapshot()));
    this.controller = controller;
    return controller;
  }

  private follow(snapshot: HandoffSnapshot): void {
    const playing = snapshot.phase === 'done' && !!snapshot.handoffId;
    const failed = snapshot.phase === 'failed';
    const message = snapshot.message;
    if (failed || (!playing && snapshot.phase !== 'asking' && snapshot.phase !== 'preparing' && snapshot.phase !== 'starting')) {
      this.publish({phase: snapshot.phase, message, target: snapshot.target, sending: false});
      return;
    }
    this.publish({phase: snapshot.phase, message, target: snapshot.target, sending: snapshot.phase !== 'done'});
    if (playing) this.startPolling();
  }

  open = (): boolean => {
    if (this.disposed || !this.options.current()) return false;
    const controller = this.handoff();
    if (!controller) return false;
    this.publish({open: true});
    void controller.refresh().catch(error => {if (this.options.current()) this.options.reportError(error);});
    return true;
  };

  close = (): void => {
    if (!this.state.open) return;
    this.publish({open: false});
    if (this.state.phase !== 'done') this.controller?.cancel();
  };

  /** Moves this phone's playback to the receiver. The statement of what is playing is
   * this device's own; the bar follows the receiver's, never this phone's. */
  send = async (receiver: Receiver): Promise<void> => {
    const controller = this.handoff(), playback = this.options.playback(), session = this.options.session();
    if (!controller || !playback || !session) return;
    const snapshot = playback.getSnapshot(), fence = snapshot.fence;
    if (!fence || fence.kind !== 'queue' || snapshot.playback.phase !== 'ready') return;
    const entry = snapshot.entry;
    this.fence = fence;
    this.publish({sending: true, message: undefined});
    const playing = await controller.send(receiver, {playbackId: fence.sessionId, positionSeconds: snapshot.playback.positionSeconds}).catch(error => {
      if (this.options.current()) this.options.reportError(error);
      return false;
    });
    if (!playing) {this.publish({sending: false}); return;}
    this.remoteSessionId = controller.getSnapshot().receiverPlaybackId;
    this.publish({open: false, sending: false, message: controller.getSnapshot().message, target: receiver,
      remote: {id: `playon_${wire(receiver.id)}`, device: receiver.displayName, title: entry?.displayTitle ?? entry?.title,
        positionSeconds: snapshot.playback.positionSeconds, durationSeconds: snapshot.playback.duration,
        playing: true, stopped: false, allows: {pause: true, resume: true, seek: true, stop: true}}});
    await this.push('playing', true);
  };

  /** The dock's bar when the receiver is connecting, playing or stopped; `initial`
   * is the explicit connection start that creates the occupant. */
  private async push(phase: RemoteDock['phase'], initial = false): Promise<void> {
    const adapter = this.options.playback(), fence = this.fence, remote = this.state.remote;
    if (!adapter || !fence || !remote) return;
    const playback = adapter.getSnapshot().dock.local ?? {positionSeconds: remote.positionSeconds, playing: false, expanded: false, kind: 'video' as const, fence, queue: null};
    const value: RemoteDock = Object.freeze({id: remote.id, kind: 'play-on', phase, sequence: String(++this.sequence),
      positionSeconds: Math.max(0, remote.positionSeconds), playback: {...playback, positionSeconds: Math.max(0, remote.positionSeconds), playing: remote.playing, expanded: false}});
    try {
      if (initial) await adapter.beginRemote?.(value);
      else await adapter.updateRemote?.(value);
    } catch (error) {if (this.options.current()) this.options.reportError(error);}
  }

  private startPolling(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {void this.poll();}, POLL_MS);
    void this.poll();
  }

  private stopPolling(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The playing device's own account of itself, read from the server, plus its session. */
  private async poll(): Promise<void> {
    const controller = this.controller, current = this.state.remote;
    if (this.disposed || !controller || !current || !this.options.current()) {this.stopPolling(); return;}
    const sessionId = controller.getSnapshot().receiverPlaybackId ?? this.remoteSessionId;
    if (!sessionId) return;
    this.remoteSessionId = sessionId;
    try {
      const session = await controller.refreshRemote();
      const page = await playbackControlsService(<T,>(path: string, method?: string, body?: unknown) => this.options.api.request<T>(path, method, body)).remote();
      if (!this.options.current() || this.state.remote?.id !== current.id) return;
      const report = page.items.find(item => item.sessionId === sessionId);
      if (report) this.report = report;
      const positionSeconds = report ? Math.max(0, report.positionMs / 1000) : current.positionSeconds;
      const stopped = !session || report?.state === 'ended';
      const playing = report ? report.state === 'playing' : !stopped;
      const allows = {pause: report ? report.actions.includes('pause') : true, resume: report ? report.actions.includes('resume') : true,
        seek: report ? report.actions.includes('seek') : true, stop: report ? report.actions.includes('stop') : true};
      this.publish({remote: {...current, positionSeconds, durationSeconds: report?.durationMs ? report.durationMs / 1000 : current.durationSeconds,
        playing, stopped, allows, ...(report?.item?.title ? {title: report.item.title} : {}), ...(report?.device.name ? {device: report.device.name} : {})}});
      if (stopped) {this.stopPolling(); await this.push('stopped');} else await this.push('playing');
    } catch (error) {
      if (this.options.current()) this.options.reportError(Object.assign(new Error('playOn.unreachable'), {cause: error}));
      this.publish({remote: {...current, playing: false, allows: {...current.allows, pause: false, resume: false, seek: false}}});
    }
  }

  pause = async (): Promise<void> => {const controller = this.controller; if (!controller) return; await controller.pause().catch(() => {}); await this.poll();};
  resume = async (): Promise<void> => {const controller = this.controller; if (!controller) return; await controller.play().catch(() => {}); await this.poll();};
  startOver = async (): Promise<void> => {const controller = this.controller; if (!controller) return; await controller.seek(0).catch(() => {}); await this.poll();};
  skip = async (deltaSeconds: number): Promise<void> => {
    const controller = this.controller, remote = this.state.remote;
    if (!controller || !remote || !Number.isFinite(deltaSeconds)) return;
    const target = Math.max(0, Math.min(remote.durationSeconds || Number.POSITIVE_INFINITY, remote.positionSeconds + deltaSeconds));
    await controller.seek(target).catch(() => {});
    await this.poll();
  };
  stop = async (): Promise<void> => {
    const controller = this.controller;
    if (!controller) return;
    // While it is still asking or preparing, Stop cancels the request: nothing has moved.
    if (controller.getSnapshot().phase !== 'done') {controller.cancel(); this.publish({sending: false, phase: 'idle', message: undefined}); return;}
    this.stopPolling();
    await controller.stop().catch(() => {});
    const current = this.state.remote;
    if (current) this.publish({remote: {...current, playing: false, stopped: true, allows: {pause: false, resume: false, seek: false, stop: false}}});
    await this.push('stopped');
    // A stopped bar clears itself, like the music bar's finished state.
    const id = current?.id;
    setTimeout(() => {if (id && this.state.remote?.id === id && this.state.remote.stopped) void this.dismiss();}, 15_000);
  };
  /** Brings the title back to this phone where the television stopped. */
  continueHere = async (): Promise<void> => {
    const adapter = this.options.playback(), current = this.state.remote;
    if (!adapter || !current) return;
    try {await adapter.continueHere?.(current.id);} catch (error) {if (this.options.current()) this.options.reportError(error);}
    this.clearRemote();
  };
  dismiss = async (): Promise<void> => {
    const adapter = this.options.playback(), current = this.state.remote;
    this.clearRemote();
    if (adapter && current) {try {await adapter.dismissRemote?.(current.id);} catch (error) {if (this.options.current()) this.options.reportError(error);}}
  };
  openRemote = (): void => {if (this.state.remote) this.publish({remoteOpen: true});};
  closeRemote = (): void => {if (this.state.remoteOpen) this.publish({remoteOpen: false});};
  private clearRemote(): void {
    this.stopPolling();
    if (this.state.remoteOpen) this.publish({remoteOpen: false});
    this.remoteSessionId = undefined; this.report = undefined; this.fence = undefined;
    if (this.state.remote) this.publish({remote: undefined});
  }
  /** The dock's remote commands, from the bar's buttons and its menu. */
  command = async (type: string, positionSeconds?: number): Promise<void> => {
    switch (type) {
      case 'pause': return this.pause();
      case 'play': case 'resume': return this.resume();
      case 'seek': {
        const controller = this.controller;
        if (controller && positionSeconds !== undefined && Number.isFinite(positionSeconds)) {
          await controller.seek(Math.max(0, positionSeconds)).catch(() => {});
          await this.poll();
        }
        return;
      }
      case 'open-remote': return this.openRemote();
      case 'stop': return this.stop();
      case 'continue-here': return this.continueHere();
      case 'dismiss-remote': return this.dismiss();
      default: return;
    }
  };
  dispose(): void {
    this.disposed = true;
    this.off?.(); this.off = undefined;
    this.stopPolling();
    this.controller?.dispose();
    this.controller = undefined;
    this.listeners.clear();
  }
}
