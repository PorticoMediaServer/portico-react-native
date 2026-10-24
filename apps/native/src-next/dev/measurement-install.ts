/** App imports this module only inside its DEV branch. */
import {Dimensions, PixelRatio, Platform} from 'react-native';
import {createAndroidNativeTreeObserver, installNativeLayoutDump, type NativeLayoutDump} from './layout-dump';

type CommandHost = typeof globalThis & {
  __PORTICO_NATIVE_LAYOUT_DUMP__?: Readonly<Pick<NativeLayoutDump, 'capture'>>;
};

/** Only the public specimen can lend its current host to the one collector. */
export function installNativePublicMeasurement(root: () => object | null, isCurrent: () => boolean): () => void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return () => {};
  const host = globalThis as CommandHost;
  if (host.__PORTICO_NATIVE_LAYOUT_DUMP__) throw new Error('A public native measurement command is already installed.');
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('Native measurement requires an Android or Apple host.');
  const owner = installNativeLayoutDump({
    root: () => isCurrent() ? root() : null,
    viewport: () => {
      const window = Dimensions.get('window');
      return {width: window.width, height: window.height, deviceScaleFactor: PixelRatio.get()};
    },
    diagnostics: () => ({fontScale: PixelRatio.getFontScale()}),
    observe: createAndroidNativeTreeObserver(),
    platform: Platform.OS === 'android' ? 'android' : Platform.isTV ? 'tvos' : 'ios',
    anchors: {
      'accounts-welcome-title': 'title',
      'accounts-welcome-portico': 'primary-action',
      'accounts-welcome-portico/label': 'primary-action-label',
      'accounts-welcome-local': 'secondary-action',
      'accounts-welcome-local/label': 'secondary-action-label',
      'tv-front-door': 'screen',
      'tv-front-door-title': 'title',
      'tv-front-door-portico': 'primary-action',
      'tv-front-door-portico/label': 'primary-action-label',
      'tv-front-door-local': 'secondary-action',
      'tv-front-door-local/label': 'secondary-action-label',
    },
  });
  if (!owner) throw new Error('The DEV native collector is unavailable.');
  const command = Object.freeze({capture: (options?: Parameters<NativeLayoutDump['capture']>[0]) => owner.capture(options)});
  host.__PORTICO_NATIVE_LAYOUT_DUMP__ = command;
  return () => {
    if (host.__PORTICO_NATIVE_LAYOUT_DUMP__ === command) delete host.__PORTICO_NATIVE_LAYOUT_DUMP__;
    owner.dispose();
  };
}
