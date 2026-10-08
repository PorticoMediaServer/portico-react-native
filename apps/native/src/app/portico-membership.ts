/**
 * Leaving a server and handing it over (Spec — Hosted at Scale), for a Portico Account's own
 * membership: a member leaves (Portico drops the server from the account's list and the server
 * ends the membership at its next check-in); the owner, who can't leave, transfers ownership to
 * an active member first. No React Native imports: tested under Node.
 */
import type {DirectAccount} from '../../../../packages/client-core/src/profile-management';

type Account = Pick<DirectAccount, 'id' | 'role' | 'hostedAccountId'>;
export type TransferTarget = Readonly<{id: string; username: string}>;

export function membershipActions(account: Account | undefined): {leave: boolean; transfer: boolean} {
  const portico = !!account?.hostedAccountId;
  return {leave: portico && account!.role !== 'owner', transfer: portico && account!.role === 'owner'};
}

/** The accounts ownership can go to (`GET /v1/direct/members`): active members, never oneself. */
export function transferTargets(raw: unknown, selfId: string): readonly TransferTarget[] {
  const items = (raw as {items?: unknown} | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: TransferTarget[] = [];
  for (const v of items) {
    const m = v as {id?: unknown; username?: unknown; role?: unknown; disabled?: unknown};
    if (typeof m?.id !== 'string' || typeof m.username !== 'string' || m.id === selfId) continue;
    if (m.role !== 'member' || m.disabled === true) continue;
    out.push({id: m.id, username: m.username});
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * INT M6: the owner is a Portico Account but Portico doesn't hold the server's registration for it
 * yet (after a transfer to it). The shell asks that owner to accept; accepting needs the Portico
 * Account signed in on this device, since it is confirmed with a fresh identity assertion.
 */
export function asksForCustody(input: {role?: string; authority?: string; custodyPending?: boolean; porticoSignedIn: boolean}): boolean {
  return input.authority === 'local' && input.role === 'owner' && input.custodyPending === true && input.porticoSignedIn;
}
