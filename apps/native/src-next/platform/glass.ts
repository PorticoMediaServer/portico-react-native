import {Platform} from 'react-native';
import {buttonSpec, colors, navigationSpec} from '@portico/design';

/** Q43: Android TV and Fire OS use the drawn translucent fill, never video blur. */
export function glassRecipe(os = Platform.OS, isTV = Platform.isTV === true) {
  return {
    nativeBlur: !isTV || os === 'ios',
    backgroundColor: colors[buttonSpec.glass.fallback.background],
    backgroundAlpha: buttonSpec.glass.fallback.backgroundAlpha,
    blurAmount: buttonSpec.glass.blur,
  };
}
export function phoneTabBarRecipe() {
  return {...navigationSpec.phone.tabBar, backgroundColor: colors.raised};
}
