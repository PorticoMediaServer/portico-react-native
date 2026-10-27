/** Moved to `src-next/platform/continuation-queue`, which now owns the one per-origin order map
 * and the binding witnesses; this path keeps the old public surface. */
export {serializeContinuation, observeContinuationBinding, replaceContinuationBinding, continuationBindingCurrent}
  from '../../src-next/platform/continuation-queue';
