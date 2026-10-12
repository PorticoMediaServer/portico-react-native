import {useEffect} from 'react';
import {Linking} from 'react-native';
import {PendingLinkOwner, linkViewerKey} from './pending-link';

/** The app's pending-link owner (see `pending-link.ts`). One per process: it outlives the shell,
 * which is replaced whenever the viewer is confirmed or changed. */
export const linkIntents = new PendingLinkOwner();

/**
 * Listens for links for as long as the app runs, above the shell and the sign-in screens, so a
 * link that arrives while neither can open it is held instead of lost. The launch link is read
 * here, once; the shell no longer reads it each time it mounts.
 */
export function useLinkIntake(viewer: Parameters<typeof linkViewerKey>[0]): void {
  const key = linkViewerKey(viewer);
  useEffect(() => { linkIntents.setViewer(key); }, [key]);
  useEffect(() => {
    // The answer can be slow; the owner keeps the link's place (its time and viewer) from now.
    if (linkIntents.claimInitial()) void Linking.getInitialURL().then(url => linkIntents.offerInitial(url), () => linkIntents.offerInitial(null));
    const subscription = Linking.addEventListener('url', event => linkIntents.offer(event.url));
    return () => subscription.remove();
  }, []);
}
