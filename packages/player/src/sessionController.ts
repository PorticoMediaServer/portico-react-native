export type PlayerMediaFamily = 'audio' | 'video';
export type PlayerPlatform = 'mobile' | 'tv';
export type PlayerPresentation = 'background' | 'collapsed' | 'fullscreen';

export interface PlayerSessionSnapshot {
  active: boolean;
  artwork?: string;
  canNext?: boolean;
  canPrevious?: boolean;
  canSeek?: boolean;
  isPlaying: boolean;
  mediaFamily: PlayerMediaFamily;
  mediaId: string;
  platform: PlayerPlatform;
  presentation: PlayerPresentation;
  subtitle?: string;
  title: string;
}

export interface PlayerSessionCommands {
  next(): void;
  pause(): void;
  play(): void;
  previous(): void;
  seekBy(seconds: number): void;
  stop(): void | Promise<void>;
}

export type PlayerLifecycleEvent =
  | {type: 'app-background'}
  | {type: 'back'}
  | {type: 'present'; presentation: PlayerPresentation}
  | {type: 'remote-toggle'};

export interface PlayerLifecycleDecision {
  pause: boolean;
  presentation?: PlayerPresentation;
  restoreInvoker: boolean;
  stop: boolean;
  toggle: boolean;
}

export function playerLifecycleDecision(
  snapshot: PlayerSessionSnapshot,
  event: PlayerLifecycleEvent,
): PlayerLifecycleDecision {
  if (event.type === 'app-background') {
    return {
      pause: snapshot.mediaFamily === 'video',
      presentation: snapshot.mediaFamily === 'audio' ? 'background' : snapshot.presentation,
      restoreInvoker: false,
      stop: false,
      toggle: false,
    };
  }
  if (event.type === 'back') {
    if (snapshot.platform === 'tv' && snapshot.mediaFamily === 'audio') {
      return {pause: false, presentation: 'background', restoreInvoker: true, stop: false, toggle: false};
    }
    return {pause: true, restoreInvoker: true, stop: snapshot.platform === 'tv', toggle: false};
  }
  if (event.type === 'remote-toggle') {
    return {pause: false, restoreInvoker: false, stop: false, toggle: true};
  }
  return {pause: false, presentation: event.presentation, restoreInvoker: false, stop: false, toggle: false};
}

const EMPTY_SNAPSHOT: PlayerSessionSnapshot = {
  active: false,
  isPlaying: false,
  mediaFamily: 'video',
  mediaId: '',
  platform: 'mobile',
  presentation: 'fullscreen',
  title: '',
};

export class PlayerSessionController {
  private commands?: PlayerSessionCommands;
  private listeners = new Set<() => void>();
  private snapshot: PlayerSessionSnapshot = EMPTY_SNAPSHOT;

  getSnapshot = (): PlayerSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  registerCommands(commands: PlayerSessionCommands): () => void {
    if (this.commands && this.commands !== commands) {
      throw new Error('A Portico player session already owns the command authority.');
    }
    this.commands = commands;
    return () => {
      if (this.commands === commands) this.commands = undefined;
    };
  }

  publish(snapshot: PlayerSessionSnapshot | undefined): void {
    this.snapshot = snapshot ?? EMPTY_SNAPSHOT;
    this.emit();
  }

  update(update: Partial<PlayerSessionSnapshot>): void {
    if (!this.snapshot.active) return;
    this.snapshot = {...this.snapshot, ...update};
    this.emit();
  }

  handle(event: PlayerLifecycleEvent): PlayerLifecycleDecision {
    const decision = playerLifecycleDecision(this.snapshot, event);
    if (decision.pause) this.commands?.pause();
    if (decision.stop) void this.commands?.stop();
    if (decision.toggle) {
      if (this.snapshot.isPlaying) this.commands?.pause();
      else this.commands?.play();
    }
    if (decision.presentation) this.update({presentation: decision.presentation});
    return decision;
  }

  play(): void { this.commands?.play(); }
  pause(): void { this.commands?.pause(); }
  previous(): void { this.commands?.previous(); }
  next(): void { this.commands?.next(); }
  seekBy(seconds: number): void { this.commands?.seekBy(seconds); }
  stop(): void { void this.commands?.stop(); }

  profileSwitchNeedsConfirmation(): boolean {
    return this.snapshot.active &&
      this.snapshot.mediaFamily === 'audio' &&
      this.snapshot.presentation === 'background';
  }

  confirmProfileSwitch(): void {
    if (this.profileSwitchNeedsConfirmation()) this.stop();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createPlayerSessionController(): PlayerSessionController {
  return new PlayerSessionController();
}
