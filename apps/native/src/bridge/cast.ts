import {useEffect, useState} from 'react';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

/**
 * IOS-PLAYER-03: the Google Cast transport on iPhone/iPad (`Native/PorticoCast.m`). It moves JSON
 * on Portico's Cast channel and reports the session; the sender protocol itself (pair with a
 * one-use code from `POST /v1/cast/bootstrap`, then load/play/seek, takeover and replaced) is
 * client-core's, shared with web (`packages/client-core/src/cast/`, F-core), and is plugged in
 * through this interface. Television never casts.
 */
export type CastSessionEvent = {state: 'started' | 'ended' | 'failed'; deviceName: string; error: string};

type Native = {
  available(): Promise<boolean>;
  current(): Promise<{deviceName: string} | null>;
  choose(): void;
  send(json: string): Promise<boolean>;
  end(stopReceiver: boolean): void;
};

const native = !Platform.isTV ? (NativeModules.PorticoCast as Native | undefined) : undefined;
const emitter = native ? new NativeEventEmitter(NativeModules.PorticoCast) : null;

/** The transport the shared protocol drives: `send(json)`, `onMessage`, `onSessionEnd`. */
export const castTransport = {
  send: (message: unknown) => (native ? native.send(JSON.stringify(message)).then(() => undefined) : Promise.reject(Object.assign(new Error('Cast is unavailable.'), {code: 'cast_unavailable'}))),
  onMessage: (listener: (message: unknown) => void) => {
    const sub = emitter?.addListener('PorticoCastMessage', (event: {message: string}) => {
      try { listener(JSON.parse(event.message)); } catch { /* not JSON: ignored */ }
    });
    return () => sub?.remove();
  },
  onSessionEnd: (listener: () => void) => {
    const sub = emitter?.addListener('PorticoCastSession', (event: CastSessionEvent) => { if (event.state !== 'started') listener(); });
    return () => sub?.remove();
  },
  end: (stopReceiver = false) => native?.end(stopReceiver),
};

/** Open the system's Cast device chooser. */
export const chooseCastDevice = () => native?.choose();

/** Whether this build can cast (an application id was configured), and the connected device. */
export function useCast(): {available: boolean; deviceName?: string} {
  const [available, setAvailable] = useState(false);
  const [deviceName, setDeviceName] = useState<string>();
  useEffect(() => {
    if (!native || !emitter) return;
    let live = true;
    native.available().then(v => live && setAvailable(v), () => {});
    native.current().then(c => live && setDeviceName(c?.deviceName), () => {});
    const sub = emitter.addListener('PorticoCastSession', (event: CastSessionEvent) => setDeviceName(event.state === 'started' ? event.deviceName : undefined));
    return () => { live = false; sub.remove(); };
  }, []);
  return {available, deviceName};
}
