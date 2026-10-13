/**
 * The one owner of links from outside the app (Spec — Link Contract; navigation contract,
 * deep links and external intents): a home-screen card, Spotlight, Siri, Handoff, a universal
 * link. The launch link is read once per process. A link that arrives before the shell can open
 * it (the saved sign-in is still being confirmed, a profile is being chosen, nobody is signed
 * in yet) is held: at most one, the newest. It is opened exactly once, by the shell of the
 * viewer it arrived under, and is discarded when another viewer is chosen or after ten minutes.
 * The launch link is the launch's: the system may be slow to hand it over, so its time and its
 * viewer are those of the moment the reading began, and a link that arrives meanwhile replaces it.
 * A link stays the owner's until the shell says it has taken it: a shell that goes away before
 * then (it was replaced as the link was handed over) leaves the link for the next one. The same
 * link handed over twice by the system (once as the launch link, once as an event) opens once.
 * A link is never authorisation: the shell and the server still decide what it may open.
 *
 * No React Native imports: tested under Node (test/pending-link.test.ts). The app's instance
 * and its wiring are in `link-intents.ts`.
 */

/** How long a held link waits for its shell. */
export const PENDING_LINK_LIFETIME_MS = 10 * 60 * 1000;
/** The same link again within this long is the same delivery, not a second request. */
export const DUPLICATE_LINK_WINDOW_MS = 5 * 1000;
/** The launch link is also sent as an event a little after launch on Apple; that copy can trail further. */
export const DUPLICATE_LAUNCH_WINDOW_MS = 10 * 1000;

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
/** The launch link while the system is still being asked for it. */
type Reserved = {at: number; viewer: string | null};
/** `taken` is called by the shell at the moment it acts on the link; until then the link is still
 * the owner's. It answers false when the link is no longer this shell's to open (a newer link
 * replaced it, or another viewer was chosen), and the shell then does nothing. */
type Target = Readonly<{viewer: string; open: (url: string, taken: () => boolean) => void}>;
/** The last link accepted, to recognise the system handing the same one over twice. */
type Accepted = {url: string; at: number; window: number};

export class PendingLinkOwner {
  private readonly now: () => number;
  private initialClaimed = false;
  private viewer: string | null = null;
  private held: Held | undefined;
  private initial: Reserved | undefined;
  private target: Target | undefined;
  /** Handed to a shell that has not yet said it took it. */
  private handing: {held: Held; target: Target} | undefined;
  private accepted: Accepted | undefined;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** True the first time only: the caller then reads the launch link and hands the answer to
   * `offerInitial`. The link's place is kept from now: this moment and this viewer are its own. */
  claimInitial(): boolean {
    if (this.initialClaimed) return false;
    this.initialClaimed = true;
    this.initial = {at: this.now(), viewer: this.viewer};
    return true;
  }

  /** The launch link, once the system has answered (null: there was none, or it could not be
   * read). Ignored if another viewer was chosen, or a newer link arrived, while it was being read. */
  offerInitial(url: string | null | undefined): void {
    const reserved = this.initial;
    this.initial = undefined;
    if (!url || !routedLink(url)) return;
    // The event copy of this very link got here first: this is that link again.
    if (this.repeated(url)) return;
    if (!reserved) return;
    this.accepted = {url, at: this.now(), window: DUPLICATE_LAUNCH_WINDOW_MS};
    this.held = {url, at: reserved.at, viewer: reserved.viewer};
    this.flush();
  }

  /** Whether `url` is the link accepted a moment ago, handed over a second time. */
  private repeated(url: string): boolean {
    const last = this.accepted;
    return !!last && last.url === url && this.now() - last.at <= last.window;
  }

  /**
   * The viewer selected now, or null (signed out, or between viewers while one is confirmed).
   * A held link belongs to the viewer it arrived under, or to the first one chosen when it
   * arrived with nobody signed in; choosing a different viewer discards it at once.
   */
  setViewer(viewer: string | null): void {
    this.viewer = viewer;
    if (viewer === null) return;
    if (this.held) {
      if (this.held.viewer === null) this.held.viewer = viewer;
      else if (this.held.viewer !== viewer) this.held = undefined;
    }
    // A link on its way to another viewer's shell goes with that shell.
    if (this.handing && this.handing.target.viewer !== viewer) this.handing = undefined;
    // The same for the launch link while it is still being read.
    if (this.initial) {
      if (this.initial.viewer === null) this.initial.viewer = viewer;
      else if (this.initial.viewer !== viewer) this.initial = undefined;
    }
  }

  /** A link arrived. It replaces any link still held (and the launch link, if that is still
   * being read), and opens now if a shell is ready. The link accepted a moment ago, arriving
   * again, is the same delivery and changes nothing. */
  offer(url: string | null | undefined): void {
    if (!url || !routedLink(url)) return;
    if (this.repeated(url)) return;
    this.accepted = {url, at: this.now(), window: DUPLICATE_LINK_WINDOW_MS};
    this.initial = undefined;
    // A link still on its way to a shell is replaced too: only the newest is opened.
    this.handing = undefined;
    this.held = {url, at: this.now(), viewer: this.viewer};
    this.flush();
  }

  /**
   * The shell can open links for `viewer` (its server is confirmed). A held link opens now if it
   * is this viewer's and still fresh. `open` receives the link and a `taken` to call when it
   * acts on it; if this shell goes away first, the link is kept for the next shell. Returns the
   * detach for when that shell goes away.
   */
  attach(viewer: string, open: (url: string, taken: () => boolean) => void): () => void {
    const target: Target = {viewer, open};
    this.target = target;
    this.flush();
    return () => {
      if (this.target === target) this.target = undefined;
      // Handed over but never taken: it is held again, unless a newer link has replaced it.
      const handing = this.handing;
      if (handing?.target === target) {
        this.handing = undefined;
        // It was this viewer's shell that was about to open it, so it is this viewer's link.
        this.held ??= {...handing.held, viewer: handing.held.viewer ?? target.viewer};
      }
    };
  }

  /** Hands the held link to the shell, or discards it (expired, or another viewer's). It is
   * consumed when the shell takes it. */
  private flush(): void {
    const held = this.held, target = this.target;
    if (!held || !target) return;
    this.held = undefined;
    if (this.now() - held.at > PENDING_LINK_LIFETIME_MS) return;
    if (held.viewer !== null && held.viewer !== target.viewer) return;
    const handing = {held, target};
    this.handing = handing;
    target.open(held.url, () => {
      if (this.handing !== handing) return false;
      this.handing = undefined;
      return true;
    });
  }
}

/**
 * Links for a screen that is not the shell: a provider sign-in's return, or an invitation that
 * arrives while nobody is signed in. The newest is kept for a while; whoever is listening gets
 * each link once, at once if they are already there and on arrival otherwise.
 */
export class LinkInbox {
  private readonly now: () => number;
  private readonly lifetime: number;
  private held: {url: string; at: number} | undefined;
  private listeners = new Set<(url: string) => void>();

  constructor(lifetime: number = PENDING_LINK_LIFETIME_MS, now: () => number = () => Date.now()) {
    this.lifetime = lifetime;
    this.now = now;
  }

  offer(url: string, at: number = this.now()): void {
    const listener = [...this.listeners].pop();
    if (listener) { this.held = undefined; listener(url); return; }
    this.held = {url, at};
  }

  /** Forgets a link nobody took (the moment it was for has passed). */
  clear(): void {
    this.held = undefined;
  }

  /** The newest listener receives links; a link already waiting is delivered now if still fresh. */
  subscribe(listener: (url: string) => void): () => void {
    this.listeners.add(listener);
    const held = this.held;
    if (held) {
      this.held = undefined;
      if (this.now() - held.at <= this.lifetime) listener(held.url);
    }
    return () => { this.listeners.delete(listener); };
  }
}

/**
 * What a link's own lookups (the title, where it opens) may do when they finally answer. An
 * answer is used only by the shell of the viewer the link was opened for, and only while that
 * link is still the latest one opened: a result for an earlier viewer, a shell that has gone or
 * a link since replaced is dropped.
 */
export class LinkFence {
  private viewer: string | null = null;
  private generation = 0;

  /** The viewer whose shell can open links now; null when there is none (or it has gone). */
  setViewer(viewer: string | null): void {
    if (viewer === this.viewer) return;
    this.viewer = viewer;
    this.generation++;
  }

  /** A link starts opening. Returns the check its late results must pass before they act. */
  begin(): () => boolean {
    const generation = ++this.generation, viewer = this.viewer;
    return () => viewer !== null && this.generation === generation && this.viewer === viewer;
  }
}

/**
 * Whether the screen a link asks for is the one already showing. Opening the same link twice
 * (pressing the same card again, the system repeating itself) must not stack the page twice.
 */
export function alreadyShowing(top: {name: string; params?: unknown} | undefined, name: string, params?: unknown): boolean {
  if (!top || top.name !== name) return false;
  const plain = (value: unknown) => JSON.stringify(value ?? {}, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
  try { return plain(top.params) === plain(params); } catch { return false; }
}
