/**
 * Native registration comes from the dependency's Fabric/CocoaPods metadata.
 * Apple: the pinned setup patch uses the public material selected by blurType.
 * blurAmount stays accepted/bridged but does not control Apple intensity, even at 0;
 * UIKit owns the material (current callers use dark). Android amounts are unchanged.
 */
export {BlurView} from '@react-native-community/blur';
export {glassRecipe, phoneTabBarRecipe} from './glass';
