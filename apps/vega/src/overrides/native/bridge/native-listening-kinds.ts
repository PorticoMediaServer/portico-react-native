// The Vega counterpart of `apps/native/src/bridge/native-listening-kinds.ts`.
//
// On Apple, music and audiobooks are handed to a native owner that keeps the timeline, the lease
// and the queue going while JavaScript sleeps (plan §9.3 C3). A Vega app's JavaScript does not
// sleep while it plays, and there is no second engine to hand anything to: listening sessions
// play through the same player as video, driven by the shared queue player itself. So no kind is
// native here.
export {serverPlaybackV1Kinds} from '../../../../../native/src/bridge/native-listening-kinds';

export const nativeV1ListeningKinds: readonly string[] = Object.freeze([]);

/** Whether an item kind plays under a native owner: never, on Vega. */
export function nativeListeningFor(_serverKinds: readonly string[], _enabled: readonly string[] = nativeV1ListeningKinds) {
  return (_kind: string) => false;
}

/**
 * The Vega media element plays at normal speed only (`supportedRates` is `[1]`), and with no
 * separate listening owner nothing joins tracks, crossfades or levels volume. Settings therefore
 * offers neither here.
 */
export const playerSettingsSupport: Readonly<{playbackSpeed: boolean; audioEffects: boolean}> = Object.freeze({playbackSpeed: false, audioEffects: false});
