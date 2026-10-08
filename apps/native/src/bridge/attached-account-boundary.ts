import type { CredentialSessionService } from '../../../../packages/client-core/src/credentials.ts';
import type { LocalSession } from '../../../../packages/client-core/src/index.ts';

type Credentials = Pick<CredentialSessionService, 'getSnapshot' | 'subscribe'>;
export type AttachedAccountScope = Readonly<{ accountId: string; familyId: string }>;

export type AttachedPlaybackOwner = Readonly<{ localToken: string | undefined; leave: () => void }>;
/** Resolve the current rendered owner when the credential event actually arrives. */
export function closeAttachedAccount(
  localToken: string,
  viewer: LocalSession | undefined,
  playback: AttachedPlaybackOwner,
  closeLocal: () => void,
): boolean {
  if (viewer?.accessToken !== localToken || viewer.viewer.authority !== 'hosted') return false;
  if (playback.localToken === localToken) playback.leave();
  closeLocal();
  return true;
}

/** A local attachment belongs to the account family that authorized it. */
export function observeAttachedAccount(
  credentials: Credentials,
  expected: AttachedAccountScope,
  onEnded: () => void,
): () => void {
  const scope = { ...expected };
  let disposed = false;
  let ended = false;
  const check = () => {
    if (disposed || ended) return;
    const state = credentials.getSnapshot();
    const current = state.session;
    if (state.phase === 'signedOut' || (current && (
      current.account.id !== scope.accountId || current.familyId !== scope.familyId
    ))) {
      ended = true;
      onEnded();
    }
  };
  const unsubscribe = credentials.subscribe(check);
  check();
  return () => { disposed = true; unsubscribe(); };
}
