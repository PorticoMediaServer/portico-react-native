type StepQueue = Readonly<{
  getSnapshot(): {view: {queue: {id: string; revision: string}; next: {reason: 'ready' | 'end' | 'unavailable'}} | null};
  next(queueId: string, expectedRevision: string): Promise<void>;
  previous(): Promise<void>;
}>;
type StepService = Readonly<{
  hasNativeOwner(): boolean;
  systemListeningAction(action: 'next' | 'previous'): Promise<unknown>;
  getQueueController(): StepQueue | undefined;
}>;

/** Watch Together's claim on Next and Previous: true when the group took the intent. */
export type GroupStep = Readonly<{step(action: 'next' | 'previous'): boolean}>;

/**
 * What Watch Together does with Next or Previous for the title the group is showing (`group`
 * is undefined for any other title): whoever may control the group sends its command, anyone
 * else is told why not. Either way the intent is the group's, never a move on this device.
 */
export function groupStep(group: Readonly<{permissions: Readonly<{canControl: boolean}>}> | undefined, action: 'next' | 'previous', io: Readonly<{transport(action: 'next' | 'previous'): void; refuse(): void}>): boolean {
  if (!group) return false;
  if (group.permissions.canControl) io.transport(action);
  else io.refuse();
  return true;
}

/**
 * Next or Previous from the transport, the mini bar and the system's media commands. While
 * watching with a group they are the group's. Otherwise the native listening owner moves its
 * own queue, and any other playback (a video, or audio it doesn't own) moves through the device
 * queue, as on web. Pure, so node tests cover the choice (test/queue-step.test.ts,
 * test/queue-step-group.test.ts).
 */
export function stepQueue(service: StepService, action: 'next' | 'previous', group?: GroupStep | null): Promise<unknown> {
  if (group?.step(action)) return Promise.resolve();
  if (service.hasNativeOwner()) return service.systemListeningAction(action);
  const queue = service.getQueueController();
  if (!queue) return Promise.resolve();
  if (action === 'previous') return queue.previous();
  // Next is the server's to resolve: it steps past entries this viewer can't play, so an
  // unavailable entry right after the current one doesn't stop it. Only the end of the queue does.
  const view = queue.getSnapshot().view;
  return view && view.next.reason !== 'end' ? queue.next(view.queue.id, view.queue.revision) : Promise.resolve();
}
