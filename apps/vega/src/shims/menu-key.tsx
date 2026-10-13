import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {runFocusedMenu} from '../../../native/src/ui/Focusable';

/**
 * The remote's Menu key (≡) opens what a long press of Select opens on the focused control, and
 * does nothing on a control with no such action: as on a Fire TV that runs Android.
 *
 * It is heard here, from the SDK's own key events, and not through the shared `useMenuKey`: the
 * shared screens are given the remote in the Apple TV's vocabulary (`react-native.ts`), where
 * `menu` is the name of Back. (This file is in `shims` because only files here and in `bridge`
 * are given the SDK's own package: see `metro.config.js`.)
 */
export function MenuKey(): null {
  useTVEventHandler(event => {
    // Once per press, on release (a held key repeats its "down").
    if ((event?.eventType === 'menu' || event?.eventType === 'context_menu') && event.eventKeyAction === 1) runFocusedMenu();
  });
  return null;
}
