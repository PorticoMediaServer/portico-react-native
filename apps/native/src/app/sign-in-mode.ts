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
 * What a sign-in does to the viewer is told here by the session itself, not read from what happens
 * to be on screen. While a new viewer is being checked the one signed in is set aside for a
 * moment (`handoff`): that is not their sign-in ending, so the sign-in stays on screen with all it
 * kept, and Back waits for the handoff to finish (the old viewer is put back, or the new one is in).
 * A sign-in the person made that is accepted (`signedIn`) ends the mode, even when it is the same
 * server, account and profile again. Signing out ends the handoff at once, and the mode with it.
 *
 * No React Native imports: tested under Node (test/sign-in-mode.test.ts).
 */

/** What the sign-in is: the account's servers (opening `serverId` at once), or one server by its address. */
export type SignInRequest = Readonly<{kind: 'switch'; serverId?: string} | {kind: 'direct'}>;

export class SignInMode {
  private mode: {request: SignInRequest; viewer: string} | undefined;
  private shell: {viewer: string; state: unknown} | undefined;
  private opener: {viewer: string; key: string} | undefined;
  /** Viewers being handed over now (a new viewer's check, or the old one put back). */
  private handoffs = 0;
  /** Back was pressed during a handoff: the mode ends when it does. */
  private leaving = false;
  private readonly listeners = new Set<() => void>();

  /** Begin a sign-in for the signed-in `viewer` (`linkViewerKey`); `opener` names the control it was opened from. */
  open(viewer: string | null, request: SignInRequest, opener?: string): void {
    if (!viewer) return;
    this.mode = {request, viewer};
    this.leaving = false;
    this.shell = undefined;
    this.opener = opener ? {viewer, key: opener} : undefined;
    this.emit();
  }

  /** Leave the sign-in: back to the viewer signed in (once a handoff under way has finished). */
  close(): void {
    if (!this.mode) return;
    if (this.handoffs) { this.leaving = true; return; }
    this.mode = undefined;
    this.emit();
  }

  /**
   * The sign-in under way for this viewer; none for another viewer. Nobody (null) has one only
   * while a viewer is being handed over: the viewer it belongs to is set aside, not signed out.
   */
  current(viewer: string | null): SignInRequest | undefined {
    if (!this.mode) return undefined;
    if (viewer === null) return this.handoffs ? this.mode.request : undefined;
    return this.mode.viewer === viewer ? this.mode.request : undefined;
  }

  /** Whether a viewer is being handed over now. */
  handingOver = (): boolean => this.handoffs > 0;

  /**
   * The session sets the viewer signed in aside to check a new one (the commit's fence). Returns
   * its end, called once: when the new viewer is in or the old one is back, or when signing out
   * abandons it.
   */
  handoff(): () => void {
    this.handoffs++;
    this.emit();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.handoffs--;
      if (!this.handoffs && this.leaving) { this.leaving = false; this.mode = undefined; }
      this.emit();
    };
  }

  /** A sign-in the person made was accepted: the mode is over, and nothing kept for its return is offered. */
  signedIn(): void {
    this.shell = undefined;
    this.opener = undefined;
    this.leaving = false;
    if (!this.mode) return;
    this.mode = undefined;
    this.emit();
  }

  /**
   * The server the sign-in was opened for (a named server) has been opened: from now on it is the
   * account's servers, so coming back to them (cancelling that server's profiles, say) lists them
   * rather than opening it again.
   */
  targetOpened = (): void => {
    if (this.mode?.request.kind !== 'switch' || this.mode.request.serverId === undefined) return;
    this.mode = {...this.mode, request: {kind: 'switch'}};
    this.emit();
  };

  /**
   * The viewer now signed in (null: nobody): a sign-in, a kept shell or an opener of anyone else's is
   * forgotten. Nothing is decided during a handoff: nobody is signed in for that moment only.
   */
  settle(viewer: string | null): void {
    if (this.handoffs) return;
    if (this.shell && this.shell.viewer !== viewer) this.shell = undefined;
    if (this.opener && this.opener.viewer !== viewer) this.opener = undefined;
    if (this.mode && this.mode.viewer !== viewer) { this.mode = undefined; this.leaving = false; this.emit(); }
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
