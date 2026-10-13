/** What a paused start needs of the player's own service. */
export type PausablePlayer = Readonly<{getSnapshot: () => {itemId?: string; intentId: number; phase: string; intent: string}; subscribe: (listener: () => void) => () => void; pause: () => void}>;

/**
 * Starts a title paused (Watch Together: a room that is paused, or holding for everyone, takes a
 * new title paused). The player has no "start paused": it ignores a pause while it has nothing
 * loaded, so one asked for in the same breath as the load would be lost. This arms the pause
 * before the load is asked for and applies it the moment the player has begun that load, in the
 * same turn the player says so. The engine reads the player's state a turn later, so the first
 * thing it is ever told about the title is "paused": it shows its frame and makes no sound.
 *
 * `intentBefore` is the player's intent when the load was asked for (read before asking). A title
 * that is loaded again while it is already the player's (the group moved everyone to another
 * moment of it) is the same title under a new intent: the pause waits for that new intent, since
 * one given to the playback from before would be undone when the load begins. A different title
 * is paused as soon as it is the player's, whether or not the intent has changed by then.
 *
 * It gives up after `giveUpMs`, when another title begins first, or when `stop` (the returned
 * function) is called.
 *
 * No React and no native code: tested under Node.
 */
export function pauseNextStart(player: PausablePlayer, itemId: string, intentBefore: number, giveUpMs = 15000): () => void {
  let done = false;
  let off = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (done) return; done = true; off(); clearTimeout(timer); };
  const itemBefore = player.getSnapshot().itemId;
  const look = () => {
    if (done) return;
    const s = player.getSnapshot();
    // Between two titles the player holds the old one, or none, for a moment; a third title beginning first ends the wait.
    if (s.itemId !== itemId) { if (s.itemId && s.itemId !== itemBefore) stop(); return; }
    // The same title as before, and still the playback from before: the load has not begun.
    if (s.intentId === intentBefore && itemBefore === itemId) return;
    if (s.phase === 'idle') return;
    stop();
    if (s.intent === 'playing') player.pause();
  };
  off = player.subscribe(look);
  if (done) off();
  timer = setTimeout(stop, giveUpMs);
  look();
  return stop;
}
