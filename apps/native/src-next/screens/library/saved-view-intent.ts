import type {SavedDefinition} from '../../../../../packages/client-core/src/personal-saved';
import {sameAuthority, type ShellAuthority} from '../../shell/model';

/** One exact saved definition offered to the real Library route. It is taken once,
 * only by the matching authorized library; an ordinary Library opening has none. */
export type LibrarySavedViewIntent = Readonly<{
  libraryId: string;
  authority: ShellAuthority;
  definition: SavedDefinition;
  resourceId: string;
}>;

let pending: LibrarySavedViewIntent | undefined;

export function askLibrarySavedView(intent: LibrarySavedViewIntent): void {pending = intent;}

export function takeLibrarySavedView(libraryId: string, authority: ShellAuthority): LibrarySavedViewIntent | undefined {
  const intent = pending;
  pending = undefined;
  if (!intent || intent.libraryId !== libraryId || !sameAuthority(intent.authority, authority)) return undefined;
  return intent;
}
