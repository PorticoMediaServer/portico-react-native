/** Moved to `src-next/platform/queue-storage-legacy`, which preserves this exact implementation
 * (its per-key serialization, record rules and change semantics) for the records the old bridge
 * keeps; this path keeps the old public surface. The new app's own store is a different module. */
export type {DamagedRecord} from '../../src-next/platform/queue-storage-legacy';
export {NativeQueueStore} from '../../src-next/platform/queue-storage-legacy';
