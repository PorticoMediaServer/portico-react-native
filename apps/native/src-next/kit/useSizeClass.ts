import {useWindowDimensions} from 'react-native';
import {sizeClassForWidth, type SizeClass} from '../../../../packages/client-core/src';

/** Logical window width, updated by React Native on resize, rotation and folding. */
export function useSizeClass(): SizeClass {
  return sizeClassForWidth(useWindowDimensions().width);
}

export type {SizeClass};
