import {KeplerMediaControlHandler} from '@amazon-devices/react-native-w3cmedia';
import {trace} from '../debug';
import {ModuleEvents, withEvents} from './events';

/**
 * `NativeModules.PorticoSystemMedia`: the video's place in the system (the remote's transport
 * keys, voice commands, the output route). Events: `PorticoSystemMediaCommand`,
 * `PorticoSystemMediaRoute`.
 *
 * Left to itself the system acts on the media element directly when the viewer presses
 * Play/Pause or asks for something by voice, behind the player's back. `TransportKeys` is given
 * to the element in its place (`playback.ts`): each request becomes a command to the shared
 * player, as the Apple module's remote commands do, and the player decides.
 *
 * A television's own output is not an external route, so `currentRoute` always answers "none".
 */
export const systemMediaEvents = new ModuleEvents();

type Video = Readonly<{itemId: string; skipBackSeconds?: number; skipForwardSeconds?: number}>;
type Time = Readonly<{seconds: number; nanoseconds: number}>;
let video: Video | null = null;

const seconds = (time: Time | undefined) => (time ? Number(time.seconds) + Number(time.nanoseconds || 0) / 1e9 : 0);
function send(command: Readonly<Record<string, unknown>>): Promise<void> {
  trace(`system media ${String(command.command)}${video ? '' : ' (nothing playing)'}`);
  if (video) systemMediaEvents.emit('PorticoSystemMediaCommand', {...command, itemId: video.itemId, reason: 'remote'});
  return Promise.resolve();
}

export class TransportKeys extends KeplerMediaControlHandler {
  handlePlay(): Promise<void> { return send({command: 'play'}); }
  handlePause(): Promise<void> { return send({command: 'pause'}); }
  handleTogglePlayPause(): Promise<void> { return send({command: 'toggle'}); }
  handleStop(): Promise<void> { return send({command: 'pause'}); }
  handleStartOver(): Promise<void> { return send({command: 'seek', positionSeconds: 0}); }
  handleFastForward(): Promise<void> { return send({command: 'skip', deltaSeconds: video?.skipForwardSeconds ?? 30}); }
  handleRewind(): Promise<void> { return send({command: 'skip', deltaSeconds: -(video?.skipBackSeconds ?? 10)}); }
  handleSeek(position: Time): Promise<void> { return send({command: 'seek', positionSeconds: Math.max(0, seconds(position))}); }
  handleSkipForward(delta: Time): Promise<void> { return send({command: 'skip', deltaSeconds: Math.abs(seconds(delta))}); }
  handleSkipBackward(delta: Time): Promise<void> { return send({command: 'skip', deltaSeconds: -Math.abs(seconds(delta))}); }
  handleNext(): Promise<void> { return send({command: 'next'}); }
  handlePrevious(): Promise<void> { return send({command: 'previous'}); }
  // Speed, volume and track requests are the player screen's to offer, not the system's.
  handleSetPlaybackSpeed(): Promise<void> { return Promise.resolve(); }
  handleSetAudioVolume(): Promise<void> { return Promise.resolve(); }
  handleSetAudioTrack(): Promise<void> { return Promise.resolve(); }
  handleEnableTextTrack(): Promise<void> { return Promise.resolve(); }
  handleDisableTextTrack(): Promise<void> { return Promise.resolve(); }
}

export const PorticoSystemMedia = withEvents({
  setVideo(info: Video): void { video = info && typeof info.itemId === 'string' ? info : null; },
  clear(): void { video = null; },
  currentRoute: (): Promise<{external: boolean; kind: 'none'; name: string}> => Promise.resolve({external: false, kind: 'none', name: ''}),
}, systemMediaEvents);
