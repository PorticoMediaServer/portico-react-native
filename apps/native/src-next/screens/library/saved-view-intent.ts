import type {SavedDefinition} from '../../../../../packages/client-core/src/personal-saved';
import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';

/** One exact saved definition headed for one exact Library route. The route object and
 * the captured authority/session family must match when the Library takes it; a failed
 * open clears it, and a later ordinary Library route cannot borrow it. */
export type LibrarySavedViewIntent = Readonly<{
  route: NativeShellRoute;
  libraryId: string;
  authority: ShellAuthority;
  sessionFamilyId: string;
  definition: SavedDefinition;
  resourceId: string;
  revision: number;
  viewerFence: string;
}>;

let pending: LibrarySavedViewIntent | undefined;

export function askLibrarySavedView(intent: LibrarySavedViewIntent): void {pending = intent;}

export function takeLibrarySavedView(route: NativeShellRoute, libraryId: string, authority: ShellAuthority, sessionFamilyId: string | undefined): LibrarySavedViewIntent | undefined {
  const intent = pending;
  if (!intent) return undefined;
  if (intent.route !== route) return undefined;
  pending = undefined;
  if (!sameAuthority(intent.authority, authority) || !sessionFamilyId || intent.sessionFamilyId !== sessionFamilyId || intent.libraryId !== libraryId) return undefined;
  return intent;
}

export function clearLibrarySavedViewIntent(): void {pending = undefined;}
