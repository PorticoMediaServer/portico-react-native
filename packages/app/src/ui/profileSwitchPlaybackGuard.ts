import {useCallback, useState} from 'react';
import {usePersistentPlayback} from './playbackSession';

export function useProfileSwitchPlaybackGuard() {
  const {session} = usePersistentPlayback();
  const [pending, setPending] = useState<(() => void) | undefined>();

  const request = useCallback((switchProfile: () => void) => {
    if (!session.profileSwitchNeedsConfirmation()) {
      switchProfile();
      return false;
    }
    setPending(() => switchProfile);
    return true;
  }, [session]);

  const cancel = useCallback(() => setPending(undefined), []);
  const confirm = useCallback(() => {
    if (!pending) return;
    session.confirmProfileSwitch();
    const action = pending;
    setPending(undefined);
    action();
  }, [pending, session]);

  return {
    cancel,
    confirm,
    confirmationRequired: Boolean(pending),
    request,
  };
}
