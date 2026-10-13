import {NativeModules, Platform} from 'react-native';

// A television flavor or a device advertising Leanback remains a television even when
// its generic Android build reports the ordinary UI mode. Run before any app modules load.
if (Platform.OS === 'android' && NativeModules.PorticoRuntime?.television === true) {
  (Platform.constants as {uiMode?: string}).uiMode = 'tv';
}
