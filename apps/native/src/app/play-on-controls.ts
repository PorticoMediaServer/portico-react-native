import type {RemotePlaybackControls} from '../../../../packages/client-core/src/playback-controls';

/**
 * What the device a title was sent to says of itself, for the Play on controls: where it is, and
 * what this profile may do to it (`GET /v1/playback/controls`). Every value here is the playing
 * device's own, as the server last heard it. Nothing is taken from this phone's player, which is
 * not playing anything, and nothing is guessed forward between two reads.
 *
 * No React and no native code: tested under Node.
 */
export type RemoteAction = 'pause' | 'resume' | 'seek' | 'stop';
export type RemoteReport = Readonly<{
  sessionId: string;
  /** The server's revision of the session these values were read at. */
  revision: string;
  state: string;
  positionSeconds: number;
  /** What the server lets this profile do to the session now. */
  actions: readonly RemoteAction[];
  itemId?: string;
  title?: string;
}>;

const ACTIONS: readonly RemoteAction[] = ['pause', 'resume', 'seek', 'stop'];

/** The entry for the session this device handed off, among everything the profile is playing. */
export function remoteReport(items: readonly RemotePlaybackControls[], sessionId: string | undefined): RemoteReport | undefined {
  if (!sessionId) return undefined;
  const mine = items.find(item => item.sessionId === sessionId);
  if (!mine) return undefined;
  return Object.freeze({
    sessionId: mine.sessionId, revision: mine.revision, state: mine.state, positionSeconds: Math.max(0, mine.positionMs / 1000),
    actions: Object.freeze(ACTIONS.filter(action => mine.actions.includes(action))),
    ...(mine.item ? {itemId: mine.item.id, title: mine.item.title} : {}),
  });
}

/**
 * A newer reading replaces an older one; an answer that arrives out of order (its revision is
 * behind the one in hand, for the same session) is dropped, so the position never steps back to
 * what it was before a seek.
 */
export function newerReport(held: RemoteReport | undefined, next: RemoteReport | undefined): RemoteReport | undefined {
  if (!next || !held || held.sessionId !== next.sessionId) return next;
  try { if (BigInt(next.revision) < BigInt(held.revision)) return held; } catch { /* a revision this app cannot compare is taken as it comes */ }
  return next;
}

/**
 * Whether a control is offered. With a report in hand it is the server's list that decides; before
 * the first report (or on a server that has none to give) the controls the handoff always had stay.
 */
export function remoteAllows(report: RemoteReport | undefined, action: RemoteAction): boolean {
  return !report || report.actions.includes(action);
}

/** Where a skip lands: from the playing device's own position, kept inside the title. Undefined without a reported position. */
export function remoteSkipTarget(report: RemoteReport | undefined, deltaSeconds: number, durationSeconds: number): number | undefined {
  if (!report) return undefined;
  const target = report.positionSeconds + deltaSeconds;
  return Math.max(0, durationSeconds > 0 ? Math.min(durationSeconds, target) : target);
}
