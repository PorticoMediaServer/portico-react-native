import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';

/** One exact saved view headed for one exact Customize Home route. The route object
 * must be the very object opened by the Saved handler; authority and session family
 * must still match when the route consumes it. An ordinary Customize Home route can
 * never borrow it, and a failed open clears it. */
export type HomeCustomizeViewIntent = Readonly<{
  route: NativeShellRoute;
  authority: ShellAuthority;
  sessionFamilyId: string;
  serverId: string;
  resourceId: string;
  revision: number;
  viewerFence: string;
}>;

let pending: HomeCustomizeViewIntent | undefined;

export function askHomeCustomizeView(intent: HomeCustomizeViewIntent): void {pending = intent;}

export function takeHomeCustomizeView(route: NativeShellRoute, authority: ShellAuthority, sessionFamilyId: string | undefined): HomeCustomizeViewIntent | undefined {
  const intent = pending;
  if (!intent) return undefined;
  // Do not consume for a different route object: the exact opened route may still come.
  if (intent.route !== route) return undefined;
  pending = undefined;
  if (!sameAuthority(intent.authority, authority) || !sessionFamilyId || intent.sessionFamilyId !== sessionFamilyId) return undefined;
  return intent;
}

export function clearHomeCustomizeIntent(): void {pending = undefined;}
