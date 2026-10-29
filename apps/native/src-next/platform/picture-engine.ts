import {Platform} from 'react-native';

/** Which element draws artwork (P2-70 LIB-1, the expo-image spike). React Native's Image stays the
 * default until expo-image passes the memory gate on a 2 GB Android phone. Phones and tablets only:
 * televisions keep React Native's Image, and Vega replaces this file. A build can start on expo-image
 * with globalThis.__PORTICO_PICTURE_ENGINE__ = 'expo'; debug builds also have a dev-menu switch. */
export type PictureEngine = 'react-native' | 'expo';

declare global {var __PORTICO_PICTURE_ENGINE__: PictureEngine | undefined;}

let engine: PictureEngine = globalThis.__PORTICO_PICTURE_ENGINE__ === 'expo' ? 'expo' : 'react-native';
const listeners = new Set<() => void>();

export function pictureEngine(): PictureEngine {
  return engine === 'expo' && !Platform.isTV ? 'expo' : 'react-native';
}
export function setPictureEngine(next: PictureEngine) {
  if (engine === next) return;
  engine = next;
  for (const listener of [...listeners]) listener();
}
export function subscribePictureEngine(listener: () => void) {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
