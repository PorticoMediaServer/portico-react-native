/** What `pauseOnceStarted` needs of the player's own service. */
export type PausablePlayer = Readonly<{getSnapshot: () => {itemId?: string; phase: string; intent: string}; subscribe: (listener: () => void) => () => void; pause: () => void}>;

/**
 * Pauses a title the moment the player has taken it (Watch Together: a room that is paused, or
 * holding for everyone, takes a new title paused). The player ignores a pause while it has
 * nothing loaded, so one asked for in the same breath as the load would be lost; this waits for
 * the title to be the player's, pauses once, and gives up after `giveUpMs`, when a third title
 * comes first, or when `stop` (the returned function) is called.
 *
 * No React and no native code: tested under Node.
 */
export function pauseOnceStarted(player: PausablePlayer, itemId: string, giveUpMs = 15000): () => void {
  // The title that was playing when the new one was asked for is still the player's for a moment.
  const before = player.getSnapshot().itemId;
  let done = false;
  let off = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (done) return; done = true; off(); clearTimeout(timer); };
  const look = () => {
    if (done) return;
    const s = player.getSnapshot();
    if (s.itemId !== itemId) { if (s.itemId && s.itemId !== before) stop(); return; }
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
