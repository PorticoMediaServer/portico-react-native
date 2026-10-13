import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {CastController, type CastMetadata, type CastSnapshot, type CastTransport} from '../../../../packages/client-core/src/cast/index';
import {castTransport} from '../bridge/cast';
import {castControllerStorage, castControllerStorageReady} from '../bridge/cast-controller-storage';
import {castOffered} from './cast-offered';
import {deviceIdentity} from '../bridge/setup-codes';
import {deviceModelName} from '../bridge/device-platform';
import {hasRealOrigin, useSession} from './session';

/**
 * IOS-PLAYER-03: one Cast controller per signed-in server (client-core's shared protocol), driven
 * over the native Google Cast session. Cast is offered only on iPhone/iPad, only when the server
 * names the receiver application this build was made for, and only for a server reachable over
 * HTTPS (a Cast device loads nothing else).
 */
type Value = {
  controller: CastController | null;
  /** Open the device chooser and, once a device connects, pair it and start `itemId` there. */
  cast: (itemId: string, meta: CastMetadata, startSeconds: number, onStarted?: () => void) => void;
};
const Ctx = createContext<Value>({controller: null, cast: () => {}});

const native = !Platform.isTV ? NativeModules.PorticoCast : undefined;
const emitter = native ? new NativeEventEmitter(NativeModules.PorticoCast) : null;
const idle: CastSnapshot = Object.freeze({available: false, phase: 'off', positionSeconds: 0, durationSeconds: 0, paused: false, audioTracks: [], textTracks: []});

export function CastProvider({children}: {children: React.ReactNode}) {
  const {api} = useSession();
  const origin = hasRealOrigin(api) ? api.baseUrl : '';
  // How this phone introduces itself on the TV ("Sam’s iPhone"), never account details. The
  // controller is made once the name is known, so it is not made twice: replacing a controller
  // lets go of the session it holds.
  const [label, setLabel] = React.useState<string>();
  useEffect(() => { void deviceIdentity().then(d => setLabel(d.deviceName || deviceModelName), () => setLabel(deviceModelName)); }, []);
  const controller = useMemo(() => {
    if (!native || !label || !origin.startsWith('https://')) return null;
    try {
      return new CastController({api, origin, displayName: label, controllerStorage: castControllerStorage});
    } catch {
      return null;
    }
  }, [api, origin, label]);
  // A device is being chosen for a new cast: the session that starts is paired afresh, not adopted.
  const starting = useRef(false);
  useEffect(() => {
    if (!controller || !native) return;
    let live = true;
    // Cast is offered when this build can cast and this server names the receiver application
    // this build was made for. The server's setting is the authority: with none set, or another
    // application named, there is no Cast row.
    void Promise.all([native.available() as Promise<boolean>, api.request<{applicationId?: unknown}>('/v1/cast/configuration')]).then(
      ([can, configuration]) => { if (live) controller.setAvailable(castOffered(can, configuration?.applicationId, native.applicationId)); },
      () => { if (live) controller.setAvailable(false); },
    );
    return () => { live = false; controller.dispose(); };
  }, [controller, api]);
  // A session the system kept while the app was away, or resumed by itself, is taken back with the
  // proof this installation holds: the same playback, no new pairing, nothing started over. When
  // the television does not accept it, the session is left exactly as it was.
  useEffect(() => {
    if (!controller || !native || !emitter) return;
    let live = true;
    const describe = (itemId: string) => api.item(itemId).then(item => item.title, () => undefined);
    const adopt = (deviceName: string) => {
      if (!live || starting.current || controller.getSnapshot().phase !== 'off') return;
      void controller.adopt(transportFor(deviceName), describe);
    };
    void castControllerStorageReady.then(() => native.current() as Promise<{deviceName: string} | null>).then(current => { if (current) adopt(current.deviceName); }, () => {});
    const sub = emitter.addListener('PorticoCastSession', (event: {state: string; deviceName: string}) => { if (event.state === 'started') void castControllerStorageReady.then(() => adopt(event.deviceName)); });
    return () => { live = false; sub.remove(); };
  }, [controller, api]);
  const cast = useCallback((itemId: string, meta: CastMetadata, startSeconds: number, onStarted?: () => void) => {
    if (!controller || !native || !emitter) return;
    controller.connecting(meta.title);
    starting.current = true;
    let done = false;
    // The system chooser reports nothing when it is dismissed without a device: give up quietly.
    const giveUp = setTimeout(() => { if (!done) { done = true; starting.current = false; sub.remove(); controller.cancelConnecting(); } }, 90000);
    const sub = emitter.addListener('PorticoCastSession', (event: {state: string; deviceName: string}) => {
      if (done) return;
      done = true;
      clearTimeout(giveUp);
      sub.remove();
      if (event.state !== 'started') { starting.current = false; controller.cancelConnecting(); return; }
      void controller.start(transportFor(event.deviceName), itemId, meta, startSeconds).then(ok => { if (ok) onStarted?.(); }).finally(() => { starting.current = false; });
    });
    native.choose();
  }, [controller]);
  const value = useMemo(() => ({controller, cast}), [controller, cast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shared protocol's transport over the native session to one television. */
function transportFor(deviceName: string): CastTransport {
  return {deviceName: deviceName || 'TV', send: m => castTransport.send(m), onMessage: castTransport.onMessage, onSessionEnd: castTransport.onSessionEnd, end: stop => castTransport.end(stop)};
}

export function useCastController() {
  const {controller, cast} = useContext(Ctx);
  const subscribe = useMemo(() => controller?.subscribe ?? (() => () => {}), [controller]);
  const snapshot = useSyncExternalStore(subscribe, () => controller?.getSnapshot() ?? idle);
  return {controller, snapshot, cast};
}
