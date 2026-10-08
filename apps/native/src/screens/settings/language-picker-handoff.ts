/**
 * M9 language list ↔ menu handoff (iPhone and TV).
 *
 * The overlay system presents one sheet at a time: an opening overlay waits
 * for every closing one to finish (`afterOverlaysClose` in ui/Sheet). A menu's
 * `onClose` runs while its own Sheet is still open — its Sheet marks itself
 * closing in a later effect — so reopening the list synchronously presents it
 * while the menu is still dismissing, and iOS drops the list (in one run it
 * simply never reappears). Close the menu first, wait a turn so its closing
 * mark lands, then reopen the list once every closing overlay has gone.
 *
 * No React Native imports: tested under Node.
 */

export type MenuCloseGate = {
  /** Runs `fn` once no overlay is closing (Sheet's `afterOverlaysClose`). */
  runAfterClose: (fn: () => void) => void;
};

export function closeLanguageMenu(options: {
  /** Clears the menu state (hides the menu). Runs synchronously. */
  clearMenu: () => void;
  /** Defers `fn` past the current task, so the menu's close effect (which sets
   * its closing mark) runs before the reopen is sequenced. */
  defer: (fn: () => void) => void;
  gate: MenuCloseGate;
  /** Reopens the list. Runs only after every closing overlay has gone. */
  reopenList: () => void;
}): void {
  const {clearMenu, defer, gate, reopenList} = options;
  clearMenu();
  defer(() => gate.runAfterClose(reopenList));
}
