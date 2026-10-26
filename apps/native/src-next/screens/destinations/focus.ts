import type {FocusAddress, FocusRegistry} from '../../kit/focus/registry';
import {authorityKey, type ShellAuthority} from '../../shell/model';
import {tvFocusIds} from '../../shell/tv-focus';

export type NativeDestinationActivation = Readonly<{visible: boolean; intent: 'enter' | 'restore' | 'top'; revision: number}>;
/** Assembly owns navigation visibility and intent; a renderer never guesses it
 * from Home state or resets a retained page merely because it renders again. */
export type NativeDestinationActivationPort = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeDestinationActivation;
}>;

export function nativeDestinationFocusIds(authority: ShellAuthority) {
  const prefix = `tv.${authorityKey(authority)}`, rail = tvFocusIds(authority).rail;
  return {
    rail,
    searchKeyboard: `${prefix}.search.keyboard`,
    searchKeyboardRow: (row: number) => `${prefix}.search.keyboard.row.${row}`,
    searchResults: `${prefix}.search.results`,
    searchChips: `${prefix}.search.chips`, searchTop: `${prefix}.search.top`,
    searchLanding: `${prefix}.search.landing`, searchRecent: `${prefix}.search.recent`,
    /** One region per drawn result section, so each keeps its own row memory. */
    searchSection: (groupId: string) => `${prefix}.search.results.section.${groupId}`,
    savedTabs: `${prefix}.saved.tabs`, savedToolbar: `${prefix}.saved.toolbar`,
    savedGrid: `${prefix}.saved.grid`,
    libraryTabs: (libraryId: string) => `${prefix}.library.${JSON.stringify(libraryId)}.tabs`,
    libraryToolbar: (libraryId: string) => `${prefix}.library.${JSON.stringify(libraryId)}.toolbar`,
    libraryCard: (libraryId: string, id: string) => `${prefix}.library.${JSON.stringify(libraryId)}.card.${id}`,
  };
}

/** A successful native host request is the receipt. Missing data or layout is
 * retried when hosts attach; restoration/content changes never move focus. */
export function createDestinationEntryFocus(registry: Pick<FocusRegistry, 'focus'>) {
  let completed: string | undefined;
  return (activation: NativeDestinationActivation, address: FocusAddress | undefined): boolean => {
    if (!activation.visible) return false;
    const ticket = JSON.stringify([activation.revision, activation.intent]);
    if (completed === ticket) return false;
    if (activation.intent === 'restore') {completed = ticket; return false;}
    if (!address || !registry.focus(address)) return false;
    completed = ticket; return true;
  };
}
