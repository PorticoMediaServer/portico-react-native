import {createNativeShellPlaybackAdapter as sharedFactory, type NativePlaybackFactoryOptions} from '../../../../../../native/src-next/platform/playback/native';
export * from '../../../../../../native/src-next/platform/playback/native';

/** The W3C engine reports [1]; another device's saved speed is never applied here. */
export function createNativeShellPlaybackAdapter(options: NativePlaybackFactoryOptions) {
  return sharedFactory({...options, settings: () => ({...options.settings(), videoRate: 1, audiobookRate: 1})});
}
