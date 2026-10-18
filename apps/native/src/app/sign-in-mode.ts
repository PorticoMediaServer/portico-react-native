/**
 * Signing in elsewhere while signed in: Settings › Servers' Switch server, Connect directly, a
 * server this device knows (Justin, 18 Oct 2026). Browsing is never reachable during a sign-in:
 * the sign-in takes the whole screen and the shell is not mounted at all (no rail, no tab bar, no
 * screen, none of its providers or their requests), so a remote, a gesture or a link cannot reach
 * the libraries or titles while it is under way. Links wait for a shell (`pending-link.ts`).
 *
 * The viewer already signed in stays signed in, untouched and unused, so leaving the sign-in goes
 * back to them where they were: the shell's navigation is kept for that viewer alone, once, and
 * the row the sign-in was opened from takes focus again. The mode belongs to that viewer: a new
 * viewer (the sign-in succeeded) or none (their sign-in ended meanwhile) ends it, and what was
 * kept for them is never offered to anyone else.
 *
 * No React Native imports: tested under Node (test/sign-in-mode.test.ts).
 */

/** What the sign-in is: the account's servers (opening `serverId` at once), or one server by its address. */
export type SignInRequest = Readonly<{kind: 'switch'; serverId?: string} | {kind: 'direct'}>;

export class SignInMode {
  private mode: {request: SignInRequest; viewer: string} | undefined;
  private shell: {viewer: string; state: unknown} | undefined;
  private opener: {viewer: string; key: string} | undefined;
  private readonly listeners = new Set<() => void>();

  /** Begin a sign-in for the signed-in `viewer` (`linkViewerKey`); `opener` names the control it was opened from. */
  open(viewer: string | null, request: SignInRequest, opener?: string): void {
    if (!viewer) return;
    this.mode = {request, viewer};
    this.shell = undefined;
    this.opener = opener ? {viewer, key: opener} : undefined;
    this.emit();
  }

  /** Leave the sign-in: back to the viewer signed in. */
  close(): void {
    if (!this.mode) return;
    this.mode = undefined;
    this.emit();
  }

  /** The sign-in under way for this viewer; none for another viewer or for nobody. */
  current(viewer: string | null): SignInRequest | undefined {
    return this.mode && viewer !== null && this.mode.viewer === viewer ? this.mode.request : undefined;
  }

  /** The viewer now signed in (null: nobody): a sign-in, a kept shell or an opener of anyone else's is forgotten. */
  settle(viewer: string | null): void {
    if (this.shell && this.shell.viewer !== viewer) this.shell = undefined;
    if (this.opener && this.opener.viewer !== viewer) this.opener = undefined;
    if (this.mode && this.mode.viewer !== viewer) { this.mode = undefined; this.emit(); }
  }

  /** The shell is going because a sign-in began for its viewer: keep where it was for their return. */
  keepShell(viewer: string | null, state: unknown): void {
    if (viewer !== null && state !== undefined && this.mode?.viewer === viewer) this.shell = {viewer, state};
  }

  /** Where this viewer's shell was when a sign-in began, once, and only once the sign-in has ended. */
  takeShell(viewer: string | null): unknown {
    const kept = this.shell;
    if (!kept || viewer === null || kept.viewer !== viewer || this.mode) return undefined;
    this.shell = undefined;
    return kept.state;
  }

  /** The control the ended sign-in was opened from, for this viewer, once. */
  takeOpener(viewer: string | null): string | undefined {
    const kept = this.opener;
    if (!kept || viewer === null || kept.viewer !== viewer || this.mode) return undefined;
    this.opener = undefined;
    return kept.key;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The app's one sign-in mode. */
export const signInMode = new SignInMode();
