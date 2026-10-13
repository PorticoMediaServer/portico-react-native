import {savedConnectionDamaged} from '../../../../packages/client-core/src/server-connections';

/**
 * Justin (23 Sep): a sign-in that has ended goes straight back to the sign-in screen; an
 * unreachable server keeps the shell (Downloads, Settings) and keeps retrying. The same set as
 * web: the server refused to renew it, or refused this profile access (`access_refused`). So does
 * a saved sign-in this device can never read again (damaged, not merely unreadable right now):
 * waiting will not mend it. Everything else (network, routes, 5xx, 429, 400, 404) keeps the saved
 * sign-in and stays in the shell.
 *
 * An address that now answers as a different server ends nothing. That answer is not signed, so
 * it proves nothing: another machine may have been given the address, or a proxy may be sending
 * requests to the wrong place. The saved sign-in is kept, Portico keeps trying, and the person is
 * told a different server is answering and may choose to sign in again (`savedStateAfter`).
 */
export type SignInEnding = 'ended' | 'noAccess';

export function resumeEnding(error: unknown, accessRefusedCode: string): SignInEnding | undefined {
  const value = error as {signOut?: unknown; code?: unknown; name?: unknown} | null;
  if (value && value.name !== 'RouteError' && value.signOut === true) return 'ended';
  if (savedConnectionDamaged(error)) return 'ended';
  if (value?.code === accessRefusedCode) return 'noAccess';
  return undefined;
}

/** What the shell says while a saved sign-in that has not ended cannot be used: its server is not answering, or something else answers at its address. */
export function savedStateAfter(replaced: boolean): 'offline' | 'replaced' {
  return replaced ? 'replaced' : 'offline';
}

export type AuthStep = 'welcome' | 'hosted' | 'landing' | 'direct' | 'create' | 'forgot' | 'offline';

/** Where the sign-in flow opens after an ending: the direct form (address filled in) for a direct
 * sign-in; for a Portico Account, the shell landing (its server opens there) when the account is still signed in, else
 * account sign-in (the activation code on TV). */
export function stepAfterEnding(authority: 'local' | 'hosted', accountSignedIn: boolean, isTV: boolean): AuthStep {
  if (authority === 'local') return 'direct';
  if (accountSignedIn) return 'landing';
  return isTV ? 'welcome' : 'hosted';
}
