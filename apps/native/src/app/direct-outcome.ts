import type {DirectSignIn} from '../../../../packages/client-core/src/profile-management';

/**
 * C45: what the app does with a direct sign-in answer. Pure, so the decision is tested against the
 * documented shapes (`test/direct-outcome.test.ts`); `app/session.tsx` carries it out.
 * - `code`: two-step verification; ask for a code, then `completeDirectSignInChallenge`.
 * - `device-pending`: nothing issued; wait for the owner, then sign in again.
 * - `new-password`: the server requires one; change it with this session, then sign in again.
 * - `choose-profile`: an account-tier session (it can manage, not play); pick a profile.
 * - `viewer`: one unprotected profile; this session is the viewer and is kept (never ended).
 */
export type DirectOutcome = 'code' | 'device-pending' | 'new-password' | 'choose-profile' | 'viewer';

export function directOutcome(result: DirectSignIn): DirectOutcome {
  if (result.kind === 'challenge') return 'code';
  if (result.kind === 'device-pending') return 'device-pending';
  if (result.passwordChangeRequired) return 'new-password';
  return result.accountScoped ? 'choose-profile' : 'viewer';
}
