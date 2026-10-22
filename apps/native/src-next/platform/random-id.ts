import {NativeModules} from 'react-native';

/**
 * Hermes has no Web Crypto. Shared code makes its request ids with `crypto.randomUUID` when it
 * exists (client-core `randomId`), so the app provides it once, from the native UUID source that
 * already makes playback request ids. Without it, a shared service built without its own id
 * source (the downloads service) throws before it sends anything.
 */
const runtime = NativeModules.PorticoRuntime as undefined | {playbackRequestId?: () => string};
const scope = globalThis as {crypto?: {randomUUID?: () => string}};
if (typeof scope.crypto?.randomUUID !== 'function' && typeof runtime?.playbackRequestId === 'function') {
  const source = runtime.playbackRequestId.bind(runtime);
  scope.crypto = Object.assign(scope.crypto ?? {}, {randomUUID: () => source()});
}
