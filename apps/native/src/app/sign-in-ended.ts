/**
 * Justin (23 Sep): a sign-in that has ended goes straight back to the sign-in screen; an
 * unreachable server keeps the shell (Downloads, Settings) and keeps retrying. The same set as web
 * (22595295): the server refused to renew it, refused this profile access (`access_refused`), or
 * the address now answers as another server. Everything else (network, routes, 5xx, 429, 400, 404)
 * keeps the saved sign-in and stays in the shell.
 */
export type SignInEnding = 'ended' | 'noAccess' | 'reset';

export function resumeEnding(error: unknown, replaced: boolean, accessRefusedCode: string): SignInEnding | undefined {
  const value = error as {signOut?: unknown; code?: unknown; name?: unknown} | null;
  if (value && value.name !== 'RouteError' && value.signOut === true) return 'ended';
  if (value?.code === accessRefusedCode) return 'noAccess';
  return replaced ? 'reset' : undefined;
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
