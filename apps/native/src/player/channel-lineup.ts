import type {GuideChannel} from '../../../../packages/client-core/src/channel-guide';

/**
 * FEAT-07: channel up and down in the player. When a channel is tuned from the guide, the guide
 * hands over how to read its lineup (the channels it lists, in its order and filters); the
 * player's Previous and Next then tune the neighbouring watchable channel, wrapping at the ends.
 * A plain module rather than hook state, so the player's hooks stay as they are.
 */
export type Lineup = {
  (): Promise<readonly GuideChannel[]>;
  /** Bounded server-authored neighbour in this lineup's order and filters, when supported. */
  step?: (channel: GuideChannel, delta: 1 | -1) => Promise<GuideChannel | undefined>;
};

let tuned: {channel: GuideChannel; lineup?: Lineup} | undefined;

/** Record what was tuned; without a lineup (tuned from elsewhere) channel stepping is off. */
export function channelTuned(channel: GuideChannel, lineup?: Lineup): void {
  tuned = {channel, lineup};
}

/** The channel this player tuned, if it came through the player (for the mini guide and Record). */
export function tunedChannel(): GuideChannel | undefined {
  return tuned?.channel;
}

export function canStepChannel(): boolean {
  return !!tuned?.lineup;
}

/** The watchable channel `delta` places from the current one, or undefined. */
export async function channelStep(delta: 1 | -1): Promise<{channel: GuideChannel; lineup: Lineup} | undefined> {
  const at = tuned;
  if (!at?.lineup) return undefined;
  if (at.lineup.step) {
    let next: GuideChannel | undefined;
    try { next = await at.lineup.step(at.channel, delta); } catch { return undefined; }
    if (tuned !== at || !next?.tuneAvailable || (next.id === at.channel.id && next.sourceId === at.channel.sourceId)) return undefined;
    return {channel: next, lineup: at.lineup};
  }
  const all = (await at.lineup().catch(() => [] as readonly GuideChannel[])).filter(c => c.tuneAvailable);
  if (tuned !== at || all.length < 2) return undefined;
  const index = all.findIndex(c => c.id === at.channel.id && c.sourceId === at.channel.sourceId);
  const next = all[(((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta) % all.length + all.length) % all.length];
  return next ? {channel: next, lineup: at.lineup} : undefined;
}
