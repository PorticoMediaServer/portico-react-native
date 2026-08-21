export type ApplicationRootPhase = 'Account' | 'Profile' | 'FailClosed' | 'Product';

/**
 * Maps identity/runtime state onto the one always-mounted application router.
 * The policy is shared by handheld and television clients; ordinary server
 * unavailability remains inside Product rather than replacing its route tree.
 */
export function applicationRootPhaseForState(input: {
  status: string;
  hasAccount: boolean;
  transitionFailure: boolean;
}): ApplicationRootPhase {
  if (input.status === 'booting') return 'Account';
  if (input.transitionFailure && input.status !== 'signed-out') return 'FailClosed';
  if ((input.status === 'signed-out' || input.status === 'connecting') && !input.hasAccount) return 'Account';
  if (input.status === 'selecting-profile') return 'Profile';
  return 'Product';
}
