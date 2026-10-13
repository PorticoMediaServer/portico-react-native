/**
 * Pick before play (Spec — Title Pages §1): the version of a title chosen on its page (another
 * copy, an edition), held until Play starts that title, then used once. It sits beside the shared
 * `pending-track-choice` (audio and subtitles), which does not carry a version.
 *
 * The player reads it when it starts a title and sends it with the start, so the first stream is
 * already the chosen version: `takePendingVersion(itemId)` gives the version id for the start
 * request's `versionId` (client-core `PlaybackChoices`). A choice never outlives one play.
 */
export type PendingVersion = Readonly<{itemId: string; versionId: string}>;

let pending: PendingVersion | undefined;

export function setPendingVersion(choice: PendingVersion | undefined): void {
  pending = choice;
}

/** The version chosen for this title, consumed (cleared) on read. */
export function takePendingVersion(itemId: string): string | undefined {
  if (!pending || pending.itemId !== itemId) return undefined;
  const out = pending.versionId;
  pending = undefined;
  return out;
}

export function peekPendingVersion(itemId: string): string | undefined {
  return pending && pending.itemId === itemId ? pending.versionId : undefined;
}
