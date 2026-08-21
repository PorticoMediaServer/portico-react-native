import {useEffect} from 'react';
import {BackHandler, Platform} from 'react-native';

export type MobileBackAction = 'close-transient' | 'navigator';

export function mobileBackAction(transientOpen: boolean): MobileBackAction {
  return transientOpen ? 'close-transient' : 'navigator';
}

/**
 * Portico only intercepts Android Back for UI layered above route history.
 * Returning false delegates ordinary route and application-exit behavior to
 * React Navigation and Android rather than maintaining a competing router.
 */
export function useMobileNavigationBack({
  closeTransient,
  transientOpen,
}: {
  closeTransient(): void;
  transientOpen: boolean;
}) {
  useEffect(() => {
    if (Platform.OS !== 'android' || Platform.isTV) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mobileBackAction(transientOpen) === 'navigator') return false;
      closeTransient();
      return true;
    });
    return () => subscription.remove();
  }, [closeTransient, transientOpen]);
}
