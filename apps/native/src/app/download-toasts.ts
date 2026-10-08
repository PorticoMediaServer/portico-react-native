import {AppState} from 'react-native';
import {offlineDownloads} from '../bridge/offline-downloads';
import {showToast} from '../ui';
import {activeI18n} from './errors';

/**
 * No notifications of any kind (Justin's rule): a finished download shows in the app instead, as
 * its state in Downloads (and the tab's dot while one is running) and, when the app is in front,
 * a toast. It is a module-level subscription, so no mounted component gains a hook.
 */
let started = false;
export function announceFinishedDownloads(): void {
  if (started) return;
  started = true;
  const previous = new Map<string, string>();
  let first = true;
  offlineDownloads.subscribe(() => {
    const entries = offlineDownloads.getSnapshot().entries;
    for (const entry of entries) {
      const was = previous.get(entry.id);
      previous.set(entry.id, entry.state);
      // Only a transfer seen running in this launch; what finished while the app was away just
      // shows as ready in Downloads.
      if (!first && was && was !== 'ready' && entry.state === 'ready' && AppState.currentState === 'active') {
        showToast({message: entry.title ? activeI18n().t('downloads.readyOffline', {title: entry.title}) : activeI18n().t('downloads.readyOfflineUntitled'), icon: 'download'});
      }
    }
    first = false;
  });
}
