import {sameFence, type PlaybackDock, type DockState} from '../../../../../packages/player-core/src/index';
import {clockText, timelineFacts, type FactPart} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import type {DockAction, DockCommand, DockHostProps, DockOccupant} from './types';

export function currentOccupant(dock: PlaybackDock, snapshot: DockState, presentation: DockHostProps['presentation']): DockOccupant | null {
  // A stale React render may not bind new-source artwork/text to an older native surface.
  if (dock.getSnapshot() !== snapshot) return null;
  const occupant = dock.occupant();
  if (!occupant) return null;
  const model = occupant.remote ? presentation.remote : presentation.local;
  return model && sameFence(model.fence, occupant.playback.fence) ? {...occupant, presentation: model} : null;
}

export function dockCommand(occupant: DockOccupant, type: DockAction, positionSeconds?: number): DockCommand {
  return {type, fence: occupant.playback.fence, ...(occupant.remote ? {remote: {id: occupant.remote.id, sequence: occupant.remote.sequence}} : {}), ...(positionSeconds !== undefined ? {positionSeconds} : {})};
}

/** Re-check at dispatch, including a remote sequence that changed since the control rendered. */
export function commandIsCurrent(dock: PlaybackDock, command: DockCommand): boolean {
  const state = dock.getSnapshot();
  if (command.type === 'restore-audio') return !!state.parkedAudio && sameFence(state.parkedAudio.fence, command.fence);
  if (command.type === 'restore-video') return !!state.resumeVideo && sameFence(state.resumeVideo.fence, command.fence);
  if (command.remote) return state.remote?.id === command.remote.id && state.remote.sequence === command.remote.sequence && sameFence(state.remote.playback.fence, command.fence);
  return !state.remote && !!state.local && sameFence(state.local.fence, command.fence);
}

export function commandAllowed(occupant: DockOccupant, type: DockAction): boolean {
  const {capabilities: cap, finished} = occupant.presentation;
  const phase = occupant.remote?.phase;
  if (type === 'dismiss-remote') return !!phase && ['stopped', 'replaced', 'error'].includes(phase);
  if (type === 'continue-here') return phase === 'stopped';
  if (type === 'stop' || type === 'close') return cap.stop;
  if (type === 'open-remote') return phase === 'playing';
  if (type === 'expand' || type === 'collapse') return !phase;
  if (phase && phase !== 'playing') return false;
  if (type === 'seek') return cap.seek;
  if (type === 'previous' || type === 'next' || type === 'cast') return cap[type];
  if (type === 'pause') return cap.pause;
  if (type === 'play' || type === 'replay') return cap.play && (type !== 'replay' || !!finished);
  return true;
}

export const playbackPosition = (occupant: DockOccupant) => occupant.remote?.positionSeconds ?? occupant.playback.positionSeconds;
export function seekBounds(occupant: DockOccupant) {
  const window = occupant.presentation.seekWindow;
  if (window && Number.isFinite(window.start) && Number.isFinite(window.end) && window.start >= 0 && window.end > window.start) return window;
  const duration = occupant.presentation.durationSeconds;
  return Number.isFinite(duration) && duration! > 0 ? {start: 0, end: duration!} : undefined;
}
export function progressOf(occupant: DockOccupant): number | undefined {
  const bounds = seekBounds(occupant);
  return bounds ? timelineFacts(bounds.end - bounds.start, Math.max(0, playbackPosition(occupant) - bounds.start)).progress : undefined;
}
export function seekTo(occupant: DockOccupant, position: number): DockCommand | undefined {
  const bounds = seekBounds(occupant);
  return bounds && Number.isFinite(position) && commandAllowed(occupant, 'seek') ? dockCommand(occupant, 'seek', Math.min(bounds.end, Math.max(bounds.start, position))) : undefined;
}

export function remoteSubtitle(occupant: DockOccupant): readonly FactPart[] {
  const remote = occupant.remote;
  if (!remote) return occupant.presentation.identity.subtitle;
  const device = occupant.presentation.device ?? defaultI18n.t('cast.theTV');
  const position = clockText(remote.positionSeconds);
  switch (remote.phase) {
    case 'connecting': case 'pairing': return [{id: 'connecting', text: defaultI18n.t('playOn.connectingTo', {device}), role: 'status'}];
    case 'waiting': return [{id: 'waiting', text: defaultI18n.t('cast.waitingForAllow'), role: 'status'}];
    case 'replaced': return [{id: 'replaced', text: defaultI18n.t('cast.replaced'), role: 'status'}];
    case 'error': return [{id: 'error', text: defaultI18n.t('cast.error.unreachable'), role: 'status'}];
    case 'stopped': return position ? [{id: 'stopped', text: defaultI18n.t('next.dock.native.stoppedAt', {position}), role: 'status'}] : [];
    case 'playing': return [{id: 'device', text: device, role: 'context'}, ...(position ? [{id: 'position', text: position, role: 'context' as const}] : [])];
  }
}

/** Release decisions are worklet-safe; no clocks, session writes, or fixed animation restart. */
export function releaseDock(position: number, velocity: number): 0 | 1 {
  'worklet';
  if (velocity < -600) return 0;
  return position > .35 || velocity > 600 ? 1 : 0;
}
export function releaseAside(position: number, velocity: number, width: number): -1 | 0 | 1 {
  'worklet';
  if (!(width > 0) || !Number.isFinite(position) || !Number.isFinite(velocity)) return 0;
  if (Math.abs(velocity) > 800) return velocity > 0 ? 1 : -1;
  return Math.abs(position) > width / 3 ? position > 0 ? 1 : -1 : 0;
}
export function validRect(rect: {x: number; y: number; width: number; height: number}) {
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
export const GestureRelease = Object.freeze({dock: releaseDock, aside: releaseAside});
