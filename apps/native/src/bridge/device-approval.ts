/**
 * What a television that is signing in with a code is waiting on beyond the code itself. A server
 * whose owner approves new devices answers the code's collection with "waiting for the owner"
 * (and keeps the code good) or "the owner turned this device away". The code service treats both
 * as no answer yet and keeps asking; this holds which it was, so the screen can say so.
 *
 * No React Native imports: tested under Node.
 */
export type DeviceApproval = 'pending' | 'denied' | undefined;

export function deviceApprovalWatch() {
  let state: DeviceApproval;
  const listeners = new Set<() => void>();
  const set = (next: DeviceApproval) => { if (next === state) return; state = next; for (const listener of [...listeners]) listener(); };
  return {
    getSnapshot: (): DeviceApproval => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Wraps the collection of a code: its answer says whether the owner's approval is what is missing. */
    async watch<T>(collect: () => Promise<T>): Promise<T> {
      try {
        const value = await collect();
        set(undefined);
        return value;
      } catch (error) {
        const code = (error as {code?: unknown} | null)?.code;
        if (code === 'device_approval_pending') set('pending');
        else if (code === 'device_denied') set('denied');
        // Any other answer the server gives about the code means the owner's approval is not the question.
        else if (typeof code === 'string' && typeof (error as {status?: unknown}).status === 'number') set(undefined);
        throw error;
      }
    },
    reset: () => set(undefined),
  };
}
