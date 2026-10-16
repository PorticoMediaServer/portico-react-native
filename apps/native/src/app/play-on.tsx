import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {HandoffController, type HandoffSnapshot} from '../../../../packages/client-core/src/index';
import {playbackControlsService} from '../../../../packages/client-core/src/playback-controls';
import {newerReport, remoteAllows, remoteReport, remoteSkipTarget, type RemoteAction, type RemoteReport} from './play-on-controls';
import {NativeQueueStore} from '../bridge/queue-storage';
import {profileInstallation} from '../bridge/profile-trust';
import {deviceIdentity} from '../bridge/setup-codes';
import {deviceModelName} from '../bridge/device-platform';
import {readSentPlayback, type SentPlayback} from './play-on-memory';
import {hasRealOrigin, useSession} from './session';
import {viewerKey} from './viewer-scope';

/**
 * Play on, kept for as long as someone is signed in: one controller that sends this device's
 * playback to another of the profile's devices and then stays with it, so the title that moved
 * to the television can still be paused, resumed, moved and stopped from here. It is picked up
 * again after the app was closed (the handoff is remembered on this device; the server decides
 * whether it is still this viewer's to control).
 *
 * Where the title is, and what may be done to it, are the playing device's own account of itself
 * (`play-on-controls.ts`): read every few seconds while its controls are on screen, and again
 * straight after each thing asked of it.
 */
export type RemotePlayback = Readonly<{
  device: string; title?: string; paused: boolean; busy: boolean; message?: string;
  /** Where the other device is, as it last said. Absent until it has said. */
  positionSeconds?: number;
  /** The title's length, when the server knows it. */
  durationSeconds: number;
  /** Whether the server lets this profile do this to the session now. */
  allows: (action: RemoteAction) => boolean;
  pause: () => void;
  resume: () => void;
  /** Moves the other device to this moment of the title. */
  seekTo: (seconds: number) => void;
  /** Moves it by this much from where it says it is. Does nothing until it has said where that is. */
  skip: (deltaSeconds: number) => void;
  stop: () => void;
}>;
type Value = {
  controller: HandoffController | null;
  /** What is playing on another device, from here, or undefined when nothing is. */
  remote?: RemotePlayback;
  /** The full controls are open: the other device is asked how it is doing more often. */
  watchClosely: (closely: boolean) => void;
  /** Says what is about to be sent, so the controls can name it. */
  describe: (title: string | undefined) => void;
  /** Stops showing a destination that has ended. */
  dismiss: () => void;
};
const Ctx = createContext<Value>({controller: null, watchClosely: () => {}, describe: () => {}, dismiss: () => {}});

const store = new NativeQueueStore();
const KEY = 'playOn.sent:v1';
const idle: HandoffSnapshot = Object.freeze<HandoffSnapshot>({receivers: [], directoryPhase: 'idle', phase: 'idle'});
const noSubscribe = () => () => {};
/** How often the destination is asked how it is doing while its controls are on screen, and while the full controls are open. */
const WATCH_MS = 5000;
const WATCH_CLOSELY_MS = 2000;

export function PlayOnProvider({children}: {children: React.ReactNode}) {
  const {api, session} = useSession();
  const viewer = hasRealOrigin(api) ? viewerKey(session, api) : '';
  const [sent, setSent] = useState<SentPlayback>();
  const title = useRef<string | undefined>(undefined);
  const reconnecting = useRef<string | undefined>(undefined);
  const controller = useMemo(() => {
    if (!viewer) return null;
    let id = 'apple-controller';
    let name = deviceModelName;
    void profileInstallation().then(v => { if (v) id = v; }, () => {});
    void deviceIdentity().then(d => { name = d.deviceName; }, () => {});
    const made = new HandoffController({
      api,
      device: {get deviceId() { return id; }, get displayName() { return name; }},
      requestId: () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2),
    });
    // A handoff this device has just committed is kept, so a later launch can pick its controls
    // back up. One the controller reconnected to (`reconnecting`) is already kept as it was.
    let known: string | undefined;
    made.subscribe(() => {
      const now = made.getSnapshot();
      if (now.phase !== 'done' || !now.handoffId || now.handoffId === known) return;
      known = now.handoffId;
      if (now.handoffId === reconnecting.current) return;
      const record: SentPlayback = {viewer, handoffId: now.handoffId, device: now.target?.displayName ?? '', ...(title.current ? {title: title.current} : {}), at: Date.now()};
      setSent(record);
      void store.change(KEY, () => ({record, value: undefined})).catch(() => {});
    });
    return made;
    // The viewer key stays the same when the sign-in is renewed; the API object is the session's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);
  useEffect(() => () => controller?.dispose(), [controller]);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? (() => idle));

  // A handoff this viewer committed before the app was closed is picked up again.
  useEffect(() => {
    setSent(undefined);
    if (!controller || !viewer) return;
    let live = true;
    void store.change<SentPlayback | undefined>(KEY, raw => ({record: raw, value: readSentPlayback(raw, viewer, Date.now())})).then(async saved => {
      if (!live || !saved || controller.getSnapshot().phase !== 'idle') return;
      reconnecting.current = saved.handoffId;
      const playing = await controller.reconnect(saved.handoffId);
      if (!live) return;
      if (playing) setSent(saved);
      else void store.change(KEY, raw => ({record: readSentPlayback(raw, viewer, Date.now())?.handoffId === saved.handoffId ? null : raw, value: undefined})).catch(() => {});
    }, () => {});
    return () => { live = false; };
  }, [controller, viewer]);

  const playbackId = state.phase === 'done' ? state.receiverPlaybackId : undefined;
  const ended = state.remoteSession?.state === 'ended';
  const showing = !!controller && !!playbackId && !!sent && !ended;
  // While the controls are on screen the destination is asked how it is doing, so a pause, a seek
  // or a stop made with its own remote shows here too: its state from the session, and its
  // position and what this profile may do to it from the profile's playback controls.
  const [heard, setReport] = useState<RemoteReport>();
  // What was heard of an earlier destination says nothing of this one.
  const report = heard && heard.sessionId === playbackId && !ended ? heard : undefined;
  const [closely, setClosely] = useState(false);
  const readNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!controller || !playbackId || ended) { readNow.current = () => {}; return; }
    let live = true;
    const controls = playbackControlsService(<T,>(path: string, method?: string, body?: unknown) => api.request<T>(path, method, body));
    const read = () => {
      void controller.refreshRemote();
      // A server without this list, or a read that fails, leaves what was last heard on screen.
      void controls.remote().then(page => { if (live) setReport(held => newerReport(held, remoteReport(page.items, playbackId))); }, () => {});
    };
    readNow.current = read;
    read();
    const timer = setInterval(() => { if (AppState.currentState === 'active') read(); }, closely ? WATCH_CLOSELY_MS : WATCH_MS);
    return () => { live = false; clearInterval(timer); };
  }, [controller, playbackId, ended, api, closely]);
  // The length of the title that is playing there, from the server's record of the title.
  const reportedItem = report?.itemId;
  const [duration, setDuration] = useState<{itemId: string; seconds: number}>();
  useEffect(() => {
    if (!reportedItem) return;
    let live = true;
    void api.item(reportedItem).then(item => { if (live) setDuration({itemId: reportedItem, seconds: Number.isFinite(item.duration) && item.duration > 0 ? item.duration : 0}); }, () => {});
    return () => { live = false; };
  }, [api, reportedItem]);
  const forget = useCallback(() => {
    setSent(undefined);
    void store.change(KEY, () => ({record: null, value: undefined})).catch(() => {});
  }, []);
  // Stopped from here, or ended over there: nothing is left to control, and nothing to pick up later.
  useEffect(() => { if (sent && (ended || (state.phase === 'idle' && !state.receiverPlaybackId))) forget(); }, [sent, ended, state.phase, state.receiverPlaybackId, forget]);

  const describe = useCallback((next: string | undefined) => { title.current = next; }, []);
  const durationSeconds = duration && duration.itemId === reportedItem ? duration.seconds : 0;
  const remote = useMemo<RemotePlayback | undefined>(() => {
    if (!showing || !sent || !controller) return undefined;
    // Each thing asked of the other device is followed at once by a fresh reading of it.
    const then = (work: Promise<boolean>) => { void work.then(() => readNow.current(), () => {}); };
    return {
      device: sent.device || state.target?.displayName || '', title: report?.title ?? sent.title, paused: state.remoteSession?.state === 'paused', busy: !!state.controlling, message: state.message,
      ...(report ? {positionSeconds: report.positionSeconds} : {}), durationSeconds,
      allows: action => remoteAllows(report, action),
      pause: () => then(controller.pause()),
      resume: () => then(controller.play()),
      seekTo: seconds => then(controller.seek(Math.max(0, durationSeconds > 0 ? Math.min(durationSeconds, seconds) : seconds))),
      skip: delta => { const target = remoteSkipTarget(report, delta, durationSeconds); if (target !== undefined) then(controller.seek(target)); },
      stop: () => { void controller.stop(); },
    };
  }, [showing, sent, controller, state.target, state.remoteSession, state.controlling, state.message, report, durationSeconds]);
  const value = useMemo(() => ({controller, remote, watchClosely: setClosely, describe, dismiss: forget}), [controller, remote, describe, forget]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayOn(): Value {
  return useContext(Ctx);
}

/** The Play on controller and its state, for the screen that chooses a destination. */
export function usePlayOnController(): {controller: HandoffController | null; state: HandoffSnapshot; describe: Value['describe']} {
  const {controller, describe} = useContext(Ctx);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? (() => idle));
  return {controller, state, describe};
}
