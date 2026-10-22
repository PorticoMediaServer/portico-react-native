import {Platform, useTVEventHandler} from 'react-native';
import {dispatchRegisteredOverlayKey} from './overlay-keys';

type MenuKey = {eventType?: string; eventKeyAction?: number};
let focused: {owner: object; run: () => void} | undefined;

/** Focus primitives register only an enabled control's actual long-press action. */
export function registerFocusedMenu(owner: object, run: () => void): () => void {
  const registration = {owner, run};
  focused = registration;
  return () => {if (focused === registration) focused = undefined;};
}
export function dispatchMenuKey(event: MenuKey | undefined, os = Platform.OS, isTV = Platform.isTV === true): boolean {
  if (os !== 'android' || !isTV || event?.eventType !== 'menu' || event.eventKeyAction !== 1) return false;
  if (focused) {focused.run(); return true;}
  return dispatchRegisteredOverlayKey('menu');
}
export function useMenuKey(): void {
  useTVEventHandler(event => {dispatchMenuKey(event);});
}
