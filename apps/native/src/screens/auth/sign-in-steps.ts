/**
 * The sign-in flow's steps as data, so what each device offers is decided (and tested) in one
 * place. Justin: codes are the TV's. The TV shows an account activation code and a server Quick
 * Connect code, and a phone or computer approves them. iPhone and iPad sign in with Google or
 * Apple, a Portico Account, or directly to a server with a password, never with a code.
 * No React Native imports: tested under Node.
 */
export type DirectStep = 'address' | 'code' | 'password';
export type DirectEvent = 'connected' | 'usePassword' | 'back';
export type AccountScreen = 'activation' | 'form';

/** The direct sign-in's first step: the TV asks for the address, then shows a code. */
export const firstDirectStep = (isTV: boolean): DirectStep => (isTV ? 'address' : 'password');

/** Where a direct sign-in step goes next; 'exit' leaves the direct sign-in. */
export function directStepAfter(step: DirectStep, event: DirectEvent, isTV: boolean): DirectStep | 'exit' {
  if (!isTV) return event === 'back' ? 'exit' : 'password';
  if (event === 'connected') return step === 'address' ? 'code' : step;
  if (event === 'usePassword') return 'password';
  return step === 'address' ? 'exit' : 'address';
}

/** The account sign-in's first screen: the TV's activation code, or the handheld's form. */
export const accountScreen = (isTV: boolean): AccountScreen => (isTV ? 'activation' : 'form');

/** Every direct step a device can reach from its first one. */
export function reachableDirectSteps(isTV: boolean): ReadonlySet<DirectStep> {
  const seen = new Set<DirectStep>([firstDirectStep(isTV)]);
  const queue = [...seen];
  while (queue.length) {
    const step = queue.shift()!;
    for (const event of ['connected', 'usePassword', 'back'] as const) {
      const next = directStepAfter(step, event, isTV);
      if (next !== 'exit' && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}
