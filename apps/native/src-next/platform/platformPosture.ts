import {useSyncExternalStore} from 'react';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {createPlatformPostureStore, type PlatformPostureSnapshot, type PlatformPostureTransport} from './platformPostureStore';

export type {PlatformFold, PlatformPostureBounds, PlatformPostureSnapshot} from './platformPostureStore';

const native = Platform.OS === 'android' ? NativeModules.PorticoPosture : undefined;
const transport: PlatformPostureTransport | null = native ? {
  getSnapshot: () => native.getSnapshot(),
  subscribe: listener => {
    const event = new NativeEventEmitter(native).addListener('PorticoPostureChanged', listener);
    return () => event.remove();
  },
} : null;

/** Unsupported hosts explicitly report unavailable. This module never writes app/session state. */
export const platformPosture = createPlatformPostureStore(transport);

export function usePlatformPosture(): PlatformPostureSnapshot {
  return useSyncExternalStore(platformPosture.subscribe, platformPosture.getSnapshot, platformPosture.getSnapshot);
}
