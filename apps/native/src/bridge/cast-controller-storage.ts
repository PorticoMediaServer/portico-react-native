/** Moved to `src-next/platform/play-on/cast-controller-storage` so the new app owns the one
 * in-memory proof cache and its durable record; this path keeps the old public surface. */
export {castControllerStorage, castControllerStorageReady, readControllerProofs}
  from '../../src-next/platform/play-on/cast-controller-storage';
