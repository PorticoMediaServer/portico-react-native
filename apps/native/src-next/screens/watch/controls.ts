import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import type {NativeFullWindowOrientation} from '../../platform/layout/full-window';

export type NativeWatchPanel = 'options' | 'subtitles' | 'audio' | 'quality' | 'speed' | 'sleep' | 'style' | 'chapters' | 'episodes' | 'up-next' | 'playback-info';
export type NativeWatchControlState = Readonly<{
  fence?: PlaybackFence;
  visible: boolean;
  panel?: NativeWatchPanel;
  panelOffset: number;
  panelFocus?: NativeWatchPanel;
  focus: 'surface' | 'toggle' | 'panel';
  hideReason?: 'timer' | 'input';
  /** The real sideways request for this fence is active; the geometry is the wide rule. */
  fullWindow?: boolean;
}>;
export type NativeWatchControlContext = Readonly<{
  expanded: boolean;
  autoHide: boolean;
  /** Full-window panel geometry suppresses every transport, including fold reveal. */
  hiddenByPanel: boolean;
  paused: boolean;
  scrubbing: boolean;
  focusHeld: boolean;
}>;
export type NativeWatchControlClock = Readonly<{
  now: () => number;
  set: (callback: () => void, delay: number) => unknown;
  clear: (handle: unknown) => void;
}>;
const clock: NativeWatchControlClock = {now: Date.now, set: (f, ms) => setTimeout(f, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)};

/** Chrome only; the actual playback owner retains its engine, source, queue and lease. */
export class NativeWatchControls {
  private listeners = new Set<() => void>();
  private state: NativeWatchControlState = Object.freeze({visible: false, panelOffset: 0, focus: 'surface'});
  private context: NativeWatchControlContext = {expanded: false, autoHide: true, hiddenByPanel: false, paused: false, scrubbing: false, focusHeld: false};
  private timer: unknown;
  private deadline = 0;
  private disposed = false;
  private offsets = new Map<NativeWatchPanel, number>();
  private readonly isTV: boolean;
  private readonly time: NativeWatchControlClock;
  private hiddenByBack = false;
  private gestureScrubbing = false;
  private overlayHeld = false;
  private scrubCancel?: {cancel: () => void};
  private readonly fullWindowOrientation: NativeFullWindowOrientation | undefined;
  private readonly reportError: ((error: unknown) => void) | undefined;
  /** The one exact request: owner, the page fence that asked, and the route it was made on. */
  private fullWindowRequest?: Readonly<{owner: string; fence: PlaybackFence; routeRevision: number}>;
  private routeRevision = -1;
  constructor(isTV: boolean, time: NativeWatchControlClock = clock, fullWindowOrientation?: NativeFullWindowOrientation,
    reportError?: (error: unknown) => void) {
    this.isTV = isTV; this.time = time; this.fullWindowOrientation = fullWindowOrientation; this.reportError = reportError;
  }
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = (): NativeWatchControlState => this.state;
  private publish(change: Partial<NativeWatchControlState>): void {
    if (this.disposed) return;
    const next = {...this.state, ...change};
    if (Object.keys(next).every(key => next[key as keyof NativeWatchControlState] === this.state[key as keyof NativeWatchControlState])) return;
    this.state = Object.freeze(next); for (const listener of [...this.listeners]) listener();
  }
  private cancel(): void {if (this.timer !== undefined) this.time.clear(this.timer); this.timer = undefined;}
  private current(fence: PlaybackFence): boolean {return !this.disposed && sameFence(this.state.fence, fence);}
  private pinned(): boolean {return this.context.paused || this.context.scrubbing || this.gestureScrubbing || this.overlayHeld || this.context.focusHeld || !this.context.autoHide;}
  private suppressed(): boolean {return !this.context.expanded || !!this.state.panel && this.context.hiddenByPanel;}
  source(fence: PlaybackFence | undefined, context: NativeWatchControlContext): void {
    const changed = fence ? !sameFence(this.state.fence, fence) : !!this.state.fence;
    const unpinned = !this.pinned();
    this.context = context;
    // The request belongs to the page that made it: a fence change, a dock collapse or an
    // empty source retires the exact owner, never a successor's.
    if (this.fullWindowRequest && (!fence || changed || !context.expanded)) this.releaseFullWindow();
    if (changed || unpinned && this.pinned()) this.hiddenByBack = false;
    if (changed) {
      this.cancel(); this.deadline = 0; this.offsets.clear(); this.gestureScrubbing = false; this.overlayHeld = false; this.scrubCancel = undefined;
      this.publish({fence, panel: undefined, panelFocus: undefined, panelOffset: 0, visible: !!fence && !this.isTV, focus: this.isTV ? 'surface' : 'toggle'});
    }
    if (!fence) {this.cancel(); this.publish({visible: false, panel: undefined, focus: 'surface'}); return;}
    if (this.suppressed()) {this.cancel(); this.deadline = 0; this.publish({visible: false, focus: this.state.panel ? 'panel' : 'surface'});}
    else if (this.pinned() && !this.hiddenByBack) {this.cancel(); this.publish({visible: true, focus: this.state.panel ? 'panel' : 'toggle'});}
    else if (changed && !this.isTV) this.reveal(fence);
    else this.arm();
  }
  private arm(): void {
    this.cancel();
    if (!this.state.visible || this.suppressed() || this.pinned() || this.state.panel || !this.state.fence) return;
    if (!this.deadline) this.deadline = this.time.now() + 4000;
    const expected = this.state.fence;
    this.timer = this.time.set(() => {
      this.timer = undefined;
      if (!this.current(expected) || this.suppressed() || this.pinned() || this.state.panel) return;
      if (this.time.now() < this.deadline) {this.arm(); return;}
      this.deadline = 0; this.publish({visible: false, focus: 'surface', hideReason: 'timer'});
    }, Math.max(0, this.deadline - this.time.now()));
  }
  reveal(fence: PlaybackFence, deadline = this.time.now() + 4000): boolean {
    if (!this.current(fence) || this.suppressed()) return false;
    this.hiddenByBack = false;
    this.deadline = Math.max(this.time.now(), deadline);
    this.publish({visible: true, focus: this.state.panel ? 'panel' : 'toggle', hideReason: undefined}); this.arm(); return true;
  }
  /** Fold's geometry helper supplies its one-shot now+3000 deadline; panel close supplies none. */
  revealAfterLayout(fence: PlaybackFence, deadline: number): boolean {
    return Number.isFinite(deadline) && deadline > this.time.now() && this.reveal(fence, deadline);
  }
  /** The first TV key reveals and is consumed. It never also pauses/seeks. */
  key(fence: PlaybackFence): boolean {return this.current(fence) && !this.state.visible && !this.state.panel && this.reveal(fence);}
  toggleVisibility(fence: PlaybackFence): void {
    if (!this.current(fence) || this.suppressed() || this.state.panel) return;
    if (!this.state.visible) {this.reveal(fence); return;}
    if (!this.pinned()) {this.cancel(); this.deadline = 0; this.publish({visible: false, focus: 'surface', hideReason: 'input'});}
  }
  /** The device's own module support; nothing is drawn without it. */
  canFullWindow(): boolean {return !!this.fullWindowOrientation && !this.isTV;}

  /** Ask the host for the sideways presentation, for this fence only. The published state
   * waits for the real admission; a refusal or a replaced request leaves it false. */
  setFullWindow(fence: PlaybackFence, on: boolean): boolean {
    if (!this.current(fence)) return false;
    if (!on) {
      const owner = this.fullWindowRequest?.owner;
      if (!owner) return false;
      this.releaseFullWindow();
      return true;
    }
    const port = this.fullWindowOrientation;
    if (!port || !this.context.expanded || this.fullWindowRequest) return false;
    // A fresh id per opening from the native UUID source: a late finalizer of A can never match B.
    const owner = port.owner();
    this.fullWindowRequest = {owner, fence, routeRevision: this.routeRevision};
    const failed = () => {
      if (this.fullWindowRequest?.owner !== owner) return;
      this.clearFullWindow(owner, false);
      this.reportError?.(new Error('full_window_orientation_unavailable'));
    };
    void port.enter(owner).then(admitted => {
      if (this.fullWindowRequest?.owner !== owner) return;
      // Not issued: nothing to restore; say so rather than pretending the mode exists.
      if (!admitted) {failed(); return;}
      // Issued but the page moved on: restore this owner now.
      if (!this.current(fence)) {this.clearFullWindow(owner, true); return;}
      this.publish({fullWindow: true});
      this.reveal(fence);
    }, failed);
    return true;
  }

  /** The host refused an issued request; only that exact owner's record is cleared. */
  failFullWindow(owner: string): boolean {
    if (this.fullWindowRequest?.owner !== owner) return false;
    // The mask was already set even if the geometry was refused, so this owner must release it.
    this.clearFullWindow(owner, true);
    return true;
  }

  /** A route push or pop retires the request the previous route made. */
  route(revision: number): void {
    if (this.routeRevision === revision) return;
    this.routeRevision = revision;
    this.releaseFullWindow();
  }

  /** Teardown only: restore the exact live request, never a successor's. */
  releaseFullWindow(): void {
    const owner = this.fullWindowRequest?.owner;
    if (owner) this.clearFullWindow(owner, true);
  }

  private clearFullWindow(owner: string, restore: boolean): void {
    if (this.fullWindowRequest?.owner !== owner) return;
    this.fullWindowRequest = undefined;
    this.publish({fullWindow: false});
    if (restore) this.fullWindowOrientation?.leave(owner);
  }

  scrub(fence: PlaybackFence, scrubbing: boolean): void {
    if (!this.current(fence)) return;
    this.gestureScrubbing = scrubbing;
    if (scrubbing) this.reveal(fence);
    else this.arm();
  }
  /** A chrome-owned people sheet keeps its opener visible until focus returns. */
  holdOverlay(fence: PlaybackFence, held: boolean): void {
    if (!this.current(fence) || this.overlayHeld === held) return;
    this.overlayHeld = held;
    if (held) this.reveal(fence);
    else {this.deadline = this.time.now() + 4000; this.arm();}
  }
  /** The mounted timeline owns a preview; Back cancels that before hiding controls. */
  registerScrubCancel(fence: PlaybackFence, cancel: () => void): () => void {
    if (!this.current(fence)) return () => {};
    const registration = {cancel}; this.scrubCancel = registration;
    return () => {if (this.scrubCancel === registration) this.scrubCancel = undefined;};
  }
  open(panel: NativeWatchPanel, fence: PlaybackFence): boolean {
    if (!this.current(fence) || !this.context.expanded) return false;
    this.cancel(); this.deadline = 0;
    this.publish({panel, panelFocus: undefined, panelOffset: this.offsets.get(panel) ?? 0, visible: !this.context.hiddenByPanel, focus: 'panel'}); return true;
  }
  rememberPanel(fence: PlaybackFence, offset: number): void {
    if (!this.current(fence) || !this.state.panel || !Number.isFinite(offset) || offset < 0) return;
    this.offsets.set(this.state.panel, offset); this.publish({panelOffset: offset});
  }
  closePanel(fence: PlaybackFence): boolean {
    if (!this.current(fence) || !this.state.panel) return false;
    // No fold reveal on closing a panel alone. Keep its opener and its scroll memory.
    this.publish({panel: undefined, panelFocus: undefined, panelOffset: 0, visible: this.pinned(), focus: this.pinned() ? 'toggle' : 'surface'});
    this.arm(); return true;
  }
  back(fence: PlaybackFence): 'panel' | 'controls' | 'player' | 'full-window' | 'stale' {
    if (!this.current(fence)) return 'stale';
    if (!this.state.panel && this.scrubCancel) {this.scrubCancel.cancel(); return 'controls';}
    if (this.state.panel && this.state.panel !== 'options' && this.state.panel !== 'episodes') {
      const opener = this.state.panel;
      this.open('options', fence); this.publish({panelFocus: opener}); return 'panel';
    }
    if (this.closePanel(fence)) return 'panel';
    // Back restores the host's own orientation first, on the same fence and route.
    if (this.fullWindowRequest) {this.releaseFullWindow(); this.reveal(fence); return 'full-window';}
    if (this.state.visible) {this.cancel(); this.deadline = 0; this.hiddenByBack = true; this.publish({visible: false, focus: 'surface', hideReason: 'input'}); return 'controls';}
    return 'player';
  }
  dispose(): void {
    const owner = this.fullWindowRequest?.owner;
    this.fullWindowRequest = undefined;
    if (owner) this.fullWindowOrientation?.leave(owner);
    this.cancel(); this.scrubCancel = undefined; this.disposed = true; this.offsets.clear(); this.listeners.clear();
  }
}
