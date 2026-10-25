import {dispatchRegisteredOverlayKey} from '../../../../../native/src-next/platform/overlay-keys';

type MenuKey = {eventType?: string; eventKeyAction?: number};
let focused: {owner: object; run: () => void} | undefined;
export function registerFocusedMenu(owner: object, run: () => void): () => void {
  const registration = {owner, run}; focused = registration;
  return () => {if (focused === registration) focused = undefined;};
}
/** Physical Menu, distinct from the Apple vocabulary's menu (Back). */
export function dispatchMenuKey(event: MenuKey | undefined): boolean {
  if (!['menu', 'context_menu'].includes(event?.eventType ?? '') || event?.eventKeyAction !== 1) return false;
  if (focused) {focused.run(); return true;}
  return dispatchRegisteredOverlayKey('menu');
}
/** Root's MenuKey listens to the SDK's raw events once. */
export function useMenuKey(): void {}
