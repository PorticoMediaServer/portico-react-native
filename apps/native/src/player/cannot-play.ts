/**
 * Media that can never be played, told apart from playback that stopped and may work on another
 * try. A connection that dropped, a server that is busy and a stream limit all pass; these do
 * not: the title or its file is gone, this profile may not play it, this device cannot play it
 * and the server has nothing else to offer, or the server cannot read the file. For those the
 * player says what is wrong in one sentence and offers no "Try again", because trying again
 * cannot help.
 *
 * Pure, so the rule is tested under Node (test/cannot-play.test.ts). What it reads:
 * - the failure text the playback service kept (`PlaybackSnapshot.error`): a server code, or one
 *   of the fixed sentences the queue player writes for a refused start;
 * - the last failure the player engine reported for this attempt (`FailureFact`);
 * - how many attempts in a row ended the same way for this title.
 */
export type CannotPlayReason = 'gone' | 'denied' | 'unsupported' | 'conversionOff' | 'unreadable' | 'fileMissing';

export type FailureFact = Readonly<{httpStatus?: number; deliveryError?: boolean; networkError?: boolean; engine?: boolean}>;

/** Server answers that say the same thing however often they are asked. */
const BY_CODE: Readonly<Record<string, CannotPlayReason>> = {
  not_found: 'gone',
  forbidden: 'denied',
  access_revoked: 'denied',
  unsupported_media: 'unsupported',
  unsupported_tuple: 'unsupported',
  transcode_not_allowed: 'conversionOff',
  transcoding_disabled: 'conversionOff',
  unknown_source_facts: 'unreadable',
  encoder_failure: 'unreadable',
};

/** The queue player's own sentences for a refused start (client-core `v1-queue-player.ts`). */
const BY_SENTENCE: Readonly<Record<string, CannotPlayReason>> = {
  'This item isn’t available.': 'gone',
  'This media is no longer available.': 'gone',
  'This title needs converting, and converting is turned off for this account.': 'conversionOff',
  'This title can’t be played on this device.': 'unsupported',
};

/** A delivery answer that means "not there" or "not for you", as opposed to "not now". */
const refusedDelivery = (fact: FailureFact | undefined): boolean =>
  !!fact && !fact.networkError && ((typeof fact.httpStatus === 'number' && [403, 404, 410].includes(fact.httpStatus)) || (fact.httpStatus === undefined && fact.deliveryError === true));

/**
 * Why this can never be played, or null when another try is worth offering.
 *
 * `routeReady`: the server can be reached right now. An engine that gave up while the server
 * could not be asked for another way to play has not been told there is none.
 * `sameFailures`: attempts in a row for this title that ended with the file refused. The first
 * may be a stream that had simply expired, which a fresh start mends; the second is the file.
 */
export function cannotPlayReason(input: {error?: string; fact?: FailureFact; routeReady: boolean; sameFailures: number}): CannotPlayReason | null {
  const text = (input.error ?? '').trim();
  const known = BY_CODE[text] ?? BY_SENTENCE[text];
  if (known) return known;
  if (refusedDelivery(input.fact)) return input.sameFailures >= 2 ? 'fileMissing' : null;
  // The engine could not play what it was given, and the server had no other way to offer it.
  if (input.fact?.engine && !input.fact.networkError && input.routeReady) return 'unsupported';
  return null;
}
