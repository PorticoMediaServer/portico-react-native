import {classifyPlaybackFailure} from './playback-failure';
import type {FailureFact} from './cannot-play';

/**
 * The last failure the player engine reported for each attempt, kept for the player's error
 * card. The playback service keeps only a sentence; whether that failure can ever mend is in the
 * engine's own facts (the delivery status, whether it was the network, whether the engine itself
 * refused the media). It is told beside the player and changes nothing about playback.
 */
type Kept = {intentId: number; itemId?: string; fact: FailureFact};

let last: Kept | undefined;
/** Attempts in a row that ended with the file refused, for one title. */
let refusals: {itemId: string; count: number; intents: Set<number>} | undefined;

const refused = (fact: FailureFact) => !fact.networkError && ((typeof fact.httpStatus === 'number' && [403, 404, 410].includes(fact.httpStatus)) || (fact.httpStatus === undefined && fact.deliveryError === true));

/** One engine fact, from whichever engine is playing: the player's fact handler feeds every fact
 * the engine in use reports, so the card is right for either engine. */
export function noteEngineFact(raw: unknown, itemId: string | undefined): void {
  if (!raw || typeof raw !== 'object') return;
  const f = raw as {type?: unknown; intentId?: unknown; httpStatus?: unknown; deliveryError?: unknown; networkError?: unknown; engineCode?: unknown; hasPlayed?: unknown; uncertain?: unknown; position?: unknown};
  if (typeof f.intentId !== 'number') return;
  // Playback that moves again has recovered: an earlier refusal no longer counts against the title.
  if (f.type === 'progress' && typeof f.position === 'number' && f.position > 0 && refusals && itemId === refusals.itemId && !refusals.intents.has(f.intentId)) refusals = undefined;
  if (f.type !== 'error') return;
  const verdict = classifyPlaybackFailure(f);
  const fact: FailureFact = {
    ...(typeof f.httpStatus === 'number' && Number.isInteger(f.httpStatus) ? {httpStatus: f.httpStatus} : {}),
    ...(f.deliveryError === true ? {deliveryError: true} : {}),
    ...(verdict.network ? {networkError: true} : {}),
    ...(verdict.engine ? {engine: true} : {}),
  };
  last = {intentId: f.intentId, itemId, fact};
  if (!itemId || !refused(fact)) return;
  if (refusals?.itemId !== itemId) refusals = {itemId, count: 0, intents: new Set()};
  // One attempt counts once, however many times the engine repeats itself.
  if (!refusals.intents.has(f.intentId)) { refusals.intents.add(f.intentId); refusals.count++; }
}

/** What the engine last said about this attempt, and how often this title's file has been refused in a row. */
export function failureFor(intentId: number, itemId: string | undefined): {fact?: FailureFact; sameFailures: number} {
  return {fact: last?.intentId === intentId ? last.fact : undefined, sameFailures: itemId && refusals?.itemId === itemId ? refusals.count : 0};
}

/** Forgets everything (a different viewer, or a test). */
export function resetFailureFacts(): void {
  last = undefined;
  refusals = undefined;
}
