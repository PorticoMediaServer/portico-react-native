import {useEffect, useState} from 'react';
import {castBridge, type CastSessionEvent} from '../../src-next/platform/play-on/cast-transport';

/**
 * The Cast bridge's old entry point. The transport, its attachment policy and the one
 * native/emitter instance moved to `src-next/platform/play-on/cast-transport`, which the new app
 * imports directly; this module keeps the old public surface, and the hook and chooser the old app
 * still calls, on that same transport.
 */
export type {CastSessionEvent} from '../../src-next/platform/play-on/cast-transport';
export {castTransport, validCastAttachment} from '../../src-next/platform/play-on/cast-transport';

/** Open the system's Cast device chooser. */
export const chooseCastDevice = () => castBridge.native?.choose();

/** Whether this build can cast (an application id was configured), and the connected device. */
export function useCast(): {available: boolean; deviceName?: string} {
  const [available, setAvailable] = useState(false);
  const [deviceName, setDeviceName] = useState<string>();
  useEffect(() => {
    const native = castBridge.native, emitter = castBridge.emitter;
    if (!native || !emitter) return;
    let live = true;
    native.available().then(v => live && setAvailable(v), () => {});
    native.current().then(c => live && setDeviceName(c?.deviceName), () => {});
    const sub = emitter.addListener('PorticoCastSession', (event: CastSessionEvent) => setDeviceName(event.state === 'started' ? event.deviceName : undefined));
    return () => { live = false; sub.remove(); };
  }, []);
  return {available, deviceName};
}
