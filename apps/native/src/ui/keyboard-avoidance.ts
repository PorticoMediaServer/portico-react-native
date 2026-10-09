import {useSyncExternalStore} from 'react';
import {Keyboard, Platform} from 'react-native';

const enabled = () => Platform.OS !== 'android' || Keyboard.isVisible();

function subscribe(onChange: () => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const shown = Keyboard.addListener('keyboardDidShow', onChange);
  const hidden = Keyboard.addListener('keyboardDidHide', onChange);
  return () => { shown.remove(); hidden.remove(); };
}

/**
 * Android's Fabric surface can report a hidden keyboard at screenY=0. The native
 * KeyboardAvoidingView treats that as an overlap covering the whole form. Its
 * public enabled prop clears the rendered padding while the keyboard is hidden,
 * keeping its normal avoidance while typing and keeping the inputs mounted.
 * Keyboard updates its visibility before notifying these subscribers.
 */
export function useKeyboardAvoidanceEnabled(): boolean {
  return useSyncExternalStore(subscribe, enabled);
}
