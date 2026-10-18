import {Platform} from 'react-native';
import type {KeyReports} from './focus-return';

/** How this platform reports a press on the remote (`KeyReports`): Android by its release only, tvOS and Vega by the press. */
export function keyReports(): KeyReports {
  return Platform.OS === 'android' ? 'release' : 'press';
}
