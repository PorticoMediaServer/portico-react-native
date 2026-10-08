import {useEffect, useRef, useState} from 'react';
import {NativeEventEmitter, NativeModules, Platform, useTVEventHandler} from 'react-native';

/**
 * Video in the system (OS-01, OS-03, OS-06): lock screen, Control Centre, Apple Watch, AirPods,
 * the Apple TV's Control Centre and the iPhone remote, plus audio interruptions and the AirPlay
 * route. Music and audiobooks are already published by the native listening owner; don't call
 * this for them (native also stands aside while that owner is active).
 *
 * Native never drives the player: every lock-screen press, AirPods tap, Siri/phone call
 * interruption or headphone unplug arrives as a `SystemMediaCommand`, which the player turns into
 * its ordinary intent (so Watch Together control rules and progress reporting stay in one place).
 */
export type SystemMediaVideo = {
  itemId: string;
  title: string;
  /** Second line: "S2 · E4 · Episode title" or "2019" for a film. */
  subtitle?: string;
  /** The show's name, shown as the "artist" line. */
  seriesTitle?: string;
  /** For artwork: the viewer's server origin, bearer, and `/v1/items/{id}/art/poster` (no query). */
  origin?: string;
  bearer?: string;
  posterPath?: string;
  durationSeconds: number;
  live: boolean;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  canNext: boolean;
  canPrevious: boolean;
  /** With no queue, Next/Previous on the lock screen move between chapters. */
  chapters?: readonly {startSeconds: number; title: string}[];
  /** Skip forward inside an intro/recap/credits marker jumps to its end ("Skip Intro"). */
  markers?: readonly {kind: string; startSeconds: number; endSeconds: number}[];
};

export type SystemMediaCommand =
  | {command: 'play' | 'pause' | 'toggle' | 'next' | 'previous'; itemId: string; reason: 'remote' | 'interruption' | 'route'}
  | {command: 'seek'; itemId: string; positionSeconds: number; reason: 'remote'; marker?: string; chapter?: string}
  | {command: 'skip'; itemId: string; deltaSeconds: number; reason: 'remote'};

/** `subtitlesCarried` is false while playing to an AirPlay receiver with subtitles drawn by the
 * app (they can't travel with the stream): say so rather than silently losing them (OS-02). */
export type SystemMediaRoute = {external: boolean; kind: 'airplay' | 'hdmi' | 'none'; name: string; subtitlesCarried?: boolean};

type Native = {setVideo(info: SystemMediaVideo): void; clear(): void; currentRoute(): Promise<SystemMediaRoute>};
const native = NativeModules.PorticoSystemMedia as Native | undefined;
const emitter = native ? new NativeEventEmitter(NativeModules.PorticoSystemMedia) : null;
const PRESS_HOLD_MS = 250, PRESS_WINDOW_MS = 500;
const offRoute: SystemMediaRoute = {external: false, kind: 'none', name: ''};

/** Strips a query and anything that isn't the protected poster path native accepts. */
export function systemPosterPath(url?: string): string | undefined {
  if (!url) return undefined;
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0];
  return /^\/v1\/items\/[A-Za-z0-9_-]{1,128}\/art\/(poster|backdrop|thumb)$/.test(path) ? path : undefined;
}

/**
 * Publishes the current video while `video` is non-null and clears it when it becomes null or the
 * component unmounts. `onCommand` is read through a ref, so passing a new function each render is
 * fine. Returns the current output route ("Playing on Living Room" when `external`).
 */
export function useSystemMedia(video: SystemMediaVideo | null, onCommand: (command: SystemMediaCommand) => void): SystemMediaRoute {
  const handler = useRef(onCommand);
  handler.current = onCommand;
  const [route, setRoute] = useState<SystemMediaRoute>(offRoute);
  const key = video ? JSON.stringify(video) : '';
  useEffect(() => {
    if (!native) return;
    if (video) native.setVideo(video);
    else native.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => native?.clear(), []);
  // tvOS: the Siri Remote's Play/Pause press reaches the player as a TV event, and on some
  // system versions also as a remote command. Hold transport commands briefly and drop any that
  // coincide with a Play/Pause press, so one press never toggles twice.
  const lastPress = useRef(0);
  useTVEventHandler(event => { if (event?.eventType === 'playPause') lastPress.current = Date.now(); });
  useEffect(() => {
    if (!emitter || !native) return;
    const transport = (c: SystemMediaCommand) => c.command === 'play' || c.command === 'pause' || c.command === 'toggle';
    const deliver = (event: SystemMediaCommand) => {
      if (!Platform.isTV || !transport(event) || event.reason !== 'remote') { handler.current(event); return; }
      const arrived = Date.now();
      setTimeout(() => { if (Math.abs(lastPress.current - arrived) > PRESS_WINDOW_MS) handler.current(event); }, PRESS_HOLD_MS);
    };
    const commands = emitter.addListener('PorticoSystemMediaCommand', deliver);
    const routes = emitter.addListener('PorticoSystemMediaRoute', (event: SystemMediaRoute) => setRoute(event));
    void native.currentRoute().then(setRoute, () => {});
    return () => { commands.remove(); routes.remove(); };
  }, []);
  return route;
}

/** OS-06: the profile's skip amounts for music and audiobooks on the lock screen and Control
 * Centre (video takes them from `useSystemMedia`). Call when the preference loads or changes. */
export function setListeningSkipIntervals(backSeconds: number, forwardSeconds: number): void {
  const playback = NativeModules.PorticoPlaybackModule as undefined | {listeningSkipIntervals?(back: number, forward: number): void};
  if (Number.isFinite(backSeconds) && Number.isFinite(forwardSeconds)) playback?.listeningSkipIntervals?.(backSeconds, forwardSeconds);
}
