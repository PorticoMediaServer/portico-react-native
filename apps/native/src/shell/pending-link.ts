/**
 * The one owner of links from outside the app (Spec — Link Contract; navigation contract,
 * deep links and external intents): a home-screen card, Spotlight, Siri, Handoff, a universal
 * link. The launch link is read once per process. A link that arrives before the shell can open
 * it (the saved sign-in is still being confirmed, a profile is being chosen, nobody is signed
 * in yet) is held: at most one, the newest. It is opened exactly once, by the shell of the
 * viewer it arrived under, and is discarded when another viewer is chosen or after ten minutes.
 * A link is never authorisation: the shell and the server still decide what it may open.
 *
 * No React Native imports: tested under Node (test/pending-link.test.ts). The app's instance
 * and its wiring are in `link-intents.ts`.
 */

/** How long a held link waits for its shell. */
export const PENDING_LINK_LIFETIME_MS = 10 * 60 * 1000;

/** The destinations the shell routes. The shell still checks each link's exact form; this only
 * keeps a link meant for something else (a sign-in's return) from replacing one that is held. */
const ROUTED = /^portico:\/\/(?:item|play|device|account|together|join|invite)(?:[/?#]|$)/;
export const routedLink = (url: string): boolean => ROUTED.test(url);

type ViewerIdentity = Readonly<{authority: string; accountId?: string | null; profileId?: string | null; serverId: string}>;
/** Who a link belongs to: authority, account, profile and server. Null when nobody is signed in. */
export function linkViewerKey(viewer: ViewerIdentity | null | undefined): string | null {
  return viewer ? JSON.stringify([viewer.authority, viewer.accountId ?? '', viewer.profileId ?? '', viewer.serverId]) : null;
}

type Held = {url: string; at: number; viewer: string | null};
type Target = Readonly<{viewer: string; open: (url: string) => void}>;

export class PendingLinkOwner {
  private readonly now: () => number;
  private initialClaimed = false;
  private viewer: string | null = null;
  private held: Held | undefined;
  private target: Target | undefined;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** True the first time only: the caller then reads the launch link and offers it. */
  claimInitial(): boolean {
    if (this.initialClaimed) return false;
    this.initialClaimed = true;
    return true;
  }

  /**
   * The viewer selected now, or null (signed out, or between viewers while one is confirmed).
   * A held link belongs to the viewer it arrived under, or to the first one chosen when it
   * arrived with nobody signed in; choosing a different viewer discards it at once.
   */
  setViewer(viewer: string | null): void {
    this.viewer = viewer;
    if (viewer === null || !this.held) return;
    if (this.held.viewer === null) this.held.viewer = viewer;
    else if (this.held.viewer !== viewer) this.held = undefined;
  }

  /** A link arrived. It replaces any link still held, and opens now if a shell is ready. */
  offer(url: string | null | undefined): void {
    if (!url || !routedLink(url)) return;
    this.held = {url, at: this.now(), viewer: this.viewer};
    this.flush();
  }

  /**
   * The shell can open links for `viewer` (its server is confirmed). A held link opens now if it
   * is this viewer's and still fresh. Returns the detach for when that shell goes away.
   */
  attach(viewer: string, open: (url: string) => void): () => void {
    const target: Target = {viewer, open};
    this.target = target;
    this.flush();
    return () => { if (this.target === target) this.target = undefined; };
  }

  /** Consumes the held link: opened once, or discarded (expired, or another viewer's). */
  private flush(): void {
    const held = this.held, target = this.target;
    if (!held || !target) return;
    this.held = undefined;
    if (this.now() - held.at > PENDING_LINK_LIFETIME_MS) return;
    if (held.viewer !== null && held.viewer !== target.viewer) return;
    target.open(held.url);
  }
}
