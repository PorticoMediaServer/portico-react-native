import React, {createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore} from 'react';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {CastController, type CastMetadata, type CastSnapshot, type CastTransport} from '../../../../packages/client-core/src/cast/index';
import {castTransport} from '../bridge/cast';
import {deviceIdentity} from '../bridge/setup-codes';
import {deviceModelName} from '../bridge/device-platform';
import {hasRealOrigin, useSession} from './session';

/**
 * IOS-PLAYER-03: one Cast controller per signed-in server (client-core's shared protocol), driven
 * over the native Google Cast session. Cast is offered only on iPhone/iPad, only when the build has
 * a receiver application id, and only for a server reachable over HTTPS (a Cast device loads
 * nothing else).
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
  // How this phone introduces itself on the TV ("Sam’s iPhone"), never account details.
  const [label, setLabel] = React.useState(deviceModelName);
  useEffect(() => { void deviceIdentity().then(d => setLabel(d.deviceName)); }, []);
  const controller = useMemo(() => {
    if (!native || !origin.startsWith('https://')) return null;
    try {
      return new CastController({api, origin, displayName: label});
    } catch {
      return null;
    }
  }, [api, origin, label]);
  useEffect(() => {
    if (!controller || !native) return;
    let live = true;
    void native.available().then((ok: boolean) => live && controller.setAvailable(ok), () => {});
    return () => { live = false; controller.dispose(); };
  }, [controller]);
  const cast = useCallback((itemId: string, meta: CastMetadata, startSeconds: number, onStarted?: () => void) => {
    if (!controller || !native || !emitter) return;
    controller.connecting(meta.title);
    let done = false;
    // The system chooser reports nothing when it is dismissed without a device: give up quietly.
    const giveUp = setTimeout(() => { if (!done) { done = true; sub.remove(); controller.cancelConnecting(); } }, 90000);
    const sub = emitter.addListener('PorticoCastSession', (event: {state: string; deviceName: string}) => {
      if (done) return;
      done = true;
      clearTimeout(giveUp);
      sub.remove();
      if (event.state !== 'started') { controller.cancelConnecting(); return; }
      const transport: CastTransport = {deviceName: event.deviceName || 'TV', send: m => castTransport.send(m), onMessage: castTransport.onMessage, onSessionEnd: castTransport.onSessionEnd, end: stop => castTransport.end(stop)};
      void controller.start(transport, itemId, meta, startSeconds).then(ok => { if (ok) onStarted?.(); });
    });
    native.choose();
  }, [controller]);
  const value = useMemo(() => ({controller, cast}), [controller, cast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCastController() {
  const {controller, cast} = useContext(Ctx);
  const subscribe = useMemo(() => controller?.subscribe ?? (() => () => {}), [controller]);
  const snapshot = useSyncExternalStore(subscribe, () => controller?.getSnapshot() ?? idle);
  return {controller, snapshot, cast};
}
