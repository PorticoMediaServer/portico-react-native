import type {PersistentPlaybackSnapshot} from '../playbackSession';
import type {ApplicationRootPhase} from '../applicationRootPhase';

export function tvPlayerHostPresentation(
  routeName: string,
  snapshot: PersistentPlaybackSnapshot | undefined,
): 'background-audio' | 'fullscreen' | 'hidden' {
  if (routeName === 'player') return 'fullscreen';
  return snapshot?.active
    && snapshot.mediaFamily === 'audio'
    && snapshot.presentation === 'background'
    ? 'background-audio'
    : 'hidden';
}

export function tvNowPlayingIsEligible(input: {
  accountHubOpen: boolean;
  phase: ApplicationRootPhase;
  routeName: string;
}): boolean {
  return input.phase === 'Product'
    && input.routeName !== 'player'
    && !input.accountHubOpen;
}
