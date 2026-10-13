import {useEffect} from 'react';
import {Linking} from 'react-native';
import {parseJoinLink} from '../app/join-link';
import {LinkInbox, PendingLinkOwner, linkViewerKey} from './pending-link';

/** The app's pending-link owner (see `pending-link.ts`). One per process: it outlives the shell,
 * which is replaced whenever the viewer is confirmed or changed. */
export const linkIntents = new PendingLinkOwner();

/** A provider sign-in's return to this device, for the Portico Account sign-in screen. */
export const accountReturns = new LinkInbox();

/** How long an invitation waits for someone to sign in: creating an account can take a while. */
export const INVITATION_LIFETIME_MS = 30 * 60 * 1000;
/** A server's invitation that arrived with nobody signed in, for the sign-in screens. Once a
 * viewer is chosen the shell opens the invitation itself, and nothing is kept here. */
export const signedOutInvitations = new LinkInbox(INVITATION_LIFETIME_MS);

let viewer: string | null = null;

/** Every link from outside the app comes through here, whatever is on screen. */
function received(url: string | null | undefined, launch: boolean): void {
  if (url && url.startsWith('portico://account-return')) {
    if (launch) linkIntents.offerInitial(null);
    accountReturns.offer(url);
    return;
  }
  if (url && viewer === null && parseJoinLink(url)) signedOutInvitations.offer(url);
  if (launch) linkIntents.offerInitial(url);
  else linkIntents.offer(url);
}

/**
 * Listens for links for as long as the app runs, above the shell and the sign-in screens, so a
 * link that arrives while neither can open it is held instead of lost. This is the only place
 * the launch link is read and the only listener for links: the shell and the sign-in screens
 * are handed theirs from here.
 */
export function useLinkIntake(session: Parameters<typeof linkViewerKey>[0]): void {
  const key = linkViewerKey(session);
  useEffect(() => {
    viewer = key;
    linkIntents.setViewer(key);
    if (key !== null) signedOutInvitations.clear();
  }, [key]);
  useEffect(() => {
    // The answer can be slow; the owner keeps the link's place (its time and viewer) from now.
    if (linkIntents.claimInitial()) void Linking.getInitialURL().then(url => received(url, true), () => received(null, true));
    const subscription = Linking.addEventListener('url', event => received(event.url, false));
    return () => subscription.remove();
  }, []);
}
