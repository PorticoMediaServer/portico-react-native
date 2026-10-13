import {ApiError} from '../../../../packages/client-core/src/index';
import type {HostedGate} from '../../../../packages/client-core/src/hosted-gate';

/**
 * Television activation behind the shared Portico Account gate (`hosted-gate.ts`): one circuit
 * for everything in the app that talks to the account service. When anything has learned the
 * service is down or asked the app to slow down, activation waits with the rest instead of
 * finding it out again by itself.
 *
 * - What a person asks for goes through: getting a code when the screen opens, a retry or a new
 *   code they press, a cancel they press. It still reports its outcome to the gate.
 * - What the app does by itself waits for the gate: timed retries, every poll for the approval,
 *   and tidying up codes that were replaced. While the gate is closed such a request is not sent
 *   at all; it is answered here as "try again in N seconds", which the activation's own schedule
 *   already obeys, so the next attempt comes no sooner than the gate allows. The activation's own
 *   retry wait stays 5 to 30 seconds; the gate's wait is never shortened to fit it.
 * - The service's own answers about a code (still waiting, slow down, declined, expired) are
 *   answers, not an outage: they never close the gate, whatever status they arrive with.
 *
 * The code on screen and its expiry are the activation service's and are kept through an outage.
 * Signing in to a server directly (Quick Connect) is not the account service and never comes here.
 *
 * No React Native imports: tested under Node.
 */
export type ActivationStep = 'create' | 'poll' | 'cancel';

/** How long after a person acts their request is still theirs (the screen opens, then asks for a code a moment later). */
export const EXPLICIT_MS = 10_000;

/** What the account service says about a code. These are the protocol working, not the service failing. */
const CODE_ANSWERS = new Set(['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'invalid_grant']);

export function activationGate(gate: HostedGate, now: () => number = Date.now) {
  let explicitUntil = 0;
  return {
    /** A person just asked for something (opened the screen, pressed Try again or Get a new code, came back to the app). */
    userActed(): void { explicitUntil = now() + EXPLICIT_MS; },
    async run<T>(step: ActivationStep, request: () => Promise<T>): Promise<T> {
      const explicit = step !== 'poll' && now() < explicitUntil;
      if (!explicit) {
        const wait = gate.blockedFor();
        if (wait > 0) throw new ApiError(503, 'account_service_recovering', 'The Portico Account service is temporarily unavailable.', true, Math.ceil(wait / 1000));
      }
      try {
        const value = await request();
        gate.succeeded();
        return value;
      } catch (error) {
        if (error instanceof ApiError && CODE_ANSWERS.has(error.code)) gate.succeeded();
        else gate.observe(error);
        throw error;
      }
    },
  };
}
