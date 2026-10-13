import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {HandoffController, type HandoffSnapshot} from '../../../../packages/client-core/src/index';
import {NativeQueueStore} from '../bridge/queue-storage';
import {profileInstallation} from '../bridge/profile-trust';
import {deviceIdentity} from '../bridge/setup-codes';
import {deviceModelName} from '../bridge/device-platform';
import {committedHandoffId, readSentPlayback, type SentPlayback} from './play-on-memory';
import {hasRealOrigin, useSession} from './session';
import {viewerKey} from './viewer-scope';

/**
 * Play on, kept for as long as someone is signed in: one controller that sends this device's
 * playback to another of the profile's devices and then stays with it, so the title that moved
 * to the television can still be paused, resumed, started over and stopped from here. It is
 * picked up again after the app was closed (the handoff is remembered on this device; the server
 * decides whether it is still this viewer's to control).
 */
type Value = {
  controller: HandoffController | null;
  /** What is playing on another device, from here: its name and the title, or undefined when nothing is. */
  remote?: {device: string; title?: string; paused: boolean; busy: boolean; message?: string};
  /** Says what is about to be sent, so the controls can name it. */
  describe: (title: string | undefined) => void;
  /** Stops showing a destination that has ended. */
  dismiss: () => void;
};
const Ctx = createContext<Value>({controller: null, describe: () => {}, dismiss: () => {}});

const store = new NativeQueueStore();
const KEY = 'playOn.sent:v1';
const idle: HandoffSnapshot = Object.freeze<HandoffSnapshot>({receivers: [], directoryPhase: 'idle', phase: 'idle'});
const noSubscribe = () => () => {};
/** How often the destination is asked how it is doing while its controls are on screen. */
const WATCH_MS = 5000;

export function PlayOnProvider({children}: {children: React.ReactNode}) {
  const {api, session} = useSession();
  const viewer = hasRealOrigin(api) ? viewerKey(session, api) : '';
  const [sent, setSent] = useState<SentPlayback>();
  const title = useRef<string | undefined>(undefined);
  const controller = useMemo(() => {
    if (!viewer) return null;
    let id = 'apple-controller';
    let name = deviceModelName;
    void profileInstallation().then(v => { if (v) id = v; }, () => {});
    void deviceIdentity().then(d => { name = d.deviceName; }, () => {});
    let made: HandoffController | undefined;
    const remember = (handoffId: string) => {
      const record: SentPlayback = {viewer, handoffId, device: made?.getSnapshot().target?.displayName ?? '', ...(title.current ? {title: title.current} : {}), at: Date.now()};
      setSent(record);
      void store.change(KEY, () => ({record, value: undefined})).catch(() => {});
    };
    made = new HandoffController({
      // The same transport, watched for the one answer that says a handoff was committed: the
      // controller does not say which handoff it was, and that is what a later launch asks for.
      api: {
        request: async <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
          const answer = await api.request<T>(path, method, body, signal);
          const committed = committedHandoffId(path, method ?? 'GET', answer);
          if (committed) remember(committed);
          return answer;
        },
        requestRaw: (path, method, options) => api.requestRaw(path, method, options),
      },
      device: {get deviceId() { return id; }, get displayName() { return name; }},
      requestId: () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2),
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
  // While the controls are on screen the destination is asked how it is doing, so a pause or a
  // stop made with its own remote shows here too.
  useEffect(() => {
    if (!controller || !playbackId || ended) return;
    void controller.refreshRemote();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void controller.refreshRemote(); }, WATCH_MS);
    return () => clearInterval(timer);
  }, [controller, playbackId, ended]);
  const forget = useCallback(() => {
    setSent(undefined);
    void store.change(KEY, () => ({record: null, value: undefined})).catch(() => {});
  }, []);
  // Stopped from here, or ended over there: nothing is left to control, and nothing to pick up later.
  useEffect(() => { if (sent && (ended || (state.phase === 'idle' && !state.receiverPlaybackId))) forget(); }, [sent, ended, state.phase, state.receiverPlaybackId, forget]);

  const describe = useCallback((next: string | undefined) => { title.current = next; }, []);
  const remote = useMemo(() => (showing && sent ? {device: sent.device || state.target?.displayName || '', title: sent.title, paused: state.remoteSession?.state === 'paused', busy: !!state.controlling, message: state.message} : undefined),
    [showing, sent, state.target, state.remoteSession, state.controlling, state.message]);
  const value = useMemo(() => ({controller, remote, describe, dismiss: forget}), [controller, remote, describe, forget]);
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
