type StepQueue = Readonly<{
  getSnapshot(): {view: {queue: {id: string; revision: string}; next: {available: boolean}} | null};
  next(queueId: string, expectedRevision: string): Promise<void>;
  previous(): Promise<void>;
}>;
type StepService = Readonly<{
  hasNativeOwner(): boolean;
  systemListeningAction(action: 'next' | 'previous'): Promise<unknown>;
  getQueueController(): StepQueue | undefined;
}>;

/**
 * Next or Previous from the transport, the mini bar and the system's media commands. The native
 * listening owner moves its own queue; any other playback (a video, or audio it doesn't own)
 * moves through the device queue, as on web. Pure, so node tests cover the choice
 * (test/queue-step.test.ts).
 */
export function stepQueue(service: StepService, action: 'next' | 'previous'): Promise<unknown> {
  if (service.hasNativeOwner()) return service.systemListeningAction(action);
  const queue = service.getQueueController();
  if (!queue) return Promise.resolve();
  if (action === 'previous') return queue.previous();
  const view = queue.getSnapshot().view;
  return view?.next.available ? queue.next(view.queue.id, view.queue.revision) : Promise.resolve();
}
